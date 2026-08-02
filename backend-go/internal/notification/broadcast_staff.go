// backend-go/internal/notification/broadcast_staff.go
package notification

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// internalBroadcastKey is an unexported type used as a context key to mark
// calls that originate from the job worker (broadcast_quiet_delay /
// broadcast_consolidated handlers). This prevents re-triggering the
// quiet-hours / consolidation check on the worker's outbound send.
// Use a struct{} type (not a string) to satisfy staticcheck SA1029.
type internalBroadcastKey struct{}

// InternalBroadcastCtx returns a copy of ctx with the internal-broadcast marker set.
// Pass this to BroadcastToStaff from job handlers to bypass consolidation.
func InternalBroadcastCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, internalBroadcastKey{}, true)
}

// isInternalBroadcast reports whether ctx carries the internal-broadcast marker.
func isInternalBroadcast(ctx context.Context) bool {
	v, _ := ctx.Value(internalBroadcastKey{}).(bool)
	return v
}

// notificationPrefs holds the per-tenant broadcast preferences fetched from
// the notification_prefs table (Task 5.1 migration).
type notificationPrefs struct {
	QuietHoursStart           string // "HH:MM" in Asia/Jakarta
	QuietHoursEnd             string // "HH:MM" in Asia/Jakarta
	ConsolidationWindowSeconds int
}

// fetchPrefs loads notification_prefs for tenantID.
// Returns nil (no quiet hours / no consolidation) if no row exists or db is nil.
func (n *Notifier) fetchPrefs(ctx context.Context, tenantID string) *notificationPrefs {
	if n.db == nil {
		return nil
	}
	var start, end sql.NullString
	var windowSec sql.NullInt64
	err := n.db.QueryRowContext(ctx, `
		SELECT
		  TO_CHAR(quiet_hours_start, 'HH24:MI'),
		  TO_CHAR(quiet_hours_end,   'HH24:MI'),
		  consolidation_window_seconds
		FROM public.notification_prefs
		WHERE tenant_id = $1
	`, tenantID).Scan(&start, &end, &windowSec)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		n.logger.WarnContext(ctx, "notification_prefs fetch failed",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return nil
	}
	if !start.Valid || !end.Valid {
		return nil
	}
	prefs := &notificationPrefs{
		QuietHoursStart: start.String,
		QuietHoursEnd:   end.String,
	}
	if windowSec.Valid {
		prefs.ConsolidationWindowSeconds = int(windowSec.Int64)
	}
	return prefs
}

// enqueueQuietDelay inserts a broadcast_quiet_delay job with scheduled_for set
// to the next occurrence of quiet_hours_end in Asia/Jakarta.
func (n *Notifier) enqueueQuietDelay(ctx context.Context, tenantID string, filter RecipientFilter, msg, quietEnd string) error {
	tz, _ := time.LoadLocation("Asia/Jakarta")
	now := time.Now().In(tz)
	scheduledFor := nextOccurrence(now, quietEnd, tz)

	type payload struct {
		TenantID string          `json:"tenant_id"`
		Msg      string          `json:"msg"`
		Filter   RecipientFilter `json:"filter"`
	}
	p, _ := json.Marshal(payload{TenantID: tenantID, Msg: msg, Filter: filter})

	_, err := n.db.ExecContext(ctx, `
		INSERT INTO public.t_jobs (tenant_id, job_type, payload, priority, scheduled_for)
		VALUES ($1, 'broadcast_quiet_delay', $2::jsonb, 200, $3)
	`, tenantID, string(p), scheduledFor)
	if err != nil {
		return fmt.Errorf("enqueue broadcast_quiet_delay: %w", err)
	}
	n.logger.InfoContext(ctx, "broadcast deferred (quiet hours)",
		slog.String("tenant_id", tenantID),
		slog.Time("scheduled_for", scheduledFor))
	return nil
}

// tryConsolidate attempts to coalesce msg into an existing open broadcast_consolidated
// job for tenantID. Returns true if the message was appended to an existing job
// or a new consolidation job was created.
//
// Race safety: the unique partial index idx_t_jobs_one_consolidation_per_tenant
// ensures only one QUEUED broadcast_consolidated row exists per tenant.
// If two goroutines race, the second INSERT gets a unique-violation and falls
// through to the append path (or returns false if both hit the append path
// simultaneously — acceptable: the message is then sent immediately).
func (n *Notifier) tryConsolidate(ctx context.Context, tenantID, msg string, windowSec int) bool {
	// Try to append msg to an existing open consolidation job.
	tag, err := n.db.ExecContext(ctx, `
		UPDATE public.t_jobs
		SET payload = jsonb_set(
		      payload,
		      '{messages}',
		      (COALESCE(payload->'messages', '[]'::jsonb) || to_jsonb($3::text))
		    )
		WHERE tenant_id = $1
		  AND job_type = 'broadcast_consolidated'
		  AND status = 'QUEUED'
	`, tenantID, tenantID, msg)
	if err != nil {
		n.logger.WarnContext(ctx, "consolidation append failed, sending immediately",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return false
	}
	rows, _ := tag.RowsAffected()
	if rows > 0 {
		n.logger.InfoContext(ctx, "broadcast consolidated into existing job",
			slog.String("tenant_id", tenantID))
		return true
	}

	// No open job — create one. The unique index prevents duplicates if two
	// callers race; a constraint violation means someone else won, which is fine.
	scheduledFor := time.Now().Add(time.Duration(windowSec) * time.Second)
	type payload struct {
		TenantID  string `json:"tenant_id"`
		WindowSec int    `json:"window_sec"`
		Messages  []string `json:"messages"`
	}
	p, _ := json.Marshal(payload{
		TenantID:  tenantID,
		WindowSec: windowSec,
		Messages:  []string{msg},
	})
	_, err = n.db.ExecContext(ctx, `
		INSERT INTO public.t_jobs (tenant_id, job_type, payload, priority, scheduled_for)
		VALUES ($1, 'broadcast_consolidated', $2::jsonb, 150, $3)
		ON CONFLICT DO NOTHING
	`, tenantID, string(p), scheduledFor)
	if err != nil {
		n.logger.WarnContext(ctx, "consolidation job insert failed, sending immediately",
			slog.String("tenant_id", tenantID), slog.String("error", err.Error()))
		return false
	}
	n.logger.InfoContext(ctx, "broadcast consolidation job created",
		slog.String("tenant_id", tenantID),
		slog.Time("scheduled_for", scheduledFor))
	return true
}

// nextOccurrence returns the next wall-clock occurrence of timeStr ("HH:MM") on
// or after now in the given timezone. If timeStr is today and still in the future
// it returns today; otherwise returns tomorrow.
func nextOccurrence(now time.Time, timeStr string, tz *time.Location) time.Time {
	endMin := parseHM(timeStr)
	h := endMin / 60
	m := endMin % 60
	candidate := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, tz)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

// BroadcastToStaff sends a WA message to all matching staff/owner recipients.
//
// Sprint 5 quiet-hours + consolidation logic (skipped if ctx has internal marker):
//   - Fetches notification_prefs for tenantID (nil → no prefs → immediate send).
//   - If CritLevel != "critical" && now is in the quiet window → enqueue
//     broadcast_quiet_delay job for next morning, return nil.
//   - Else if consolidation_window_seconds > 0 → try to consolidate into one
//     deferred batch job; if succeeded, return nil.
//   - Otherwise fall through to the existing per-recipient send loop.
//
// Behavior (send loop):
//   - Fetches recipients via cached resolver (60s TTL per tenant/role).
//   - Sends to each recipient sequentially; collects per-recipient errors.
//   - Returns nil if at least one recipient received; returns joined errors otherwise.
//   - Emits log with recipient count + success/failure breakdown.
func (n *Notifier) BroadcastToStaff(ctx context.Context, tenantID string, filter RecipientFilter, msg string) error {
	logger := n.logger
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("tenant_id", tenantID, "feature", "broadcast_staff", "role_filter", filter.Role)

	// --- Sprint 5: quiet-hours + consolidation ---
	// Skip when called from the job worker (avoids infinite re-enqueue).
	if !isInternalBroadcast(ctx) && n.db != nil {
		prefs := n.fetchPrefs(ctx, tenantID)
		if prefs != nil && filter.CritLevel != "critical" {
			tz, _ := time.LoadLocation("Asia/Jakarta")
			now := time.Now().In(tz)

			if isInQuietHours(now, prefs.QuietHoursStart, prefs.QuietHoursEnd) {
				log.InfoContext(ctx, "broadcast deferred: quiet hours active",
					slog.String("quiet_start", prefs.QuietHoursStart),
					slog.String("quiet_end", prefs.QuietHoursEnd))
				return n.enqueueQuietDelay(ctx, tenantID, filter, msg, prefs.QuietHoursEnd)
			}

			if prefs.ConsolidationWindowSeconds > 0 {
				if consolidated := n.tryConsolidate(ctx, tenantID, msg, prefs.ConsolidationWindowSeconds); consolidated {
					return nil
				}
				// tryConsolidate returned false → fall through to immediate send.
			}
		}
	}

	// --- Existing per-recipient send loop ---
	recipients, err := n.resolver.GetActiveRecipients(ctx, tenantID, filter)
	if err != nil {
		log.ErrorContext(ctx, "recipient resolver failed", slog.String("error", err.Error()))
		return err
	}
	if len(recipients) == 0 {
		log.WarnContext(ctx, "no active recipients matched filter")
		return nil // Not an error — tenant may have no recipients configured yet.
	}

	var (
		sentCount int
		errs      []error
	)
	for _, r := range recipients {
		if err := n.sender.SendText(ctx, r.Phone, msg); err != nil {
			errs = append(errs, err)
			log.ErrorContext(ctx, "broadcast send failed for recipient",
				slog.String("phone_hash", hashPhone(r.Phone)),
				slog.String("role", r.Role),
				slog.String("error", err.Error()))
			continue
		}
		sentCount++
	}

	log.InfoContext(ctx, "broadcast complete",
		slog.Int("recipient_count", len(recipients)),
		slog.Int("sent_count", sentCount),
		slog.Int("failure_count", len(errs)))

	if sentCount == 0 {
		return errors.Join(ErrSendFailed, errors.Join(errs...))
	}
	return nil
}
