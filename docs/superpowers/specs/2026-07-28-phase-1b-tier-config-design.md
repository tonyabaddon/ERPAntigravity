# Phase 1b — Owner-Configurable Pricing Tiers (Design Spec)

**Date:** 2026-07-28 (double-check-corrected version)
**Author:** Claude (paired with founder via `superpowers:brainstorming`)
**Status:** Design approved by founder; awaiting spec review before writing-plans. Corrected after founder-requested double-check surfaced 4 bugs.
**Companion memo:** [`2026-07-28-phase-1b-tier-config-decision.md`](2026-07-28-phase-1b-tier-config-decision.md)
**Prior phases:** Phase 1a [`2026-07-24-customer-pricing-tier-add-form-fix-design.md`](2026-07-24-customer-pricing-tier-add-form-fix-design.md) (shipped commit `f052d27` on 2026-07-25) · Original 2-tier [`2026-06-24-multi-tier-pricing-design.md`](2026-06-24-multi-tier-pricing-design.md).

---

## 1. Goal

Allow the tenant owner to configure **2–4 pricing tiers per tenant** via a Pengaturan panel:
- Rename the existing `'eceran'` / `'grosir'` labels to any Bahasa-Indonesian labels they prefer.
- Optionally enable a 3rd or 4th tier (e.g., "Distributor", "Super Distributor") with its own product-level prices.
- Every downstream consumer (customer profile pill, sales quotation toggle, kasir pill, StockManager price columns, product form, bulk CSV, PDF invoice) reflects the tenant's configured tier set.

The feature is gated by the existing `modul_multi_tier_price` flag (unchanged) — tenants that don't use multi-tier pricing see zero UX change.

---

## 2. Non-goals

- **Dynamic-N tiers.** Founder capped at 4. Not building unbounded owner-created tiers.
- **SKU-quantity tiering** (buy-more-get-cheaper). Phase 2, deferred.
- **Backend Go WA-onboard path** stays untouched — WA-created customer keeps DB default `'eceran'`; owner edits later if needed.
- **Per-tier visual distinction** — pill 3 and 4 reuse the existing purple token. If tenants ask for distinct per-tier colors, Phase 1c design-tokens ask (out of scope now).
- **Backfill historical items JSONB with `pricing_tier_label`** — pre-Phase-1b items have `pricing_tier_used` without the sibling label. PDF renderer falls back to current tenant label for those. New items always stamp label. Backfill is Phase 1c option.
- **`create_sales_order` RPC widening** — verified via grep: this RPC (slot `20260725000003`) has zero `pricing_tier_used` reference. Items are stored as-is JSONB passthrough. No widening needed.

---

## 3. Data Model

### 3.1 `tenant_settings` — add 4 columns

```sql
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS tier_1_label TEXT NOT NULL DEFAULT 'Eceran',
  ADD COLUMN IF NOT EXISTS tier_2_label TEXT NOT NULL DEFAULT 'Grosir',
  ADD COLUMN IF NOT EXISTS tier_3_label TEXT,  -- NULL = tier disabled
  ADD COLUMN IF NOT EXISTS tier_4_label TEXT;  -- NULL = tier disabled
```

Existing tenants get the default `'Eceran'` / `'Grosir'` labels — zero UX change until owner opens the new panel.

### 3.2 `products` — add 2 price columns

```sql
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_tier_3 NUMERIC,
  ADD COLUMN IF NOT EXISTS price_tier_4 NUMERIC;
```

Existing `price` (base = tier_1) and `price_grosir` (= tier_2) stay untouched. Read-time fallback: `COALESCE(price_tier_N, price)` for each tier (mirrors existing `price_grosir` fallback).

### 3.3 `customers.default_pricing_tier` — widen CHECK

```sql
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_default_pricing_tier_check
    CHECK (default_pricing_tier IN ('eceran','grosir','tier_3','tier_4'));
```

Additive only. Existing `'eceran'` / `'grosir'` values stay valid.

### 3.4 Snapshot label — lives INSIDE items JSONB (no new column, no new table)

Line items are stored as JSONB arrays on parent order rows — verified via grep during double-check:
- `public.sales_orders.items` — `jsonb NOT NULL DEFAULT '[]'::jsonb` (migration `20260725000001:10`)
- `public.kasir_transactions.items` — `JSONB NOT NULL DEFAULT '[]'` (migration `20260604000008:22`)

There is **no normalized `sales_lines` table**. Each item object already carries `pricing_tier_used` (added by `20260901000005`/`20260901000006`). Phase 1b adds `pricing_tier_label` as a sibling JSONB key stamped at RPC write time:

```jsonc
{
  "sku": "AA-01",
  "qty": 2,
  "unit_price": 90000,
  "master_price_at_sale": 90000,
  "pricing_tier_used": "grosir",
  "pricing_tier_label": "Grosir"        // NEW — stamped by RPC at write time
}
```

**No table schema change** for snapshot. RPC widening (§3.6) writes the label into `v_item` via the same `v_item := v_item || jsonb_build_object(...)` pattern already used for `pricing_tier_used`.

**Historic items (pre-Phase-1b):** carry `pricing_tier_used` but not `pricing_tier_label`. PDF renderer + list views MUST fall back:

```ts
const label = item.pricing_tier_label
           ?? currentTenantLabelFor(item.pricing_tier_used, tenantSettings)
           ?? '—';
```

This gives immutability for new sales going forward + graceful legacy behaviour. Backfill of historic items with current-tenant labels is a Phase 1c option if audit ever demands perfect snapshot coverage; the current spec explicitly defers it.

### 3.5 New SECDEF RPC `update_tenant_tier_config`

Mirrors kasir-expense precedent (`20261115000523:9-30` — `kasir_expense_category_create`): `SET search_path`, owner-role check via `admin_users`, `_resolve_tenant_id()` for scoping, structured `TCFG_*` error codes with `errcode`.

```sql
CREATE OR REPLACE FUNCTION public.update_tenant_tier_config(
  p_tier_1_label TEXT,
  p_tier_2_label TEXT,
  p_tier_3_label TEXT,  -- NULL = disable
  p_tier_4_label TEXT   -- NULL = disable
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_tenant_id   uuid := public._resolve_tenant_id();
  v_labels      TEXT[];
  v_t1 TEXT := TRIM(p_tier_1_label);
  v_t2 TEXT := TRIM(p_tier_2_label);
  v_t3 TEXT := NULLIF(TRIM(COALESCE(p_tier_3_label, '')), '');
  v_t4 TEXT := NULLIF(TRIM(COALESCE(p_tier_4_label, '')), '');
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'TCFG_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Length validation: tier_1/2 required non-empty (3-30 chars); tier_3/4 optional (NULL or 3-30)
  IF LENGTH(v_t1) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_1';
  END IF;
  IF LENGTH(v_t2) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_2';
  END IF;
  IF v_t3 IS NOT NULL AND LENGTH(v_t3) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_3';
  END IF;
  IF v_t4 IS NOT NULL AND LENGTH(v_t4) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_4';
  END IF;

  -- Case-insensitive uniqueness within active labels
  v_labels := ARRAY_REMOVE(ARRAY[LOWER(v_t1), LOWER(v_t2),
                                 LOWER(COALESCE(v_t3, '')), LOWER(COALESCE(v_t4, ''))],
                           '');
  IF cardinality(v_labels) <> cardinality(ARRAY(SELECT DISTINCT unnest(v_labels))) THEN
    RAISE EXCEPTION 'TCFG_LABEL_DUPLICATE' USING errcode = 'P0409';
  END IF;

  UPDATE public.tenant_settings
     SET tier_1_label = v_t1,
         tier_2_label = v_t2,
         tier_3_label = v_t3,
         tier_4_label = v_t4,
         updated_at = now()
   WHERE tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.update_tenant_tier_config(TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_tenant_tier_config(TEXT,TEXT,TEXT,TEXT) TO authenticated;
```

**Owner-role fallback for SECDEF+auth pattern** (per PR #67, memory needs verification at plan time): kasir-expense RPCs originally shipped with `OWNER TO vosi_rpc_owner` but had to hotfix to `OWNER TO postgres` because `vosi_rpc_owner` lacks `USAGE` on schema `auth`, blocking `auth.uid()` calls. This spec ships with `OWNER TO postgres` from the start.

### 3.6 Widen existing sales-writing RPCs (both at slot `000325`)

**Authoritative bodies (verified via grep during double-check):**
- `record_kasir_sale` — latest body in `20261115000325_audit_kasir_and_pembelian.sql:21`.
- `create_tempo_invoice` — latest body in the **same migration** `20261115000325_audit_kasir_and_pembelian.sql:432`.

Both are `CREATE OR REPLACE FUNCTION` re-definitions of the tier-aware pattern originally introduced by `20260901000005` / `20260901000006`.

**Widening pattern (applied to BOTH RPCs identically):**

1. **Widen `INVALID_TIER` validation:**
   ```plpgsql
   IF v_tier_used NOT IN ('eceran', 'grosir', 'tier_3', 'tier_4') THEN
     RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
   END IF;
   ```

2. **Extend price-lookup CASE (was a two-way COALESCE):**
   ```plpgsql
   SELECT
     CASE v_tier_used
       WHEN 'grosir' THEN COALESCE(s.price_grosir, s.price)
       WHEN 'tier_3' THEN COALESCE(s.price_tier_3, s.price)
       WHEN 'tier_4' THEN COALESCE(s.price_tier_4, s.price)
       ELSE s.price    -- 'eceran' or unknown → base
     END,
     s.price
   INTO v_expected_price, v_master_price
   FROM products s
   WHERE s.sku = v_item->>'sku'
     AND s.tenant_id = v_tenant_id;
   ```

3. **Stamp `pricing_tier_label` snapshot into each item's JSONB** — mirrors the existing `v_item := v_item || jsonb_build_object('pricing_tier_used', ...)` pattern already in these RPCs:
   ```plpgsql
   -- Resolve label from tenant_settings once per RPC call (cached in v_settings)
   v_tier_label := CASE v_tier_used
     WHEN 'eceran' THEN v_settings.tier_1_label
     WHEN 'grosir' THEN v_settings.tier_2_label
     WHEN 'tier_3' THEN v_settings.tier_3_label
     WHEN 'tier_4' THEN v_settings.tier_4_label
   END;
   -- Append to v_item BEFORE the existing INSERT into sales_orders/kasir_transactions
   v_item := v_item || jsonb_build_object('pricing_tier_label', v_tier_label);
   ```
   No table schema change; label lands inside each JSONB item alongside `pricing_tier_used`.

4. **`create_sales_order`** (slot `20260725000003`) — verified via grep: NO tier code. Items stored as-is JSONB passthrough. No widening needed.

### 3.7 Orphan-tolerant read-time fallback

Every reader of `customer.default_pricing_tier` in FE must handle the case where the tier is disabled at tenant level:

```ts
// src/lib/pricing/getActiveTiers.ts
export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';

// Falls back to 'eceran' when tenant disabled the tier
export function resolveEffectiveTier(
  customerTier: TierKey,
  tenantSettings: DbTenantSettings,
): TierKey {
  const activeKeys = getActiveTiers(tenantSettings).map(t => t.key);
  return activeKeys.includes(customerTier) ? customerTier : 'eceran';
}
```

Used by `CatatPenjualanWizard` auto-tier-sync, kasir tier toggle initial state, and pill-preselect logic in customer edit.

### 3.8 Migration slot allocation

- **Slot `20261115000542`** — schema changes (§3.1-3.3) + `update_tenant_tier_config` RPC (§3.5). No table alterations for the JSONB snapshot — that's an RPC-level write pattern.
- **Slot `20261115000543`** — widen `record_kasir_sale` and `create_tempo_invoice` RPCs (§3.6). Both restated `CREATE OR REPLACE FUNCTION` with widened tier handling + JSONB label stamp.

Both idempotent per CLAUDE.md guardrail: `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + re-add, `CREATE OR REPLACE FUNCTION`. Safe to re-run.

---

## 4. UI Touchpoints

### 4.1 New: Pengaturan → "Tingkat Harga" panel

Location: new tab or section in `src/components/pengaturan/`. Visible only when `modul_multi_tier_price = TRUE`.

```
┌─ Tingkat Harga ───────────────────────────────────────────┐
│                                                            │
│  Owner bisa set 2-4 tingkat harga per SKU.                │
│  Tier 1 & 2 wajib; Tier 3 & 4 opsional (kosongkan = off). │
│                                                            │
│  Tier 1 (Base):    [ Eceran           ]  ✓ Wajib          │
│  Tier 2:           [ Grosir           ]  ✓ Wajib          │
│  Tier 3:           [ Grosir Besar     ]  Opsional         │
│  Tier 4:           [                  ]  Kosong = off     │
│                                                            │
│                                     [ Batal ]  [ Simpan ] │
└────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- Empty tier_3/tier_4 = tier disabled — pills hidden across app, price columns hidden in StockManager, filter chips hidden in PelangganScreen.
- Fill in a previously-disabled tier → pills reappear on next React Query invalidation (or immediately via optimistic update).
- Label change (rename): affects UI immediately for new PDFs. Historical PDFs use their snapshot label from items JSONB (§3.4).
- Case-insensitive uniqueness enforced by RPC (§3.5). UI-side pre-validate to save an RPC round-trip.
- No PIN gate (matches existing Pengaturan panels — RLS + owner-role SECDEF check).

New file: `src/components/pengaturan/TierConfigPanel.tsx`. Error mapping: `TCFG_LABEL_INVALID` → Bahasa toast "Label tier X harus 3-30 karakter"; `TCFG_LABEL_DUPLICATE` → "Label tier duplikat"; `TCFG_FORBIDDEN` → generic "Tidak berwenang" (should never hit since panel is owner-gated).

### 4.2 New: `getActiveTiers` helper

```ts
// src/lib/pricing/getActiveTiers.ts
export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';
export interface Tier { key: TierKey; label: string; slot: 1 | 2 | 3 | 4; }

export function getActiveTiers(s: DbTenantSettings): Tier[] {
  const tiers: Tier[] = [
    { key: 'eceran', label: s.tier_1_label, slot: 1 },
    { key: 'grosir', label: s.tier_2_label, slot: 2 },
  ];
  if (s.tier_3_label) tiers.push({ key: 'tier_3', label: s.tier_3_label, slot: 3 });
  if (s.tier_4_label) tiers.push({ key: 'tier_4', label: s.tier_4_label, slot: 4 });
  return tiers;
}

// Read-time helper for products.price_tier_N lookup with base fallback
export function getTierPrice(
  stock: { price: number; price_grosir?: number | null; price_tier_3?: number | null; price_tier_4?: number | null },
  tier: TierKey,
): number {
  switch (tier) {
    case 'grosir': return stock.price_grosir ?? stock.price;
    case 'tier_3': return stock.price_tier_3 ?? stock.price;
    case 'tier_4': return stock.price_tier_4 ?? stock.price;
    default:       return stock.price;
  }
}
```

Single source of truth for "what tiers exist on this tenant, in what order, with what labels" and "what price does this SKU carry at this tier." Used by every consumer.

### 4.3 Generalize pill sites to N tiers

All existing 2-pill sites become 2–4 pills based on `getActiveTiers`:

- `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` — add-customer pills.
- `src/components/PelangganScreen.tsx` — edit-customer pills + tier filter chips (Semua + N).
- `src/components/penjualan/CatatPenjualanWizard.tsx` — active tier toggle + auto-sync from customer.

**Corrected (double-check):** `src/components/KasirScreen.tsx` has NO tier code — the kasir flow opens `CatatPenjualanWizard` which owns the tier toggle. KasirScreen not in this list.

Pattern:
```tsx
const tiers = getActiveTiers(tenantSettings);
<div className="flex gap-1.5">
  {tiers.map((t) => (
    <button
      key={t.key}
      aria-pressed={active === t.key}
      onClick={() => setActive(t.key)}
      className={/* base tier navy, others reuse purple palette */}
    >
      {t.label}
    </button>
  ))}
</div>
```

### 4.4 Generalize product/price entry sites

- **`src/components/produk/ProductForm.tsx`** — add 2 optional NumberInput fields (`price_tier_3`, `price_tier_4`), rendered only when the corresponding tier is active per `getActiveTiers`. Field labels come from tenant's `tier_N_label`.
- **`src/components/produk/StockTableView.tsx`** — add 2 conditional columns to the inline-edit table; each column visible only when the corresponding tier is active. NULL cell renders "Sama dgn base" placeholder.
- **`src/components/produk/BulkUpdateGrosirSection.tsx`** — rename to `BulkUpdateTierPricesSection.tsx`. CSV columns widen from `sku,nama,price_eceran,price_grosir_lama,price_grosir_baru` to include `price_tier_3_lama/baru`, `price_tier_4_lama/baru`. CSV parser tolerates missing columns (backward-compatible with old CSV templates).

### 4.5 Generalize CartRows warning

`src/components/penjualan/CartRows.tsx:175-176` currently:

```tsx
{showTierPill && activeTier === 'grosir' && stock && stock.price_grosir == null && (
  /* warn: falls back to eceran */
)}
```

Widen to any non-base tier:

```tsx
{showTierPill && activeTier !== 'eceran' && stock && getTierPrice(stock, activeTier) === stock.price && (
  /* warn: falls back to base because no explicit price at activeTier */
)}
```

Uses `getTierPrice` helper from §4.2.

### 4.6 Cascade map updates

`src/lib/pengaturan/cascadeMap.ts`:

- **Rename `FieldKey` `csv_bulk_grosir_button` → `csv_bulk_tier_prices_button`** for semantic accuracy. Update consumers in the renamed `BulkUpdateTierPricesSection`.
- **Update `cascadeImpactSummary` for `modul_multi_tier_price`:**
  - Widen `tierEnabledCustomerCount` query to count `default_pricing_tier != 'eceran'` (not just `= 'grosir'`).
  - Update user-facing message: `"N pelanggan ter-tag non-eceran akan kembali ke eceran; data tetap tersimpan"`.
- **No new FieldKey needed** for the Pengaturan panel — panel is gated by `modul_multi_tier_price` directly, same as other consumers.

### 4.7 Type widening

`src/types.ts`:

- `default_pricing_tier` union: `'eceran' | 'grosir'` → `'eceran' | 'grosir' | 'tier_3' | 'tier_4'`.
- `DbTenantSettings` adds: `tier_1_label: string; tier_2_label: string; tier_3_label: string | null; tier_4_label: string | null;`.
- `SupabaseStockItem` adds: `price_tier_3?: number | null; price_tier_4?: number | null;`.
- New re-exported `TierKey` type from `src/lib/pricing/getActiveTiers.ts`.
- JSONB item shape (kept as a documented comment on `sales_orders.items` / `kasir_transactions.items` type):
  ```ts
  interface SalesItem {
    sku: string | null;
    qty: number;
    unit_price: number;
    master_price_at_sale: number;
    pricing_tier_used?: TierKey;
    pricing_tier_label?: string;  // NEW — stamped by RPC; missing on historic items
    // ... other existing fields
  }
  ```

TypeScript strict compilation will surface every consumer via type errors — natural implementation checklist.

---

## 5. Impact Analysis (CLAUDE.md protocol)

### 5.1 Direct file changes (13 files, revised down from 14)

| Category | Files |
|---|---|
| Migrations (2) | `supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql`, `20261115000543_widen_sales_rpcs_for_tier_config.sql` |
| Types (1) | `src/types.ts` |
| New FE (2) | `src/components/pengaturan/TierConfigPanel.tsx`, `src/lib/pricing/getActiveTiers.ts` |
| FE tier UI (4) | `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`, `src/components/PelangganScreen.tsx`, `src/components/penjualan/CatatPenjualanWizard.tsx`, `src/components/penjualan/CartRows.tsx` |
| FE product entry (3) | `src/components/produk/ProductForm.tsx`, `src/components/produk/StockTableView.tsx`, `src/components/produk/BulkUpdateTierPricesSection.tsx` (renamed from `BulkUpdateGrosirSection.tsx`) |
| Cascade + supabase client (2) | `src/lib/pengaturan/cascadeMap.ts`, `src/lib/supabaseClient.ts` (new RPC wrapper + `SupabaseStockItem` type extension) |
| Wizard prop chain (1) | `src/components/penjualan/wizard/Step1ChannelCustomer.tsx` if it forwards active tiers (verify at plan time) |
| Audit script update (1) | `scripts/audit-misclassified-customer-tier.sql` — extend WHERE clause to include tier_3/4 heuristics |

**Explicitly NOT touched (verified via grep):**
- `src/components/KasirScreen.tsx` — no tier code, tier toggle lives in `CatatPenjualanWizard`.
- `backend-go/**` — no tier code, WA-onboard path uses DB default `'eceran'`.
- `src/lib/dashboardReports/**`, `src/components/laporan/**`, `src/lib/laporan/**` — no tier references, no reader widening needed.
- Existing sales-lines schema — **there is no `sales_lines` table**. Items live in JSONB on `sales_orders.items` and `kasir_transactions.items`.

### 5.2 Call-site impact

- `insertNewCustomer` (Phase 1a wrapper) — no signature change; already accepts `default_pricing_tier?: TierKey`. Type widening propagates.
- `customersService.updateTier` — no signature change; already `(id, tier)` typed with the tier union. Widen union → widen input.
- `create_sales_order`, `record_kasir_sale`, `create_tempo_invoice` frontend service wrappers — no signature change; RPC accepts JSONB payload where `pricing_tier_used` is already a TEXT field inside each item.
- Backend Go WA path — unchanged.

### 5.3 Test surface

- New: `src/lib/pricing/getActiveTiers.test.ts` — unit tests for 2/3/4-tier resolution + orphan customer tier fallback + `getTierPrice` COALESCE cases.
- New: `src/components/pengaturan/TierConfigPanel.test.tsx` — form validation, save happy path, `TCFG_LABEL_INVALID` rejection UI, `TCFG_LABEL_DUPLICATE` rejection UI, disable via clear.
- Update: `src/components/PelangganScreen.test.tsx` — parametrize existing tier tests to run against 2/3/4-tier settings.
- Update: `src/components/penjualan/wizard/NewCustomerInlineForm` tests (if standalone file exists) — parametrize.
- New: SQL smoke via Supabase Management API + `RAISE EXCEPTION` rollback (per memory `smoke_test_security_definer_rpcs`):
  - `update_tenant_tier_config` with fake `auth.uid` → verify labels updated, `TCFG_LABEL_INVALID` on 2-char label, `TCFG_LABEL_DUPLICATE` on collision, `TCFG_FORBIDDEN` when non-Owner caller.
  - `record_kasir_sale` (widened, slot 000543) with `pricing_tier_used='tier_3'` → verify accepts, resolves price via COALESCE(price_tier_3, price), stamps `pricing_tier_label` into item JSONB, INSERT succeeds.
  - `create_tempo_invoice` (widened, slot 000543) same coverage.

### 5.4 Verdict

**13 file changes, 2 migrations, 5 new/updated test files, 1 helper + 1 panel new. Plan covers all identified surfaces. Deferred (documented): visual pill palette per tier, backfill historical JSONB labels, ENUM interning at 100× scale.**

---

## 6. Testing Plan

### 6.1 Stage 1 — local gates (blocking commit per Phase 1a discipline)

1. `npm run lint` (tsc --noEmit) — clean. Type widening will surface consumer errors; each must resolve.
2. `npm run audit:numinput` — clean.
3. `npm run audit:secdef-null-tenant` — clean (new SECDEF RPC uses `_resolve_tenant_id()`, no NULL tenant risk).
4. `npm run audit:csp-backend-allowlist` — clean (no backend hostname change).
5. `npm run audit:no-string-err-fallback` — clean.
6. `npm run audit:secdef-auth-uid-vosi-owner` (per PR #67 audit) — verify `update_tenant_tier_config` uses `OWNER TO postgres`, not `vosi_rpc_owner`.
7. `npx vitest run` — full suite pass.

### 6.2 Stage 2 — deploy sequence

- Push to `main` → cloudbuild → deploy to staging (100% traffic).
- Staging smoke via Playwright (existing pipeline).
- Manual `scripts/promote-to-prod.sh <SHORT_SHA>` per `manual_prod_gate_after_real_tenant` memory.
- Post-promote: `gcloud builds list --limit=2` STATUS check per `deploy_verify_after_push` memory.

### 6.3 Stage 3 — production smoke on `Toko Jaya Makmur` (per `production-testing-tenant` memory)

**Scenario A — configure 3rd tier (happy path):**
1. Open Pengaturan → Tingkat Harga panel.
2. Set tier_3_label = "Distributor Kecil". Save.
3. Verify pills now show 3 options in: NewCustomerInlineForm, PelangganScreen edit, sales quotation.
4. Verify StockManager shows 3 price columns; open a product, set `price_tier_3`; save.
5. Create a new customer with tier="Distributor Kecil".
6. Start a new sales quote for that customer → verify quotation auto-selects tier_3 → confirm line uses `price_tier_3`.
7. Complete the sale → verify `sales_orders.items[N].pricing_tier_used='tier_3'` AND `sales_orders.items[N].pricing_tier_label='Distributor Kecil'` in DB via Management API JSONB query.
8. Print invoice PDF → verify label shows "Distributor Kecil".

**Scenario B — rename tier (label immutability check):**
1. Rename tier_3 from "Distributor Kecil" → "Grosir Besar Sekali". Save.
2. Verify new sales quotes use new label.
3. Reprint invoice from Scenario A step 8 → verify label STILL shows "Distributor Kecil" (snapshot preserved from JSONB).

**Scenario C — disable tier with orphans:**
1. Clear tier_3_label. Save.
2. Verify pills hide across app.
3. Open the customer created in Scenario A (has `default_pricing_tier='tier_3'`) → verify pill shows "Eceran" pressed (orphan fallback per §3.7). Edit shows current tenant tier set (no tier_3 option).
4. Start new sales quote for that customer → verify base `price` used (COALESCE fallback confirmed).
5. Re-enable tier_3_label = "Distributor Kecil" → verify pill for that customer resurfaces on tier_3 (default preserved in DB).

**Scenario D — modul off regression:**
1. Toggle `modul_multi_tier_price = FALSE` on Toko Jaya Makmur.
2. Verify NO tier UI anywhere: no pills, no filter chips, no tier column in StockManager, no Tingkat Harga panel.
3. Verify quotation/kasir use `price` unconditionally.
4. Re-toggle ON to restore.

**Scenario E — duplicate label rejection:**
1. In Tingkat Harga panel: set tier_2_label = "grosir", tier_3_label = "Grosir" → Save.
2. Verify RPC rejects with `TCFG_LABEL_DUPLICATE` → FE renders "Label tier duplikat" toast.

**Scenario F — length validation:**
1. Set tier_3_label = "AB" (2 chars) → Save.
2. Verify RPC rejects with `TCFG_LABEL_INVALID` + `hint='tier_3'` → FE renders "Label tier 3 harus 3-30 karakter".

---

## 7. Observability (CLAUDE.md non-negotiable)

- **Entry log** on Pengaturan → Tingkat Harga panel open:
  ```ts
  captureBreadcrumb({ category: 'feature', message: 'tier_config_panel_open', data: { tenant_id, user_id } });
  ```
- **Error log** on `update_tenant_tier_config` RPC failure:
  ```ts
  catch (err) {
    captureError(err, { feature: 'tier_config', action: 'update' });
    showToast(extractErrorMessage(err), 'warning');
  }
  ```
- **Usage counter** — increment via `console.info` audit log (per existing pattern from RPC idempotency logging):
  ```ts
  console.info('[tier_config] updated', { tenant_id, tier_count: activeTiers.length });
  ```
- **Sentry breadcrumb** on tier switch in kasir/quotation — verify existing coverage in `CatatPenjualanWizard.tsx`; add if missing.

---

## 8. Migration & Rollback

### 8.1 Forward migration files

- `supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql` — everything in §3.1-3.3 and §3.5. **No table alterations for the JSONB snapshot** (§3.4) — that's an RPC-level write.
- `supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql` — everything in §3.6 (both RPC `CREATE OR REPLACE`s).

Both idempotent (`IF EXISTS`, `IF NOT EXISTS`, `CREATE OR REPLACE`). Safe to re-run.

### 8.2 Rollback SQL (documented in migration header)

```sql
-- Rollback 20261115000543 — restore RPC bodies from slot 000325
-- (copy the exact CREATE OR REPLACE FUNCTION public.record_kasir_sale(...) body
--  and CREATE OR REPLACE FUNCTION public.create_tempo_invoice(...) body
--  from migration 20261115000325_audit_kasir_and_pembelian.sql at the time
--  Phase 1b landed)

-- Rollback 20261115000542
DROP FUNCTION IF EXISTS public.update_tenant_tier_config(TEXT,TEXT,TEXT,TEXT);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_default_pricing_tier_check
  CHECK (default_pricing_tier IN ('eceran','grosir'));
ALTER TABLE public.products DROP COLUMN IF EXISTS price_tier_3, DROP COLUMN IF EXISTS price_tier_4;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS tier_1_label, DROP COLUMN IF EXISTS tier_2_label, DROP COLUMN IF EXISTS tier_3_label, DROP COLUMN IF EXISTS tier_4_label;

-- pricing_tier_label inside items JSONB stays as a harmless extra key on historic rows —
-- no schema rollback needed. Older FE readers would ignore the unknown JSONB key.
```

Before running rollback: verify no live customer/product uses tier_3/tier_4 keys (or accept data loss on those rows). Rollback is a "restore to Phase 1a state" operation.

### 8.3 Post-migration advisor scan

Per CLAUDE.md: `mcp__plugin_supabase_supabase__get_advisors` after any migration. Supabase MCP currently disconnected — fallback: run advisor scan via Management API `/v1/projects/{ref}/database/advisors` endpoint, log findings to `progress.md`.

---

## 9. Adversarial Critique

- **"JSONB would be more flexible for future tier growth."** Countered in memo §3. At bounded 4-tier + snapshot label + read-time COALESCE fallback, columns are correct-fit AND easier to reverse than JSONB.
- **"kasir_expense_categories precedent uses a table — why not consistent?"** Countered in memo §3. Different problem shape (variable cardinality vs fixed 4). Codebase-consistency argument doesn't override problem-shape fit.
- **"Snapshot label bloats items JSONB."** At 100M items × ~15 bytes label = 1.5GB pre-compression. TOAST auto-compresses repeated short strings; effective ~500MB. Non-trivial but manageable at 10× scale.
- **"Owner disables tier_3, forgets, customers keep getting eceran pricing silently."** Mitigated by (a) cascade impact query at panel-save time showing "N customers will fall back to eceran"; (b) usage counter surfaces if owner has orphan customers.
- **"RPCs `record_kasir_sale` and `create_tempo_invoice` have been rewritten multiple times."** Grep-verified latest body of BOTH RPCs is in migration slot `20261115000325`. Plan writer must re-verify at implementation time in case another migration lands between spec-lock and implementation.
- **"Historic items JSONB without `pricing_tier_label` fall back to current tenant label — that's mutable semantics for old items."** Accepted trade-off. Backfill deferred to Phase 1c if compliance ever demands perfect coverage. Fallback is explicit + documented.
- **"Owner sets tier_3_label='Grosir' + tier_4_label='Grosir' — duplicate error blocks save."** Uniqueness enforced at RPC level per §3.5. Owner sees clear error message via TCFG_LABEL_DUPLICATE mapping.
- **"CSV bulk import backward compatibility — old CSV without tier_3/4 columns."** Parser tolerates missing columns (§4.4). Owner's existing exports still work. New exports include full column set.
- **"SECDEF + auth.* + vosi_rpc_owner pattern."** Verified via PR #67 audit that kasir-expense RPCs hotfixed to `OWNER TO postgres` because `vosi_rpc_owner` lacks USAGE on schema `auth`. This spec ships with `OWNER TO postgres` from the start. Plan writer should run `npm run audit:secdef-auth-uid-vosi-owner` (if that audit exists post-PR-#67) as a Stage 1 gate.

---

## 10. I Verified (double-check pass, 2026-07-28)

- **Existing tier surface (12 FE files):** `grep 'pricing_tier_used|default_pricing_tier|price_grosir|tier_pill|tier_dropdown' src/` = 66 hits across 12 files. All inventoried in §5.1.
- **`KasirScreen.tsx` has NO tier code:** `grep 'tier|price_grosir' src/components/KasirScreen.tsx` = 0 hits. Removed from earlier draft's file list.
- **`create_sales_order` has NO tier code:** `grep 'pricing_tier_used|price_grosir|tier_used' 20260725000003_create_sales_order_rpc.sql` = 0 hits. Removed from widening scope.
- **RPC latest bodies at slot `000325`:** `grep 'CREATE OR REPLACE FUNCTION.*record_kasir_sale' + '.*create_tempo_invoice' migrations/` → both live in `20261115000325_audit_kasir_and_pembelian.sql` (line 21 for kasir, line 432 for tempo). Slot `000232` I referenced in earlier draft was superseded.
- **`sales_lines` table does NOT exist:** `grep 'CREATE TABLE.*sales_lines|CREATE VIEW.*sales_lines' migrations/` = 0 hits. Items are JSONB on `sales_orders.items` (from `20260725000001:10`) and `kasir_transactions.items` (from `20260604000008:22`).
- **`_current_tenant_id()` function does NOT exist:** grep returned nothing. Kasir-expense RPCs use `public._resolve_tenant_id()` (verified at `20261115000523:23`). Adopted same in `update_tenant_tier_config`.
- **`admin_users WHERE role='Owner'` check pattern** verified at `20261115000523:32`. Adopted same.
- **Structured error taxonomy (`XXX_FORBIDDEN`/`XXX_LABEL_INVALID`/`XXX_LABEL_DUPLICATE` + `errcode`):** verified at `20261115000523:34, 43, 51`. Adopted same in `update_tenant_tier_config` as `TCFG_*` codes.
- **Dashboard reports / Laporan tier readers:** `grep 'pricing_tier_used|default_pricing_tier|_tier_label' src/lib/dashboardReports/ src/components/laporan/ src/lib/laporan/` = 0 hits. No widening needed there.
- **Migration slot allocation:** latest used `20261115000541` (`clip_inference_log_partial_status.sql`). Slots `000542` and `000543` free.
- **Backend Go tier code:** `grep 'pricing_tier_used|default_pricing_tier|price_grosir' backend-go/` = 0 hits. WA-onboard path untouched.
- **PIN pattern for Pengaturan config panels:** `grep 'PinPad|verify_owner_pin' src/components/pengaturan/ModulSwitchesPanel.tsx` and `KasirExpenseCategoriesPanel.tsx` → 0 hits. No PIN gate. Match precedent.
- **SECDEF+auth+owner pattern per PR #67:** kasir-expense RPCs hotfixed from `OWNER TO vosi_rpc_owner` to `OWNER TO postgres` because `vosi_rpc_owner` lacks USAGE on schema `auth`. Adopted `OWNER TO postgres` from the start.
- **Advisor consulted twice** in this session's brainstorming: once on JSONB vs relational tradeoff, once on scope completeness (surfaced disable-semantics + snapshot decisions before I locked).

---

## 11. Confidence Marking

- **[VERIFIED]** All greps + migration reads under §10.
- **[VERIFIED]** Backend Go tier-path is empty; WA-onboarded path uses DB default.
- **[VERIFIED]** No PIN gate on existing Pengaturan config panels.
- **[VERIFIED]** Authoritative RPC bodies for both `record_kasir_sale` and `create_tempo_invoice` at migration slot `20261115000325`.
- **[VERIFIED]** No `sales_lines` table exists; items live in JSONB on parent order tables.
- **[VERIFIED]** `_resolve_tenant_id()` is the correct tenant-scoping function; `_current_tenant_id()` does not exist.
- **[VERIFIED]** `KasirScreen.tsx` has no tier code; tier toggle lives in `CatatPenjualanWizard.tsx`.
- **[VERIFIED]** `OWNER TO postgres` is the correct SECDEF+auth-pattern per PR #67 hotfix; `vosi_rpc_owner` blocks `auth.uid()` due to schema `auth` USAGE grant blocking.
- **[REASONED]** Column-shape data model is optimal for fixed-4 cardinality at MSME scale (Kimball rule, COALESCE fallback pattern already in codebase).
- **[REASONED]** Snapshot label semantics are correct for financial-audit hygiene; MSME tenants may print invoices for tax reporting even if not currently observed.
- **[REASONED]** Orphan-tolerant disable is safer UX than block-if-in-use — reversible via re-enable, minimal footgun risk with cascade-impact preview at save time.
- **[ASSUMED]** No other RPC beyond `record_kasir_sale` + `create_tempo_invoice` reads `pricing_tier_used` in a way that requires widening. Plan writer should run one more grep sweep across all migration slots before locking widening scope.

---

## 12. Definition of Done (Phase 1b)

Per CLAUDE.md:
- Seven-lens thinking applied silently; findings surfaced above.
- Stop-hook gates green.
- Ship & verify stages 1 + 2 + 3 completed.
- Post-migration `get_advisors` scan run + findings triaged.
- New user-facing feature ships with observability (entry log + error log + usage counter).
- No new paid-API call → no cost approval needed.
- Irreversible-decision memo written (`2026-07-28-phase-1b-tier-config-decision.md`) and referenced from `progress.md`.
- `progress.md` entry with WHAT + WHY + links to memo + spec + commit.
- Miss-log entry appended for the "double-check surfaced 4 bugs" moment.
- No dead code, no TODO, no commented-out block.
- `advisor()` consulted twice (design phase — this session).
- Founder approved UI/UX before code was written (this spec's §4.1 mockup).

Before implementation begins: this spec goes through user review gate.
