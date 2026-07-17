package db

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/lib/pq"
)

type NotifyHandlers struct {
	OnAdminMessage    func(conversationID, messageID string)
	OnOrderApproved   func(orderID, conversationID string, shippingFee float64)
	OnPaymentVerified func(orderID, conversationID string)
	OnPaymentRejected func(orderID, conversationID string)
	OnDPVerified      func(orderID, conversationID string)
	OnDPProofRejected func(orderID, conversationID, reason string)
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
	// Supabase session pooler free-tier caps at 15 client connections.
	// Cloud Run rolling deploys briefly run 2 revisions in parallel: with
	// MaxOpenConns=10 each, 2 × 10 = 20 clients → new revision startup fails
	// with EMAXCONNSESSION (see 2026-07-17 Bug D). MaxOpenConns=5 gives
	// 2 × 5 = 10 in-use, plus room for backup Cloud Run Job + operator MCP.
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	slog.Info("[DB] Connected to Supabase PostgreSQL")

	listener := pq.NewListener(connStr, 10*time.Second, time.Minute,
		func(ev pq.ListenerEventType, err error) {
			if err != nil {
				slog.Error("[DB] Listener event error", slog.Any("error", err))
			}
		})

	return &Client{DB: db, listener: listener}, nil
}

// NewClientWithoutListener returns a *Client with only the SQL connection
// initialised. Used by integration tests where the LISTEN/NOTIFY plumbing is
// irrelevant and slow to set up.
func NewClientWithoutListener(connStr string) (*Client, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return &Client{DB: db}, nil
}

// StartListening subscribes to Postgres NOTIFY channels and dispatches to handlers.
// Call once at startup; runs until the client is closed.
func (c *Client) StartListening(h NotifyHandlers) error {
	channels := []string{"admin_messages", "order_approved", "payment_verified", "payment_rejected", "dp_verified", "dp_proof_rejected"}
	for _, ch := range channels {
		if err := c.listener.Listen(ch); err != nil {
			return err
		}
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
					slog.Error("[DB] admin_messages parse error", slog.Any("error", err))
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
					slog.Error("[DB] order_approved parse error", slog.Any("error", err))
					continue
				}
				if h.OnOrderApproved != nil {
					go h.OnOrderApproved(p.OrderID, p.ConversationID, p.ShippingFee)
				}

			case "payment_verified":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					slog.Error("[DB] payment_verified parse error", slog.Any("error", err))
					continue
				}
				if h.OnPaymentVerified != nil {
					go h.OnPaymentVerified(p.OrderID, p.ConversationID)
				}

			case "payment_rejected":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					slog.Error("[DB] payment_rejected parse error", slog.Any("error", err))
					continue
				}
				if h.OnPaymentRejected != nil {
					go h.OnPaymentRejected(p.OrderID, p.ConversationID)
				}

			case "dp_verified":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					slog.Error("[DB] dp_verified parse error", slog.Any("error", err))
					continue
				}
				if h.OnDPVerified != nil {
					go h.OnDPVerified(p.OrderID, p.ConversationID)
				}

			case "dp_proof_rejected":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
					Reason         string `json:"reason"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					slog.Error("[DB] dp_proof_rejected parse error", slog.Any("error", err))
					continue
				}
				if h.OnDPProofRejected != nil {
					go h.OnDPProofRejected(p.OrderID, p.ConversationID, p.Reason)
				}
			}
		}
	}()

	slog.Info("[DB] LISTEN/NOTIFY active on admin_messages, order_approved, payment_verified, payment_rejected, dp_verified, dp_proof_rejected")
	return nil
}

func (c *Client) Close() {
	if c.listener != nil {
		c.listener.Close()
	}
	c.DB.Close()
}
