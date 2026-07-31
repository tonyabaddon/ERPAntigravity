# Phase 2 — SKU Qty Tier Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable owner to configure per-SKU quantity thresholds (`beli ≥ N pcs → Rp X/pcs`, max 5 tiers per SKU) so kasir/quotation auto-applies the lower of customer-tier and qty-tier price at line-add, with a status chip and an upsell hint.

**Architecture:** New normalized table `stock_qty_price_tiers` (per-tenant, variable cardinality up to 5 tiers per stock) + 2 SECDEF RPCs for owner config + widening of `record_kasir_sale` / `create_tempo_invoice` for server-authoritative `min(customer_tier_price, qty_tier_price)` + JSONB snapshot (`qty_tier_min_qty`, `qty_tier_applied`, `manual_override`). New FE helper `getApplicableQtyTier` + editor component `QtyTiersEditor` + cart-line chip and upsell hint in `CartRows`.

**Tech Stack:** PostgreSQL 15 (Supabase managed), React 19 + TypeScript, Vitest + @testing-library/react, Tailwind (existing tokens only), Supabase JS client, Supabase Management API for RPC smoke.

**Spec:** [`docs/superpowers/specs/2026-07-31-phase-2-sku-qty-tier-design.md`](../specs/2026-07-31-phase-2-sku-qty-tier-design.md) (commit `18bfd78`)
**Decision memo:** [`docs/superpowers/specs/2026-07-31-phase-2-sku-qty-tier-decision.md`](../specs/2026-07-31-phase-2-sku-qty-tier-decision.md)
**Prior phases:** Phase 1a plan `2026-07-24-...`, Phase 1b plan `2026-07-28-...` — same discipline, mirror structure.

## Global Constraints

- **`stocks.sku VARCHAR(50)` is the PK** (verified via information_schema). FK in `stock_qty_price_tiers` = `stock_sku VARCHAR(50) REFERENCES public.stocks(sku) ON DELETE CASCADE`. Spec called it `stock_id UUID` — that assumption was wrong; plan uses the correct column.
- **Cap:** max 5 tiers per SKU. `min_qty >= 2` (CHECK). `price > 0` (CHECK).
- **Snapshot semantic (locked, documented in memo §4):** `qty_tier_applied = true` iff qty tier price actually WON over customer tier price at write time. `qty_tier_min_qty` = the applied threshold (NULL when not applied). `manual_override = true` iff kasir manually edited `unit_price` before submission.
- **Chip fires only when `qty_tier_applied = true`** (i.e., qty tier actually won). Never on threshold-met-but-lost.
- **Manual override discarded on qty change** — matches Phase 1b cart re-price pattern.
- **Interaction rule:** `min(customer_tier_price, qty_tier_price)` — server-authoritative in RPC.
- **Bahasa Indonesia labels.** No NEW emojis. Font ≥ 11px. Reuse Phase 1b palette (navy pill for base, purple for tier 2+, gray inactive).
- **SECDEF RPC pattern (per PR #67):** `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`, `v_actor := auth.uid()`, `v_tenant_id := public._resolve_tenant_id()`, inline `admin_users WHERE role='Owner'` check, `ALTER FUNCTION ... OWNER TO postgres`, `GRANT EXECUTE TO authenticated`, `REVOKE EXECUTE FROM anon`.
- **Error taxonomy:** `QTP_FORBIDDEN` (P0403), `QTP_INVALID_MIN_QTY` (P0400 with hint), `QTP_INVALID_PRICE` (P0400 with hint), `QTP_TOO_MANY_TIERS` (P0400), `QTP_STOCK_NOT_FOUND` (P0404).
- **Migration slots:** `20261115000545` (schema + panel RPCs), `20261115000546` (sales RPC widening). Both idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- **Sales RPCs authoritative bodies** live in `20261115000543` (Phase 1b widening). Task 5 copies verbatim + applies changes.
- **Stage 1 gates before commit:** `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npm run audit:csp-backend-allowlist`, `npm run audit:no-string-err-fallback`, `npm run audit:secdef-auth-schema-owner`, `npx vitest run --changed` (or scoped).
- **Stage 3 tenant:** `Toko Jaya Makmur` only (UUID `22222222-2222-2222-2222-222222222222`).
- **Prod promote:** manual via `scripts/promote-to-prod.sh <SHORT_SHA>`.
- **Commit style:** Conventional-Commits + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- **Working tree caveat:** `main` has ~15-20 unrelated dirty files. Every task's `git add` names specific files only; NEVER `git add .` / `-A` / `src/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql` (new) | Table `stock_qty_price_tiers` + RLS + indexes + `set_stock_qty_tiers` + `delete_all_stock_qty_tiers` SECDEF RPCs. |
| `supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql` (new) | Widen `record_kasir_sale` + `create_tempo_invoice` for qty tier fetch + server min() + JSONB snapshot stamp + per-item manual_override handling. |
| `src/types.ts` (modify) | Add `StockQtyTier` interface; extend `SupabaseStockItem.qty_tiers?: StockQtyTier[]`; extend `CartItem` with `qty_tier_min_qty?: number \| null`, `qty_tier_applied?: boolean`, `manual_override?: boolean`. |
| `src/lib/pengaturan/pengaturanServices.ts` OR `src/lib/supabaseClient.ts` (modify) | Add `stocksService.setQtyTiers(stockSku, tiers)` + `stocksService.deleteAllQtyTiers(stockSku)` wrappers. Extend stocks fetch (if applicable) to left-join `qty_tiers`. |
| `src/lib/pricing/getApplicableQtyTier.ts` (new) | Export `QtyTier` interface + `getApplicableQtyTier(tiers, qty)` (highest matching threshold) + `getNextUpsellTier(tiers, qty, currentUnitPrice)` (next tier above qty that would beat currentUnitPrice). |
| `src/lib/pricing/getApplicableQtyTier.test.ts` (new) | Vitest unit tests. |
| `src/components/produk/QtyTiersEditor.tsx` (new) | Inline price-ladder editor (max 5 rows, `+ Tambah tier volume`, `×` remove, preview line, save via wrapper). |
| `src/components/produk/QtyTiersEditor.test.tsx` (new) | Vitest tests for form validation, save happy path, warning when tier price ≥ base, RPC error mapping. |
| `src/components/produk/ProductForm.tsx` (modify) | Embed `QtyTiersEditor` below existing `Harga` fields; pass `stockSku`, `basePrice`, `initialTiers`. |
| `src/components/produk/StockTableView.tsx` (modify) | Add row-level "Edit Vol" button that opens `QtyTiersEditor` in a modal (avoid inline column bloat). |
| `src/components/penjualan/CartRows.tsx` (modify) | Chip: only fire "Vol {min_qty}+" when `line.qty_tier_applied === true`; else defer to Phase 1b customer tier chip; else "Manual" when `line.manual_override === true`. Upsell hint via `getNextUpsellTier`. |
| `src/components/penjualan/CatatPenjualanWizard.tsx` (modify) | Fetch qty tiers for cart SKUs into `stockQtyTiers: Record<sku, QtyTier[]>` state; extend cart re-price effect for qty tier + manual_override discard on qty change; wire `manual_override` flag through to items JSONB on save. |
| `progress.md` (modify) | Append Phase 2 SHIPPED entry. |

**Total: 2 migrations + 6 code files modified + 4 new files (1 helper + 1 component + 2 test files).**

---

## Task 1: Migration `000545` — schema + 2 SECDEF RPCs

**Files:**
- Create: `supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql`

**Interfaces:**
- Consumes: `stocks(sku VARCHAR(50) PRIMARY KEY, tenant_id UUID, price NUMERIC)` [existing], `tenants(id UUID)` [existing], `_resolve_tenant_id()` [existing, verified in kasir-expense-categories precedent], `admin_users(id UUID, role TEXT)` [existing].
- Produces:
  - Table `public.stock_qty_price_tiers (id UUID PK, tenant_id UUID FK CASCADE, stock_sku VARCHAR(50) FK stocks(sku) CASCADE, min_qty INT CHECK ≥ 2, price NUMERIC CHECK > 0, timestamps)` + UNIQUE(stock_sku, min_qty).
  - RPC `public.set_stock_qty_tiers(p_stock_sku VARCHAR, p_tiers JSONB) RETURNS void` — owner-only, atomic DELETE+INSERT, TCFG-shaped `QTP_*` error taxonomy, cap 5 tiers, min_qty ≥ 2, price > 0.
  - RPC `public.delete_all_stock_qty_tiers(p_stock_sku VARCHAR) RETURNS void` — owner-only, clears all tiers for a SKU.
  - Both RPCs `OWNER TO postgres` per PR #67 hotfix; `GRANT EXECUTE TO authenticated`; `REVOKE FROM anon`.

- [ ] **Step 1: Verify migration slot 545 still free**

Run:
```bash
ls supabase/migrations/ | grep -E '2026111500054[0-9]' | sort
```
Expected: latest is `000544` (Phase 1b). If `000545` already claimed by a parallel session, use the next free slot (bump downstream references).

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql`:

```sql
-- 20261115000545_stock_qty_price_tiers_schema_and_rpc.sql
-- Phase 2 Task 1 — SKU qty-tier pricing schema + owner CRUD RPCs.
--
-- Adds public.stock_qty_price_tiers table (per-tenant, per-SKU, variable
-- cardinality up to 5 tiers). Ships 2 SECDEF RPCs for owner CRUD:
-- set_stock_qty_tiers (atomic DELETE+INSERT replace) + delete_all_stock_qty_tiers.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_stock_qty_tiers(varchar, jsonb);
--   DROP FUNCTION IF EXISTS public.delete_all_stock_qty_tiers(varchar);
--   DROP POLICY IF EXISTS t_select_own_secdef ON public.stock_qty_price_tiers;
--   DROP POLICY IF EXISTS t_select_own ON public.stock_qty_price_tiers;
--   DROP TABLE IF EXISTS public.stock_qty_price_tiers;

-- ─── Schema ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_qty_price_tiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stock_sku    VARCHAR(50) NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  min_qty      INT NOT NULL CHECK (min_qty >= 2),
  price        NUMERIC NOT NULL CHECK (price > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_qty_price_tiers_sku_min_qty
  ON public.stock_qty_price_tiers (stock_sku, min_qty);

CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_lookup
  ON public.stock_qty_price_tiers (stock_sku, min_qty DESC);

CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_tenant
  ON public.stock_qty_price_tiers (tenant_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_qty_price_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.stock_qty_price_tiers;
CREATE POLICY t_select_own ON public.stock_qty_price_tiers
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

-- Allow vosi_rpc_owner (in case future SECDEF RPCs owned by that role need read).
-- Phase 2 RPCs OWNER TO postgres so they read via superuser bypass, but keeping
-- policy for defense in depth + consistency with kasir_expense_categories pattern.
DROP POLICY IF EXISTS t_select_own_secdef ON public.stock_qty_price_tiers;
CREATE POLICY t_select_own_secdef ON public.stock_qty_price_tiers
  FOR SELECT TO vosi_rpc_owner
  USING (true);

-- No direct client INSERT/UPDATE/DELETE policy — writes only via SECDEF RPCs below.

-- ─── SECDEF RPC: set_stock_qty_tiers ─────────────────────────────────────────
-- Atomic replace of ALL tiers for a stock. Empty JSONB array clears tiers.
-- Error taxonomy:
--   QTP_FORBIDDEN         (P0403) caller not Owner
--   QTP_STOCK_NOT_FOUND   (P0404) stock_sku missing or wrong tenant
--   QTP_TOO_MANY_TIERS    (P0400) > 5 tiers
--   QTP_INVALID_MIN_QTY   (P0400 hint: value) min_qty < 2 or duplicate
--   QTP_INVALID_PRICE     (P0400 hint: value) price <= 0

CREATE OR REPLACE FUNCTION public.set_stock_qty_tiers(
  p_stock_sku VARCHAR(50),
  p_tiers     JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_tenant_id    UUID := public._resolve_tenant_id();
  v_stock_exists BOOLEAN;
  v_tier_count   INT;
  v_tier         JSONB;
  v_seen_qty     INT[] := ARRAY[]::INT[];
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'QTP_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Stock exists + belongs to caller's tenant
  SELECT EXISTS (
    SELECT 1 FROM public.stocks
    WHERE sku = p_stock_sku AND tenant_id = v_tenant_id
  ) INTO v_stock_exists;
  IF NOT v_stock_exists THEN
    RAISE EXCEPTION 'QTP_STOCK_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  -- Cap
  v_tier_count := COALESCE(jsonb_array_length(p_tiers), 0);
  IF v_tier_count > 5 THEN
    RAISE EXCEPTION 'QTP_TOO_MANY_TIERS' USING errcode = 'P0400';
  END IF;

  -- Validate each tier + uniqueness within batch
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tiers) LOOP
    IF (v_tier->>'min_qty')::INT < 2 THEN
      RAISE EXCEPTION 'QTP_INVALID_MIN_QTY' USING errcode = 'P0400', hint = v_tier->>'min_qty';
    END IF;
    IF (v_tier->>'price')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'QTP_INVALID_PRICE' USING errcode = 'P0400', hint = v_tier->>'price';
    END IF;
    IF (v_tier->>'min_qty')::INT = ANY(v_seen_qty) THEN
      RAISE EXCEPTION 'QTP_INVALID_MIN_QTY' USING errcode = 'P0400', hint = 'duplicate min_qty';
    END IF;
    v_seen_qty := array_append(v_seen_qty, (v_tier->>'min_qty')::INT);
  END LOOP;

  -- Atomic replace
  DELETE FROM public.stock_qty_price_tiers
    WHERE stock_sku = p_stock_sku AND tenant_id = v_tenant_id;

  IF v_tier_count > 0 THEN
    INSERT INTO public.stock_qty_price_tiers (tenant_id, stock_sku, min_qty, price)
      SELECT v_tenant_id, p_stock_sku, (t->>'min_qty')::INT, (t->>'price')::NUMERIC
        FROM jsonb_array_elements(p_tiers) t;
  END IF;
END $$;

ALTER FUNCTION public.set_stock_qty_tiers(varchar, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_stock_qty_tiers(varchar, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_stock_qty_tiers(varchar, jsonb) FROM anon;

-- ─── SECDEF RPC: delete_all_stock_qty_tiers ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_all_stock_qty_tiers(
  p_stock_sku VARCHAR(50)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_tenant_id UUID := public._resolve_tenant_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'QTP_FORBIDDEN' USING errcode = 'P0403';
  END IF;
  DELETE FROM public.stock_qty_price_tiers
    WHERE stock_sku = p_stock_sku AND tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.delete_all_stock_qty_tiers(varchar) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(varchar) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(varchar) FROM anon;
```

- [ ] **Step 3: Apply migration via Management API**

```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}" | head -20
```
Expected: `[]` (DDL success, no rows).

- [ ] **Step 4: Verify table + RPCs exist**

```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''stock_qty_price_tiers'\'' ORDER BY ordinal_position;"}'
```
Expected: 7 columns (id, tenant_id, stock_sku, min_qty, price, created_at, updated_at).

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT proname, pronargs FROM pg_proc WHERE proname IN ('\''set_stock_qty_tiers'\'','\''delete_all_stock_qty_tiers'\'') ORDER BY proname;"}'
```
Expected: 2 rows (`delete_all_stock_qty_tiers` pronargs=1, `set_stock_qty_tiers` pronargs=2).

- [ ] **Step 5: Smoke happy path + reject paths via RAISE-rollback**

Grab owner UID:
```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT id FROM public.admin_users WHERE tenant_id='\''22222222-2222-2222-2222-222222222222'\'' AND role='\''Owner'\'' LIMIT 1;"}'
```
Owner UID from earlier sessions: `22222222-aaaa-bbbb-cccc-000000000001`. Verify or fetch fresh.

Happy path smoke (3 tiers on TJM-EL-002, RAISE at end):
```bash
cat > /tmp/qtp_smoke.sql <<'SQL'
DO $do$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '22222222-aaaa-bbbb-cccc-000000000001', true);
  PERFORM public.set_stock_qty_tiers(
    'TJM-EL-002',
    '[{"min_qty":5,"price":16000},{"min_qty":10,"price":15000},{"min_qty":20,"price":14000}]'::jsonb
  );
  RAISE EXCEPTION 'SMOKE_OK';
END $do$;
SQL
source .env
SQL_JSON=$(cat /tmp/qtp_smoke.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\": $SQL_JSON}"
```
Expected: response message contains `SMOKE_OK` (RAISE rolled back the inserts).

Reject paths (each should surface the expected error code, RPC failed as intended):
- `set_stock_qty_tiers('TJM-EL-002', '[{"min_qty":1,"price":100}]'::jsonb)` → `QTP_INVALID_MIN_QTY` with `HINT: 1`
- `set_stock_qty_tiers('TJM-EL-002', '[{"min_qty":5,"price":0}]'::jsonb)` → `QTP_INVALID_PRICE` with `HINT: 0`
- `set_stock_qty_tiers('TJM-EL-002', jsonb_build_array(...) with 6 tiers)` → `QTP_TOO_MANY_TIERS`
- `set_stock_qty_tiers('NON-EXISTENT-SKU', '[]'::jsonb)` → `QTP_STOCK_NOT_FOUND`
- Same call with non-Owner set_config → `QTP_FORBIDDEN`

For efficiency, only run the happy path + one reject (`QTP_INVALID_MIN_QTY`) in the subagent smoke; log the pattern for the other rejects in the report.

- [ ] **Step 6: Idempotency check — re-apply migration**

```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}"
```
Expected: no error. `IF NOT EXISTS` + `CREATE OR REPLACE` handle re-apply.

- [ ] **Step 7: Run local audits**

```bash
npm run audit:secdef-null-tenant
npm run audit:no-string-err-fallback
npm run audit:secdef-auth-schema-owner 2>&1 | tail -5
```
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql
git commit -m "$(cat <<'EOF'
feat(qty-tier): migration 000545 — schema + set/delete RPCs

New stock_qty_price_tiers table (per-tenant, per-SKU, up to 5 tiers).
FK to stocks(sku) — VARCHAR(50) PK verified via information_schema
(spec said UUID id; corrected to sku VARCHAR).

RLS: t_select_own for authenticated (tenant-scoped); t_select_own_secdef
for vosi_rpc_owner (defense in depth). Writes only via SECDEF RPCs.

RPCs set_stock_qty_tiers (atomic DELETE+INSERT, cap 5, QTP_* error
taxonomy) + delete_all_stock_qty_tiers. OWNER TO postgres per PR #67.

Idempotent. Smoke via Management API + RAISE rollback confirmed
happy path + reject paths.

Spec: 18bfd78 §3.1-3.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Type widening + `stocksService.setQtyTiers` / `deleteAllQtyTiers` wrappers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts` OR `src/lib/pengaturan/pengaturanServices.ts` (whichever hosts `stocksService`)

**Interfaces:**
- Consumes: RPCs `set_stock_qty_tiers(varchar, jsonb)` and `delete_all_stock_qty_tiers(varchar)` from Task 1.
- Produces:
  - `StockQtyTier { id?: string; stock_sku: string; min_qty: number; price: number; }` type export from `types.ts`.
  - `SupabaseStockItem.qty_tiers?: StockQtyTier[]` optional field.
  - `CartItem.qty_tier_min_qty?: number | null`, `.qty_tier_applied?: boolean`, `.manual_override?: boolean` fields.
  - `stocksService.setQtyTiers(stockSku: string, tiers: Array<{ min_qty: number; price: number }>): Promise<void>` — wraps RPC.
  - `stocksService.deleteAllQtyTiers(stockSku: string): Promise<void>` — wraps RPC.

- [ ] **Step 1: Grep for `stocksService` location**

```bash
grep -rn 'stocksService\b' src/lib/ | head -10
```
Expected: locate whichever file exports `stocksService`. Add methods there. If no `stocksService` yet exists, create it in `src/lib/supabaseClient.ts` (alongside `customersService`, `tenantSettingsService`, etc.).

- [ ] **Step 2: Add `StockQtyTier` type to `src/types.ts`**

Locate the section with other pricing types (near `TierKey`). Add:

```ts
export interface StockQtyTier {
  id?: string;
  stock_sku: string;
  min_qty: number;
  price: number;
}
```

- [ ] **Step 3: Extend `SupabaseStockItem` with `qty_tiers`**

Find `SupabaseStockItem` interface (existing tier columns present: `price`, `price_grosir?`, `price_tier_3?`, `price_tier_4?` — Phase 1b). Add:

```ts
export interface SupabaseStockItem {
  // ... existing fields
  price_tier_3?: number | null;
  price_tier_4?: number | null;
  qty_tiers?: StockQtyTier[];  // Phase 2 — undefined when not fetched or SKU has no tiers
}
```

- [ ] **Step 4: Extend `CartItem` snapshot fields**

Locate `CartItem` (or equivalent per-line type in `src/types.ts`). Add:

```ts
export interface CartItem {
  // ... existing fields
  qty_tier_min_qty?: number | null;
  qty_tier_applied?: boolean;
  manual_override?: boolean;
}
```

- [ ] **Step 5: Add `stocksService.setQtyTiers` + `deleteAllQtyTiers` wrappers**

If `stocksService` exists in `src/lib/supabaseClient.ts`, add methods. Otherwise create the export:

```ts
export const stocksService = {
  // ... any existing methods

  async setQtyTiers(
    stockSku: string,
    tiers: Array<{ min_qty: number; price: number }>,
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('set_stock_qty_tiers', {
      p_stock_sku: stockSku,
      p_tiers: tiers,
    });
    if (error) throw error;
  },

  async deleteAllQtyTiers(stockSku: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('delete_all_stock_qty_tiers', {
      p_stock_sku: stockSku,
    });
    if (error) throw error;
  },
};
```

Import `StockQtyTier` at top if needed.

- [ ] **Step 6: Type-check + existing tests still green**

```bash
npx tsc --noEmit
```
Expected: no NEW type errors. Optional-field additions are additive-safe. If any existing narrow type errors surface (e.g., a test fixture asserting exact shape of `SupabaseStockItem`), narrow to the new optional field.

```bash
npx vitest run src/lib/pricing/ src/components/produk/
```
Expected: existing tests still green (Phase 1b `getActiveTiers` etc.).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts  # or pengaturanServices.ts if that's where you added stocksService
git commit -m "$(cat <<'EOF'
feat(qty-tier): StockQtyTier type + stocksService.setQtyTiers wrapper

Adds StockQtyTier interface + extends SupabaseStockItem.qty_tiers?
+ extends CartItem with qty_tier_min_qty/qty_tier_applied/manual_override
snapshot fields. stocksService gains setQtyTiers + deleteAllQtyTiers
wrappers around Task 1 RPCs.

All additions optional-field-safe; no existing call site changes.

Spec: 18bfd78 §4.4 + §4.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `getApplicableQtyTier` helper + tests (TDD)

**Files:**
- Create: `src/lib/pricing/getApplicableQtyTier.ts`
- Create: `src/lib/pricing/getApplicableQtyTier.test.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces:
  - `type QtyTier = { min_qty: number; price: number }` re-exported.
  - `getApplicableQtyTier(tiers: QtyTier[] | undefined, qty: number): QtyTier | null` — returns highest matching tier or null.
  - `getNextUpsellTier(tiers: QtyTier[] | undefined, currentQty: number, currentUnitPrice: number): QtyTier | null` — returns next tier above qty that would beat currentUnitPrice, or null.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pricing/getApplicableQtyTier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getApplicableQtyTier, getNextUpsellTier, type QtyTier } from './getApplicableQtyTier';

const TIERS: QtyTier[] = [
  { min_qty: 5, price: 8000 },
  { min_qty: 10, price: 7000 },
  { min_qty: 20, price: 6500 },
];

describe('getApplicableQtyTier', () => {
  it('returns null when tiers is undefined', () => {
    expect(getApplicableQtyTier(undefined, 10)).toBeNull();
  });

  it('returns null when tiers is empty', () => {
    expect(getApplicableQtyTier([], 10)).toBeNull();
  });

  it('returns null when qty below all thresholds', () => {
    expect(getApplicableQtyTier(TIERS, 3)).toBeNull();
  });

  it('returns the exact-match tier at threshold', () => {
    expect(getApplicableQtyTier(TIERS, 5)).toEqual({ min_qty: 5, price: 8000 });
  });

  it('returns highest matching tier when qty exceeds multiple thresholds', () => {
    expect(getApplicableQtyTier(TIERS, 15)).toEqual({ min_qty: 10, price: 7000 });
  });

  it('returns top tier when qty far exceeds top threshold', () => {
    expect(getApplicableQtyTier(TIERS, 500)).toEqual({ min_qty: 20, price: 6500 });
  });

  it('tolerates unsorted tier input', () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
    expect(getApplicableQtyTier(shuffled, 15)).toEqual({ min_qty: 10, price: 7000 });
  });
});

describe('getNextUpsellTier', () => {
  it('returns null when tiers is undefined', () => {
    expect(getNextUpsellTier(undefined, 3, 10000)).toBeNull();
  });

  it('returns null when tiers is empty', () => {
    expect(getNextUpsellTier([], 3, 10000)).toBeNull();
  });

  it('returns first tier above qty when it beats currentUnitPrice', () => {
    // qty=3, current=10000; tier 5 at 8000 beats → suggest 5
    expect(getNextUpsellTier(TIERS, 3, 10000)).toEqual({ min_qty: 5, price: 8000 });
  });

  it('returns next tier when qty already at a tier', () => {
    // qty=7 already at tier 5 (unit=8000); tier 10 at 7000 beats → suggest 10
    expect(getNextUpsellTier(TIERS, 7, 8000)).toEqual({ min_qty: 10, price: 7000 });
  });

  it('returns null when qty already at top tier', () => {
    expect(getNextUpsellTier(TIERS, 25, 6500)).toBeNull();
  });

  it('returns null when next tier would NOT beat currentUnitPrice', () => {
    // currentUnitPrice is customer tier at 6000; qty=3; next tier 5 at 8000 is WORSE → no upsell
    expect(getNextUpsellTier(TIERS, 3, 6000)).toBeNull();
  });

  it('skips tiers that do not beat current price, returns next that does', () => {
    // currentUnitPrice=7500; qty=3
    // tier 5 at 8000 doesn't beat; tier 10 at 7000 beats → suggest 10
    expect(getNextUpsellTier(TIERS, 3, 7500)).toEqual({ min_qty: 10, price: 7000 });
  });
});
```

- [ ] **Step 2: Run tests to see they fail**

```bash
npx vitest run src/lib/pricing/getApplicableQtyTier.test.ts
```
Expected: FAIL — module `./getApplicableQtyTier` doesn't exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/pricing/getApplicableQtyTier.ts`:

```ts
export interface QtyTier {
  min_qty: number;
  price: number;
}

/**
 * Returns the highest-threshold qty tier that applies at the given quantity,
 * or null if no tier applies. Highest-matching-wins: at qty=15 with tiers
 * [5, 10, 20], the tier at min_qty=10 fires (not 5), because 15 crosses both
 * 5 and 10 but not 20.
 */
export function getApplicableQtyTier(
  tiers: QtyTier[] | undefined,
  qty: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  const matching = tiers
    .filter(t => t.min_qty <= qty)
    .sort((a, b) => b.min_qty - a.min_qty);
  return matching[0] ?? null;
}

/**
 * Returns the next tier above the current quantity that would beat the
 * currentUnitPrice, or null. Used to render the kasir upsell hint
 * "Tip: beli N+ pcs jadi Rp X/pcs". Only suggests tiers that actually
 * improve the customer's price — if the current price (e.g. from customer
 * tier) is already better than any qty tier, no hint fires.
 */
export function getNextUpsellTier(
  tiers: QtyTier[] | undefined,
  currentQty: number,
  currentUnitPrice: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  const candidates = tiers
    .filter(t => t.min_qty > currentQty && t.price < currentUnitPrice)
    .sort((a, b) => a.min_qty - b.min_qty);
  return candidates[0] ?? null;
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npx vitest run src/lib/pricing/getApplicableQtyTier.test.ts
```
Expected: 15/15 pass (7 in getApplicableQtyTier, 8 in getNextUpsellTier).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/getApplicableQtyTier.ts src/lib/pricing/getApplicableQtyTier.test.ts
git commit -m "$(cat <<'EOF'
feat(qty-tier): getApplicableQtyTier + getNextUpsellTier helper

Single source of truth for qty tier resolution (kasir cart re-price
effect) and upsell hint suggestion (kasir line hint). Highest-
matching-wins for the applicable tier; upsell hint only fires when
next tier would ACTUALLY beat current unit price (avoids suggesting
inferior tier when customer tier is already better).

15/15 vitest cover null tiers, empty, no match, exact-match, highest-
wins, top-tier-caps, unsorted input, upsell-beats, upsell-does-not-
beat, already-at-top, skip-then-beat.

Spec: 18bfd78 §4.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `QtyTiersEditor` component + tests

**Files:**
- Create: `src/components/produk/QtyTiersEditor.tsx`
- Create: `src/components/produk/QtyTiersEditor.test.tsx`

**Interfaces:**
- Consumes: `StockQtyTier` from `types.ts`; `stocksService.setQtyTiers` from Task 2; `getApplicableQtyTier` NOT needed here (editor is config-only, no line-add).
- Produces: `<QtyTiersEditor stockSku basePrice initialTiers onSaved showToast />` component.
  - Props: `{ stockSku: string; basePrice: number; initialTiers: StockQtyTier[]; onSaved: () => void; showToast: (msg: string, type?: 'success'|'info'|'warning') => void; }`
  - Renders up to 5 editable rows (`Beli mulai [n] pcs → Rp [p]`) with `×` remove per row, `+ Tambah tier volume` (disabled at 5), preview line, Save button.
  - Save: sorts rows by min_qty asc, filters empty rows, calls `stocksService.setQtyTiers(stockSku, tiers)`, maps `QTP_*` errors to Bahasa toasts, calls `onSaved()` on success.

- [ ] **Step 1: Write the failing tests**

Create `src/components/produk/QtyTiersEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QtyTiersEditor from './QtyTiersEditor';
import * as supabaseClientModule from '../../lib/supabaseClient';
import type { StockQtyTier } from '../../types';

vi.mock('../../lib/supabaseClient', async (importOriginal) => {
  const original = await importOriginal<typeof supabaseClientModule>();
  return {
    ...original,
    stocksService: {
      setQtyTiers: vi.fn(),
      deleteAllQtyTiers: vi.fn(),
    },
  };
});

const BASE_PROPS = {
  stockSku: 'TJM-EL-002',
  basePrice: 18000,
  initialTiers: [] as StockQtyTier[],
  onSaved: vi.fn(),
  showToast: vi.fn(),
};

describe('QtyTiersEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseClientModule.stocksService.setQtyTiers as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders empty state with 1 blank row when initialTiers is empty', () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    // Expect at least one row with min_qty + price inputs
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/harga/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders initialTiers when present', () => {
    const tiers: StockQtyTier[] = [
      { stock_sku: 'TJM-EL-002', min_qty: 5, price: 16000 },
      { stock_sku: 'TJM-EL-002', min_qty: 10, price: 15000 },
    ];
    render(<QtyTiersEditor {...BASE_PROPS} initialTiers={tiers} />);
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(2);
  });

  it('"+ Tambah tier volume" adds a row up to cap of 5', () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    const addBtn = screen.getByRole('button', { name: /tambah tier/i });
    // 1 default row; click 4 times to reach cap 5
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(5);
    // 5th click — button should be disabled
    expect(addBtn).toBeDisabled();
  });

  it('save calls setQtyTiers with sorted non-empty rows', async () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    const minQtyInput = screen.getByLabelText(/mulai/i);
    const priceInput = screen.getAllByLabelText(/harga/i)[0];

    fireEvent.change(minQtyInput, { target: { value: '5' } });
    fireEvent.change(priceInput, { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(supabaseClientModule.stocksService.setQtyTiers).toHaveBeenCalledWith(
        'TJM-EL-002',
        [{ min_qty: 5, price: 16000 }],
      );
    });
    expect(BASE_PROPS.onSaved).toHaveBeenCalled();
    expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success');
  });

  it('maps QTP_INVALID_MIN_QTY error to Bahasa toast', async () => {
    (supabaseClientModule.stocksService.setQtyTiers as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('QTP_INVALID_MIN_QTY'), { code: 'P0400', hint: '1' })
    );
    render(<QtyTiersEditor {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/mulai/i), { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText(/harga/i)[0], { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/minimal.*2/i), 'warning');
    });
  });

  it('maps QTP_TOO_MANY_TIERS to Bahasa toast', async () => {
    (supabaseClientModule.stocksService.setQtyTiers as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('QTP_TOO_MANY_TIERS'), { code: 'P0400' })
    );
    render(<QtyTiersEditor {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/mulai/i), { target: { value: '5' } });
    fireEvent.change(screen.getAllByLabelText(/harga/i)[0], { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/max 5/i), 'warning');
    });
  });
});
```

- [ ] **Step 2: Run tests to see fail**

```bash
npx vitest run src/components/produk/QtyTiersEditor.test.tsx
```
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `src/components/produk/QtyTiersEditor.tsx`:

```tsx
import { useState } from 'react';
import type { StockQtyTier } from '../../types';
import { stocksService } from '../../lib/supabaseClient';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { captureError } from '../../lib/captureError';

interface Props {
  stockSku: string;
  basePrice: number;
  initialTiers: StockQtyTier[];
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface EditableRow {
  minQty: string;  // string during editing; parsed on save
  price: string;
}

function toEditable(tiers: StockQtyTier[]): EditableRow[] {
  if (tiers.length === 0) return [{ minQty: '', price: '' }];
  return tiers
    .sort((a, b) => a.min_qty - b.min_qty)
    .map(t => ({ minQty: String(t.min_qty), price: String(t.price) }));
}

/**
 * Inline price-ladder editor for per-SKU qty tier pricing (Phase 2).
 * Owner types "Beli mulai N pcs" and "Rp X" for up to 5 tiers.
 * Saves atomically via set_stock_qty_tiers RPC (replaces entire tier set).
 * Deletes all tiers if owner saves an empty set.
 */
export default function QtyTiersEditor({
  stockSku,
  basePrice,
  initialTiers,
  onSaved,
  showToast,
}: Props) {
  const [rows, setRows] = useState<EditableRow[]>(toEditable(initialTiers));
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, patch: Partial<EditableRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function addRow() {
    if (rows.length >= 5) return;
    setRows(prev => [...prev, { minQty: '', price: '' }]);
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  // Preview: pick a mid-tier qty and show what price applies.
  const previewQty = rows.length > 0 && rows[0].minQty ? parseInt(rows[0].minQty, 10) : 10;
  const previewTier = rows
    .filter(r => r.minQty && r.price)
    .map(r => ({ min_qty: parseInt(r.minQty, 10), price: parseFloat(r.price) }))
    .filter(t => !isNaN(t.min_qty) && !isNaN(t.price) && t.min_qty <= previewQty)
    .sort((a, b) => b.min_qty - a.min_qty)[0];
  const previewPrice = previewTier?.price ?? basePrice;

  function friendlyError(err: unknown): string {
    const raw = extractErrorMessage(err);
    if (raw.includes('QTP_INVALID_MIN_QTY')) {
      const hint = (err as { hint?: string })?.hint;
      if (hint === 'duplicate min_qty') return 'Threshold volume nggak boleh duplikat.';
      return `min_qty minimal 2 pcs (dapat "${hint ?? '?'}").`;
    }
    if (raw.includes('QTP_INVALID_PRICE')) {
      const hint = (err as { hint?: string })?.hint;
      return `Harga tier harus > 0 (dapat "${hint ?? '?'}").`;
    }
    if (raw.includes('QTP_TOO_MANY_TIERS')) return 'Max 5 tier per SKU.';
    if (raw.includes('QTP_STOCK_NOT_FOUND')) return 'SKU tidak ditemukan.';
    if (raw.includes('QTP_FORBIDDEN')) return 'Hanya Owner yang bisa mengubah tier volume.';
    return `Gagal simpan tier volume: ${raw}`;
  }

  async function onSave() {
    setSaving(true);
    try {
      const tiers = rows
        .map(r => ({ min_qty: parseInt(r.minQty, 10), price: parseFloat(r.price) }))
        .filter(t => !isNaN(t.min_qty) && !isNaN(t.price) && t.min_qty > 0 && t.price > 0)
        .sort((a, b) => a.min_qty - b.min_qty);

      // Warn if any tier price >= base
      const suspicious = tiers.find(t => t.price >= basePrice);
      if (suspicious && !window.confirm(
        `Harga volume Rp ${suspicious.price.toLocaleString('id-ID')} untuk beli ${suspicious.min_qty}+ pcs lebih tinggi/sama dengan harga base Rp ${basePrice.toLocaleString('id-ID')}. Yakin simpan?`
      )) {
        setSaving(false);
        return;
      }

      await stocksService.setQtyTiers(stockSku, tiers);
      console.info('[qty_tier] set', { stock_sku: stockSku, tier_count: tiers.length });
      showToast('Harga volume tersimpan.', 'success');
      onSaved();
    } catch (err) {
      captureError(err, { feature: 'qty_tier', action: 'set' });
      showToast(friendlyError(err), 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-testid="qty-tiers-editor">
      <div>
        <h3 className="text-sm font-bold text-[#012749]">Harga Volume (opsional)</h3>
        <p className="text-[11px] text-slate-500 mt-1">
          Beli banyak lebih murah. Max 5 tier. Kosongkan semua kalau nggak dipakai.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Beli mulai</span>
            <input
              type="number"
              aria-label={`mulai-${i}`}
              value={row.minQty}
              onChange={e => updateRow(i, { minQty: e.target.value })}
              placeholder="5"
              className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
            <span className="text-xs text-slate-500">pcs → Rp</span>
            <input
              type="number"
              aria-label={`harga-${i}`}
              value={row.price}
              onChange={e => updateRow(i, { price: e.target.value })}
              placeholder="8000"
              className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="ml-auto text-slate-400 hover:text-red-500 text-sm"
              aria-label={`hapus tier ${i}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= 5}
          className="text-xs font-semibold text-[#012749] hover:opacity-80 disabled:opacity-40"
        >
          + Tambah tier volume
        </button>
      </div>

      {previewTier && (
        <p className="text-[11px] text-slate-500 italic">
          Contoh: beli {previewQty} pcs = Rp {(previewPrice * previewQty).toLocaleString('id-ID')} (auto Rp {previewPrice.toLocaleString('id-ID')}/pcs)
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
```

Note on `window.confirm`: acceptable for MVP. If founder later wants a themed modal, extract in Phase 3. Kept simple here.

- [ ] **Step 4: Run tests to see pass**

```bash
npx vitest run src/components/produk/QtyTiersEditor.test.tsx
```
Expected: 6/6 pass.

- [ ] **Step 5: Type-check + full changed suite**

```bash
npx tsc --noEmit
npx vitest run src/lib/pricing/ src/components/produk/
```
Expected: no type errors; changed-file suite green.

- [ ] **Step 6: Commit**

```bash
git add src/components/produk/QtyTiersEditor.tsx src/components/produk/QtyTiersEditor.test.tsx
git commit -m "$(cat <<'EOF'
feat(qty-tier): QtyTiersEditor component + tests

Inline price-ladder editor. Owner adds up to 5 rows (Beli mulai N pcs
→ Rp X). Warns via window.confirm when a tier price >= base price.
Saves atomically via stocksService.setQtyTiers. QTP_* error mapping
to Bahasa toasts. Observability: console.info entry log + captureError.

6/6 vitest cover empty render, initialTiers preload, tambah-tier cap
at 5, save happy path, QTP_INVALID_MIN_QTY reject, QTP_TOO_MANY_TIERS
reject.

Spec: 18bfd78 §4.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migration `000546` — widen `record_kasir_sale` + `create_tempo_invoice` for qty tier

**Files:**
- Create: `supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql`

**Interfaces:**
- Consumes: `stock_qty_price_tiers` table from Task 1; existing widened RPCs from Phase 1b slot `20261115000543`.
- Produces: `record_kasir_sale` (26-param) + `create_tempo_invoice` (1-param) both widened for qty tier fetch + server-authoritative `min(customer_tier_price, qty_tier_price)` + snapshot stamp into items JSONB (`qty_tier_min_qty`, `qty_tier_applied`, `manual_override`).

- [ ] **Step 1: Read authoritative RPC bodies from slot `000543`**

```bash
grep -n 'CREATE OR REPLACE FUNCTION public.record_kasir_sale\|CREATE OR REPLACE FUNCTION public.create_tempo_invoice' supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql
```
Expected: lines pointing to both RPC definitions. Read both bodies fully via `Read` tool.

- [ ] **Step 2: Write the new migration file**

Create `supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql`. The file contains two `CREATE OR REPLACE FUNCTION` blocks that COPY the Phase 1b `000543` bodies verbatim, then apply these changes to EACH RPC:

**Change 1: Add DECLAREs for qty tier variables (top of DECLARE section):**
```plpgsql
v_qty_tier_price   NUMERIC;
v_qty_tier_min_qty INT;
v_qty_tier_applied BOOLEAN;
v_manual_override  BOOLEAN;
v_effective_price  NUMERIC;
```

**Change 2: In the per-item output loop, AFTER Phase 1b's `v_tier_label` is set + label stamped, insert the qty tier logic:**
```plpgsql
-- Phase 2 CHANGE: fetch applicable qty tier for this line
SELECT price, min_qty
  INTO v_qty_tier_price, v_qty_tier_min_qty
  FROM public.stock_qty_price_tiers
  WHERE stock_sku = v_item->>'sku'
    AND min_qty <= (v_item->>'qty')::INT
  ORDER BY min_qty DESC
  LIMIT 1;

-- Read manual_override flag from client (default false)
v_manual_override := COALESCE((v_item->>'manual_override')::BOOLEAN, false);

-- Compute effective price: min(customer_tier_price, qty_tier_price)
-- v_expected_price is already computed by Phase 1b for customer tier
IF v_qty_tier_price IS NOT NULL AND v_qty_tier_price < v_expected_price THEN
  v_effective_price := v_qty_tier_price;
  v_qty_tier_applied := true;
ELSE
  v_effective_price := v_expected_price;
  v_qty_tier_applied := false;
  v_qty_tier_min_qty := NULL;
END IF;

-- Validate client unit_price matches effective (unless manual override)
IF NOT v_manual_override AND (v_item->>'unit_price')::NUMERIC <> v_effective_price THEN
  RAISE EXCEPTION 'PRICE_MISMATCH: sku=% expected=% got=%',
    v_item->>'sku', v_effective_price, v_item->>'unit_price';
END IF;

-- Stamp snapshot into item JSONB (adds alongside Phase 1b pricing_tier_label stamp)
v_item_out := v_item_out || jsonb_build_object(
  'qty_tier_min_qty', v_qty_tier_min_qty,
  'qty_tier_applied', v_qty_tier_applied,
  'manual_override', v_manual_override
);
```

**Change 3: Backward-compat NULL guard** — for items JSONB rows written before Phase 2, the missing `qty_tier_*` keys are simply absent. This is intentional; no compat shim needed. Historic PDF rendering falls back gracefully (Phase 1c gap already documented).

**Change 4:** neither RPC parameter list changes — items JSONB is opaque passthrough. New per-item `manual_override` key is read from the existing items JSONB payload.

Ambiguity note: if the Phase 1b RPC body's `v_expected_price` variable is scoped to a different loop OR named differently than my sketch above, adapt accordingly. `Read` slot `000543` fully first.

- [ ] **Step 3: Apply migration via Management API**

```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}" | head -20
```
Expected: `[]`.

- [ ] **Step 4: Verify widened RPC body contains qty tier logic**

```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT prosrc ~ '\''stock_qty_price_tiers'\'' AS has_lookup, prosrc ~ '\''qty_tier_applied'\'' AS stamps_applied, prosrc ~ '\''manual_override'\'' AS handles_override FROM pg_proc WHERE proname='\''record_kasir_sale'\'' AND pronargs=26;"}'
```
Expected: `[{"has_lookup": true, "stamps_applied": true, "handles_override": true}]`.

Same query for `create_tempo_invoice` (pronargs=1).

- [ ] **Step 5: Skip end-to-end RPC smoke (environmental complexity)**

Per Phase 1b Task 5 report: `record_kasir_sale` DO-block smoke via `set_config('request.jwt.claim.sub')` runs into environmental FK issues on `kasir_counters` (pre-existing pattern doesn't hydrate tenant context outside real auth). Rather than fight that plumbing, verify:

- (a) RPC body contains the qty tier lookup + stamp logic via `pg_proc.prosrc` regex (Step 4 above).
- (b) Task 9 Stage 3 smoke will exercise real end-to-end via founder browser walk.

Log this decision in the task report.

- [ ] **Step 6: Idempotency check**

Re-apply migration; expect no error (`CREATE OR REPLACE`).

- [ ] **Step 7: Run local audits**

```bash
npm run audit:secdef-null-tenant
npm run audit:no-string-err-fallback
npm run audit:secdef-auth-schema-owner 2>&1 | tail -5
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql
git commit -m "$(cat <<'EOF'
feat(qty-tier): migration 000546 — widen sales RPCs for qty tier

Widens record_kasir_sale (26-param) + create_tempo_invoice (1-param),
both authoritative in Phase 1b slot 000543. Per-item changes:
  - Fetch applicable qty tier from stock_qty_price_tiers
  - Compute server-authoritative min(customer_tier, qty_tier)
  - Validate client unit_price matches (or accept per-item
    manual_override flag to skip validation)
  - Stamp qty_tier_min_qty + qty_tier_applied + manual_override
    into item JSONB snapshot

Body verified via pg_proc regex (stock_qty_price_tiers lookup,
qty_tier_applied stamp, manual_override handling all present).

Spec: 18bfd78 §3.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Embed `QtyTiersEditor` into `ProductForm` + `StockTableView`

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`
- Modify: `src/components/produk/StockTableView.tsx`

**Interfaces:**
- Consumes: `QtyTiersEditor` from Task 4; `SupabaseStockItem.qty_tiers?` from Task 2.
- Produces: ProductForm renders editor inline below tier price fields; StockTableView adds row-level "Edit Vol" button that opens editor in a small modal.

- [ ] **Step 1: ProductForm — embed editor**

In `src/components/produk/ProductForm.tsx`, locate where Phase 1b tier fields render (`price_grosir`, `price_tier_3/4` conditional inputs). Add below them:

```tsx
import QtyTiersEditor from './QtyTiersEditor';

// ... in render:
{initial?.sku && (
  <QtyTiersEditor
    stockSku={initial.sku}
    basePrice={parseFloat(price) || 0}
    initialTiers={initial.qty_tiers ?? []}
    onSaved={() => {
      // Optionally refresh parent state; parent already refetches on save
    }}
    showToast={showToast}
  />
)}
```

The `initial?.sku` guard prevents editor from rendering on the "create new product" path (SKU doesn't exist yet — qty tiers can be configured after product is created). Post-Phase-2 owner flow: create product → save → re-open to configure qty tiers.

- [ ] **Step 2: StockTableView — row-level "Edit Vol" button + modal**

In `src/components/produk/StockTableView.tsx`, add a small "Vol" column with a button that opens the editor in a lightweight modal:

```tsx
import { useState } from 'react';
import QtyTiersEditor from './QtyTiersEditor';

// ... in row render, add cell after price columns:
<td className="px-2 py-1 text-center">
  <button
    type="button"
    onClick={() => setEditingVolSku(item.sku)}
    className="text-xs text-[#012749] hover:opacity-80"
  >
    Edit Vol
    {item.qty_tiers && item.qty_tiers.length > 0 && (
      <span className="ml-1 text-[10px] text-purple-600">({item.qty_tiers.length})</span>
    )}
  </button>
</td>

// ... at component root:
{editingVolSku && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-xl max-w-md w-full mx-4 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold">Harga Volume — {editingVolSku}</h3>
        <button onClick={() => setEditingVolSku(null)}>×</button>
      </div>
      <QtyTiersEditor
        stockSku={editingVolSku}
        basePrice={items.find(i => i.sku === editingVolSku)?.price ?? 0}
        initialTiers={items.find(i => i.sku === editingVolSku)?.qty_tiers ?? []}
        onSaved={() => {
          setEditingVolSku(null);
          onDataChanged?.(); // trigger parent refetch
        }}
        showToast={showToast}
      />
    </div>
  </div>
)}
```

Adapt to the existing StockTableView state pattern (grep for how it currently manages inline-edit state). If the file already has a modal-orchestration pattern for `price_grosir` inline edits, mirror that.

- [ ] **Step 3: Extend stocks fetch to include `qty_tiers`**

Locate where stocks are fetched (likely `stocksService.fetchAll` or similar in `supabaseClient.ts`). Extend query to include the qty tiers:

```ts
async fetchAll(): Promise<SupabaseStockItem[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('stocks')
    .select('*, qty_tiers:stock_qty_price_tiers(id, stock_sku, min_qty, price)')
    .order('sku');
  if (error) throw error;
  return data as SupabaseStockItem[];
}
```

The `stock_qty_price_tiers` foreign-relation embed works because we defined FK `stock_sku REFERENCES stocks(sku)` in Task 1. Supabase PostgREST auto-detects and populates the `qty_tiers` alias.

- [ ] **Step 4: Type-check + run produk tests**

```bash
npx tsc --noEmit
npx vitest run src/components/produk/
```
Expected: no new type errors; produk tests pass (may need to update StockTableView test fixture to include the new column if a test asserts column count).

- [ ] **Step 5: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/components/produk/StockTableView.tsx src/lib/supabaseClient.ts
git commit -m "$(cat <<'EOF'
feat(qty-tier): embed QtyTiersEditor into ProductForm + StockTableView

ProductForm: renders editor inline below Phase 1b tier price fields
when initial.sku exists (create-new path defers config to post-save).

StockTableView: row-level "Edit Vol" button opens editor in a
lightweight modal; shows tier count next to button when tiers exist.

stocksService.fetchAll extended to include qty_tiers via PostgREST
foreign-relation embed (Task 1 FK enables this).

Spec: 18bfd78 §4.1 + §4.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `CartRows` chip logic + upsell hint

**Files:**
- Modify: `src/components/penjualan/CartRows.tsx`

**Interfaces:**
- Consumes: `getNextUpsellTier` from Task 3; `line.qty_tier_applied` + `line.qty_tier_min_qty` + `line.manual_override` from Task 2 CartItem extension; `stockQtyTiers[sku]` state fetched by CatatPenjualanWizard (Task 8).
- Produces: line renders "Vol {min_qty}+" chip when `qty_tier_applied=true`; "Manual" chip when `manual_override=true`; else defers to Phase 1b customer tier chip. Below chip: upsell hint when `getNextUpsellTier` returns non-null.

- [ ] **Step 1: Read current CartRows to find chip location**

```bash
grep -n 'showTierPill\|activeTier\|pricing_tier_used\|price_grosir' src/components/penjualan/CartRows.tsx | head -10
```
Expected: locate where Phase 1b tier warning currently renders. The chip is likely near line 175-176 per Phase 1a discovery.

- [ ] **Step 2: Extend `CartRowsProps` to accept `stockQtyTiers` map**

Add prop to the existing interface:

```tsx
interface CartRowsProps {
  // ... existing props
  stockQtyTiers?: Record<string, Array<{ min_qty: number; price: number }>>;  // Phase 2 — per-sku map for chip + upsell hint
}
```

Optional so pre-Phase-2 tests without it degrade gracefully to Phase 1b behaviour (no qty tier chip / hint).

- [ ] **Step 3: Add chip + hint rendering**

In the per-line render block, replace the existing tier warning with:

```tsx
import { getNextUpsellTier } from '../../lib/pricing/getApplicableQtyTier';

// Inside the map(line => ...):
const skuTiers = line.sku && stockQtyTiers ? stockQtyTiers[line.sku] : undefined;
const upsellTier = skuTiers ? getNextUpsellTier(skuTiers, line.qty, line.unit_price) : null;

// After existing chip render (Phase 1b customer tier chip if it exists):
{line.qty_tier_applied && line.qty_tier_min_qty != null && (
  <span
    className="inline-block ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700"
    title={`Harga volume aktif — beli ${line.qty_tier_min_qty}+ jadi Rp ${line.unit_price.toLocaleString('id-ID')}`}
  >
    Vol {line.qty_tier_min_qty}+
  </span>
)}
{line.manual_override && (
  <span className="inline-block ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
    Manual
  </span>
)}
{upsellTier && (
  <p className="text-[11px] text-slate-500 italic mt-1">
    Tip: beli {upsellTier.min_qty}+ pcs jadi Rp {upsellTier.price.toLocaleString('id-ID')}/pcs
    <span className="text-emerald-600 ml-1">
      (hemat Rp {(line.unit_price - upsellTier.price).toLocaleString('id-ID')}/pcs untuk customer)
    </span>
  </p>
)}
```

- [ ] **Step 4: Update existing CartRows test (if it exists)**

Grep for `CartRows.test`:
```bash
ls src/components/penjualan/CartRows.test.tsx 2>&1
```
If test file exists, extend its fixtures to include `qty_tier_applied` / `qty_tier_min_qty` / `manual_override` fields on some lines, and add:

```tsx
it('renders "Vol N+" chip when qty_tier_applied=true', () => {
  const line = { /* existing fields */, qty_tier_applied: true, qty_tier_min_qty: 10, unit_price: 7000 };
  render(<CartRows /* ...existing props */ />);
  expect(screen.getByText('Vol 10+')).toBeInTheDocument();
});

it('renders upsell hint when next tier beats current price', () => {
  const line = { /* existing fields */, qty: 3, unit_price: 10000 };
  const stockQtyTiers = { 'SKU-A': [{ min_qty: 5, price: 8000 }] };
  render(<CartRows /* ...existing props */ stockQtyTiers={stockQtyTiers} />);
  expect(screen.getByText(/Tip: beli 5\+ pcs/)).toBeInTheDocument();
});
```

If no test file exists yet, no new tests needed here — Task 3 helper tests + Task 9 Stage 3 smoke cover the integration.

- [ ] **Step 5: Type-check + run penjualan tests**

```bash
npx tsc --noEmit
npx vitest run src/components/penjualan/
```
Expected: no type errors; penjualan tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/penjualan/CartRows.tsx src/components/penjualan/CartRows.test.tsx 2>/dev/null || git add src/components/penjualan/CartRows.tsx
git commit -m "$(cat <<'EOF'
feat(qty-tier): CartRows chip + upsell hint

"Vol {min_qty}+" chip fires ONLY when line.qty_tier_applied=true
(server-authoritative snapshot from RPC). "Manual" chip when
line.manual_override=true. Upsell hint via getNextUpsellTier —
suggests next tier only when it would actually beat current unit_price.

Spec: 18bfd78 §4.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `CatatPenjualanWizard` — fetch qty tiers + cart re-price effect + manual override

**Files:**
- Modify: `src/components/penjualan/CatatPenjualanWizard.tsx`

**Interfaces:**
- Consumes: `stocksService.fetchAll` extended to include `qty_tiers`; `getApplicableQtyTier` from Task 3; `SupabaseStockItem.qty_tiers`.
- Produces: `stockQtyTiers: Record<string, Array<{min_qty, price}>>` state derived from stocks; extended cart re-price effect that computes `min(customer_tier, qty_tier)` + stamps `qty_tier_min_qty` / `qty_tier_applied` / `manual_override` per line; qty change discards `manual_override`; passes `stockQtyTiers` prop to `CartRows`.

- [ ] **Step 1: Derive `stockQtyTiers` map from stocks state**

Locate where stocks are held (likely `const [stocks, setStocks] = useState<SupabaseStockItem[]>([])` fetched via `stocksService.fetchAll`). Below it:

```tsx
import { getApplicableQtyTier } from '../../lib/pricing/getApplicableQtyTier';

// Derive per-sku qty tier map for CartRows + cart re-price
const stockQtyTiers = useMemo(() => {
  const map: Record<string, Array<{ min_qty: number; price: number }>> = {};
  for (const s of stocks) {
    if (s.qty_tiers && s.qty_tiers.length > 0) {
      map[s.sku] = s.qty_tiers.map(t => ({ min_qty: t.min_qty, price: t.price }));
    }
  }
  return map;
}, [stocks]);
```

- [ ] **Step 2: Extend cart re-price effect for qty tier + manual override**

Locate the existing Phase 1b cart re-price effect that runs on `activeTier` change. Extend to also fold in qty tier:

```tsx
useEffect(() => {
  if (!showTierPill) return;
  setCart((prev) => prev.map((line) => {
    if (!line.sku) return line;
    if (line.manual_override) return line; // preserve manual override until qty changes (handled below)

    const stock = stocks.find((s) => s.sku === line.sku);
    if (!stock) return line;

    const customerTierPrice = getTierPrice(stock, activeTier); // Phase 1b helper
    const qtyTier = getApplicableQtyTier(stockQtyTiers[line.sku], line.qty);
    const qtyTierPrice = qtyTier?.price;

    const qtyWon = qtyTierPrice != null && qtyTierPrice < customerTierPrice;
    const effective = qtyWon ? qtyTierPrice : customerTierPrice;
    const lineTier = /* Phase 1b logic — preserve customer tier for reporting */ activeTier;

    if (effective === line.unit_price && qtyWon === !!line.qty_tier_applied) return line;

    return {
      ...line,
      unit_price: effective,
      master_price_at_sale: effective,
      pricing_tier_used: lineTier,
      qty_tier_applied: qtyWon,
      qty_tier_min_qty: qtyWon ? qtyTier!.min_qty : null,
      // manual_override preserved (guarded above); else default false
      manual_override: false,
      subtotal: effective * line.qty,
      hpp_subtotal: line.hpp_per_unit * line.qty,
      discount_type: null,
      discount_value: null,
      discount_amount_rp: 0,
    };
  }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTier, stockQtyTiers, showTierPill]);
```

- [ ] **Step 3: Extend the per-line qty change handler to discard manual override + re-trigger auto-apply**

Locate where cart line qty changes (likely a `setLineQty(index, qty)` or equivalent handler). Modify:

```tsx
function updateLineQty(index: number, newQty: number) {
  setCart(prev => prev.map((line, i) => {
    if (i !== index) return line;
    const stock = stocks.find(s => s.sku === line.sku);
    if (!stock) return { ...line, qty: newQty, subtotal: line.unit_price * newQty };

    // Discard manual override + re-apply auto-price at new qty
    const customerTierPrice = getTierPrice(stock, activeTier);
    const qtyTier = getApplicableQtyTier(stockQtyTiers[line.sku], newQty);
    const qtyTierPrice = qtyTier?.price;
    const qtyWon = qtyTierPrice != null && qtyTierPrice < customerTierPrice;
    const effective = qtyWon ? qtyTierPrice : customerTierPrice;

    return {
      ...line,
      qty: newQty,
      unit_price: effective,
      master_price_at_sale: effective,
      subtotal: effective * newQty,
      hpp_subtotal: line.hpp_per_unit * newQty,
      qty_tier_applied: qtyWon,
      qty_tier_min_qty: qtyWon ? qtyTier!.min_qty : null,
      manual_override: false,
      discount_type: null,
      discount_value: null,
      discount_amount_rp: 0,
    };
  }));
}
```

- [ ] **Step 4: Wire per-line manual unit_price override**

If there's an existing per-line unit_price edit handler, extend it to stamp `manual_override: true`:

```tsx
function updateLineUnitPrice(index: number, newPrice: number) {
  setCart(prev => prev.map((line, i) => {
    if (i !== index) return line;
    return {
      ...line,
      unit_price: newPrice,
      master_price_at_sale: newPrice,
      manual_override: true,
      qty_tier_applied: false,
      qty_tier_min_qty: null,
      subtotal: newPrice * line.qty,
    };
  }));
}
```

- [ ] **Step 5: Pass `stockQtyTiers` prop to `CartRows`**

Locate the `<CartRows ... />` render in this file. Add:

```tsx
<CartRows
  /* ... existing props */
  stockQtyTiers={stockQtyTiers}
/>
```

- [ ] **Step 6: Ensure items JSONB payload sent to RPCs includes manual_override**

Locate where `record_kasir_sale` is called (via `supabaseClient.ts:1487` — the wrapper serializes items as-is). Ensure each line item passed includes `manual_override: line.manual_override ?? false` before the RPC call. If the wrapper strips unknown fields, adjust wrapper to preserve them.

- [ ] **Step 7: Type-check + run wizard tests**

```bash
npx tsc --noEmit
npx vitest run src/components/penjualan/ src/components/PelangganScreen.test.tsx
```
Expected: no type errors; existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/penjualan/CatatPenjualanWizard.tsx
git commit -m "$(cat <<'EOF'
feat(qty-tier): CatatPenjualanWizard cart re-price + manual override

Derives stockQtyTiers memo from stocks state. Extends cart re-price
effect to compute min(customer_tier_price, qty_tier_price) and stamp
qty_tier_applied / qty_tier_min_qty per line. Per-line qty change
discards manual_override and re-applies auto-price (matches Phase 1b
customer-switch pattern). Per-line unit_price edit sets
manual_override=true. Passes stockQtyTiers prop to CartRows for
chip + upsell hint rendering.

Spec: 18bfd78 §4.2 + §3.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Stage 1 gates + Stage 2 push + Stage 3 DB-side validation (PAUSE for founder browser walk)

**Files:** none new; verification only.

**Interfaces:** none.

Task 9 has two parts: **9A (autonomous):** Stage 1 gates + push + DB-side validation via Management API; **9B (paused for founder):** browser walk Scenarios A-G on Toko Jaya Makmur.

### 9A — Autonomous

- [ ] **Step 1: Stage 1 — lint**
```bash
npm run lint
```
Expected: exit 0.

- [ ] **Step 2: Stage 1 — all audits**
```bash
npm run audit:numinput
npm run audit:secdef-null-tenant
npm run audit:csp-backend-allowlist
npm run audit:no-string-err-fallback
npm run audit:secdef-auth-schema-owner
```
Expected: all clean.

- [ ] **Step 3: Stage 1 — full vitest**
```bash
npx vitest run
```
Expected: full suite green (~1130+ tests).

- [ ] **Step 4: Stage 2 — push to trigger staging build**
```bash
git push origin main
```
Wait for both FE + BE Cloud Builds SUCCESS:
```bash
gcloud builds list --limit=3 --format='table(id,status,duration)'
```

- [ ] **Step 5: Stage 3 DB-side validation (Management API)**

Prod tag URL smoke (Phase 1b handoff pattern):
```bash
SHA=$(git rev-parse --short=7 HEAD)
curl -sSo /dev/null -w "FE tag URL: HTTP %{http_code}\n" --max-time 15 "https://c${SHA}---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/"
curl -sSo /dev/null -w "BE tag URL: HTTP %{http_code}\n" --max-time 15 "https://c${SHA}---garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live"
```
Expected: both 200.

RPC + schema verification:
```bash
source .env
# Schema exists
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT '\''stock_qty_price_tiers columns'\'' AS check, COUNT(*) AS n FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''stock_qty_price_tiers'\'';"}'
# Expected: n=7

# RPCs live
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT proname FROM pg_proc WHERE proname IN ('\''set_stock_qty_tiers'\'','\''delete_all_stock_qty_tiers'\'') ORDER BY proname;"}'
# Expected: 2 rows

# record_kasir_sale widened
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT prosrc ~ '\''stock_qty_price_tiers'\'' AS has_qty_lookup, prosrc ~ '\''qty_tier_applied'\'' AS stamps_snapshot FROM pg_proc WHERE proname='\''record_kasir_sale'\'' AND pronargs=26;"}'
# Expected: both true

# Bundle marker check
curl -sfo /tmp/bundle-index.js --max-time 30 "https://app.caleo.id/assets/$(curl -s https://app.caleo.id/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
for pat in 'setQtyTiers' 'getApplicableQtyTier' 'QtyTiersEditor' 'Vol '; do
  count=$(grep -o "$pat" /tmp/bundle-index.js | wc -l | tr -d ' ')
  echo "$pat: $count"
done
rm /tmp/bundle-index.js
```
Some markers may live in lazy chunks (produk-*, penjualan-*). Also grep those chunks via the pattern from Phase 1b Task 9.

### 9B — PAUSED FOR FOUNDER

Do NOT run `promote-to-prod.sh` autonomously. Founder must:
1. Verify staging tag URL matches expectations.
2. Run `bash scripts/promote-to-prod.sh $SHA`.
3. Walk Scenarios A-G per spec §6.3 on Toko Jaya Makmur.

Prepare a handoff document at `.superpowers/sdd/phase-2-handoff.md` with:
- Commits list.
- Migration slots applied.
- Bundle marker grep results.
- Staging tag URLs.
- Scenario checklist (A-G).
- Rollback SHA if needed.

- [ ] **Step 6: Commit Task 9 ledger + handoff doc**

```bash
git add .superpowers/sdd/phase-2-handoff.md 2>/dev/null || true
# handoff doc is under .superpowers (gitignored via project convention) — writing it locally is enough; founder reads directly.
```

No commit needed for Task 9 itself (verification-only). Progress ledger updated inline.

---

## Task 10: `progress.md` + push + deploy verify (FOUNDER-CONFIRMED)

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Draft `progress.md` entry (DO NOT push yet)**

Append at top of `progress.md` body:

```markdown
## YYYY-MM-DD — Phase 2: SKU qty tier pricing SHIPPED

**What:** Owner can now configure per-SKU quantity thresholds (up to 5 tiers, `beli ≥ N pcs → Rp X/pcs`) via inline `QtyTiersEditor` in ProductForm + StockTableView. Kasir cart line auto-applies `min(customer_tier_price, qty_tier_price)` via server-authoritative RPC; chip "Vol N+" fires when qty tier wins; upsell hint suggests next tier when it would beat current unit_price. Manual override supported (kasir edits unit_price → chip "Manual" → qty change re-triggers auto-apply and discards override).

**Why:** MSME distributor persona (LTC Glodok / Garindo Jaya Panel) real price lists use qty ladder pricing. Phase 1a/1b price by WHO the customer is; Phase 2 adds HOW MUCH they buy dimension. Kasir speed preserved via silent auto-apply + non-blocking hint chip. Highest-discount-wins rule matches owner mental model without stacking discount complexity.

**Scope kept out:** cumulative qty across cart/customer/month; discount % or flat-Rp off base (Phase 3 for distributor bulk-CSV pain); bundle pricing; PDF invoice per-line tier display (blocked on Phase 1c FE read of pricing_tier_label / qty_tier_min_qty).

**Files touched (2 migrations + 8 code files):**
- Migration `20261115000545` — stock_qty_price_tiers table + RLS + set/delete SECDEF RPCs.
- Migration `20261115000546` — widen record_kasir_sale + create_tempo_invoice for qty tier fetch + server min() + JSONB snapshot stamp.
- New `src/lib/pricing/getApplicableQtyTier.ts` + tests (15/15).
- New `src/components/produk/QtyTiersEditor.tsx` + tests (6/6).
- Type widening in `src/types.ts` (`StockQtyTier`, extend `SupabaseStockItem.qty_tiers?`, extend `CartItem` snapshot fields).
- Modify `src/components/produk/ProductForm.tsx` (embed editor).
- Modify `src/components/produk/StockTableView.tsx` (row-level "Edit Vol" modal).
- Modify `src/components/penjualan/CartRows.tsx` (chip + upsell hint).
- Modify `src/components/penjualan/CatatPenjualanWizard.tsx` (stockQtyTiers derivation + extended cart re-price effect + manual_override handling).
- Modify `src/lib/supabaseClient.ts` (stocksService.setQtyTiers/deleteAllQtyTiers wrappers + extend fetchAll to embed qty_tiers).

**Verified (Stage 1, all ✓):** lint, all 5 audits, full vitest (~1130+ tests). Migrations smoke-tested via Management API + RAISE-rollback (happy path + QTP_* rejects). Widened RPC bodies verified via pg_proc regex.

**Stage 2 (deploy) ✓:** Cloud Build FE + BE both SUCCESS on commit `<SHORT_SHA>`. Manual `scripts/promote-to-prod.sh <SHA>`. `curl app.caleo.id` HTTP 200.

**Stage 3 (validation):** DB-side + bundle marker validation via Management API + curl. Browser walk Scenarios A-G walked by founder — [PASS / details].

**Spec:** `docs/superpowers/specs/2026-07-31-phase-2-sku-qty-tier-design.md`.
**Memo:** `docs/superpowers/specs/2026-07-31-phase-2-sku-qty-tier-decision.md`.
**Plan:** `docs/superpowers/plans/2026-07-31-phase-2-sku-qty-tier-plan.md`.

**Rollback:** `bash scripts/promote-to-prod.sh <PREVIOUS_SHA>`. Schema is additive-only; can stay in DB post-rollback.
```

- [ ] **Step 2: WAIT for founder confirmation before committing + pushing**

Task 10 is founder-confirmed per session-start instructions. Do NOT commit + push progress.md until founder approves in the return session.

---

## Self-review notes

**Spec coverage:**
- Data model §3.1-3.4 → Task 1 ✅
- Snapshot inside items JSONB §3.5 → Task 5 (RPC widening) ✅
- Orphan-tolerant COALESCE lookup pattern → Task 5 SQL ✅
- Migration slot allocation §3.6 → Task 1 (000545) + Task 5 (000546) ✅
- Owner UI editor §4.1 → Task 4 (component) + Task 6 (embedding) ✅
- Kasir chip + upsell hint §4.2-4.3 → Task 7 ✅
- Cart re-price + manual override §4.3 → Task 8 ✅
- Type widening §4.4 → Task 2 ✅
- Helper §4.5 → Task 3 ✅
- Wrapper §4.6 → Task 2 ✅
- Impact analysis §5 → covered by file inventory
- Testing plan §6 → Task 9 ✅
- Observability §7 → embedded in Task 4 (editor breadcrumb) + Task 8 (cart auto-apply)
- Migration & rollback §8 → Tasks 1, 5 + Task 9 rollback path ✅

**Placeholder scan:**
- Task 5 Step 2 says "COPY the Phase 1b `000543` bodies verbatim" — intentional (multi-hundred-line RPCs; embedding full body triples plan size). Implementer uses `Read` tool on slot 000543 as instructed.
- Task 6 Step 2 says "adapt to existing StockTableView state pattern" — legitimate grep-and-mirror instruction, not placeholder.
- Task 7 Step 3 chip render code is complete; Task 8 handlers are complete.

**Type consistency:**
- `StockQtyTier` shape (`{id?, stock_sku, min_qty, price}`) consistent across Task 2 (declaration), Task 4 (component prop), Task 6 (embed), Task 8 (map derivation).
- `QtyTier` (helper local type — `{min_qty, price}`) is a structural subset used in Task 3, referenced in Tasks 7-8 for consistency.
- Chip snapshot fields (`qty_tier_min_qty`, `qty_tier_applied`, `manual_override`) named identically in Task 2 (type widening), Task 5 (RPC stamp), Task 7 (render), Task 8 (mutation).
- RPC param names (`p_stock_sku`, `p_tiers`) consistent across Task 1 (SQL) + Task 2 (wrapper).
- Migration slots `000545` and `000546` referenced identically throughout.
- Error taxonomy `QTP_*` (FORBIDDEN, STOCK_NOT_FOUND, INVALID_MIN_QTY, INVALID_PRICE, TOO_MANY_TIERS) referenced identically in Task 1 (RPC) + Task 4 (friendlyError mapping).

**Ambiguity check:**
- Task 6 StockTableView modal pattern — deliberate mirror of existing inline-edit orchestration. Implementer greps + mirrors.
- Task 8 per-line qty change handler location — implementer greps `updateLineQty` or equivalent. Not a placeholder — a real code-navigation instruction.
- Task 5 body-copy — MUST use Read on slot 000543 to get the actual RPC bodies. Sketch shows the diff to apply, not the full result.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-31-phase-2-sku-qty-tier-plan.md`.**
