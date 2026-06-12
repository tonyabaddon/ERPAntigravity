# Configurable N warehouses — design

**Status:** Spec • brainstormed 2026-06-13
**Replaces:** the hardcoded `stocks.stock_atas` + `stocks.stock_bawah` dual-warehouse model that ships today
**Defers to a separate spec:** the actual multi-tenant rollout (org_id everywhere else, per-tenant RLS, tenant onboarding, billing) — this spec only prepares the warehouse schema to BE tenant-aware

## 1. Why

Two driving facts came out of the 2026-06-12 e2e audit:

1. **The dual-warehouse model is operationally inert.** Of ~214 SKUs visible in Stock Manager, almost all sit at `Bawah: 0` — the second warehouse exists in the schema but the operator never uses it. The `Atas` / `Bawah` labels are baked into the schema (column names, RPC arguments, CHECK constraints, TypeScript union types, UI button labels), so they cannot be renamed, removed, or extended.
2. **The owner wants to sell the ERP to other tenants.** Different tenants will have different warehouse counts and names — one tenant has a single shop, another runs three branches, another adds a delivery van as its own pseudo-warehouse. A hardcoded 2-warehouse model with hardcoded names is incompatible with that goal.

This spec replaces the hardcoded dual-warehouse model with a configurable N-warehouse model that is tenant-aware in shape (`warehouses.tenant_id` column exists from day one, defaulting to NULL for the current single tenant) so the eventual multi-tenant migration does not need to revisit the warehouse schema.

## 2. Scope

**In scope**

- `warehouses` table — configurable list per tenant (currently the single tenant), each row has code / name / address / sort_order / is_default / is_active.
- `stock_levels` table — normalized per-(SKU, warehouse) qty replacing `stocks.stock_atas` + `stocks.stock_bawah`.
- `warehouse_audit_log` table — append-only audit (create / rename / set_default / deactivate / force_deactivate).
- Rewriting every stock-mutating RPC (`transfer_warehouse`, `decrement_stock`, `deduct_stock_fifo`, `seed_stock_row`, `commit_approved_adjustment`, `commit_opname`, `record_kasir_sale`, `receive_purchase_order`) to take `warehouse_id uuid` instead of `warehouse text`.
- Backfill migration that preserves the current Atas / Bawah split (seeds two warehouses, populates `stock_levels` from existing qty columns, backfills FK columns on the history tables).
- New `ManajemenGudangScreen` sidebar entry — add / rename / reorder / set-default / deactivate, gated by a new `can_manage_warehouses` permission.
- New shared `<WarehousePicker>` component — collapses to a label for N=1, renders pill toggles for N=2, switches to a dropdown for N≥3. Replaces every existing `'atas' | 'bawah'` toggle (StockManager, WarehouseTransferModal, StockAdjustmentModal, CartRows, ItemSearchPanel, ReceiveGoodsModal, PurchaseOrderFormPage, Opname session).
- Visual styling reuses the existing design system — `#012749` primary, `#2d8a4e` secondary, `#eff4ff` chip background, `#abc9f3` accent, `rounded-2xl` / `rounded-3xl` / `rounded-full` radius, `font-extrabold` headers, the existing badge / pill / inline-form patterns. No new tokens.

**Out of scope** (named explicitly so the user does not expect them)

- Full multi-tenant rollout (org_id on every other table, per-tenant RLS, tenant onboarding wizard, per-tenant auth, billing).
- Per-(SKU, warehouse) FIFO costing — FIFO `stock_lots` stay per-SKU; warehouse only affects which `stock_levels` row gets deducted. Mixing warehouse stock under a single FIFO lot is the documented behavior, accepted trade-off for MSME use.
- Two-step transfer approval (initiate → receive) — the build snapshot's Phase 3d work. Transfers stay single-shot here; the new model is orthogonal to that future change.
- Per-warehouse pricing, per-warehouse permissions, hierarchical / parent-child warehouses, warehouse types.
- Mobile / barcode flows.

## 3. Schema

### 3.1 New tables

```sql
CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NULL,                              -- reserved for Phase 2 multi-tenant; NULL = current single tenant
  code        text NOT NULL,                          -- short code, e.g. 'ATAS', 'JKT', 'BEKASI'
  name        text NOT NULL,                          -- display label
  address     text NULL,
  is_active   boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,         -- exactly one per tenant
  sort_order  int     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (code ~ '^[A-Z0-9_-]{2,16}$')
);

-- "exactly one default per tenant" — partial unique guard
CREATE UNIQUE INDEX warehouses_one_default_per_tenant
  ON warehouses (tenant_id) WHERE is_default;

-- Case-insensitive name uniqueness per tenant
CREATE UNIQUE INDEX warehouses_name_unique_per_tenant
  ON warehouses (tenant_id, lower(name));

CREATE TABLE stock_levels (
  sku           text NOT NULL REFERENCES stocks(sku) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  qty           int  NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, warehouse_id)
);

CREATE TABLE warehouse_audit_log (
  id           bigserial PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  actor_user_id uuid NOT NULL,
  action       text NOT NULL CHECK (action IN
    ('create','rename','set_default','deactivate','force_deactivate','reactivate','address_update','sort_update')),
  before       jsonb,
  after        jsonb,
  reason_note  text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- append-only: REVOKE UPDATE/DELETE + deny trigger same pattern as rakit_audit_log
```

### 3.2 Modified existing tables

- `stocks` — drop `stock_atas`, `stock_bawah`. Keep `stock` column as the cached `SUM(stock_levels.qty WHERE stock_levels.sku = stocks.sku)`, maintained by an AFTER INSERT/UPDATE/DELETE trigger on `stock_levels`. The existing `sync_stock_total` trigger is dropped — `stock_levels` becomes the source of truth.
- `stock_movements` — `warehouse text CHECK (warehouse IN ('atas','bawah'))` becomes `warehouse_id uuid NOT NULL REFERENCES warehouses(id)`. The `qty_before + qty_delta = qty_after` invariant is unchanged. REVOKE UPDATE/DELETE + deny trigger preserved.
- `stock_adjustments.warehouse` → `warehouse_id uuid REFERENCES warehouses(id)`.
- `stock_opname_counts.warehouse` → `warehouse_id uuid`.
- `orders.warehouse` → `warehouse_id uuid` (the channel-default warehouse lookup table moves into `warehouses.code` matching the channel name; defaults are seeded in the migration).
- `kasir_transaction_items.warehouse` → `warehouse_id uuid NULL` (NULL for service lines).
- `purchase_order_items.warehouse` → `warehouse_id uuid`.

### 3.3 Reserved-for-future columns

`warehouses.tenant_id` exists from day one and stays NULL until the Phase 2 multi-tenant migration backfills + sets NOT NULL. RPCs that compare `from.tenant_id = to.tenant_id` already use the predicate so the day multi-tenant lands no further RPC rewrite is needed.

## 4. RPCs

All RPCs stay `SECURITY DEFINER` + `SET search_path = public` + explicit `GRANT EXECUTE … TO authenticated`, matching the project's established pattern (see `seed_stock_row` in `…0017_revoke_stocks_writes.sql`).

| RPC | Old signature (today) | New signature |
|---|---|---|
| `transfer_warehouse` | `(p_sku text, p_from text, p_to text, p_qty int)` | `(p_sku text, p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_qty int)` |
| `decrement_stock` | `(p_sku text, p_warehouse text, p_qty int)` | `(p_sku text, p_warehouse_id uuid, p_qty int)` |
| `deduct_stock_fifo` | unchanged (FIFO stays per-SKU) | unchanged |
| `seed_stock_row` | `(p_sku, p_name, ..., p_stock_atas int, p_stock_bawah int)` | `(p_sku, p_name, ..., p_initial_levels jsonb)` where jsonb is `{<warehouse_id>: qty}` |
| `commit_approved_adjustment` | `(p_approval_id bigint)` | unchanged signature; reads `stock_adjustments.warehouse_id` internally |
| `commit_opname` | `(p_approval_id bigint)` | unchanged signature; reads `stock_opname_counts.warehouse_id` internally |
| `record_kasir_sale` | `(..., p_items jsonb)` items have `warehouse text` | `(..., p_items jsonb)` items have `warehouse_id uuid` |
| `receive_purchase_order` | `(..., p_warehouse text)` | `(..., p_warehouse_id uuid)` |
| `request_adjustment` | `(..., p_warehouse text)` | `(..., p_warehouse_id uuid)` |

New RPCs:

- `create_warehouse(p_code, p_name, p_address NULL, p_sort_order DEFAULT 100) → uuid` — Owner-only; first warehouse for a tenant is auto-`is_default=true`. Writes `warehouse_audit_log` row.
- `update_warehouse(p_id, p_name?, p_address?, p_sort_order?) → void` — Owner-only; logs `rename` / `address_update` / `sort_update` audit rows for each changed field.
- `set_default_warehouse(p_id) → void` — Owner-only; flips `is_default=false` on the current default + `is_default=true` on `p_id` in one txn.
- `deactivate_warehouse(p_id) → void` — guards against (a) `EXISTS(SELECT 1 FROM stock_levels WHERE warehouse_id=p_id AND qty > 0)`, (b) `EXISTS(SELECT 1 FROM approval_requests JOIN stock_adjustments USING(...) WHERE warehouse_id=p_id AND status='pending')`, (c) `EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id=p_id AND created_at > now() - interval '30 days')`. Each guard raises a distinct `P0001` message so the frontend can render the right toast. Blocks deactivating the current default outright.
- `force_deactivate_warehouse(p_id, p_pin text, p_reason text) → void` — Owner-only; calls `verify_owner_pin` (reuses the CRIT-2 PIN flow), then bypasses the three guards above and writes a `force_deactivate` audit row. Stock at the deactivated warehouse stays in `stock_levels` (qty > 0) — the operator must transfer it out or run an opname to write it off before doing this. Reason note is required.

## 5. UI

### 5.1 New screen — `ManajemenGudangScreen`

Sidebar entry between `AI Stock Manager` and `Stok Opname` (both inventory-adjacent). Visual style matches the existing User Management screen (header card, expandable row pattern). Three sections in one screen:

- **Daftar Gudang.** Table: code · name · address (truncated) · sort_order · `is_default` badge · `is_active` badge · current `SUM(stock_levels.qty)` for this warehouse · row actions (Edit / Set Default / Deactivate). Default row sits at the top with a crown icon matching the Owner indicator pattern in User Management.
- **Tambah Gudang.** Inline form below the table (collapsible card pattern from Pengaturan): code field (auto-uppercased + slug validation), name, optional address, optional sort_order (defaults 100). On save, calls `create_warehouse` RPC; on success, table refreshes and the form collapses.
- **Riwayat Perubahan.** Last 50 `warehouse_audit_log` rows, time-relative ("3 menit lalu"), action-tagged with the same coloured pill pattern as `ApprovalRequestRow`.

Permission gate: a new `can_manage_warehouses` flag (default true for Owner, false for Staff / Supervisor / Finance), added to `ALL_PERMISSIONS` in `types.ts`. Sidebar entry + screen route are hidden when the flag is false.

### 5.2 Shared `<WarehousePicker>` component

`src/components/warehouse/WarehousePicker.tsx`. One component to replace every existing `'atas' | 'bawah'` toggle. Modes:

- `single` — for choosing one warehouse (cart line, adjustment target).
- `pair` — for choosing two distinct warehouses (transfer from / to). Renders two `single` pickers side-by-side with a "Tukar" swap arrow between (same arrow as `WarehouseTransferModal` today).

Adaptive UI:

- **N=1** — collapses to a read-only label "Gudang Utama · 211 pcs".
- **N=2** — two pill toggles, blue / amber colour pair matching the current Atas / Bawah pills.
- **N≥3** — switches to a dropdown that lists each warehouse with its current qty for the SKU as a secondary line.

Props: `{ skuQtyByWarehouseId: Record<string, number>, value: string | null, onChange: (id) => void, mode: 'single' | 'pair', valueTo?: string, onChangeTo?: (id) => void, excludeIds?: string[], disabled?: boolean }`.

### 5.3 Modified screens

- `StockManagerScreen` — per-row stock pills become a map render from `stock_levels`. For N ≤ 3 the pills inline like today; for N ≥ 4 they collapse into a "📦 N gudang" chip that expands on click. The `⚖ Penyesuaian` action (added in UX-1) opens `StockAdjustmentModal` with the default warehouse pre-selected. New SKU form gains a "Saldo Awal per Gudang" jsonb input that defaults to `{<warehouse_id>: 0}` for every currently-active warehouse (i.e., explicit zero in each, per §10).
- `WarehouseTransferModal` — From / To picker uses `<WarehousePicker mode="pair">`. `excludeIds` ensures To ≠ From.
- `StockAdjustmentModal` — warehouse argument uses `<WarehousePicker mode="single">`.
- `CartRows` + `ItemSearchPanel` (Penjualan Baru) — line-level warehouse picker.
- `ReceiveGoodsModal` + `PurchaseOrderFormPage` — destination warehouse picker.
- `StockOpnameSessionView` — scope payload renders `warehouse_id` → `name` via the lookup map.
- `KasirInvoiceModal` + `SalesInvoicePDF` — render `warehouse.name` instead of literal 'atas' / 'bawah'.

### 5.4 Service layer

- New `warehousesService` in `src/lib/supabaseClient.ts`: `fetchAll`, `fetchActive`, `create`, `update`, `setDefault`, `deactivate`, `forceDeactivate`, `fetchAuditLog`.
- New `useWarehouses()` hook in `src/hooks/useWarehouses.ts` — caches the active list and subscribes to `postgres_changes` on the `warehouses` table. All UI components above pull from it.
- `KasirItem.warehouse: 'atas' | 'bawah' | null` → `warehouse_id: string | null`. Existing `WarehouseLocation` type alias is removed.

## 6. Data flow

### 6.1 Creating a warehouse

```
ManajemenGudangScreen.create
  → warehousesService.create({code, name, address?, sort_order})
    → POST /rest/v1/rpc/create_warehouse (SECURITY DEFINER, can_manage_warehouses)
       1. validate code matches /^[A-Z0-9_-]{2,16}$/
       2. INSERT into warehouses (tenant_id = NULL, is_default = NOT EXISTS(SELECT 1 FROM warehouses WHERE tenant_id IS NULL))
       3. INSERT warehouse_audit_log {action: 'create', actor: auth.uid(), after: row_to_json(new)}
    → returns the new warehouse row
  → useWarehouses() cache invalidates, all consumers re-render
```

### 6.2 Recording a sale

```
CartRows line has warehouse_id chosen via WarehousePicker
  → kasirService.recordSale({items: [{sku, qty, warehouse_id, ...}, ...]})
    → record_kasir_sale RPC:
       for each item:
         IF item.sku IS NULL → service line, skip stock
         ELSE
           - SELECT qty INTO v_qty FROM stock_levels
             WHERE sku=... AND warehouse_id=... FOR UPDATE
           - IF NOT FOUND raise 'SKU X belum ada di gudang Y' (P0001)
           - IF v_qty < item.qty raise 'Stok di gudang Y tidak cukup: tersedia X, diminta Y' (P0001)
           - UPDATE stock_levels SET qty = qty - item.qty, updated_at = now()
           - call deduct_stock_fifo(sku, item.qty) → returns FIFO cost (per-SKU, warehouse-agnostic)
           - INSERT stock_movements (sku, warehouse_id, qty_delta=-item.qty, qty_before=v_qty,
             qty_after=v_qty-item.qty, source='sale_kasir', related_doc_type='kasir_transaction', ...)
       INSERT kasir_transactions row
       INSERT kasir_transaction_items per line (each carries warehouse_id)
       reserve invoice_no via next_kasir_number
       upsert customer
```

The `stocks.stock` SUM column is maintained by a trigger on `stock_levels` so legacy consumers reading `stocks.stock` still see the correct total without any code change.

### 6.3 Transferring stock

```
WarehouseTransferModal: from_warehouse_id, to_warehouse_id, qty
  → purchaseOrderService.transferWarehouse(sku, from_id, to_id, qty)
    → transfer_warehouse RPC (SECURITY DEFINER, fixed in CRIT-1):
       1. assert p_from_warehouse_id <> p_to_warehouse_id
       2. assert (SELECT tenant_id FROM warehouses WHERE id = p_from) =
                 (SELECT tenant_id FROM warehouses WHERE id = p_to)
       3. assert both warehouses is_active = true
       4. SELECT qty INTO v_from FROM stock_levels
          WHERE sku=p_sku AND warehouse_id=p_from FOR UPDATE
       5. IF NOT FOUND raise 'SKU tidak punya stok di gudang asal'
       6. IF v_from < p_qty raise 'Stok gudang asal tidak cukup'
       7. UPDATE stock_levels SET qty = qty - p_qty WHERE sku=p_sku AND warehouse_id=p_from
       8. INSERT INTO stock_levels (sku, warehouse_id, qty)
          VALUES (p_sku, p_to, p_qty)
          ON CONFLICT (sku, warehouse_id) DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty
       9. Log 2 stock_movements rows:
          - source='transfer_out', warehouse_id=p_from, qty_delta=-p_qty
          - source='transfer_in',  warehouse_id=p_to,   qty_delta=+p_qty
```

### 6.4 Approval flow (adjustment / opname / price_change)

Unchanged in shape. The `stock_adjustments` and `stock_opname_counts` tables now carry `warehouse_id` instead of `warehouse text`; the `commit_approved_*` RPCs read/write `stock_levels` instead of `stocks.stock_atas/bawah`. Owner-PIN gate (CRIT-2) is preserved end-to-end.

### 6.5 Receiving a PO

```
ReceiveGoodsModal collects per-line warehouse_id
  → receive_purchase_order RPC:
     per line:
       - INSERT or UPDATE stock_levels (sku, warehouse_id, qty += received_qty)
       - INSERT stock_lots (sku, unit_cost, qty_remaining=received, received_at=now)
         -- NOTE: stock_lots stay per-SKU. FIFO does NOT split by warehouse.
       - INSERT stock_movements (warehouse_id, source='purchase_receive', related_doc_id=po_item.id, ...)
```

### 6.6 Read paths needing update

- `StockManagerScreen` — fetch `stocks` left-joined to `stock_levels` grouped to a `Record<sku, Record<warehouse_id, qty>>`. One round trip; the existing card UI walks the map and renders one pill per warehouse.
- Dashboard + Laporan "stok tipis" — `SELECT sku, name, SUM(qty) AS total FROM stocks JOIN stock_levels USING(sku) GROUP BY sku, name HAVING SUM(qty) < threshold`.
- `KasirInvoiceModal` + `SalesInvoicePDF` — render `warehouse.name` (via FK lookup) instead of the literal 'atas' / 'bawah'.

## 7. Migration story

Three SQL migrations applied in order. All run inside transactions; any failure rolls back leaving the system in its pre-migration shape.

### 7.1 Migration 1 — additive, zero downtime

`supabase/migrations/20260613000001_warehouses_phase1_schema.sql`

1. `CREATE TABLE warehouses` (tenant_id NULL).
2. `CREATE TABLE stock_levels`.
3. `CREATE TABLE warehouse_audit_log` (append-only triggers same pattern as `rakit_audit_log`).
4. Seed two rows: `warehouses(code='ATAS', name='Gudang Atas', is_default=true)` and `warehouses(code='BAWAH', name='Gudang Bawah')`.
5. Populate `stock_levels`:
   ```sql
   INSERT INTO stock_levels (sku, warehouse_id, qty)
   SELECT sku, (SELECT id FROM warehouses WHERE code='ATAS' AND tenant_id IS NULL), stock_atas FROM stocks
   UNION ALL
   SELECT sku, (SELECT id FROM warehouses WHERE code='BAWAH' AND tenant_id IS NULL), stock_bawah FROM stocks;
   ```
6. Add `warehouse_id uuid` columns to `stock_movements`, `stock_adjustments`, `stock_opname_counts`, `orders`, `kasir_transaction_items`, `purchase_order_items` — all nullable for now.
7. Backfill `warehouse_id` from existing `warehouse text` values via `UPDATE … SET warehouse_id = (SELECT id FROM warehouses WHERE tenant_id IS NULL AND code = upper(warehouse))`.
8. Install the `stocks.stock = SUM(stock_levels.qty)` trigger; drop the old `sync_stock_total` trigger.
9. At this point both old and new columns coexist. Frontend still reads `stock_atas/bawah`; nothing breaks.

### 7.2 Migration 2 — RPCs accept new signature, also keep old

`supabase/migrations/20260613000002_warehouses_phase2_rpcs.sql`

1. `CREATE OR REPLACE` every stock-mutating RPC with the new `warehouse_id uuid` signature.
2. For each RPC, keep an overload that accepts `warehouse text` for backwards-compat — internally it resolves `text → warehouse_id` (via `code = upper(warehouse)` lookup) and calls the new path. Old frontend keeps working during the deploy window.
3. New RPCs: `create_warehouse`, `update_warehouse`, `set_default_warehouse`, `deactivate_warehouse`, `force_deactivate_warehouse`, `fetch_warehouse_audit_log`.
4. `deactivate_warehouse` triggers / inline checks assert qty=0 across `stock_levels`, no pending approvals reference this warehouse, no `stock_movements` in the last 30 days.

### 7.3 Migration 3 — cutover (only after the new frontend is in production for ≥ 1 day with no errors)

`supabase/migrations/20260613000003_warehouses_phase3_cutover.sql`

1. `ALTER TABLE stock_movements ALTER COLUMN warehouse_id SET NOT NULL`.
2. Drop the `warehouse text` columns from `stock_movements`, `stock_adjustments`, `stock_opname_counts`, `orders`, `kasir_transaction_items`, `purchase_order_items`.
3. Drop the text-overloads of every RPC added in Migration 2.
4. Drop `stock_atas` and `stock_bawah` columns from `stocks`. The sync trigger is replaced by the `stock_levels` SUM trigger from Migration 1.
5. `warehouses.tenant_id` stays nullable — Phase 2 multi-tenant migration backfills + sets NOT NULL later.

### 7.4 Reversal

Migrations 1+2 are reversible by `DROP CASCADE` of the new tables + `ALTER TABLE … DROP COLUMN warehouse_id`. Migration 3 is one-way; the `stock_atas/bawah` columns are rebuildable from `stock_levels` via:

```sql
SELECT sku,
       SUM(qty) FILTER (WHERE warehouse_id = (SELECT id FROM warehouses WHERE code='ATAS')) AS stock_atas,
       SUM(qty) FILTER (WHERE warehouse_id = (SELECT id FROM warehouses WHERE code='BAWAH')) AS stock_bawah
  FROM stock_levels GROUP BY sku;
```

Documented in this spec, not shipped as a migration.

### 7.5 Apply order

Extend `scripts/apply-pending-migrations.sh` so the 3 new migrations land after the existing `20260612000001..3` set.

## 8. Error handling

- **`stock_levels` row missing.** Per design every (SKU, active-warehouse) pair has a row at SKU-creation time, but a SKU created BEFORE a warehouse was added won't. `decrement_stock`, `transfer_warehouse`, `commit_approved_adjustment` raise `'Stok untuk SKU X di Gudang Y belum ada'` (P0001), mapped to a frontend toast: *"SKU ini belum tersedia di gudang yang dipilih. Tambahkan stok lewat penerimaan PO atau opname dulu."*
- **Sale from a warehouse with insufficient qty.** Existing `'Stok Gudang X tidak cukup'` message stays, with warehouse `name` interpolated from FK.
- **Deactivate guard.** `deactivate_warehouse(id)` raises three distinct messages:
  - `'masih ada N SKU dengan stok > 0 di gudang ini'`
  - `'masih ada N approval pending untuk gudang ini'`
  - `'gudang masih ada ledger entry dalam 30 hari terakhir'`
  Each maps to its own toast. The force-deactivate RPC requires Owner PIN (reuses `verify_owner_pin`) and writes a `warehouse_audit_log` row tagged `force_deactivate`.
- **Default warehouse change.** The PARTIAL UNIQUE on `is_default` would normally fail when setting a second row to true; `set_default_warehouse(id)` wraps the swap in one txn: `UPDATE warehouses SET is_default=false WHERE tenant_id=… AND is_default=true; UPDATE warehouses SET is_default=true WHERE id=p_id;`. Deactivating the current default is blocked entirely — operator must set another default first; toast: *"Tidak bisa nonaktifkan gudang default. Set gudang lain sebagai default dulu."*
- **Concurrent transfer / sale on the same `(sku, warehouse_id)`.** The `SELECT … FOR UPDATE` on `stock_levels` serializes them. The trigger that updates `stocks.stock` runs in the same txn so the cached SUM never lags by more than the txn.
- **Trigger drift on `stocks.stock`.** Cheap insurance: nightly integration check asserts `SUM(stock_levels.qty) = stocks.stock` per SKU; mismatch logs to `pengawasan_views` rather than blocking. `stock_levels` is the auth source-of-truth; `stocks.stock` is a hint.
- **Migration mid-flight failure.** All three migrations wrap in `BEGIN..COMMIT`. A failure in Migration 1 leaves `stocks.stock_atas/bawah` intact and the new tables nonexistent. A failure in Migration 2 leaves old RPC signatures still wired. Migration 3 only runs after a manual go-ahead, so a partial state can't accidentally land in production.
- **Tenant-mismatch (Phase 2-relevant).** Even though `tenant_id` is NULL today, the FK assertion `from_warehouse.tenant_id = to_warehouse.tenant_id` is included in `transfer_warehouse` so the predicate works the day multi-tenant lands.

## 9. Testing

| What | Where | Why |
|---|---|---|
| **Schema integration** — create warehouse, insert stock_levels, observe `stocks.stock` SUM updates via the trigger | `tests/integration/warehouses-schema.test.ts` | Catches the trigger going stale or wrong (the highest-risk new piece) |
| **RPC suite** — happy path + `'Stok tidak cukup'` + `'belum ada'` + transfer self + transfer across tenant (assert raises) | `tests/integration/warehouses-rpc.test.ts` | Matches the existing per-RPC pattern (`record_kasir_sale_test`, `stock_movements_test`) |
| **Migration replay** — apply 1+2, write some test rows, apply 3, verify row counts unchanged + `stocks.stock_atas` column dropped | `tests/integration/warehouses-migration.test.ts` (skipped by default; manual when reviewing the migration) | Validates the cutover is safe |
| **Deactivation guard** — each of the 3 deactivate-blocks raises the right code | same RPC test file | Each branch independently |
| **Default-warehouse swap** — call `set_default_warehouse` repeatedly, observe exactly-one invariant | same | The partial UNIQUE + RPC contract |
| **Chrome MCP smoke after deploy** — create warehouse, rename, deactivate (blocked), force-deactivate (PIN), transfer between two custom-named warehouses, observe stock pills update | manual run via the existing audit pattern | Confirms the new picker component renders correctly for 1 / 2 / 3 / 4 warehouses, and Pengaturan + StockManager paths still work |
| **`npm run lint`** before every commit | CI / local | TS rewires need to compile, no runtime checks here |

## 10. Open items

These are choices the implementation plan will need to land, called out so the writing-plans step can decide each one explicitly rather than leaving them as TBD in code.

- **Default warehouse for channel-routed orders.** Today `orders.warehouse` is inferred from the channel (walk-in / tokped / grosir / WhatsApp). The Phase 1 migration backfills the existing inference into `warehouse_id` via `code = upper(warehouse)`. Going forward, an explicit `channel_warehouse_default` map (channel → warehouse_id, configurable in `ManajemenGudangScreen`) is recommended but is left for the implementation plan to scope.
- **New SKU creation form — "Saldo Awal per Gudang".** Decided in §5.3: default to explicit zero in every currently-active warehouse. Operator can override any cell. Listed here only to flag that the implementation plan must wire the seed_stock_row jsonb argument from the form payload.
- **Audit-log retention.** No retention policy is specified — the table is append-only and small (one row per warehouse action). Implementation plan can decide whether to expose a "show only last 90 days" filter in the Riwayat Perubahan UI.

## 11. References

- 2026-06-12 e2e audit findings (`progress.md` § "E2E audit fixes")
- Build snapshot 2026-06-12 § 4 (Inventory module) + § 13.4 (multi-tenant gap)
- `supabase/migrations/20260605000002_warehouse_columns.sql` (current dual-warehouse schema)
- `supabase/migrations/20260607000017_revoke_stocks_writes.sql` (REVOKE pattern these RPCs follow)
- `supabase/migrations/20260607000019_verify_owner_pin.sql` (PIN pattern force_deactivate reuses)
- `supabase/migrations/20260612000001_fix_transfer_warehouse_security_definer.sql` (the CRIT-1 fix that established the SECURITY DEFINER contract for transfer_warehouse)
