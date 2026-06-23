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

