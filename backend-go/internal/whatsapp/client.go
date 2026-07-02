package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Client struct {
	WA        *whatsmeow.Client
	mu        sync.Mutex
	currentQR string
}

func (c *Client) GetQR() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.currentQR
}

func (c *Client) setQR(qr string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.currentQR = qr
}

// NewClient creates a WhatsApp client backed by PostgreSQL so the session
// persists across Cloud Run restarts and redeploys.
func NewClient(ctx context.Context, pgConnStr string) (*Client, error) {
	dbLog := waLog.Stdout("WAStore", "WARN", true)
	container, err := sqlstore.New(ctx, "postgres", pgConnStr, dbLog)
	if err != nil {
		return nil, fmt.Errorf("whatsapp: open store: %w", err)
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("whatsapp: get device: %w", err)
	}
	clientLog := waLog.Stdout("WAClient", "INFO", true)
	wa := whatsmeow.NewClient(deviceStore, clientLog)
	return &Client{WA: wa}, nil
}

func (c *Client) Connect(ctx context.Context) error {
	log.Printf("[WA] Connect called — Store.ID=%v Store.Deleted=%v", c.WA.Store.ID, c.WA.Store.Deleted)
	if c.WA.Store.ID == nil {
		qrChan, err := c.WA.GetQRChannel(ctx)
		if err != nil {
			// Don't crash the daemon — schedule a retry so the HTTP server stays up.
			log.Printf("[WA] GetQRChannel error: %v — retrying in 5s", err)
			go func() {
				time.Sleep(5 * time.Second)
				if err2 := c.Connect(context.Background()); err2 != nil {
					log.Printf("[WA] Retry connect error: %v", err2)
				}
			}()
			return nil
		}
		if err := c.WA.Connect(); err != nil {
			// Don't crash the daemon — schedule a retry loop so the HTTP server
			// stays up. This branch fires when the outbound TLS handshake to
			// web.whatsapp.com/ws/chat times out (30s) on Cloud Run cold start;
			// without the retry, the daemon proceeds without WA for the
			// instance's whole lifetime (see progress.md 2026-07-02 finding).
			// Backoff: 30s → 60s → 120s (cap), max 100 attempts (~3.3h ceiling).
			log.Printf("[WA] Connect (Store.ID=nil, pre-pair) error: %v — starting backoff retry", err)
			go c.retryPreparePairing(ctx)
			return nil
		}
		go c.runQRLoop(ctx, qrChan)
	} else {
		if err := c.WA.Connect(); err != nil {
			// Don't fatally crash — log and let HTTP server stay up.
			log.Printf("[WA] Reconnect error: %v — retrying in 10s", err)
			go func() {
				time.Sleep(10 * time.Second)
				if err2 := c.Connect(context.Background()); err2 != nil {
					log.Printf("[WA] Retry reconnect error: %v", err2)
				}
			}()
			return nil
		}
		log.Println("[WA] Connected (resuming stored session)")
	}
	return nil
}

// retryPreparePairing retries the pre-pair Connect() with exponential-ish
// backoff (30s, 60s, 120s repeating). Fires when the initial WA.Connect()
// fails on a fresh (unpaired) store — typically because the outbound TLS
// handshake to web.whatsapp.com timed out. Disconnects any lingering state
// between attempts so GetQRChannel doesn't hit ErrQRAlreadyConnected on
// retry. Exits cleanly when a session becomes paired mid-backoff (rare) or
// when ctx is cancelled.
func (c *Client) retryPreparePairing(ctx context.Context) {
	delays := []time.Duration{30 * time.Second, 60 * time.Second, 120 * time.Second}
	for attempt := 0; attempt < 100; attempt++ {
		d := delays[len(delays)-1]
		if attempt < len(delays) {
			d = delays[attempt]
		}
		log.Printf("[WA] retryPreparePairing: attempt %d, waiting %s", attempt+1, d)
		select {
		case <-ctx.Done():
			log.Printf("[WA] retryPreparePairing: ctx cancelled after %d attempts", attempt)
			return
		case <-time.After(d):
		}
		// Reset any lingering state so GetQRChannel doesn't return
		// ErrQRAlreadyConnected. Mirrors the pattern used in runQRLoop
		// (lines 113-118) after a QR timeout.
		c.WA.Disconnect()
		for i := 0; i < 20 && c.WA.IsConnected(); i++ {
			time.Sleep(500 * time.Millisecond)
		}
		// Rare race: another path paired the session during our sleep.
		if c.WA.Store.ID != nil {
			log.Printf("[WA] retryPreparePairing: Store.ID appeared during backoff, exiting retry loop")
			return
		}
		qrChan, err := c.WA.GetQRChannel(ctx)
		if err != nil {
			log.Printf("[WA] retryPreparePairing attempt %d: GetQRChannel error: %v", attempt+1, err)
			continue
		}
		if err := c.WA.Connect(); err != nil {
			log.Printf("[WA] retryPreparePairing attempt %d: WA.Connect error: %v", attempt+1, err)
			continue
		}
		log.Printf("[WA] retryPreparePairing attempt %d: connected — starting QR loop", attempt+1)
		go c.runQRLoop(ctx, qrChan)
		return
	}
	log.Printf("[WA] retryPreparePairing: exhausted after 100 attempts — daemon staying up without WA pairing")
}

func (c *Client) runQRLoop(ctx context.Context, ch <-chan whatsmeow.QRChannelItem) {
	log.Println("[WA] QR loop started — waiting for QR code events")
	for {
		for evt := range ch {
			if evt.Event == "code" {
				log.Printf("[WA] QR Code ready for scanning")
				c.setQR(evt.Code)
			} else {
				log.Printf("[WA] QR channel event: %s", evt.Event)
				c.setQR("")
				if evt.Event == "success" {
					log.Println("[WA] Pairing successful — connected")
					return
				}
				break // timeout or error — fall through to reconnect
			}
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
		log.Println("[WA] QR timed out — reconnecting for new QR")
		c.WA.Disconnect()
		// Wait until IsConnected returns false before calling GetQRChannel again.
		// Without this, GetQRChannel returns ErrQRAlreadyConnected and the loop exits silently.
		for i := 0; i < 20 && c.WA.IsConnected(); i++ {
			time.Sleep(500 * time.Millisecond)
		}
		time.Sleep(time.Second)

		var err error
		for attempt := 1; attempt <= 3; attempt++ {
			ch, err = c.WA.GetQRChannel(ctx)
			if err == nil {
				break
			}
			log.Printf("[WA] GetQRChannel attempt %d error: %v — retrying in 3s", attempt, err)
			if errors.Is(err, whatsmeow.ErrQRStoreContainsID) {
				// Session was restored while we waited — exit QR loop.
				log.Println("[WA] Store now has a session ID — exiting QR loop")
				return
			}
			c.WA.Disconnect()
			time.Sleep(3 * time.Second)
		}
		if err != nil {
			log.Printf("[WA] GetQRChannel failed after 3 attempts: %v — exiting QR loop", err)
			return
		}
		for attempt := 1; ; attempt++ {
			if err := c.WA.Connect(); err == nil {
				break
			} else {
				log.Printf("[WA] QR loop connect attempt %d error: %v — retrying in 5s", attempt, err)
				time.Sleep(5 * time.Second)
				select {
				case <-ctx.Done():
					return
				default:
				}
			}
		}
	}
}

func (c *Client) AddEventHandler(handler func(evt interface{})) {
	c.WA.AddEventHandler(func(rawEvt interface{}) {
		switch evt := rawEvt.(type) {
		case *events.Message:
			handler(evt)
		case *events.LoggedOut:
			// Fired when WhatsApp server rejects our stored session (expired / revoked).
			// After Store.Delete(), the device is marked Deleted and WA.Connect() returns
			// ErrDeviceDeleted — we cannot reuse the same client object. Restart the process
			// so Cloud Run creates a fresh client (Store.ID = nil → QR pairing).
			log.Printf("[WA] Session invalidated by server (on_connect=%v) — clearing store and restarting process", evt.OnConnect)
			c.setQR("")
			c.WA.Disconnect()
			if err := c.WA.Store.Delete(context.Background()); err != nil {
				log.Printf("[WA] Store.Delete error: %v", err)
			}
			log.Println("[WA] Restarting process for clean QR pairing...")
			time.Sleep(time.Second)
			os.Exit(0)
		case *events.Disconnected:
			_ = evt
			// whatsmeow has EnableAutoReconnect=true by default, but add an
			// explicit fallback in case the internal reconnect loop gives up.
			if c.WA.Store.ID != nil {
				log.Println("[WA] Disconnected — triggering reconnect in 10s")
				go func() {
					time.Sleep(10 * time.Second)
					if !c.WA.IsConnected() {
						log.Println("[WA] Still disconnected — reconnecting")
						if err := c.WA.Connect(); err != nil {
							log.Printf("[WA] Reconnect error: %v", err)
						}
					}
				}()
			}
		}
	})
}

func (c *Client) Disconnect() {
	c.WA.Disconnect()
}

// Logout clears the WhatsApp session. Since Store.Delete() marks the device as
// deleted and WA.Connect() would then return ErrDeviceDeleted, we restart the
// process so Cloud Run creates a fresh client ready for QR pairing.
func (c *Client) Logout(ctx context.Context) error {
	if c.WA.Store.ID == nil {
		// No stored session — nothing to delete, just restart for QR pairing.
		log.Println("[WA] Logout called with no stored session — restarting for QR pairing")
	} else {
		if err := c.WA.Logout(ctx); err != nil {
			// Graceful logout failed (WA WebSocket not connected).
			// Force-clear the local session so the user can re-pair.
			log.Printf("[WA] Graceful logout failed (%v) — forcing local session clear", err)
			c.WA.Disconnect()
			if err2 := c.WA.Store.Delete(ctx); err2 != nil {
				return fmt.Errorf("whatsapp: clear session: %w", err2)
			}
		}
	}
	c.setQR("")
	// Restart after a brief pause so the HTTP response is flushed first.
	go func() {
		time.Sleep(time.Second)
		log.Println("[WA] Restarting process after logout for clean QR pairing...")
		os.Exit(0)
	}()
	return nil
}
