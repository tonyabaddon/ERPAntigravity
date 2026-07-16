# Phase 1 Task 2 Report — Bucket audit + fix

**Date:** 2026-07-16
**Status:** DONE_WITH_CONCERNS (1 bucket deferred — product-photos needs founder input)

---

## Bucket verdicts

| Bucket | Verdict | Severity (before) | Action |
|---|---|---|---|
| accounting-proofs | LEAK → FIXED | cross-tenant SELECT+INSERT on public bucket | private + tenant-scoped RLS |
| branding | LEAK → FIXED | anon ALL write (internet-writable!) + cross-tenant ALL | drop anon+authenticated write; tenant-scoped INSERT/UPDATE/DELETE; public read kept; 3 files renamed |
| chat-media | FIXED (Task 1) | — | no-op |
| payment-proofs | LEAK → FIXED | cross-tenant SELECT+INSERT overrode slug-based guard | drop cross-tenant policies; UUID path; 5 files renamed; DB backfill orders.full_proof_url |
| product-photos | DEFERRED | cross-tenant write; backend Go serves public URLs | see concern below |
| purchase-documents | LEAK → FIXED | anon ALL (internet-writable!) + cross-tenant ALL on public bucket | private; drop anon; tenant-scoped CRUD; 3 files renamed; DB backfill 4 tables |
| stock-evidence | LEAK → FIXED | cross-tenant SELECT+INSERT (already private bucket) | tenant-scoped RLS; FE upload paths updated |

**Summary: LEAK: 5 fixed, INTENTIONAL: 0, DEFERRED: 1**

---

## Key concern: product-photos deferred

`product-photos` is `public=true` with `product_photos_insert/update/delete` policies scoped only to `authenticated` (no tenant filter) — any tenant can overwrite any other tenant's SKU photos.

The reason for deferral: `backend-go/products_search.go:78` calls `publicURL()` which constructs `https://{ref}.supabase.co/storage/v1/object/public/product-photos/{path}`. Making the bucket private would require the Go backend to mint signed URLs on every search result.

**Recommended fix (Option A, minimal):** Keep public read, add tenant-scoped INSERT/UPDATE/DELETE policies (path pattern: `tenants/{tenant_id}/{sku}/{order}.jpg`). Closes write-side leak without touching Go backend. FE `uploadProductPhoto` needs tenant prefix. ~1 hour of work.

**Option B (complete):** Private bucket + Go backend signed URLs. Correct long-term. ~1 day of work.

---

## Changes shipped

### Migration: `supabase/migrations/20261115000301_bucket_security_hardening.sql`
Applied via execute_sql (apply_migration fails for storage.objects policies — known from Task 1).

- Dropped: `branding_anon_write`, `anon full access purchase-documents` (both internet-writable), `branding_authenticated_write`, `authenticated full access purchase-documents`, `Authenticated users can view/upload payment proofs`, `authenticated can read/upload accounting-proofs`, `authenticated can read/upload stock-evidence`
- Added: tenant-scoped policies on 5 buckets, `tenants/{tenant_id}/...` UUID pattern (consistent with migration 300)
- Bucket flags: accounting-proofs → private, purchase-documents → private, branding stays public
- File renames: 11 total (3 branding + 5 payment-proofs + 3 purchase-documents) to tenant-prefixed paths
- DB backfill: `orders.full_proof_url`, `purchase_invoices.payment_proof_url`, `purchase_orders.payment_proof_url`, `pembayaran.proof_url` converted from full public URLs to storage paths

### New component: `src/components/ui/StorageLink.tsx`
Reusable link that resolves private storage paths to signed URLs on click. Handles both legacy full URLs (passthrough) and new storage paths. Used by all display sites for private buckets.

### FE upload sites updated (10 files):
All now produce `tenants/{tenant_id}/...` paths and return storage paths (not public URLs) for private buckets.

### FE display sites updated (4 components):
PembelianDetailPage, PembayaranDetailPage, BelanjaNumpangLewatDetailPage, OrderHistoryScreen — all use StorageLink for private-bucket references.

---

## Test summary

- `npm run lint`: CLEAN
- `npm run audit:numinput`: CLEAN
- `npm run audit:secdef-null-tenant`: CLEAN
- `npx vitest run --changed`: 628 pass; 8 pre-existing failures in unrelated files (AdminRoutes, TenantsList, pengaturan/mutations, productWrappers)
- `get_advisors`: 2 WARN (branding + product-photos public listing) — pre-existing, intentional; no new findings

---

## Follow-up items

1. **product-photos write-side leak** — choose Option A or B above
2. **`paymentsApi.uploadPaymentProof` signature change** (`tenantId` UUID, not slug) — confirmed in RecordPaymentModal.test.tsx; RenewSubscriptionModal also updated
3. Existing `test/1780598141.jpg` artifact in payment-proofs bucket intentionally left (not linked to any DB record, not renamed — orphan test file)
