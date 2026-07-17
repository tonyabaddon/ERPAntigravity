package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
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
	DB       *sql.DB // HTTP handlers + RPC calls via transaction pooler
	ListenDB *sql.DB // pq.Listener only via direct connection
	listener *pq.Listener
}

// NewClient initialises a split-pool DB client:
//   - queryConn: transaction pooler URL (port 6543) — used by all HTTP handlers
//     and RPC calls. Supavisor multiplexes hundreds of clients over a small
//     number of server connections, so MaxOpenConns=10 is safe at scale.
//   - listenConn: direct connection URL (port 5432) — used by pq.Listener only.
//     One persistent connection per instance; direct pool has ~45-55 slots so
//     this scales to 40+ backend instances with headroom.
//
// Both connections are pinged on init. If the second ping fails the first
// connection is closed before returning the error.
//
// Split-pool rationale: session pooler (port 5432 via pooler) caps at 15
// clients on the free tier (Bug D, 2026-07-17). Transaction pooler has no
// effective client cap but drops LISTEN. Direct connection preserves LISTEN
// but counts against the real-connection quota.
func NewClient(queryConn, listenConn string) (*Client, error) {
	query, err := sql.Open("postgres", queryConn)
	if err != nil {
		return nil, err
	}
	// Restore MaxOpenConns=10: txn pooler multiplexes so this doesn't exhaust
	// server connections. Previous MaxOpenConns=5 was a session-pooler workaround.
	query.SetMaxOpenConns(10)
	query.SetMaxIdleConns(5)
	query.SetConnMaxLifetime(5 * time.Minute)
	if err := query.Ping(); err != nil {
		query.Close()
		return nil, fmt.Errorf("db: query pool ping failed: %w", err)
	}

	listen, err := sql.Open("postgres", listenConn)
	if err != nil {
		query.Close()
		return nil, err
	}
	// Listener pool: only holds the pq.Listener persistent conn + 1 spare.
	// ConnMaxLifetime=0 means never rotate — pq.Listener needs a stable conn.
	listen.SetMaxOpenConns(2)
	listen.SetMaxIdleConns(1)
	listen.SetConnMaxLifetime(0)
	if err := listen.Ping(); err != nil {
		query.Close()
		listen.Close()
		return nil, fmt.Errorf("db: listener pool ping failed: %w", err)
	}

	slog.Info("[DB] Connected — queries via txn pooler, listener via direct")

	listener := pq.NewListener(listenConn, 10*time.Second, time.Minute,
		func(ev pq.ListenerEventType, err error) {
			if err != nil {
				slog.Error("[DB] Listener event error", slog.Any("error", err))
			}
		})

	return &Client{DB: query, ListenDB: listen, listener: listener}, nil
}

// NewClientWithoutListener returns a *Client with only the query SQL connection
// initialised. Used by integration tests where the LISTEN/NOTIFY plumbing is
// irrelevant and slow to set up.
func NewClientWithoutListener(connStr string) (*Client, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
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
	if c.ListenDB != nil {
		c.ListenDB.Close()
	}
}
