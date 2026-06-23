# Akuntansi Phase 0c Implementation Plan — HPP fix + record_pi dual-write + Historical backfill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Close 2 critical GL gaps + populate historical data so Laporan show real numbers.

**Architecture:**
1. Extend `record_kasir_sale` dual-write block to also post HPP lines (4-line JE: D cash, D HPP, K pendapatan, K persediaan)
2. Add dual-write to `record_pi` (Tagihan creation): D Persediaan K Hutang Usaha
3. Backfill historical kasir_transactions (71) + purchase_invoices (39) + pembayaran (8) since Juni 2025 with source_type='BACKFILL'

**Tech Stack:** PostgreSQL 15, soft-fail pattern (proven in Phase 0b), TypeScript strict.

## Global Constraints

- Soft-fail pattern: GL post wrapped in BEGIN/EXCEPTION; business RPC never rolls back
- Feature flag `enable_dual_write_to_gl` controls runtime; backfill ignores flag (always posts)
- Migration slot `20260724*`
- All COA codes from existing seed (verify exists): 5-1100 HPP, 1-1510 Persediaan, 2-1100 Hutang Usaha
- HPP amount = `v_hpp_total` already computed in `record_kasir_sale` via deduct_stock_fifo (stored in kasir_transactions.hpp_total)
- Backfill idempotent: skip rows that already have GL entry (use source_ref_table + source_ref_id check)
- All Indonesian-friendly error messages
- Worktree branch: `worktree-akuntansi-phase0c`

## File Structure

**Backend (3 migrations):**
- `supabase/migrations/20260724000001_phase0c_kasir_hpp_extension.sql` — extend record_kasir_sale to 4-line JE (add HPP+Persediaan)
- `supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql` — record_pi GL post
- `supabase/migrations/20260724000003_phase0c_historical_backfill.sql` — one-shot backfill function + execute

**Tests:**
- `tests/integration/akuntansi-phase0c/_setup.ts`
- `tests/integration/akuntansi-phase0c/kasir-hpp.test.ts`
- `tests/integration/akuntansi-phase0c/record-pi.test.ts`
- `tests/integration/akuntansi-phase0c/backfill.test.ts`

**Docs:** progress.md

---

## Task Breakdown

### Task 1: Migration — HPP extension to record_kasir_sale

**Verify COA codes exist via MCP first:**
- `SELECT account_code, account_name FROM chart_of_accounts WHERE account_code IN ('5-1100', '1-1510')`
- HPP and Persediaan must both be active

**Strategy:** CREATE OR REPLACE FUNCTION record_kasir_sale (same signature as Phase 0b — 22 params + p_cash_account_id). Modify the dual-write block to build 4 lines instead of 2 when v_hpp_total > 0:

```sql
-- After existing line resolution (v_cash_coa, v_pendapatan_coa)
-- Add HPP lines conditionally
v_hpp_coa_id := (SELECT id FROM chart_of_accounts WHERE account_code='5-1100');
v_persediaan_coa_id := (SELECT id FROM chart_of_accounts WHERE account_code='1-1510');

-- Build lines: always 2 (cash + pendapatan); add 2 more if HPP > 0
v_lines := jsonb_build_array(
  jsonb_build_object('account_code', v_cash_coa, 'side', 'DEBIT', 'amount', p_total_amount, 'description', 'Kas masuk ' || p_payment_method),
  jsonb_build_object('account_code', v_pendapatan_coa, 'side', 'CREDIT', 'amount', p_total_amount, 'description', 'Pendapatan ' || p_channel)
);
IF v_kasir.hpp_total IS NOT NULL AND v_kasir.hpp_total > 0 THEN
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_code', '5-1100', 'side', 'DEBIT', 'amount', v_kasir.hpp_total, 'description', 'HPP ' || p_channel),
    jsonb_build_object('account_code', '1-1510', 'side', 'CREDIT', 'amount', v_kasir.hpp_total, 'description', 'Pemakaian persediaan')
  );
END IF;
-- Call _post_journal_entry with v_lines
```

Note: JE is no longer balanced 2-by-2 — it's now 4 lines but D total = K total because (cash + HPP) = (pendapatan + persediaan) only if pendapatan ≥ HPP, which is normal. Need to verify `_post_journal_entry` validator checks SUM(D)=SUM(K), not pairwise — that's standard double-entry.

**Smoke tests:**
1. Sale with HPP > 0 → 4-line JE balanced
2. Sale with HPP = 0 (service-only) → 2-line JE balanced (back-compat)
3. Sale with flag OFF → no JE

- [ ] **Step 1**: Verify COA codes 5-1100 + 1-1510 exist
- [ ] **Step 2**: Read current `record_kasir_sale` body via `pg_get_functiondef`
- [ ] **Step 3**: Write migration with full CREATE OR REPLACE
- [ ] **Step 4**: Apply via MCP `apply_migration`
- [ ] **Step 5**: Smoke test 3 cases (use real auth.uid `227c28f4-09f6-4dc9-af7a-01b0feb2c194` from Phase 0b smoke + tonywei admin)
- [ ] **Step 6**: Commit `feat(akuntansi): Phase 0c Task 1 — kasir_sale HPP extension`

---

### Task 2: Migration — record_pi dual-write

**Strategy:** CREATE OR REPLACE FUNCTION record_pi (read existing migration first, likely `20260614000011` or similar). Add dual-write block at end before RETURN:

```sql
-- After existing INSERTs to purchase_invoices + purchase_invoice_items
-- Capture v_pi.id

IF v_dual_write THEN
  BEGIN
    -- D 1-1510 Persediaan (total invoice)
    -- K 2-1100 Hutang Usaha (total invoice)
    -- For PKP: split into Persediaan + PPN Masukan — defer until accounting_config.ppn_mode='PKP'
    
    v_je_result := _post_journal_entry(
      v_pi.invoice_date,
      'PI_TAGIHAN'::journal_entry_source,
      'Tagihan ' || v_pi.pi_number || ' · ' || v_supplier.name,
      jsonb_build_array(
        jsonb_build_object('account_code', '1-1510', 'side', 'DEBIT', 'amount', v_pi.total, 'description', 'Persediaan masuk'),
        jsonb_build_object('account_code', '2-1100', 'side', 'CREDIT', 'amount', v_pi.total, 'description', 'Hutang ke ' || v_supplier.name)
      ),
      'purchase_invoices', v_pi.id, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO gl_dual_write_anomalies (...);
    RAISE WARNING ...;
  END;
END IF;
```

Note: `journal_entry_source` enum already includes `'PI_TAGIHAN'` per Phase 0a check.

**Smoke tests:**
1. Happy path: create PI → verify JE D Persediaan K Hutang Usaha
2. Flag OFF: no JE
3. Closed period: anomaly logged

- [ ] **Step 1**: Read existing `record_pi` body
- [ ] **Step 2**: Verify supplier table column name for supplier_name access
- [ ] **Step 3**: Write migration
- [ ] **Step 4**: Apply + smoke test
- [ ] **Step 5**: Commit

---

### Task 3: Historical backfill function + execute

**Strategy:** One-shot DO block-style function that:
1. Loops `kasir_transactions` WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE source_ref_table='kasir_transactions' AND source_ref_id=kt.id)
2. For each: resolve cash_coa from payment_method, post JE with source_type='BACKFILL' (or 'KASIR_SALE' — debatable; 'BACKFILL' makes audit easier)
3. Same for purchase_invoices (D Persediaan K Hutang Usaha)
4. Same for pembayaran (D Hutang Usaha K Bank using account_id if set, else default)
5. Log count of posted vs skipped (already had JE) vs error

Migration file `20260724000003_phase0c_historical_backfill.sql`:
- DROP FUNCTION IF EXISTS public._phase0c_backfill_historical() CASCADE;
- CREATE FUNCTION public._phase0c_backfill_historical() RETURNS jsonb — returns {kasir_posted, pi_posted, pembayaran_posted, skipped, errors}
- AT END OF MIGRATION: `SELECT public._phase0c_backfill_historical();` — auto-executes during migration apply

Decision: source_type for backfill rows:
- Use existing enum 'BACKFILL' (per Phase 0a enum check)
- Description prefix "Backfill: <original>" for clear audit trail
- source_ref_table + source_ref_id link to original row (preserved for reverse lookup)

**Smoke verification post-apply:**
```sql
SELECT count(*) FROM journal_entries WHERE source_type='BACKFILL' AND created_at > now() - interval '5 minutes';
-- Should show ~71 + 39 + 8 = ~118 rows
```

Plus: check Trial Balance after backfill — should be balanced.

- [ ] **Step 1**: Write backfill function
- [ ] **Step 2**: Apply (auto-executes)
- [ ] **Step 3**: Verify count + Trial Balance balanced
- [ ] **Step 4**: Commit `feat(akuntansi): Phase 0c Task 3 — historical backfill 118 rows`

---

### Task 4: Integration tests (Pattern C)

**Files:**
- `tests/integration/akuntansi-phase0c/_setup.ts`
- `tests/integration/akuntansi-phase0c/kasir-hpp.test.ts` — verify record_kasir_sale RPC sig + HPP fields presence
- `tests/integration/akuntansi-phase0c/record-pi.test.ts` — verify record_pi sig + GL columns
- `tests/integration/akuntansi-phase0c/backfill.test.ts` — verify backfill function exists + journal_entries has BACKFILL source_type rows

Target: ~12-15 Pattern C tests.

- [ ] **Step 1**: Write _setup + 3 test files
- [ ] **Step 2**: Run vitest pass
- [ ] **Step 3**: Commit

---

### Task 5: Final validation + progress.md + deploy + promote

- [ ] **Step 1**: `npm test --run` → all PASS (383+ tests)
- [ ] **Step 2**: `npx tsc --noEmit` clean
- [ ] **Step 3**: `npm run build` OK
- [ ] **Step 4**: progress.md entry
- [ ] **Step 5**: Commit + merge to main + push
- [ ] **Step 6**: Wait for Cloud Build SUCCESS → promote latest revision to 100% traffic
- [ ] **Step 7**: Smoke test in production via MCP — verify HPP + record_pi work + check Trial Balance after backfill

---

## Verification matrix

| Layer | Method | Pass criterion |
|---|---|---|
| HPP RPC patch | MCP execute_sql DO block | 4-line JE balanced |
| record_pi dual-write | MCP execute_sql | JE created on PI insert |
| Backfill | MCP count + Trial Balance | ~118 BACKFILL rows + TB balanced |
| Integration tests | vitest | All PASS |
| Build | npm run build | OK |
| Production | MCP smoke after promote | HPP + PI flows post correctly |

## Pre-flight notes

- Worktree: `.claude/worktrees/akuntansi-phase0c` on branch `worktree-akuntansi-phase0c`
- Migration slot `20260724*`
- Auth UID for MCP smoke: `227c28f4-09f6-4dc9-af7a-01b0feb2c194` (tonywei, matches admin_users.id ↔ auth.users.id)
- Anomaly verification: cek `gl_dual_write_anomalies` table after each test
- All subagent dispatches MUST verify `git branch --show-current` = `worktree-akuntansi-phase0c` BEFORE git add (per Phase 0b precedent)
