package whatsapp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	_ "github.com/lib/pq"
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
//
// Uses sqlstore.NewWithDB with an explicit bounded *sql.DB so whatsmeow's
// internal pool cannot exhaust the direct-connection slot budget on the
// Supabase side. Without this cap whatsmeow uses database/sql defaults
// (unbounded MaxOpenConns) — 2026-07-17 audit flagged this as scale risk.
func NewClient(ctx context.Context, pgConnStr string) (*Client, error) {
	dbLog := waLog.Stdout("WAStore", "WARN", true)

	db, err := sql.Open("postgres", pgConnStr)
	if err != nil {
		return nil, fmt.Errorf("whatsapp: open db: %w", err)
	}
	// WA session writes (identity keys, prekeys, session data) are infrequent
	// bursts. Cap tightly to leave direct-pool slots for pq.Listener and query
	// spillover. 3 concurrent WA session ops is plenty at 10-1000 tenant scale.
	db.SetMaxOpenConns(3)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("whatsapp: db ping: %w", err)
	}

	container := sqlstore.NewWithDB(db, "postgres", dbLog)
	if err := container.Upgrade(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("whatsapp: sqlstore upgrade: %w", err)
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("whatsapp: get device: %w", err)
	}
	clientLog := waLog.Stdout("WAClient", "INFO", true)
	wa := whatsmeow.NewClient(deviceStore, clientLog)
	return &Client{WA: wa}, nil
}

func (c *Client) Connect(ctx context.Context) error {
	slog.Info("[WA] Connect called", slog.Any("store_id", c.WA.Store.ID), slog.Bool("store_deleted", c.WA.Store.Deleted))
	if c.WA.Store.ID == nil {
		qrChan, err := c.WA.GetQRChannel(ctx)
		if err != nil {
			// Don't crash the daemon — schedule a retry so the HTTP server stays up.
			slog.Error("[WA] GetQRChannel error — retrying in 5s", slog.Any("error", err))
			go func() {
				time.Sleep(5 * time.Second)
				if err2 := c.Connect(context.Background()); err2 != nil {
					slog.Error("[WA] Retry connect error", slog.Any("error", err2))
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
			slog.Error("[WA] Connect (Store.ID=nil, pre-pair) error — starting backoff retry", slog.Any("error", err))
			go c.retryPreparePairing(ctx)
			return nil
		}
		go c.runQRLoop(ctx, qrChan)
	} else {
		if err := c.WA.Connect(); err != nil {
			// Don't fatally crash — log and let HTTP server stay up.
			slog.Error("[WA] Reconnect error — retrying in 10s", slog.Any("error", err))
			go func() {
				time.Sleep(10 * time.Second)
				if err2 := c.Connect(context.Background()); err2 != nil {
					slog.Error("[WA] Retry reconnect error", slog.Any("error", err2))
				}
			}()
			return nil
		}
		slog.Info("[WA] Connected (resuming stored session)")
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
		slog.Info("[WA] retryPreparePairing waiting", slog.Int("attempt", attempt+1), slog.String("wait", d.String()))
		select {
		case <-ctx.Done():
			slog.Info("[WA] retryPreparePairing: ctx cancelled", slog.Int("attempts", attempt))
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
			slog.Info("[WA] retryPreparePairing: Store.ID appeared during backoff, exiting retry loop")
			return
		}
		qrChan, err := c.WA.GetQRChannel(ctx)
		if err != nil {
			slog.Error("[WA] retryPreparePairing GetQRChannel error", slog.Int("attempt", attempt+1), slog.Any("error", err))
			continue
		}
		if err := c.WA.Connect(); err != nil {
			slog.Error("[WA] retryPreparePairing WA.Connect error", slog.Int("attempt", attempt+1), slog.Any("error", err))
			continue
		}
		slog.Info("[WA] retryPreparePairing: connected — starting QR loop", slog.Int("attempt", attempt+1))
		go c.runQRLoop(ctx, qrChan)
		return
	}
	slog.Warn("[WA] retryPreparePairing: exhausted after 100 attempts — daemon staying up without WA pairing")
}

func (c *Client) runQRLoop(ctx context.Context, ch <-chan whatsmeow.QRChannelItem) {
	slog.Info("[WA] QR loop started — waiting for QR code events")
	for {
		for evt := range ch {
			if evt.Event == "code" {
				slog.Info("[WA] QR Code ready for scanning")
				c.setQR(evt.Code)
			} else {
				slog.Info("[WA] QR channel event", slog.String("event", evt.Event))
				c.setQR("")
				if evt.Event == "success" {
					slog.Info("[WA] Pairing successful — connected")
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
		slog.Info("[WA] QR timed out — reconnecting for new QR")
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
			slog.Error("[WA] GetQRChannel error — retrying in 3s", slog.Int("attempt", attempt), slog.Any("error", err))
			if errors.Is(err, whatsmeow.ErrQRStoreContainsID) {
				// Session was restored while we waited — exit QR loop.
				slog.Info("[WA] Store now has a session ID — exiting QR loop")
				return
			}
			c.WA.Disconnect()
			time.Sleep(3 * time.Second)
		}
		if err != nil {
			slog.Error("[WA] GetQRChannel failed after 3 attempts — exiting QR loop", slog.Any("error", err))
			return
		}
		for attempt := 1; ; attempt++ {
			if err := c.WA.Connect(); err == nil {
				break
			} else {
				slog.Error("[WA] QR loop connect error — retrying in 5s", slog.Int("attempt", attempt), slog.Any("error", err))
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
			slog.Warn("[WA] Session invalidated by server — clearing store and restarting process", slog.Bool("on_connect", evt.OnConnect))
			c.setQR("")
			c.WA.Disconnect()
			if err := c.WA.Store.Delete(context.Background()); err != nil {
				slog.Error("[WA] Store.Delete error", slog.Any("error", err))
			}
			slog.Info("[WA] Restarting process for clean QR pairing...")
			time.Sleep(time.Second)
			os.Exit(0)
		case *events.Disconnected:
			_ = evt
			// whatsmeow has EnableAutoReconnect=true by default, but add an
			// explicit fallback in case the internal reconnect loop gives up.
			if c.WA.Store.ID != nil {
				slog.Info("[WA] Disconnected — triggering reconnect in 10s")
				go func() {
					time.Sleep(10 * time.Second)
					if !c.WA.IsConnected() {
						slog.Info("[WA] Still disconnected — reconnecting")
						if err := c.WA.Connect(); err != nil {
							slog.Error("[WA] Reconnect error", slog.Any("error", err))
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
		slog.Info("[WA] Logout called with no stored session — restarting for QR pairing")
	} else {
		if err := c.WA.Logout(ctx); err != nil {
			// Graceful logout failed (WA WebSocket not connected).
			// Force-clear the local session so the user can re-pair.
			slog.Error("[WA] Graceful logout failed — forcing local session clear", slog.Any("error", err))
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
		slog.Info("[WA] Restarting process after logout for clean QR pairing...")
		os.Exit(0)
	}()
	return nil
}
