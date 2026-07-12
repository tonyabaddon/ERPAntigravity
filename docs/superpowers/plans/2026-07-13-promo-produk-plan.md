# Promo Produk (Item #4b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship auto-applied per-SKU promo feature as Layer 1 discount, paired with existing Item #4 (Diskon Nota) as Layer 2 safety net.

**Architecture:** Extend `stocks` table with promo columns + audit snapshot on `kasir_transaction_items`. Backend has 4 new RPCs + `record_kasir_sale` behavior extension (no signature change). Frontend adds `Pengaturan → Diskon` parent grouping with 2 config surfaces plus Kasir wizard auto-apply and Dashboard maintenance card.

**Tech Stack:** Supabase PostgreSQL, TypeScript, React, Vite, existing project patterns (SECDEF RPCs, RLS, `vosi_rpc_owner`).

**Spec:** [docs/superpowers/specs/2026-07-13-promo-produk-design.md](../specs/2026-07-13-promo-produk-design.md)

## Global Constraints

- All migrations idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, CHECK via `DO $$ IF NOT EXISTS $$`)
- All SECDEF RPCs owned by `vosi_rpc_owner`, REVOKE from PUBLIC, GRANT EXECUTE to `authenticated`
- All CHECK constraints use `NOT VALID` + separate `VALIDATE CONSTRAINT` on large-table pattern (safe for tenant nanti 10M+ rows)
- Rupiah format via existing `formatIDR()` helper
- Font 13-14px UI body (per feedback `font_sizing`)
- Copy Bahasa Indonesia MSME tone, use terms "Promo Produk" (Layer 1) and "Diskon Nota" (Layer 2) consistently
- Design system palette: badge emerald (aktif) / amber (⚠ expiring) / slate (kadaluwarsa)
- Migration slots strictly 20261115000120 → 125 (per memory `migration_slot_allocation`)
- New feature ships with entry log + error log + usage counter (CLAUDE.md observability requirement)
- Zero signature change to `record_kasir_sale`, `check_kasir_discount_gate`, `link_kasir_sale_to_approval`

---

### Task 1: Schema migrations — stocks promo columns + kasir_transaction_items snapshot

**Files:**
- Create: `supabase/migrations/20261115000120_stocks_promo_schema.sql`
- Create: `supabase/migrations/20261115000121_kasir_items_promo_snapshot.sql`

**Interfaces:**
- Consumes: existing `public.stocks`, `public.kasir_transaction_items` tables
- Produces: 5 new columns on `stocks` (promo_discount_type, promo_discount_value, promo_expires_at, promo_updated_at, promo_updated_by), 2 CHECK constraints, 1 partial index (idx_stocks_active_promo), 1 JSONB column on kasir_transaction_items (promo_snapshot)

- [ ] **Step 1: Write migration 120 — stocks schema**

```sql
-- 20261115000120_stocks_promo_schema.sql
-- Item #4b: Promo Produk — schema for per-SKU promo (Layer 1 discount).
-- See docs/superpowers/specs/2026-07-13-promo-produk-design.md §4.

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS promo_discount_type   TEXT,
  ADD COLUMN IF NOT EXISTS promo_discount_value  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS promo_expires_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_by      UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_type_check') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_type_check
      CHECK (promo_discount_type IS NULL OR promo_discount_type IN ('PERCENT','AMOUNT'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_value_positive') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_value_positive
      CHECK (promo_discount_value IS NULL OR promo_discount_value > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_type_value_consistency') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_type_value_consistency CHECK (
        (promo_discount_type IS NULL AND promo_discount_value IS NULL)
        OR (promo_discount_type IS NOT NULL AND promo_discount_value IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_percent_range') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_percent_range CHECK (
        promo_discount_type <> 'PERCENT'
        OR (promo_discount_value >= 0.01 AND promo_discount_value <= 100)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stocks_active_promo
  ON public.stocks (tenant_id, promo_expires_at)
  WHERE promo_discount_type IS NOT NULL;

COMMENT ON COLUMN public.stocks.promo_discount_type IS
  'Item #4b Promo Produk: PERCENT or AMOUNT (Rp per unit). NULL = no active promo.';
COMMENT ON COLUMN public.stocks.promo_discount_value IS
  'Item #4b Promo Produk: value in units of promo_discount_type. PERCENT: 0.01-100. AMOUNT: > 0 and <= stocks.price (enforced at RPC).';
COMMENT ON COLUMN public.stocks.promo_expires_at IS
  'Item #4b Promo Produk: NULL = permanent. Non-NULL = cut-off; after now() > expires_at, promo treated as inactive.';
```

- [ ] **Step 2: Write migration 121 — kasir_transaction_items snapshot**

```sql
-- 20261115000121_kasir_items_promo_snapshot.sql
-- Item #4b: audit snapshot of Promo Produk config at time of sale.

ALTER TABLE public.kasir_transaction_items
  ADD COLUMN IF NOT EXISTS promo_snapshot JSONB NULL;

COMMENT ON COLUMN public.kasir_transaction_items.promo_snapshot IS
  'Item #4b: JSONB snapshot of Promo Produk applied at time of sale. Immutable audit. NULL = no promo. Shape: {"type":"PERCENT"|"AMOUNT","value":NUMERIC,"expires_at":"...","applied_at":"..."}';
```

- [ ] **Step 3: Apply migrations via mcp__plugin_supabase_supabase__apply_migration**

Project ID: `ekhhojaezdfjfwuxyjkl`
Apply both migrations sequentially.

- [ ] **Step 4: Verify column existence + constraint list**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='stocks'
  AND column_name LIKE 'promo_%'
ORDER BY column_name;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='kasir_transaction_items'
  AND column_name = 'promo_snapshot';

SELECT conname FROM pg_constraint
WHERE conrelid='public.stocks'::regclass
  AND conname LIKE 'stocks_promo_%';
```

- [ ] **Step 5: Run mcp__plugin_supabase_supabase__get_advisors**

Verify no new critical findings.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000120_stocks_promo_schema.sql \
        supabase/migrations/20261115000121_kasir_items_promo_snapshot.sql
git commit -m "feat(item-4b): schema for Promo Produk (stocks + kasir_items snapshot)"
```

---

### Task 2: RPC `upsert_stock_promo` (slot 122)

**Files:**
- Create: `supabase/migrations/20261115000122_upsert_stock_promo_rpc.sql`

**Interfaces:**
- Consumes: `public.stocks`, `public._resolve_tenant_id()`, `public._current_user_id()`
- Produces: SECDEF function `upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)` returning VOID

- [ ] **Step 1: Write RPC migration**

```sql
-- 20261115000122_upsert_stock_promo_rpc.sql
CREATE OR REPLACE FUNCTION public.upsert_stock_promo(
  p_sku                  TEXT,
  p_promo_discount_type  TEXT,
  p_promo_discount_value NUMERIC,
  p_promo_expires_at     TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_user_id  UUID;
  v_price    NUMERIC;
  v_sku_exists BOOLEAN;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- SKU exists check
  SELECT price INTO v_price
  FROM public.stocks
  WHERE sku = p_sku AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % tidak ditemukan di tenant', p_sku USING ERRCODE = '22023';
  END IF;

  -- Both NULL = clear promo
  IF p_promo_discount_type IS NULL AND p_promo_discount_value IS NULL THEN
    UPDATE public.stocks
    SET promo_discount_type = NULL,
        promo_discount_value = NULL,
        promo_expires_at = NULL,
        promo_updated_at = now(),
        promo_updated_by = v_user_id
    WHERE sku = p_sku AND tenant_id = v_tenant;
    RETURN;
  END IF;

  -- Consistency: both must be non-NULL if either is
  IF p_promo_discount_type IS NULL OR p_promo_discount_value IS NULL THEN
    RAISE EXCEPTION 'promo_discount_type dan promo_discount_value harus keduanya NULL atau keduanya isi';
  END IF;

  -- Type validation
  IF p_promo_discount_type NOT IN ('PERCENT','AMOUNT') THEN
    RAISE EXCEPTION 'promo_discount_type harus PERCENT atau AMOUNT';
  END IF;

  -- Value validation per type
  IF p_promo_discount_type = 'PERCENT' THEN
    IF p_promo_discount_value < 0.01 OR p_promo_discount_value > 100 THEN
      RAISE EXCEPTION 'PERCENT value harus 0.01 <= value <= 100';
    END IF;
  ELSIF p_promo_discount_type = 'AMOUNT' THEN
    IF p_promo_discount_value <= 0 THEN
      RAISE EXCEPTION 'AMOUNT value harus > 0';
    END IF;
    IF v_price IS NULL OR p_promo_discount_value > v_price THEN
      RAISE EXCEPTION 'AMOUNT value (Rp %) tidak boleh melebihi harga produk (Rp %)',
        p_promo_discount_value, COALESCE(v_price, 0);
    END IF;
  END IF;

  -- Expiry validation
  IF p_promo_expires_at IS NOT NULL AND p_promo_expires_at <= now() THEN
    RAISE EXCEPTION 'Tanggal berakhir harus di masa depan';
  END IF;

  UPDATE public.stocks
  SET promo_discount_type = p_promo_discount_type,
      promo_discount_value = p_promo_discount_value,
      promo_expires_at = p_promo_expires_at,
      promo_updated_at = now(),
      promo_updated_by = v_user_id
  WHERE sku = p_sku AND tenant_id = v_tenant;
END $$;

ALTER FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.upsert_stock_promo IS
  'Item #4b: owner set/edit/clear Promo Produk per SKU. Idempotent.';
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Smoke test — rollback-marker pattern**

```sql
DO $$
DECLARE
  v_tenant UUID := (SELECT id FROM tenants WHERE slug='garindo-jaya-panel');
  v_user   UUID;
BEGIN
  SELECT user_id INTO v_user
  FROM public.tenant_members
  WHERE tenant_id = v_tenant AND role = 'owner'
  LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- set PERCENT
  PERFORM upsert_stock_promo('<any-sku>', 'PERCENT', 15, '2026-12-31'::timestamptz);
  ASSERT (SELECT promo_discount_type FROM stocks WHERE sku='<any-sku>' AND tenant_id=v_tenant) = 'PERCENT';

  -- test AMOUNT reject when > price
  BEGIN
    PERFORM upsert_stock_promo('<any-sku>', 'AMOUNT', 999999999, NULL);
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- test clear
  PERFORM upsert_stock_promo('<any-sku>', NULL, NULL, NULL);
  ASSERT (SELECT promo_discount_type FROM stocks WHERE sku='<any-sku>' AND tenant_id=v_tenant) IS NULL;

  RAISE EXCEPTION 'rollback-marker: upsert_stock_promo smoke complete';
END $$;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000122_upsert_stock_promo_rpc.sql
git commit -m "feat(item-4b): upsert_stock_promo RPC (SECDEF)"
```

---

### Task 3: RPC `bulk_upsert_stock_promo` (slot 123)

**Files:**
- Create: `supabase/migrations/20261115000123_bulk_upsert_stock_promo_rpc.sql`

**Interfaces:**
- Consumes: `public.upsert_stock_promo` (Task 2), `public._resolve_tenant_id()`
- Produces: SECDEF function `bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)` returning TABLE(sku TEXT, ok BOOLEAN, error_message TEXT)

- [ ] **Step 1: Write RPC migration**

```sql
-- 20261115000123_bulk_upsert_stock_promo_rpc.sql
CREATE OR REPLACE FUNCTION public.bulk_upsert_stock_promo(
  p_skus                 TEXT[],
  p_promo_discount_type  TEXT,
  p_promo_discount_value NUMERIC,
  p_promo_expires_at     TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(sku TEXT, ok BOOLEAN, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deduplicated TEXT[];
  v_sku TEXT;
BEGIN
  IF array_length(p_skus, 1) IS NULL THEN
    RETURN;
  END IF;

  IF array_length(p_skus, 1) > 500 THEN
    RAISE EXCEPTION 'Maksimum 500 SKU per bulk call (input: %)', array_length(p_skus, 1);
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_skus)) INTO v_deduplicated;

  FOREACH v_sku IN ARRAY v_deduplicated LOOP
    BEGIN
      PERFORM public.upsert_stock_promo(v_sku, p_promo_discount_type, p_promo_discount_value, p_promo_expires_at);
      sku := v_sku;
      ok := true;
      error_message := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      sku := v_sku;
      ok := false;
      error_message := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

ALTER FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.bulk_upsert_stock_promo IS
  'Item #4b: bulk apply Promo Produk to N SKUs (max 500). Tolerant mode: per-SKU status returned.';
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Smoke test with rollback marker**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000123_bulk_upsert_stock_promo_rpc.sql
git commit -m "feat(item-4b): bulk_upsert_stock_promo RPC (tolerant)"
```

---

### Task 4: Read RPCs — `list_active_promos` + `get_promo_summary` (slot 124)

**Files:**
- Create: `supabase/migrations/20261115000124_promo_read_rpcs.sql`

**Interfaces:**
- Consumes: `public.stocks`, `public._resolve_tenant_id()`
- Produces:
  - `list_active_promos(TEXT DEFAULT 'active')` returning TABLE(...)
  - `get_promo_summary()` returning TABLE(total_active INT, expiring_7d INT, expired_30d INT)

- [ ] **Step 1: Write RPC migration**

```sql
-- 20261115000124_promo_read_rpcs.sql

CREATE OR REPLACE FUNCTION public.list_active_promos(
  p_filter TEXT DEFAULT 'active'
) RETURNS TABLE(
  sku                    TEXT,
  name                   TEXT,
  category               TEXT,
  price                  NUMERIC,
  promo_discount_type    TEXT,
  promo_discount_value   NUMERIC,
  promo_expires_at       TIMESTAMPTZ,
  status                 TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_filter TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RETURN;
  END IF;

  v_filter := COALESCE(p_filter, 'active');
  IF v_filter NOT IN ('active','expiring_7d','expired','all') THEN
    v_filter := 'active';
  END IF;

  RETURN QUERY
  SELECT
    s.sku::TEXT,
    s.name::TEXT,
    s.category::TEXT,
    s.price::NUMERIC,
    s.promo_discount_type::TEXT,
    s.promo_discount_value::NUMERIC,
    s.promo_expires_at::TIMESTAMPTZ,
    CASE
      WHEN s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now() THEN 'expired'
      WHEN s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now() + INTERVAL '7 days' THEN 'expiring_7d'
      ELSE 'active'
    END::TEXT AS status
  FROM public.stocks s
  WHERE s.tenant_id = v_tenant
    AND s.promo_discount_type IS NOT NULL
    AND (
      (v_filter = 'active' AND (s.promo_expires_at IS NULL OR s.promo_expires_at > now()))
      OR (v_filter = 'expiring_7d' AND s.promo_expires_at BETWEEN now() AND now() + INTERVAL '7 days')
      OR (v_filter = 'expired' AND s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now())
      OR (v_filter = 'all')
    )
  ORDER BY s.promo_expires_at NULLS LAST, s.sku
  LIMIT 5000;
END $$;

ALTER FUNCTION public.list_active_promos(TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.list_active_promos(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_promos(TEXT) TO authenticated;

COMMENT ON FUNCTION public.list_active_promos IS
  'Item #4b: return Promo Produk rows for tenant. Filter: active|expiring_7d|expired|all. Cap 5000.';


CREATE OR REPLACE FUNCTION public.get_promo_summary()
RETURNS TABLE(
  total_active INT,
  expiring_7d  INT,
  expired_30d  INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    total_active := 0; expiring_7d := 0; expired_30d := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE promo_expires_at IS NULL OR promo_expires_at > now())::INT,
    COUNT(*) FILTER (WHERE promo_expires_at BETWEEN now() AND now() + INTERVAL '7 days')::INT,
    COUNT(*) FILTER (WHERE promo_expires_at <= now() AND promo_expires_at > now() - INTERVAL '30 days')::INT
  INTO total_active, expiring_7d, expired_30d
  FROM public.stocks
  WHERE tenant_id = v_tenant AND promo_discount_type IS NOT NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_promo_summary() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_promo_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_promo_summary() TO authenticated;

COMMENT ON FUNCTION public.get_promo_summary IS
  'Item #4b: dashboard card metrics for Promo Produk.';
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Smoke test — verify counts**

```sql
DO $$
DECLARE
  v_tenant UUID := (SELECT id FROM tenants WHERE slug='garindo-jaya-panel');
  v_user   UUID;
  v_summary RECORD;
BEGIN
  SELECT user_id INTO v_user FROM public.tenant_members WHERE tenant_id = v_tenant AND role='owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- Baseline
  SELECT * INTO v_summary FROM get_promo_summary();
  RAISE NOTICE 'summary before: active=% expiring=% expired=%',
    v_summary.total_active, v_summary.expiring_7d, v_summary.expired_30d;

  RAISE EXCEPTION 'rollback-marker: read RPC smoke complete';
END $$;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000124_promo_read_rpcs.sql
git commit -m "feat(item-4b): list_active_promos + get_promo_summary read RPCs"
```

---

### Task 5: `record_kasir_sale` behavior extension (slot 125)

**Files:**
- Create: `supabase/migrations/20261115000125_record_kasir_sale_promo_enrich.sql`

**Interfaces:**
- Consumes: existing `record_kasir_sale` (do not change signature)
- Produces: updated body that reads `stocks.promo_*` per line and writes `promo_snapshot` JSONB to `kasir_transaction_items`

- [ ] **Step 1: Read existing `record_kasir_sale` full body**

Query current definition via mcp__plugin_supabase_supabase__execute_sql:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname='record_kasir_sale' AND pronamespace='public'::regnamespace;
```

Preserve signature exactly. Find the line-item insertion loop.

- [ ] **Step 2: Extend line insertion with promo lookup + snapshot update**

Add AFTER the INSERT INTO kasir_transaction_items for each item:

```sql
UPDATE public.kasir_transaction_items kti
SET promo_snapshot = jsonb_build_object(
  'type', s.promo_discount_type,
  'value', s.promo_discount_value,
  'expires_at', s.promo_expires_at,
  'applied_at', now()
)
FROM public.stocks s
WHERE kti.id = <newly-inserted-id>
  AND s.sku = <item.sku>
  AND s.tenant_id = v_tenant_id
  AND s.promo_discount_type IS NOT NULL
  AND (s.promo_expires_at IS NULL OR s.promo_expires_at > now());
```

Adjust variable names to match existing RPC.

- [ ] **Step 3: Apply migration**

- [ ] **Step 4: Smoke test — verify snapshot populated when promo active, NULL when not**

```sql
DO $$
DECLARE
  v_tenant UUID := (SELECT id FROM tenants WHERE slug='garindo-jaya-panel');
  v_user   UUID;
BEGIN
  SELECT user_id INTO v_user FROM public.tenant_members WHERE tenant_id=v_tenant AND role='owner' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- 1. set promo on a test SKU
  PERFORM upsert_stock_promo('<test-sku>', 'PERCENT', 10, NULL);

  -- 2. call record_kasir_sale with that SKU (need valid customer, warehouse, payload)
  -- ... invoke record_kasir_sale ...

  -- 3. verify latest inserted line has promo_snapshot populated
  ASSERT (SELECT promo_snapshot->>'type'
          FROM kasir_transaction_items
          ORDER BY created_at DESC LIMIT 1) = 'PERCENT';

  RAISE EXCEPTION 'rollback-marker: record_kasir_sale enrich smoke complete';
END $$;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000125_record_kasir_sale_promo_enrich.sql
git commit -m "feat(item-4b): enrich kasir_transaction_items with promo_snapshot"
```

---

### Task 6: Frontend types + API client

**Files:**
- Create: `src/lib/promoProduk/types.ts`
- Create: `src/lib/promoProduk/api.ts`

**Interfaces:**
- Consumes: `src/lib/supabaseClient.ts` (existing)
- Produces:
  - Types: `PromoDiscountType`, `PromoStatus`, `PromoRow`, `UpsertPromoInput`, `BulkUpsertPromoInput`, `BulkUpsertResult`, `PromoSummary`, `PromoFilter`
  - API fns: `upsertStockPromo`, `bulkUpsertStockPromo`, `listActivePromos`, `getPromoSummary`

- [ ] **Step 1: Write `src/lib/promoProduk/types.ts`**

```typescript
export type PromoDiscountType = 'PERCENT' | 'AMOUNT';
export type PromoStatus = 'active' | 'expiring_7d' | 'expired';
export type PromoFilter = 'active' | 'expiring_7d' | 'expired' | 'all';

export interface PromoRow {
  sku: string;
  name: string;
  category: string;
  price: number;
  promo_discount_type: PromoDiscountType;
  promo_discount_value: number;
  promo_expires_at: string | null;
  status: PromoStatus;
}

export interface UpsertPromoInput {
  sku: string;
  promoDiscountType: PromoDiscountType | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
}

export interface BulkUpsertPromoInput {
  skus: string[];
  promoDiscountType: PromoDiscountType | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
}

export interface BulkUpsertResultRow {
  sku: string;
  ok: boolean;
  error_message: string | null;
}

export interface PromoSummary {
  total_active: number;
  expiring_7d: number;
  expired_30d: number;
}
```

- [ ] **Step 2: Write `src/lib/promoProduk/api.ts`**

```typescript
import { supabase } from '../supabaseClient';
import type {
  PromoRow, UpsertPromoInput, BulkUpsertPromoInput,
  BulkUpsertResultRow, PromoSummary, PromoFilter,
} from './types';

export async function upsertStockPromo(input: UpsertPromoInput): Promise<void> {
  const { error } = await supabase.rpc('upsert_stock_promo', {
    p_sku: input.sku,
    p_promo_discount_type: input.promoDiscountType,
    p_promo_discount_value: input.promoDiscountValue,
    p_promo_expires_at: input.promoExpiresAt,
  });
  if (error) throw error;
}

export async function bulkUpsertStockPromo(
  input: BulkUpsertPromoInput,
): Promise<BulkUpsertResultRow[]> {
  const { data, error } = await supabase.rpc('bulk_upsert_stock_promo', {
    p_skus: input.skus,
    p_promo_discount_type: input.promoDiscountType,
    p_promo_discount_value: input.promoDiscountValue,
    p_promo_expires_at: input.promoExpiresAt,
  });
  if (error) throw error;
  return (data ?? []) as BulkUpsertResultRow[];
}

export async function listActivePromos(filter: PromoFilter = 'active'): Promise<PromoRow[]> {
  const { data, error } = await supabase.rpc('list_active_promos', { p_filter: filter });
  if (error) throw error;
  return (data ?? []) as PromoRow[];
}

export async function getPromoSummary(): Promise<PromoSummary> {
  const { data, error } = await supabase.rpc('get_promo_summary');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? { total_active: 0, expiring_7d: 0, expired_30d: 0 }) as PromoSummary;
}
```

- [ ] **Step 3: Verify `npm run lint` clean**

- [ ] **Step 4: Commit**

```bash
git add src/lib/promoProduk/
git commit -m "feat(item-4b): TypeScript types + API client for promoProduk"
```

---

### Task 7: Promo Produk page + components

**Files:**
- Create: `src/pages/pengaturan/PromoProdukPage.tsx`
- Create: `src/components/promo/PromoDiskonTable.tsx`
- Create: `src/components/promo/PromoDiskonFilters.tsx`
- Create: `src/components/promo/PromoDiskonBulkToolbar.tsx`
- Create: `src/components/promo/PromoDiskonFormModal.tsx`

**Interfaces:**
- Consumes: `src/lib/promoProduk/api.ts` (Task 6), existing `formatIDR`, existing modal shell
- Produces: full Promo Produk page reachable at `/pengaturan/diskon/promo-produk?filter=<PromoFilter>` (route wired in Task 10)

- [ ] **Step 1: Write `PromoDiskonTable.tsx`**

Renders table of PromoRow[] with columns: checkbox, SKU, Nama, Promo (rendered as "15%" or "Rp 3.000/unit"), Berlaku hingga (rendered as date or "∞ permanen" or "Kadaluwarsa"), status badge, ⋯ action menu. Font 13-14px. Badge palette per Global Constraints.

Props: `rows: PromoRow[]`, `selected: string[]`, `onToggleSelect(sku)`, `onToggleAll()`, `onEdit(sku)`, `onDelete(sku)`, `onDuplicate(sku)`.

Empty state: "Belum ada SKU dengan promo. Klik + Tambah Promo untuk mulai."

- [ ] **Step 2: Write `PromoDiskonFilters.tsx`**

Renders search input + status filter dropdown + category filter dropdown. Props: `search`, `statusFilter`, `categoryFilter`, `onSearchChange`, `onStatusChange`, `onCategoryChange`, `counts: { active: number, expiring_7d: number, expired: number, all: number }`.

Status dropdown shows counts inline: "Aktif (42 SKU)".

Category dropdown fetches from `stocks.category` distinct values (via existing hook if available, else inline fetch).

- [ ] **Step 3: Write `PromoDiskonBulkToolbar.tsx`**

Floating bar. Props: `selectedCount`, `onDeactivate`, `onDelete`, `onEditExpiry`, `onCancel`.

Rendered fixed at bottom of viewport when `selectedCount > 0`.

- [ ] **Step 4: Write `PromoDiskonFormModal.tsx`**

Modal with multi-SKU picker, type toggle, value input with unit swap, expiry date picker + "Selamanya" radio option, preview list.

Props: `open: boolean`, `mode: 'add' | 'edit'`, `initialSku?: string`, `initialPromo?: {...}`, `onClose()`, `onSubmit(result: BulkUpsertResultRow[])`.

Client-side validation before submit: PERCENT 0.01-100, AMOUNT > 0 and ≤ min(price of selected SKUs), expiry > now(). Disable submit if invalid.

On submit: call `bulkUpsertStockPromo`, show toast per Global Constraints result rendering.

- [ ] **Step 5: Write `PromoProdukPage.tsx`**

State: `rows`, `filter`, `search`, `categoryFilter`, `selectedSkus`, `modalOpen`, `editSku`.

On mount + filter change → `listActivePromos(filter)` → set rows.

Reads `?filter=<PromoFilter>` query param on mount (dashboard deep link).

Renders: page header ("Promo Produk"), `[+ Tambah Promo]` button, `PromoDiskonFilters`, `PromoDiskonTable` with filtered/searched rows, `PromoDiskonBulkToolbar` when selected > 0, `PromoDiskonFormModal`.

Bulk actions call:
- Deactivate: `bulkUpsertStockPromo({ skus: selected, promoDiscountType: null, promoDiscountValue: null, promoExpiresAt: null })`
- Delete: same (both NULL clears promo)
- Edit expiry: open small modal for date picker, call `bulkUpsertStockPromo` preserving current type/value per SKU (fetch first) — MVP: apply single new expiry to all selected keeping their existing type+value; if that's complex, ship modal that also sets type+value.

- [ ] **Step 6: Verify `npm run lint` + local dev at `/pengaturan/diskon/promo-produk`**

- [ ] **Step 7: Commit**

```bash
git add src/pages/pengaturan/PromoProdukPage.tsx src/components/promo/
git commit -m "feat(item-4b): Promo Produk page + components"
```

---

### Task 8: Produk & Stok column extension + inline edit

**Files:**
- Modify: `src/components/produk/ProdukStokTable.tsx` (or matching existing file — locate via grep)
- Create: `src/components/promo/PromoInlineEdit.tsx`

**Interfaces:**
- Consumes: `upsertStockPromo` from Task 6
- Produces: 2 new columns "Promo" + "Berlaku hingga" with popover inline edit

- [ ] **Step 1: Locate existing Produk & Stok table component**

```bash
grep -rn "Produk & Stok\|ProdukStok" src/ --include="*.tsx" | head
```

- [ ] **Step 2: Write `PromoInlineEdit.tsx`**

Popover component with type toggle + value input + expiry date picker. Props: `sku`, `currentType`, `currentValue`, `currentExpiresAt`, `productPrice`, `onSaved()`.

On save: `upsertStockPromo(...)` → close popover → call onSaved.

Client validation same as Task 7 modal.

- [ ] **Step 3: Modify Produk & Stok table**

Add 2 columns after "Kategori":
- "Promo": display value + unit, or em-dash + "+ Set promo" button
- "Berlaku hingga": display date or "∞ permanen" or em-dash

Click on either → open `PromoInlineEdit` popover positioned near cell.

Fetch promo columns as part of existing product query (extend select).

- [ ] **Step 4: Verify local dev — inline edit works on a product**

- [ ] **Step 5: Commit**

```bash
git add src/components/produk/ src/components/promo/PromoInlineEdit.tsx
git commit -m "feat(item-4b): Produk & Stok promo columns + inline edit"
```

---

### Task 9: Kasir wizard auto-apply Promo Produk per line

**Files:**
- Modify: `src/components/penjualan/CatatPenjualanWizard.tsx`
- Create: `src/hooks/useActivePromos.ts`

**Interfaces:**
- Consumes: `listActivePromos` from Task 6
- Produces: line-level display of Promo Produk in cart + line net calculation

- [ ] **Step 1: Write `useActivePromos.ts`**

Hook that fetches `listActivePromos('active')` on mount, returns `Map<sku, PromoRow>`. Handles error gracefully (return empty Map, log to console).

- [ ] **Step 2: Modify `CatatPenjualanWizard.tsx`**

On mount: call `useActivePromos` to build promo lookup.

For each cart line, compute:
```typescript
function applyPromo(unitPrice, qty, promo) {
  if (!promo) return { discount: 0, net: unitPrice * qty };
  if (promo.promo_discount_type === 'PERCENT') {
    const discount = unitPrice * qty * (promo.promo_discount_value / 100);
    return { discount, net: unitPrice * qty - discount };
  }
  // AMOUNT
  if (promo.promo_discount_value > unitPrice) {
    // guard: skip
    console.warn(`Promo Rp ${promo.promo_discount_value} tidak nempel di ${sku}: harga sekarang Rp ${unitPrice}`);
    return { discount: 0, net: unitPrice * qty };
  }
  const discount = promo.promo_discount_value * qty;
  return { discount, net: (unitPrice - promo.promo_discount_value) * qty };
}
```

Render below each cart line when promo exists:
```
🏷 Promo Produk: 15% = -Rp 63.750
```

Subtotal = sum of line nets (post-promo). Diskon Nota field + Item #4 gate call unchanged.

**Wire the line discount into the record_kasir_sale payload** — pass `discount_amount_per_line` per existing wizard convention (verify shape by reading existing code). If existing wizard doesn't have per-line discount field, pass promo discount as part of line's `discount_amount` or `unit_price_after_discount` per current schema. **Reader must inspect existing kasir_transaction_items insertion to match convention.**

- [ ] **Step 3: Verify local dev — cart line shows promo when SKU has active promo, no promo shown otherwise**

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useActivePromos.ts src/components/penjualan/CatatPenjualanWizard.tsx
git commit -m "feat(item-4b): kasir wizard auto-apply Promo Produk per line"
```

---

### Task 10: Restructure Pengaturan menu — Diskon parent + landing + Aturan Diskon Nota

**Files:**
- Create: `src/pages/pengaturan/DiskonLandingPage.tsx`
- Create: `src/pages/pengaturan/AturanDiskonNotaPage.tsx`
- Modify: `src/components/pengaturan/ApprovalRulesPanel.tsx`
- Modify: sidebar/navigation config (locate via grep for existing "Aturan Persetujuan" entry)
- Modify: routing config (locate via grep for existing routes)

**Interfaces:**
- Consumes: existing `ApprovalGateEditor` (Item #4), existing `upsertApprovalSettings` from Item #4 api
- Produces: 3 routes under `/pengaturan/diskon`

- [ ] **Step 1: Write `DiskonLandingPage.tsx`**

2-card landing per spec §6.1. Card 1 links to `/pengaturan/diskon/promo-produk`, Card 2 links to `/pengaturan/diskon/aturan-nota`. Fetch `getPromoSummary` for Card 1 metrics + read `approval_settings` for Card 2 config summary.

- [ ] **Step 2: Write `AturanDiskonNotaPage.tsx`**

Reuse existing `ApprovalGateEditor` component from Item #4. Wrap with page header, explanatory copy per spec §6.1. Configure editor to target `kasir_discount` request type only.

- [ ] **Step 3: Modify `ApprovalRulesPanel.tsx`**

Filter out `kasir_discount` row (add condition to hide when `request_type === 'kasir_discount'`). Add info notice at top: "Aturan Diskon Nota telah dipindah ke [Pengaturan → Diskon → Aturan Diskon Nota]." with link.

- [ ] **Step 4: Add routes + sidebar entries**

Locate sidebar config and routing (React Router / equivalent). Add:
- Route `/pengaturan/diskon` → `DiskonLandingPage`
- Route `/pengaturan/diskon/aturan-nota` → `AturanDiskonNotaPage`
- Route `/pengaturan/diskon/promo-produk` → `PromoProdukPage` (from Task 7)
- Sidebar: parent "Diskon" with 2 children (Aturan Diskon Nota + Promo Produk)

- [ ] **Step 5: Verify local dev — all 3 routes render, sidebar reflects new structure**

- [ ] **Step 6: Commit**

```bash
git add src/pages/pengaturan/DiskonLandingPage.tsx \
        src/pages/pengaturan/AturanDiskonNotaPage.tsx \
        src/components/pengaturan/ApprovalRulesPanel.tsx \
        <sidebar-config-file> <routing-config-file>
git commit -m "feat(item-4b): restructure Pengaturan menu (Diskon parent + Aturan Diskon Nota moved)"
```

---

### Task 11: Dashboard Promo Produk maintenance card

**Files:**
- Create: `src/components/dashboard/PromoProdukCard.tsx`
- Modify: dashboard main page (locate)

**Interfaces:**
- Consumes: `getPromoSummary` from Task 6
- Produces: Card component + wiring into dashboard

- [ ] **Step 1: Write `PromoProdukCard.tsx`**

On mount → `getPromoSummary()`. If all 3 counts = 0 → return null (hide card).

Render 3 metrics per spec §6.6. CTA button navigates to `/pengaturan/diskon/promo-produk?filter=expiring_7d` when `expiring_7d > 0`, else `?filter=active`.

- [ ] **Step 2: Wire into dashboard main page**

Locate dashboard page (grep for existing card grid). Insert `<PromoProdukCard />` in the maintenance section.

- [ ] **Step 3: Verify local dev — card renders when tenant has promos, hidden when 0**

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/PromoProdukCard.tsx <dashboard-page-file>
git commit -m "feat(item-4b): Dashboard Promo Produk maintenance card"
```

---

## After all tasks

- [ ] Stage 1 verification: `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npx vitest run --changed`
- [ ] `mcp__plugin_supabase_supabase__get_advisors` post-migration triage
- [ ] Stage 2: `git push main` → cloudbuild → verify tag URL deployed → promote 100% traffic
- [ ] Stage 3: MCP chrome smoke test against prod-testing tenant (Toko Jaya Makmur) — setup 3 promos, verify kasir wizard auto-apply, verify Item #4 flow still works, verify sale record + promo_snapshot
- [ ] Update `progress.md` with Item #4b shipping entry
- [ ] Update memory `migration_slot_allocation` to reserve 120-125 as claimed
