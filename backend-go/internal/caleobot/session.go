package caleobot

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"

	"github.com/lib/pq"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
	"go.mau.fi/whatsmeow"
	waEvents "go.mau.fi/whatsmeow/types/events"
)

// sentinelTenantID is the platform-owned sentinel tenant for Caleo Admin bot
// records. The tenants row was inserted by migration 20261115000470.
const sentinelTenantID = "00000000-0000-0000-0000-000000000000"

// StartCaleoAdminSession wires the Caleo Admin FAQ bot onto the given
// whatsmeow client. It requires CALEO_ADMIN_WA_PHONE to be set; if not, it
// returns an error (caller logs and skips).
//
// NOTE: This registers an additional event handler on client.AddEventHandler.
// This is intended only for the dedicated Caleo Admin Cloud Run deployment
// (where CALEO_ADMIN_WA_PHONE is set). Do NOT set CALEO_ADMIN_WA_PHONE on
// customer-tenant deployments — it would cause every customer message to also
// trigger the FAQ bot and spam customers with escalation replies.
func StartCaleoAdminSession(ctx context.Context, db *sql.DB, client *whatsmeow.Client) error {
	if os.Getenv("CALEO_ADMIN_WA_PHONE") == "" {
		return fmt.Errorf("caleobot: CALEO_ADMIN_WA_PHONE not set")
	}

	faqs, err := loadFaqs(ctx, db)
	if err != nil {
		return fmt.Errorf("caleobot: load faqs: %w", err)
	}
	matcher := NewFaqMatcher(faqs)
	sender := whatsapp.NewSender(client)

	client.AddEventHandler(func(rawEvt interface{}) {
		msg, ok := rawEvt.(*waEvents.Message)
		if !ok || msg.Info.IsFromMe {
			return
		}

		// Extract text — fall back to ExtendedTextMessage for quoted replies
		// and mentions (common on iOS clients).
		body := msg.Message.GetConversation()
		if body == "" && msg.Message.GetExtendedTextMessage() != nil {
			body = msg.Message.GetExtendedTextMessage().GetText()
		}
		if body == "" {
			// Non-text message (image, sticker, etc.) — ignore.
			return
		}

		sessionID := msg.Info.Sender.String()
		prospectPhone := msg.Info.Sender.User

		trackFirstMessage(ctx, db, sessionID)

		hit, matched := matcher.Match(body)
		if matched {
			trackFaqHit(ctx, db, sessionID, hit.ID)

			if err := sender.SendText(ctx, sessionID, hit.Response); err != nil {
				slog.ErrorContext(ctx, "[caleobot] send faq reply failed",
					slog.String("session_id", sessionID),
					slog.String("error", err.Error()),
				)
			}

			slog.InfoContext(ctx, "[caleobot] faq hit",
				slog.String("session_id", sessionID),
				slog.String("faq_id", hit.ID),
				slog.String("next_step", hit.NextStep),
			)

			if hit.NextStep == "chat_founder" {
				escalateToFounder(ctx, body, prospectPhone)
			}
			return
		}

		// No FAQ match — apologise and escalate.
		trackEscalation(ctx, db, sessionID)

		apology := "Terima kasih untuk pertanyaannya! Founder Caleo akan reply sebentar."
		if err := sender.SendText(ctx, sessionID, apology); err != nil {
			slog.ErrorContext(ctx, "[caleobot] send apology failed",
				slog.String("session_id", sessionID),
				slog.String("error", err.Error()),
			)
		}

		slog.InfoContext(ctx, "[caleobot] no faq match — escalating",
			slog.String("session_id", sessionID),
		)
		escalateToFounder(ctx, body, prospectPhone)
	})

	slog.InfoContext(ctx, "[caleobot] Caleo Admin WA session started",
		slog.Int("faq_count", len(faqs)),
	)
	return nil
}

// loadFaqs reads all FAQ entries from caleo_admin_bot_faq.
func loadFaqs(ctx context.Context, db *sql.DB) ([]FaqEntry, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, keywords, response, next_step FROM public.caleo_admin_bot_faq",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FaqEntry
	for rows.Next() {
		var f FaqEntry
		var nextStep sql.NullString
		if err := rows.Scan(&f.ID, pq.Array(&f.Keywords), &f.Response, &nextStep); err != nil {
			slog.Warn("[caleobot] loadFaqs: scan error — skipping row", slog.String("error", err.Error()))
			continue
		}
		if nextStep.Valid {
			f.NextStep = nextStep.String
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// trackFirstMessage inserts a new analytics row on the first message from a
// session. Idempotent via ON CONFLICT (session_id) DO NOTHING.
func trackFirstMessage(ctx context.Context, db *sql.DB, sessionID string) {
	_, err := db.ExecContext(ctx,
		`INSERT INTO public.caleo_admin_bot_analytics (session_id)
		 VALUES ($1)
		 ON CONFLICT (session_id) DO NOTHING`,
		sessionID,
	)
	if err != nil {
		slog.WarnContext(ctx, "[caleobot] trackFirstMessage failed",
			slog.String("session_id", sessionID),
			slog.String("error", err.Error()),
		)
	}
}

// trackFaqHit appends the matched FAQ id to the faq_hits JSONB array for the
// session.
func trackFaqHit(ctx context.Context, db *sql.DB, sessionID, faqID string) {
	_, err := db.ExecContext(ctx,
		`UPDATE public.caleo_admin_bot_analytics
		 SET faq_hits = faq_hits || jsonb_build_array($2::text)
		 WHERE session_id = $1`,
		sessionID, faqID,
	)
	if err != nil {
		slog.WarnContext(ctx, "[caleobot] trackFaqHit failed",
			slog.String("session_id", sessionID),
			slog.String("faq_id", faqID),
			slog.String("error", err.Error()),
		)
	}
}

// trackEscalation marks the session as escalated (once — COALESCE preserves
// the first escalation timestamp).
func trackEscalation(ctx context.Context, db *sql.DB, sessionID string) {
	_, err := db.ExecContext(ctx,
		`UPDATE public.caleo_admin_bot_analytics
		 SET escalated_at = COALESCE(escalated_at, NOW())
		 WHERE session_id = $1`,
		sessionID,
	)
	if err != nil {
		slog.WarnContext(ctx, "[caleobot] trackEscalation failed",
			slog.String("session_id", sessionID),
			slog.String("error", err.Error()),
		)
	}
}
