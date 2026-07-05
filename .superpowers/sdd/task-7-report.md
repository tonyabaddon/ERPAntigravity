# Task 7 Report — FE paymentsApi + paymentsTypes + adminApi extension

**Status:** DONE_WITH_CONCERNS (minor — see below)
**Date:** 2026-07-05

## Files Changed

| File | Action |
|------|--------|
| `src/lib/paymentsTypes.ts` | Created — all type unions + interfaces verbatim from brief |
| `src/lib/paymentsApi.ts` | Created — 7 wrappers + storage helpers |
| `src/lib/paymentsApi.test.ts` | Created — 43 vitest tests |
| `src/lib/adminTypes.ts` | Modified — CoverageStatus union + 9 error classes |
| `src/lib/adminApi.ts` | Modified — normalizeRpcError extended |

## Test Summary

- New tests: **43 passed** (paymentsApi.test.ts)
- Existing tests: **42 passed** (adminApi.test.ts — unchanged)
- Baseline failures before this task: 65. After: 64. Net: 0 new failures (actually -1 because new file adds passing tests to count).
- TypeScript: `npx tsc --noEmit` — zero errors in new/modified files.

## Implementation Notes

### RPC parameter names verified from migrations
- `record_payment(p_payload jsonb)` — payload is the entire input object
- `update_payment(p_payment_id uuid, p_updates jsonb)`
- `delete_payment(p_payment_id uuid, p_reason text)`
- `list_payments(p_filters jsonb)`
- `get_revenue_stats(p_filters jsonb)`

### Storage signed URL
`generate_payment_proof_signed_url` confirmed absent from SQL (Task 5 concern documented). FE uses `supabase.storage.from('payment-proofs').createSignedUrl(key, 3600)` directly. StorageAccessDeniedError is thrown on any Storage error (including 403 status codes).

### normalizeRpcError dispatch order
P0404 branch now checks `PAYMENT_NOT_FOUND` FIRST before falling through to `TenantNotFoundError`. This is critical — a payment-not-found error was previously incorrectly surfacing as TenantNotFoundError.

### Error class count
Brief commit message said "8 error classes" but the spec body listed 9. Shipped 9 (the correct count from the message descriptions section).

## Concerns

1. **PaymentRow missing pagination fields** — Brief specifies `PaymentRow` verbatim, which omits `tenant_slug`, `tenant_name`, `total_count` that the backend RPC actually returns. Task 8 (PembayaranTab) will need to extend this interface or cast when rendering pagination. Note this at Task 8 start.

2. **Commit message error count** — Brief says "8 new typed error classes" in the commit template but actually requires 9. Corrected in commit body.
