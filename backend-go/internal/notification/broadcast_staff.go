// backend-go/internal/notification/broadcast_staff.go
package notification

import (
	"context"
	"errors"
	"log/slog"
)

// BroadcastToStaff sends a WA message to all matching staff/owner recipients.
//
// Behavior:
//   - Fetches recipients via cached resolver (60s TTL per tenant/role).
//   - Sends to each recipient sequentially; collects per-recipient errors.
//   - Returns nil if at least one recipient received; returns joined errors otherwise.
//   - Emits log with recipient count + success/failure breakdown.
//
// Sprint 5 will add quiet-hours + consolidation window logic here.
func (n *Notifier) BroadcastToStaff(ctx context.Context, tenantID string, filter RecipientFilter, msg string) error {
	logger := n.logger
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("tenant_id", tenantID, "feature", "broadcast_staff", "role_filter", filter.Role)

	recipients, err := n.resolver.GetActiveRecipients(ctx, tenantID, filter)
	if err != nil {
		log.ErrorContext(ctx, "recipient resolver failed", slog.Any("error", err))
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
				slog.Any("error", err))
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
