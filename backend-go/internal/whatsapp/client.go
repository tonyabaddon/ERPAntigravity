package whatsapp

import (
	"context"
	"fmt"
	"log"
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
	clientLog := waLog.Stdout("WAClient", "WARN", true)
	wa := whatsmeow.NewClient(deviceStore, clientLog)
	return &Client{WA: wa}, nil
}

func (c *Client) Connect(ctx context.Context) error {
	if c.WA.Store.ID == nil {
		qrChan, _ := c.WA.GetQRChannel(ctx)
		if err := c.WA.Connect(); err != nil {
			return fmt.Errorf("whatsapp: connect: %w", err)
		}
		go c.runQRLoop(ctx, qrChan)
	} else {
		if err := c.WA.Connect(); err != nil {
			return fmt.Errorf("whatsapp: reconnect: %w", err)
		}
		log.Println("[WA] Connected")
	}
	return nil
}

func (c *Client) runQRLoop(ctx context.Context, ch <-chan whatsmeow.QRChannelItem) {
	for {
		for evt := range ch {
			if evt.Event == "code" {
				log.Printf("[WA] QR Code ready for scanning")
				c.setQR(evt.Code)
			} else {
				log.Printf("[WA] QR channel event: %s", evt.Event)
				c.setQR("")
				if evt.Event == "success" {
					log.Println("[WA] Connected")
					return
				}
				break // timeout — fall through to reconnect
			}
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
		log.Println("[WA] QR timed out — reconnecting for new QR")
		c.WA.Disconnect()
		time.Sleep(2 * time.Second)
		var err error
		ch, err = c.WA.GetQRChannel(ctx)
		if err != nil {
			log.Printf("[WA] GetQRChannel error: %v", err)
			return
		}
		if err := c.WA.Connect(); err != nil {
			log.Printf("[WA] Reconnect error: %v", err)
			return
		}
	}
}

func (c *Client) AddEventHandler(handler func(evt interface{})) {
	c.WA.AddEventHandler(func(rawEvt interface{}) {
		switch evt := rawEvt.(type) {
		case *events.Message:
			handler(evt)
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

// Logout clears the WhatsApp session and restarts the QR pairing loop so
// the frontend can immediately scan a fresh QR code.
// If the WebSocket is already dead, it falls back to force-clearing the local
// session so the user can always disconnect even when offline.
func (c *Client) Logout(ctx context.Context) error {
	if err := c.WA.Logout(ctx); err != nil {
		// Graceful logout failed (WA WebSocket not connected).
		// Force-clear the local session so the user can re-pair.
		log.Printf("[WA] Graceful logout failed (%v) — forcing local session clear", err)
		c.WA.Disconnect()
		if err2 := c.WA.Store.Delete(ctx); err2 != nil {
			return fmt.Errorf("whatsapp: clear session: %w", err2)
		}
	}
	c.setQR("")
	// Restart QR loop in background; don't block the HTTP response.
	go func() {
		time.Sleep(time.Second)
		if err := c.Connect(context.Background()); err != nil {
			log.Printf("[WA] post-logout reconnect: %v", err)
		}
	}()
	return nil
}
