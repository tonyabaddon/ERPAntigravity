package feedback

import (
	"context"
	"database/sql"
	"log/slog"
	"strconv"
	"strings"
)

// PendingOrder holds the order context for a customer awaiting feedback.
type PendingOrder struct {
	OrderID    string
	TenantID   string
	CustomerID string
}

// LookupPendingFeedback queries for the most recent COMPLETED order from the
// given customer phone that has been sent a feedback request but has not yet
// received a response. Returns (order, true, nil) if found.
//
// A pending window of 14 days is used: if the customer doesn't reply within 2
// weeks of the request being sent, their response is no longer captured.
func LookupPendingFeedback(ctx context.Context, db *sql.DB, customerPhone string) (PendingOrder, bool, error) {
	var o PendingOrder
	err := db.QueryRowContext(ctx, `
		SELECT o.id::TEXT, o.tenant_id::TEXT, COALESCE(o.customer_id, '')
		FROM public.orders o
		WHERE (o.customer_phone = $1
		       OR EXISTS (
		           SELECT 1 FROM public.customers c
		           WHERE c.wa_number = $1 AND c.id::TEXT = o.customer_id
		       ))
		  AND o.feedback_requested_at IS NOT NULL
		  AND o.feedback_requested_at > NOW() - INTERVAL '14 days'
		  AND o.status = 'COMPLETED'
		  AND NOT EXISTS (
		      SELECT 1 FROM public.customer_feedback cf WHERE cf.order_id = o.id
		  )
		ORDER BY o.feedback_requested_at DESC
		LIMIT 1
	`, customerPhone).Scan(&o.OrderID, &o.TenantID, &o.CustomerID)
	if err == sql.ErrNoRows {
		return PendingOrder{}, false, nil
	}
	if err != nil {
		return PendingOrder{}, false, err
	}
	return o, true, nil
}

// HandleFeedbackResponse parses the inbound message body for a rating 1-5 +
// optional comment and inserts a customer_feedback row. Returns (true, nil) if
// a rating was captured, (false, nil) if the message doesn't start with 1-5,
// or (false, err) on a DB error.
//
// Message format expected: "<digit> [optional comment text]"
// Examples: "5", "4 pengiriman cepat", "3 barang kurang sesuai deskripsi"
func HandleFeedbackResponse(ctx context.Context, db *sql.DB, order PendingOrder, msgBody string) (bool, error) {
	trimmed := strings.TrimSpace(msgBody)
	if len(trimmed) == 0 {
		return false, nil
	}

	rating, err := strconv.Atoi(trimmed[0:1])
	if err != nil || rating < 1 || rating > 5 {
		return false, nil
	}

	comment := strings.TrimSpace(trimmed[1:])

	_, dbErr := db.ExecContext(ctx, `
		INSERT INTO public.customer_feedback (tenant_id, customer_id, order_id, rating, comment)
		VALUES ($1::UUID, $2, $3::UUID, $4, NULLIF($5, ''))
		ON CONFLICT (order_id) DO NOTHING
	`, order.TenantID, order.CustomerID, order.OrderID, rating, comment)
	if dbErr != nil {
		slog.ErrorContext(ctx, "[FEEDBACK] insert failed",
			slog.String("order_id", order.OrderID),
			slog.String("tenant_id", order.TenantID),
			slog.String("error", dbErr.Error()))
		return false, dbErr
	}

	slog.InfoContext(ctx, "[FEEDBACK] rating captured",
		slog.String("order_id", order.OrderID),
		slog.String("tenant_id", order.TenantID),
		slog.Int("rating", rating))
	return true, nil
}
