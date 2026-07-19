// Package testapi provides HTTP endpoints for E2E test automation.
//
// ALL handlers in this package are gated behind the E2E_TEST_MODE=true
// environment variable. They are NEVER registered in production builds.
//
// Registration (in main.go, after mux is constructed):
//
//	if os.Getenv("E2E_TEST_MODE") == "true" {
//	    testapi.Register(mux, dbClient)
//	}
package testapi

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Handler holds the database handle and the WA number ID used as the tenant
// surrogate in single-tenant mode.
type Handler struct {
	db         *sql.DB
	waNumberID string
}

// NewHandler creates a Handler. waNumberID defaults to "wa_1" if empty —
// matching the main.go default (os.Getenv("WA_NUMBER_ID") fallback).
func NewHandler(db *sql.DB, waNumberID string) *Handler {
	if waNumberID == "" {
		waNumberID = "wa_1"
	}
	return &Handler{db: db, waNumberID: waNumberID}
}

// Register mounts all test endpoints on mux.
// Call this ONLY when E2E_TEST_MODE=true.
func Register(mux *http.ServeMux, db *sql.DB, waNumberID string) {
	h := NewHandler(db, waNumberID)
	mux.HandleFunc("/api/test/simulate-inbound", h.SimulateInbound)
	mux.HandleFunc("/api/test/messages", h.QueryMessages)
	mux.HandleFunc("/api/test/create-approval-request", h.CreateApprovalRequest)
	mux.HandleFunc("/api/test/create-low-confidence-scenario", h.CreateLowConfidenceScenario)
	mux.HandleFunc("/api/test/simulate-silent-customer", h.SimulateSilentCustomer)
	mux.HandleFunc("/api/test/simulate-booking-with-24h-expiry", h.SimulateBookingWith24hExpiry)
	mux.HandleFunc("/api/test/fire-lifecycle-event", h.FireLifecycleEvent)
	mux.HandleFunc("/api/test/simulate-admin-forward", h.SimulateAdminForward)
	slog.Warn("[TESTAPI] E2E test endpoints registered — DO NOT use in production",
		slog.Int("endpoint_count", 8))
}

// ── helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ── Path A: Calista AI reply ──────────────────────────────────────────────────

// SimulateInbound inserts a customer message into the messages table for the
// given customerPhone, creating a conversation row if one does not exist.
// This triggers the normal Calista processing path asynchronously via the
// existing LISTEN/NOTIFY handler — the E2E test then polls QueryMessages to
// observe the AI outbound reply.
//
// POST /api/test/simulate-inbound
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777", "body": "..."}
func (h *Handler) SimulateInbound(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
		Body          string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" || req.Body == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone and body are required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()

	// Get or create conversation for this phone + tenant.
	var convID string
	err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID)
	if err == sql.ErrNoRows {
		err = h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
			VALUES ($1, $2, 'GREETING', 'id', '{}', 0)
			RETURNING id
		`, req.TenantID, req.CustomerPhone).Scan(&convID)
	}
	if err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] SimulateInbound: conversation lookup/create failed",
			slog.String("phone", req.CustomerPhone), slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "conversation error: "+err.Error())
		return
	}

	// Insert inbound customer message into messages table.
	var msgID string
	err = h.db.QueryRowContext(ctx, `
		INSERT INTO messages (conversation_id, sender, text)
		VALUES ($1, 'customer', $2)
		RETURNING id
	`, convID, req.Body).Scan(&msgID)
	if err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] SimulateInbound: insert message failed",
			slog.String("conv_id", convID), slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "insert message error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] SimulateInbound: customer message inserted",
		slog.String("conv_id", convID),
		slog.String("msg_id", msgID),
		slog.String("phone", req.CustomerPhone))
	writeJSON(w, http.StatusOK, map[string]string{
		"status":          "ok",
		"conversation_id": convID,
		"message_id":      msgID,
	})
}

// ── Query messages audit ──────────────────────────────────────────────────────

// MessageRow is the JSON shape returned by QueryMessages.
// direction is "INBOUND" for customer sender, "OUTBOUND" for ai/admin/system.
type MessageRow struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Sender         string    `json:"sender"`
	Direction      string    `json:"direction"`
	Text           string    `json:"text"`
	CreatedAt      time.Time `json:"created_at"`
}

// QueryMessages returns messages for a tenant + customerPhone, newest last.
// Limited to 50 rows to keep response size bounded.
//
// GET /api/test/messages?tenantID=wa_1&customerPhone=628999888777
func (h *Handler) QueryMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errJSON(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	tenantID := r.URL.Query().Get("tenantID")
	customerPhone := r.URL.Query().Get("customerPhone")
	if tenantID == "" {
		tenantID = h.waNumberID
	}
	if customerPhone == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone is required")
		return
	}

	ctx := r.Context()
	rows, err := h.db.QueryContext(ctx, `
		SELECT m.id, m.conversation_id, m.sender::text, m.text, m.created_at
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		WHERE c.customer_phone = $1 AND c.wa_number_id = $2
		ORDER BY m.created_at ASC
		LIMIT 50
	`, customerPhone, tenantID)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "query error: "+err.Error())
		return
	}
	defer rows.Close()

	var result []MessageRow
	for rows.Next() {
		var mr MessageRow
		if err := rows.Scan(&mr.ID, &mr.ConversationID, &mr.Sender, &mr.Text, &mr.CreatedAt); err != nil {
			continue
		}
		// Derive direction from sender.
		switch mr.Sender {
		case "customer":
			mr.Direction = "INBOUND"
		default:
			mr.Direction = "OUTBOUND"
		}
		result = append(result, mr)
	}
	if result == nil {
		result = []MessageRow{} // always return array, never null
	}
	writeJSON(w, http.StatusOK, result)
}

// ── Path C: Approval WA card ──────────────────────────────────────────────────

// CreateApprovalRequest inserts a row into public.approval_requests with
// status='pending'. The notify_approval_created() trigger fires pg_notify →
// main.go OnApprovalCreated → approval card sent to owner WA.
//
// POST /api/test/create-approval-request
// Body: {"tenantID": "wa_1", "requestType": "kasir_discount", "details": "10%"}
func (h *Handler) CreateApprovalRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID    string `json:"tenantID"`
		RequestType string `json:"requestType"`
		Details     string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.RequestType == "" {
		req.RequestType = "kasir_discount"
	}
	if req.Details == "" {
		req.Details = "10%"
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()

	// Look up the first user ID (for requested_by). Fallback to a nil UUID
	// represented as '00000000-0000-0000-0000-000000000000'.
	var requestedBy string
	if err := h.db.QueryRowContext(ctx,
		`SELECT id FROM auth.users LIMIT 1`).Scan(&requestedBy); err != nil {
		requestedBy = "00000000-0000-0000-0000-000000000000"
	}

	payload := fmt.Sprintf(`{"details": %q}`, req.Details)
	var approvalID int64
	err := h.db.QueryRowContext(ctx, `
		INSERT INTO public.approval_requests
		    (request_type, payload, requested_by, expires_at, status)
		VALUES ($1::approval_request_type, $2::jsonb, $3::uuid, NOW() + INTERVAL '2 hours', 'pending')
		RETURNING id
	`, req.RequestType, payload, requestedBy).Scan(&approvalID)
	if err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] CreateApprovalRequest: insert failed", slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "insert error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] CreateApprovalRequest: inserted",
		slog.Int64("approval_id", approvalID),
		slog.String("request_type", req.RequestType))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"approval_id": approvalID,
	})
}

// ── Path B: Staff escalation (low-confidence scenario) ───────────────────────

// CreateLowConfidenceScenario flips ai_active=false on the most recent
// conversation for customerPhone, simulating the state where Calista has
// handed off to staff. The notification for escalation is sent by the
// existing handler when ai_active transitions to false.
//
// POST /api/test/create-low-confidence-scenario
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777"}
func (h *Handler) CreateLowConfidenceScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone is required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()

	// Upsert: get-or-create conversation, then set ai_active=false + ESCALATED_ADMIN state.
	var convID string
	if err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID); err == sql.ErrNoRows {
		if err2 := h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round, ai_active)
			VALUES ($1, $2, 'ESCALATED_ADMIN', 'id', '{}', 0, false)
			RETURNING id
		`, req.TenantID, req.CustomerPhone).Scan(&convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "create conv error: "+err2.Error())
			return
		}
	} else if err == nil {
		if _, err2 := h.db.ExecContext(ctx, `
			UPDATE conversations SET ai_active = false, state = 'ESCALATED_ADMIN', updated_at = NOW()
			WHERE id = $1
		`, convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "update conv error: "+err2.Error())
			return
		}
	} else {
		errJSON(w, http.StatusInternalServerError, "lookup error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] CreateLowConfidenceScenario: conversation escalated",
		slog.String("conv_id", convID), slog.String("phone", req.CustomerPhone))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "conversation_id": convID})
}

// ── Path D: Silent customer follow-up ────────────────────────────────────────

// SimulateSilentCustomer backdates last_ai_message_at to 8 days ago so the
// follow-up poller (which checks >4h) will pick up the conversation on its
// next 1-minute tick. The E2E test then polls QueryMessages for the outbound
// follow-up message.
//
// POST /api/test/simulate-silent-customer
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777"}
func (h *Handler) SimulateSilentCustomer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone is required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()
	backdatedAt := time.Now().Add(-8 * 24 * time.Hour)

	// Ensure conversation exists with ai_active=true and a backdated last_ai_message_at.
	var convID string
	if err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED','ESCALATED_ADMIN','ESCALATED_WIRING')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID); err == sql.ErrNoRows {
		if err2 := h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round, ai_active, last_ai_message_at)
			VALUES ($1, $2, 'GREETING', 'id', '{}', 0, true, $3)
			RETURNING id
		`, req.TenantID, req.CustomerPhone, backdatedAt).Scan(&convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "create conv error: "+err2.Error())
			return
		}
	} else if err == nil {
		if _, err2 := h.db.ExecContext(ctx, `
			UPDATE conversations SET
				ai_active = true,
				last_ai_message_at = $1,
				followup_count_today = 0,
				last_followup_date = NULL,
				updated_at = NOW()
			WHERE id = $2
		`, backdatedAt, convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "update conv error: "+err2.Error())
			return
		}
	} else {
		errJSON(w, http.StatusInternalServerError, "lookup error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] SimulateSilentCustomer: backdated last_ai_message_at",
		slog.String("conv_id", convID), slog.Time("backdated_to", backdatedAt))
	writeJSON(w, http.StatusOK, map[string]string{
		"status":          "ok",
		"conversation_id": convID,
		"backdated_to":    backdatedAt.Format(time.RFC3339),
	})
}

// ── Path E: Booking expiry 24h reminder ──────────────────────────────────────

// SimulateBookingWith24hExpiry creates a BOOKED order whose booking_expires_at
// is 24h from now. The scheduler (which runs in-process) will fire the
// expiry reminder approximately on time. For E2E purposes the test polls for
// the outbound reminder message within 90s.
//
// POST /api/test/simulate-booking-with-24h-expiry
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777"}
func (h *Handler) SimulateBookingWith24hExpiry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone is required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()
	expiresAt := time.Now().Add(24 * time.Hour)

	// Ensure conversation exists.
	var convID string
	if err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID); err != nil {
		// Create new conversation if none exists.
		if err2 := h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
			VALUES ($1, $2, 'BOOKED', 'id', '{}', 0)
			RETURNING id
		`, req.TenantID, req.CustomerPhone).Scan(&convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "create conv error: "+err2.Error())
			return
		}
	}

	// Insert a BOOKED order with a 24h expiry.
	var orderID string
	err := h.db.QueryRowContext(ctx, `
		INSERT INTO orders (
			tenant_id, conversation_id, customer_name, customer_company,
			customer_address, customer_phone, order_type, items, subtotal, total,
			status, booking_expires_at
		)
		VALUES (
			$1, $2, 'E2E Test Customer', 'E2E Corp',
			'Jl. Test No. 1', $3, 'STANDARD', '[]'::jsonb, 0, 0,
			'PENDING', $4
		)
		RETURNING id
	`, req.TenantID, convID, req.CustomerPhone, expiresAt).Scan(&orderID)
	if err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] SimulateBookingWith24hExpiry: insert order failed",
			slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "insert order error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] SimulateBookingWith24hExpiry: order created",
		slog.String("order_id", orderID), slog.Time("expires_at", expiresAt))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"order_id":   orderID,
		"expires_at": expiresAt.Format(time.RFC3339),
	})
}

// ── Path F: Lifecycle event ───────────────────────────────────────────────────

// FireLifecycleEvent triggers a payment/order lifecycle notification by
// emitting a pg_notify on the relevant channel. The main.go LISTEN/NOTIFY
// handlers pick these up and send the appropriate customer WA message.
//
// Supported event types (match NOTIFY channel names in main.go):
//   - payment_verified  → OnPaymentVerified
//   - dp_verified       → OnDPVerified
//   - payment_rejected  → OnPaymentRejected
//   - order_approved    → OnOrderApproved
//   - order_shipped     → OnOrderShipped (fires on COMPLETED status)
//
// POST /api/test/fire-lifecycle-event
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777", "eventType": "payment_verified"}
func (h *Handler) FireLifecycleEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
		EventType     string `json:"eventType"`
		OrderID       string `json:"orderID"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone is required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	validEvents := map[string]bool{
		"payment_verified": true,
		"dp_verified":      true,
		"payment_rejected": true,
		"order_approved":   true,
		"order_shipped":    true,
	}
	if !validEvents[req.EventType] {
		errJSON(w, http.StatusBadRequest, fmt.Sprintf(
			"eventType must be one of: payment_verified, dp_verified, payment_rejected, order_approved, order_shipped; got %q",
			req.EventType))
		return
	}

	ctx := r.Context()

	// Get or create a conversation + order to fire the event against.
	var convID string
	if err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID); err != nil {
		if err2 := h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
			VALUES ($1, $2, 'BOOKED', 'id', '{}', 0)
			RETURNING id
		`, req.TenantID, req.CustomerPhone).Scan(&convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "create conv error: "+err2.Error())
			return
		}
	}

	orderID := req.OrderID
	if orderID == "" {
		// Create a minimal order to carry the notification.
		if err := h.db.QueryRowContext(ctx, `
			INSERT INTO orders (
				tenant_id, conversation_id, customer_name, customer_company,
				customer_address, customer_phone, order_type, items, subtotal, total,
				status, booking_expires_at
			)
			VALUES (
				$1, $2, 'E2E Lifecycle Customer', 'E2E Corp',
				'Jl. Test No. 1', $3, 'STANDARD', '[]'::jsonb, 0, 0,
				'PENDING', NOW() + INTERVAL '24 hours'
			)
			RETURNING id
		`, req.TenantID, convID, req.CustomerPhone).Scan(&orderID); err != nil {
			errJSON(w, http.StatusInternalServerError, "create order error: "+err.Error())
			return
		}
	}

	// Emit pg_notify on the channel matching the event type.
	// Payload shape must match what the main.go LISTEN handler expects.
	var payload string
	switch req.EventType {
	case "order_approved":
		payload = fmt.Sprintf(`{"order_id":%q,"conversation_id":%q,"shipping_fee":0}`, orderID, convID)
	case "order_shipped":
		payload = fmt.Sprintf(`{"order_id":%q,"tenant_id":%q,"conversation_id":%q,"invoice_no":"test","amount":0}`, orderID, req.TenantID, convID)
	default:
		payload = fmt.Sprintf(`{"order_id":%q,"conversation_id":%q}`, orderID, convID)
	}

	if _, err := h.db.ExecContext(ctx,
		`SELECT pg_notify($1, $2)`, req.EventType, payload); err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] FireLifecycleEvent: pg_notify failed",
			slog.String("event", req.EventType), slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "pg_notify error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] FireLifecycleEvent: notified",
		slog.String("event", req.EventType),
		slog.String("order_id", orderID))
	writeJSON(w, http.StatusOK, map[string]string{
		"status":   "ok",
		"event":    req.EventType,
		"order_id": orderID,
	})
}

// ── Path G: Admin forward ─────────────────────────────────────────────────────

// SimulateAdminForward inserts an admin-sender message into the messages table
// and emits a pg_notify on the 'admin_message' channel. The main.go
// OnAdminMessage handler forwards it to the customer's WA via NotifyCustomer.
//
// POST /api/test/simulate-admin-forward
// Body: {"tenantID": "wa_1", "customerPhone": "628999888777", "text": "Halo, ada yang bisa dibantu?"}
func (h *Handler) SimulateAdminForward(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errJSON(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req struct {
		TenantID      string `json:"tenantID"`
		CustomerPhone string `json:"customerPhone"`
		Text          string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errJSON(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.CustomerPhone == "" || req.Text == "" {
		errJSON(w, http.StatusBadRequest, "customerPhone and text are required")
		return
	}
	if req.TenantID == "" {
		req.TenantID = h.waNumberID
	}

	ctx := r.Context()

	// Get or create conversation.
	var convID string
	if err := h.db.QueryRowContext(ctx, `
		SELECT id FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, req.CustomerPhone, req.TenantID).Scan(&convID); err != nil {
		if err2 := h.db.QueryRowContext(ctx, `
			INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
			VALUES ($1, $2, 'ESCALATED_ADMIN', 'id', '{}', 0)
			RETURNING id
		`, req.TenantID, req.CustomerPhone).Scan(&convID); err2 != nil {
			errJSON(w, http.StatusInternalServerError, "create conv error: "+err2.Error())
			return
		}
	}

	// Insert admin message.
	var msgID string
	if err := h.db.QueryRowContext(ctx, `
		INSERT INTO messages (conversation_id, sender, text)
		VALUES ($1, 'admin', $2)
		RETURNING id
	`, convID, req.Text).Scan(&msgID); err != nil {
		errJSON(w, http.StatusInternalServerError, "insert message error: "+err.Error())
		return
	}

	// Emit pg_notify on 'admin_message' channel — same shape as the Supabase
	// trigger (notify_admin_message) that fires on messages INSERT for admin sender.
	payload := fmt.Sprintf(`{"conversation_id":%q,"message_id":%q}`, convID, msgID)
	if _, err := h.db.ExecContext(ctx,
		`SELECT pg_notify('admin_message', $1)`, payload); err != nil {
		slog.ErrorContext(ctx, "[TESTAPI] SimulateAdminForward: pg_notify failed",
			slog.Any("error", err))
		errJSON(w, http.StatusInternalServerError, "pg_notify error: "+err.Error())
		return
	}

	slog.Info("[TESTAPI] SimulateAdminForward: admin message inserted + notified",
		slog.String("conv_id", convID), slog.String("msg_id", msgID))
	writeJSON(w, http.StatusOK, map[string]string{
		"status":          "ok",
		"conversation_id": convID,
		"message_id":      msgID,
	})
}
