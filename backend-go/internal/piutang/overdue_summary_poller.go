// Package piutang — OverdueSummaryPoller fires daily at 08:00 WIB and sends
// each tenant's owner(s) a summary of all overdue piutang invoices.
// Sprint 4 Task 4.1. Uses BroadcastToStaff (Sprint 1 Task 1.4).
package piutang

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
)

// OverdueSummaryPoller sends a daily 08:00 WIB piutang overdue summary to
// the owner role of each tenant that has overdue INVOICE_TEMPO orders and
// has tenant_wa_reminder_config.enabled = TRUE (or no config row, defaulting
// to enabled).
type OverdueSummaryPoller struct {
	db       *sql.DB
	notifier *notification.Notifier
	tz       *time.Location // Asia/Jakarta (WIB)
}

// NewOverdueSummaryPoller returns a poller. Call Start(ctx) to launch.
func NewOverdueSummaryPoller(db *sql.DB, n *notification.Notifier) *OverdueSummaryPoller {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	return &OverdueSummaryPoller{db: db, notifier: n, tz: tz}
}

// Start launches the 08:00 WIB daily cron goroutine.
// Stops when ctx is cancelled (process shutdown).
func (p *OverdueSummaryPoller) Start(ctx context.Context) {
	go func() {
		for {
			next := nextDailyTarget(time.Now().In(p.tz), 8, 0)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Until(next)):
				p.runOnce(ctx)
			}
		}
	}()
}

// runOnce aggregates overdue invoices per tenant and broadcasts to each
// tenant's owner recipients. One BroadcastToStaff call per tenant.
func (p *OverdueSummaryPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "piutang_overdue_summary")
	log.InfoContext(ctx, "cron tick — aggregating overdue piutang by tenant")

	// Aggregate per-tenant: count + total overdue amount.
	// Uses INVOICE_TEMPO (not 'OPEN') per verified schema (2026-07-19).
	// amount_due = total - piutang_paid_amount (no .amount_due column on orders).
	rows, err := p.db.QueryContext(ctx, `
		SELECT
		  o.tenant_id,
		  COUNT(*)                                                              AS total_count,
		  SUM(COALESCE(o.total, 0) - COALESCE(o.piutang_paid_amount, 0))::BIGINT AS total_amount
		FROM public.orders o
		LEFT JOIN public.tenant_wa_reminder_config cfg ON cfg.tenant_id = o.tenant_id
		WHERE o.status = 'INVOICE_TEMPO'
		  AND o.payment_type IN ('tempo', 'kredit')
		  AND o.due_date < CURRENT_DATE
		  AND COALESCE(cfg.enabled, TRUE) = TRUE
		GROUP BY o.tenant_id
	`)
	if err != nil {
		log.ErrorContext(ctx, "aggregate query failed", slog.String("error", err.Error()))
		return
	}
	defer rows.Close()

	now := time.Now().In(p.tz)
	var broadcastCount, skipCount int

	for rows.Next() {
		var tenantID string
		var totalCount int
		var totalAmount int64
		if err := rows.Scan(&tenantID, &totalCount, &totalAmount); err != nil {
			log.ErrorContext(ctx, "row scan failed", slog.String("error", err.Error()))
			continue
		}
		if totalCount == 0 {
			skipCount++
			continue
		}

		topLines := p.fetchTopOverdue(ctx, tenantID)

		tmpl := templates.PiutangOverdueSummary{}
		msg, buildErr := tmpl.Build(ctx, map[string]any{
			"tanggal":      now.Format("2 Jan 2006"),
			"total_count":  totalCount,
			"total_amount": formatRp(totalAmount),
			"top_list":     strings.Join(topLines, "\n"),
		})
		if buildErr != nil {
			log.ErrorContext(ctx, "template build failed",
				slog.String("tenant_id", tenantID),
				slog.String("error", buildErr.Error()))
			continue
		}

		sendErr := p.notifier.BroadcastToStaff(ctx, tenantID,
			notification.RecipientFilter{Role: "owner", CritLevel: "normal"},
			msg,
		)
		if sendErr != nil {
			log.ErrorContext(ctx, "broadcast failed",
				slog.String("tenant_id", tenantID),
				slog.String("error", sendErr.Error()))
		} else {
			broadcastCount++
			log.InfoContext(ctx, "overdue summary sent",
				slog.String("tenant_id", tenantID),
				slog.Int("total_count", totalCount),
				slog.Int64("total_amount", totalAmount))
		}
	}

	if err := rows.Err(); err != nil {
		log.ErrorContext(ctx, "rows iteration error", slog.String("error", err.Error()))
	}

	log.InfoContext(ctx, "cron pass done",
		slog.Int("tenants_broadcast", broadcastCount),
		slog.Int("tenants_skipped_zero", skipCount))
}

// fetchTopOverdue returns up to 3 formatted lines for the longest-overdue
// invoices in the given tenant. Each line: "• {name} — Rp {amount} — H+{days}".
// Uses INVOICE_TEMPO and (total - piutang_paid_amount) per verified schema.
func (p *OverdueSummaryPoller) fetchTopOverdue(ctx context.Context, tenantID string) []string {
	rows, err := p.db.QueryContext(ctx, `
		SELECT
		  c.name,
		  (COALESCE(o.total, 0) - COALESCE(o.piutang_paid_amount, 0))::BIGINT AS amount_due,
		  (CURRENT_DATE - o.due_date)                                           AS days_overdue
		FROM public.orders o
		JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
		WHERE o.tenant_id = $1
		  AND o.status = 'INVOICE_TEMPO'
		  AND o.payment_type IN ('tempo', 'kredit')
		  AND o.due_date < CURRENT_DATE
		ORDER BY o.due_date ASC
		LIMIT 3
	`, tenantID)
	if err != nil {
		slog.Default().ErrorContext(ctx, "fetchTopOverdue query failed",
			slog.String("tenant_id", tenantID),
			slog.String("error", err.Error()))
		return nil
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		var amt int64
		var days int
		if err := rows.Scan(&name, &amt, &days); err != nil {
			continue
		}
		out = append(out, fmt.Sprintf("• %s — Rp %s — H+%d", name, formatRp(amt), days))
	}
	return out
}
