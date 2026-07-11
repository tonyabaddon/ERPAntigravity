# Item #1 Execution — BLOCKED (schema audit findings)

**Status:** HALTED before dispatching any subagent
**Date:** 2026-07-12 (overnight autonomous run)
**Branch:** `feat/opname-damage-supplier-claims` (committed locally, no push)
**Nothing was deployed, nothing was applied to prod, nothing was merged to main.**

---

## TL;DR — 3 decisions you need to make before code lands

**A.** Given no PO in Garindo prod has ever had `damage_status ≠ 'NONE'` (0 rows), is the "unify PO receipt damage + opname damage" scope still worth building? Or should Item #1 revert to **opname-only** (Option 3 from brainstorm)?

**B.** Opname damage flow: **bypass `stock_adjustments` entirely** (write directly to stock_movements + journal + supplier_claim) or **relax `stock_adjustments.approval_request_id`** to NULLABLE via schema change?

**C.** COA seeding for new accounts (`1-1460`, `5-3160`): **per-tenant seed loop** (each tenant gets their own row), or introduce a **"system accounts" concept** (global accounts referenced across tenants)?

I halted so you can decide, not so I can pick for you.

---

## What happened

I invoked `subagent-driven-development` to execute the 26-task plan. Before dispatching Task 1, I ran a live schema audit against Garindo prod (`ekhhojaezdfjfwuxyjkl`) to enumerate existing constraints — the discipline required by memory `check_constraints_before_rpc_rewrite`.

The audit surfaced drift between the plan's inferred schema and prod reality. Some drift is patchable. Two items are architectural pivots that need your sign-off.

---

## Findings — by severity

### 🔴 P0 architectural (blocks execution)

**F1. `damage_status` is TEXT, not an enum.** The whole story in spec §2.3 / plan Task 2 about `ALTER TYPE damage_status_enum ADD VALUE 'RESOLVED_CREDITED'`, etc., is invalid. There is no `damage_status_enum` in prod. `purchase_order_items.damage_status TEXT NOT NULL` is free-text with app-level convention.

Related: production has **0 rows** where `damage_status ≠ 'NONE'` in `purchase_order_items`. Garindo has never used the PO damage flow. The "unify" premise in the brainstorm (Option 1 over Option 3) rested on integrating an existing workflow — but that workflow has never been used in production.

**Decision needed (A):** does the unify story still hold? Or is opname-only a cleaner Item #1, and PO damage handling becomes a separate item when Garindo actually starts using it?

**F2. `stock_adjustments.approval_request_id BIGINT NOT NULL`.** Plan Task 4 inserts a `stock_adjustments` row directly from `create_supplier_claim_from_opname` (representing the "stock decrement for opname damage"). But every `stock_adjustments` row MUST have a linked `approval_request` — the opname session itself is the approval context, not a separate adjustment approval.

Two options:
- **Option 1 (bypass adjustments):** opname damage skips `stock_adjustments` entirely. Directly writes `stock_movements` + `_post_journal_entry` + `supplier_claims` insert (for KLAIM). Simpler. Diverges from spec §3.3 which said "adjustments as intermediate step".
- **Option 2 (relax NOT NULL):** ALTER `stock_adjustments.approval_request_id DROP NOT NULL`. Then opname damage inserts adjustment with null approval_ref. Preserves spec but is a wider schema change affecting all existing code paths.

Also relevant: `stock_adjustments.status` CHECK is `('pending_approval','approved','rejected','expired')` — plan's `'COMMITTED'` value violates this. If we go Option 2, we'd use `'approved'` (matching existing pattern for approved+committed adjustments).

**Decision needed (B).**

### 🟠 P1 (small patches, decidable inline once you're back)

**F3. `chart_of_accounts` is per-tenant.** Every tenant has its own COA rows. Plan Task 2 seeds `1-1460` and `5-3160` as global rows. Correct approach: loop across `tenants` and INSERT one row per tenant per new account. Also `parent_id` is UUID, not `parent_code TEXT` as spec assumed — must look up parent by code first.

**Decision needed (C):** confirm per-tenant loop is the right pattern (matches existing conventions), or is there a "system accounts" concept I missed?

**F4. `purchase_order_items.id` is UUID, not BIGINT.** `supplier_claims.source_ref_id BIGINT` breaks. Fix: change to `TEXT` (stringify all source IDs — opname session_id::TEXT, PO item id::TEXT, adjustment id::TEXT). Small edit, no ambiguity.

**F5. `chk_evidence_for_loss` on `stock_adjustments` requires `cardinality(evidence_urls) >= 1` when `reason_code IN ('rusak','hilang')`.** Spec §5.1 says photo optional. UI must enforce **mandatory photo** for damage flag when disposition writes to adjustments. Small UI edit; matches existing `StockAdjustmentModal` behavior anyway.

**F6. `stock_adjustments.warehouse` CHECK IN `('atas','bawah')`.** Pre-Phase 3 hardcoded Garindo warehouse names. Plan already uses these correctly; noted for reference. Post-Phase 3 warehouse cutover, this constraint needs updating in a separate migration.

**F7. RLS tenant helper is `_resolve_tenant_id()`** — plan's `p_select_own` policy uses `(SELECT tenant_id FROM user_tenant WHERE user_id = auth.uid())`. Existing pattern uses `_resolve_tenant_id()`. Swap for consistency.

**F8. `approval_request_type` enum needs new value `'resolve_supplier_claim'`.** Plan spec assumed this could be arbitrary TEXT; it's actually an enum. Small ALTER TYPE addition to migration 100.

### 🟡 P2 (informational)

**F9. `receive_replacement` exists as an RPC in prod** — safe to wrap as `resolve_supplier_claim(outcome=RESOLVED_REPLACED)`. Backward compat plan holds.

**F10. `record_pi`, `receive_purchase_order`, `commit_opname_session`, `_apply_adjustment_change` all exist** — plan modifications are all real code paths, no non-existent RPCs.

**F11. `_post_journal_entry` exists** as documented in earlier spec.

**F12. Existing seed migration `20261115000053_seed_tenant_accounting_on_provision.sql` shows per-tenant COA seeding pattern** — reference for F3 solution.

---

## Why I stopped rather than plow through

The advisor call before dispatching subagents surfaced that F1 and F2 aren't schema patches — they're architecture reversals:

- **F1** flips the value equation of the brainstorm's Option 1 vs Option 3 decision. You picked unify because integrating with an existing workflow felt cheaper than a parallel one. If that "existing workflow" is dormant, the value argument for unify weakens.
- **F2** changes whether opname damage flows through `stock_adjustments` (spec §3.3's architectural commitment) or directly to movement+journal+claim.

Writing SQL against a spec built on wrong assumptions costs more than a delayed start. If I coded either pivot autonomously, you'd wake to a design you didn't approve. If I coded around the constraints blindly (e.g., inserting placeholder approval_request rows), you'd wake to code that violates the constraint at runtime and needs a rewrite.

Halting with a clear "3 decisions" doc is the honest handoff.

---

## What IS committed on the branch

- `docs/superpowers/specs/2026-07-12-opname-damage-supplier-claims-design.md` (from brainstorm)
- `docs/superpowers/plans/2026-07-12-opname-damage-supplier-claims-plan.md` (26-task implementation plan)
- `docs/superpowers/plans/2026-07-12-opname-damage-BLOCKED.md` (this file)
- `.superpowers/sdd/opname-damage/progress.md` (SDD ledger — halted state)
- Memory: `feedback_no_wa_owner_approval.md` (added for RESOLVE_SUPPLIER_CLAIM verification methods)

**No SQL, no RPCs, no frontend, no migrations applied, no deploy.** Main branch untouched.

---

## Suggested resolution path when you're back

**Step 1:** decide A, B, C above. Ideally in a 5-minute Slack-style back-and-forth with me (or in-terminal).

**Step 2:** based on decisions, I revise the spec (2026-07-12-opname-damage-supplier-claims-design.md) and plan (2026-07-12-opname-damage-supplier-claims-plan.md) inline. Small delta if A=unify+B=bypass; larger delta if A=opname-only.

**Step 3:** re-invoke subagent-driven-development. Given the schema-aligned plan, execution risk drops significantly.

**Step 4:** ship Phase A (schema + new RPCs + reads). Then Phase B (modifications to existing RPCs) with your review checkpoints. Then frontend.

Realistic timeline given the pivots: 2-3 days for careful shipping, not overnight. Item #1 is bigger than a single-night autonomous run — that's OK, better than shipping broken.

---

## Cost tonight

Approximately: brainstorm session tokens + plan writing + schema audit + this doc. No subagent dispatches. No frontend build. No deploy costs.

Your bill for tonight is the design work + audit, not 12+ hours of Opus subagent execution.

---

## My recommendation on the 3 decisions

Honest opinion, you decide:

**A: opname-only** (Option 3). Unify was justified by workflow integration; 0-row prod data undermines that. Ship opname damage flag first as tight scope. PO damage unification becomes Item #1b when Garindo actually starts flagging PO damage (which they haven't in 12+ months of operation).

**B: bypass `stock_adjustments`** for opname damage. Cleaner architecture — opname is its own event stream. Existing ad-hoc rusak adjustment flow keeps working via existing pipeline. Two flows with different reasons: opname damage discovered during count, ad-hoc rusak discovered outside opname. They're conceptually distinct.

**C: per-tenant loop** matching `20261115000053` pattern. Reuse the existing seed convention. No new "system accounts" concept needed.

Under these three, Phase A shrinks to ~4-5 tasks (schema, opname damage RPC, resolve RPC, reads, seed) and Phase B is one deferred item (approval settings). Much more shippable.

---

## Handoff message for morning

"Item #1 execution halted at schema audit. Prod schema differs from spec in 2 architectural ways + 6 minor. Wrote decision doc at `docs/superpowers/plans/2026-07-12-opname-damage-BLOCKED.md`. Nothing deployed, nothing applied to prod, main untouched. Read the doc, tell me A/B/C, I'll patch spec + plan and resume execution."
