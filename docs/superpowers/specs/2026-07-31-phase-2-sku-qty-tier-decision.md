# Phase 2 — SKU Qty Tier Pricing (Irreversible-Decision Memo)

**Date:** 2026-07-31
**Status:** Approved by founder in brainstorming session; corrected after advisor consultation surfaced 3 gaps closed autonomously.
**Type:** Irreversible-decision memo per CLAUDE.md scale-forward architecture discipline
**Author:** Claude (via `superpowers:brainstorming`, advisor consulted twice)
**Prior phases:**
- Phase 1a `2026-07-24-customer-pricing-tier-add-form-fix-design.md` (shipped 2026-07-25) — customer default tier picker on add form.
- Phase 1b `2026-07-28-phase-1b-tier-config-design.md` (shipped 2026-07-29) — owner-configurable 2-4 customer pricing tiers + JSONB label snapshot.
- Kasir-expense-categories precedent (shipped 2026-07-28) — variable-cardinality per-tenant table + SECDEF RPC pattern.

---

## 1. Context

MSME founder request originally deferred to Phase 2: *"beli >5 maka dapat harga special, dll"* — quantity-triggered discount pricing per SKU. Distinct dimension from Phase 1a/1b (which prices by WHO the customer is) — Phase 2 prices by HOW MUCH the customer buys in a single transaction line.

**Real-world MSME context:**
- Warung / toko klontong: 1 pcs eceran, 6+ (1 lusin) grosir → 2 tiers.
- Toko sembako: 1 pack eceran, 1 karton (10-24) grosir, 1 dus (100+) wholesaler → 3 tiers.
- Distributor B2B (LTC Glodok / Garindo Jaya Panel persona): 1-4 eceran, 5-19 grosir kecil, 20-99 grosir besar, 100+ distributor → 4-5 tiers.

Every segment already uses ladder pricing in their physical price list. Phase 2 formalises the pattern so kasir auto-applies + upsell hint.

**Constraints founder committed to:**
- Per-line qty threshold ONLY (not cumulative cart / customer / month).
- Absolute price per tier (not discount % off base) — matches physical price list; distributor bulk-CSV expansion is Phase 3.
- Cap 5 tiers per SKU.
- Threshold semantic inclusive: `qty >= min_qty`.
- Interaction with Phase 1a/1b customer tier: **highest-discount wins** — compute customer tier price AND qty tier price, apply the LOWER.
- Chip on cart line displays the rule that FIRED (customer tier label if won, "Vol N+" if qty tier won, nothing if base).
- Upsell hint on cart line when qty is below next tier AND that tier would beat current price.
- No PIN gate on owner config (mirror Phase 1b precedent).

**Scale target:** 10K tenants × ~1K SKUs = 10M product rows at 10× ceiling. Qty tier storage adds ~3-5 rows per SKU that uses this feature (variable — many SKUs will have 0).

**Deadline:** None fixed.

---

## 2. Decision

Ship a normalized per-tenant per-stock qty-tier table + 2 SECDEF RPCs for owner config + widen sales-writing RPCs to compute `min(customer_tier_price, qty_tier_price)` server-side + stamp qty-tier snapshot into items JSONB.

- **`public.stock_qty_price_tiers`** — new table `(id UUID PK, tenant_id UUID FK tenants(id) ON DELETE CASCADE, stock_id UUID FK stocks(id) ON DELETE CASCADE, min_qty INT CHECK (min_qty >= 2), price NUMERIC CHECK (price > 0), created_at, updated_at)` with UNIQUE(stock_id, min_qty). RLS via `t_select_own` (authenticated read scoped to tenant) + `t_select_own_secdef` (allow `vosi_rpc_owner` RPC read per PR #67 hotfix). Max 5 rows per stock enforced at RPC.
- **`public.set_stock_qty_tiers(p_stock_id UUID, p_tiers JSONB)` SECDEF RPC** — owner-only via `admin_users WHERE role='Owner'`, `_resolve_tenant_id()` scoping, `OWNER TO postgres` per PR #67 hotfix. Replaces the entire tier set for the stock (DELETE + INSERT). Validates: each tier `min_qty >= 2`, `price > 0`, `price < stocks.price` (warning-level, not hard-reject, per §3), tier count ≤ 5, no duplicate min_qty. Error taxonomy `QTP_*` (`QTP_FORBIDDEN` P0403, `QTP_INVALID_MIN_QTY` P0400, `QTP_INVALID_PRICE` P0400, `QTP_TOO_MANY_TIERS` P0400, `QTP_STOCK_NOT_FOUND` P0404).
- **`public.delete_all_stock_qty_tiers(p_stock_id UUID) SECDEF RPC`** — clears all qty tiers for the stock (owner-only, same auth pattern).
- **Widen `record_kasir_sale` + `create_tempo_invoice`** (both authoritative in slot `20261115000325`, already widened by Phase 1b `20261115000543` — Phase 2 widens further):
  - Fetch applicable qty tier per item: `SELECT price FROM stock_qty_price_tiers WHERE stock_id = X AND min_qty <= line_qty ORDER BY min_qty DESC LIMIT 1`.
  - Compute effective price: `v_qty_tier_won := v_qty_tier_price IS NOT NULL AND v_qty_tier_price < v_customer_tier_price` — server-authoritative.
  - Validate client-supplied `unit_price` matches `min(customer_tier_price, qty_tier_price)`, OR accept a `p_manual_override` per-line flag that skips validation.
  - Stamp per-item JSONB: `qty_tier_min_qty INT` (the applied threshold, e.g., 10 — null if not won) + `qty_tier_applied BOOL` (true iff qty tier actually won over customer tier at write time).
- **FE consumers** implement 3 new UI elements:
  - Owner: inline "price ladder" mini table in `ProductForm` + `StockTableView` — progressive-disclosure `+ Tambah tier volume` button, max 5 rows.
  - Kasir cart line: **status chip** `Vol {min_qty}+` when `qty_tier_applied=true` (shown even for historic invoice reprint via JSONB read); **upsell hint** `Tip: beli {next_min_qty}+ pcs jadi Rp {next_price}/pcs` when `line_qty < next_tier_min_qty` AND `next_tier_price < current_unit_price`.
  - Kasir manual override: when kasir edits `unit_price` on the line, chip switches to **"Manual"** label. Qty change re-triggers auto-apply and DISCARDS manual override (matches Phase 1b cart re-price effect on customer switch).
- **Migration slots:** `20261115000545` (schema + `set_stock_qty_tiers` + `delete_all_stock_qty_tiers` RPCs) + `20261115000546` (widen `record_kasir_sale` + `create_tempo_invoice`). Both idempotent.

---

## 3. Alternatives Considered

| Alternative | Rejected because |
|---|---|
| **Single tier per SKU (Option A)** | Ceiling too low. Distributor persona (LTC Glodok / Garindo Jaya Panel) has 4-5 tiers in real price lists; single-tier forces them to collapse or wait. Same schema can serve warung (1-2 tiers) AND distributor (4-5) if we ship multi-tier from day one. Zero extra complexity for warung — they just use 1 row. |
| **Cumulative qty across cart / customer / month (Option C)** | Rare in MSME retail — cumulative pricing is enterprise loyalty program territory. Complex aggregation logic + retroactive recompute if line qty changes. MSME kasir turnaround is 30-60 seconds per transaction; per-line thresholds match the actual pattern. |
| **Discount % / flat-Rp stacking on top of customer tier (Option D)** | Creates edge-case confusion ("Grosir customer + qty 10+ → discount 5% dari eceran-base atau grosir-tier?"). Owner mental model treats volume pricing as REPLACEMENT price, not stacked discount. Menambah cognitive load tanpa solving real MSME problem. |
| **JSONB on `stocks.qty_tiers`** | Different shape from Phase 1b (fixed columns for fixed cardinality). Qty tiers have VARIABLE cardinality per SKU (warung=1, distributor=5). Kimball rule fires the other way: variable cardinality → normalized table. Also easier RLS + FK integrity. |
| **N fixed columns on `stocks` (`qty_tier_1_min`, `qty_tier_1_price`, ..., `qty_tier_5_min`, `qty_tier_5_price`)** | Phase 1b pattern (fixed columns) worked because cardinality was fixed at 4. Here cardinality varies per SKU — fixed columns mean 10+ NULL columns per warung SKU (~99% of stocks). Awkward + wasteful. |
| **Wizard-per-SKU tier setup (Model Y)** | Owner mental model is TABLE (physical price list on paper). Wizard adds 3-step flow for a 1-row config. Non-tech-savvy owner clicks-then-clicks-then-clicks for what should be 1 keystroke. |
| **CSV-only bulk editor (Model Z)** | Non-tech-savvy owner doesn't open spreadsheet. Acceptable as OPT-IN supplement (Phase 3 bulk feature) but wrong primary UX. |
| **Popup confirm on kasir line-add (Model K2)** | Adds click per line-add. LTC Glodok transaction with 15 SKUs = 15 popups = flow-killing. Silent auto-apply matches kasir speed requirement. |
| **Explicit pill picker on kasir (Model K3)** | Shifts pricing responsibility to kasir who doesn't know which price is "right" (system does). Encourages error, slows kasir. |
| **Absolute price per tier VS discount % off base — chose absolute** | Discount % has real distributor appeal (base bump auto-applies to all tiers) but MSME warung/toko owner thinks absolute ("harga 8 ribu untuk 5 lusin"). Absolute matches physical price list mental model. Distributor 100-SKU pain solved separately via bulk CSV in Phase 3. |
| **Chip fires whenever qty ≥ min_qty (unconditional)** | Advisor caught: with highest-discount-wins, chip "Vol 10+" would mislead kasir when customer tier actually gave better price. Kasir answering customer question "kok harga ini?" gets wrong answer. Corrected: chip fires only when qty tier actually WON. |
| **Client pre-computes unit_price, RPC trusts** | Phase 1a/1b already server-authoritative (RPC computes `v_expected_price`, validates client match). Client-trust weakens audit story + enables client-side price manipulation. Server-authoritative extends existing pattern. |
| **Manual override sticks through qty change** | Phase 1b cart re-price effect on customer switch DISCARDS per-line discount ("the correct discount_amount_rp would require knowing the new pct×base"). Same principle here — qty change re-triggers auto-apply, manual override cleared. Kasir must re-apply override if intent survives. Deterministic + matches existing behavior. |

**Chosen:** Normalized `stock_qty_price_tiers` table + server-authoritative `record_kasir_sale`/`create_tempo_invoice` widening + inline price-ladder Owner UI + auto-apply Kasir chip + `qty_tier_min_qty` + `qty_tier_applied` JSONB snapshot.

---

## 4. Consequences

### Locked (irreversible or expensive to reverse)
- **New table `stock_qty_price_tiers`.** Reversible via DROP TABLE but every reader (RPCs, FE component, wrapper) is a code sweep to undo. Costs grow with adoption.
- **Snapshot key names in items JSONB (`qty_tier_min_qty`, `qty_tier_applied`).** Historic items JSONB is immutable — renaming these keys later means every historic-invoice renderer needs a compat shim.
- **RPC contract widening (`record_kasir_sale`, `create_tempo_invoice`)** — server-authoritative price computation. Reverting means FE has to pre-compute again, and audit story weakens. Not planned to reverse.
- **`qty_tier_applied=true` semantic:** locked as "qty tier price won over customer tier price at write time" (NOT "qty threshold triggered"). Documented explicitly so audit reviewers a year from now don't reverse-engineer.

### Reversible
- **Cap 5 → 6+ tiers per SKU:** widen RPC CHECK, no schema change. Cheap.
- **Absolute → discount %:** would need new column (`price_percent_off?`, `price_flat_off_rp?`) or new mode column. Not planned.
- **UI mode:** owner-toggle "hide upsell hint" not shipped; add later if requested (YAGNI).
- **Chip label wording ("Vol N+" vs "Volume N+" vs "Grosir Vol N+"):** UI-only, easy to iterate.

### Blast radius
- ~10-12 files touched (2 migrations + 1 new table + 2 new RPCs + 1 new component + 4 modified FE + 1 wrapper + tests).
- Every writer of `record_kasir_sale` / `create_tempo_invoice` items must supply `p_manual_override` per-item flag (backward compat: default `false`). Existing FE call site in `supabaseClient.ts:1487` passes items JSONB — needs the per-item flag added.
- Backend Go WA path (`backend-go/internal/db/customers.go:22`) unchanged.

---

## 5. Scale-forward Check (6 questions per CLAUDE.md)

1. **Ceiling at 10× scale (10K tenants, 100M rows on hot tables):**
   - `stock_qty_price_tiers`: assume 30% of SKUs use qty tiers × avg 3 tiers per active SKU × 10M stocks = 9M rows fleet-wide. ~40 bytes/row (PK, FKs, indexes, min_qty, price, timestamps) → ~360MB. Manageable.
   - `sales_orders.items` / `kasir_transactions.items` JSONB per-item grows by ~20 bytes (`"qty_tier_min_qty":10,"qty_tier_applied":true`). At 100M sales-line items = +2GB pre-compression. TOAST compresses repeated short strings; effective ~700MB.
   - **What breaks first at 100× scale (100K tenants, 1B rows):** JSONB items dominate. Same partitioning strategy as Phase 1b applies — `(tenant_id, created_at)` on parent tables.

2. **Hot path:** kasir/quotation line-add triggers 1 extra query per line: `SELECT price FROM stock_qty_price_tiers WHERE stock_id = X AND min_qty <= line_qty ORDER BY min_qty DESC LIMIT 1`. With `(stock_id, min_qty)` composite index this is a single index seek — <100μs. Per-sale of 15 lines = 15 extra seeks = 1-2ms overhead. Negligible.

3. **Partition-ready:** `stock_qty_price_tiers` partition-ready by `tenant_id` (FK cascade); `stocks` and `sales_orders`/`kasir_transactions` PK shapes unchanged.

4. **Idempotency:** all 2 migrations use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`. Safe to re-run. `set_stock_qty_tiers` RPC is transactional (DELETE + INSERT in one statement, all-or-nothing per stock).

5. **Long ops:** none. No data-carrying migration. Migration executes in <2s at ceiling.

6. **Cost curve:** zero. No paid API, no infra upgrade. Storage overhead <5% at 10× scale even accounting for JSONB item growth.

---

## 6. Follow-up Work

### Same-PR (part of Phase 2 implementation)
- Impact analysis + full file inventory (see design spec §5.1).
- Vitest coverage for `getApplicableQtyTier` helper, `QtyTiersEditor` component, ProductForm/StockTableView tier UI, CartRows chip + upsell hint, `set_stock_qty_tiers` RPC smoke via Management API.
- `progress.md` entry linking memo + spec + commit.

### Deferred (Phase 3+)
- **Discount %/flat-Rp mode** (base-bump auto-apply) — for distributor 100-SKU tenants. Requires adding `price_percent_off` + `price_flat_off_rp` columns to `stock_qty_price_tiers` + UI mode toggle.
- **Bulk CSV editor for qty tiers** (mirror Phase 1b `bulk_update_tier_prices`) — distributor bulk edit.
- **Cumulative qty across cart** — if MSME market demand surfaces (unlikely but noted).
- **Cross-SKU bundle pricing / promo** — separate feature, out of pricing tier scope.
- **PDF invoice per-line tier display** — currently no FE reads `pricing_tier_label` per Phase 1b Task 1c gap; Phase 2 has same gap for `qty_tier_min_qty`. Wire together when adding tier column to invoice PDF.
- **Owner-toggle "hide upsell hint"** — YAGNI for MVP.

### Monitoring commitments (per CLAUDE.md observability requirement)
- **Entry log** on Owner setting qty tiers: `console.info('[qty_tier] set', {tenant_id, stock_id, tier_count})`.
- **Error log** on `set_stock_qty_tiers` RPC failure: `captureError(err, {feature: 'qty_tier', action: 'set'})`.
- **Usage counter** — per-tenant metric of SKUs with qty tiers configured (surfaced via cascade impact if `modul_qty_tier_price` module flag is added later; for MVP shipped without flag — feature-always-on since backward-compat).
- **Sentry breadcrumb** on kasir qty tier auto-apply — verify wired into `CatatPenjualanWizard.tsx` cart re-price effect.

### Rollback plan
Documented in §4 (Consequences → Reversible). Full rollback SQL committed as inline comment in migration file header. Historic items JSONB with `qty_tier_*` keys become orphan/harmless if RPC widening reverted.
