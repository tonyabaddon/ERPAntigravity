# Phase 1b — Owner-Configurable Pricing Tiers (Irreversible-Decision Memo)

**Date:** 2026-07-28 (double-check-corrected version)
**Status:** Approved by founder in brainstorming session; corrected after founder-requested double-check surfaced 4 bugs in the initial draft.
**Type:** Irreversible-decision memo per CLAUDE.md scale-forward architecture discipline
**Author:** Claude (via `superpowers:brainstorming`, advisor consulted twice)
**Precedent:** [`2026-07-24-kasir-expense-categories-configurable-design.md`](2026-07-24-kasir-expense-categories-configurable-design.md) — owner-configurable-per-tenant-via-Pengaturan pattern, shipped 2026-07-28. Precedent also for the SECDEF RPC skeleton pattern (auth.uid + owner-role check + `_resolve_tenant_id()` + structured error codes).
**Prior phases:** Phase 1a [`2026-07-24-customer-pricing-tier-add-form-fix-design.md`](2026-07-24-customer-pricing-tier-add-form-fix-design.md) — shipped commit `f052d27` on 2026-07-25. Original 2-tier [`2026-06-24-multi-tier-pricing-design.md`](2026-06-24-multi-tier-pricing-design.md) — the eceran/grosir baseline.

---

## 1. Context

MSME founder request: owner should configure the **number and labels** of pricing tiers per tenant. Current fixed 2-tier scheme (`'eceran'` + `'grosir'`) doesn't cover distributor tenants who need retail + 2-3 wholesale tiers. Phase 1a exposed the tier picker in add/edit customer forms; Phase 1b makes the tier set itself configurable.

**Constraint founder committed to:**
- Cap at 4 tiers per tenant. Not "arbitrary N". Fixed bounded cardinality.
- Owner sets labels; tier ordering is fixed (tier_1 = base, tier_2..4 = optional higher-price tiers).
- Zero paid-API/infra-upgrade budget.

**Scale target:** 10K tenants × ~1K SKUs = 10M product rows at 10× ceiling. Tier storage adds ~16 bytes/row (2 numeric columns).

**Deadline:** None fixed.

---

## 2. Decision

Extend the existing 2-tier schema with 2 more fixed slots — no new table. Specifically:

- **`tenant_settings`** gains `tier_1_label` / `tier_2_label` (NOT NULL, defaults `'Eceran'`/`'Grosir'`) plus `tier_3_label` / `tier_4_label` (nullable — NULL means tier disabled for this tenant).
- **`products`** gains `price_tier_3 NUMERIC` and `price_tier_4 NUMERIC` (nullable, fall back to base `price` at read time via COALESCE, mirroring existing `price_grosir` fallback).
- **`customers.default_pricing_tier` CHECK constraint** widens from `IN ('eceran','grosir')` to `IN ('eceran','grosir','tier_3','tier_4')` — additive only, existing values stay valid.
- **`pricing_tier_label` snapshot lives INSIDE the items JSONB** on `public.sales_orders.items` and `public.kasir_transactions.items`. No new table column — line items were never a normalized table; they've always been JSONB. RPCs stamp `pricing_tier_label` as a sibling key next to the existing `pricing_tier_used`.
- **New SECDEF RPC `update_tenant_tier_config(labels)`** — mirrors kasir-expense pattern: `SET search_path = public`, `auth.uid()` + `admin_users` owner-role check, `public._resolve_tenant_id()` for tenant scoping, structured error codes (`TCFG_FORBIDDEN`/`TCFG_LABEL_INVALID`/`TCFG_LABEL_DUPLICATE` with `errcode` `P0403`/`P0400`/`P0409`), case-insensitive uniqueness per tenant, length 3-30 chars.
- **Existing RPCs `record_kasir_sale` and `create_tempo_invoice`** — both authoritative bodies live in migration slot `20261115000325_audit_kasir_and_pembelian.sql`. Both get widened: `INVALID_TIER` validation accepts all 4 keys; COALESCE cascade extends to `price_tier_3` / `price_tier_4`; both stamp `pricing_tier_label` into each `v_item` JSONB at write time. `create_sales_order` (slot `20260725000003`) does NOT need widening — it stores items as-is without tier validation.
- **Orphan-tolerant disable semantics:** owner may set `tier_3_label = NULL` at will. Existing customers with `default_pricing_tier='tier_3'` silently fall back to `'eceran'` at read time (via a `resolveEffectiveTier` helper in every FE reader). Products with `price_tier_3` populated stay in DB (invisible until re-enable). No cascade block, no reassignment required.

---

## 3. Alternatives Considered

| Alternative | Rejected because |
|---|---|
| **JSONB on `products.tier_prices`** | Advisor identified reversibility asymmetry (JSONB→columns is per-row unpack coordination, columns→drop is one ALTER). Financial audit needs row-level triggers per-tier column, natural on columns, custom jsonb-diff on JSONB. Codebase-consistency concern (junior reads "why not normalized here?"). Read-path advantage of JSONB doesn't apply at fixed-4 cardinality. |
| **Normalized `product_prices(product_id, tier_key, price)` table** | Read path adds a JOIN on every kasir/quotation/StockManager query — 200M+ queries/day at scale ceiling. `product_prices` grows to ~20M rows at ceiling; 10× storage vs column form. Bulk CSV import writes N rows per SKU vs one row per SKU. At bounded-4 cardinality, normalization is over-engineered — Kimball rule "fixed bounded cardinality → columns" fires. |
| **N fixed columns beyond 4 (`price_tier_5`, `_6`, ...)** | Founder capped at 4; YAGNI. Adding 5th later is one migration. |
| **Dedicated `tenant_pricing_tiers` table for metadata** | 4 rows per tenant is scaffolding-heavy — RLS + seed + audit setup for tiny fixed data. `tenant_settings` columns match problem shape (data always read alongside other settings, single-row lookup). Codebase-consistency argument (mirror `kasir_expense_categories`) doesn't override the shape mismatch — that table serves variable-cardinality per-tenant entities, not fixed slots. |
| **Dynamic-N architecture (unbounded owner-created tiers)** | Founder explicitly rejected — MSME/distributor cap is ~4. Would require normalized `product_prices` table, per-tier RPC surface (5 RPCs mirroring kasir-expense), dynamic pill count in every consumer. YAGNI at current scope. |
| **Just rename existing 2 tiers (`tier_1_label` / `tier_2_label` only)** | Doesn't solve the multi-distributor use case founder raised (3-4 pricing bands for retail + grosir kecil + grosir besar + distributor). |
| **Mutable historical invoice labels** (labels resolve to current `tenant_settings` at PDF render) | Simpler code, but breaks financial-audit norm — invoice PDF from Q3 could reprint in Q4 with a different label than what was originally issued. Some jurisdictions treat invoices as immutable legal artifacts. Founder explicitly chose snapshot semantics. |
| **Snapshot label as a new column on a normalized `sales_lines` table** | **Corrected 2026-07-28**: line items are stored as JSONB arrays on `sales_orders.items` / `kasir_transactions.items` — there is no normalized `sales_lines` table (verified via grep). Snapshot lives inside the JSONB item objects instead, alongside `pricing_tier_used`. Same immutability semantics, no schema change beyond what the RPCs already write into JSONB. |
| **Block tier disable when in-use** (RAISE `TIER_IN_USE` if customers/products/sales references it) | Protective but punishing UX — owner must bulk-reassign customers before renaming. Orphan-tolerant fallback (choose `'eceran'` at read time) is simpler and reversible (owner re-enables → data resurfaces). Founder chose orphan-tolerant. |

**Chosen: fixed 4-column extension with snapshot invoice label inside items JSONB + orphan-tolerant disable + case-insensitive label uniqueness enforced at SECDEF RPC.**

---

## 4. Consequences

### Locked (irreversible or expensive to reverse)
- **Column shape on `products` and `tenant_settings`.** If we ever regret the `tier_N_label` naming or want a normalized model, it's a migration + code sweep across all readers. Cheap now, more expensive as reader count grows.
- **Semantic keys `'eceran'` / `'grosir'` stay literal forever.** New tiers use slot names `'tier_3'` / `'tier_4'` (not `'grosir_besar'` etc.). Rationale: no destructive migration to existing customer/sales data. Cost: future dev sees mixed key style and needs the memo to explain. Documented in the design spec.
- **`pricing_tier_label` snapshot in items JSONB becomes canonical for historic display.** Once we start writing snapshot labels, going back to mutable semantics requires per-item JSONB label recompute. Since it's a JSONB field, adding a new key is non-destructive to older items (they just have `pricing_tier_used` without the label — renderer falls back).

### Reversible
- **Tier count 4 → 5+.** Add another `tier_5_label` column + `price_tier_5` column, widen CHECK, extend RPC cases. One migration, single code sweep. Not expensive.
- **Column drop for rollback.** `ALTER TABLE tenant_settings DROP COLUMN tier_3_label, tier_4_label; ALTER TABLE products DROP COLUMN price_tier_3, price_tier_4; ALTER TABLE customers ...revert CHECK; DROP FUNCTION update_tenant_tier_config; CREATE OR REPLACE FUNCTION record_kasir_sale / create_tempo_invoice ...restore body from slot 000325;` — clean rollback in 5 statements. `pricing_tier_label` inside JSONB items stays as harmless extra key on historic rows — no schema rollback needed there.

### Blast radius
- 13 files touched (revised down from 14 after double-check confirmed `KasirScreen.tsx` has no tier code).
- 2 migrations (schema + RPC widening).
- Every current reader of `default_pricing_tier` / `pricing_tier_used` needs to handle 4 possible values instead of 2. TypeScript union widening will surface most sites via compile errors.
- Backend Go WA path (`backend-go/internal/db/customers.go:22`) unchanged — still defaults to `'eceran'`.

---

## 5. Scale-forward Check (6 questions per CLAUDE.md)

1. **Ceiling at 10× scale (10K tenants, 100M rows on hot tables):**
   - `products` row-width grows by 2 numeric columns (~16 bytes). At 10M product rows = +160MB fleet-wide. Negligible.
   - `tenant_settings` grows by 4 TEXT columns × avg 12 bytes = 480KB fleet-wide. Rounding error.
   - `sales_orders.items` / `kasir_transactions.items` JSONB per-item grows by ~15 bytes (`"pricing_tier_label": "Grosir"` uncompressed). At 100M sales-line JSONB items = +1.5GB pre-compression. Postgres TOAST auto-compresses repeated short strings; effective footprint ~500MB. Non-trivial but manageable at 10×.
   - **What breaks first at 100× scale (100K tenants, 1B rows):** JSONB items on `sales_orders` become the dominant storage cost. Partitioning by `(tenant_id, created_at)` remains viable; label compression via short codes (`"pt_label":"1"`) is a Phase 1c option if it ever matters. Not blocking at 10×.

2. **Hot path:** kasir/quotation reads `products.*` — no JOIN added. Sales revenue analytics still hit each order's items JSONB (unchanged). PDF render adds `item.pricing_tier_label` read from the same JSONB item object (no additional row read).

3. **Partition-ready:** `products` PK unchanged; `sales_orders` and `kasir_transactions` PK unchanged. Partitioning trigger at 10M rows on `(tenant_id, created_at)` remains viable.

4. **Idempotency:** all 2 migrations use `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + re-add, `CREATE OR REPLACE FUNCTION`. Safe to re-run per CLAUDE.md guardrail. Backfill of `pricing_tier_label` on historic JSONB items: **skipped** (fallback logic in renderer handles missing key as "resolve to current tenant label" for pre-Phase-1b items). New items always stamp label.

5. **Long ops:** none. No data-carrying migration; all defaults + additive columns. Migration executes in <5s at ceiling.

6. **Cost curve:** zero. No paid API, no infra upgrade, no larger Cloud Run instance needed. Storage overhead <2% at 10× scale.

---

## 6. Follow-up Work

### Same-PR (part of Phase 1b implementation)
- Impact analysis + full file inventory (see design spec §5.1).
- Vitest coverage for `getActiveTiers` helper, generalized pill component, Pengaturan panel form validation, RPC widening smoke.
- `progress.md` entry linking memo + spec + commit.
- Miss-log entry for the "double-check surfaced 4 bugs" moment (this session).

### Deferred (Phase 1c or later)
- Visual pill palette per tier — currently pill 3 and 4 reuse the purple token.
- Backfill historical items JSONB with `pricing_tier_label` — currently deferred (renderer falls back to current tenant label). One-shot per-item JSONB upsert migration if audit ever requires perfect snapshot coverage.
- JSONB label compression via short codes (e.g., `"pt_label":"1"` → tenant maps 1→'Grosir') if fleet-wide storage becomes a concern at 100× scale.
- Phase 2: SKU-quantity tiering (buy-more-get-cheaper). Explicitly out of Phase 1b.

### Monitoring commitments (per CLAUDE.md observability requirement)
- **Entry log** on Pengaturan tier panel open: breadcrumb `tier_config_panel_open` with `{tenant_id, user_id}`.
- **Error log** on `update_tenant_tier_config` RPC failure: `captureError(err, { feature: 'tier_config', action: 'update' })`.
- **Usage counter** — `console.info('[tier_config] updated', { tenant_id, tier_count })` on successful config change.
- **Sentry breadcrumb** on tier switch in kasir/quotation — verify existing coverage in `CatatPenjualanWizard.tsx`; add if missing.

### Rollback plan
Documented in §4 (Consequences → Reversible). Full rollback SQL committed alongside forward migration as inline commentary in the migration file header.
