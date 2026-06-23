### Task 2 Report — record_pi GL dual-write (Phase 0c)

**Status:** DONE
**Date:** 2026-06-23
**Branch:** worktree-akuntansi-phase0c ✓

---

## Migration Applied

**File:** `supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql`
**Applied:** Yes (Supabase MCP apply_migration, project ekhhojaezdfjfwuxyjkl)
**Base migration:** `20260630000006_record_pi_restore_pr36_plus_preorder.sql`

**GL shape (single JE per Tagihan):**
- D 1-1510 Persediaan Barang Jadi (v_subtotal)
- K 2-1100 Hutang Usaha (v_subtotal)

## Key Design Decisions

1. `v_purchase_date` captured before INSERT — backdated PIs use correct JE date, not `CURRENT_DATE`
2. `v_gl_supplier` fetched independently inside dual-write block — BELUM_LUNAS path never populates outer `v_supplier_name`; independent fetch guarantees correct description for all PI statuses
3. `PERFORM` style (not `v_je_result :=`) — consistent with Phase 0b house style
4. TODO Phase 1: PASSTHROUGH type semantically incorrect to debit 1-1510 (no stock movement) — deferred to Phase 1 branching
5. NOTE: LUNAS-at-create synthesizes pembayaran directly (skips record_pembayaran) so payment-leg JE is missing — documented, deferred to Phase 1 full-accrual

## Smoke Test Results — 3/3 PASS

| Test | Description | je_count | anomaly_count | Result |
|------|-------------|----------|---------------|--------|
| A | flag=ON, STOCK BELUM_LUNAS → JE created D 1-1510 K 2-1100, amount=500,000 | 1 | 0 | PASS |
| B | flag=OFF → no JE created | 0 | 0 | PASS |
| C | flag=ON, period CLOSED (strict mode) → PI returned, GL blocked | 0 | 1 | PASS |

**Test A detail:** JE entry_number=JE-202607-0002, description="Tagihan PI-2026-06-007 · QA-POREC-1781343224567-supplier". D 1-1510 Persediaan Barang Jadi 500,000 / K 2-1100 Hutang Usaha 500,000. Balanced.

**Test C anomaly:** `P0001: period_closed: cannot post entry to closed period for date 2026-07-20`. PI-2026-06-010 returned successfully (soft-fail confirmed).

**State cleanup:** All test PI rows, JEs, stock_lots, anomalies deleted. pesanan_items qty_received_total restored to pre-test values. accounting_config.enable_strict_period_close=false, accounting_periods July 2026 restored to OPEN.

## Commit Hash

See git log — commit `feat(akuntansi): Phase 0c Task 2 — record_pi dual-write (D Persediaan K Hutang Usaha)`
