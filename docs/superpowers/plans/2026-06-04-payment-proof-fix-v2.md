# Payment Proof Fix v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three remaining bugs that prevent PDF payment proofs from appearing correctly in the admin dashboard: viewOnce-wrapped PDFs not extracted, bucket rejecting `application/pdf`, and broken `<img>` rendering for PDFs.

**Architecture:** Four changes across three layers. Supabase bucket config is updated first (so uploads can succeed). Then the Go storage layer appends `.pdf` to the filename (so the frontend can detect the file type by URL). Then the Go handler is patched to unwrap viewOnce/ephemeral PDFs. Finally the React admin UI renders a PDF card instead of a broken `<img>` when the URL ends in `.pdf`.

**Tech Stack:** Go (`net/http`, `strings`), Supabase Storage (SQL on `storage.buckets`), React/TypeScript (TSX), `go test`, `npm run build`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| Supabase `storage.buckets` | SQL UPDATE | Set `allowed_mime_types = NULL` on `payment-proofs` bucket |
| `backend-go/internal/storage/supabase_storage.go` | Modify | Append `.pdf` suffix to filename when `contentType` starts with `application/` |
| `backend-go/internal/storage/supabase_storage_test.go` | Modify | Add two new tests for PDF filename suffix behaviour |
| `backend-go/internal/whatsapp/handler.go` | Modify | Add viewOnce + ephemeral unwrapping for `DocumentMessage` |
| `src/components/OrderHistoryScreen.tsx` | Modify | Render PDF card (link + icon) instead of `<img>` when URL ends in `.pdf` |

---

## Task 1: Remove MIME type restriction from Supabase Storage bucket

**Files:**
- Supabase project `zocefskkwykivbxhruoy` — `storage.buckets` table

The `payment-proofs` bucket currently has `allowed_mime_types = ["image/jpeg","image/png","image/webp","image/heic"]`. This rejects `application/pdf` and any other non-image content type, causing uploads to silently fail with HTTP 400.

- [ ] **Step 1: Run the SQL to clear the restriction**

Use the Supabase MCP tool `mcp__plugin_supabase_supabase__execute_sql` with `project_id = zocefskkwykivbxhruoy`:

```sql
UPDATE storage.buckets
SET allowed_mime_types = NULL
WHERE id = 'payment-proofs';
```

Expected: 1 row updated, no error.

- [ ] **Step 2: Verify the change**

```sql
SELECT id, public, allowed_mime_types
FROM storage.buckets
WHERE id = 'payment-proofs';
```

Expected: `allowed_mime_types` is `null`. `public` remains `true`.

- [ ] **Step 3: Commit**

No migration file needed — this is bucket metadata, not schema. Just update progress.md later in Task 5.

---

## Task 2: Append `.pdf` extension for document uploads in `supabase_storage.go`

**Files:**
- Modify: `backend-go/internal/storage/supabase_storage.go`
- Modify: `backend-go/internal/storage/supabase_storage_test.go`

Without a file extension, the frontend has no way to distinguish a PDF URL from an image URL. Adding `.pdf` when the content type is `application/*` gives the frontend a reliable signal.

- [ ] **Step 1: Write the failing tests first**

Open `backend-go/internal/storage/supabase_storage_test.go` and append these two tests after the existing ones:

```go
func TestUploadPaymentProof_PDFGetsSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-pdf", []byte("pdf-bytes"), "application/pdf")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !strings.HasSuffix(url, ".pdf") {
		t.Errorf("expected URL to end in .pdf for PDF uploads, got: %s", url)
	}
}

func TestUploadPaymentProof_ImageNoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-img", []byte("img-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.HasSuffix(url, ".pdf") {
		t.Errorf("image URL should not have .pdf suffix, got: %s", url)
	}
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd backend-go && go test ./internal/storage/... -v -run "TestUploadPaymentProof_PDF|TestUploadPaymentProof_ImageNoSuffix"
```

Expected: `TestUploadPaymentProof_PDFGetsSuffix` FAIL (URL has no `.pdf` suffix yet). `TestUploadPaymentProof_ImageNoSuffix` PASS (images already have no suffix).

- [ ] **Step 3: Implement the fix in `supabase_storage.go`**

Add `"strings"` to the import block and add the suffix logic after the `filename` declaration:

```go
import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, orderID string, data []byte, contentType string) (string, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
	if strings.HasPrefix(contentType, "application/") {
		filename += ".pdf"
	}
	uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, filename)
	// ... rest of function unchanged
```

The full function after the change:

```go
func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, orderID string, data []byte, contentType string) (string, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
	if strings.HasPrefix(contentType, "application/") {
		filename += ".pdf"
	}
	uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, filename)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("storage: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("storage: upload request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("storage: upload failed with HTTP %d", resp.StatusCode)
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/payment-proofs/%s", supabaseURL, filename)
	return publicURL, nil
}
```

- [ ] **Step 4: Run all storage tests to confirm they pass**

```bash
cd backend-go && go test ./internal/storage/... -v
```

Expected: all 5 tests PASS (`TestUploadPaymentProof_Success`, `TestUploadPaymentProof_ServerError`, `TestUploadPaymentProof_DefaultContentType`, `TestUploadPaymentProof_PDFGetsSuffix`, `TestUploadPaymentProof_ImageNoSuffix`).

- [ ] **Step 5: Build the whole project**

```bash
cd backend-go && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/storage/supabase_storage.go backend-go/internal/storage/supabase_storage_test.go
git commit -m "feat(storage): append .pdf suffix for application/* uploads, add tests"
```

---

## Task 3: Unwrap viewOnce and ephemeral PDFs in `handler.go`

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (lines 273–274, the `doc` extraction block)

Currently the handler extracts `DocumentMessage` only from the top-level message. If a customer's WhatsApp client wraps a PDF in a `viewOnceMessage` or `ephemeralMessage` envelope, `doc` is `nil` and the handler falls through to admin escalation instead of processing the proof.

There are no handler unit tests in this codebase (the handler has too many external dependencies to mock cheaply). Verification is via `go build` and the manual test in Task 4.

- [ ] **Step 1: Edit `handleMediaMessage` in `handler.go`**

Find the `doc` extraction block (currently line 273):

```go
	doc := evt.Message.GetDocumentMessage()
```

Replace it with:

```go
	doc := evt.Message.GetDocumentMessage()
	if doc == nil && evt.Message.GetViewOnceMessage() != nil {
		doc = evt.Message.GetViewOnceMessage().GetMessage().GetDocumentMessage()
	}
	if doc == nil && evt.Message.GetEphemeralMessage() != nil {
		doc = evt.Message.GetEphemeralMessage().GetMessage().GetDocumentMessage()
	}
```

The surrounding context for reference (lines 265–275 after the edit):

```go
	// Resolve image through wrapper types WhatsApp uses on newer clients.
	img := evt.Message.GetImageMessage()
	if img == nil && evt.Message.GetViewOnceMessage() != nil {
		img = evt.Message.GetViewOnceMessage().GetMessage().GetImageMessage()
	}
	if img == nil && evt.Message.GetEphemeralMessage() != nil {
		img = evt.Message.GetEphemeralMessage().GetMessage().GetImageMessage()
	}
	doc := evt.Message.GetDocumentMessage()
	if doc == nil && evt.Message.GetViewOnceMessage() != nil {
		doc = evt.Message.GetViewOnceMessage().GetMessage().GetDocumentMessage()
	}
	if doc == nil && evt.Message.GetEphemeralMessage() != nil {
		doc = evt.Message.GetEphemeralMessage().GetMessage().GetDocumentMessage()
	}
```

- [ ] **Step 2: Build to verify no compile errors**

```bash
cd backend-go && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(wa): unwrap viewOnce/ephemeral document for PDF payment proofs"
```

---

## Task 4: PDF-aware proof rendering in `OrderHistoryScreen.tsx`

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx` (lines 422–434, the payment proof `<img>` block)

Currently all proof URLs are rendered as `<img>`. A PDF URL causes a broken image icon. The fix detects `.pdf` in the URL and renders a clickable PDF card instead.

- [ ] **Step 1: Replace the `<img>` block**

Find this block (lines 422–434):

```tsx
                            {order.payment_proof_url ? (
                              <img
                                src={order.payment_proof_url}
                                alt="Bukti bayar"
                                className="w-16 h-20 object-cover rounded-lg border-2 border-blue-200 cursor-pointer"
                                onClick={() => window.open(order.payment_proof_url!, '_blank')}
                              />
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-lg flex flex-col items-center justify-center gap-1">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto Bukti</span>
                              </div>
                            )}
```

Replace it with:

```tsx
                            {order.payment_proof_url ? (
                              order.payment_proof_url.endsWith('.pdf') ? (
                                <a
                                  href={order.payment_proof_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="w-16 h-20 bg-red-50 border-2 border-red-200 rounded-lg flex flex-col items-center justify-center gap-1 hover:bg-red-100 transition-colors"
                                >
                                  <span className="text-red-500 text-2xl">📄</span>
                                  <span className="text-[9px] text-red-500 font-semibold">PDF</span>
                                </a>
                              ) : (
                                <img
                                  src={order.payment_proof_url}
                                  alt="Bukti bayar"
                                  className="w-16 h-20 object-cover rounded-lg border-2 border-blue-200 cursor-pointer"
                                  onClick={() => window.open(order.payment_proof_url!, '_blank')}
                                />
                              )
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-lg flex flex-col items-center justify-center gap-1">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto Bukti</span>
                              </div>
                            )}
```

- [ ] **Step 2: TypeScript build check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build
```

Expected: `✓ built in` with zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(ui): render PDF card instead of broken img for PDF payment proofs"
```

---

## Task 5: Rebuild daemon and update progress.md

**Files:**
- Modify: `progress.md`
- Rebuild: `backend-go/sinar-elektrik-backend`

- [ ] **Step 1: Rebuild and restart the daemon**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/backend-go && bash deploy.sh
```

Expected output ends with:
```
[DB] Connected to Supabase PostgreSQL
[WA] QR Code ready for scanning   ← or [WA] Connected if session is still valid
```

- [ ] **Step 2: Update `progress.md`**

Append this entry:

```markdown
## Payment Proof Fix v2 — DONE (2026-06-04)

Three bugs fixed that prevented PDF payment proofs from appearing in the admin dashboard:

1. **Supabase bucket MIME restriction removed**: `payment-proofs` bucket `allowed_mime_types` cleared to `null` so any file type can be uploaded.
2. **PDF filename suffix**: `UploadPaymentProof` now appends `.pdf` to the storage path when `contentType` starts with `application/`, letting the frontend detect PDFs by URL.
3. **viewOnce/ephemeral PDF unwrapping**: `handleMediaMessage` now also checks `GetViewOnceMessage().GetMessage().GetDocumentMessage()` and `GetEphemeralMessage().GetMessage().GetDocumentMessage()`, so wrapped PDFs reach the payment proof flow instead of falling through to admin escalation.
4. **Admin UI PDF rendering**: `OrderHistoryScreen` shows a red PDF card (link + icon) for `.pdf` URLs instead of a broken `<img>` tag.

Root cause of the original "stuck at WAITING_PAYMENT" report: the daemon binary was compiled at 02:50 on 2026-06-04, before the WhatsApp handler fixes were committed at 03:06. The binary was rebuilt and restarted via `deploy.sh`.
```

- [ ] **Step 3: Commit**

```bash
git add progress.md
git commit -m "chore: update progress.md — payment proof fix v2 complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ viewOnce PDF unwrapping → Task 3
- ✅ Bucket MIME restriction removed → Task 1
- ✅ `.pdf` suffix for frontend detection → Task 2 (storage) + Task 4 (frontend)
- ✅ PDF card rendering in admin UI → Task 4
- ✅ Tests for storage suffix change → Task 2

**Placeholder scan:** None. All steps have exact code or exact commands.

**Type consistency:** `UploadPaymentProof` signature unchanged — callers in `handler.go` unaffected. `order.payment_proof_url` is `string | undefined` in `DbOrder` — `endsWith('.pdf')` is called inside the truthy branch so no null-safety issue.
