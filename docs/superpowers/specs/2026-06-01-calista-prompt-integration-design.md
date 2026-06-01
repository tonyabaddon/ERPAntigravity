# Calista System Prompt Integration — Design Spec

**Date:** 2026-06-01
**Sub-project:** A of 3 (Calista Brain Fix)
**Status:** Approved for implementation

---

## Problem

`engine/prompts.go` uses generic "helpful sales assistant" prompts. The full Calista persona, product knowledge (panel box materials, MCB, kabel, escalation triggers), and conversation SOP defined in `AI Sales Admin Toko/garindo_jaya_panel_system_prompt.txt` are never injected into any Gemini call. The AI has no product knowledge and does not follow the Garindo Jaya Panel SOP.

---

## Goal

Inject the full Calista system prompt into every Gemini API call as the model's `SystemInstruction`, so the AI behaves as Calista from the first message.

---

## Approach

Use Gemini's native `SystemInstruction` field (separate from the conversation content), set once at client construction. State-specific JSON format constraints remain in the per-call prompt (user turn). This separates "who Calista is and what she knows" from "what JSON shape to return right now."

---

## Files Changed

### New files

**`backend-go/internal/assets/calista_system_prompt.txt`**
Copy of `AI Sales Admin Toko/garindo_jaya_panel_system_prompt.txt`. This is the Go build copy — the canonical business document remains in `AI Sales Admin Toko/`. When the prompt changes, update both files.

**`backend-go/internal/assets/prompts.go`**
```go
package assets

import _ "embed"

//go:embed calista_system_prompt.txt
var CalistaSystemPrompt string
```

### Modified files

**`backend-go/internal/gemini/client.go`**

`NewClient` gains a third parameter `systemPrompt string`. Sets `model.SystemInstruction` once at construction:

```go
func NewClient(ctx context.Context, apiKey, systemPrompt string) (*Client, error) {
    // ... existing init ...
    model.SystemInstruction = &genai.Content{
        Parts: []genai.Part{genai.Text(systemPrompt)},
    }
    return &Client{model: model, inner: c}, nil
}
```

`GenerateReply` signature is **unchanged**. The `GeminiClient` interface in `machine.go` is **unchanged**. `mockGemini` in `machine_test.go` is **unchanged**.

**`backend-go/main.go`**

Pass `assets.CalistaSystemPrompt` as the third arg to `gemini.NewClient`:

```go
geminiClient, err := gemini.NewClient(ctx, cfg.GeminiAPIKey, assets.CalistaSystemPrompt)
```

**`backend-go/internal/engine/prompts.go`**

`BuildPrompt` is rewritten. Persona and product knowledge are removed — those are now in `SystemInstruction`. Each state's prompt contains only:
1. Current phase name (in Indonesian, matching the SOP)
2. Collected data context (what is already known)
3. JSON format constraint with valid `next_action` values

Pattern for each state:

```
FASE: [STATE_NAME]
[Collected context fields]

Ikuti SOP [fase referensi] dari system prompt.
Balas HANYA JSON:
{"reply":"<pesan WA>","<state-specific fields>","next_action":"<valid values>"}
```

State-specific details:

| State | Context injected | JSON fields returned |
|---|---|---|
| GREETING | none | `reply`, `detected_language` ("id" or "en") — no next_action, machine always advances to COLLECTING |
| COLLECTING | name, company, address, product (empty = "belum") | `reply`, `collected` object, `next_action`: CONTINUE \| ESCALATE \| ESCALATE_WIRING |
| CLARIFYING | product, qty, size, color, notes, round number | `reply`, `specs` object, `next_action`: CONTINUE \| READY \| ESCALATE, `clarification_round` int |
| STOCK_CHECK | product, qty, full stock context string | `reply`, `next_action`: CONFIRM \| ESCALATE |
| CONFIRMING | full order summary from collected_data | `reply`, `confirmed` bool, `modification_requested` bool |

Conversation history and stock context are appended after the state prompt, same as today.

`StockContextString` and `formatHistory` helper functions are **unchanged**.

---

## What Does NOT Change

- `GeminiClient` interface
- `engine/machine.go` (Process logic)
- `engine/parser.go` (JSON parsing)
- `engine/machine_test.go` (mock unaffected)
- `internal/db/` (all DB layer)
- `internal/whatsapp/` (handler, sender, client)
- `internal/scheduler/`
- `internal/rules/`
- All React frontend files

---

## Dual-file maintenance note

`AI Sales Admin Toko/garindo_jaya_panel_system_prompt.txt` = canonical business document (owner edits this).
`backend-go/internal/assets/calista_system_prompt.txt` = Go build copy (copy from above before redeploy).

When the SOP changes: update both, redeploy. This is intentional — prompt changes are deployment events, not runtime config changes.

---

## Success Criteria

1. `CGO_ENABLED=1 go build ./...` passes cleanly after changes.
2. All existing tests pass (`go test ./...`).
3. Manual test: send a WhatsApp message to the bot; Gemini response references Garindo Jaya Panel products/SOP, not generic assistant behavior.
4. Gemini call payload (logged at DEBUG level) shows `system_instruction` populated with Calista prompt text.
