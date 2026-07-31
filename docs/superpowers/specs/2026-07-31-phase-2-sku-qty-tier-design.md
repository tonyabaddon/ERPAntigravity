# Phase 2 — SKU Qty Tier Pricing (Design Spec)

**Date:** 2026-07-31
**Author:** Claude (paired with founder via `superpowers:brainstorming`)
**Status:** Design approved by founder; corrected after advisor consultation. Awaiting spec review before writing-plans.
**Companion memo:** [`2026-07-31-phase-2-sku-qty-tier-decision.md`](2026-07-31-phase-2-sku-qty-tier-decision.md)
**Prior phases:** Phase 1a [`2026-07-24-customer-pricing-tier-add-form-fix-design.md`](2026-07-24-customer-pricing-tier-add-form-fix-design.md) · Phase 1b [`2026-07-28-phase-1b-tier-config-design.md`](2026-07-28-phase-1b-tier-config-design.md).

---

## 1. Goal

Enable owner to configure per-SKU quantity thresholds (e.g., `beli ≥ 5 pcs → Rp 8.000/pcs`, `beli ≥ 10 pcs → Rp 7.000`, `beli ≥ 20 pcs → Rp 6.500`) so kasir/quotation auto-applies the correct price at line-add. Interacts with Phase 1a/1b customer tier via `highest-discount-wins` rule (compare customer tier price + qty tier price, apply lower). Add upsell hint on cart line so kasir can proactively suggest volume purchase to customers.

---

## 2. Non-goals

- **Cumulative qty across cart / customer / month.** Per-line only.
- **Discount % / flat-Rp off base** — absolute price per tier only in MVP. Distributor 100-SKU bulk-CSV pain deferred to Phase 3.
- **Bundle pricing / multi-SKU promos** — separate feature scope.
- **PDF invoice per-line qty-tier display** — depends on Phase 1c wiring FE to READ `pricing_tier_label` / `qty_tier_min_qty` from items JSONB. Snapshot data is stamped correctly; renderer wiring is a follow-up.
- **Owner-toggle "hide upsell hint on kasir"** — YAGNI. Ship always-on.
- **Cross-SKU logic** (e.g., "buy 5 of SKU A → get discount on SKU B") — out of scope.
- **Backend Go WA-onboard path unchanged.**

---

## 3. Data Model

### 3.1 New table `public.stock_qty_price_tiers`

```sql
CREATE TABLE IF NOT EXISTS public.stock_qty_price_tiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stock_id     UUID NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  min_qty      INT NOT NULL CHECK (min_qty >= 2),
  price        NUMERIC NOT NULL CHECK (price > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness + read-path index
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_qty_price_tiers_stock_min_qty
  ON public.stock_qty_price_tiers (stock_id, min_qty);

-- Hot-path read (qty tier lookup during sales)
CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_lookup
  ON public.stock_qty_price_tiers (stock_id, min_qty DESC);

-- Tenant-scoped listing
CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_tenant
  ON public.stock_qty_price_tiers (tenant_id);
```

**Rationale:**
- `tenant_id` explicit for RLS + `_resolve_tenant_id()` scoping (matches kasir_expense_categories precedent + PR #67 SECDEF pattern).
- `min_qty >= 2` — a tier at qty=1 is just the base price. Prevents nonsense.
- `price > 0` — sanity.
- `stock_id UNIQUE(min_qty)` — one price per threshold per SKU. Owner cannot accidentally create `min_qty=5 → Rp 8k` AND `min_qty=5 → Rp 7k` for the same SKU.
- Read pattern in RPC: `ORDER BY min_qty DESC LIMIT 1 WHERE stock_id=X AND min_qty <= line_qty` — index `(stock_id, min_qty DESC)` enables single seek.

### 3.2 RLS on `stock_qty_price_tiers`

```sql
ALTER TABLE public.stock_qty_price_tiers ENABLE ROW LEVEL SECURITY;

-- Authenticated tenants read their own rows
CREATE POLICY t_select_own ON public.stock_qty_price_tiers
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

-- vosi_rpc_owner can read (SECDEF RPC reads during price lookup, per PR #67 hotfix
-- for RPCs owned by postgres calling into vosi_rpc_owner-owned data — this policy
-- ensures SECDEF widened sales RPCs can access qty tiers).
CREATE POLICY t_select_own_secdef ON public.stock_qty_price_tiers
  FOR SELECT TO vosi_rpc_owner
  USING (true);

-- Writes only via SECDEF RPCs (owner path); no direct client INSERT/UPDATE/DELETE.
```

### 3.3 SECDEF RPC `set_stock_qty_tiers`

Owner-only. Replaces ALL tiers for a stock in one atomic op (DELETE + INSERT). Idempotent shape.

```sql
CREATE OR REPLACE FUNCTION public.set_stock_qty_tiers(
  p_stock_id UUID,
  p_tiers    JSONB  -- shape: [{"min_qty": 5, "price": 8000}, ...]
) RETURNS void
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
  SELECT EXISTS (SELECT 1 FROM public.stocks WHERE id = p_stock_id AND tenant_id = v_tenant_id)
    INTO v_stock_exists;
  IF NOT v_stock_exists THEN
    RAISE EXCEPTION 'QTP_STOCK_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  -- Cap enforcement
  v_tier_count := COALESCE(jsonb_array_length(p_tiers), 0);
  IF v_tier_count > 5 THEN
    RAISE EXCEPTION 'QTP_TOO_MANY_TIERS' USING errcode = 'P0400';
  END IF;

  -- Validate each tier + track uniqueness
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
  DELETE FROM public.stock_qty_price_tiers WHERE stock_id = p_stock_id AND tenant_id = v_tenant_id;
  IF v_tier_count > 0 THEN
    INSERT INTO public.stock_qty_price_tiers (tenant_id, stock_id, min_qty, price)
      SELECT v_tenant_id, p_stock_id, (t->>'min_qty')::INT, (t->>'price')::NUMERIC
        FROM jsonb_array_elements(p_tiers) t;
  END IF;
END $$;

ALTER FUNCTION public.set_stock_qty_tiers(UUID, JSONB) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_stock_qty_tiers(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_stock_qty_tiers(UUID, JSONB) FROM anon;
```

**Note on hard-reject vs soft-warn `price >= stocks.price`:** the RPC does NOT hard-reject a tier price that's higher than base. Rationale: some owners genuinely want tier prices for tracking (e.g., pre-discount promo). UI issues a soft warning at save time. Founder can flip this to hard-reject in a follow-up if abuse observed.

### 3.4 SECDEF RPC `delete_all_stock_qty_tiers`

Convenience for owner deleting the whole qty tier set (e.g., turning feature off for a SKU).

```sql
CREATE OR REPLACE FUNCTION public.delete_all_stock_qty_tiers(p_stock_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_tenant_id UUID := public._resolve_tenant_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'QTP_FORBIDDEN' USING errcode = 'P0403';
  END IF;
  DELETE FROM public.stock_qty_price_tiers
    WHERE stock_id = p_stock_id AND tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.delete_all_stock_qty_tiers(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(UUID) FROM anon;
```

### 3.5 Widen sales-writing RPCs

**Authoritative bodies** (post-Phase-1b): `record_kasir_sale` + `create_tempo_invoice` both live in slot `20261115000543` (Phase 1b widening). Phase 2 widens further:

1. **Per-item qty tier fetch:**
   ```plpgsql
   SELECT price, min_qty INTO v_qty_tier_price, v_qty_tier_min_qty
     FROM stock_qty_price_tiers
    WHERE stock_id = v_item_stock_id
      AND min_qty <= (v_item->>'qty')::INT
    ORDER BY min_qty DESC
    LIMIT 1;
   ```

2. **Compute effective server-authoritative price:**
   ```plpgsql
   -- v_customer_tier_price computed by Phase 1b logic (existing)
   -- v_qty_tier_price fetched above
   IF v_qty_tier_price IS NOT NULL AND v_qty_tier_price < v_customer_tier_price THEN
     v_effective_price := v_qty_tier_price;
     v_qty_tier_applied := true;
   ELSE
     v_effective_price := v_customer_tier_price;
     v_qty_tier_applied := false;
     v_qty_tier_min_qty := NULL;  -- clear if not applied
   END IF;
   ```

3. **Client `unit_price` validation:**
   ```plpgsql
   -- Accept manual override via optional p_manual_override_items (JSONB list of item indices with override flag)
   IF NOT v_item_manual_override AND (v_item->>'unit_price')::NUMERIC <> v_effective_price THEN
     RAISE EXCEPTION 'PRICE_MISMATCH: expected % got %', v_effective_price, v_item->>'unit_price';
   END IF;
   -- Manual override branch: trust client price + stamp override flag in snapshot
   ```

4. **Stamp per-item snapshot into JSONB:**
   ```plpgsql
   v_item_out := v_item_out || jsonb_build_object(
     'qty_tier_min_qty', v_qty_tier_min_qty,  -- INT or NULL
     'qty_tier_applied', v_qty_tier_applied,  -- BOOL
     'manual_override', v_item_manual_override -- BOOL
   );
   ```

**Manual override design:** RPC accepts an optional per-item `manual_override: true` field within each item JSONB. When present + true, RPC skips price validation and stamps `qty_tier_applied: false, manual_override: true`. Kasir FE sets this when kasir edits `unit_price` on the line. On qty change (§4.3), FE clears the override.

**Snapshot semantic (documented explicitly per advisor request):**
- `qty_tier_min_qty INT | NULL` — the threshold that fired (e.g., 10 for "Vol 10+"). NULL when qty tier did NOT win over customer tier.
- `qty_tier_applied BOOL` — true iff qty tier price actually won over customer tier at write time.
- `manual_override BOOL` — true iff kasir manually edited the unit_price before submission.

### 3.6 Migration slot allocation

- **Slot `20261115000545`** — schema (table + RLS + indexes) + `set_stock_qty_tiers` + `delete_all_stock_qty_tiers` RPCs.
- **Slot `20261115000546`** — widen `record_kasir_sale` + `create_tempo_invoice` for qty tier lookup + server-authoritative price + snapshot stamp.

Both idempotent per CLAUDE.md guardrail.

---

## 4. UI Touchpoints

### 4.1 Owner: inline price-ladder table in `ProductForm` + `StockTableView`

**Location:** below existing `Harga` (base) + `Harga Grosir` fields in ProductForm; conditional row-expander in StockTableView.

**Mockup:**
```
┌─ Harga & Volume ──────────────────────────────────────────┐
│                                                            │
│  Harga base (eceran):   Rp [ 10.000 ]                     │
│  Harga Grosir:          Rp [  8.000 ]                     │
│  Harga tier 3:          Rp [        ] (Phase 1b tier)     │
│                                                            │
│  Harga Volume: (opsional — beli banyak lebih murah)       │
│                                                            │
│  ┌──────────────────────────────┬──────────┬───┐          │
│  │ Beli mulai [   5 ] pcs        │ Rp [7.500]│ × │         │
│  │ Beli mulai [  10 ] pcs        │ Rp [7.000]│ × │         │
│  │ Beli mulai [  20 ] pcs        │ Rp [6.500]│ × │         │
│  └──────────────────────────────┴──────────┴───┘          │
│                                                            │
│  [ + Tambah tier volume ]  (max 5)                        │
│                                                            │
│  Contoh: beli 10 pcs = Rp 70.000                          │
│  (auto-terapkan Rp 7.000/pcs)                              │
└────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- Empty state: 1 empty row rendered with placeholder "Kosongkan kalau harga volume nggak dipakai." (delete row = no tier for SKU).
- `+ Tambah tier volume` disabled at 5 rows.
- `×` remove-row button per row.
- Auto-sort by `min_qty` ascending at save time.
- Preview line at bottom recomputes on any input change: pick the tier that would fire at qty=`ceil(max(tier_min_qty)/2)` — or a fixed qty like 10 — showing owner "beli N pcs = Rp X, auto Rp Y/pcs".
- Warning toast on save when `price >= base_price` for any row: "Harga volume Rp X lebih tinggi/sama dengan harga base Rp Y. Yakin?" [Ya/Tidak].
- Save via `tenantSettingsService.setStockQtyTiers(stockId, tiers)` wrapper → RPC `set_stock_qty_tiers`.

**New component:** `src/components/produk/QtyTiersEditor.tsx` — self-contained, accepts `stockId` + `basePrice` + `initialTiers[]` + `onSave` callback.

### 4.2 Kasir: status chip + upsell hint on `CartRows`

**Chip logic (from spec §3.5 snapshot):**
- If `qty_tier_applied === true` → chip **"Vol {min_qty}+"** (e.g., "Vol 10+"), navy pill styling (reuse Phase 1b palette).
- Else if Phase 1b customer tier fired → chip shows customer tier label (existing behaviour).
- Else if `manual_override === true` → chip **"Manual"** (gray pill).
- Else → no chip.

**Upsell hint (new, always visible when applicable):**
- Query: FE holds `stockQtyTiers[stockId]` array in scope.
- For a line at `qty=X`, find `nextTier = tiers.find(t => t.min_qty > X && t.price < currentUnitPrice)`.
- If `nextTier` exists → render hint below chip:
  ```
  💬 Tip: beli {nextTier.min_qty}+ pcs jadi Rp {nextTier.price}/pcs
       (hemat Rp {currentUnitPrice - nextTier.price}/pcs untuk customer)
  ```
- If no `nextTier` (qty already at top tier OR no more beneficial tier) → no hint.

**Bahasa styling:** hint = italic text, `text-slate-500`, ≥11px. Chip = solid pill. Two visual weights distinguish status vs suggestion.

**Files touched:** `src/components/penjualan/CartRows.tsx` (chip + hint), `src/components/penjualan/CatatPenjualanWizard.tsx` (fetch qty tiers per SKU into `stockQtyTiers` state; wire cart re-price effect).

### 4.3 Kasir: qty change re-triggers auto-apply

**Cart re-price effect** (in `CatatPenjualanWizard.tsx` — extends existing Phase 1b effect):

```tsx
useEffect(() => {
  setCart((prev) => prev.map((line) => {
    if (!line.sku) return line;
    const stock = stocks.find((s) => s.sku === line.sku);
    if (!stock) return line;
    const customerTierPrice = getTierPrice(stock, activeTier); // Phase 1b helper
    const qtyTierList = stockQtyTiers[stock.id] ?? [];
    const applicableQtyTier = qtyTierList
      .filter(t => t.min_qty <= line.qty)
      .sort((a, b) => b.min_qty - a.min_qty)[0]; // highest matching tier
    const qtyTierPrice = applicableQtyTier?.price ?? Infinity;
    const effective = Math.min(customerTierPrice, qtyTierPrice);
    const qtyWon = qtyTierPrice < customerTierPrice;

    // DISCARD any prior manual override on qty change
    return {
      ...line,
      unit_price: effective,
      master_price_at_sale: effective,
      pricing_tier_used: qtyWon ? activeTier : activeTier, // customer tier stays for reporting even if qty won
      qty_tier_applied: qtyWon,
      qty_tier_min_qty: qtyWon ? applicableQtyTier.min_qty : null,
      manual_override: false,
      subtotal: effective * line.qty,
      discount_type: null,
      discount_value: null,
      discount_amount_rp: 0,
    };
  }));
}, [activeTier, /* qty changes trigger via cart mutation elsewhere */]);
```

**Manual override entry point:** kasir edits `unit_price` on a line → FE sets `line.manual_override = true` locally + chip switches to "Manual". Next qty change on that line → auto-apply re-triggers + manual_override cleared (matches Phase 1b behavior; explicitly documented in memo §3).

### 4.4 Type widening

`src/types.ts`:

```ts
// New type
export interface StockQtyTier {
  id?: string; // present on read, absent on save
  stock_id: string;
  min_qty: number;
  price: number;
}

// Existing SupabaseStockItem extended with optional qty_tiers (populated via left-join fetch)
export interface SupabaseStockItem {
  // ... existing fields (Phase 1b)
  qty_tiers?: StockQtyTier[]; // Phase 2 — optional, undefined when not fetched or SKU has no tiers
}

// Existing CartItem shape gains snapshot fields (mirrors items JSONB)
export interface CartItem {
  // ... existing fields
  qty_tier_min_qty?: number | null;
  qty_tier_applied?: boolean;
  manual_override?: boolean;
}
```

### 4.5 New helper `getApplicableQtyTier`

```ts
// src/lib/pricing/getApplicableQtyTier.ts
export interface QtyTier { min_qty: number; price: number; }

export function getApplicableQtyTier(
  tiers: QtyTier[] | undefined,
  qty: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  const applicable = tiers
    .filter(t => t.min_qty <= qty)
    .sort((a, b) => b.min_qty - a.min_qty);
  return applicable[0] ?? null;
}

export function getNextUpsellTier(
  tiers: QtyTier[] | undefined,
  currentQty: number,
  currentUnitPrice: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  return tiers
    .filter(t => t.min_qty > currentQty && t.price < currentUnitPrice)
    .sort((a, b) => a.min_qty - b.min_qty)[0] ?? null;
}
```

Single source of truth for tier resolution + upsell suggestion. Used by cart re-price effect + CartRows hint.

### 4.6 Wrapper additions in `pengaturanServices.ts` (or `supabaseClient.ts`)

```ts
export const stocksService = {
  // ... existing
  async setQtyTiers(stockId: string, tiers: Array<{ min_qty: number; price: number }>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('set_stock_qty_tiers', {
      p_stock_id: stockId,
      p_tiers: tiers,
    });
    if (error) throw error;
  },
  async deleteAllQtyTiers(stockId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('delete_all_stock_qty_tiers', {
      p_stock_id: stockId,
    });
    if (error) throw error;
  },
};
```

---

## 5. Impact Analysis (CLAUDE.md protocol)

### 5.1 Direct file changes (~12 files)

| Category | Files |
|---|---|
| Migrations (2) | `supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql`, `20261115000546_widen_sales_rpcs_for_qty_tier.sql` |
| Types (1) | `src/types.ts` (add `StockQtyTier`, extend `SupabaseStockItem`, extend `CartItem`) |
| New FE helper (1) | `src/lib/pricing/getApplicableQtyTier.ts` |
| New FE component (1) | `src/components/produk/QtyTiersEditor.tsx` |
| New helper test (1) | `src/lib/pricing/getApplicableQtyTier.test.ts` |
| New component test (1) | `src/components/produk/QtyTiersEditor.test.tsx` |
| Modified FE (5) | `src/components/produk/ProductForm.tsx` (embed QtyTiersEditor), `src/components/produk/StockTableView.tsx` (mini editor per row OR "Edit Vol" button), `src/components/penjualan/CartRows.tsx` (chip + upsell hint), `src/components/penjualan/CatatPenjualanWizard.tsx` (fetch qty tiers state + cart re-price effect + manual override handling), `src/lib/pengaturan/pengaturanServices.ts` OR `src/lib/supabaseClient.ts` (new `stocksService.setQtyTiers` / `deleteAllQtyTiers` wrappers) |
| Modified stocks fetch (1) | `supabaseClient.ts` — extend stocks fetch to left-join qty_tiers array |
| Progress log (1) | `progress.md` |

**Explicitly NOT touched:**
- `backend-go/**` — WA-onboard path unchanged.
- Phase 1b existing tier UI (Pengaturan panel, tier pills) — orthogonal dimension.
- PDF renderers — no per-line tier column added in this phase (Phase 1c gap).

### 5.2 Call-site impact

- `record_kasir_sale` FE wrapper (`supabaseClient.ts:1487`): existing items JSONB now optionally includes `manual_override` per item. Wrapper doesn't need to change signature — items JSONB is opaque passthrough.
- `create_tempo_invoice` FE wrapper: same shape.
- Existing Phase 1a/1b tier flow untouched.

### 5.3 Test surface

- New: `src/lib/pricing/getApplicableQtyTier.test.ts` — unit tests for `getApplicableQtyTier` (empty tiers, no match, exact match, highest wins) + `getNextUpsellTier` (no next, next exists but no price improvement, next exists with improvement).
- New: `src/components/produk/QtyTiersEditor.test.tsx` — render empty, add tier, remove tier, save happy path, save-with-warning (price >= base), cap-at-5 button disabled, RPC error mapping (`QTP_INVALID_MIN_QTY`, `QTP_TOO_MANY_TIERS`).
- Extend: `CatatPenjualanWizard.test.tsx` (if exists) — cart re-price effect covers qty tier + manual override reset.
- Extend: `CartRows.test.tsx` (if exists) — chip renders "Vol 10+" when `qty_tier_applied=true`; hint renders "Tip: beli 10+" when applicable.
- New: SQL smoke via Management API + RAISE-rollback:
  - `set_stock_qty_tiers` happy path (3 tiers).
  - `set_stock_qty_tiers` `QTP_INVALID_MIN_QTY` (min_qty=1).
  - `set_stock_qty_tiers` `QTP_TOO_MANY_TIERS` (6 tiers).
  - `set_stock_qty_tiers` duplicate min_qty rejected.
  - Widened `record_kasir_sale` with `pricing_tier_used='eceran'` + qty=10 (tier applies) → verify `qty_tier_applied=true, qty_tier_min_qty=10` in returned items.
  - Widened `record_kasir_sale` with customer tier price LOWER than qty tier → verify `qty_tier_applied=false, qty_tier_min_qty=null`.

### 5.4 Verdict

**12 file changes, 2 migrations, 4 new/updated test files, 1 helper + 1 panel new. Plan covers all identified surfaces. Deferred (documented): discount % mode, bulk CSV editor, cumulative qty, PDF invoice per-line tier display, owner-toggle hide upsell hint.**

---

## 6. Testing Plan

### 6.1 Stage 1 — local gates (blocking commit per Phase 1a/1b discipline)

1. `npm run lint`
2. `npm run audit:numinput` / `audit:secdef-null-tenant` / `audit:csp-backend-allowlist` / `audit:no-string-err-fallback` / `audit:secdef-auth-schema-owner` (per PR #67)
3. `npx vitest run` — full suite (~1120+ tests, expect all pass + new tests added)

### 6.2 Stage 2 — deploy sequence

- Push to `main` → cloudbuild → staging.
- Manual `scripts/promote-to-prod.sh <SHORT_SHA>` per memory `manual_prod_gate_after_real_tenant`.
- `gcloud builds list --limit=2` STATUS check.

### 6.3 Stage 3 — production smoke on `Toko Jaya Makmur`

**Scenario A — configure 3 qty tiers on a SKU (happy path):**
1. Open Produk / Stok Manager → open SKU TJM-EL-002 (Baterai AA, base Rp 18k).
2. In `QtyTiersEditor`, add:
   - `Beli mulai 5 pcs → Rp 16.000`
   - `Beli mulai 10 pcs → Rp 15.000`
   - `Beli mulai 20 pcs → Rp 14.000`
3. Verify preview: "Contoh: beli 10 pcs = Rp 150.000".
4. Save → toast "Harga volume tersimpan."
5. DB verify: 3 rows in `stock_qty_price_tiers` for this stock_id.

**Scenario B — kasir line-add auto-applies + chip fires:**
1. Kasir → Catat Penjualan → select any customer (Eceran default) → add SKU TJM-EL-002 qty=10.
2. Verify unit_price shows Rp 15.000 (tier 10+ applied); line chip **"Vol 10+"**.
3. DB verify: `sales_orders.items[0].qty_tier_min_qty=10, qty_tier_applied=true`.

**Scenario C — upsell hint fires when qty below next tier:**
1. Same customer + SKU as B but qty=6.
2. Verify unit_price Rp 16.000 (Vol 5+); chip **"Vol 5+"**; hint **"Tip: beli 10+ pcs jadi Rp 15.000/pcs (hemat Rp 1.000/pcs untuk customer)"**.

**Scenario D — customer tier wins over qty tier:**
1. Customer switched to Grosir tier (Phase 1b), assumed customer tier price for TJM-EL-002 is Rp 14.500 (via `price_grosir`).
2. Add SKU qty=10 → qty tier price Rp 15.000 > Grosir Rp 14.500 → customer tier wins.
3. Verify: unit_price Rp 14.500; chip **"Grosir"** (customer tier chip, no "Vol 10+"); DB `qty_tier_applied=false, qty_tier_min_qty=null`.

**Scenario E — manual override:**
1. From Scenario B state, kasir manually edits unit_price to Rp 14.000 (further negotiation).
2. Verify chip changes to **"Manual"**; DB on save: `manual_override=true, qty_tier_applied=false, qty_tier_min_qty=null`.

**Scenario F — qty change discards manual override:**
1. From Scenario E state, kasir changes qty from 10 → 12.
2. Verify unit_price auto-recomputes to Rp 15.000 (Vol 10+); chip back to **"Vol 10+"**; manual_override cleared.

**Scenario G — validation reject UI:**
1. QtyTiersEditor: enter min_qty=1 → save → toast "min_qty harus ≥ 2" (mapped from `QTP_INVALID_MIN_QTY`).
2. Enter 6 tiers → save → toast "Max 5 tier per SKU" (mapped from `QTP_TOO_MANY_TIERS`).

**Cleanup:** delete all qty tiers on TJM-EL-002 via `delete_all_stock_qty_tiers`.

---

## 7. Observability

- **Entry log** on QtyTiersEditor save: `console.info('[qty_tier] set', {tenant_id, stock_id, tier_count})`.
- **Error log** on RPC failures: `captureError(err, {feature: 'qty_tier', action: 'set' | 'delete'})`.
- **Sentry breadcrumb** on kasir qty tier auto-apply — extend existing tier-switch breadcrumb in `CatatPenjualanWizard.tsx`.
- **Usage counter (V2, out of scope):** per-tenant count of SKUs with qty tiers configured — surfaced later if cascade impact query needed for a future modul-off toggle.

---

## 8. Migration & Rollback

### 8.1 Forward migrations

- `supabase/migrations/20261115000545_stock_qty_price_tiers_schema_and_rpc.sql` — schema + RLS + 2 SECDEF RPCs (§3.1-3.4).
- `supabase/migrations/20261115000546_widen_sales_rpcs_for_qty_tier.sql` — widen `record_kasir_sale` + `create_tempo_invoice` (§3.5). Base bodies on Phase 1b slot `20261115000543` (Phase 1b's latest widening).

Both idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`).

### 8.2 Rollback SQL (inline header comment)

```sql
-- Rollback 20261115000546 — restore RPC bodies from slot 20261115000543 verbatim.

-- Rollback 20261115000545
DROP FUNCTION IF EXISTS public.set_stock_qty_tiers(UUID, JSONB);
DROP FUNCTION IF EXISTS public.delete_all_stock_qty_tiers(UUID);
DROP POLICY IF EXISTS t_select_own ON public.stock_qty_price_tiers;
DROP POLICY IF EXISTS t_select_own_secdef ON public.stock_qty_price_tiers;
DROP TABLE IF EXISTS public.stock_qty_price_tiers;
-- Historic items JSONB with qty_tier_min_qty / qty_tier_applied / manual_override
-- keys become orphan/harmless — old-code FE simply ignores unknown JSONB keys.
```

Before running rollback: verify no active tenant depends on the feature (grep or Management API count of `stock_qty_price_tiers`).

### 8.3 Post-migration advisor scan

Per CLAUDE.md: run `mcp__plugin_supabase_supabase__get_advisors` after any migration. Supabase MCP currently disconnected — fallback: Management API `/v1/projects/{ref}/database/advisors?type=security` endpoint. Log findings to `progress.md`.

---

## 9. Adversarial Critique

- **"Highest-discount wins" could cause pricing regressions when owner mis-configures qty tier price above customer tier price** — mitigated by (a) UI warning on save when `qty_tier_price >= base_price`; (b) server takes min() anyway so customer never pays MORE than customer tier price. Worst case: qty tier is silently useless for grosir customer — kasir sees "Grosir" chip, upsell hint may fire pointing to a qty tier that wouldn't help. Not a data-loss risk.
- **`min_qty >= 2` CHECK might feel restrictive** — but `min_qty = 1` means "tier applies to qty 1+", which is just the base price. Enforcing ≥2 prevents nonsense config that could confuse readers.
- **`manual_override` in items JSONB is client-controlled** — kasir could stamp `manual_override: true` on every line to bypass validation. Mitigated: manual override is audit-visible in items JSONB; owner reviewing daily kasir report sees which lines were manually adjusted. Not a security bug (kasir is authenticated), just a policy signal.
- **RPC widening changes signature? No — items JSONB is passthrough** — RPC contract stays additive (new optional per-item fields). FE wrapper unchanged.
- **`stocks.id UUID` — verify:** Phase 1a/1b work referenced `stocks.sku` for SKU lookup. Verify the FK to `stocks(id)` in `stock_qty_price_tiers` uses the correct PK column. Read spec 000542+ or grep `CREATE TABLE.*stocks`. Plan writer confirms at implementation time.
- **What if owner reduces stock's base `price` below all qty tier prices?** Qty tier prices become "worse than base" and no customer benefits from them. Not a bug — owner is expected to review tier prices after base change. UI warning surfaces on ProductForm save if any qty tier price >= new base (extends existing check).
- **Cart re-price effect performance** — for every keystroke on `qty` input, effect fires + iterates cart + does array filter on qty tiers per line. At 15 lines × 5 tiers per SKU = 75 comparisons per keystroke. Fine.

---

## 10. I Verified (design + advisor pass, 2026-07-31)

- **Migration slot allocation:** `ls supabase/migrations/ | tail -5` shows latest = `000544` (Phase 1b). Slots `000545` and `000546` free.
- **Existing tier surface unchanged by Phase 2:** Phase 1a/1b UI (pills, TierConfigPanel, ProductForm price_grosir/tier_3/4 columns) untouched. Phase 2 adds NEW component `QtyTiersEditor` alongside them.
- **`_resolve_tenant_id()` exists** (verified at `20261115000523:20` for kasir-expense-categories precedent). Same pattern for Phase 2 RPCs.
- **`admin_users WHERE role='Owner'` pattern** verified (same file line 28). Adopted.
- **`OWNER TO postgres` per PR #67 hotfix** — verified precedent + gap resolution shipped in `20261115000525`. Applied in Phase 2 RPCs.
- **Structured `TCFG_*` (Phase 1b) / `KECT_*` (kasir-expense) error taxonomy pattern** — Phase 2 adopts `QTP_*` (Qty Tier Pricing) prefix.
- **Server-authoritative price validation pattern** — Phase 1a already validates `v_expected_price` in `record_kasir_sale`. Phase 2 extends: server computes `min(customer_tier_price, qty_tier_price)`.
- **Manual override pattern (per-item flag in JSONB)** — matches how kasir already handles per-line discount adjustments (existing per-line `discount_type`/`discount_value` fields).
- **Advisor consulted twice this session:**
  - First: framing help + push toward asking absolute-vs-% + snapshot semantic + chip logic bug.
  - Second: gap closure (tenant_id, manual override interaction on qty change, client vs server authority on price min).

---

## 11. Confidence Marking

- **[VERIFIED]** Migration slot 545+546 free; `_resolve_tenant_id()` + `admin_users` owner-check patterns exist and match Phase 1b usage.
- **[VERIFIED]** OWNER TO postgres correct per PR #67 hotfix.
- **[VERIFIED]** Backend Go tier code empty (per Phase 1a/1b grep during those phases; unchanged since).
- **[VERIFIED]** No PIN gate on Pengaturan config panels (Phase 1b precedent).
- **[REASONED]** Normalized table for `stock_qty_price_tiers` is correct-fit for variable-cardinality per SKU (Kimball rule: variable → table). Phase 1b's fixed-columns was correct for its fixed-cardinality shape.
- **[REASONED]** Absolute price per tier matches MSME warung mental model AND is easily extensible to discount mode later (add `price_percent_off` / `price_flat_off_rp` optional columns).
- **[REASONED]** Highest-discount-wins interaction with Phase 1a/1b is the simplest defensible rule; stacking (Option D) creates edge cases; always-customer-wins (Option C alt) breaks distributor use case.
- **[REASONED]** Chip fires only when qty tier WON — matches kasir mental model (chip = rule that determined price); alternative (chip fires whenever threshold met) misleads kasir.
- **[REASONED]** Manual override discarded on qty change matches Phase 1b cart re-price behavior; consistent codebase pattern.
- **[REASONED]** Server-authoritative price min() extends Phase 1a's `v_expected_price` validation pattern; client-trust weakens audit story.
- **[ASSUMED]** `stocks.id` is UUID PK (needs verification at Task 1 implementation — grep `CREATE TABLE.*stocks` in migrations). If stocks uses text PK, FK type adjusts.
- **[ASSUMED]** FE `CatatPenjualanWizard.tsx` state has room for a new `stockQtyTiers` map keyed by stock_id. If prop chain requires threading tenantSettings/etc, plan writer resolves at Task 6 implementation.

---

## 12. Definition of Done (Phase 2)

Per CLAUDE.md:
- Seven-lens thinking applied silently; findings surfaced above.
- Stop-hook gates green.
- Ship & verify stages 1 + 2 + 3 completed.
- Post-migration advisor scan run + findings triaged.
- New user-facing feature ships with observability.
- No new paid-API call → no cost approval needed.
- Irreversible-decision memo written (`2026-07-31-phase-2-sku-qty-tier-decision.md`) and referenced from `progress.md`.
- `progress.md` entry with WHAT + WHY + links to memo + spec + plan + commits.
- No dead code, no TODO, no commented-out block.
- `advisor()` consulted twice (design phase).
- Founder approved UI/UX before code was written (this spec's §4 mockups).

Before implementation begins: this spec goes through user review gate. **Note: founder is away 5h and authorized subagent-driven execution to proceed without waiting for spec review.** Autonomous execution proceeds; founder reviews spec + delta upon return.
