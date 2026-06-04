# Warehouse Management — Per-Warehouse Stock Tracking & Transfers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stock item tracks how many units are in Gudang Atas and Gudang Bawah independently. Stock can be transferred between warehouses. Receiving goods (PO) and selling (Kasir) specify which warehouse is affected. The total `stocks.stock` column stays accurate automatically via a DB trigger.

**Architecture:** Two new integer columns on `stocks` (`stock_atas`, `stock_bawah`). A `BEFORE UPDATE/INSERT` trigger maintains `stock = stock_atas + stock_bawah`. Existing RPCs (`receive_purchase_order`, `deduct_stock_fifo`, `decrement_stock`) gain a `p_warehouse` parameter. A new `transfer_warehouse` RPC handles atomic moves. Frontend: StockManagerScreen shows split counts; ReceiveGoodsModal and KasirScreen SaleModal add a warehouse selector.

**Tech Stack:** React 18, TypeScript, Supabase JS client, PostgreSQL, Go

---

## Warehouse Names

Two hardcoded warehouses: `'atas'` (Gudang Atas) and `'bawah'` (Gudang Bawah). No `warehouses` table needed — the values are an enum constraint on the columns.

---

## Schema Changes

### Migration: `20260605000002_warehouse_columns.sql`

```sql
-- 1. Add columns
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS stock_atas  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_bawah INTEGER NOT NULL DEFAULT 0;

-- 2. Migrate existing stock to 'atas' (all existing stock treated as Gudang Atas)
UPDATE public.stocks SET stock_atas = stock WHERE stock > 0;

-- 3. Trigger: keep stock = stock_atas + stock_bawah
CREATE OR REPLACE FUNCTION public.sync_stock_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.stock := NEW.stock_atas + NEW.stock_bawah;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_stock_total
  BEFORE INSERT OR UPDATE ON public.stocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_stock_total();

-- 4. transfer_warehouse RPC: atomically move qty between warehouses
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku       text,
  p_from      text,  -- 'atas' | 'bawah'
  p_to        text,  -- 'atas' | 'bawah'
  p_qty       int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_from_qty int;
BEGIN
  IF p_from = 'atas' THEN
    SELECT stock_atas INTO v_from_qty FROM stocks WHERE sku = p_sku FOR UPDATE;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Atas tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_atas  = stock_atas  - p_qty,
           stock_bawah = stock_bawah + p_qty
     WHERE sku = p_sku;
  ELSE
    SELECT stock_bawah INTO v_from_qty FROM stocks WHERE sku = p_sku FOR UPDATE;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Bawah tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_bawah = stock_bawah - p_qty,
           stock_atas  = stock_atas  + p_qty
     WHERE sku = p_sku;
  END IF;
END;
$$;

-- 5. Update receive_purchase_order: add p_warehouse param, increment correct column
--    The current function body (from migration 20260604000015_fifo_rpcs.sql) validates
--    ORDERED status, updates items, increments stocks.stock, inserts stock_lots.
--    The ONLY change is: replace the single stock increment with a warehouse-aware one:
--
--    BEFORE:
--      UPDATE stocks SET stock = stock + item_qty_received WHERE sku = item_sku;
--    AFTER (inside the existing loop over p_conditions):
--      IF p_warehouse = 'atas' THEN
--        UPDATE stocks SET stock_atas = stock_atas + v_qty WHERE sku = v_sku;
--      ELSE
--        UPDATE stocks SET stock_bawah = stock_bawah + v_qty WHERE sku = v_sku;
--      END IF;
--    (The trigger keeps stocks.stock = stock_atas + stock_bawah automatically.)
--    stock_lots INSERT is unchanged.
--
-- Signature (adds p_warehouse param with DEFAULT):
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_conditions     jsonb,
  p_payment_due_at date DEFAULT NULL,
  p_invoice_url    text DEFAULT NULL,
  p_warehouse      text DEFAULT 'atas'
) RETURNS void LANGUAGE plpgsql AS $$ /* full body in implementation task */ $$;

-- 6. Update deduct_stock_fifo: add p_warehouse param, decrement correct column
--    Current function: iterates stock_lots oldest-first, deducts qty_remaining,
--    accumulates COGS, falls back to harga_modal. Also does:
--      UPDATE stocks SET stock = stock - p_qty WHERE sku = p_sku;
--    Change that UPDATE to be warehouse-aware:
--      IF p_warehouse = 'atas' THEN
--        UPDATE stocks SET stock_atas = stock_atas - p_qty WHERE sku = p_sku;
--      ELSE
--        UPDATE stocks SET stock_bawah = stock_bawah - p_qty WHERE sku = p_sku;
--      END IF;
--    (trigger keeps stocks.stock in sync)
--
-- Signature:
CREATE OR REPLACE FUNCTION public.deduct_stock_fifo(
  p_sku       text,
  p_qty       int,
  p_warehouse text DEFAULT 'atas'
) RETURNS numeric LANGUAGE plpgsql AS $$ /* full body in implementation task */ $$;
```

**Note on `receive_purchase_order` and `deduct_stock_fifo`:** The implementation plan provides the complete function bodies. The signatures above define the interfaces; the bodies extend the current logic to also update the warehouse column.

---

## TypeScript Type Changes

### `src/lib/supabaseClient.ts`

Add `stock_atas` and `stock_bawah` to `SupabaseStockItem`:

```typescript
export interface SupabaseStockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  stock_atas: number;   // NEW
  stock_bawah: number;  // NEW
  status: string;
  specs: Record<string, unknown>;
  harga_modal?: number | null;
  updated_at?: string;
}
```

### `src/types.ts`

Add to `StockItem`:

```typescript
export interface StockItem {
  // ... existing fields ...
  stock_atas?: number;   // NEW
  stock_bawah?: number;  // NEW
}
```

---

## Service Changes

### `src/lib/pembelianService.ts`

`receiveGoods` passes `p_warehouse` to the RPC:

```typescript
async receiveGoods(poId: string, receivedAt: string, conditions: ReceiveCondition[], paymentDueAt: string | null, invoiceUrl: string | null, warehouse: 'atas' | 'bawah'): Promise<void> {
  const { error } = await supabase!.rpc('receive_purchase_order', {
    p_po_id: poId,
    p_received_at: receivedAt,
    p_conditions: conditions,
    p_payment_due_at: paymentDueAt,
    p_invoice_url: invoiceUrl,
    p_warehouse: warehouse,
  });
  if (error) throw error;
},
```

Add `transferWarehouse`:

```typescript
async transferWarehouse(sku: string, from: 'atas' | 'bawah', to: 'atas' | 'bawah', qty: number): Promise<void> {
  const { error } = await supabase!.rpc('transfer_warehouse', {
    p_sku: sku, p_from: from, p_to: to, p_qty: qty,
  });
  if (error) throw error;
},
```

### `src/lib/supabaseClient.ts`

`stockService.decrementStock` gains `warehouse` param (passed to `decrement_stock` RPC and fallback path):

```typescript
async decrementStock(sku: string, qty: number, warehouse: 'atas' | 'bawah' = 'atas'): Promise<void> {
  // existing try: rpc('decrement_stock', { p_sku: sku, p_qty: qty, p_warehouse: warehouse })
  // existing fallback: reads stock_atas/stock_bawah, decrements correct field
}
```

---

## UI Changes

### `src/components/StockManagerScreen.tsx`

In the stock table row and edit panel:
- Replace single "Stok" display with **"Atas: X | Bawah: Y"** pill row
- Edit panel gains 2 qty inputs: `Stok Atas` and `Stok Bawah` (replacing the single `Stok` input)
- `saveEdit()` sends both `stock_atas` and `stock_bawah` to Supabase; trigger updates total automatically
- Add **"Transfer"** button per row that opens `WarehouseTransferModal`

### New `src/components/WarehouseTransferModal.tsx`

Props: `item: StockItem`, `onClose: () => void`, `onTransferred: () => void`, `showToast: (msg, type?) => void`

UI:
- Header: "Transfer Stok — {item.name}"
- Two cards side by side: "Dari Gudang Atas (X unit)" ↔ "Ke Gudang Bawah (Y unit)" with swap button
- Qty input (max = source warehouse qty)
- Confirm button → calls `purchaseOrderService.transferWarehouse` → `onTransferred()`
- Shows updated "Atas: X | Bawah: Y" after transfer

### `src/components/pembelian/ReceiveGoodsModal.tsx`

Add warehouse selector at the top of the modal (applies to all items in this receive event):

```tsx
<select value={warehouse} onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}>
  <option value="atas">Gudang Atas</option>
  <option value="bawah">Gudang Bawah</option>
</select>
```

Pass `warehouse` to `purchaseOrderService.receiveGoods(...)`.

### `src/components/KasirScreen.tsx`

In `SaleModal`, add warehouse selector (applies to all items in the sale):

```tsx
<select value={warehouse} onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}>
  <option value="atas">Gudang Atas</option>
  <option value="bawah">Gudang Bawah</option>
</select>
```

Pass `warehouse` to `stockService.decrementStock(sku, qty, warehouse)` in `handleSave`.

### `src/App.tsx`

`handleStockRefresh` and stock mapping: map `stock_atas` and `stock_bawah` from Supabase response into `StockItem`.

---

## Backward Compatibility

- `stocks.stock` total is always correct (trigger).
- Go backend (`db/stock.go` `SearchStockByName`) reads `stock` — unaffected.
- Calista stock context uses `stock` total — unaffected (warehouse is internal only).
- `deduct_stock_fifo` and `receive_purchase_order` get new params with `DEFAULT 'atas'` — existing calls without the param continue to work (default to Gudang Atas).

---

## Error Handling

- `transfer_warehouse` raises a PostgreSQL exception if source qty is insufficient — surfaces as a Supabase error, caught by the modal's catch block, shown as a toast.
- `deduct_stock_fifo` and `receive_purchase_order` do not check per-warehouse sufficiency — the total `stock` column is used for availability checks (existing behavior). The warehouse columns can go slightly negative in edge cases; the trigger will update `stock` correctly.
