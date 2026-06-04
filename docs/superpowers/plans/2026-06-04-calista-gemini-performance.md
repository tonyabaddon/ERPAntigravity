# Calista Gemini Performance Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix intermittent 2+ minute Calista response times by adding a 10-second per-attempt timeout and a 10-retry loop with admin escalation on total failure.

**Architecture:** Add a 10-second `context.WithTimeout` inside `gemini.GenerateReply` so each attempt fails fast. Expose `GeminiError` on `engine.ProcessResult` so the retry loop can distinguish timeouts from successful responses. Extract a `RetryProcess` function in the engine package (testable via existing mock pattern) and wire it into the handler. Separately trim developer-only text from the system prompt to reduce per-call token overhead.

**Tech Stack:** Go, `github.com/google/generative-ai-go/genai`, existing `engine.GeminiClient` interface, existing `mockGemini` test pattern.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `internal/gemini/client.go` | Modify | Add 10s timeout per `GenerateReply` call |
| `internal/engine/machine.go` | Modify | Add `GeminiError error` to `ProcessResult`; set it on Gemini failure |
| `internal/engine/machine_test.go` | Modify | Add `mockGeminiError` type; add test for `GeminiError` propagation |
| `internal/engine/retry.go` | Create | `RetryProcess` — 10-attempt retry loop with `onFirstFail` callback |
| `internal/engine/retry_test.go` | Create | Tests: success on attempt 1, success on retry, all fail |
| `internal/whatsapp/handler.go` | Modify | Replace single `machine.Process` call with `engine.RetryProcess` |
| `internal/assets/calista_system_prompt.txt` | Modify | Remove `CATATAN UNTUK DEVELOPER` blocks and usage header |

---

## Task 1: Add 10-second timeout in gemini/client.go

**Files:**
- Modify: `internal/gemini/client.go`

> No unit test for this file — `genai.GenerativeModel` is a concrete type from the Google library with no mockable interface. Timeout correctness is validated indirectly through the retry tests in Task 3.

- [ ] **Step 1: Add timeout inside GenerateReply**

Open `internal/gemini/client.go`. Replace the existing `GenerateReply` function body:

```go
func (c *Client) GenerateReply(ctx context.Context, fullPrompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	resp, err := c.model.GenerateContent(ctx, genai.Text(fullPrompt))
	if err != nil {
		return "", fmt.Errorf("gemini: generate: %w", err)
	}
	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: empty response")
	}
	text, ok := resp.Candidates[0].Content.Parts[0].(genai.Text)
	if !ok {
		return "", fmt.Errorf("gemini: unexpected part type")
	}
	return string(text), nil
}
```

Add `"time"` to the import block. The full import block becomes:

```go
import (
	"context"
	"fmt"
	"time"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)
```

- [ ] **Step 2: Commit**

```bash
git add internal/gemini/client.go
git commit -m "feat(gemini): add 10s timeout per GenerateReply attempt"
```

---

## Task 2: Expose GeminiError on ProcessResult in engine/machine.go

**Files:**
- Modify: `internal/engine/machine.go`
- Modify: `internal/engine/machine_test.go`

- [ ] **Step 1: Write the failing test**

Open `internal/engine/machine_test.go`. Add the `mockGeminiError` type after the existing `mockGemini` type, and add the new test at the bottom of the file:

```go
type mockGeminiError struct{ err error }

func (m *mockGeminiError) GenerateReply(_ context.Context, _ string) (string, error) {
	return "", m.err
}

func TestProcessGeminiError_SetsGeminiErrorField(t *testing.T) {
	m := &Machine{gemini: &mockGeminiError{err: fmt.Errorf("context deadline exceeded")}}
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.GeminiError == nil {
		t.Error("expected GeminiError to be set when Gemini call fails")
	}
	if result.Reply == "" {
		t.Error("expected fallback reply to still be populated")
	}
}
```

Add `"fmt"` to the import block in machine_test.go:

```go
import (
	"context"
	"fmt"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-go && go test ./internal/engine/ -run TestProcessGeminiError_SetsGeminiErrorField -v
```

Expected: `FAIL — result.GeminiError == nil` (field doesn't exist yet)

- [ ] **Step 3: Add GeminiError to ProcessResult**

Open `internal/engine/machine.go`. Add the `GeminiError` field to `ProcessResult`:

```go
type ProcessResult struct {
	Reply              string
	NextState          models.ConversationState
	NewData            *models.CollectedData
	ClarificationRound int
	Language           string
	CreateOrder        bool
	DeliveryType       models.DeliveryType
	GeminiError        error
}
```

- [ ] **Step 4: Set GeminiError on Gemini failure**

In the same file, find the Gemini error handler inside `Process` (currently around line 49). Replace:

```go
rawJSON, err := m.gemini.GenerateReply(ctx, fullPrompt)
if err != nil {
	log.Printf("[ENGINE] Gemini error in state %s: %v", conv.State, err)
	result.Reply = FallbackReply(conv.Language)
	return result, nil
}
```

With:

```go
rawJSON, err := m.gemini.GenerateReply(ctx, fullPrompt)
if err != nil {
	log.Printf("[ENGINE] Gemini error in state %s: %v", conv.State, err)
	result.Reply = FallbackReply(conv.Language)
	result.GeminiError = err
	return result, nil
}
```

- [ ] **Step 5: Run all engine tests to verify pass**

```bash
cd backend-go && go test ./internal/engine/ -v
```

Expected: All tests pass, including `TestProcessGeminiError_SetsGeminiErrorField`.

- [ ] **Step 6: Commit**

```bash
git add internal/engine/machine.go internal/engine/machine_test.go
git commit -m "feat(engine): expose GeminiError on ProcessResult for retry detection"
```

---

## Task 3: Create RetryProcess in engine/retry.go

**Files:**
- Create: `internal/engine/retry.go`
- Create: `internal/engine/retry_test.go`

- [ ] **Step 1: Write the failing tests**

Create `internal/engine/retry_test.go` with the following content:

```go
package engine

import (
	"context"
	"fmt"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// mockGeminiSequence fails the first `failN` calls, then succeeds.
type mockGeminiSequence struct {
	calls    int
	failN    int
	response string
}

func (m *mockGeminiSequence) GenerateReply(_ context.Context, _ string) (string, error) {
	m.calls++
	if m.calls <= m.failN {
		return "", fmt.Errorf("simulated timeout on call %d", m.calls)
	}
	return m.response, nil
}

func testConv() *models.Conversation {
	return &models.Conversation{State: models.StateGreeting, Language: "id"}
}

func TestRetryProcess_SuccessFirstAttempt(t *testing.T) {
	m := newTestMachine(`{"reply":"Halo!","detected_language":"id"}`)
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError != nil {
		t.Errorf("expected success, got GeminiError: %v", result.GeminiError)
	}
	if result.Reply != "Halo!" {
		t.Errorf("expected reply 'Halo!', got %q", result.Reply)
	}
	if firstFailCalled != 0 {
		t.Errorf("onFirstFail should not be called on success, called %d times", firstFailCalled)
	}
}

func TestRetryProcess_SuccessOnRetry(t *testing.T) {
	// Fails first 3 attempts, succeeds on attempt 4.
	seq := &mockGeminiSequence{failN: 3, response: `{"reply":"Halo!","detected_language":"id"}`}
	m := &Machine{gemini: seq}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError != nil {
		t.Errorf("expected success on retry, got GeminiError: %v", result.GeminiError)
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
	if seq.calls != 4 {
		t.Errorf("expected 4 Gemini calls, got %d", seq.calls)
	}
}

func TestRetryProcess_AllFail(t *testing.T) {
	m := &Machine{gemini: &mockGeminiError{err: fmt.Errorf("simulated timeout")}}
	firstFailCalled := 0
	result := RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 10, func() {
		firstFailCalled++
	})
	if result.GeminiError == nil {
		t.Error("expected GeminiError after all retries exhausted")
	}
	if firstFailCalled != 1 {
		t.Errorf("onFirstFail should be called exactly once, called %d times", firstFailCalled)
	}
}

func TestRetryProcess_OnFirstFailCalledOnce(t *testing.T) {
	// Fails all 5 attempts — onFirstFail must fire exactly once regardless.
	m := &Machine{gemini: &mockGeminiError{err: fmt.Errorf("timeout")}}
	count := 0
	RetryProcess(context.Background(), m, testConv(), "halo", nil, "", 5, func() {
		count++
	})
	if count != 1 {
		t.Errorf("expected onFirstFail called exactly 1 time, got %d", count)
	}
}
```

Add `"fmt"` to the import block in retry_test.go (the `mockGeminiError` type is already defined in machine_test.go, accessible since both files are in `package engine`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend-go && go test ./internal/engine/ -run "TestRetryProcess" -v
```

Expected: `FAIL — undefined: RetryProcess`

- [ ] **Step 3: Create retry.go with RetryProcess**

Create `internal/engine/retry.go`:

```go
package engine

import (
	"context"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// RetryProcess calls machine.Process up to maxAttempts times (each with the
// 10-second timeout already baked into gemini.GenerateReply).
// onFirstFail is called exactly once when attempt 1 fails — use it to send
// a holding message to the customer.
// Returns the first successful ProcessResult, or the last failed result if all
// attempts are exhausted (GeminiError will be non-nil in that case).
func RetryProcess(
	ctx context.Context,
	machine *Machine,
	conv *models.Conversation,
	text string,
	history []models.Message,
	stockContext string,
	maxAttempts int,
	onFirstFail func(),
) *ProcessResult {
	var result *ProcessResult
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		result, _ = machine.Process(ctx, conv, text, history, stockContext)
		if result.GeminiError == nil {
			return result
		}
		if attempt == 1 {
			onFirstFail()
		}
	}
	return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend-go && go test ./internal/engine/ -v
```

Expected: All tests pass including all four `TestRetryProcess_*` tests.

- [ ] **Step 5: Commit**

```bash
git add internal/engine/retry.go internal/engine/retry_test.go
git commit -m "feat(engine): add RetryProcess with 10-attempt retry loop and onFirstFail callback"
```

---

## Task 4: Wire RetryProcess into whatsapp/handler.go

**Files:**
- Modify: `internal/whatsapp/handler.go`

- [ ] **Step 1: Replace machine.Process call with engine.RetryProcess**

Open `internal/whatsapp/handler.go`. Find the block starting with comment `// 9. Run state machine` (currently around line 152). Replace the entire block:

```go
// 9. Run state machine
result, err := h.machine.Process(ctx, conv, text, history, stockContext)
if err != nil {
    log.Printf("[HANDLER] Machine.Process error: %v", err)
    return
}
```

With:

```go
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
    log.Printf("[HANDLER] Gemini failed after 10 retries for %s: %v", senderPhone, result.GeminiError)
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
```

- [ ] **Step 2: Verify the code compiles**

```bash
cd backend-go && go build ./...
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
cd backend-go && go test ./...
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add internal/whatsapp/handler.go
git commit -m "feat(handler): replace single Gemini call with 10-retry loop, holding message, and admin escalation"
```

---

## Task 5: Trim developer sections from calista_system_prompt.txt

**Files:**
- Modify: `internal/assets/calista_system_prompt.txt`

These sections are written for developers, not for the AI. Removing them reduces token count ~15–20% per API call without changing Calista's behavior.

- [ ] **Step 1: Remove the PETUNJUK PENGGUNAAN header block**

Find and delete the following block near the top of the file (between the first `===` line and the second one):

```
PETUNJUK PENGGUNAAN DI CLAUDE CODE / INTELLIJ:
- Paste seluruh isi file ini sebagai System Prompt
- Ganti [NO_WA_ADMIN] dan [NO_WA_OWNER] dengan nomor WA aktual
- Pastikan integrasi database real-time sudah tersambung
  sebelum deploy ke WhatsApp Business API
- Model string untuk Gemini API: gemini-3.5-flash
```

- [ ] **Step 2: Remove all CATATAN UNTUK DEVELOPER blocks**

Search for `CATATAN UNTUK DEVELOPER` in the file. There are 6 occurrences. Delete each block from the `CATATAN UNTUK DEVELOPER:` line through the last bullet point of that block. The blocks to remove are:

1. After the nego price section — database column/button instructions
2. After the follow-up auto section — scheduled job implementation notes
3. After the ID system section — table schema definitions (`customers`, `leads`, `orders`)
4. After the payment validation section — webhook implementation notes
5. After the admin take-over section — `ai_active` session flag notes
6. Any remaining `CATATAN UNTUK DEVELOPER` blocks found by search

To find them all:
```bash
grep -n "CATATAN UNTUK DEVELOPER" backend-go/internal/assets/calista_system_prompt.txt
```

Delete from each `CATATAN UNTUK DEVELOPER:` line through the blank line following the last bullet of that block.

- [ ] **Step 3: Verify the prompt still contains all behavioral sections**

After trimming, confirm these key sections are still present:
```bash
grep -c "FASE 1\|FASE 2\|LARANGAN MUTLAK\|PANDUAN ESKALASI\|ATURAN BAHASA\|KONTEKS PRODUK" backend-go/internal/assets/calista_system_prompt.txt
```

Expected: 6 (all behavioral sections intact).

- [ ] **Step 4: Run all tests**

```bash
cd backend-go && go test ./...
```

Expected: All tests pass (prompt is loaded at startup, not at test time, so tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add internal/assets/calista_system_prompt.txt
git commit -m "perf(prompt): remove developer-only sections to reduce per-call token overhead"
```

---

## Manual Verification

After all tasks are complete, verify end-to-end behavior:

1. **Normal flow:** Send a WhatsApp message and confirm Calista replies within 10 seconds.
2. **Holding message:** To simulate a timeout, temporarily set the timeout in `gemini/client.go` to `1*time.Millisecond`, send a message, and confirm the holding message arrives quickly. Revert after testing.
3. **Escalation:** Keep the 1ms timeout, send a message, wait ~10 seconds, confirm admin WA notification is received and conversation state is `ESCALATED_ADMIN` in the database.
4. **Retry success:** Set timeout to `1*time.Millisecond` for the first call only (using a counter in a local test binary), confirm that a subsequent retry with normal timeout succeeds and the real reply is sent.
