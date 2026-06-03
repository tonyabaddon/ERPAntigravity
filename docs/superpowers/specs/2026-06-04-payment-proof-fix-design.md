# Design: Fix Payment Proof Flow (Images + PDFs)

**Date:** 2026-06-04

---

## Problem

Three bugs in `handleMediaMessage` prevent customer payment proofs from being processed:

1. **Timestamp filter drops queued media during redeploys.** `Handle()` silently drops any WhatsApp message with `Timestamp.Before(startedAt)`. Since every order requires a payment proof and backend redeploys are routine, this blocks order completion universally — not just in edge cases.

2. **ViewOnce images not unwrapped.** `GetImageMessage()` only checks the top-level `imageMessage` proto field. WhatsApp wraps many images in a `viewOnceMessage` → inner `imageMessage`. When this happens, `img == nil` and the handler falls into admin escalation, leaving order status at `WAITING_PAYMENT`.

3. **PDF documents not accepted.** Customers frequently send payment proofs as PDF documents. `GetImageMessage()` returns nil for documents, causing the same admin escalation fallback.

**Root cause confirmed from DB:** Order `5dbc37e4` is at `WAITING_PAYMENT` with `payment_proof_url = null` and no customer messages after the approval. The customer sent the proof on June 4 during a backend redeploy — the message was queued by WhatsApp, and the timestamp filter dropped it silently on reconnect.

---

## Fix

### File 1: `backend-go/internal/whatsapp/handler.go`

**Change 1 — Move timestamp filter inside text-message branch.**

Current:
```go
if evt.Info.Timestamp.Before(h.startedAt) {
    return
}
// ... extract text ...
if text == "" {
    h.handleMediaMessage(evt)
    return
}
go h.processMessage(...)
```

Fixed:
```go
// extract text first
text := ...
if text == "" {
    h.handleMediaMessage(evt)   // media: no timestamp filter
    return
}
// text messages only: drop backlog delivered on reconnect
if evt.Info.Timestamp.Before(h.startedAt) {
    return
}
go h.processMessage(...)
```

**Rationale:** The timestamp filter was added to stop the AI from re-greeting customers after a restart. That concern applies only to text messages. Media messages (payment proofs) must not be filtered — losing them blocks the entire payment flow.

**Change 2 — Unwrap viewOnce; accept documents alongside images.**

```go
img := evt.Message.GetImageMessage()
// unwrap viewOnce → inner image
if img == nil && evt.Message.GetViewOnceMessage() != nil {
    img = evt.Message.GetViewOnceMessage().GetMessage().GetImageMessage()
}
// unwrap ephemeral (disappearing messages) → inner image
if img == nil && evt.Message.GetEphemeralMessage() != nil {
    img = evt.Message.GetEphemeralMessage().GetMessage().GetImageMessage()
}
doc := evt.Message.GetDocumentMessage()

// bail if no usable media, no order, or order not awaiting payment
if orderErr != nil || order == nil ||
    order.Status != models.OrderStatusWaitingPayment ||
    (img == nil && doc == nil) {
    // admin escalation — unchanged
}

// download: image takes priority; fall back to document (PDF)
var proofURL string
if img != nil {
    data, ct, dlErr := h.sender.DownloadMedia(ctx, img)
    if dlErr != nil {
        log.Printf("[HANDLER] DownloadMedia error for order %s: %v", order.ID, dlErr)
    } else {
        url, upErr := storage.UploadPaymentProof(ctx, h.supabaseURL, h.supabaseServiceKey, order.ID, data, ct)
        if upErr != nil {
            log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
        } else {
            proofURL = url
        }
    }
} else {
    data, ct, dlErr := h.sender.DownloadDocument(ctx, doc)
    if dlErr != nil {
        log.Printf("[HANDLER] DownloadDocument error for order %s: %v", order.ID, dlErr)
    } else {
        url, upErr := storage.UploadPaymentProof(ctx, h.supabaseURL, h.supabaseServiceKey, order.ID, data, ct)
        if upErr != nil {
            log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
        } else {
            proofURL = url
        }
    }
}

h.db.UpdatePaymentProof(order.ID, proofURL)
// ... ack message and recipient notifications unchanged
```

`UpdatePaymentProof` always runs regardless of upload success, so `status` advances to `PAYMENT_UPLOADED` even when the Supabase Storage upload fails.

### File 2: `backend-go/internal/whatsapp/sender.go`

Add `DownloadDocument` — mirrors `DownloadMedia` for `DocumentMessage`:

```go
func (s *Sender) DownloadDocument(ctx context.Context, doc *waProto.DocumentMessage) ([]byte, string, error) {
    data, err := s.client.Download(ctx, doc)
    if err != nil {
        return nil, "", fmt.Errorf("sender: download document: %w", err)
    }
    ct := doc.GetMimetype()
    if ct == "" {
        ct = "application/octet-stream"
    }
    return data, ct, nil
}
```

---

## What Does NOT Change

- `storage.UploadPaymentProof` — already handles any content type
- Frontend `OrderHistoryScreen` — already renders `PAYMENT_UPLOADED` status correctly
- Admin escalation path — unchanged for messages that are neither image nor document, or where order is not in `WAITING_PAYMENT`
- The ack WA message and recipient notification logic in `handleMediaMessage` — unchanged

---

## Testing

1. **Unit test** (`backend-go/internal/whatsapp/handler_test.go` or new file): mock an `events.Message` with a `DocumentMessage` and verify `UpdatePaymentProof` is called.
2. **Manual**: send a PDF payment proof from a test WhatsApp number in `WAITING_PAYMENT` state; verify order transitions to `PAYMENT_UPLOADED`.
3. **Regression**: send a text message from a `WAITING_PAYMENT` conversation; verify AI still responds normally (timestamp filter still applies to text).
