package followup

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

var wibLocation = time.FixedZone("WIB", 7*3600)

// Poller sends automatic follow-up WA messages to conversations where the
// customer has gone silent. Ticks every minute and respects WIB daily quotas.
type Poller struct {
	db     *db.Client
	sender *whatsapp.Sender
}

func NewPoller(d *db.Client, s *whatsapp.Sender) *Poller {
	return &Poller{db: d, sender: s}
}

// Start launches the polling goroutine. Stops when ctx is cancelled.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.poll(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (p *Poller) poll(ctx context.Context) {
	convs, err := p.db.GetEligibleForFollowup()
	if err != nil {
		log.Printf("[FOLLOWUP] GetEligibleForFollowup error: %v", err)
		return
	}

	for _, conv := range convs {
		effectiveCount := conv.FollowupCountToday
		if isNewWIBDay(conv.LastFollowupDate) {
			effectiveCount = 0
		}
		if effectiveCount >= 2 {
			continue
		}

		msg := buildFollowupMessage(conv, effectiveCount+1)
		if err := p.sender.SendText(ctx, conv.CustomerPhone, msg); err != nil {
			log.Printf("[FOLLOWUP] SendText error for conv %s: %v", conv.ID, err)
			// Do NOT update DB on send failure — avoid phantom follow-up count.
			continue
		}
		if err := p.db.IncrementFollowup(conv.ID); err != nil {
			log.Printf("[FOLLOWUP] IncrementFollowup error for conv %s: %v", conv.ID, err)
		}
		if _, err := p.db.InsertMessage(conv.ID, models.SenderAI, msg); err != nil {
			log.Printf("[FOLLOWUP] InsertMessage error for conv %s: %v", conv.ID, err)
		}
		log.Printf("[FOLLOWUP] sent follow-up %d for conv %s", effectiveCount+1, conv.ID)
	}
}

// isNewWIBDay returns true if t is nil (never sent) or represents a WIB date
// before today. Postgres date columns are scanned as time.Time at midnight UTC,
// representing the WIB calendar date stored by the SQL.
func isNewWIBDay(t *time.Time) bool {
	if t == nil {
		return true
	}
	now := time.Now().In(wibLocation)
	todayUTC := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return t.Before(todayUTC)
}

func buildFollowupMessage(conv *models.Conversation, count int) string {
	name := conv.CollectedData.Name
	lang := conv.Language

	if conv.State == models.StateBooked {
		return bookedMessage(name, lang, count)
	}
	return standardMessage(name, lang, count)
}

func standardMessage(name, lang string, count int) string {
	if lang == "en" {
		if count == 1 {
			return fmt.Sprintf("Hello %s, we wanted to check if you still need our assistance? 😊\n\nFeel free to reply anytime you're ready, we're here to help! 🙏", name)
		}
		return fmt.Sprintf("Hello %s, we're reaching out again 🙏\n\nIf you have any questions about our products, don't hesitate to reply.\n\nThank you for contacting Garindo Jaya Panel! ⚡", name)
	}
	if count == 1 {
		return fmt.Sprintf("Halo Bapak/Ibu %s, kami ingin memastikan apakah Bapak/Ibu masih membutuhkan bantuan kami? 😊\n\nSilakan balas kapanpun Bapak/Ibu siap, kami siap membantu! 🙏", name)
	}
	return fmt.Sprintf("Halo Bapak/Ibu %s, kami coba menghubungi kembali 🙏\n\nJika ada pertanyaan mengenai produk kami, jangan ragu untuk membalas pesan ini ya.\n\nTerima kasih sudah menghubungi Garindo Jaya Panel! ⚡", name)
}

func bookedMessage(name, lang string, count int) string {
	if lang == "en" {
		if count == 1 {
			return fmt.Sprintf("Hello %s, we'd like to remind you that your order has been confirmed. Please complete the payment and send the transfer proof to this number. 🙏", name)
		}
		return fmt.Sprintf("Hello %s, a reminder about the payment for your order. If you have questions about payment details, please reply to this message. Thank you! ⚡", name)
	}
	if count == 1 {
		return fmt.Sprintf("Halo Bapak/Ibu %s, kami ingin mengingatkan bahwa pesanan Bapak/Ibu sudah dikonfirmasi. Silakan lakukan pembayaran dan kirim foto bukti transfernya ke nomor ini ya. 🙏", name)
	}
	return fmt.Sprintf("Halo Bapak/Ibu %s, kami mengingatkan kembali mengenai pembayaran pesanan Bapak/Ibu. Jika ada pertanyaan mengenai detail pembayaran, silakan balas pesan ini. Terima kasih! ⚡", name)
}
