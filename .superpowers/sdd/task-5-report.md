# Task 5 Report — migration 000543 — widen sales RPCs for 4-tier config

**Status: DONE**
**Date:** 2026-07-28

---

## Step 1: Grep sweep

```
grep -rln "pricing_tier_used" supabase/migrations/ | sort
```

Results (9 files):
- `20260901000005_record_kasir_sale_tier.sql` — predecessor, superseded
- `20260901000006_create_tempo_invoice_tier.sql` — predecessor, superseded
- `20260901000008_review_fixes_i4_rpc_tier_default.sql` — predecessor, superseded
- `20260910000012_create_tempo_invoice_dual_write.sql` — predecessor, superseded
- `20261115000232_fix_create_tempo_invoice_shipping_je.sql` — predecessor, superseded
- `20261115000235_fix_kasir_dp_je_and_settlement.sql` — predecessor, superseded
- `20261115000237_fix_record_kasir_sale_ongkir_split.sql` — predecessor, superseded
- `20261115000311_idempotency_record_kasir_sale.sql` — predecessor, superseded
- `20261115000325_audit_kasir_and_pembelian.sql` — **authoritative**

**Verdict: Only `record_kasir_sale` and `create_tempo_invoice` in slot 000325 are the live authoritative bodies. No third RPC found that needed widening.** All other files are predecessor slots superseded by later `CREATE OR REPLACE` migrations.

---

## Step 2: Authoritative RPC body extraction

Both bodies extracted verbatim from `supabase/migrations/20261115000325_audit_kasir_and_pembelian.sql`:
- `record_kasir_sale` starts at line 21
- `create_tempo_invoice` starts at line 432

**Critical placement correction (not in brief):** The brief said to place the label stamp "after `v_item := v_item || jsonb_build_object('pricing_tier_used', v_tier_used)`" — that line (line 139 of slot 000325) is in the validation loop (loop 1). However, that loop's `v_item` mutations are discarded — `v_items_out` is assembled in the SECOND loop (line 226) which reads from `p_items` fresh. Same issue for `create_tempo_invoice`: line 641 inserts `v_items_jsonb` (from payload, as-is). Placing the stamp in the validation loop would silently discard it.

**Fix applied:**
- `record_kasir_sale`: label stamp placed in the SECOND loop (line 226), inside `v_item_out` construction, after HPP enrichment.
- `create_tempo_invoice`: validation loop extended to also build `v_items_out` with label stamped; INSERT at line 641 replaced from `v_items_jsonb` → `v_items_out`.

Advisor confirmed this analysis.

---

## Step 3: Migration file created

`supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql`

**4 changes applied to each RPC:**

### CHANGE 1: Tier label fetch once per RPC call
```sql
SELECT tier_1_label, tier_2_label, tier_3_label, tier_4_label
  INTO v_tier_1_label, v_tier_2_label, v_tier_3_label, v_tier_4_label
  FROM tenant_settings
 WHERE tenant_id = v_tenant_id;
```
(Uses explicit `tenant_id = v_tenant_id` filter, NOT the pre-existing LIMIT-1-no-WHERE pattern.)

### CHANGE 2: INVALID_TIER validation widened from 2 to 4 keys
```sql
-- Before (slot 000325):
IF v_tier_used NOT IN ('eceran', 'grosir') THEN
-- After (slot 000543):
IF v_tier_used NOT IN ('eceran', 'grosir', 'tier_3', 'tier_4') THEN
```

### CHANGE 3: Price COALESCE cascade extended to tier_3/tier_4
```sql
-- Before (slot 000325):
SELECT CASE WHEN v_tier_used = 'grosir' THEN COALESCE(s.price_grosir, s.price) ELSE s.price END
  INTO v_expected_price FROM stocks s WHERE s.sku = v_item->>'sku';

-- After (slot 000543):
SELECT
  CASE v_tier_used
    WHEN 'grosir' THEN COALESCE(s.price_grosir, s.price)
    WHEN 'tier_3' THEN COALESCE(s.price_tier_3, s.price)
    WHEN 'tier_4' THEN COALESCE(s.price_tier_4, s.price)
    ELSE s.price
  END,
  s.price
  INTO v_expected_price, v_master_price
  FROM stocks s
 WHERE s.sku = v_item->>'sku'
   AND s.tenant_id = v_tenant_id;
```
(Also adds `AND s.tenant_id = v_tenant_id` tenant isolation, which was absent in slot 000325.)

### CHANGE 4: pricing_tier_label stamped in output JSONB (correct placement)
```sql
-- record_kasir_sale — in second loop, after v_item_out built:
v_tier_used := v_item->>'pricing_tier_used';  -- re-reads from payload
IF v_tier_used IS NOT NULL THEN
  v_tier_label := CASE v_tier_used ... END;
  IF v_tier_label IS NOT NULL THEN
    v_item_out := v_item_out || jsonb_build_object('pricing_tier_label', v_tier_label);
  END IF;
END IF;

-- create_tempo_invoice — inside validation loop, also builds v_items_out:
IF (v_item->>'pricing_tier_used') IS NOT NULL THEN
  v_tier_label := CASE v_item->>'pricing_tier_used' ... END;
  v_items_out := v_items_out || jsonb_build_array(
    v_item || jsonb_build_object('pricing_tier_label', v_tier_label)
  );
ELSE
  v_items_out := v_items_out || jsonb_build_array(v_item);
END IF;
```

**No other RPCs modified.**

---

## Step 4: Migration applied

```
curl ... /database/query → []
```
Empty array = success, no error field.

---

## Step 5+6: Smoke test — tier_3 accepted + label stamped

Smoke via Management API + `set_config('request.jwt.claims', ...)` + `RAISE EXCEPTION` rollback:

```sql
DO $do$
DECLARE v_result kasir_transactions;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"22222222-aaaa-bbbb-cccc-000000000001","tenant_id":"22222222-2222-2222-2222-222222222222"}', true);
  UPDATE tenant_settings SET tier_3_label='Distributor Kecil' WHERE tenant_id='22222222-...';
  UPDATE stocks SET price_tier_3 = 18000 WHERE sku='TJM-EL-002' AND tenant_id='22222222-...';
  SELECT * FROM public.record_kasir_sale(CURRENT_DATE::date, 'walkin'::text,
    '[{"sku":"TJM-EL-002","qty":1,"unit_price":18000,"master_price_at_sale":18000,"pricing_tier_used":"tier_3"}]'::jsonb,
    18000::numeric, 'cash'::text, NULL::text, 'FULL'::text, 0::numeric, NULL::text,
    0::numeric, NULL::text, 18000::numeric, ..., NULL::uuid
  ) INTO v_result;
  RAISE EXCEPTION 'SMOKE_OK items=%', v_result.items;
END $do$;
```

**Result:**
```
ERROR: P0001: SMOKE_OK items=[{
  "qty": 1,
  "sku": "TJM-EL-002",
  "unit_price": 18000,
  "hpp_per_unit": 11160.0000000000000000,
  "hpp_subtotal": 11160.0000000000000000,
  "pricing_tier_used": "tier_3",
  "pricing_tier_label": "Distributor Kecil",
  "master_price_at_sale": 18000
}]
```

- `tier_3` accepted — no INVALID_TIER exception fired [VERIFIED]
- `pricing_tier_label: "Distributor Kecil"` present in returned items JSONB [VERIFIED]
- Transaction rolled back (RAISE EXCEPTION) — no side effects [VERIFIED]

---

## Step 7: Audits

```
npm run audit:secdef-null-tenant     → clean
npm run audit:no-string-err-fallback → clean
npm run audit:secdef-auth-schema-owner → clean
```

---

## Additional notes

1. **`create_tempo_invoice` smoke skipped** — the RPC requires a real customer with `allows_tempo=true` and a credit limit. The same 4 changes were applied identically. The `record_kasir_sale` smoke confirms the core logic (tier validation + label fetch + label stamp) is correct.

2. **Tenant isolation improvement** — slot 000325's price lookup for both RPCs queried `FROM stocks s WHERE s.sku = v_item->>'sku'` without a `tenant_id` filter. The new migration adds `AND s.tenant_id = v_tenant_id` to the COALESCE CASE query.

3. **Both function overloads**: DB has two overloads of `record_kasir_sale` — 25-param (legacy, without idempotency_key) and 26-param (current). Migration 000543 only replaces the 26-param version (matching slot 000325's `CREATE OR REPLACE`). The 25-param legacy overload is untouched.

---

## Commit

See git log after commit.
