// Package approvals — SLABreachPoller fires every 15 minutes and alerts
// owner-role recipients when any approval_requests row has been in 'pending'
// status for more than 2 hours without a response.
// Sprint 4 Task 4.3. Uses BroadcastToStaff (Sprint 1 Task 1.4).
package approvals

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

// slaBreach15Min is the polling cadence — check every 15 minutes.
const slaBreach15Min = 15 * time.Minute

// slaThreshold is how long a pending approval must be stale before it fires.
const slaThreshold = 2 * time.Hour

// SLABreachPoller wakes every 15 minutes and sends a critical alert (bypasses
// quiet hours) to the owner role of each tenant that has one or more pending
// approval_requests older than 2 hours with sla_breach_notified_at IS NULL.
// After alerting, it stamps sla_breach_notified_at to prevent repeat alerts.
type SLABreachPoller struct {
	db       *sql.DB
	notifier *notification.Notifier
}

// NewSLABreachPoller returns a poller ready to start. Call Start(ctx) to launch.
func NewSLABreachPoller(db *sql.DB, n *notification.Notifier) *SLABreachPoller {
	return &SLABreachPoller{db: db, notifier: n}
}

// Start launches the 15-minute ticker goroutine.
// Stops when ctx is cancelled (process shutdown).
func (p *SLABreachPoller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(slaBreach15Min)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				p.runOnce(ctx)
			}
		}
	}()
}

// breachedRow holds one breached approval_request row.
type breachedRow struct {
	id          int64
	tenantID    string
	requestType string
	requestedAt time.Time
}

// runOnce finds all tenants with SLA-breached pending approvals, builds a
// summary message per tenant, broadcasts it, and stamps the dedup column.
func (p *SLABreachPoller) runOnce(ctx context.Context) {
	log := slog.Default().With("feature", "approval_sla_breach")
	log.InfoContext(ctx, "15-min tick — scanning for SLA-breached approvals")

	rows, err := p.db.QueryContext(ctx, `
		SELECT tenant_id, id, request_type, requested_at
		FROM public.approval_requests
		WHERE status = 'pending'
		  AND requested_at < NOW() - $1::INTERVAL
		  AND sla_breach_notified_at IS NULL
		ORDER BY tenant_id, requested_at ASC
	`, fmt.Sprintf("%d seconds", int(slaThreshold.Seconds())))
	if err != nil {
		log.ErrorContext(ctx, "breach query failed", slog.Any("error", err))
		return
	}
	defer rows.Close()

	// Group breached rows by tenant.
	tenantRows := make(map[string][]breachedRow)
	var order []string // preserve insertion order for deterministic processing
	for rows.Next() {
		var r breachedRow
		if err := rows.Scan(&r.tenantID, &r.id, &r.requestType, &r.requestedAt); err != nil {
			log.ErrorContext(ctx, "row scan failed", slog.Any("error", err))
			continue
		}
		if _, seen := tenantRows[r.tenantID]; !seen {
			order = append(order, r.tenantID)
		}
		tenantRows[r.tenantID] = append(tenantRows[r.tenantID], r)
	}
	if err := rows.Err(); err != nil {
		log.ErrorContext(ctx, "rows iteration error", slog.Any("error", err))
	}

	var broadcastCount, stampCount int

	for _, tenantID := range order {
		breach := tenantRows[tenantID]
		totalCount := len(breach)

		// Build top_list: up to 3 stalest approvals.
		topN := breach
		if len(topN) > 3 {
			topN = topN[:3]
		}
		lines := make([]string, 0, len(topN))
		for _, r := range topN {
			ageMinutes := int(time.Since(r.requestedAt).Minutes())
			lines = append(lines, fmt.Sprintf("• %s — %d menit lalu", r.requestType, ageMinutes))
		}

		tmpl := templates.ApprovalSlaBreach{}
		msg, buildErr := tmpl.Build(ctx, map[string]any{
			"total_count": totalCount,
			"top_list":    strings.Join(lines, "\n"),
		})
		if buildErr != nil {
			log.ErrorContext(ctx, "template build failed",
				slog.String("tenant_id", tenantID),
				slog.Any("error", buildErr))
			continue
		}

		// Critical: bypasses quiet hours.
		sendErr := p.notifier.BroadcastToStaff(ctx, tenantID,
			notification.RecipientFilter{Role: "owner", CritLevel: "critical"},
			msg,
		)
		if sendErr != nil {
			log.ErrorContext(ctx, "broadcast failed",
				slog.String("tenant_id", tenantID),
				slog.Any("error", sendErr))
			// Still stamp the rows so we don't spam on next tick if WA is flaky.
			// Owner will see the breach on next login even if WA failed.
		} else {
			broadcastCount++
			log.InfoContext(ctx, "SLA breach alert sent",
				slog.String("tenant_id", tenantID),
				slog.Int("total_count", totalCount))
		}

		// Collect IDs to stamp.
		ids := make([]int64, len(breach))
		for i, r := range breach {
			ids[i] = r.id
		}
		if stamped := p.stampBreached(ctx, ids); stamped > 0 {
			stampCount += stamped
		}
	}

	log.InfoContext(ctx, "tick done",
		slog.Int("tenants_alerted", broadcastCount),
		slog.Int("rows_stamped", stampCount))
}

// stampBreached sets sla_breach_notified_at = NOW() for all given IDs.
// Returns the number of rows actually updated.
func (p *SLABreachPoller) stampBreached(ctx context.Context, ids []int64) int {
	if len(ids) == 0 {
		return 0
	}

	// Build $1,$2,... placeholder list.
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		"UPDATE public.approval_requests SET sla_breach_notified_at = NOW() WHERE id IN (%s) AND sla_breach_notified_at IS NULL",
		strings.Join(placeholders, ","),
	)
	res, err := p.db.ExecContext(ctx, query, args...)
	if err != nil {
		slog.Default().ErrorContext(ctx, "stamp sla_breach_notified_at failed",
			slog.Any("error", err))
		return 0
	}
	n, _ := res.RowsAffected()
	return int(n)
}
