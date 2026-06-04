# Calista Enhancement — Multi-Product Orders & Conversation Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Customers in COMPLETED or CANCELLED state get a fresh conversation instead of being silently ignored. (2) Customers can order multiple products in one WhatsApp conversation, with cart accumulation across CONFIRMING → ADD_MORE → COLLECTING loops, and a single order created at booking.

**Architecture:** Go backend only — no frontend changes. Part A: 5-line conversation reset in `handler.go`. Part B: `CartItem`/`Cart` added to `CollectedData`; `StateAddMore` constant; machine CONFIRMING case pushes to cart then goes to ADD_MORE; new ADD_MORE case; new prompt, parser type, and parser function; `handleBooking` iterates cart. A pure cart-building helper enables unit testing without a DB mock.

**Tech Stack:** Go 1.25, Gemini AI (existing client), PostgreSQL/Supabase

---

## Files

| File | Change |
|---|---|
| `backend-go/internal/whatsapp/handler.go` | Modify — conversation reset (Part A) + handleBooking cart iteration + buildOrderItems helper |
| `backend-go/internal/models/types.go` | Modify — CartItem struct, Cart field in CollectedData, StateAddMore constant |
| `backend-go/internal/engine/parser.go` | Modify — AddMoreResponse + ParseAddMore |
| `backend-go/internal/engine/prompts.go` | Modify — addMorePrompt + AddMoreContextString, update CONFIRMING prompt |
| `backend-go/internal/engine/machine.go` | Modify — CONFIRMING case pushes to cart → ADD_MORE; new ADD_MORE case |
| `backend-go/internal/engine/machine_test.go` | Modify — update TestProcessConfirmingMovesToDelivery; add 3 new tests |
| `backend-go/internal/engine/parser_test.go` | Modify — add 3 ParseAddMore tests |
| `backend-go/internal/whatsapp/handler_test.go` | Create — TestBuildOrderItems_MultipleCart + TestBuildOrderItems_FallbackSingleItem |

---

### Task 1: Conversation reset (Part A)

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`

- [ ] **Step 1: Locate insertion point**

Open `backend-go/internal/whatsapp/handler.go`. Find this block at line ~135:

```go
	// 5. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}
```

The new reset block goes BEFORE this, immediately after the `handleAdminEscalation` block at line ~114.

- [ ] **Step 2: Insert the reset block**

Find the exact block to insert before:

```go
	// 5. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}
```

Insert this new block BEFORE it:

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

After the edit, the sequence should be:

```go
	// Admin escalation (step 4) — the block above line 112

	// Reset COMPLETED/CANCELLED so returning customers get a fresh start
	if conv.State == models.StateCompleted || conv.State == models.StateCancelled {
		if err := h.db.UpdateConversationState(conv.ID, models.StateGreeting); err != nil {
			log.Printf("[HANDLER] Reset conv state error for %s: %v", conv.ID, err)
			return
		}
		conv.State = models.StateGreeting
	}

	// 5a. Post-booking holding states
	if conv.State == models.StateBooked || conv.State == models.StateTimeoutReminder {
		// ...
	}

	// 5. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}
```

- [ ] **Step 3: Run tests**

```bash
cd backend-go && go test ./internal/... 2>&1 | head -30
```

Expected: all tests pass (PASS). No new test needed for Part A — existing tests cover handler flow.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(calista): reset COMPLETED/CANCELLED conv to GREETING on new message"
```

---

### Task 2: Data model — CartItem, Cart field, StateAddMore

**Files:**
- Modify: `backend-go/internal/models/types.go`

- [ ] **Step 1: Add CartItem struct and Cart to CollectedData**

In `types.go`, find `CollectedData` at line 83:

```go
type CollectedData struct {
	Name     string    `json:"name,omitempty"`
	Company  string    `json:"company,omitempty"`
	Address  string    `json:"address,omitempty"`
	Product  string    `json:"product,omitempty"`
	Quantity int       `json:"quantity,omitempty"`
	Specs    SpecsData `json:"specs,omitempty"`
}
```

Replace with:

```go
type CartItem struct {
	Product  string `json:"product"`
	Quantity int    `json:"quantity"`
	Specs    string `json:"specs"`
}

type CollectedData struct {
	Name     string     `json:"name,omitempty"`
	Company  string     `json:"company,omitempty"`
	Address  string     `json:"address,omitempty"`
	Product  string     `json:"product,omitempty"`
	Quantity int        `json:"quantity,omitempty"`
	Specs    SpecsData  `json:"specs,omitempty"`
	Cart     []CartItem `json:"cart,omitempty"`
}
```

- [ ] **Step 2: Add StateAddMore constant**

In `types.go`, find the `const` block with `StateGreeting` at line 7. Add `StateAddMore` after `StateConfirming`:

```go
const (
	StateGreeting        ConversationState = "GREETING"
	StateCollecting      ConversationState = "COLLECTING"
	StateClarifying      ConversationState = "CLARIFYING"
	StateStockCheck      ConversationState = "STOCK_CHECK"
	StateConfirming      ConversationState = "CONFIRMING"
	StateAddMore         ConversationState = "ADD_MORE"
	StateDelivery        ConversationState = "DELIVERY"
	StateBooked          ConversationState = "BOOKED"
	StateTimeoutReminder ConversationState = "TIMEOUT_REMINDER"
	StateCancelled       ConversationState = "CANCELLED"
	StateApproved        ConversationState = "APPROVED"
	StateCompleted       ConversationState = "COMPLETED"
	StateEscalatedAdmin  ConversationState = "ESCALATED_ADMIN"
	StateEscalatedWiring ConversationState = "ESCALATED_WIRING"
)
```

`ADD_MORE` is not terminal, so `IsTerminal()` needs no change.

- [ ] **Step 3: Run tests**

```bash
cd backend-go && go test ./internal/... 2>&1 | head -30
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/models/types.go
git commit -m "feat(models): add CartItem, Cart field in CollectedData, StateAddMore constant"
```

---

### Task 3: Parser — AddMoreResponse and ParseAddMore

**Files:**
- Modify: `backend-go/internal/engine/parser.go`

- [ ] **Step 1: Add AddMoreResponse and ParseAddMore**

At the end of `parser.go` (after the last function), add:

```go
// AddMoreResponse is the JSON shape Gemini returns in ADD_MORE state.
type AddMoreResponse struct {
	Reply      string `json:"reply"`
	AddAnother bool   `json:"add_another"`
	Language   string `json:"language"`
}

func ParseAddMore(raw string) AddMoreResponse {
	var r AddMoreResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return AddMoreResponse{AddAnother: false}
	}
	return r
}
```

- [ ] **Step 2: Write failing tests**

In `backend-go/internal/engine/parser_test.go`, add these test functions at the end:

```go
func TestParseAddMore_AddAnother(t *testing.T) {
	raw := `{"reply":"Oke, silakan sebutkan produk berikutnya.","add_another":true,"language":"id"}`
	got := ParseAddMore(raw)
	if !got.AddAnother {
		t.Error("expected add_another=true")
	}
	if got.Reply == "" {
		t.Error("expected non-empty reply")
	}
	if got.Language != "id" {
		t.Errorf("expected language id, got %s", got.Language)
	}
}

func TestParseAddMore_Done(t *testing.T) {
	raw := `{"reply":"Oke, lanjut ke pengiriman.","add_another":false,"language":"id"}`
	got := ParseAddMore(raw)
	if got.AddAnother {
		t.Error("expected add_another=false")
	}
}

func TestParseAddMore_BadJSON(t *testing.T) {
	got := ParseAddMore("not-json")
	if got.AddAnother {
		t.Error("bad JSON should default to add_another=false")
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend-go && go test ./internal/engine/... -run TestParseAddMore -v
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/engine/parser.go backend-go/internal/engine/parser_test.go
git commit -m "feat(parser): add AddMoreResponse and ParseAddMore for ADD_MORE state"
```

---

### Task 4: Prompts — addMorePrompt, AddMoreContextString, update CONFIRMING

**Files:**
- Modify: `backend-go/internal/engine/prompts.go`

- [ ] **Step 1: Add AddMoreContextString helper**

In `prompts.go`, at the end of the file, add:

```go
// AddMoreContextString formats the current cart for the ADD_MORE prompt.
func AddMoreContextString(cart []models.CartItem) string {
	if len(cart) == 0 {
		return "(keranjang kosong)"
	}
	var sb strings.Builder
	for i, item := range cart {
		specs := item.Specs
		if specs == "" {
			specs = "-"
		}
		sb.WriteString(fmt.Sprintf("%d. %s — qty: %d, spek: %s\n", i+1, item.Product, item.Quantity, specs))
	}
	return strings.TrimSpace(sb.String())
}
```

- [ ] **Step 2: Add ADD_MORE state case to stateInstructions**

In `stateInstructions` switch, add a case for `models.StateAddMore` after the `models.StateDelivery` case:

```go
	case models.StateAddMore:
		cartStr := AddMoreContextString(c.Cart)
		return fmt.Sprintf(`FASE: TAMBAH PRODUK (ADD_MORE)
Keranjang saat ini:
%s

Customer baru saja membalas. Tentukan apakah mereka ingin tambah produk lain atau sudah selesai.

Format respons JSON:
{
  "reply": "string — respons ke customer dalam bahasa yang sama",
  "add_another": true/false,
  "language": "id" atau "en"
}

Jika add_another=true: sambut produk berikutnya dan minta nama produk.
Jika add_another=false: konfirmasi isi keranjang dan informasikan langkah pengiriman.

Balas HANYA JSON (tidak ada teks lain).`, cartStr)
```

- [ ] **Step 3: Update CONFIRMING prompt to ask "add more?" after confirmation**

In `stateInstructions`, find the `models.StateConfirming` case. It currently reads:

```go
	case models.StateConfirming:
		return fmt.Sprintf(`FASE: KONFIRMASI PESANAN (CONFIRMING)
...
```

Find the confirmed=true reply instructions and add this sentence at the end of the confirmed reply instruction. The exact text varies, but look for the confirmed path description and add:

Specifically, find the part of the CONFIRMING prompt body that describes the `confirmed: true` reply and ensure it ends with instructions to ask about adding more products. The full prompt for this state should be updated to include at the end of its confirmed=true reply:

*"Jika customer mengkonfirmasi (`confirmed: true`), tambahkan kalimat: 'Mau tambah produk lain? Ketik nama produk berikutnya, atau balas 'selesai' untuk lanjut ke pengiriman.'"*

To find the exact location, search for `StateConfirming` in `prompts.go` and update that case. Add this line inside the prompt text for the confirmed=true scenario.

(The machine code handles the ADD_MORE transition regardless of Gemini's reply — the prompt update just ensures the reply text asks the customer about adding more items.)

- [ ] **Step 4: Build to verify**

```bash
cd backend-go && go build ./...
```

Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/engine/prompts.go
git commit -m "feat(prompts): add ADD_MORE state prompt, AddMoreContextString helper"
```

---

### Task 5: Machine — CONFIRMING pushes to cart, new ADD_MORE case

**Files:**
- Modify: `backend-go/internal/engine/machine.go`
- Modify: `backend-go/internal/engine/machine_test.go`

- [ ] **Step 1: Write failing tests first**

In `machine_test.go`, update `TestProcessConfirmingMovesToDelivery` (line ~72) to expect `StateAddMore`:

```go
func TestProcessConfirmingMovesToAddMore(t *testing.T) {
	m := newTestMachine(`{"reply":"Pesanan dikonfirmasi! Mau tambah produk lain?","confirmed":true,"modification_requested":false}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Product: "Kabel 40A", Quantity: 2,
		},
	}
	result, err := m.Process(context.Background(), conv, "OK", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateAddMore {
		t.Errorf("confirmed → expected ADD_MORE, got %s", result.NextState)
	}
	if result.NewData == nil {
		t.Fatal("NewData should not be nil after confirmation")
	}
	if len(result.NewData.Cart) != 1 {
		t.Errorf("expected 1 item in cart, got %d", len(result.NewData.Cart))
	}
	if result.NewData.Cart[0].Product != "Kabel 40A" {
		t.Errorf("expected cart item Product=Kabel 40A, got %s", result.NewData.Cart[0].Product)
	}
	if result.NewData.Product != "" {
		t.Errorf("Product field should be cleared after push to cart, got %s", result.NewData.Product)
	}
}
```

Add tests for ADD_MORE state:

```go
func TestProcessAddMore_AddAnother(t *testing.T) {
	m := newTestMachine(`{"reply":"Oke, produk apa berikutnya?","add_another":true,"language":"id"}`)
	conv := &models.Conversation{
		State:    models.StateAddMore,
		Language: "id",
		CollectedData: models.CollectedData{
			Cart: []models.CartItem{{Product: "Kabel 40A", Quantity: 2, Specs: "40A"}},
		},
	}
	result, err := m.Process(context.Background(), conv, "tambah", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateCollecting {
		t.Errorf("add_another=true → expected COLLECTING, got %s", result.NextState)
	}
}

func TestProcessAddMore_Done(t *testing.T) {
	m := newTestMachine(`{"reply":"Oke, lanjut ke pengiriman.","add_another":false,"language":"id"}`)
	conv := &models.Conversation{
		State:    models.StateAddMore,
		Language: "id",
		CollectedData: models.CollectedData{
			Cart: []models.CartItem{{Product: "Kabel 40A", Quantity: 2, Specs: "40A"}},
		},
	}
	result, err := m.Process(context.Background(), conv, "tidak", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateDelivery {
		t.Errorf("add_another=false → expected DELIVERY, got %s", result.NextState)
	}
}
```

Also rename the old `TestProcessConfirmingMovesToDelivery` test to `TestProcessConfirmingModificationRequestedMovesClarifying` and update it to test the modification_requested path (not the confirmed path):

```go
func TestProcessConfirmingModificationRequestedMovesClarifying(t *testing.T) {
	m := newTestMachine(`{"reply":"Baik, mari perbaiki pesanan.","confirmed":false,"modification_requested":true}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "ganti", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateClarifying {
		t.Errorf("modification_requested → expected CLARIFYING, got %s", result.NextState)
	}
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend-go && go test ./internal/engine/... -run "TestProcessConfirmingMovesToAddMore|TestProcessAddMore" -v
```

Expected: FAIL — `StateAddMore` not handled in machine yet.

- [ ] **Step 3: Update CONFIRMING case in machine.go**

In `machine.go`, find the `case models.StateConfirming:` block (line ~140). Replace:

```go
	case models.StateConfirming:
		resp, err := ParseConfirming(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse confirming error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.Confirmed {
			result.NextState = models.StateDelivery
		} else if resp.ModificationRequested {
			result.NextState = models.StateClarifying
			result.ClarificationRound = 0
		}
```

With:

```go
	case models.StateConfirming:
		resp, err := ParseConfirming(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse confirming error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.Confirmed {
			newData := conv.CollectedData
			specsStr := strings.TrimSpace(
				newData.Specs.Size + " " + newData.Specs.Color + " " + newData.Specs.Notes,
			)
			newData.Cart = append(newData.Cart, models.CartItem{
				Product:  newData.Product,
				Quantity: newData.Quantity,
				Specs:    specsStr,
			})
			newData.Product = ""
			newData.Quantity = 0
			newData.Specs = models.SpecsData{}
			result.NewData = &newData
			result.NextState = models.StateAddMore
		} else if resp.ModificationRequested {
			result.NextState = models.StateClarifying
			result.ClarificationRound = 0
		}
```

- [ ] **Step 4: Add ADD_MORE case in machine.go**

In `machine.go`, after the `case models.StateConfirming:` block and before the `case models.StateDelivery:` block, add:

```go
	case models.StateAddMore:
		parsed := ParseAddMore(rawJSON)
		result.Reply = parsed.Reply
		if parsed.Language != "" {
			result.Language = parsed.Language
		}
		if parsed.AddAnother {
			result.NextState = models.StateCollecting
		} else {
			result.NextState = models.StateDelivery
		}
```

- [ ] **Step 5: Add "strings" import to machine.go if not already present**

Check the imports in `machine.go`. If `strings` is not imported, add it:

```go
import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
cd backend-go && go test ./internal/engine/... -v 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/engine/machine.go backend-go/internal/engine/machine_test.go
git commit -m "feat(machine): CONFIRMING pushes to cart→ADD_MORE; add ADD_MORE state handler"
```

---

### Task 6: handleBooking — iterate Cart for multi-product orders

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`
- Create: `backend-go/internal/whatsapp/handler_test.go`

- [ ] **Step 1: Extract buildOrderItems pure helper**

In `handler.go`, add this function after `handleBooking`:

```go
// buildOrderItems constructs OrderItems from a cart, using lookup to resolve stock data.
// Returns empty slice and zero subtotal if lookup returns no results for a cart item.
func buildOrderItems(cart []models.CartItem, lookup func(string) ([]models.StockItem, error)) ([]models.OrderItem, float64) {
	var items []models.OrderItem
	var subtotal float64
	for _, cartItem := range cart {
		stockItems, _ := lookup(cartItem.Product)
		if len(stockItems) == 0 {
			log.Printf("[HANDLER] buildOrderItems: no stock found for %q", cartItem.Product)
			continue
		}
		stock := stockItems[0]
		qty := cartItem.Quantity
		if qty == 0 {
			qty = 1
		}
		sub := stock.Price * float64(qty)
		items = append(items, models.OrderItem{
			SKU: stock.SKU, Name: stock.Name, Qty: qty,
			UnitPrice: stock.Price, Subtotal: sub,
		})
		subtotal += sub
	}
	return items, subtotal
}
```

- [ ] **Step 2: Update handleBooking to use Cart**

Replace the existing `handleBooking` function body:

```go
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
```

With:

```go
func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation, leadsID, customerID string, deliveryType models.DeliveryType) {
	cart := conv.CollectedData.Cart
	// Fallback: if Cart is empty, use legacy single-item fields
	if len(cart) == 0 && conv.CollectedData.Product != "" {
		cart = []models.CartItem{{
			Product:  conv.CollectedData.Product,
			Quantity: conv.CollectedData.Quantity,
		}}
	}
	if len(cart) == 0 {
		log.Printf("[HANDLER] Warning: no cart items for conv %s, order will be empty", conv.ID)
	}

	orderItems, subtotal := buildOrderItems(cart, func(product string) ([]models.StockItem, error) {
		return h.db.SearchStockByName(product)
	})

	order, err := h.db.CreateOrder(conv, orderItems, subtotal, leadsID, customerID, models.OrderTypeStandard, deliveryType)
	if err != nil {
		log.Printf("[HANDLER] CreateOrder error: %v", err)
		return
	}
	h.scheduler.Schedule(order.ID, order.BookingExpiresAt)
	log.Printf("[HANDLER] Order %s created, timer scheduled until %v", order.ID, order.BookingExpiresAt)
}
```

- [ ] **Step 3: Write tests for buildOrderItems**

Create `backend-go/internal/whatsapp/handler_test.go`:

```go
package whatsapp

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildOrderItems_MultipleCart(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Kabel 40A", Quantity: 2},
		{Product: "MCB 16A", Quantity: 1},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		switch product {
		case "Kabel 40A":
			return []models.StockItem{{SKU: "kbl-1", Name: "Kabel 40A", Price: 100000}}, nil
		case "MCB 16A":
			return []models.StockItem{{SKU: "mcb-1", Name: "MCB 16A", Price: 50000}}, nil
		}
		return nil, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 2 {
		t.Fatalf("expected 2 order items, got %d", len(items))
	}
	if items[0].SKU != "kbl-1" {
		t.Errorf("expected first item SKU=kbl-1, got %s", items[0].SKU)
	}
	if items[0].Qty != 2 {
		t.Errorf("expected first item Qty=2, got %d", items[0].Qty)
	}
	expectedSubtotal := float64(100000*2 + 50000*1)
	if subtotal != expectedSubtotal {
		t.Errorf("expected subtotal=%.0f, got %.0f", expectedSubtotal, subtotal)
	}
}

func TestBuildOrderItems_FallbackSingleItem(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Panel Besi", Quantity: 0},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		return []models.StockItem{{SKU: "pnl-1", Name: "Panel Besi", Price: 850000}}, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 1 {
		t.Fatalf("expected 1 order item, got %d", len(items))
	}
	if items[0].Qty != 1 {
		t.Errorf("qty=0 should default to 1, got %d", items[0].Qty)
	}
	if subtotal != 850000 {
		t.Errorf("expected subtotal=850000, got %.0f", subtotal)
	}
}

func TestBuildOrderItems_MissingStock(t *testing.T) {
	cart := []models.CartItem{
		{Product: "Tidak Ada", Quantity: 1},
	}
	lookup := func(product string) ([]models.StockItem, error) {
		return nil, nil
	}

	items, subtotal := buildOrderItems(cart, lookup)

	if len(items) != 0 {
		t.Errorf("missing stock → expected 0 items, got %d", len(items))
	}
	if subtotal != 0 {
		t.Errorf("expected subtotal=0, got %.0f", subtotal)
	}
}
```

- [ ] **Step 4: Run all tests**

```bash
cd backend-go && go test ./internal/... -v 2>&1 | tail -30
```

Expected: all tests PASS including the 3 new handler tests.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go backend-go/internal/whatsapp/handler_test.go
git commit -m "feat(handler): multi-product cart support in handleBooking, add buildOrderItems helper"
```

---

### Task 7: Build, smoke-test, push

- [ ] **Step 1: Full build**

```bash
cd backend-go && go build ./...
```

Expected: no errors.

- [ ] **Step 2: Full test suite**

```bash
cd backend-go && go test ./internal/... 2>&1
```

Expected: all PASS.

- [ ] **Step 3: Update progress.md**

Add at the end of `progress.md`:

```markdown
## Calista Enhancement — DONE (2026-06-05)

### Part A: Conversation Reset
- `handler.go processMessage`: COMPLETED/CANCELLED conversations are reset to GREETING before the terminal-state gate
- Returning customers get a fresh start; ESCALATED_ADMIN/ESCALATED_WIRING stay untouched (admin handling)

### Part B: Multi-Product Orders
- `models/types.go`: Added `CartItem` struct; `Cart []CartItem` field in `CollectedData`; `StateAddMore` constant
- `engine/parser.go`: Added `AddMoreResponse` + `ParseAddMore` (defaults add_another=false on bad JSON)
- `engine/prompts.go`: Added `ADD_MORE` state prompt; `AddMoreContextString(cart)` helper
- `engine/machine.go`: CONFIRMING confirmed=true now pushes item to Cart, clears Product/Qty/Specs, goes to ADD_MORE
- `engine/machine.go`: New ADD_MORE case — add_another=true → COLLECTING; add_another=false → DELIVERY
- `handler.go handleBooking`: Iterates Cart to build order items; fallback to single-item legacy path if Cart empty
- `handler.go buildOrderItems`: Pure helper function for cart→order-items conversion (enables unit testing)
- Tests: 3 machine tests, 3 parser tests, 3 handler buildOrderItems tests
```

- [ ] **Step 4: Commit and push**

```bash
git add progress.md
git commit -m "docs(progress): record Calista enhancement completion"
git push origin main
```

Expected: Cloud Build triggers backend deploy.
