# Design: Payment Proof Visibility Fix v2

**Date:** 2026-06-04

---

## Problem

Three bugs cause customer payment proofs to either not appear in the admin dashboard or appear without a viewable proof:

1. **viewOnce-wrapped PDFs not extracted.** `handleMediaMessage` unwraps `viewOnceMessage → imageMessage` but does NOT unwrap `viewOnceMessage → documentMessage` or `ephemeralMessage → documentMessage`. When a customer's WhatsApp client wraps a PDF in a viewOnce or ephemeral envelope, `img == nil` and `doc == nil` — the handler falls through to admin escalation, `UpdatePaymentProof` is never called, order status stays `WAITING_PAYMENT`, and the dashboard badge never appears.

2. **Supabase Storage bucket rejects PDFs.** The `payment-proofs` bucket has `allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/heic"]`. `application/pdf` is absent. Any PDF upload returns HTTP 400, `proofURL = ""`, `payment_proof_url` is stored as empty string. The badge appears (status advances to `PAYMENT_UPLOADED`) but the proof is blank.

3. **Frontend renders all proofs as `<img>`.** Even if a PDF URL were stored correctly, an `<img src="...pdf">` tag shows a broken image icon in every browser. The "Lihat Ukuran Penuh ↗" link works but the thumbnail is broken, making it unclear to admins that the proof exists.

---

## Fix

### Change 1 — `backend-go/internal/whatsapp/handler.go`

Extend the viewOnce and ephemeral unwrapping block to also extract documents:

```go
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

### Change 2 — `backend-go/internal/storage/supabase_storage.go`

Append `.pdf` to the filename when the content type starts with `application/`. This keeps image paths unchanged (browsers render them fine from `<img>`) and gives PDF uploads a detectable suffix:

```go
filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
if strings.HasPrefix(contentType, "application/") {
    filename += ".pdf"
}
```

`strings` is not currently imported in this file — add it to the import block.

### Change 3 — Supabase Storage bucket config

Remove `allowed_mime_types` restriction from the `payment-proofs` bucket by running:

```sql
UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'payment-proofs';
```

Applied via `mcp__plugin_supabase_supabase__execute_sql` (not a schema migration — this is bucket metadata stored in `storage.buckets`). The bucket remains public. MIME validation is not needed here; the backend controls what gets uploaded.

### Change 4 — `src/components/OrderHistoryScreen.tsx`

Replace the single `<img>` block with type-aware rendering that checks whether the URL ends in `.pdf`:

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

The existing "Lihat Ukuran Penuh ↗" `<a>` link below is unchanged — it opens any URL in a new tab and works for both images and PDFs.

---

## What Does NOT Change

- `backend-go/internal/whatsapp/sender.go` — `DownloadDocument` is already correct.
- `backend-go/internal/db/payment.go` — `UpdatePaymentProof` is already correct (always runs).
- `src/lib/supabaseClient.ts` — `fetchPaymentUploadedOrders` uses `select('*')` which already includes `payment_proof_url`.
- `src/types.ts` — `DbOrder.payment_proof_url?: string` is already typed correctly.
- The admin escalation fallback path — unchanged.
- The "Lihat Ukuran Penuh ↗" link in `OrderHistoryScreen.tsx` — already handles both types.

---

## File Map

| File | Change |
|------|--------|
| `backend-go/internal/whatsapp/handler.go` | Add viewOnce + ephemeral unwrapping for `documentMessage` |
| `backend-go/internal/storage/supabase_storage.go` | Append `.pdf` to filename when content type is `application/*` |
| Supabase bucket `payment-proofs` | Remove `allowed_mime_types` restriction (MCP call) |
| `src/components/OrderHistoryScreen.tsx` | Render PDF thumbnail card instead of `<img>` when URL ends in `.pdf` |

---

## Testing

1. **PDF proof:** Send a PDF from a test WhatsApp number in `WAITING_PAYMENT` state. Verify order advances to `PAYMENT_UPLOADED`, `payment_proof_url` ends in `.pdf`, and admin dashboard shows the PDF card with a working "Lihat Ukuran Penuh ↗" link.
2. **Image proof:** Send a JPEG image. Verify order advances, `payment_proof_url` has no `.pdf` suffix, and admin dashboard shows the image thumbnail.
3. **viewOnce PDF:** If testable, send a viewOnce document. Verify it is processed as a payment proof, not escalated to admin.
4. **Regression:** Send a text message in a `WAITING_PAYMENT` conversation. Verify AI still responds normally (timestamp filter still applies to text).
