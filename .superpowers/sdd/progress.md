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
