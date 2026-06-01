# Calista System Prompt Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject the full Calista system prompt into every Gemini API call via `model.SystemInstruction`, replacing the current generic "Sari" prompts with the actual Garindo Jaya Panel SOP.

**Architecture:** A new `internal/assets` package uses `//go:embed` to bake `calista_system_prompt.txt` into the binary at compile time. `gemini.NewClient` accepts the system prompt as a third argument and sets `model.SystemInstruction` once at construction. `engine/prompts.go` is rewritten to output only state-specific JSON format instructions (no persona), since Calista's identity and product knowledge now live in SystemInstruction.

**Tech Stack:** Go 1.25, `github.com/google/generative-ai-go/genai` v0.19.0, `//go:embed` (stdlib)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend-go/internal/assets/calista_system_prompt.txt` | **Create** | Copy of the canonical `.txt`; embedded into binary |
| `backend-go/internal/assets/prompts.go` | **Create** | Exports `CalistaSystemPrompt string` via `//go:embed` |
| `backend-go/internal/gemini/client.go` | **Modify** | `NewClient` gains `systemPrompt string` param; sets `model.SystemInstruction` |
| `backend-go/main.go` | **Modify** | Pass `assets.CalistaSystemPrompt` to `gemini.NewClient` |
| `backend-go/internal/engine/prompts_test.go` | **Create** | Tests that `BuildPrompt` outputs correct JSON shape per state |
| `backend-go/internal/engine/prompts.go` | **Modify** | Rewritten: state context + JSON format constraint only (no persona) |

**Not changing:** `GeminiClient` interface, `machine.go`, `parser.go`, `machine_test.go`, `handler.go`, all `db/` files, all React files.

---

## Task 1: Create assets package with embedded Calista prompt

**Files:**
- Create: `backend-go/internal/assets/calista_system_prompt.txt`
- Create: `backend-go/internal/assets/prompts.go`

- [ ] **Step 1: Create the assets directory and copy the prompt file**

Run from repo root:
```bash
mkdir -p backend-go/internal/assets
cp "AI Sales Admin Toko/garindo_jaya_panel_system_prompt.txt" backend-go/internal/assets/calista_system_prompt.txt
```

Expected: `backend-go/internal/assets/calista_system_prompt.txt` exists (1153-line Calista prompt).

- [ ] **Step 2: Create `backend-go/internal/assets/prompts.go`**

```go
package assets

import _ "embed"

//go:embed calista_system_prompt.txt
var CalistaSystemPrompt string
```

The `import _ "embed"` is mandatory — without it, the `//go:embed` directive is silently ignored and `CalistaSystemPrompt` will be an empty string at runtime.

- [ ] **Step 3: Build check**

Run from `backend-go/`:
```bash
CGO_ENABLED=1 go build ./internal/assets/...
```

Expected: No errors.

- [ ] **Step 4: Verify embed is non-empty**

Run from `backend-go/`:
```bash
CGO_ENABLED=1 go run -v . 2>&1 | head -5 || true
# Or quick check via test:
cat > /tmp/check_embed_test.go << 'EOF'
package assets_test
import (
  "testing"
  "github.com/username/sinar-elektrik-backend/internal/assets"
)
func TestCalistaPromptNotEmpty(t *testing.T) {
  if len(assets.CalistaSystemPrompt) < 1000 {
    t.Errorf("CalistaSystemPrompt too short (%d chars) — embed likely failed", len(assets.CalistaSystemPrompt))
  }
}
EOF
```

Actually, just verify the file size is correct:
```bash
wc -c backend-go/internal/assets/calista_system_prompt.txt
```

Expected: ~45000+ bytes (the full 1153-line prompt).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/assets/
git commit -m "feat(go): add assets package with embedded Calista system prompt"
```

---

## Task 2: Update Gemini client to accept system prompt + wire into main.go

**Files:**
- Modify: `backend-go/internal/gemini/client.go`
- Modify: `backend-go/main.go`

- [ ] **Step 1: Update `backend-go/internal/gemini/client.go`**

Change `NewClient` to accept a third parameter `systemPrompt string` and set `model.SystemInstruction` at construction time. The current file is:

```go
func NewClient(ctx context.Context, apiKey string) (*Client, error) {
    gc, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
    if err != nil {
        return nil, fmt.Errorf("gemini: new client: %w", err)
    }
    model := gc.GenerativeModel("gemini-3.5-flash")
    model.ResponseMIMEType = "application/json"
    return &Client{model: model, gc: gc}, nil
}
```

Replace with:

```go
func NewClient(ctx context.Context, apiKey, systemPrompt string) (*Client, error) {
    gc, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
    if err != nil {
        return nil, fmt.Errorf("gemini: new client: %w", err)
    }
    model := gc.GenerativeModel("gemini-3.5-flash")
    model.ResponseMIMEType = "application/json"
    model.SystemInstruction = &genai.Content{
        Parts: []genai.Part{genai.Text(systemPrompt)},
    }
    return &Client{model: model, gc: gc}, nil
}
```

Nothing else in `client.go` changes. `GenerateReply` and `Close` are untouched.

- [ ] **Step 2: Update `backend-go/main.go` to pass the system prompt**

Find this line (line 37):
```go
geminiClient, err := gemini.NewClient(ctx, cfg.GeminiAPIKey)
```

Replace with:
```go
geminiClient, err := gemini.NewClient(ctx, cfg.GeminiAPIKey, assets.CalistaSystemPrompt)
```

Also add the assets import. The current import block in `main.go` starts at line 3. Add `"github.com/username/sinar-elektrik-backend/internal/assets"` to the internal imports group:

```go
import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "strings"
    "syscall"
    "time"

    _ "github.com/lib/pq"
    "github.com/username/sinar-elektrik-backend/config"
    "github.com/username/sinar-elektrik-backend/internal/assets"
    "github.com/username/sinar-elektrik-backend/internal/db"
    "github.com/username/sinar-elektrik-backend/internal/engine"
    "github.com/username/sinar-elektrik-backend/internal/gemini"
    "github.com/username/sinar-elektrik-backend/internal/models"
    "github.com/username/sinar-elektrik-backend/internal/scheduler"
    "github.com/username/sinar-elektrik-backend/internal/whatsapp"
)
```

- [ ] **Step 3: Full build check**

Run from `backend-go/`:
```bash
CGO_ENABLED=1 go build ./...
```

Expected: No errors. This confirms the new `NewClient` signature compiles and `assets.CalistaSystemPrompt` resolves correctly.

- [ ] **Step 4: Run all existing tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All tests pass. The `mockGemini` in `machine_test.go` implements `GeminiClient` (which only has `GenerateReply`) — it does not call `NewClient`, so it is unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/gemini/client.go backend-go/main.go
git commit -m "feat(go): wire Calista system prompt into Gemini client via SystemInstruction"
```

---

## Task 3: Rewrite engine/prompts.go with state-specific JSON format instructions

**Files:**
- Create: `backend-go/internal/engine/prompts_test.go`
- Modify: `backend-go/internal/engine/prompts.go`

### Step 3a: Write the failing tests first

- [ ] **Step 1: Create `backend-go/internal/engine/prompts_test.go`**

```go
package engine

import (
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildPromptGreeting(t *testing.T) {
	result := BuildPrompt(models.StateGreeting, "id", models.CollectedData{}, nil, "")
	if !strings.Contains(result, "GREETING") {
		t.Error("greeting prompt must name the current state")
	}
	if !strings.Contains(result, "detected_language") {
		t.Error("greeting prompt must include detected_language in JSON format")
	}
	if !strings.Contains(result, "JSON") {
		t.Error("greeting prompt must instruct JSON-only output")
	}
}

func TestBuildPromptCollectingIncludesCollectedData(t *testing.T) {
	data := models.CollectedData{Name: "Budi Santoso", Product: "Panel Besi 60x40x20"}
	result := BuildPrompt(models.StateCollecting, "id", data, nil, "")
	if !strings.Contains(result, "Budi Santoso") {
		t.Error("collecting prompt must include customer name in context")
	}
	if !strings.Contains(result, "Panel Besi 60x40x20") {
		t.Error("collecting prompt must include product name in context")
	}
	if !strings.Contains(result, "next_action") {
		t.Error("collecting prompt must specify next_action in JSON format")
	}
}

func TestBuildPromptCollectingListsMissingFields(t *testing.T) {
	data := models.CollectedData{Name: "Budi"} // company, address, product all missing
	result := BuildPrompt(models.StateCollecting, "id", data, nil, "")
	if !strings.Contains(result, "perusahaan") {
		t.Error("collecting prompt must mention missing company field in Indonesian")
	}
	if !strings.Contains(result, "alamat") {
		t.Error("collecting prompt must mention missing address field in Indonesian")
	}
}

func TestBuildPromptClarifyingIncludesProductAndSpecs(t *testing.T) {
	data := models.CollectedData{
		Product:  "MCB Schneider 16A",
		Quantity: 10,
		Specs:    models.SpecsData{Size: "1P"},
	}
	result := BuildPrompt(models.StateClarifying, "id", data, nil, "")
	if !strings.Contains(result, "MCB Schneider 16A") {
		t.Error("clarifying prompt must include product name in context")
	}
	if !strings.Contains(result, "clarification_round") {
		t.Error("clarifying prompt must include clarification_round in JSON format")
	}
}

func TestBuildPromptStockCheckIncludesStockContext(t *testing.T) {
	data := models.CollectedData{Product: "MCB", Quantity: 5}
	stockCtx := StockContextString([]models.StockItem{
		{SKU: "MCB001", Name: "MCB Schneider 16A", Price: 45000, Stock: 20},
	})
	result := BuildPrompt(models.StateStockCheck, "id", data, nil, stockCtx)
	if !strings.Contains(result, "MCB001") {
		t.Error("stock_check prompt must include stock context data")
	}
	if !strings.Contains(result, "CONFIRM") {
		t.Error("stock_check prompt must mention CONFIRM as a valid next_action value")
	}
}

func TestBuildPromptConfirmingIncludesOrderSummaryAndBothBoolFields(t *testing.T) {
	data := models.CollectedData{
		Name: "Budi", Company: "CV Maju", Product: "MCB Schneider", Quantity: 5,
	}
	result := BuildPrompt(models.StateConfirming, "id", data, nil, "")
	if !strings.Contains(result, "Budi") {
		t.Error("confirming prompt must include customer name in order summary")
	}
	if !strings.Contains(result, "confirmed") {
		t.Error("confirming prompt must include confirmed bool field in JSON format")
	}
	if !strings.Contains(result, "modification_requested") {
		t.Error("confirming prompt must include modification_requested bool field in JSON format")
	}
}

func TestStockContextStringEmpty(t *testing.T) {
	result := StockContextString(nil)
	if result == "" {
		t.Error("empty stock list must return non-empty fallback message")
	}
	result2 := StockContextString([]models.StockItem{})
	if result2 == "" {
		t.Error("empty stock slice must return non-empty fallback message")
	}
}

func TestStockContextStringWithItems(t *testing.T) {
	items := []models.StockItem{
		{SKU: "MCB001", Name: "MCB Schneider 16A", Price: 45000, Stock: 20},
	}
	result := StockContextString(items)
	if !strings.Contains(result, "MCB001") {
		t.Error("must include SKU")
	}
	if !strings.Contains(result, "45000") {
		t.Error("must include price")
	}
	if !strings.Contains(result, "20") {
		t.Error("must include stock quantity")
	}
}

func TestOrBelum(t *testing.T) {
	if orBelum("") != "belum diketahui" {
		t.Errorf("empty string: got %q, want 'belum diketahui'", orBelum(""))
	}
	if orBelum("Budi") != "Budi" {
		t.Errorf("non-empty string: got %q, want 'Budi'", orBelum("Budi"))
	}
}

func TestMissingFieldsAllMissing(t *testing.T) {
	result := missingFields(models.CollectedData{})
	if !strings.Contains(result, "nama") {
		t.Error("must list nama as missing")
	}
	if !strings.Contains(result, "perusahaan") {
		t.Error("must list perusahaan as missing")
	}
}

func TestMissingFieldsNoneMissing(t *testing.T) {
	data := models.CollectedData{Name: "A", Company: "B", Address: "C", Product: "D"}
	result := missingFields(data)
	if strings.Contains(result, "nama") || strings.Contains(result, "perusahaan") {
		t.Error("must not list fields that are already filled")
	}
}
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/engine/... -v -run "TestBuildPrompt|TestStockContext|TestOrBelum|TestMissingFields" 2>&1 | tail -20
```

Expected: Most tests FAIL because the current `prompts.go` uses English, "Sari", and doesn't include "GREETING", "detected_language", "CONFIRM", etc. in the expected places. `TestOrBelum` and `TestMissingFields` FAIL because `orBelum` and the Indonesian field names don't exist yet.

### Step 3b: Rewrite prompts.go

- [ ] **Step 3: Replace the full content of `backend-go/internal/engine/prompts.go`**

```go
package engine

import (
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// BuildPrompt returns the state-specific JSON format instruction for Gemini.
// Calista's persona and product knowledge are already set as the model's
// SystemInstruction — this prompt only provides current state context and
// the required JSON output shape.
func BuildPrompt(
	state models.ConversationState,
	language string,
	data models.CollectedData,
	history []models.Message,
	stockContext string,
) string {
	statePrompt := stateInstructions(state, data, stockContext)
	hist := formatHistory(history)
	return statePrompt + "\n\n## Riwayat percakapan:\n" + hist
}

func stateInstructions(state models.ConversationState, c models.CollectedData, stockCtx string) string {
	switch state {
	case models.StateGreeting:
		return `FASE: GREETING
Pelanggan baru mengirim pesan pertama.

Sambut pelanggan sebagai Calista dari Garindo Jaya Panel (ikuti SOP Fase 1).
Deteksi bahasa: "id" untuk Bahasa Indonesia, "en" untuk English.

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan sambutan WA>","detected_language":"id"}`

	case models.StateCollecting:
		missing := missingFields(c)
		return fmt.Sprintf(`FASE: PENGUMPULAN DATA (COLLECTING)
Data terkumpul sejauh ini:
- Nama       : %s
- Perusahaan : %s
- Alamat     : %s
- Produk     : %s

Data masih dibutuhkan: %s

Ikuti SOP Fase 1 & 1.5. Tanyakan SATU data yang masih kurang dalam 1 pesan.
Jika customer sebut wiring/instalasi/custom/IP rating → next_action: ESCALATE_WIRING
Jika customer minta diskon/harga khusus → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","collected":{"name":"<isi atau kosong>","company":"<isi atau kosong>","address":"<isi atau kosong>","product":"<isi atau kosong>"},"next_action":"CONTINUE"}`,
			orBelum(c.Name), orBelum(c.Company), orBelum(c.Address), orBelum(c.Product), missing)

	case models.StateClarifying:
		return fmt.Sprintf(`FASE: KLARIFIKASI SPESIFIKASI (CLARIFYING)
Produk yang diminta: %s
Spesifikasi terkumpul sejauh ini:
- Qty    : %d
- Ukuran : %s
- Warna  : %s
- Catatan: %s

Ikuti SOP Fase 1.5 (checklist klarifikasi sesuai material/tipe produk).
Tanyakan SATU spesifikasi yang masih kurang dalam 1 pesan.
Jika spesifikasi sudah cukup → next_action: READY
Jika perlu eskalasi (custom ukuran, IP rating, wiring, dll) → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","specs":{"product":"<isi>","qty":<angka>,"size":"<isi>","color":"<isi>","notes":"<isi>"},"next_action":"CONTINUE","clarification_round":<angka>}`,
			orBelum(c.Product), c.Quantity,
			orBelum(c.Specs.Size), orBelum(c.Specs.Color), orBelum(c.Specs.Notes))

	case models.StateStockCheck:
		qty := c.Quantity
		if qty == 0 {
			qty = 1
		}
		return fmt.Sprintf(`FASE: CEK STOK & PENAWARAN HARGA (STOCK_CHECK)
Produk yang diminta: %s
Qty yang dibutuhkan: %d

Data stok dari sistem:
%s

Ikuti SOP Fase 2 Kategori 1 Skenario 1a/1c. Tampilkan nama produk, harga satuan (Rupiah), qty, subtotal.
Format pesan sesuai template ringkasan pesanan di system prompt.
Jika produk tersedia → next_action: CONFIRM
Jika produk tidak ditemukan atau stok 0 → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA ringkasan harga>","next_action":"CONFIRM"}`,
			orBelum(c.Product), qty, stockCtx)

	case models.StateConfirming:
		qty := c.Quantity
		if qty == 0 {
			qty = 1
		}
		return fmt.Sprintf(`FASE: KONFIRMASI PESANAN (CONFIRMING)
Ringkasan pesanan untuk dikonfirmasi:
- Nama       : %s
- Perusahaan : %s
- Produk     : %s
- Qty        : %d
- Ukuran     : %s
- Catatan    : %s

Ikuti SOP Skenario 1a. Tunggu konfirmasi pelanggan.
Jika customer balas OK/Oke/BENAR/Yes/Confirm/setuju/iya → confirmed: true
Jika customer minta ubah/ganti/revisi → modification_requested: true
Jika tidak jelas → minta konfirmasi ulang dengan sopan

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","confirmed":false,"modification_requested":false}`,
			orBelum(c.Name), orBelum(c.Company), orBelum(c.Product),
			qty, orBelum(c.Specs.Size), orBelum(c.Specs.Notes))

	default:
		return `FASE: TIDAK DIKETAHUI
Balas HANYA JSON: {"reply":"<pesan WA>"}`
	}
}

func orBelum(s string) string {
	if s == "" {
		return "belum diketahui"
	}
	return s
}

func missingFields(c models.CollectedData) string {
	var m []string
	if c.Name == "" {
		m = append(m, "nama lengkap")
	}
	if c.Company == "" {
		m = append(m, "nama perusahaan/instansi")
	}
	if c.Address == "" {
		m = append(m, "alamat pengiriman")
	}
	if c.Product == "" {
		m = append(m, "produk yang dicari")
	}
	if len(m) == 0 {
		return "tidak ada (semua sudah terkumpul)"
	}
	return strings.Join(m, ", ")
}

// formatHistory converts message history to a readable string for the Gemini prompt.
func formatHistory(msgs []models.Message) string {
	if len(msgs) == 0 {
		return "(belum ada pesan)"
	}
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(fmt.Sprintf("[%s]: %s\n", strings.ToUpper(string(m.Sender)), m.Text))
	}
	return sb.String()
}

// StockContextString formats stock items into a compact string for the Gemini prompt.
func StockContextString(items []models.StockItem) string {
	if len(items) == 0 {
		return "(tidak ada produk yang cocok ditemukan di database)"
	}
	var sb strings.Builder
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (SKU: %s): Rp %.0f/unit, stok: %d\n",
			item.Name, item.SKU, item.Price, item.Stock))
	}
	return sb.String()
}
```

Note: The `language` parameter is retained for API compatibility (machine.go passes it) but is no longer used in the function body — Go does not error on unused function parameters.

- [ ] **Step 4: Run new tests — confirm they all pass**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/engine/... -v -run "TestBuildPrompt|TestStockContext|TestOrBelum|TestMissingFields" 2>&1
```

Expected: All new tests PASS.

- [ ] **Step 5: Run full test suite — confirm no regressions**

```bash
cd backend-go && CGO_ENABLED=1 go test ./... 2>&1
```

Expected: All tests pass. The 10 existing `machine_test.go` tests use `mockGemini` which ignores the prompt content entirely — they are unaffected by the `prompts.go` rewrite.

- [ ] **Step 6: Full build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/engine/prompts.go backend-go/internal/engine/prompts_test.go
git commit -m "feat(go): rewrite engine prompts — state-specific JSON format, Calista SOP references"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `backend-go/internal/assets/calista_system_prompt.txt` — Task 1
- ✅ `backend-go/internal/assets/prompts.go` with `//go:embed` — Task 1
- ✅ `gemini.NewClient` gains `systemPrompt string` param, sets `model.SystemInstruction` — Task 2
- ✅ `main.go` passes `assets.CalistaSystemPrompt` — Task 2
- ✅ `engine/prompts.go` rewritten: all 5 states have state name + collected context + JSON format — Task 3
- ✅ `GeminiClient` interface unchanged — Task 2 (not touched)
- ✅ `machine_test.go` unaffected — Task 2 & 3 (not touched)
- ✅ `language` parameter retained for API compat — Task 3

**No placeholders found.**

**Type consistency:**
- `assets.CalistaSystemPrompt` is `string` — matches third param of `NewClient(ctx, apiKey, systemPrompt string)`
- `model.SystemInstruction` is `*genai.Content` — set correctly with `&genai.Content{Parts: []genai.Part{genai.Text(systemPrompt)}}`
- `BuildPrompt` signature unchanged: `(state, language string, data CollectedData, history []Message, stockContext string) string`
- `orBelum` and `missingFields` are private — tested from `package engine` test file ✅
