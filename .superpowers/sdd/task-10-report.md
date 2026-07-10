# Task 10 Report — Wave 6: Wizard integrate Edge Function + PaymentInstructionBlock

## Status: DONE

## Commit

- `b2d41bd` — feat(admin): wizard uses Edge Function + PaymentInstructionBlock

## Files Changed

- **Created**: `src/components/admin/PaymentInstructionBlock.tsx`
  - Fetches platform_settings + plan.price_annual on mount (useEffect + async, cancelled ref)
  - Renders buildMessage() as `<pre font-mono text-[12px] whitespace-pre-wrap>` + Copy button + WhatsApp share link
  - VOSI tokens (navy bg Copy button, gold WA link), font floor 12px

- **Created**: `src/components/admin/PaymentInstructionBlock.test.tsx`
  - 4 tests: loading state, full render with mocked data, Copy button calls clipboard.writeText, error state on load failure

- **Created**: `src/components/admin/TenantWizard.test.tsx`
  - 5 tests: renders step 1, UUID field absent from OwnerStep, happy path (fetch mock 201 → ResultStep + PaymentInstructionBlock), E5 slug conflict → Bahasa message, no session → E1 error

- **Modified**: `src/components/admin/TenantWizard.tsx`
  - `EDGE_ERROR_MESSAGES` + `mapEdgeErrorToBahasa` added at module top
  - `ProvisionResult` split into `EdgeProvisionResult` (EF response: tenant_id/slug/owner_user_id/expires_at) + `ProvisionResult` (extended with form-supplied name + plan_code)
  - `submit()` replaced: direct `supabase.rpc('provision_tenant')` → `fetch()` to `/functions/v1/create-tenant-owner`
  - `goNext()` OwnerStep: `validateUuid` check removed
  - `OwnerStep`: stale "buat via Supabase Dashboard" callout + UUID input removed; shows invite-flow info text
  - `ReviewStep`: Owner UUID row removed; description updated to mention Edge Function
  - `ResultStep`: `<PaymentInstructionBlock>` added after success card
  - Header description updated to reflect automated invite flow

## Test Summary

- **Vitest**: 2 test files, **9/9 tests passed**
- **tsc --noEmit**: clean (exit 0)

## Concerns

- Edge Function `SuccessResponse` does NOT return `name` or `plan_code`; these are stitched from form state at submit time. Documented in code via comment.
- `validateUuid` + `UUID_RE` are now dead code — left in place per Note D "defensive minimum change".
- Chrome MCP E2E smoke deferred to Task 17 per Note J.
