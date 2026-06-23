# SDD Progress Ledger — Akuntansi Phase 0c

Plan: docs/superpowers/plans/2026-06-23-akuntansi-phase0c-hpp-pi-backfill.md
Branch: worktree-akuntansi-phase0c
Started: 2026-06-23

## Task 1 — DONE (2026-06-23)

**HPP extension to record_kasir_sale dual-write block.**

Migration: `supabase/migrations/20260724000001_phase0c_kasir_hpp_extension.sql`

Change: added `v_lines jsonb` to inner DECLARE; conditionally appends D 5-1100 / K 1-1510 lines when `v_kasir.hpp_total > 0`. Base 2-line JE unchanged when hpp=0 (back-compat).

Smoke tests: 3/3 PASS (rollback-via-RAISE pattern, zero data leakage):
- Test A: 4-line JE, balanced, hpp>0 ✓
- Test B: 2-line JE when hpp=0 ✓
- Test C: 0 JEs when flag=false ✓

Task 1: complete (commits 0e65277..0e9f6f2, 3/3 smoke PASS, HPP critical fix deployed)

## Task 2 — DONE (2026-06-23)

**record_pi dual-write: D 1-1510 Persediaan / K 2-1100 Hutang Usaha.**

Migration: `supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql`

Changes: CREATE OR REPLACE record_pi (from 20260630000006 base) with two additions:
1. `v_purchase_date` captured before INSERT for correct JE date on backdated PIs
2. Soft-fail GL dual-write block before RETURN — fetches supplier name independently
   (BELUM_LUNAS path skips outer v_supplier_name), posts D 1-1510 / K 2-1100

Documented TODOs for Phase 1: PASSTHROUGH debit account branching; LUNAS payment-leg JE gap.

Smoke tests: 3/3 PASS (real writes, cleaned up after):
- Test A: JE-202607-0002, D 1-1510 / K 2-1100, 500,000 balanced, 0 anomalies ✓
- Test B: flag=OFF → 0 JEs ✓
- Test C: closed period (strict mode) → anomaly logged (period_closed), PI returned ✓

Task 2: complete (3/3 smoke PASS)
Task 2: complete (commits 0e9f6f2..8c41d99, 3/3 smoke PASS, record_pi dual-write deployed)

## Task 3 — DONE (2026-06-23)

**Historical backfill function + auto-execute.**

Migration: `supabase/migrations/20260724000003_phase0c_historical_backfill.sql`

Function `public._phase0c_backfill_historical()` loops 3 source tables with NOT EXISTS
idempotency guard, posts BACKFILL JEs, logs anomalies to gl_dual_write_anomalies (soft-fail).

**Actual results (applied 2026-06-23):**
- kasir_transactions (income): 69 posted, 2 anomalies (qris/edc — no default_bank configured)
- purchase_invoices: 5 posted, 31 anomalies (subtotal=0 test PIs — validator rejects zero-amount JEs)
- pembayaran: 4 posted (COALESCE→default_kas), 0 anomalies
- Total posted: 78 JEs; total anomalies: 33

**Smoke verification:**
- backfill_jes: 91 (78 new + 13 pre-existing test data)
- Trial Balance imbalance: 0.00 — BALANCED ✓
- total_jes: 93

Task 3: complete (TB balanced, 78 JEs posted, 33 anomalies logged for review)
