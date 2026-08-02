// backend-go/internal/notification/session_health.go
package notification

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// SessionHealthPoller polls WA session status for all Premium tenants every 5
// minutes. When a tenant's session has been continuously offline for >30 min
// and no alert was sent in the last hour, it sends an ops email via
// SendOpsEmail and records the alert timestamp.
//
// The sessionCheck func is injected so the poller stays decoupled from the
// whatsapp package. Pass a real client lookup or a stub for testing.
type SessionHealthPoller struct {
	db           *sql.DB
	sessionCheck func(tenantID string) bool
}

// NewSessionHealthPoller creates a poller backed by db.
// check(tenantID) must return true if the WA session for that tenant is
// currently connected, false otherwise.
func NewSessionHealthPoller(db *sql.DB, check func(tenantID string) bool) *SessionHealthPoller {
	return &SessionHealthPoller{db: db, sessionCheck: check}
}

// Start launches the 5-minute polling loop in a background goroutine.
// The goroutine exits when ctx is cancelled (e.g. on process shutdown).
// Also starts a daily pruning goroutine that deletes rows older than 30 days
// to keep the wa_session_health table bounded (was unbounded pre-F5).
func (s *SessionHealthPoller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runOnce(ctx)
			}
		}
	}()
	go func() {
		pruneTicker := time.NewTicker(24 * time.Hour)
		defer pruneTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-pruneTicker.C:
				s.prune(ctx)
			}
		}
	}()
}

// prune deletes wa_session_health rows older than 30 days. Runs daily.
func (s *SessionHealthPoller) prune(ctx context.Context) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM public.wa_session_health WHERE polled_at < NOW() - INTERVAL '30 days'`)
	if err != nil {
		slog.ErrorContext(ctx, "[session_health] prune failed", slog.String("error", err.Error()))
		return
	}
	n, _ := res.RowsAffected()
	slog.InfoContext(ctx, "[session_health] pruned old rows", slog.Int64("deleted", n))
}

// runOnce executes one polling cycle: for each Premium tenant, check the WA
// session state, persist it, and fire an alert if eligibility conditions met.
func (s *SessionHealthPoller) runOnce(ctx context.Context) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name
		FROM public.tenants t
		JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
		WHERE ts.plan_code = 'PREMIUM'
		  AND ts.grace_expires_at >= CURRENT_DATE
	`)
	if err != nil {
		slog.ErrorContext(ctx, "[session_health] query premium tenants failed", slog.String("error", err.Error()))
		return
	}
	defer rows.Close()

	for rows.Next() {
		var tenantID, tenantName string
		if err := rows.Scan(&tenantID, &tenantName); err != nil {
			slog.ErrorContext(ctx, "[session_health] scan row failed", slog.String("error", err.Error()))
			continue
		}
		s.checkTenant(ctx, tenantID, tenantName)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(ctx, "[session_health] rows iteration error", slog.String("error", err.Error()))
	}
}

func (s *SessionHealthPoller) checkTenant(ctx context.Context, tenantID, tenantName string) {
	connected := s.sessionCheck(tenantID)

	// Persist poll result. Ignore insert error — best-effort audit trail.
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO public.wa_session_health (tenant_id, is_connected) VALUES ($1, $2)`,
		tenantID, connected,
	); err != nil {
		slog.ErrorContext(ctx, "[session_health] insert health row failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
	}

	if connected {
		return // session healthy — nothing to alert
	}

	// Find the last time this tenant was connected.
	var lastConnected time.Time
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(polled_at), NOW() - INTERVAL '1 hour')
		   FROM public.wa_session_health
		  WHERE tenant_id = $1 AND is_connected = TRUE`,
		tenantID,
	).Scan(&lastConnected)
	if err != nil {
		slog.ErrorContext(ctx, "[session_health] query last connected failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return
	}

	// Only alert if offline for > 30 minutes.
	if time.Since(lastConnected) < 30*time.Minute {
		return
	}

	// Suppress if already alerted within the last hour.
	var alreadyAlerted bool
	if err := s.db.QueryRowContext(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM public.wa_session_health
			WHERE tenant_id = $1 AND alerted_at > NOW() - INTERVAL '1 hour'
		)`,
		tenantID,
	).Scan(&alreadyAlerted); err != nil {
		slog.ErrorContext(ctx, "[session_health] query alerted_at failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return
	}
	if alreadyAlerted {
		return
	}

	subject := fmt.Sprintf("[Caleo Ops] WA Session Offline — tenant %s", tenantName)
	body := fmt.Sprintf(
		"Tenant '%s' (id: %s) WA session has been offline since %s (over 30 minutes).\n\n"+
			"Please investigate:\n"+
			"1. Check whatsmeow session state in DB\n"+
			"2. Try reconnecting via admin.caleo.id health tab\n"+
			"3. If persistent, ask tenant to re-scan QR code",
		tenantName, tenantID, lastConnected.Format(time.RFC3339),
	)

	if err := SendOpsEmail(ctx, subject, body); err != nil {
		slog.ErrorContext(ctx, "[session_health] ops email failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return
	}

	// Record alert timestamp on the most recent row for this tenant.
	if _, err := s.db.ExecContext(ctx,
		`UPDATE public.wa_session_health
		    SET alerted_at = NOW()
		  WHERE tenant_id = $1
		    AND polled_at = (
		        SELECT MAX(polled_at) FROM public.wa_session_health WHERE tenant_id = $1
		    )`,
		tenantID,
	); err != nil {
		slog.ErrorContext(ctx, "[session_health] update alerted_at failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
	}

	slog.InfoContext(ctx, "[session_health] ops alert sent",
		slog.String("tenant_id", tenantID),
		slog.String("tenant_name", tenantName),
		slog.Time("last_connected", lastConnected),
	)
}
