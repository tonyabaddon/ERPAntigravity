# Payment Proof Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs that prevent customer payment proofs (images and PDFs) from being processed: queued messages dropped after redeploy, viewOnce/ephemeral images not unwrapped, and PDF documents not accepted.

**Architecture:** Two files change. `sender.go` gets a new `DownloadDocument` method that mirrors `DownloadMedia`. `handler.go` gets two edits: the timestamp filter moves inside the text-message branch (so media is never filtered), and `handleMediaMessage` is updated to resolve images through wrappers and accept documents via the new method.

**Tech Stack:** Go, whatsmeow (`go.mau.fi/whatsmeow`), `waProto` (`go.mau.fi/whatsmeow/proto/waE2E`)

---

## File Map

| File | What changes |
|------|-------------|
| `backend-go/internal/whatsapp/sender.go` | Add `DownloadDocument(*waProto.DocumentMessage)` method |
| `backend-go/internal/whatsapp/handler.go` | Move timestamp filter inside text branch; unwrap viewOnce + ephemeral; accept doc in `handleMediaMessage` |

---

## Task 1: Add DownloadDocument to sender.go

**Files:**
- Modify: `backend-go/internal/whatsapp/sender.go`

- [ ] **Step 1: Open `backend-go/internal/whatsapp/sender.go`**

The file currently ends with `DownloadMedia`:

```go
// DownloadMedia downloads an image message's bytes from WhatsApp servers.
// Returns the raw bytes and MIME type. Defaults to "image/jpeg" if MIME type is missing.
func (s *Sender) DownloadMedia(ctx context.Context, img *waProto.ImageMessage) ([]byte, string, error) {
	data, err := s.client.Download(ctx, img)
	if err != nil {
		return nil, "", fmt.Errorf("sender: download media: %w", err)
	}
	contentType := img.GetMimetype()
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return data, contentType, nil
}
```

- [ ] **Step 2: Append `DownloadDocument` after `DownloadMedia`**

Add this method at the end of the file:

```go
// DownloadDocument downloads a document message's bytes from WhatsApp servers.
// Returns the raw bytes and MIME type. Defaults to "application/octet-stream" if MIME type is missing.
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

- [ ] **Step 3: Build to verify no compile errors**

```bash
cd backend-go && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/sender.go
git commit -m "feat(wa): add DownloadDocument to sender for PDF payment proofs"
```

---

## Task 2: Fix timestamp filter in Handle()

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (the `Handle` function, approximately lines 38–65)

- [ ] **Step 1: Open `backend-go/internal/whatsapp/handler.go` and find `Handle()`**

The current function looks like this:

```go
func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}
	// Skip messages sent before the daemon started — these are WhatsApp's
	// queued backlog delivered on first connect, not live customer messages.
	if evt.Info.Timestamp.Before(h.startedAt) {
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

	// Preserve the full JID string (including @lid server for LID-based senders)
	// so sender.go can route it correctly.
	senderJID := evt.Info.Sender.ToNonAD().String()
	go h.processMessage(context.Background(), senderJID, text)
}
```

- [ ] **Step 2: Move the timestamp filter inside the text branch**

Replace the entire `Handle` function with:

```go
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
		// Media messages (payment proofs) must never be filtered by startup time —
		// customers send proofs while the backend is restarting and lose them otherwise.
		h.handleMediaMessage(evt)
		return
	}

	// Text messages only: drop WhatsApp's queued backlog delivered on reconnect
	// so the AI does not re-greet customers who messaged before the last restart.
	if evt.Info.Timestamp.Before(h.startedAt) {
		return
	}

	// Preserve the full JID string (including @lid server for LID-based senders)
	// so sender.go can route it correctly.
	senderJID := evt.Info.Sender.ToNonAD().String()
	go h.processMessage(context.Background(), senderJID, text)
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cd backend-go && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(wa): apply timestamp filter to text messages only, not media"
```

---

## Task 3: Fix handleMediaMessage() — viewOnce, ephemeral, documents

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (the `handleMediaMessage` function, approximately lines 253–319)

- [ ] **Step 1: Find `handleMediaMessage` in `backend-go/internal/whatsapp/handler.go`**

The current payment-proof detection block looks like this:

```go
order, orderErr := h.db.GetOrderByConversation(conv.ID)
img := evt.Message.GetImageMessage()
if orderErr != nil || order == nil || order.Status != models.OrderStatusWaitingPayment || img == nil {
    // Not a payment proof context — fall through to admin escalation.
    h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
    h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
    reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
    if conv.Language == "en" {
        reply = "We have received your document. Our technical team will review and contact you shortly."
    }
    h.db.InsertMessage(conv.ID, models.SenderAI, reply)
    h.sender.SendText(context.Background(), senderPhone, reply)
    return
}

// Payment proof flow — image message from customer with WAITING_PAYMENT order.
var proofURL string
data, contentType, dlErr := h.sender.DownloadMedia(context.Background(), img)
if dlErr != nil {
    log.Printf("[HANDLER] DownloadMedia error for order %s: %v", order.ID, dlErr)
} else {
    url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
    if upErr != nil {
        log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
    } else {
        proofURL = url
    }
}
```

- [ ] **Step 2: Replace that block with the fixed version**

Replace from `order, orderErr := h.db.GetOrderByConversation(conv.ID)` through the closing `}` of the upload block with:

```go
order, orderErr := h.db.GetOrderByConversation(conv.ID)

// Resolve image through wrapper types WhatsApp uses on newer clients.
img := evt.Message.GetImageMessage()
if img == nil && evt.Message.GetViewOnceMessage() != nil {
    img = evt.Message.GetViewOnceMessage().GetMessage().GetImageMessage()
}
if img == nil && evt.Message.GetEphemeralMessage() != nil {
    img = evt.Message.GetEphemeralMessage().GetMessage().GetImageMessage()
}
doc := evt.Message.GetDocumentMessage()

if orderErr != nil || order == nil || order.Status != models.OrderStatusWaitingPayment || (img == nil && doc == nil) {
    // Not a payment proof context — fall through to admin escalation.
    h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
    h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
    reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
    if conv.Language == "en" {
        reply = "We have received your document. Our technical team will review and contact you shortly."
    }
    h.db.InsertMessage(conv.ID, models.SenderAI, reply)
    h.sender.SendText(context.Background(), senderPhone, reply)
    return
}

// Payment proof flow — image or document (PDF) from customer with WAITING_PAYMENT order.
var proofURL string
if img != nil {
    data, contentType, dlErr := h.sender.DownloadMedia(context.Background(), img)
    if dlErr != nil {
        log.Printf("[HANDLER] DownloadMedia error for order %s: %v", order.ID, dlErr)
    } else {
        url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
        if upErr != nil {
            log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
        } else {
            proofURL = url
        }
    }
} else {
    data, contentType, dlErr := h.sender.DownloadDocument(context.Background(), doc)
    if dlErr != nil {
        log.Printf("[HANDLER] DownloadDocument error for order %s: %v", order.ID, dlErr)
    } else {
        url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
        if upErr != nil {
            log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
        } else {
            proofURL = url
        }
    }
}
```

The rest of `handleMediaMessage` (UpdatePaymentProof, ack message, recipient notifications) is **unchanged** — leave it as-is.

- [ ] **Step 3: Build and run all tests**

```bash
cd backend-go && go build ./... && go test ./...
```

Expected: clean build, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(wa): accept viewOnce/ephemeral images and PDF documents as payment proofs"
```

---

## Task 4: Update progress.md and push to production

- [ ] **Step 1: Update `progress.md`**

Open `progress.md` and append a new entry describing:
- Bug 1 fixed: timestamp filter moved to text-only branch (payment proofs no longer dropped during redeploys)
- Bug 2 fixed: viewOnce and ephemeral image wrappers now unwrapped
- Bug 3 fixed: PDF documents now accepted as payment proofs

- [ ] **Step 2: Commit and push**

```bash
git add progress.md
git commit -m "chore: update progress.md with payment proof fix"
git push origin main
```

Expected: push triggers Cloud Build; both backend and frontend redeploy to production.
