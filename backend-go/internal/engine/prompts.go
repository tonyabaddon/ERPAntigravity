package engine

import (
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// BuildPrompt constructs the full system+context prompt for a given conversation state.
func BuildPrompt(
	state models.ConversationState,
	language string,
	data models.CollectedData,
	history []models.Message,
	stockContext string,
) string {
	system := systemPromptForState(state, language)
	hist := formatHistory(history)
	ctx := ""
	if stockContext != "" {
		ctx = "\n\n## Stock Context\n" + stockContext
	}
	collected := fmt.Sprintf("\n\n## Collected So Far\nname: %q\ncompany: %q\naddress: %q\nproduct: %q\nqty: %d",
		data.Name, data.Company, data.Address, data.Product, data.Quantity)
	return system + collected + ctx + "\n\n## Conversation History\n" + hist
}

func systemPromptForState(state models.ConversationState, language string) string {
	lang := "Bahasa Indonesia"
	if language == "en" {
		lang = "English"
	}

	switch state {
	case models.StateGreeting:
		return fmt.Sprintf(`You are Sari, the AI sales assistant for Garindo Jaya Panel, an electrical components wholesaler in Indonesia.
Greet the customer warmly in %s. Ask how you can help.
Respond ONLY with valid JSON: {"reply": "<your greeting>", "detected_language": "<id or en>"}`, lang)

	case models.StateCollecting:
		return fmt.Sprintf(`You are Sari, collecting order details for Garindo Jaya Panel.
Language: %s. You need: customer name, company name, delivery address, and product they want to order.
Ask for ONE missing field at a time. Be friendly and professional.
If the customer mentions a discount, special price, or something you cannot handle, set next_action to "ESCALATE".
Respond ONLY with valid JSON:
{"reply": "<your message>", "collected": {"name": "", "company": "", "address": "", "product": ""}, "next_action": "CONTINUE|ESCALATE"}`, lang)

	case models.StateClarifying:
		return fmt.Sprintf(`You are Sari, clarifying product specifications for Garindo Jaya Panel.
Language: %s. Ask about quantity, size, color, and any special requirements for the product.
If all specs are clear or customer says they are ready, set next_action to "READY".
If you cannot handle the request (e.g., custom wiring), set next_action to "ESCALATE".
Respond ONLY with valid JSON:
{"reply": "<your message>", "specs": {"qty": 0, "size": "", "color": "", "notes": ""}, "next_action": "CONTINUE|READY|ESCALATE"}`, lang)

	case models.StateStockCheck:
		return fmt.Sprintf(`You are Sari, presenting stock and pricing to a customer at Garindo Jaya Panel.
Language: %s. Present the available products from the Stock Context. If product is available, move to confirmation.
If out of stock or unclear, escalate to admin.
Respond ONLY with valid JSON:
{"reply": "<your message presenting stock/price>", "next_action": "CONFIRM|ESCALATE"}`, lang)

	case models.StateConfirming:
		return fmt.Sprintf(`You are Sari, confirming the order summary for Garindo Jaya Panel.
Language: %s. Present the full order summary and ask the customer to confirm with "OK" or "BENAR".
If they confirm, set confirmed to true. If they want changes, set modification_requested to true.
Respond ONLY with valid JSON:
{"reply": "<order summary + confirmation request>", "confirmed": false, "modification_requested": false}`, lang)

	default:
		return fmt.Sprintf(`You are Sari, the AI sales assistant for Garindo Jaya Panel. Language: %s.
Respond helpfully to the customer's message.
Respond ONLY with valid JSON: {"reply": "<your message>"}`, lang)
	}
}

// StockContextString formats stock items into a compact string for the Gemini prompt.
func StockContextString(items []models.StockItem) string {
	if len(items) == 0 {
		return "No matching products found in stock."
	}
	var sb strings.Builder
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (%s): Rp %.0f, stock: %d\n", item.Name, item.SKU, item.Price, item.Stock))
	}
	return sb.String()
}

// formatHistory converts message history to a readable string for the Gemini prompt.
func formatHistory(msgs []models.Message) string {
	if len(msgs) == 0 {
		return "(no history)"
	}
	var sb strings.Builder
	for _, m := range msgs {
		role := string(m.Sender)
		sb.WriteString(fmt.Sprintf("[%s]: %s\n", strings.ToUpper(role), m.Text))
	}
	return sb.String()
}
