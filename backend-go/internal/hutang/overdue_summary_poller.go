// Package hutang — OverdueSummaryPoller fires daily at 07:30 WIB and sends
// each tenant's owner(s) a summary of supplier invoices due this week.
// Sprint 4 Task 4.2. Uses BroadcastToStaff (Sprint 1 Task 1.4).
package hutang

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

// OverdueSummaryPoller sends a daily 07:30 WIB hutang summary to the owner
// role of each tenant that has supplier invoices due within the next 7 days
// (status IN ('BELUM_LUNAS', 'DIBAYAR_SEBAGIAN') and
// payment_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 days) and has
// tenant_notification_cron_config.hutang_summary_enabled = TRUE (or no config
// row, defaulting to enabled via COALESCE).
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

// Start launches the 07:30 WIB daily cron goroutine.
// Stops when ctx is cancelled (process shutdown).
func (p *OverdueSummaryPoller) Start(ctx context.Context) {
	go func() {
		for {
			next := nextDailyTarget(time.Now().In(p.tz), 7, 30)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Until(next)):
				p.runOnce(ctx)
			}
		}
	}()
}

// runOnce aggregates supplier invoices due this week per tenant and broadcasts
// to each tenant's owner recipients. One BroadcastToStaff call per tenant.
func (p *OverdueSummaryPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "hutang_overdue_summary")
	log.InfoContext(ctx, "cron tick — aggregating hutang due this week by tenant")

	// Aggregate per-tenant: count + total unpaid amount due this week.
	// purchase_invoices uses payment_due_at (date) as the due date column.
	// amount_due = total - paid_amount (no separate amount_due column).
	// Gates on tenant_notification_cron_config.hutang_summary_enabled (COALESCE TRUE
	// for tenants without a config row — fail-open so new tenants still get notifs).
	rows, err := p.db.QueryContext(ctx, `
		SELECT
		  pi.tenant_id,
		  COUNT(*)                                                                AS total_count,
		  SUM(COALESCE(pi.total, 0) - COALESCE(pi.paid_amount, 0))::BIGINT       AS total_amount
		FROM public.purchase_invoices pi
		LEFT JOIN public.tenant_notification_cron_config cfg ON cfg.tenant_id = pi.tenant_id
		WHERE pi.status IN ('BELUM_LUNAS', 'DIBAYAR_SEBAGIAN')
		  AND pi.payment_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
		  AND pi.voided_at IS NULL
		  AND COALESCE(cfg.hutang_summary_enabled, TRUE) = TRUE
		GROUP BY pi.tenant_id
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

		topLines := p.fetchTopDue(ctx, tenantID)

		tmpl := templates.HutangOverdueSummary{}
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
			log.InfoContext(ctx, "hutang summary sent",
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

// fetchTopDue returns up to 3 formatted lines for the soonest-due supplier
// invoices in the given tenant. Each line: "• {supplier} — Rp {amount} — {date}".
func (p *OverdueSummaryPoller) fetchTopDue(ctx context.Context, tenantID string) []string {
	rows, err := p.db.QueryContext(ctx, `
		SELECT
		  COALESCE(s.name, 'Supplier'),
		  (COALESCE(pi.total, 0) - COALESCE(pi.paid_amount, 0))::BIGINT AS amount_due,
		  pi.payment_due_at
		FROM public.purchase_invoices pi
		LEFT JOIN public.suppliers s ON s.id = pi.supplier_id AND s.tenant_id = pi.tenant_id
		WHERE pi.tenant_id = $1
		  AND pi.status IN ('BELUM_LUNAS', 'DIBAYAR_SEBAGIAN')
		  AND pi.payment_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
		  AND pi.voided_at IS NULL
		ORDER BY pi.payment_due_at ASC
		LIMIT 3
	`, tenantID)
	if err != nil {
		slog.Default().ErrorContext(ctx, "fetchTopDue query failed",
			slog.String("tenant_id", tenantID),
			slog.String("error", err.Error()))
		return nil
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		var amt int64
		var dueDate time.Time
		if err := rows.Scan(&name, &amt, &dueDate); err != nil {
			continue
		}
		out = append(out, fmt.Sprintf("• %s — Rp %s — %s", name, formatRp(amt), dueDate.Format("2 Jan")))
	}
	return out
}

// nextDailyTarget returns the next occurrence of HH:MM in the given timezone.
// If today's HH:MM has already passed, returns tomorrow's.
func nextDailyTarget(now time.Time, hour, min int) time.Time {
	target := time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, now.Location())
	if !target.After(now) {
		target = target.AddDate(0, 0, 1)
	}
	return target
}

// formatRp formats an int64 as Indonesian Rupiah with dot-separated thousands.
// e.g. 12500000 → "12.500.000"
func formatRp(n int64) string {
	s := fmt.Sprintf("%d", n)
	if n < 0 {
		return "-" + formatRp(-n)
	}
	// Insert dots every 3 digits from the right.
	result := make([]byte, 0, len(s)+len(s)/3)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			result = append(result, '.')
		}
		result = append(result, byte(c))
	}
	return string(result)
}
