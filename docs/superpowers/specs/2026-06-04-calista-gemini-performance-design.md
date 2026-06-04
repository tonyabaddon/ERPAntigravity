# Calista Gemini Performance Improvement

**Date:** 2026-06-04
**Status:** Approved

## Problem

Calista (WhatsApp AI sales admin) intermittently takes 2+ minutes to reply to customers. Root cause: `context.Background()` is passed to every Gemini API call with no deadline. When the Gemini API occasionally hangs (network blip, API congestion), the goroutine blocks indefinitely.

Secondary issue: the system prompt is 1,150 lines and includes developer-only sections (`CATATAN UNTUK DEVELOPER` blocks, usage instructions) that add ~15–20% token overhead on every API call without affecting Calista's behavior.

## Goals

- Cap worst-case response time at ~100 seconds instead of 2+ minutes
- Ensure customers always receive feedback (not silence) when Gemini is slow
- Escalate to admin automatically when all retries fail
- Reduce per-call token overhead by trimming the system prompt

## Design

### 1. Per-Attempt Timeout — `gemini/client.go`

Wrap each `GenerateContent` call with a 10-second context timeout:

```go
ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
defer cancel()
resp, err := c.model.GenerateContent(ctx, genai.Text(fullPrompt))
```

If Gemini doesn't respond in 10 seconds, the call returns an error immediately. The retry loop in the handler decides what to do next.

### 2. Retry Loop — `whatsapp/handler.go`

Replace the single `machine.Process` call in `processMessage` with a retry loop:

```
Attempt 1 (10s timeout)
  → Success: send reply, done
  → Fail: send holding message to customer, continue

Attempts 2–10 (10s timeout each, no extra delay between)
  → First success: send reply, done
  → All 10 fail: escalate to admin
```

**Holding message** (sent once, after attempt 1 fails):
- Bahasa Indonesia: `"Mohon maaf, sistem kami sedang sibuk. Kami akan segera membalas 🙏"`
- English: `"Sorry, our system is currently busy. We'll reply to you shortly 🙏"`

Language is detected from `conv.Language`.

**Admin escalation** (after all 10 attempts fail):
- Send WA notification to all active recipients via existing `GetActiveRecipients` + `sender.SendText`
- Notification format: `"⚠️ Calista gagal memproses pesan dari [phone]. Pesan pelanggan: [original text]. Mohon tangani manual."`
- Update conversation state to `StateEscalatedAdmin` via `db.UpdateConversationState`
- Insert system message in DB: `"ESCALATED: Gemini failed after 10 retries"`

**Total worst-case wait:** 10 attempts × 10 seconds = 100 seconds (~1 min 40s).

### 3. System Prompt Trim — `calista_system_prompt.txt`

Remove the following sections that are developer instructions, not Calista behavior:

- The `PETUNJUK PENGGUNAAN DI CLAUDE CODE / INTELLIJ` header (top of file)
- All `CATATAN UNTUK DEVELOPER` blocks (8 occurrences throughout the file)

These sections describe database schemas, dashboard button logic, and webhook implementation details. Gemini processes them on every call but they have zero effect on how Calista responds to customers.

**Calista's behavior is unchanged.** Only developer-facing text is removed.

## Files Changed

| File | Change |
|------|--------|
| `internal/gemini/client.go` | Add 10s context timeout per attempt |
| `internal/whatsapp/handler.go` | Replace single Gemini call with 10-attempt retry loop |
| `internal/assets/calista_system_prompt.txt` | Remove developer-only sections |

## Non-Goals

- Changing the Gemini model (`gemini-3.5-flash` stays)
- Streaming responses
- Context caching
- Changing conversation flow or Calista's persona
