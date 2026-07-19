// backend-go/internal/notification/notify_customer.go
package notification

import (
	"context"
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
	logger   *slog.Logger
}

// NewNotifier returns a Notifier bound to the given collaborators.
func NewNotifier(s sendClient, i messageInserter, q quotaChecker, l *slog.Logger) *Notifier {
	return &Notifier{sender: s, inserter: i, quota: q, logger: l}
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
		log.ErrorContext(ctx, "quota check failed", slog.Any("error", err))
		return err
	}

	if err := n.sender.SendText(ctx, phone, msg); err != nil {
		log.ErrorContext(ctx, "wa send failed", slog.Any("error", err))
		return errors.Join(ErrSendFailed, err)
	}

	if err := n.inserter.InsertMessage(ctx, convID, "AI", msg); err != nil {
		// Audit failure is logged but does NOT fail the send — customer received message.
		log.WarnContext(ctx, "audit insert failed post-send", slog.Any("error", err))
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
