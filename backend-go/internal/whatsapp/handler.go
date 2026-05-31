package whatsapp

import (
	"context"
	"fmt"
	"log"

	"go.mau.fi/whatsmeow/types/events"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/rules"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
)

type Handler struct {
	db         *db.Client
	machine    *engine.Machine
	sender     *Sender
	scheduler  *scheduler.Scheduler
	waNumberID string
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID string) *Handler {
	return &Handler{db: d, machine: m, sender: s, scheduler: sc, waNumberID: waNumberID}
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
		h.handleMediaMessage(evt)
		return
	}

	senderPhone := evt.Info.Sender.User
	go h.processMessage(context.Background(), senderPhone, text)
}

func (h *Handler) processMessage(ctx context.Context, senderPhone, text string) {
	// 1. Keyword rules — fast path, zero LLM cost
	esc := rules.CheckEscalation(text)
	if esc == rules.EscalationWiring {
		h.handleWiringEscalation(ctx, senderPhone, text)
		return
	}

	// 2. Get or create conversation
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// 3. Admin escalation keyword
	if esc == rules.EscalationAdmin {
		h.handleAdminEscalation(ctx, conv, text)
		return
	}

	// 4. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}

	// 5. Insert customer message → Realtime pushes to Sales Inbox
	if _, err := h.db.InsertMessage(conv.ID, models.SenderCustomer, text); err != nil {
		log.Printf("[HANDLER] InsertMessage error: %v", err)
	}

	// 6. Load history
	history, _ := h.db.ListLast10Messages(conv.ID)

	// 7. Build stock context if needed
	stockContext := ""
	if conv.State == models.StateStockCheck || conv.State == models.StateClarifying {
		items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
		stockContext = engine.StockContextString(items)
	}

	// 8. Run state machine
	result, err := h.machine.Process(ctx, conv, text, history, stockContext)
	if err != nil {
		log.Printf("[HANDLER] Machine.Process error: %v", err)
		return
	}

	// 9. Persist state + data before sending reply
	if result.NewData != nil {
		if err := h.db.UpdateCollectedData(conv.ID, *result.NewData, result.ClarificationRound); err != nil {
			log.Printf("[HANDLER] UpdateCollectedData error: %v", err)
		}
	}
	if result.Language != conv.Language {
		h.db.UpdateLanguage(conv.ID, result.Language)
	}
	if result.NextState != conv.State {
		if err := h.db.UpdateConversationState(conv.ID, result.NextState); err != nil {
			log.Printf("[HANDLER] UpdateConversationState error: %v", err)
		}
	}

	// 10. If order just booked, create order row and start timer
	if result.CreateOrder {
		h.handleBooking(ctx, conv)
	}

	// 11. Insert AI reply + send to WA
	if result.Reply != "" {
		h.db.InsertMessage(conv.ID, models.SenderAI, result.Reply)
		if err := h.sender.SendText(ctx, senderPhone, result.Reply); err != nil {
			log.Printf("[HANDLER] SendText error: %v", err)
		}
	}
}

func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation) {
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
	order, err := h.db.CreateOrder(conv, orderItems, subtotal)
	if err != nil {
		log.Printf("[HANDLER] CreateOrder error: %v", err)
		return
	}
	h.scheduler.Schedule(order.ID, order.BookingExpiresAt)
	log.Printf("[HANDLER] Order %s created, timer scheduled until %v", order.ID, order.BookingExpiresAt)
}

func (h *Handler) handleWiringEscalation(ctx context.Context, senderPhone, text string) {
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
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
	h.sender.SendText(ctx, senderPhone, reply)
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
	h.sender.SendText(ctx, conv.CustomerPhone, reply)
}

func (h *Handler) handleMediaMessage(evt *events.Message) {
	senderPhone := evt.Info.Sender.User
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}
	h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	h.sender.SendText(context.Background(), senderPhone, reply)
}

// HandleApprovedOrder is called by the LISTEN/NOTIFY dispatcher when an order is approved.
func (h *Handler) HandleApprovedOrder(ctx context.Context, orderID, conversationID string, shippingFee float64) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil {
		log.Printf("[HANDLER] GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}
	h.scheduler.Cancel(orderID)

	total := order.Subtotal + shippingFee
	invoice := buildInvoiceMessage(order, shippingFee, total, "id")

	h.db.InsertMessage(conversationID, models.SenderSystem, "ORDER_APPROVED: invoice sent")
	if err := h.sender.SendText(ctx, order.CustomerPhone, invoice); err != nil {
		log.Printf("[HANDLER] Invoice send error: %v", err)
	}
	h.db.UpdateOrderStatus(orderID, "COMPLETED")
	h.db.UpdateConversationState(conversationID, models.StateCompleted)
}

func buildInvoiceMessage(order *models.Order, shippingFee, total float64, lang string) string {
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
Bank BCA — 1234567890
A/N Garindo Jaya Panel

Payment deadline: 2×24 hours from this message.
Thank you!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
			items, order.Subtotal, shippingFee, total)
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
Bank BCA — 1234567890
A/N Garindo Jaya Panel

Batas pembayaran: 2×24 jam sejak pesan ini.
Terima kasih!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
		items, order.Subtotal, shippingFee, total)
}
