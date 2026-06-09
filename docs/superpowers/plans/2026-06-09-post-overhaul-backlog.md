# Post-Sales-Recording-Overhaul Backlog Plan

**Goal:** Take the residual work after the Sales Recording Overhaul review (closed Critical 2/2 + Important 5/6 + Minor 5/5 on 2026-06-09) and finish it in 4 disciplined phases.

**Status as of 2026-06-09:** Plan agreed by user. Phase 1 next.

**Architecture:** Each phase is independent — start any of them when ready. Phase 1 should land before Phases 2-3 to avoid working-tree noise interfering with future PRs. Phase 4 is a survey, not implementation.

**Tech stack:** Same as the rest of the repo (Vite + React + TS + Supabase + backend-go).

---

## Phase 1 — Working Tree Triage

**Effort:** 30-45 minutes. **Urgency:** high (foundation).

**Why first:** Six modified files + seven untracked folders in the working tree raise merge-conflict and accidental-include risk for every future commit. Triage each before doing more work.

**Working tree leftovers as of 2026-06-09 (after deploy of `1507cd5`):**

Modified (need decision per file):
- `.gitignore`
- `backend-go/daemon.pid` (very likely should be `.gitignore`-d)
- `backend-go/internal/db/pengawasan_test.go`
- `backend-go/internal/db/testhelpers.go`
- `cloudbuild.frontend.yaml`
- `src/components/pembelian/MarkAsPaidModal.tsx`

Untracked folders (likely scratch / personal):
- `.claire/`, `.claude/worktrees/`, `supabase/.temp/`
- `docs/haloai-demo/`, `docs/mekari-demo/`

Untracked files to ASSESS + commit if they're real work:
- `docs/superpowers/plans/2026-06-04-payment-proof-fix.md`
- `docs/superpowers/plans/2026-06-05-wib-timezone-fix.md`
- `docs/superpowers/plans/2026-06-08-unified-sales-channel.md`
- `docs/superpowers/plans/2026-06-08-walkin-stock-decrement.md`
- `docs/superpowers/specs/2026-06-08-unified-sales-channel-design.md`
- `supabase/migrations/20260607000053_transfer_aging_view.sql` (Phase 4 Pengawasan Task 4 — plan landed but migration code did not)

### Steps

- [ ] For each modified file, run `git diff <file>` and decide: commit-as-intentional, revert-as-experiment, or split-into-PR. Document the call in the commit message.
- [ ] For each untracked folder, check if it's already covered by `.gitignore`. If not, add to `.gitignore` (do not commit content unless it's real artifact).
- [ ] For each untracked plan/spec file, commit it under a `docs(plans): track`-style commit if it's real planning material.
- [ ] For `20260607000053_transfer_aging_view.sql`, look up Phase 4 Task 4 plan; commit and apply if matches the plan, otherwise discard.
- [ ] Verify `git status --short` returns a small, intentional set (or empty).

**Deliverable:** Clean working tree. Every leftover has a decision recorded in git history.

---

## Phase 2 — WIB Timezone Fix

**Effort:** 1-2 days. **Urgency:** high (real user-facing bug).

**Why second:** Every kasir sale recorded after 17:00 WIB lands on H+1 in the books because `new Date().toISOString().slice(0,10)` returns UTC date. Already flagged in code review and `docs/superpowers/plans/2026-06-05-wib-timezone-fix.md`.

### Steps

- [ ] Read the existing plan `2026-06-05-wib-timezone-fix.md` and verify it still matches the codebase (some sites may have changed since).
- [ ] Audit every `toISOString().slice(0, 10)` call site in `src/`. Use `grep -rn "toISOString().slice(0, 10)" src/`.
- [ ] Add `wibDateString(date?: Date): string` to `src/lib/format.ts` (return `date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })` — pattern already used at `supabaseClient.ts:wibDateString`).
- [ ] Replace each call site with the helper.
- [ ] Spot-check time-zone-sensitive aggregates: kasir daily summary, monthly reconciliation queries, dashboard period filters.
- [ ] Manual verify by setting system clock past 17:00 local (or use `process.env.TZ` override in a test) and running through PenjualanBaruScreen save.

**Deliverable:** No `toISOString().slice(0, 10)` calls remain in app code. Sales recorded between 17:00-23:59 WIB land on the same calendar day.

---

## Phase 3 — Sales Overhaul Polish

**Effort:** 3-4 hours. **Urgency:** medium (no user-facing bug, but tech debt cleanup).

**Why third:** Closes the loop on items deferred or noticed during the 2026-06-09 review without affecting user behavior.

### Sub-tasks (each can ship as its own commit, or batch as one)

- [ ] **Sunset SaleModal** (reviewer Important #3). KasirScreen.tsx kartu Walk-in/Tokopedia/Grosir (lines ~438-456) currently call `setShowSaleModal(ch)`. Route them to `onOpenPenjualanBaru?.(channel)` instead, then delete the `SaleModal` function (KasirScreen.tsx:586-1000-ish) and its modal mount. PenjualanBaruScreen already accepts `initialChannel` prop. Drop `setShowSaleModal` state. Drop the `<SaleModal>` JSX block at the bottom of KasirScreen.
- [ ] **Frontend integration test** (reviewer recommendation). Vitest test mocking `kasirService.recordSale`. Assert: happy path calls RPC once with the right shape, error from RPC surfaces a toast and doesn't navigate to invoice. Mount PenjualanBaruScreen with a fake supabase client.
- [ ] **`formatRp` consolidation outside `penjualan/*`** (extends Minor #10). Three duplicates remain: `src/components/KasirScreen.tsx:50`, `src/components/stok/StockOpnameScreen.tsx:47`, `src/components/stok/StockOpnameSessionView.tsx:47`. Replace each with `import { formatRp } from '../../lib/format'` (or `'../lib/format'` for KasirScreen).
- [ ] **`payment_subtype` validation in `record_kasir_sale` RPC** (advisor note). Add `IF p_payment_subtype IS NOT NULL AND p_payment_subtype NOT IN ('debit','qris') THEN RAISE EXCEPTION ...` before the insert. Ship as migration `20260609000003`.
- [ ] **`dp_input_type` schema alignment** (advisor note). `orders.chk_dp_input_type` accepts `AMOUNT|PERCENTAGE`; `kasir_transactions.chk_kasir_dp_input_type` accepts `AMOUNT|PERCENT`. Pick ONE: recommend `PERCENT` since `kasir_transactions` is the source of truth for revenue + already used by PenjualanBaruScreen. Migration: ALTER orders constraint to `AMOUNT|PERCENT`, backfill any `PERCENTAGE` rows to `PERCENT`. Ship as migration `20260609000004`.

**Deliverable:** `git grep "function formatRp"` returns ≤1 hit. `SaleModal` deleted. Vitest happy + error paths green. Two new migrations applied. Schema aligned.

---

## Phase 4 — Audit Remaining Plans

**Effort:** 0.5-1 day (survey only). **Urgency:** low (informational).

**Why last:** Several plans in `docs/superpowers/plans/` may already be partially or fully implemented. Survey before adding work to the backlog.

### Plans to audit

- [ ] `2026-06-04-payment-proof-fix.md` — what bug? landed?
- [ ] `2026-06-06-message-debouncing-plan.md` — WA bot debouncing; check whatsmeow / messages.go
- [ ] `2026-06-07-monthly-reconciliation.md` — `rekonsiliasi` already in sidebar; what's pending?
- [ ] `2026-06-08-unified-sales-channel.md` — Phase A + reviewer-observed commits (f68fff3 OrderHistory union, 519fb0e Pipeline walkin) deliver A+B+C of the spec. Verify the spec's "Out of scope" really is out of scope and not pending.
- [ ] `2026-06-08-walkin-stock-decrement.md` — likely covered by `mark_walkin_order_paid` + `record_kasir_sale`. Verify against the plan's checklist.
- [ ] `2026-06-08-po-create-page.md` — out of kasir scope; status?
- [ ] `2026-06-08-rakit-workflow.md` — out of kasir scope; status?

**Deliverable:** For each plan, append a status line ("DONE", "PARTIAL — X pending", "PENDING") to `progress.md` so the backlog state is visible at a glance.

---

## Execution order

```
Phase 1 (cleanup)       → 30-45 minutes    → blocks nothing, do first
Phase 2 (WIB timezone)  → 1-2 days         → real bug, needs focus session
Phase 3 (polish)        → 3-4 hours        → can pipeline alongside or after Phase 2
Phase 4 (audit plans)   → 0.5-1 day        → survey; can be delegated to a subagent
```

**Tech stack reminder:**
- Frontend: Vite + React + TypeScript + Tailwind
- Backend: Go (`backend-go/`) + Supabase (PostgreSQL)
- Tests: Go test for DB + Vitest for frontend (already configured per `package.json`)
- Deploy: Cloud Build auto-triggered on push to `main` (frontend service: `garindo-jaya-panel-msme-erp-frontend`)
- Migrations: applied via `psql` with `SUPABASE_DB_CONNECTION` from `backend-go/.env` (same DSN as prod — apply with care)
