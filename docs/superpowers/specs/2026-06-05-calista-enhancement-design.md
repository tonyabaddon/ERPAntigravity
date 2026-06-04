# Calista Enhancement — Multi-Product Orders & Conversation Reset

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Customers can order multiple products in one WhatsApp conversation. (2) Customers whose conversation is COMPLETED or CANCELLED can start a new order without being silently ignored.

**Architecture:** Go backend only (no frontend changes). Conversation reset is 5 lines in `handler.go`. Multi-product adds `CartItem`/`Cart` to the data model, a new `STATE_ADD_MORE` conversation state, updated prompts and parsers, and updated order creation.

**Tech Stack:** Go 1.25, Gemini AI (existing client), PostgreSQL/Supabase

---

## Part A: Conversation Reset

### Problem

`handler.go processMessage()` step 5:
```go
if conv.State.IsTerminal() {
    return
}
```

`IsTerminal()` returns true for `COMPLETED`, `CANCELLED`, `ESCALATED_ADMIN`, `ESCALATED_WIRING`. A returning customer who previously ordered (COMPLETED) or whose order was cancelled (CANCELLED) gets silently ignored forever.

### Solution

Before the `IsTerminal()` gate, reset COMPLETED and CANCELLED conversations to GREETING so the customer gets a fresh start. ESCALATED states are left alone — admin is actively handling those.

### Code Change: `backend-go/internal/whatsapp/handler.go`

Inside `processMessage`, after step 4 (admin escalation keyword check), before step 5 (terminal state check):

```go
// Reset completed/cancelled conversations so returning customers can reorder.
// ESCALATED states stay as-is (admin is handling them).
if conv.State == models.StateCompleted || conv.State == models.StateCancelled {
    if err := h.db.UpdateConversationState(conv.ID, models.StateGreeting); err != nil {
        log.Printf("[HANDLER] Reset conv state error for %s: %v", conv.ID, err)
        return
    }
    conv.State = models.StateGreeting
}
```

This is inserted at line ~112, between the `handleAdminEscalation` block and the `IsTerminal()` return.

### Test

Send a message from a phone number whose conversation is in COMPLETED state → Calista greets them again. ESCALATED_ADMIN conversation → still ignored.

---

## Part B: Multi-Product Orders

### Data Model Changes: `backend-go/internal/models/types.go`

Add `CartItem` struct and `Cart` field to `CollectedData`:

```go
type CartItem struct {
    Product  string `json:"product"`
    Quantity int    `json:"quantity"`
    Specs    string `json:"specs"`
}

type CollectedData struct {
    Name     string     `json:"name"`
    Company  string     `json:"company"`
    Product  string     `json:"product"`   // current item being collected
    Quantity int        `json:"quantity"`  // current item qty
    Specs    string     `json:"specs"`     // current item specs
    Address  string     `json:"address"`
    Cart     []CartItem `json:"cart"`      // confirmed items so far
}
```

Add new conversation state:

```go
const (
    // ... existing states ...
    StateAddMore ConversationState = "ADD_MORE"
)
```

Update `IsTerminal()` — `ADD_MORE` is not terminal.

### Conversation Flow

```
GREETING → COLLECTING → CLARIFYING → STOCK_CHECK → CONFIRMING → ADD_MORE
                                                                    │
                                    ┌── "ya/tambah" ────────────────┘
                                    │   (loop: push current item to cart, clear Product/Qty/Specs)
                                    │
                                    └── "tidak/lanjut" → DELIVERY → BOOKED
```

In `ADD_MORE` state, Calista asks: *"Mau tambah produk lain? Balas dengan nama produk berikutnya, atau 'tidak' untuk lanjut checkout."*

If customer names a product → push current item to `Cart`, clear `Product/Qty/Specs`, set state back to `COLLECTING`, Calista continues collecting for the new item.

If customer says tidak/lanjut → push current item to `Cart`, set state to `DELIVERY`.

### State Machine Changes: `backend-go/internal/engine/machine.go`

**CONFIRMING case** (current: `confirmed=true → StateDelivery`):

Change to push the confirmed item to cart and go to `StateAddMore`:

```go
case models.StateConfirming:
    parsed := parser.ParseConfirming(result)
    if parsed.Confirmed {
        // Push current item to cart before asking "add more?"
        newData := conv.CollectedData
        newData.Cart = append(newData.Cart, models.CartItem{
            Product:  conv.CollectedData.Product,
            Quantity: conv.CollectedData.Quantity,
            Specs:    conv.CollectedData.Specs,
        })
        // Clear current item fields
        newData.Product = ""
        newData.Quantity = 0
        newData.Specs = ""
        return ProcessResult{
            Reply:     parsed.Reply,
            NextState: models.StateAddMore,
            NewData:   &newData,
            Language:  parsed.Language,
        }
    }
    // ... existing not-confirmed path ...
```

**New ADD_MORE case:**

```go
case models.StateAddMore:
    parsed := parser.ParseAddMore(result)
    if parsed.AddAnother {
        // Customer wants to add another product — loop back to COLLECTING
        return ProcessResult{
            Reply:     parsed.Reply,
            NextState: models.StateCollecting,
            NewData:   &conv.CollectedData, // cart already populated, Product/Qty/Specs cleared
            Language:  parsed.Language,
        }
    }
    // Customer is done — proceed to delivery
    return ProcessResult{
        Reply:     parsed.Reply,
        NextState: models.StateDelivery,
        NewData:   &conv.CollectedData,
        Language:  parsed.Language,
        // CreateOrder is NOT set here — order is created in DELIVERY state
    }
```

**DELIVERY case** (current: sets `CreateOrder=true`):

No change needed — `handleBooking` in `handler.go` already receives the full conv with Cart populated.

### Parser Changes: `backend-go/internal/engine/parser.go`

Add `AddMoreResponse` and `ParseAddMore`:

```go
type AddMoreResponse struct {
    Reply      string `json:"reply"`
    AddAnother bool   `json:"add_another"` // true = customer wants another product
    Language   string `json:"language"`
}

func ParseAddMore(raw string) AddMoreResponse {
    // JSON parse from Gemini; default add_another=false on parse error
}
```

### Prompt Changes: `backend-go/internal/engine/prompts.go`

**Update CONFIRMING prompt:** After confirming the item, ask if they want to add more — end with the JSON that triggers ADD_MORE state:

```
// At the end of confirmed=true reply, Calista adds:
// "Mau tambah produk lain? Ketik nama produk berikutnya, atau balas 'tidak' untuk lanjut ke pengiriman."
// JSON: { "confirmed": true, "reply": "...", "next_state": "ADD_MORE" }
```

Actually: the CONFIRMING prompt stays mostly the same. The machine code handles the transition to ADD_MORE regardless of what Gemini returns (as long as `confirmed=true`). The reply text just needs to ask the "add more?" question.

Update the CONFIRMING prompt template to end the confirmed reply with: *"Mau tambah produk lain? Balas nama produk berikutnya, atau ketik 'selesai' untuk lanjut ke pengiriman."*

**New ADD_MORE prompt:**

```go
const addMorePrompt = `
Kamu adalah Calista, asisten sales Garindo Jaya Panel.

Konteks: Customer sudah konfirmasi pesanan. Keranjang saat ini:
%s

Customer baru saja membalas. Tentukan apakah mereka ingin tambah produk lain atau sudah selesai.

Format respons JSON:
{
  "reply": "string — respons ke customer dalam bahasa yang sama",
  "add_another": true/false,
  "language": "id" atau "en"
}

Jika add_another=true: reply sambut produk berikutnya dan minta nama/spesifikasi.
Jika add_another=false: reply konfirmasi total keranjang dan informasikan langkah pengiriman.
`
```

`%s` is a formatted cart summary string.

Add `AddMoreContextString(cart []models.CartItem) string` helper to `prompts.go`.

### Order Creation Changes: `backend-go/internal/whatsapp/handler.go` — `handleBooking`

Currently uses `conv.CollectedData.Product` and `conv.CollectedData.Quantity` to find stock and create one order item.

Update to iterate `conv.CollectedData.Cart`:

```go
func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation, leadsID, customerID string, deliveryType models.DeliveryType) {
    var orderItems []models.OrderItem
    var subtotal float64

    cart := conv.CollectedData.Cart
    // Fallback: if Cart is empty, use the legacy single-item fields
    if len(cart) == 0 && conv.CollectedData.Product != "" {
        cart = []models.CartItem{{
            Product:  conv.CollectedData.Product,
            Quantity: conv.CollectedData.Quantity,
        }}
    }

    for _, cartItem := range cart {
        items, _ := h.db.SearchStockByName(cartItem.Product)
        if len(items) == 0 {
            log.Printf("[HANDLER] No stock found for cart item %q", cartItem.Product)
            continue
        }
        item := items[0]
        qty := cartItem.Quantity
        if qty == 0 {
            qty = 1
        }
        sub := item.Price * float64(qty)
        orderItems = append(orderItems, models.OrderItem{
            SKU: item.SKU, Name: item.Name, Qty: qty,
            UnitPrice: item.Price, Subtotal: sub,
        })
        subtotal += sub
    }

    order, err := h.db.CreateOrder(conv, orderItems, subtotal, leadsID, customerID, models.OrderTypeStandard, deliveryType)
    // ... rest unchanged ...
}
```

### DB: `CollectedData` JSON storage

`CollectedData` is stored as JSONB in `conversations.collected_data`. The new `cart` field serializes/deserializes transparently because Go's `encoding/json` handles unknown fields gracefully. No migration needed.

---

## Prompt Format: `database/conversations.collected_data`

When `STATE_ADD_MORE` is reached, the stored `collected_data` JSON looks like:

```json
{
  "name": "Budi Santoso",
  "company": "CV Maju",
  "product": "",
  "quantity": 0,
  "specs": "",
  "address": "",
  "cart": [
    {"product": "MCB Schneider 16A 1P", "quantity": 2, "specs": "16A 1P Schneider"},
    {"product": "Kabel NYM 2.5mm", "quantity": 1, "specs": "NYM 2.5mm 100m"}
  ]
}
```

---

## Tests to Write

### `backend-go/internal/engine/machine_test.go`

- `TestProcess_ConfirmingPushesToCart` — after CONFIRMING with confirmed=true, Cart has 1 item, state=ADD_MORE, Product/Qty/Specs cleared
- `TestProcess_AddMore_AddAnother` — ADD_MORE with add_another=true → state=COLLECTING, Cart unchanged
- `TestProcess_AddMore_Done` — ADD_MORE with add_another=false → state=DELIVERY

### `backend-go/internal/engine/parser_test.go`

- `TestParseAddMore_AddAnother` — JSON with add_another=true parsed correctly
- `TestParseAddMore_Done` — JSON with add_another=false parsed correctly
- `TestParseAddMore_BadJSON` — defaults to add_another=false (safe)

### `backend-go/internal/whatsapp/handler_test.go` (new file)

- `TestHandleBooking_MultipleCartItems` — verifies order created with correct items and subtotal when Cart has 2+ items
- `TestHandleBooking_FallbackSingleItem` — verifies legacy single-item path still works when Cart is empty

---

## Migration Order

1. Deploy Part A (conversation reset) first — it's standalone and has no dependencies.
2. Deploy Part B (multi-product) after Part A is verified working.
