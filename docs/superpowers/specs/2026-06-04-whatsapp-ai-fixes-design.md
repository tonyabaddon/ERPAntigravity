# Design: WhatsApp AI — Two Bug Fixes

**Date:** 2026-06-04

---

## Issue 1: Show Connected Phone Number in WhatsApp AI Menu

### Problem
The `/api/wa/qr` endpoint only returns `{ qr, connected }`. When WhatsApp is connected, the UI shows "BERHASIL TERSAMBUNG" but no phone number — the user cannot confirm which account is linked.

### Fix

**Backend (`backend-go/main.go`):**
In the `/api/wa/qr` handler, when `waClient.WA.Store.ID != nil`, include the phone number in the response:

```json
{ "qr": "", "connected": true, "phone": "6281234567890" }
```

`waClient.WA.Store.ID.User` contains the phone digits (e.g. `6281234567890`).

**Frontend (`src/components/WhatsappAiScreen.tsx`):**
- Store `phone` from the QR API response in a `waPhone` state variable
- In the "BERHASIL TERSAMBUNG" section, display the phone number below the CheckCircle icon

---

## Issue 2: Fix "Kendala Teknis" Error for BOOKED State

### Problem

Root cause confirmed from Supabase DB (3 of 15 AI messages in BOOKED conversations were fallback errors):

1. `StateBooked` is **not** in `IsTerminal()` in `models/types.go`
2. When a booked customer sends a text message, `processMessage()` runs fully
3. `machine.Process()` is called with state `BOOKED`
4. `BuildPrompt(StateBooked)` hits the `default` case → produces prompt `FASE: TIDAK DIKETAHUI`
5. Gemini receives this malformed prompt and returns an empty response (0 candidates)
6. `gemini/client.go` returns error `"gemini: empty response"`
7. `machine.go` catches the error → `FallbackReply()` → customer receives "Maaf, saya mengalami kendala teknis..."

The same pattern applies to `StateTimeoutReminder` (order about to expire).

### Fix

In `backend-go/internal/whatsapp/handler.go`, inside `processMessage()`, add an intercept **before** the terminal state check and **before** `machine.Process()` is called:

```go
// Intercept post-booking states — send static holding message, never invoke Gemini
if conv.State == models.StateBooked || conv.State == models.StateTimeoutReminder {
    reply := "Pesanan Anda sedang menunggu konfirmasi dari tim admin kami. Mohon ditunggu sebentar ya 🙏"
    if conv.Language == "en" {
        reply = "Your order is awaiting confirmation from our admin team. Please wait a moment 🙏"
    }
    h.db.InsertMessage(conv.ID, models.SenderAI, reply)
    h.sender.SendText(ctx, senderPhone, reply)
    return
}
```

This prevents Gemini from ever being called with an invalid prompt, eliminating the error entirely. Customer also gets a helpful status message instead of silence or an error.

### Why not add BOOKED to IsTerminal()?
`IsTerminal()` affects text message handling only. Image messages (payment proofs) bypass it entirely via `handleMediaMessage()`. Making BOOKED terminal for text while allowing image handling would work, but returning a static holding message is better UX — the customer knows their order is being processed rather than getting no response.

---

## Files Changed

| File | Change |
|------|--------|
| `backend-go/main.go` | Add `phone` field to `/api/wa/qr` response |
| `src/components/WhatsappAiScreen.tsx` | Store and display phone number when connected |
| `backend-go/internal/whatsapp/handler.go` | Intercept BOOKED/TIMEOUT_REMINDER states with static reply |
