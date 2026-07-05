# Task 10 Report — CoverageStatusBadge + TenantsTable Pembayaran + AttentionQueue OVERDUE + Regression

## Status: DONE

## Commits

- `35905a5` — feat(phase-b-wave5): Task 10a — CoverageStatusBadge + TenantsTable column
- `dfcbb8a` — feat(phase-b-wave5): Task 10b — AttentionQueue OVERDUE integration
- `10c` — docs(progress): Wave 5 Task 10 complete

## Test Summary

### TypeScript
- `npx tsc --noEmit`: 9 errors — all pre-existing stubs (pg, yaml, sonner, jsonwebtoken). Zero new errors.

### Vitest
- `npx vitest run src/`: 847 tests total, **842 pass**, 5 pre-existing failures (7 test assertions in 4 files — same set as before task).
- New tests added: 13 (CoverageStatusBadge) + 6 (AttentionQueue OVERDUE scenarios) = 19 new passing tests.

### Build
- `npm run build` not attempted locally — sonner not in worktree node_modules (same constraint as Wave 1/4a/9). Cloud Build handles fresh install.

## What Was Built

### 10a — CoverageStatusBadge + TenantsTable column

**`src/components/admin/CoverageStatusBadge.tsx`**
Reusable pill badge using VOSI design tokens:
- LUNAS → `bg-vosi-success/15 text-vosi-success` "Lunas"
- DP_60 → `bg-vosi-gold/15 text-vosi-navy` "DP 60%"
- DP_30 → `bg-vosi-gold/25 text-vosi-navy` "DP 30%"
- OVERDUE → `bg-vosi-danger/15 text-vosi-danger` "Terlambat"
- UNPAID → `bg-vosi-slate/15 text-vosi-slate` "Belum bayar"
- null/undefined → em-dash span

Font: `text-[11px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full`.

**`src/lib/adminApi.ts` — `listTenantsAdmin` extended**
Now runs `supabase.rpc('list_tenants_admin', ...)` + `supabase.from('v_tenant_payment_coverage').select(...)` in `Promise.all`, merges `coverage_status` onto each row by `tenant_id`. Coverage fetch is best-effort — any error is silently skipped; rows return without `coverage_status`.

**`src/components/admin/TenantsTable.tsx`**
Added "Pembayaran" column header + cell between Aktifitas and Aksi. Cell renders `<CoverageStatusBadge status={t.coverage_status ?? null} />`.

**`src/lib/adminTypes.ts`**
- `AdminTenantRow`: added `coverage_status?: CoverageStatus | null`
- `AttentionReason`: extended to include `'OVERDUE'`

**Badge consolidation**
- `PembayaranTab.tsx`: inline `CoverageBadge` function removed; uses `CoverageStatusBadge` (same `data-testid` preserved)
- `RevenueTopTenants.tsx`: inline `COVERAGE_BADGE` const + render logic removed; uses `CoverageStatusBadge`

Note: The label for OVERDUE changed from "Lewat" (old inline) to "Terlambat" (canonical). `RevenueTopTenants.test.tsx` updated accordingly.

### 10b — AttentionQueue OVERDUE integration

**`src/components/admin/AttentionQueue.tsx`**
- Runs `listAttentionTenants(withinDays)` + `supabase.from('v_tenant_payment_coverage').select(...).eq('coverage_status', 'OVERDUE')` in parallel.
- Merges by `tenant_id`. Deduplication rule: if tenant already in attention list, keep whichever reason has higher priority (SUSPENDED=1 > EXPIRED_AND_SUSPENDED=2 > OVERDUE=3 > EXPIRING=4).
- Sorted by priority ASC, then name as tiebreaker.
- OVERDUE "Detail →" link routes to `?tab=pembayaran`. All other reasons keep `?tab=ringkasan`.
- Coverage fetch is best-effort: on error, falls through with only subscription-attention rows.

## Concerns

1. **Extra DB round-trip in `listTenantsAdmin`**: Each tenants page load now issues one additional SELECT on `v_tenant_payment_coverage`. For admin panel with max 50 tenants per page, this is acceptable. The coverage view is lightweight (single JOIN). If scale becomes a concern, the `list_tenants_admin` RPC could JOIN the view server-side in a future migration.

2. **OVERDUE + SUSPENDED dedup** (escalation check): A tenant that is both SUSPENDED and OVERDUE will appear in AttentionQueue only once with SUSPENDED reason (higher priority). The OVERDUE coverage info is visible when clicking "Detail →" which goes to the Pembayaran tab anyway. This is intentional — the queue is actionable, not a full audit trail.

3. **`npm run build` not verified locally** — pre-existing constraint, Cloud Build handles it.
