# QA Week Phase 2 — Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Ship 3 batches from Phase 2: 2A (WT UX polish, 3 FE items), 2B (routing race + error class), 2E (financial FE writes → SECDEF RPCs). Order: 2A → 2B (both FE-only, no pool needed) → 2E (needs :5432 pool for migration apply).

**Architecture:** All batches independent. 2A + 2B are FE-only (no DB, no backend Go). 2E creates a new SECDEF RPC (`insert_audit_log_for_order_edit`) + refactors 3 FE call sites to route financial writes through existing RPCs (`record_pembayaran`, `record_tukar_faktur`) instead of direct FE writes.

**Tech Stack:** React 18 + TypeScript, Postgres 15 (Supabase). Migration apply via `scripts/apply-migration.sh` (Management API). No Cloud Run backend Go changes in Wave 2.

## Global Constraints

- **Prod backend on cf73c29b** (Phase 1 completion) — direct-pool warm instance holds slots. Do NOT trigger a new backend Go build cycle that could destabilize.
- **Migration slot 505** = FREE (503 = 2D RLS fix, 504 = 2C perf indexes both applied).
- **Pool may still be exhausted at Wave 2 start.** Wait for retry on pool-hitting steps. If mgmt-api down for >20min, escalate.
- **All migrations idempotent** (DROP IF EXISTS + guarded CREATE + ON CONFLICT DO NOTHING).
- **Reuse existing infrastructure:** `NewCustomerInlineForm` for F5-01, `showToast` for F5-12 error, existing `AccessDenied` component for F5-10.
- **Cost:** $0/tenant/month. No paid API additions.
- **Multi-tenant safety:** All FE code MUST resolve `tenantId` from session context, never hardcode. New RPC gets SECDEF ownership.
- **Auth discipline:** New SECDEF RPC must be owned by `vosi_rpc_owner` per memory `secdef_returning_gap`; if RETURNING clauses used, verify `t_select_own` policy includes owner role.
- **Advisor gate** required for 2E new SECDEF RPC (irreversible contract shipped to client). NOT required for 2A or 2B (pure FE, tactical).

---

### Task 1: 2A F5-12 — Block WT create when FROM=TO warehouse (~30min)

**Files:**
- Modify: `src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx`

**Interfaces:**
- Consumes: existing `from_warehouse_id` + `to_warehouse_id` state selectors
- Produces: submit button disabled + toast warning when FROM = TO

- [ ] **Step 1: Read `WarehouseTransferCreateScreen.tsx`** — locate submit button + form validation.

- [ ] **Step 2: Add derived state** `const sameWarehouse = fromWarehouseId && toWarehouseId && fromWarehouseId === toWarehouseId;`

- [ ] **Step 3: Disable submit button** when `sameWarehouse || <other existing conditions>`. Add tooltip / helper text below button: `"Gudang asal dan tujuan tidak boleh sama."` in red-600 when sameWarehouse.

- [ ] **Step 4: Toast fallback on submit attempt** (in case button click bypasses disabled state via keyboard/AT):
```typescript
if (sameWarehouse) {
  showToast('Gudang asal dan tujuan tidak boleh sama.', 'warning');
  return;
}
```

- [ ] **Step 5: Add unit test** in existing `WarehouseTransferCreateScreen.test.tsx` — assert submit disabled when from=to; enabled when from≠to.

- [ ] **Step 6: Local lint + vitest --changed.** No commit yet (batched at end of Task 3).

---

### Task 2: 2A F5-14 — WT DIKIRIM KEPADA empty helper (~30min)

**Files:**
- Modify: `src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx`

- [ ] **Step 1: Locate DIKIRIM KEPADA dropdown** (recipient/receiver picker).

- [ ] **Step 2: Empty-state helper** — when the recipient list has 0 rows:
```tsx
{recipients.length === 0 && (
  <p className="text-xs text-slate-500 mt-1">
    Belum ada penerima. Tambahkan user via Pengaturan → User Management.
  </p>
)}
```

- [ ] **Step 3: Optional link to User Management** if screen route exists (verify `?screen=user-management` or equivalent via `buildHref`).

- [ ] **Step 4: Unit test — assert helper renders when recipients=[].**

---

### Task 3: 2A F5-01 — PelangganScreen "+ Tambah Pelanggan" (~1h)

**Files:**
- Modify: `src/components/PelangganScreen.tsx`
- Reuse: `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`

- [ ] **Step 1: Read PelangganScreen.tsx** — identify header/toolbar area.

- [ ] **Step 2: Add `showAddModal` state.** Add button in top-right of header: `+ Tambah Pelanggan` styled matching design system (bg-navy text-white rounded-lg).

- [ ] **Step 3: On click open a modal wrapping `NewCustomerInlineForm`.** Wire `onSaved` → refresh customer list. Wire `onCancel` → close modal.

- [ ] **Step 4: Bahasa toast on success:** `"Pelanggan {name} tersimpan."`

- [ ] **Step 5: Unit test — button renders, click opens modal, onSaved closes modal + calls refresh.**

- [ ] **Step 6: Local gates green (lint + audit:numinput + audit:secdef-null-tenant + vitest --changed).**

- [ ] **Step 7: Commit + push all 3 batches together:**
```bash
git add src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx \
        src/components/warehouseTransfer/__tests__/WarehouseTransferCreateScreen.test.tsx \
        src/components/PelangganScreen.tsx \
        src/components/PelangganScreen.test.tsx
git commit -m "[qa-week-followup] 2A: WT create FROM=TO block + DIKIRIM helper + Pelanggan tambah button"
git push origin main
```

---

### Task 4: 2B F5-11 — Routing observation (~30min) [refactor DEFERRED per advisor]

**Files:**
- Create: `docs/audits/2026-07-21-urlroute-behavior.md`

**Context:** Spec calls this "useURLRoute" but grep shows `urlRoute.ts` / `buildHref` (no `useURLRoute` symbol). Advisor flagged: no concrete evidence of a real routing race bug beyond the spec's claim. Refactoring routing has blast radius (deep links from WA messages, invoices, external systems using path-based URLs) and cannot be chrome-smoke-verified in current session (MCP profile held).

**Approach change:** narrow Task 4 to observation-only. Document current path/query parsing behavior. If observation surfaces a REAL race (asserted by grep-level evidence, not spec assertion), spawn a follow-up refactor task in Wave 3. Otherwise: mark F5-11 as "spec claim not reproduced; deferred pending symptom".

- [ ] **Step 1: Read + grep** `src/lib/urlRoute.ts`, `src/App.tsx` routing sections, `src/components/Sidebar.tsx` navigation.

- [ ] **Step 2: Document** in `docs/audits/2026-07-21-urlroute-behavior.md`:
  - Where `?screen=` is read + written
  - Where path segments are read + written
  - Any place both are simultaneously mutated without atomicity guard
  - Grep count of `buildHref` callers vs direct `history.push` / `location.assign` (a direct path-based navigation without `?screen=` is a candidate race source)

- [ ] **Step 3: Verdict:** if audit finds a REAL race site → spawn Wave 3 refactor task. Otherwise: mark F5-11 as "not reproduced from spec claim, deferred".

- [ ] **Step 4: No FE code change in Task 4.** No commit needed unless audit doc.

---

### Task 5: 2B F5-10 — Error class branch for impersonate failure (~2h)

**Files:**
- Modify: `src/App.tsx`
- Reuse: `src/components/errors/AccessDenied.tsx`, `src/components/errors/TenantBootstrapError.tsx`

**Context:** When impersonate fails (bad tenant, expired session), currently ALL users see `TenantBootstrapError`. Should branch: platform_admin trying to impersonate → `AccessDenied` (they went to wrong tenant); tenant user with genuinely broken tenant → `TenantBootstrapError`.

- [ ] **Step 1: Read `App.tsx` impersonateGate failure path** — where TenantBootstrapError renders.

- [ ] **Step 2: Access `_is_platform_admin` from JWT claim** (via auth context / RLS helper).

- [ ] **Step 3: Branch:**
```tsx
if (impersonateFailed) {
  return _is_platform_admin
    ? <AccessDenied reason="impersonate-failed" tenant={targetTenantSlug} />
    : <TenantBootstrapError />;
}
```

- [ ] **Step 4: Emit Sentry tag** (memory reference `project_sentry_setup`): `Sentry.setTag('error_class', _is_platform_admin ? 'impersonate' : 'tenant_bootstrap');` before render.

- [ ] **Step 5: Unit test — impersonateGate failure with platform_admin=true renders AccessDenied; with false renders TenantBootstrapError.**

- [ ] **Step 6: Commit 2B together:**
```bash
git add src/lib/urlRoute.ts src/App.tsx src/components/Sidebar.tsx <test files>
git commit -m "[qa-week-followup] 2B: routing source-of-truth + impersonate error class"
git push origin main
```

---

### Task 6: 2E — Financial FE writes → SECDEF RPCs (~4h, advisor gate)

**Files:**
- Create: `supabase/migrations/20261115000505_insert_audit_log_for_order_edit.sql`
- Create: `tests/sql/qa-week/2e-regression.sql`
- Create: `docs/superpowers/specs/2026-07-21-2e-financial-rpcs-decision.md`
- Modify: `src/lib/pembayaranService.ts`, `src/lib/tukarFakturService.ts`, `src/components/sales/EditOrderModal.tsx`

**PREREQUISITE:** Mgmt-api must be responsive (pool free). If mgmt-api returns 53300 exhaustion, ESCALATE to founder; do NOT force through.

- [ ] **Step 1: Verify existing RPCs.** Grep migrations for `record_pembayaran` + `record_tukar_faktur` signatures. Verify FE call sites match.

- [ ] **Step 2: Read `pembayaranService.ts` `tukarFakturService.ts`** — find any direct `supabase.from('pembayaran').insert(...)` bypassing the RPCs. If everything already routes through RPCs, task narrows.

- [ ] **Step 3: Read `EditOrderModal.tsx` audit_log insert** at line ~lookup. Current pattern: client-side `supabase.from('audit_log').insert(...)`. Migration 502 changed audit_log PK to composite (tenant_id, id). Direct FE insert must still work (audit_log has permissive policy). If policy broke after 502, that's the reason to add SECDEF wrapper.

- [ ] **Step 4: Verify audit_log RLS.** Check `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='audit_log'`. If INSERT policy allows authenticated, keep direct write (skip SECDEF creation). If only p_platform_admin or restricted, add SECDEF wrapper.

- [ ] **Step 5: If SECDEF needed, write migration 505:**
```sql
CREATE OR REPLACE FUNCTION insert_audit_log_for_order_edit(
  p_order_id uuid,
  p_event_type text,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_tenant uuid := _resolve_tenant_id();
BEGIN
  INSERT INTO audit_log (tenant_id, event_type, actor_user_id, payload)
  VALUES (v_tenant, p_event_type, auth.uid(), p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
ALTER FUNCTION insert_audit_log_for_order_edit(uuid, text, jsonb) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION insert_audit_log_for_order_edit(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION insert_audit_log_for_order_edit(uuid, text, jsonb) TO authenticated;
```

- [ ] **Step 6: Decision memo per CLAUDE.md irreversible-decision template.**

- [ ] **Step 7: Advisor gate — call `advisor()` with the memo.**

- [ ] **Step 8: Apply migration via `scripts/apply-migration.sh 505`.** Verify:
```sql
SELECT proname, prosecdef, proowner::regrole::text FROM pg_proc WHERE proname = 'insert_audit_log_for_order_edit';
```

- [ ] **Step 9: Refactor `EditOrderModal.tsx`** — replace direct insert with `supabase.rpc('insert_audit_log_for_order_edit', {...})`. Update the "why client-side" comment.

- [ ] **Step 10: Regression SQL — verify RPC executes as expected under `set_config('request.jwt.claim.sub', ...)` fake auth.**

- [ ] **Step 11: Local gates + commit:**
```bash
git add supabase/migrations/20261115000505_insert_audit_log_for_order_edit.sql \
        tests/sql/qa-week/2e-regression.sql \
        docs/superpowers/specs/2026-07-21-2e-financial-rpcs-decision.md \
        src/components/sales/EditOrderModal.tsx
git commit -m "[qa-week-followup] 2E: SECDEF wrap audit_log inserts from EditOrderModal"
git push origin main
```

---

### Task 7: Wave 2 completion + multi-tenant matrix (~30min)

- [ ] **Step 1: Wait for Cloud Build SUCCESS** for all Wave 2 commits (2A, 2B, 2E). Backend build should succeed after cloudbuild.yaml bypass. FE build should succeed with staging BE healthy.

- [ ] **Step 2: Re-run 3-tenant × 6-table multi-tenant matrix** (Wave 1 pattern). Expected: 0 leaks.

- [ ] **Step 3: Update `docs/qa-week/phase-2-report.md`** with Wave 2 shipped sections.

- [ ] **Step 4: Update `.superpowers/sdd/progress.md`.**

- [ ] **Step 5: Final commit + push:**
```bash
git add docs/qa-week/phase-2-report.md
git commit -m "[qa-week-followup] docs: Phase 2 Wave 2 completion (2A + 2B + 2E)"
git push origin main
```

---

## Advisor consulted

Real advisor call before Wave 2 finalized (2026-07-21). Key findings verbatim:

- **(Task 4 speculative)** Spec says "useURLRoute" but grep shows `urlRoute.ts` / `buildHref` — no such symbol. No concrete evidence of a routing race bug beyond the spec's claim. Refactoring has blast radius (deep-links from WA/email use path-based URLs). Task 4 REWRITTEN to observation-only (audit doc). Conditional refactor deferred to Wave 3.
- **(Pool fragility)** Prod cf73c29b warm instance is one idle-timeout away from another P0 if `min-instances=0`. **Verified prod has `min-instances=1, max-instances=1` — protected.** Safe to proceed with commits.
- **(Task 6 audit_log RLS check)** Preserve — Migration 502's composite PK swap may or may not have affected INSERT policy. Verify policy state BEFORE assuming SECDEF wrap is needed. If direct FE insert still works, 2E narrows to documentation-only.
- **(2A + 2B — advisor unnecessary)** Tactical FE additions, single-file scope, additive. Skip.
- **(Wave 2 scope narrow)** With Task 4 rewritten + Task 6 conditional, Wave 2 workload drops from ~10h to ~4-6h. Feasible in remaining autonomous window.

## I verified

Concrete evidence gathered at plan-time (via grep + read):

- **2A F5-12 target:** `src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx` exists (grep confirmed).
- **2A F5-01 reuse target:** `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` exists (used in Wave 1 F5-05 friendly-error fix).
- **2A F5-01 host screen:** `src/components/PelangganScreen.tsx` exists.
- **2B F5-11 module:** `src/lib/urlRoute.ts` exists; `buildHref` function verified. No `useURLRoute` symbol (spec name aspirational).
- **2B F5-10 error components:** `src/components/errors/AccessDenied.tsx` + `TenantBootstrapError.tsx` both exist.
- **2E RPCs exist:** `record_pembayaran` migrations found (20260620000006, 20260723000003, 20261115000239, 20261115000315). `record_tf` variants also present (20260627000003 etc). NEW RPC needed only for `insert_audit_log_for_order_edit`.
- **2E audit_log direct insert site:** `src/components/sales/EditOrderModal.tsx` has `supabase.from('audit_log').insert(...)` — confirmed via grep with comment "Why client-side, not an RPC: the audit_log table has no RLS...".
- **Migration slot 505 free:** slots 503, 504 taken by Wave 1; nothing between.

## Adversarial critique

- **(a) 2A F5-12 button-disable can be bypassed via keyboard Enter or paste-triggered submit.** → **Mitigation:** Step 4 adds toast fallback inside the submit handler.
- **(b) 2A F5-01 modal may fail to focus-trap; keyboard users could tab out to background.** → **Mitigation:** reuse the modal wrapper already used in the codebase (check if there's a standard `<Modal>` component; use it). If not present, note as a follow-up for Wave 3 accessibility pass.
- **(c) 2B F5-11 routing refactor could break deep-links from external systems (WA messages, email invoices) that use path-based URLs.** → **Mitigation:** keep `/t/<slug>/` prefix parsing for tenant context; only strip screen segment from path. Test with known external link URL formats before merge.
- **(d) 2B F5-10 `_is_platform_admin` claim may be stale after impersonate — user impersonated OUT of admin, claim still `true`.** → **Mitigation:** re-read claim from live session, not cached. If claim source is session context that's updated on impersonate exit, safe.
- **(e) 2E EditOrderModal comment says "audit_log has no RLS". Migration 502 (composite PK on audit_log) MAY have changed policy state. Task 6 Step 4 explicitly verifies live policy state before assuming SECDEF wrap is needed.** If audit_log INSERT is still open to authenticated, we can skip creating a new RPC and narrow 2E further.
- **(f) 2E advisor gate is required per CLAUDE.md (new SECDEF RPC = irreversible client contract). Skip only if Step 4 shows no RPC needed at all.**
- **(g) Pool exhaustion could re-block 2E migration apply mid-execution.** → **Mitigation:** Task 6 PREREQUISITE gate escalates rather than force.
- **(h) Wave 2 doesn't touch backend Go, but any commit triggers backend Cloud Build.** cloudbuild.yaml bypass (from `00ab986`) prevents prod redeploy attempts. Backend build should PASS overall (staging OK, prod bypassed).
