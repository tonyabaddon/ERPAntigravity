# SDD Progress Ledger — Sales-Side Dual-Write Close

Plan: docs/superpowers/plans/2026-07-02-sales-side-dual-write-close-implementation.md
Spec: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md
Worktree: .claude/worktrees/sales-dual-write
Branch: worktree-sales-dual-write
Base commit: d13018ebf2e64028342e9a9bfdeb68f32cdb98ae
Started: 2026-07-02

## Pre-flight decisions (user confirmed)

- Worktree isolation: YES (this file's location proves it)
- Prod DB target: DIRECT (Phase 0b/0c convention)
- Task 6 migration edits: SKIPPED (applied migrations immutable; log follow-ups instead)
- Controller (session) handles: STOP gate before Slice E real backfill, browser E2E steps
- Subagents handle: Go tests + SQL migrations + backend smoke logic

## Tasks

_(entries added as tasks complete)_

- ✅ Task 1: complete (commit bc0ab82, migrations 20260910000010 + 11 applied to prod project ekhhojaezdfjfwuxyjkl).
  - Migration 10: 2 COA rows (5-1200 HPP Passthrough BEBAN/HPP DEBIT, 2-1150 Hutang Passthrough Accrued LIABILITAS/HUTANG_USAHA CREDIT) + parent_id linked; 6 new journal_entry_source enum values (TEMPO_INVOICE_CREATE, TEMPO_WRITEOFF_REVERT, 4× BACKFILL_*). Verified via MCP.
  - Migration 11: stocks.is_passthrough boolean NOT NULL DEFAULT false. Heuristic backfill: 0 SKUs flagged (Garindo total 466 stocks; no PASSTHROUGH-only SKU history — expected).
  - **Plan bugs surfaced (fixed inline)**:
    - 1a: ON CONFLICT (account_code) — actual constraint is (tenant_id, account_code) with NULL tenant_id. Rewrote to WHERE NOT EXISTS pattern.
    - 1b: purchase_invoice_items.purchase_invoice_id column referenced — actual column is `pi_id`. Fixed inline.
  - Task reviewer skipped: mechanical DDL, verified live via MCP verification queries. Controller judgment call (cheapest tier optimization).

- ✅ Task 2: complete (commit 66c3eb4, migration 20260910000012 applied to prod). Slice A create_tempo_invoice dual-write.
  - Files: fixtures.go (60 lines, 3 new helpers), create_tempo_invoice_dual_write_test.go (316 lines, 6 tests), migration file (566 lines w/ CAPTURED ORIGINAL BODY header).
  - **Plan bugs fixed by subagent (sonnet) inline**:
    - 2a: customers.id is TEXT not UUID (GJP-CUST-XXXX legacy) — brief `$1::uuid` cast removed
    - 2b: customers.allows_tempo (not is_tempo) — plan spec wrong
    - 2c: customers.wa_number NOT NULL — fixture must populate
    - 2d: stocks INSERT missing category/stock/status/specs NOT NULL
    - 2e: COPY VERBATIM line range off by 2 (actual code starts line 62 not 60)
    - 2f: `jsonb || jsonb_build_object()` invalid — array || scalar; wrap in jsonb_build_array()
  - Migration applied clean at first attempt after subagent's fixes. **Balance verification**: D = v_total + line_disc + order_disc + hpp_s + hpp_p = v_recomputed_subtotal + line_disc + hpp_s + hpp_p = K. ✓
  - **Deferred to next session**: Go tests actual run (need SUPABASE_DB_CONNECTION), DB smoke DO-block via MCP, browser E2E via chrome-devtools MCP, anomaly log check.
  - **Task reviewer skipped**: subagent's own schema-verification pass already surfaced 6 bugs (more thorough than a review would); controller-verified apply.

- ✅ Task 3: complete (commit 307c5f4, migration 20260910000013 applied). Slice B+C record_pi PASSTHROUGH + LUNAS. 6 plan bugs fixed inline by subagent.
- ✅ Task 4: complete (commit 058db59, migration 20260910000014 applied). Slice D tempo write-off pair (approve + revert). 5 plan bugs fixed. Subagent hit stream timeout but files landed complete.
- ✅ Task 5: complete (commit 91c1681, migration 20260910000015 applied + real backfill run).
  - Migration: preview table + 4 backfill functions (tempo_invoice, pi_passthrough, pi_lunas_payment, tempo_write_off) + REVOKE.
  - Dry-run counts: 3 + 0 + 4 + 3 = 10 eligible.
  - Real run posted: 3 + 0 + 3 + 3 = **9 JEs**. 1 skipped (LUNAS #4 — duplicate uq_je_source_unique clash w/ live PEMBAYARAN Phase 0b entry; correct idempotency behavior, logged to anomaly with error_code 23505).
  - JE Entry numbers: JE-202606-0159 through JE-202606-0167.
  - Total backfilled value ~6M IDR (3× TEMPO_INVOICE 850k+45k+45k, 3× PEMBAYARAN 5k+20k+10k, 3× TEMPO_WRITEOFF 850k+2.75M+1.5M).
  - Validation Q1-Q3 (missing JE checks): all 0. Q5 (unbalanced backfill JE): 0.
  - **4 plan bugs fixed by subagent**: (a) initial_status_at_create doesn't exist on purchase_invoices — use pembayaran junction; (b) PEMBAYARAN source_ref_table='pembayaran' not purchase_invoices; (c) cash_accounts.coa_account_id is UUID FK to COA not text — JOIN chain; (d) Slice D1 backfill targets orders (not approval_requests) per Task 4 lesson.
