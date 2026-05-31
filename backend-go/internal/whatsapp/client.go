package whatsapp

import (
	"context"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Client struct {
	WA *whatsmeow.Client
}

func NewClient(ctx context.Context, dbPath string) (*Client, error) {
	dbLog := waLog.Stdout("WAStore", "WARN", true)
	container, err := sqlstore.New(ctx, "sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", dbPath), dbLog)
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
		for evt := range qrChan {
			if evt.Event == "code" {
				log.Printf("[WA] QR Code (scan with WhatsApp): %s", evt.Code)
			} else {
				log.Printf("[WA] QR channel event: %s", evt.Event)
				break
			}
		}
	} else {
		if err := c.WA.Connect(); err != nil {
			return fmt.Errorf("whatsapp: reconnect: %w", err)
		}
	}
	log.Println("[WA] Connected")
	return nil
}

func (c *Client) AddEventHandler(handler func(evt interface{})) {
	c.WA.AddEventHandler(func(rawEvt interface{}) {
		switch evt := rawEvt.(type) {
		case *events.Message:
			handler(evt)
		}
	})
}

func (c *Client) Disconnect() {
	c.WA.Disconnect()
}
