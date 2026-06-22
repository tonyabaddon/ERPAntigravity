### Task 2 Report — record_kasir_sale dual-write + p_cash_account_id

**Status:** DONE  
**Date:** 2026-06-23  
**Branch:** worktree-akuntansi-phase0b ✓

---

## Current RPC Signature (before migration)

21 params — confirmed via `pg_get_function_arguments`:
```
p_date date, p_channel text, p_items jsonb, p_subtotal numeric,
p_payment_method text, p_payment_subtype text, p_payment_type text,
p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric,
p_notes text, p_total_amount numeric, p_customer_name text,
p_customer_phone text, p_customer_company text, p_delivery_address text,
p_marketplace_order_no text, p_wa_phone text, p_wa_chat_url text,
p_customer_id text, p_allow_negative_stock boolean DEFAULT false
```

## Channel Value Distribution (production)

Only `walkin` and `null` in current data. Full kasir_channel enum is lowercase:
walkin, tokopedia, shopee, lazada, blibli, bukalapak, ralali, bhinneka, grosir, sales, expo, whatsapp, instagram, website.

Note: task brief used uppercase WALK_IN/MARKETPLACE_* — corrected to actual enum values in implementation.

## Key Pre-migration Discoveries

- `_post_journal_entry` lines JSONB key is `account_code` (text), NOT `account_id` (UUID) — task brief snippet was wrong
- All 4 COA codes (4-1110, 4-1120, 4-1130, 4-1140) exist and are active in production
- `accounting_config.default_kas_account_id` → COA `1-1110` (Kas Toko)
- `accounting_config.default_bank_account_id` = NULL in production (relevant for Test B)
- No TEMPO channel in kasir_channel enum; grosir→4-1130, rest default to 4-1110

## Migration Applied

**File:** `supabase/migrations/20260723000002_phase0b_record_kasir_sale_dual_write.sql`

Changes:
1. Created helper `_resolve_kasir_pendapatan_coa(p_channel text) RETURNS text` — IMMUTABLE SQL function mapping channel→COA code
2. DROPped 21-param `record_kasir_sale` (Postgres requires drop+recreate when adding params)
3. Created 22-param `record_kasir_sale` with `p_cash_account_id uuid DEFAULT NULL` appended
4. GL dual-write block (soft-fail EXCEPTION handler) added after INSERT to kasir_transactions
5. Anomaly logged to `gl_dual_write_anomalies` when: no cash account resolved OR any GL error
6. GRANT EXECUTE on both functions to anon, authenticated

**Channel→Pendapatan COA mapping:**
- walkin → 4-1110
- tokopedia, shopee, lazada, blibli, bukalapak, ralali, bhinneka → 4-1120
- grosir → 4-1130
- sales, expo, whatsapp, instagram, website → 4-1110 (default)

## Post-migration Signature (confirmed)

22 params:
```
..., p_allow_negative_stock boolean DEFAULT false, p_cash_account_id uuid DEFAULT NULL::uuid
```

Single overload confirmed — no ambiguity risk.

## Smoke Test Results — 4/4 PASS

All tests run via DO blocks with `RAISE EXCEPTION 'rollback'` — zero DB side effects.

| Test | Scenario | je_delta | anomaly_delta | Result |
|------|----------|----------|---------------|--------|
| A | flag=true, payment=cash, NULL cash_account_id → default kas (1-1110) | +1 | 0 | PASS |
| B | flag=true, payment=transfer, no default_bank, no picker → anomaly, tx succeeds | 0 | +1 | PASS |
| C | flag=false → GL bypass entirely | 0 | 0 | PASS |
| D | flag=true, channel=shopee, explicit cash_account_id picker, marketplace_order_no | +1 | 0 | PASS |

Test D additionally verified:
- Credit COA = `4-1120` (correct for shopee/marketplace channel)
- JE description = `Penjualan shopee · MP-999` (includes marketplace order no)

## Commit Hash

See git log — commit `feat(akuntansi): Phase 0b Task 2 — record_kasir_sale dual-write + p_cash_account_id`
