package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // pgx driver for database/sql — kills Bug E class (P2-#8)
	"github.com/lib/pq"                 // still used for pq.NewListener (LISTEN/NOTIFY)
)

// ApprovalCreatedEvent is the decoded payload from the 'approval_created'
// NOTIFY channel. Fields match the JSON keys emitted by migration 401's
// notify_approval_created() trigger.
type ApprovalCreatedEvent struct {
	ApprovalID string `json:"approval_id"`
	TenantID   string `json:"tenant_id"`
	Type       string `json:"type"`        // request_type enum value, e.g. "kasir_discount"
	Details    string `json:"details"`     // payload column cast to text (JSONB)
}

// OrderCreatedEvent is the decoded payload from the 'order_created' NOTIFY channel.
// Emitted by migration 422's notify_order_created() trigger on every orders INSERT.
// conversation_id may be empty for kasir/pesanan-admin orders (only Calista orders have one).
type OrderCreatedEvent struct {
	OrderID        string  `json:"order_id"`
	TenantID       string  `json:"tenant_id"`
	CustomerID     string  `json:"customer_id"`
	InvoiceNo      string  `json:"invoice_no"` // SUBSTR(id::text, -8)
	Amount         float64 `json:"amount"`     // total - piutang_paid_amount
	ConversationID string  `json:"conversation_id"` // may be empty
}

// OrderShippedEvent is the decoded payload from the 'order_shipped' NOTIFY channel.
// Emitted by migration 422's notify_order_shipped() trigger on transition to COMPLETED.
// NOTE: fires on COMPLETED (no SHIPPED status in this schema as of 2026-07-19).
// conversation_id may be empty for kasir/pesanan-admin orders.
type OrderShippedEvent struct {
	OrderID        string `json:"order_id"`
	TenantID       string `json:"tenant_id"`
	CustomerID     string `json:"customer_id"`
	InvoiceNo      string `json:"invoice_no"` // SUBSTR(id::text, -8)
	ConversationID string `json:"conversation_id"` // may be empty
}

type NotifyHandlers struct {
	OnAdminMessage      func(conversationID, messageID string)
	OnOrderApproved     func(orderID, conversationID string, shippingFee float64)
	OnPaymentVerified   func(orderID, conversationID string)
	OnPaymentRejected   func(orderID, conversationID string)
	OnDPVerified        func(orderID, conversationID string)
	OnDPProofRejected   func(orderID, conversationID, reason string)
	OnApprovalCreated   func(evt ApprovalCreatedEvent)  // B1 fix (Task 1.8)
	OnOrderCreated      func(evt OrderCreatedEvent)     // Sprint 3 Task 3.2
	OnOrderShipped      func(evt OrderShippedEvent)     // Sprint 3 Task 3.2 (fires on COMPLETED)
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
	// P2-#8 pgx migration: use pgx driver with simple_protocol exec mode.
	// This kills Bug E class ("pq: unnamed prepared statement does not exist")
	// permanently — pgx in simple_protocol mode doesn't use extended-protocol
	// prepared statements, so parameterised queries survive Supavisor
	// transaction pooler rebinding between server connections.
	//
	// Append default_query_exec_mode=simple_protocol to the connection URL if
	// not already present. Works for both libpq keyword-value strings and URL
	// forms (pgx parses both). We add via URL query param for maximum
	// compatibility with the pgx URL parser.
	pgxConn := addPgxExecMode(queryConn)

	query, err := sql.Open("pgx", pgxConn)
	if err != nil {
		return nil, err
	}
	// pgx + txn pooler with simple_protocol: safe to run higher MaxOpenConns
	// because Supavisor multiplexes hundreds of client conns onto a small
	// number of server conns. 50 gives headroom for 10-tenant burst load.
	query.SetMaxOpenConns(50)
	query.SetMaxIdleConns(10)
	query.SetConnMaxLifetime(5 * time.Minute)
	if err := query.Ping(); err != nil {
		query.Close()
		return nil, fmt.Errorf("db: query pool ping failed: %w", err)
	}

	// Listener pool init is now NON-BLOCKING for readiness. If the direct
	// pool (:5432) is exhausted at startup (recurring incident 2026-07-22 —
	// zombie conns from prior revisions eat all non-superuser slots), the
	// readiness probe would never pass and Cloud Run would abort the deploy.
	// This blocked the very fix that would reduce future zombie count.
	//
	// New behaviour: query pool ping (above) blocks readiness. Listener pool
	// + pq.Listener attempt once; on failure they retry in a background
	// goroutine so BE can serve HTTP + accept traffic. LISTEN/NOTIFY work
	// once slots free (usually within minutes as old revisions drain).
	//
	// A nil listener/ListenDB pair is safe: StartListening() checks for nil
	// and returns early with a warning; jobs.Worker checks for nil ListenDB
	// and disables the NOTIFY-driven job trigger (poll-only fallback).
	listen, err := sql.Open("postgres", listenConn)
	if err != nil {
		query.Close()
		return nil, err
	}
	listen.SetMaxOpenConns(2)
	listen.SetMaxIdleConns(1)
	listen.SetConnMaxLifetime(0)

	client := &Client{DB: query, ListenDB: listen}

	if err := listen.Ping(); err != nil {
		slog.Warn("[DB] listener pool ping failed at startup — retrying in background", slog.String("error", err.Error()))
		go client.retryListenerInit(listenConn)
	} else {
		client.listener = pq.NewListener(listenConn, 10*time.Second, time.Minute,
			func(ev pq.ListenerEventType, err error) {
				if err != nil {
					slog.Error("[DB] Listener event error", slog.String("error", err.Error()))
				}
			})
		slog.Info("[DB] Connected — queries via txn pooler, listener via direct")
	}

	return client, nil
}

// retryListenerInit runs in a goroutine after NewClient returns. It keeps
// trying to establish the listener pool + pq.Listener until success, then
// assigns client.listener so subsequent StartListening() calls work.
// Callers that already ran StartListening with a nil listener must re-call
// once client.listener != nil (or accept that LISTEN/NOTIFY is degraded).
func (c *Client) retryListenerInit(listenConn string) {
	for attempt := 1; ; attempt++ {
		time.Sleep(30 * time.Second)
		if err := c.ListenDB.Ping(); err != nil {
			if attempt%10 == 0 {
				slog.Warn("[DB] listener pool still unreachable", slog.Int("attempt", attempt), slog.String("error", err.Error()))
			}
			continue
		}
		c.listener = pq.NewListener(listenConn, 10*time.Second, time.Minute,
			func(ev pq.ListenerEventType, err error) {
				if err != nil {
					slog.Error("[DB] Listener event error", slog.String("error", err.Error()))
				}
			})
		slog.Info("[DB] Listener pool recovered", slog.Int("attempt", attempt))
		return
	}
}

// NewClientWithoutListener returns a *Client with only the query SQL connection
// initialised. Used by integration tests where the LISTEN/NOTIFY plumbing is
// irrelevant and slow to set up.
func NewClientWithoutListener(connStr string) (*Client, error) {
	db, err := sql.Open("pgx", addPgxExecMode(connStr))
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

// addPgxExecMode appends default_query_exec_mode=simple_protocol to the
// connection string so pgx uses simple query protocol (Bug E fix).
// Handles both URL-form ("postgres://...") and libpq keyword-value form.
func addPgxExecMode(conn string) string {
	const mode = "default_query_exec_mode=simple_protocol"
	if strings.Contains(conn, mode) {
		return conn
	}
	if strings.HasPrefix(conn, "postgres://") || strings.HasPrefix(conn, "postgresql://") {
		sep := "?"
		if strings.Contains(conn, "?") {
			sep = "&"
		}
		return conn + sep + mode
	}
	// libpq keyword-value form: append as space-separated kv
	if strings.TrimSpace(conn) == "" {
		return mode
	}
	return conn + " " + mode
}

// StartListening subscribes to Postgres NOTIFY channels and dispatches to handlers.
// Call once at startup; runs until the client is closed.
//
// If c.listener is nil (listener pool ping failed at NewClient time and is
// still retrying in the background — see retryListenerInit), this is a no-op
// warning. Notifications are degraded until the pool recovers; callers relying
// on NOTIFY must fall back to polling until then.
func (c *Client) StartListening(h NotifyHandlers) error {
	if c.listener == nil {
		slog.Warn("[DB] listener not ready — will subscribe once retryListenerInit succeeds")
		go c.waitAndSubscribe(h)
		return nil
	}
	return c.subscribeAndDispatch(h)
}

// waitAndSubscribe polls until c.listener is non-nil (retryListenerInit
// completes), then subscribes channels + starts dispatch. Runs in a
// goroutine spawned by StartListening when the initial listener was nil.
func (c *Client) waitAndSubscribe(h NotifyHandlers) {
	for {
		time.Sleep(15 * time.Second)
		if c.listener != nil {
			if err := c.subscribeAndDispatch(h); err != nil {
				slog.Error("[DB] delayed subscribe failed", slog.String("error", err.Error()))
				return
			}
			slog.Info("[DB] LISTEN/NOTIFY subscribed after delayed listener init")
			return
		}
	}
}

// subscribeAndDispatch is the original StartListening body: iterate channels,
// Listen(), then start the dispatch goroutine. Extracted so waitAndSubscribe
// can re-run it once the listener recovers.
func (c *Client) subscribeAndDispatch(h NotifyHandlers) error {
	channels := []string{"admin_messages", "order_approved", "payment_verified", "payment_rejected", "dp_verified", "dp_proof_rejected", "approval_created", "order_created", "order_shipped"}
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
					slog.Error("[DB] admin_messages parse error", slog.String("error", err.Error()))
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
					slog.Error("[DB] order_approved parse error", slog.String("error", err.Error()))
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
					slog.Error("[DB] payment_verified parse error", slog.String("error", err.Error()))
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
					slog.Error("[DB] payment_rejected parse error", slog.String("error", err.Error()))
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
					slog.Error("[DB] dp_verified parse error", slog.String("error", err.Error()))
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
					slog.Error("[DB] dp_proof_rejected parse error", slog.String("error", err.Error()))
					continue
				}
				if h.OnDPProofRejected != nil {
					go h.OnDPProofRejected(p.OrderID, p.ConversationID, p.Reason)
				}

			case "approval_created":
				// B1 fix (Task 1.8): broadcast approval WA card to owner-role recipients.
				var evt ApprovalCreatedEvent
				if err := json.Unmarshal([]byte(notification.Extra), &evt); err != nil {
					slog.Error("[DB] approval_created parse error", slog.String("error", err.Error()))
					continue
				}
				if h.OnApprovalCreated != nil {
					go h.OnApprovalCreated(evt)
				}

			case "order_created":
				// Sprint 3 Task 3.2: send WA confirmation to customer on every order INSERT.
				var evt OrderCreatedEvent
				if err := json.Unmarshal([]byte(notification.Extra), &evt); err != nil {
					slog.Error("[DB] order_created parse error", slog.String("error", err.Error()))
					continue
				}
				if h.OnOrderCreated != nil {
					go h.OnOrderCreated(evt)
				}

			case "order_shipped":
				// Sprint 3 Task 3.2: send WA notification when order transitions to COMPLETED.
				var evt OrderShippedEvent
				if err := json.Unmarshal([]byte(notification.Extra), &evt); err != nil {
					slog.Error("[DB] order_shipped parse error", slog.String("error", err.Error()))
					continue
				}
				if h.OnOrderShipped != nil {
					go h.OnOrderShipped(evt)
				}
			}
		}
	}()

	slog.Info("[DB] LISTEN/NOTIFY active on admin_messages, order_approved, payment_verified, payment_rejected, dp_verified, dp_proof_rejected, approval_created, order_created, order_shipped")
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
