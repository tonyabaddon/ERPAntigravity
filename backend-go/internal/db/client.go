package db

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/lib/pq"
)

type NotifyHandlers struct {
	OnAdminMessage  func(conversationID, messageID string)
	OnOrderApproved func(orderID, conversationID string, shippingFee float64)
}

type Client struct {
	DB       *sql.DB
	listener *pq.Listener
}

func NewClient(connStr string) (*Client, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	log.Println("[DB] Connected to Supabase PostgreSQL")

	listener := pq.NewListener(connStr, 10*time.Second, time.Minute,
		func(ev pq.ListenerEventType, err error) {
			if err != nil {
				log.Printf("[DB] Listener event error: %v", err)
			}
		})

	return &Client{DB: db, listener: listener}, nil
}

// StartListening subscribes to Postgres NOTIFY channels and dispatches to handlers.
// Call once at startup; runs until the client is closed.
func (c *Client) StartListening(h NotifyHandlers) error {
	if err := c.listener.Listen("admin_messages"); err != nil {
		return err
	}
	if err := c.listener.Listen("order_approved"); err != nil {
		return err
	}

	go func() {
		for notification := range c.listener.Notify {
			if notification == nil {
				continue
			}
			switch notification.Channel {
			case "admin_messages":
				var p struct {
					ConversationID string `json:"conversation_id"`
					MessageID      string `json:"message_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] admin_messages parse error: %v", err)
					continue
				}
				if h.OnAdminMessage != nil {
					go h.OnAdminMessage(p.ConversationID, p.MessageID)
				}

			case "order_approved":
				var p struct {
					OrderID        string  `json:"order_id"`
					ConversationID string  `json:"conversation_id"`
					ShippingFee    float64 `json:"shipping_fee"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] order_approved parse error: %v", err)
					continue
				}
				if h.OnOrderApproved != nil {
					go h.OnOrderApproved(p.OrderID, p.ConversationID, p.ShippingFee)
				}
			}
		}
	}()

	log.Println("[DB] LISTEN/NOTIFY active on admin_messages, order_approved")
	return nil
}

func (c *Client) Close() {
	c.listener.Close()
	c.DB.Close()
}
