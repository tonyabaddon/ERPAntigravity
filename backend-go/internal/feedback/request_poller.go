// Package feedback provides post-order feedback request (daily poller) and
// inbound rating response capture. Sprint 4 Task 4.4.
package feedback

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
)

// RequestPoller fires daily at 10:00 WIB and sends each customer a post-order
// feedback request 7 days after their order reaches COMPLETED status. One WA
// per eligible order; orders.feedback_requested_at is stamped after send to
// prevent duplicate sends. Uses NotifyCustomer (quota-checked, audit-trail).
type RequestPoller struct {
	db       *sql.DB
	notifier *notification.Notifier
	tz       *time.Location // Asia/Jakarta (WIB)
}

// NewRequestPoller returns a RequestPoller. Call Start(ctx) to launch.
func NewRequestPoller(db *sql.DB, n *notification.Notifier) *RequestPoller {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	return &RequestPoller{db: db, notifier: n, tz: tz}
}

// Start launches the 10:00 WIB daily cron goroutine.
// Stops when ctx is cancelled (process shutdown).
func (p *RequestPoller) Start(ctx context.Context) {
	go func() {
		for {
			next := nextDailyFeedbackTarget(time.Now().In(p.tz), 10, 0)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Until(next)):
				p.runOnce(ctx)
			}
		}
	}()
}

// runOnce queries for COMPLETED orders exactly 7 days old (by updated_at)
// without a feedback_requested_at, sends the PostOrderFeedback template, then
// marks feedback_requested_at. One send per eligible order.
func (p *RequestPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "post_order_feedback_request")
	log.InfoContext(ctx, "cron tick — scanning orders for feedback requests")

	// Join orders → customers → tenants to get all params in one pass.
	// Filters: status=COMPLETED, updated_at exactly 7 days ago, no prior
	// feedback_requested_at, customer has a wa_number.
	// updated_at is used as a proxy for completion timestamp — no delivered_at column.
	rows, err := p.db.QueryContext(ctx, `
		SELECT
		  o.id           AS order_id,
		  o.tenant_id,
		  o.customer_id,
		  COALESCE(c.name, o.customer_name, 'Pelanggan') AS customer_nama,
		  COALESCE(t.name, 'Toko')                       AS toko_nama,
		  COALESCE(c.wa_number, o.customer_phone)        AS wa_number,
		  SUBSTR(o.id::TEXT, -8)                         AS invoice_ref
		FROM public.orders o
		JOIN public.tenants t ON t.id = o.tenant_id
		LEFT JOIN public.customers c
		  ON c.id::TEXT = o.customer_id AND c.tenant_id = o.tenant_id
		WHERE o.status = 'COMPLETED'
		  AND DATE(o.updated_at) = CURRENT_DATE - INTERVAL '7 days'
		  AND o.feedback_requested_at IS NULL
		  AND COALESCE(c.wa_number, o.customer_phone) IS NOT NULL
		ORDER BY o.tenant_id, o.updated_at
	`)
	if err != nil {
		log.ErrorContext(ctx, "query failed", slog.Any("error", err))
		return
	}
	defer rows.Close()

	var sentCount, failedCount, skippedCount int

	for rows.Next() {
		var orderID, tenantID, customerID, customerNama, tokoNama, waNumber, invoiceRef string
		if err := rows.Scan(&orderID, &tenantID, &customerID, &customerNama, &tokoNama, &waNumber, &invoiceRef); err != nil {
			log.ErrorContext(ctx, "row scan failed", slog.Any("error", err))
			continue
		}

		tmpl := templates.PostOrderFeedback{}
		msg, buildErr := tmpl.Build(ctx, map[string]any{
			"customer_nama": customerNama,
			"toko_nama":     tokoNama,
		})
		if buildErr != nil {
			log.ErrorContext(ctx, "template build failed",
				slog.String("order_id", orderID),
				slog.Any("error", buildErr))
			failedCount++
			continue
		}

		// convID="" per Task 3.2 fix — kasir orders have no conv_id.
		sendErr := p.notifier.NotifyCustomer(ctx, tenantID, "", waNumber, "id", msg)
		switch {
		case sendErr == nil:
			if stampErr := p.stampRequested(ctx, orderID); stampErr != nil {
				log.ErrorContext(ctx, "stamp feedback_requested_at failed",
					slog.String("order_id", orderID),
					slog.Any("error", stampErr))
			}
			sentCount++
			log.InfoContext(ctx, "feedback request sent",
				slog.String("order_id", orderID),
				slog.String("tenant_id", tenantID),
				slog.String("invoice_ref", invoiceRef))

		case errors.Is(sendErr, notification.ErrQuotaExceeded):
			skippedCount++
			log.InfoContext(ctx, "feedback request skipped — quota",
				slog.String("order_id", orderID),
				slog.String("tenant_id", tenantID))

		case errors.Is(sendErr, notification.ErrWASessionOffline):
			skippedCount++
			log.WarnContext(ctx, "feedback request skipped — WA offline",
				slog.String("order_id", orderID),
				slog.String("tenant_id", tenantID),
				slog.Any("error", sendErr))

		default:
			failedCount++
			log.ErrorContext(ctx, "feedback request send failed",
				slog.String("order_id", orderID),
				slog.String("tenant_id", tenantID),
				slog.Any("error", sendErr))
		}
	}

	if err := rows.Err(); err != nil {
		log.ErrorContext(ctx, "rows iteration error", slog.Any("error", err))
	}

	log.InfoContext(ctx, "cron pass done",
		slog.Int("sent", sentCount),
		slog.Int("skipped_quota_offline", skippedCount),
		slog.Int("failed", failedCount))
}

// stampRequested marks the order so the poller never re-sends.
func (p *RequestPoller) stampRequested(ctx context.Context, orderID string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE public.orders SET feedback_requested_at = NOW() WHERE id = $1`,
		orderID,
	)
	return err
}

// nextDailyFeedbackTarget returns the next HH:MM occurrence in the given location.
// If today's HH:MM has already passed, returns tomorrow's.
func nextDailyFeedbackTarget(now time.Time, hour, min int) time.Time {
	target := time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
	if !target.After(now) {
		target = target.AddDate(0, 0, 1)
	}
	return target
}
