# Task 6 Report — FE: RenewSubscriptionModal + OverviewTab wire

**Status:** DONE
**Date:** 2026-07-05

## Files changed

| File | Action |
|------|--------|
| `src/components/admin/RenewSubscriptionModal.tsx` | Created |
| `src/components/admin/RenewSubscriptionModal.test.tsx` | Created |
| `src/components/admin/TenantDetail/OverviewTab.tsx` | Modified |
| `src/components/admin/TenantDetail/TenantDetailShell.tsx` | Modified |
| `src/components/admin/TenantDetail/OverviewTab.test.tsx` | Modified (added mocks) |
| `.superpowers/sdd/progress.md` | Updated |

## Test summary

- 20 new RTL tests in `RenewSubscriptionModal.test.tsx` — all pass.
- All 8 pre-existing `OverviewTab.test.tsx` tests — still pass.
- All 9 pre-existing `TenantDetailShell.test.tsx` tests — still pass.
- Full suite: 659 unit tests pass, 5 pre-existing failures unchanged (AdminRoutes x2, productWrappers x3).
- `npx tsc --noEmit`: 0 new errors (9 pre-existing unrelated errors unchanged).

## Design decisions

1. **Plan select default** — Brief is ambiguous: top-level spec says `— Tidak diganti — (sends null)`, modal sub-spec says `default = current plan_code`. Chose `— Tidak diganti —` (sends null). Rationale: safer choice — avoids unintended plan-change audit events when admin only wants to extend the expiry date, not change the plan.

2. **Panel headerAction prop** — Added optional `headerAction?: ReactNode` to the `Panel` primitive to accommodate the Perpanjang button cleanly without breaking the table layout. Existing panels pass `undefined` (no change in render).

3. **OverviewTab test mock** — Added `adminToast` and `renewSubscription` mocks to `OverviewTab.test.tsx`. Required because my import of `RenewSubscriptionModal` into `OverviewTab` introduced a transitive chain: `modal → adminToast → sonner`, and `sonner` cannot be resolved in the vitest environment. The pre-existing `TenantDetailShell.test.tsx` already mocked `adminToast` for the same reason.

4. **refreshKey re-fetch** — `TenantDetailShell` hoists a `refreshKey: number` state. After successful renewal, `OverviewTab` calls `onDataChange?.()` which bumps `refreshKey`. The existing `useEffect([tenantSlug, refreshKey])` re-fetches the tenant row, updating the displayed `expires_at` and `expiry_mode` automatically. The existing `cancelledRef` pattern handles concurrent requests safely.

5. **Focus on open** — Implemented via `requestAnimationFrame` inside `useEffect` gated on `open` (not a full focus trap — the brief's "focus trap" was clarified to mean focus-on-open only).

## Concerns

None. All deliverables from the brief are implemented and passing.
