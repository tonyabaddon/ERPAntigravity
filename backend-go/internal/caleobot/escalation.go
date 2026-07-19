package caleobot

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/username/sinar-elektrik-backend/internal/notification"
)

// escalateToFounder sends an ops email via Resend so the founder can follow
// up directly with the prospect over WhatsApp.
func escalateToFounder(ctx context.Context, prospectMsg, prospectPhone string) {
	subject := "[Caleo Bot] Prospect Escalation"
	body := fmt.Sprintf(
		"[Caleo Bot Escalation]\n\nProspect: %s\nAsked: %q\n\nReply via WA from your personal number to the prospect directly.",
		prospectPhone, prospectMsg,
	)
	if err := notification.SendOpsEmail(ctx, subject, body); err != nil {
		slog.WarnContext(ctx, "[caleobot] escalateToFounder email failed",
			slog.String("prospect_phone", prospectPhone),
			slog.Any("error", err),
		)
	}
}
