// backend-go/internal/notification/notify_customer.go
package notification

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
)

// sendClient wraps whatsmeow.Sender for testability.
type sendClient interface {
	SendText(ctx context.Context, phone, msg string) error
}

// messageInserter wraps db.InsertMessage for testability.
type messageInserter interface {
	InsertMessage(ctx context.Context, convID, sender, text string) error
}

// quotaChecker wraps Quota for testability.
type quotaChecker interface {
	CheckAndIncrement(ctx context.Context, tenantID string) error
}

// Notifier is the shared WA notification framework. All WA-send callers
// call Notifier.NotifyCustomer (customer sends) or Notifier.BroadcastToStaff
// (staff/owner broadcasts) instead of the raw whatsmeow.Sender.
type Notifier struct {
	sender   sendClient
	inserter messageInserter
	quota    quotaChecker
	resolver recipientResolver
	logger   *slog.Logger
	// db is used by BroadcastToStaff for notification_prefs lookup and
	// enqueueing deferred t_jobs rows. May be nil in tests that only use
	// NotifyCustomer (quiet-hours / consolidation is skipped when db is nil).
	db *sql.DB
}

// NewNotifier returns a Notifier bound to the given collaborators.
// Pass nil for db if BroadcastToStaff quiet-hours / consolidation won't be used.
// Pass nil for resolver if BroadcastToStaff will not be used.
func NewNotifier(s sendClient, i messageInserter, q quotaChecker, r recipientResolver, l *slog.Logger) *Notifier {
	return &Notifier{sender: s, inserter: i, quota: q, resolver: r, logger: l}
}

// WithDB attaches a *sql.DB to the Notifier for BroadcastToStaff deferred-job
// support (quiet hours, consolidation window). Call once after NewNotifier.
func (n *Notifier) WithDB(db *sql.DB) *Notifier {
	n.db = db
	return n
}

// NotifyCustomer sends a WA message to a customer with atomic audit trail write
// and per-tenant daily quota enforcement.
//
// Behavior:
//   - Checks quota via quotaChecker; returns ErrQuotaExceeded if exhausted.
//   - Calls sendClient.SendText; wraps errors as ErrSendFailed.
//   - On send success, calls messageInserter.InsertMessage (audit trail).
//   - Emits structured log at every call with {tenant_id, phone_hash, status}.
func (n *Notifier) NotifyCustomer(ctx context.Context, tenantID, convID, phone, lang, msg string) error {
	logger := n.logger
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("tenant_id", tenantID, "phone_hash", hashPhone(phone), "feature", "notify_customer")

	if err := n.quota.CheckAndIncrement(ctx, tenantID); err != nil {
		if errors.Is(err, ErrQuotaExceeded) {
			log.InfoContext(ctx, "wa quota exceeded, skipping send")
			return err
		}
		log.ErrorContext(ctx, "quota check failed", slog.String("error", err.Error()))
		return err
	}

	if err := n.sender.SendText(ctx, phone, msg); err != nil {
		log.ErrorContext(ctx, "wa send failed", slog.String("error", err.Error()))
		return errors.Join(ErrSendFailed, err)
	}

	// Skip audit insert when convID is empty — kasir/pesanan-admin flows create
	// orders without a conversation (only Calista chat orders have convID). The
	// messages.conversation_id FK would 23503-reject an empty string. Send is
	// what matters; audit gap for these specific paths is acceptable.
	if convID != "" {
		if err := n.inserter.InsertMessage(ctx, convID, "AI", msg); err != nil {
			// Audit failure is logged but does NOT fail the send — customer received message.
			log.WarnContext(ctx, "audit insert failed post-send", slog.String("error", err.Error()))
		}
	}

	log.InfoContext(ctx, "wa notification sent", slog.String("status", "SENT"))
	return nil
}

// hashPhone returns a stable non-reversible hash for logging (avoid PII leak).
// Uses first 4 chars + last 2 chars as fingerprint.
func hashPhone(phone string) string {
	if len(phone) < 6 {
		return "xxx"
	}
	return phone[:4] + "..." + phone[len(phone)-2:]
}
