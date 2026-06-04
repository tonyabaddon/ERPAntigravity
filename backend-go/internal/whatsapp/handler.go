package whatsapp

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mau.fi/whatsmeow/types/events"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/rules"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/storage"
)

type Handler struct {
	db                 *db.Client
	machine            *engine.Machine
	sender             *Sender
	scheduler          *scheduler.Scheduler
	waNumberID         string
	startedAt          time.Time
	supabaseURL        string
	supabaseServiceKey string
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID, supabaseURL, supabaseServiceKey string) *Handler {
	return &Handler{
		db: d, machine: m, sender: s, scheduler: sc,
		waNumberID: waNumberID, startedAt: time.Now(),
		supabaseURL: supabaseURL, supabaseServiceKey: supabaseServiceKey,
	}
}

func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}

	text := evt.Message.GetConversation()
	if text == "" && evt.Message.GetExtendedTextMessage() != nil {
		text = evt.Message.GetExtendedTextMessage().GetText()
	}
	if text == "" {
		// Media messages (payment proofs) must never be filtered by startup time —
		// customers send proofs while the backend is restarting and lose them otherwise.
		h.handleMediaMessage(evt)
		return
	}

	// Text messages only: drop WhatsApp's queued backlog delivered on reconnect
	// so the AI does not re-greet customers who messaged before the last restart.
	if evt.Info.Timestamp.Before(h.startedAt) {
		return
	}

	// Preserve the full JID string (including @lid server for LID-based senders)
	// so sender.go can route it correctly.
	senderJID := evt.Info.Sender.ToNonAD().String()
	go h.processMessage(context.Background(), senderJID, text)
}

func (h *Handler) processMessage(ctx context.Context, senderPhone, text string) {
	// 1. Keyword rules — fast path, zero LLM cost
	esc := rules.CheckEscalation(text)
	if esc == rules.EscalationWiring {
		h.handleWiringEscalation(ctx, senderPhone, text)
		return
	}

	// 2. Get or create conversation
	conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// Reset follow-up counter — customer has replied.
	if err := h.db.ResetFollowupCounter(conv.ID); err != nil {
		log.Printf("[HANDLER] ResetFollowupCounter error for conv %s: %v", conv.ID, err)
	}

	// 3. Ensure customer record exists; create lead on new conversations.
	//    Errors here are non-fatal — log and continue so the message is never dropped.
	var leadsID, customerID string
	customer, err := h.db.GetOrCreateCustomer(senderPhone)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateCustomer error for %s: %v", senderPhone, err)
	} else {
		customerID = customer.ID
		if created {
			lead, err := h.db.CreateLead(customer.ID, conv.ID, senderPhone)
			if err != nil {
				log.Printf("[HANDLER] CreateLead error for conv %s: %v", conv.ID, err)
			} else {
				leadsID = lead.ID
			}
		}
	}

	// 4. Admin escalation keyword
	if esc == rules.EscalationAdmin {
		h.handleAdminEscalation(ctx, conv, text)
		return
	}

	// 5a. Post-booking holding states — send static status message, never invoke Gemini.
	//     Without this, the machine is called with an unknown-state prompt, Gemini returns
	//     an empty response, and FallbackReply fires ("kendala teknis").
	if conv.State == models.StateBooked || conv.State == models.StateTimeoutReminder {
		reply := "Pesanan Anda sedang menunggu konfirmasi dari tim admin kami. Mohon ditunggu sebentar ya 🙏"
		if conv.Language == "en" {
			reply = "Your order is awaiting confirmation from our admin team. Please wait a moment 🙏"
		}
		if _, err := h.db.InsertMessage(conv.ID, models.SenderAI, reply); err != nil {
			log.Printf("[HANDLER] BOOKED InsertMessage error: %v", err)
		}
		if err := h.sender.SendText(ctx, senderPhone, reply); err != nil {
			log.Printf("[HANDLER] BOOKED holding reply send error: %v", err)
		}
		return
	}

	// 5. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}

	// 6. Insert customer message → Realtime pushes to Sales Inbox
	if _, err := h.db.InsertMessage(conv.ID, models.SenderCustomer, text); err != nil {
		log.Printf("[HANDLER] InsertMessage error: %v", err)
	}

	// 7. Load history
	history, _ := h.db.ListLast10Messages(conv.ID)

	// 8. Build stock context if needed
	stockContext := ""
	if conv.State == models.StateStockCheck || conv.State == models.StateClarifying {
		items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
		stockContext = engine.StockContextString(items)
	}

	// 9. Run state machine with retry (10 attempts × 10s timeout each)
	holdingMsg := "Mohon maaf, sistem kami sedang sibuk. Kami akan segera membalas 🙏"
	if conv.Language == "en" {
		holdingMsg = "Sorry, our system is currently busy. We'll reply to you shortly 🙏"
	}
	result := engine.RetryProcess(ctx, h.machine, conv, text, history, stockContext, 10, func() {
		h.db.InsertMessage(conv.ID, models.SenderAI, holdingMsg)
		if sendErr := h.sender.SendText(ctx, senderPhone, holdingMsg); sendErr != nil {
			log.Printf("[HANDLER] holding message send error: %v", sendErr)
		}
	})

	if result.GeminiError != nil {
		log.Printf("[HANDLER] Gemini failed after all retries for %s: %v", senderPhone, result.GeminiError)
		h.db.InsertMessage(conv.ID, models.SenderSystem, "ESCALATED: Gemini failed after 10 retries")
		if dbErr := h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin); dbErr != nil {
			log.Printf("[HANDLER] UpdateConversationState (escalation) error: %v", dbErr)
		}
		recipients, recErr := h.db.GetActiveRecipients()
		if recErr != nil {
			log.Printf("[HANDLER] GetActiveRecipients error during escalation: %v", recErr)
			return
		}
		notif := fmt.Sprintf("⚠️ *Calista Gagal*\n\nSistem tidak dapat memproses pesan dari %s setelah 10x percobaan.\n\nPesan pelanggan: %s\n\nMohon tangani secara manual.", senderPhone, text)
		for _, r := range recipients {
			if notifErr := h.sender.SendText(ctx, r.WANumber, notif); notifErr != nil {
				log.Printf("[HANDLER] escalation notify error (%s): %v", r.WANumber, notifErr)
			}
		}
		return
	}

	// 10. Persist state + data before sending reply
	if result.NewData != nil {
		if err := h.db.UpdateCollectedData(conv.ID, *result.NewData, result.ClarificationRound); err != nil {
			log.Printf("[HANDLER] UpdateCollectedData error: %v", err)
		}
	}
	if result.Language != conv.Language {
		if err := h.db.UpdateLanguage(conv.ID, result.Language); err != nil {
			log.Printf("[HANDLER] UpdateLanguage error: %v", err)
		}
	}
	if result.NextState != conv.State {
		if err := h.db.UpdateConversationState(conv.ID, result.NextState); err != nil {
			log.Printf("[HANDLER] UpdateConversationState error: %v", err)
		}
	}

	// 11. If order just booked, create order row and start timer
	if result.CreateOrder {
		// Apply any updated collected data (e.g. address) to conv before creating order
		if result.NewData != nil {
			conv.CollectedData = *result.NewData
		}
		h.handleBooking(ctx, conv, leadsID, customerID, result.DeliveryType)
	}

	// 12. Insert AI reply + send to WA
	if result.Reply != "" {
		h.db.InsertMessage(conv.ID, models.SenderAI, result.Reply)
		if err := h.sender.SendText(ctx, senderPhone, result.Reply); err != nil {
			log.Printf("[HANDLER] SendText error: %v", err)
		}
	}
}

func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation, leadsID, customerID string, deliveryType models.DeliveryType) {
	items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
	var orderItems []models.OrderItem
	var subtotal float64
	if len(items) > 0 {
		item := items[0]
		qty := conv.CollectedData.Quantity
		if qty == 0 {
			qty = 1
		}
		sub := item.Price * float64(qty)
		orderItems = append(orderItems, models.OrderItem{
			SKU: item.SKU, Name: item.Name, Qty: qty,
			UnitPrice: item.Price, Subtotal: sub,
		})
		subtotal = sub
	}
	if len(items) == 0 {
		log.Printf("[HANDLER] Warning: no stock found for product %q, order will have empty items", conv.CollectedData.Product)
	}
	order, err := h.db.CreateOrder(conv, orderItems, subtotal, leadsID, customerID, models.OrderTypeStandard, deliveryType)
	if err != nil {
		log.Printf("[HANDLER] CreateOrder error: %v", err)
		return
	}
	h.scheduler.Schedule(order.ID, order.BookingExpiresAt)
	log.Printf("[HANDLER] Order %s created, timer scheduled until %v", order.ID, order.BookingExpiresAt)
}

func (h *Handler) handleWiringEscalation(ctx context.Context, senderPhone, text string) {
	conv, _, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}
	h.db.InsertMessage(conv.ID, models.SenderCustomer, text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedWiring)
	h.db.InsertMessage(conv.ID, models.SenderSystem, "ESCALATED_WIRING: keyword match")

	reply := "Permintaan ini membutuhkan tim teknis kami. Staf kami akan segera menghubungi Anda."
	if conv.Language == "en" {
		reply = "Your request requires our technical team. Our staff will contact you shortly."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	if err := h.sender.SendText(ctx, senderPhone, reply); err != nil {
		log.Printf("[HANDLER] handleWiringEscalation: SendText error: %v", err)
	}
}

func (h *Handler) handleAdminEscalation(ctx context.Context, conv *models.Conversation, text string) {
	h.db.InsertMessage(conv.ID, models.SenderCustomer, text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	h.db.InsertMessage(conv.ID, models.SenderSystem, "ESCALATED_ADMIN: keyword match")

	reply := "Permintaan Anda akan diproses oleh tim kami. Mohon tunggu sebentar."
	if conv.Language == "en" {
		reply = "Your request will be handled by our team. Please wait a moment."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	if err := h.sender.SendText(ctx, conv.CustomerPhone, reply); err != nil {
		log.Printf("[HANDLER] handleAdminEscalation: SendText error: %v", err)
	}
}

func (h *Handler) handleMediaMessage(evt *events.Message) {
	senderPhone := evt.Info.Sender.ToNonAD().String()
	conv, _, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}

	order, orderErr := h.db.GetOrderByConversation(conv.ID)

	// Resolve image through wrapper types WhatsApp uses on newer clients.
	img := evt.Message.GetImageMessage()
	if img == nil && evt.Message.GetViewOnceMessage() != nil {
		img = evt.Message.GetViewOnceMessage().GetMessage().GetImageMessage()
	}
	if img == nil && evt.Message.GetEphemeralMessage() != nil {
		img = evt.Message.GetEphemeralMessage().GetMessage().GetImageMessage()
	}
	doc := evt.Message.GetDocumentMessage()

	if orderErr != nil || order == nil || order.Status != models.OrderStatusWaitingPayment || (img == nil && doc == nil) {
		// Not a payment proof context — fall through to admin escalation.
		h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
		h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
		reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
		if conv.Language == "en" {
			reply = "We have received your document. Our technical team will review and contact you shortly."
		}
		h.db.InsertMessage(conv.ID, models.SenderAI, reply)
		h.sender.SendText(context.Background(), senderPhone, reply)
		return
	}

	// Payment proof flow — image or document (PDF) from customer with WAITING_PAYMENT order.
	var proofURL string
	if img != nil {
		data, contentType, dlErr := h.sender.DownloadMedia(context.Background(), img)
		if dlErr != nil {
			log.Printf("[HANDLER] DownloadMedia error for order %s: %v", order.ID, dlErr)
		} else {
			url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
			if upErr != nil {
				log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
			} else {
				proofURL = url
			}
		}
	} else {
		data, contentType, dlErr := h.sender.DownloadDocument(context.Background(), doc)
		if dlErr != nil {
			log.Printf("[HANDLER] DownloadDocument error for order %s: %v", order.ID, dlErr)
		} else {
			url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
			if upErr != nil {
				log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
			} else {
				proofURL = url
			}
		}
	}

	if err := h.db.UpdatePaymentProof(order.ID, proofURL); err != nil {
		log.Printf("[HANDLER] UpdatePaymentProof error for order %s: %v", order.ID, err)
	}
	h.db.InsertMessage(conv.ID, models.SenderCustomer, "[Payment proof uploaded]")

	ack := "Bukti transfer sudah kami terima 🙏 Tim kami akan memverifikasi dan menghubungi Bapak/Ibu segera."
	if conv.Language == "en" {
		ack = "We have received your payment proof 🙏 Our team will verify and contact you shortly."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, ack)
	if err := h.sender.SendText(context.Background(), senderPhone, ack); err != nil {
		log.Printf("[HANDLER] Payment ack send error: %v", err)
	}

	recipients, err := h.db.GetActiveRecipients()
	if err != nil {
		log.Printf("[HANDLER] GetActiveRecipients error: %v", err)
		return
	}
	orderRef := order.GJPOrderID
	if orderRef == "" {
		orderRef = order.ID
	}
	notif := fmt.Sprintf("💳 *Bukti Transfer Diterima*\n\nDari: %s\nOrder: %s\nCustomer: %s\n\nSilakan verifikasi di dashboard.",
		senderPhone, orderRef, order.CustomerName)
	for _, r := range recipients {
		if err := h.sender.SendText(context.Background(), r.WANumber, notif); err != nil {
			log.Printf("[HANDLER] Recipient notify error (%s): %v", r.WANumber, err)
		}
	}
}

// HandleApprovedOrder is called by the LISTEN/NOTIFY dispatcher when an order is approved.
// Sends payment instructions to the customer using live bank_config data.
// Sets order status to WAITING_PAYMENT (not COMPLETED — payment is still pending).
func (h *Handler) HandleApprovedOrder(ctx context.Context, orderID, conversationID string, shippingFee float64) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil || order == nil {
		log.Printf("[HANDLER] GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}
	h.scheduler.Cancel(orderID)

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	total := order.Subtotal + shippingFee
	if err := h.db.UpdateOrderTotal(orderID, total); err != nil {
		log.Printf("[HANDLER] UpdateOrderTotal error: %v", err)
	}

	bank, err := h.db.GetActiveBankConfig()
	if err != nil {
		log.Printf("[HANDLER] GetActiveBankConfig error (using fallback): %v", err)
	}

	invoice := buildInvoiceMessage(order, shippingFee, total, lang, bank)
	h.db.InsertMessage(conversationID, models.SenderSystem, "ORDER_APPROVED: payment instructions sent")
	if err := h.sender.SendText(ctx, order.CustomerPhone, invoice); err != nil {
		log.Printf("[HANDLER] Invoice send error: %v", err)
	}

	recipients, err := h.db.GetActiveRecipients()
	if err != nil {
		log.Printf("[HANDLER] GetActiveRecipients error: %v", err)
	} else {
		orderRef := order.GJPOrderID
		if orderRef == "" {
			orderRef = orderID
		}
		notif := fmt.Sprintf("✅ *Order Disetujui*\n\nOrder: %s\nCustomer: %s (%s)\nTotal: Rp %.0f\n\nMenunggu konfirmasi pembayaran.",
			orderRef, order.CustomerName, order.CustomerPhone, total)
		for _, r := range recipients {
			if err := h.sender.SendText(ctx, r.WANumber, notif); err != nil {
				log.Printf("[HANDLER] Recipient notify error (%s): %v", r.WANumber, err)
			}
		}
	}

	h.db.UpdateOrderStatus(orderID, string(models.OrderStatusWaitingPayment))
	h.db.UpdateConversationState(conversationID, models.StateBooked)
}

// HandlePaymentVerified is called by the LISTEN/NOTIFY dispatcher when admin verifies payment.
func (h *Handler) HandlePaymentVerified(ctx context.Context, orderID, conversationID string) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil || order == nil {
		log.Printf("[HANDLER] HandlePaymentVerified: GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	msg := "✅ *Pembayaran Dikonfirmasi!*\n\nTerima kasih Bapak/Ibu " + order.CustomerName + ", pembayaran Anda telah kami verifikasi.\nPesanan Anda sedang diproses. Terima kasih telah berbelanja di Garindo Jaya Panel! 😊"
	if lang == "en" {
		msg = "✅ *Payment Confirmed!*\n\nThank you " + order.CustomerName + ", your payment has been verified.\nYour order is being processed. Thank you for shopping at Garindo Jaya Panel! 😊"
	}
	if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
		log.Printf("[HANDLER] HandlePaymentVerified: SendText error: %v", err)
	}

	h.db.InsertMessage(conversationID, models.SenderSystem, "PAYMENT_VERIFIED: confirmed by admin")
	h.db.UpdateOrderStatus(orderID, string(models.OrderStatusCompleted))
	h.db.UpdateConversationState(conversationID, models.StateCompleted)

	if order.LeadsID != "" {
		if err := h.db.UpdateLeadStatus(order.LeadsID, models.LeadStatusOrdered); err != nil {
			log.Printf("[HANDLER] UpdateLeadStatus error for lead %s: %v", order.LeadsID, err)
		}
	}
}

// HandlePaymentRejected is called by the LISTEN/NOTIFY dispatcher when admin rejects payment.
// Sends rejection WA to customer and resets order status to WAITING_PAYMENT for re-upload.
func (h *Handler) HandlePaymentRejected(ctx context.Context, orderID, conversationID string) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil || order == nil {
		log.Printf("[HANDLER] HandlePaymentRejected: GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	msg := "⚠️ *Konfirmasi Pembayaran*\n\nKami belum dapat mengkonfirmasi pembayaran Bapak/Ibu " + order.CustomerName + ".\nKemungkinan foto bukti transfer tidak terbaca dengan jelas.\n\nMohon kirim ulang bukti transfer yang valid (foto jelas, nominal terlihat).\nTerima kasih. 🙏"
	if lang == "en" {
		msg = "⚠️ *Payment Confirmation*\n\nWe could not confirm your payment, " + order.CustomerName + ".\nThe transfer proof image may not be clear enough.\n\nPlease resend a valid transfer proof (clear photo, amount visible).\nThank you. 🙏"
	}
	if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
		log.Printf("[HANDLER] HandlePaymentRejected: SendText error: %v", err)
	}

	h.db.InsertMessage(conversationID, models.SenderSystem, "PAYMENT_REJECTED: rejected by admin")
	if err := h.db.RejectPayment(orderID); err != nil {
		log.Printf("[HANDLER] RejectPayment error for order %s: %v", orderID, err)
	}
}

func buildInvoiceMessage(order *models.Order, shippingFee, total float64, lang string, bank *models.BankConfig) string {
	bankName := "BCA"
	bankAccount := "1234567890"
	bankOwner := "Garindo Jaya Panel"
	if bank != nil {
		bankName = bank.BankName
		bankAccount = bank.AccountNumber
		bankOwner = bank.AccountName
	}

	var items string
	for _, item := range order.Items {
		items += fmt.Sprintf("- %s x%d @ Rp %.0f = Rp %.0f\n", item.Name, item.Qty, item.UnitPrice, item.Subtotal)
	}
	if lang == "en" {
		return fmt.Sprintf(`✅ ORDER CONFIRMED

Customer: %s (%s)
Address: %s

Items:
%s
Subtotal: Rp %.0f
Shipping: Rp %.0f
TOTAL: Rp %.0f

Please transfer to:
Bank %s — %s
A/N %s

Payment deadline: 2×24 hours from this message.
Thank you!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
			items, order.Subtotal, shippingFee, total, bankName, bankAccount, bankOwner)
	}
	return fmt.Sprintf(`✅ PESANAN DIKONFIRMASI

Pelanggan: %s (%s)
Alamat: %s

Detail Pesanan:
%s
Subtotal: Rp %.0f
Ongkos Kirim: Rp %.0f
TOTAL: Rp %.0f

Silakan transfer ke:
Bank %s — %s
A/N %s

Batas pembayaran: 2×24 jam sejak pesan ini.
Terima kasih!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
		items, order.Subtotal, shippingFee, total, bankName, bankAccount, bankOwner)
}
