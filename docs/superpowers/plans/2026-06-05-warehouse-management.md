# Warehouse Management — Per-Warehouse Stock Tracking & Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stock item tracks units in Gudang Atas and Gudang Bawah independently. Stock can be transferred between warehouses. PO receiving and Kasir sales specify which warehouse is affected. `stocks.stock` total stays accurate automatically via a DB trigger.

**Architecture:** Two new integer columns on `stocks` (`stock_atas`, `stock_bawah`). A `BEFORE UPDATE/INSERT` trigger maintains `stock = stock_atas + stock_bawah`. `decrement_stock` RPC gains `p_warehouse` parameter. `receive_purchase_order` gains `p_warehouse` parameter. New `transfer_warehouse` RPC handles atomic moves. Frontend: StockManagerScreen shows split counts; ReceiveGoodsModal and KasirScreen SaleModal add a warehouse selector. `upsertStock` sends `stock_atas`/`stock_bawah` instead of `stock`.

**Tech Stack:** React 18, TypeScript, Supabase JS client, PostgreSQL

---

## Files

| File | Change |
|---|---|
| `supabase/migrations/20260605000002_warehouse_columns.sql` | Create — columns + trigger + RPCs |
| `src/lib/supabaseClient.ts` | Modify — SupabaseStockItem type, decrementStock, upsertStock |
| `src/types.ts` | Modify — StockItem type |
| `src/lib/pembelianService.ts` | Modify — receiveGoods + transferWarehouse |
| `src/components/StockManagerScreen.tsx` | Modify — display, edit panel, Transfer button |
| `src/components/WarehouseTransferModal.tsx` | Create — new modal |
| `src/components/pembelian/ReceiveGoodsModal.tsx` | Modify — warehouse selector |
| `src/components/KasirScreen.tsx` | Modify — SaleModal warehouse selector |
| `src/App.tsx` | Modify — map stock_atas/stock_bawah in stock load |

---

### Task 1: SQL migration — columns, trigger, and RPCs

**Files:**
- Create: `supabase/migrations/20260605000002_warehouse_columns.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260605000002_warehouse_columns.sql`:

```sql
-- 1. Add warehouse columns
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS stock_atas  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_bawah INTEGER NOT NULL DEFAULT 0;

-- 2. Migrate existing stock to Gudang Atas
UPDATE public.stocks SET stock_atas = stock WHERE stock > 0;

-- 3. Trigger: keep stock = stock_atas + stock_bawah
CREATE OR REPLACE FUNCTION public.sync_stock_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.stock := NEW.stock_atas + NEW.stock_bawah;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_total ON public.stocks;
CREATE TRIGGER trg_sync_stock_total
  BEFORE INSERT OR UPDATE ON public.stocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_stock_total();

-- 4. decrement_stock RPC: warehouse-aware stock decrement
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku       text,
  p_qty       int,
  p_warehouse text DEFAULT 'atas'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_warehouse = 'atas' THEN
    UPDATE public.stocks
    SET stock_atas = GREATEST(0, stock_atas - p_qty), updated_at = now()
    WHERE sku = p_sku;
  ELSE
    UPDATE public.stocks
    SET stock_bawah = GREATEST(0, stock_bawah - p_qty), updated_at = now()
    WHERE sku = p_sku;
  END IF;
END;
$$;

-- 5. transfer_warehouse RPC: atomically move qty between warehouses
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku       text,
  p_from      text,
  p_to        text,
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

-- 6. receive_purchase_order: add p_warehouse param, increment correct column
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text DEFAULT NULL,
  p_conditions     jsonb DEFAULT '{}'::jsonb,
  p_warehouse      text DEFAULT 'atas'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item         record;
  v_cond         jsonb;
  v_qty_received int;
  v_qty_damaged  int;
  v_damage_notes text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_orders WHERE id = p_po_id AND status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'PO % is not in ORDERED status', p_po_id;
  END IF;

  FOR v_item IN
    SELECT id, sku, qty, unit_cost FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

      IF v_qty_received < 0 OR v_qty_damaged < 0 THEN
        RAISE EXCEPTION 'qty_received and qty_damaged must be non-negative for item %', v_item.id;
      END IF;

      IF v_qty_received + v_qty_damaged > v_item.qty THEN
        RAISE EXCEPTION 'qty_received + qty_damaged (%) exceeds ordered qty (%) for item %',
          v_qty_received + v_qty_damaged, v_item.qty, v_item.id;
      END IF;

      UPDATE public.purchase_order_items SET
        qty_received  = v_qty_received,
        qty_damaged   = v_qty_damaged,
        damage_notes  = v_damage_notes,
        damage_status = CASE WHEN v_qty_damaged > 0 THEN 'PENDING_RETURN' ELSE 'NONE' END
      WHERE id = v_item.id;

      IF v_qty_received > 0 AND v_item.sku IS NOT NULL THEN
        IF p_warehouse = 'atas' THEN
          UPDATE public.stocks
          SET stock_atas = stock_atas + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        ELSE
          UPDATE public.stocks
          SET stock_bawah = stock_bawah + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        END IF;

        INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
        VALUES (v_item.sku, p_po_id, v_item.unit_cost, v_qty_received, v_qty_received, COALESCE(p_received_at, now()));
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET
    status         = 'RECEIVED',
    received_at    = p_received_at,
    payment_due_at = p_payment_due_at,
    invoice_url    = COALESCE(p_invoice_url, invoice_url)
  WHERE id = p_po_id;
END;
$$;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `warehouse_columns`
- `query`: *(the SQL above)*

- [ ] **Step 3: Verify**

Run via `mcp__plugin_supabase_supabase__execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stocks'
AND column_name IN ('stock_atas', 'stock_bawah');

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('sync_stock_total', 'decrement_stock', 'transfer_warehouse', 'receive_purchase_order');

SELECT trigger_name FROM information_schema.triggers
WHERE trigger_schema = 'public' AND trigger_name = 'trg_sync_stock_total';
```

Expected: 2 column rows, 4 function rows, 1 trigger row.

- [ ] **Step 4: Smoke-test**

```sql
-- Check migration of existing stock to stock_atas
SELECT sku, stock, stock_atas, stock_bawah FROM public.stocks LIMIT 3;
-- Expected: stock_atas = stock for all rows, stock_bawah = 0

-- Test trigger: updating stock_atas should update stock automatically
UPDATE public.stocks SET stock_bawah = 5 WHERE sku = (SELECT sku FROM stocks LIMIT 1);
SELECT sku, stock, stock_atas, stock_bawah FROM public.stocks LIMIT 1;
-- Expected: stock = stock_atas + 5

-- Revert test change
UPDATE public.stocks SET stock_bawah = 0 WHERE sku = (SELECT sku FROM stocks LIMIT 1);
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260605000002_warehouse_columns.sql
git commit -m "feat(db): add warehouse stock columns, trigger, and RPCs"
```

---

### Task 2: TypeScript type changes

**Files:**
- Modify: `src/lib/supabaseClient.ts` (line 19 — SupabaseStockItem interface)
- Modify: `src/types.ts` (line 83 — StockItem interface)

- [ ] **Step 1: Update SupabaseStockItem**

In `src/lib/supabaseClient.ts`, find `SupabaseStockItem` at line 19. Replace:

```typescript
export interface SupabaseStockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: string;
  specs: Record<string, string | number>;
  updated_at?: string;
  harga_modal?: number | null;
}
```

With:

```typescript
export interface SupabaseStockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  stock_atas: number;
  stock_bawah: number;
  status: string;
  specs: Record<string, string | number>;
  updated_at?: string;
  harga_modal?: number | null;
}
```

- [ ] **Step 2: Update StockItem in types.ts**

In `src/types.ts`, find `StockItem` (around line 83). Add `stock_atas` and `stock_bawah` as optional fields:

```typescript
export interface StockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  stock_atas?: number;
  stock_bawah?: number;
  status: 'Sinkron' | 'Stok Tipis';
  specs: Record<string, string | number>;
  harga_modal?: number | null;
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors (there may be TypeScript errors about upsertStock sending `stock_atas`/`stock_bawah` as required — those will be fixed in Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts src/types.ts
git commit -m "feat(types): add stock_atas/stock_bawah to SupabaseStockItem and StockItem"
```

---

### Task 3: Service method changes

**Files:**
- Modify: `src/lib/supabaseClient.ts` (lines ~48, ~756)
- Modify: `src/lib/pembelianService.ts` (line 134)

- [ ] **Step 1: Update supabaseService.upsertStock to send warehouse columns**

In `src/lib/supabaseClient.ts`, find `upsertStock` at line 48. Replace the upsert payload to include `stock_atas` and `stock_bawah` and remove `stock` (the trigger computes it):

```typescript
async upsertStock(item: SupabaseStockItem) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { data, error } = await supabase
    .from('stocks')
    .upsert({
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: item.price,
      stock_atas: item.stock_atas ?? item.stock,
      stock_bawah: item.stock_bawah ?? 0,
      status: item.status,
      specs: item.specs,
      harga_modal: item.harga_modal ?? null,
      updated_at: new Date().toISOString()
    })
    .select();

  if (error) {
    throw error;
  }
  return data;
},
```

Note: `stock_atas ?? item.stock` ensures CSV-uploaded items (which don't know about warehouses) treat their `stock` as Gudang Atas stock.

- [ ] **Step 2: Update stockService.decrementStock**

In `src/lib/supabaseClient.ts`, find `decrementStock` at line ~756. Replace:

```typescript
async decrementStock(sku: string, qty: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty });
  if (error) {
    // Fallback: fetch current stock, then update
    const { data, error: fetchErr } = await supabase.from('stocks').select('stock').eq('sku', sku).single();
    if (fetchErr) throw fetchErr;
    const newStock = Math.max(0, (data.stock as number) - qty);
    const { error: updateErr } = await supabase.from('stocks').update({ stock: newStock, updated_at: new Date().toISOString() }).eq('sku', sku);
    if (updateErr) throw updateErr;
  }
},
```

With:

```typescript
async decrementStock(sku: string, qty: number, warehouse: 'atas' | 'bawah' = 'atas'): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty, p_warehouse: warehouse });
  if (error) {
    const col = warehouse === 'atas' ? 'stock_atas' : 'stock_bawah';
    const { data, error: fetchErr } = await supabase.from('stocks').select(col).eq('sku', sku).single();
    if (fetchErr) throw fetchErr;
    const current = (data as Record<string, number>)[col] ?? 0;
    const { error: updateErr } = await supabase.from('stocks').update({
      [col]: Math.max(0, current - qty),
      updated_at: new Date().toISOString(),
    }).eq('sku', sku);
    if (updateErr) throw updateErr;
  }
},
```

- [ ] **Step 3: Update pembelianService.receiveGoods**

In `src/lib/pembelianService.ts`, find `receiveGoods` at line 134. Replace the function signature and call to pass `p_warehouse`:

```typescript
async receiveGoods(poId: string, params: {
  received_at: string;
  payment_due_at: string;
  invoice_url?: string;
  conditions: Record<string, { qty_received: number; qty_damaged: number; damage_notes?: string }>;
  warehouse: 'atas' | 'bawah';
}): Promise<void> {
  const { error } = await supabase.rpc('receive_purchase_order', {
    p_po_id: poId,
    p_received_at: params.received_at,
    p_payment_due_at: params.payment_due_at,
    p_invoice_url: params.invoice_url ?? null,
    p_conditions: params.conditions,
    p_warehouse: params.warehouse,
  });
  if (error) throw error;
},
```

- [ ] **Step 4: Add transferWarehouse to pembelianService**

In `src/lib/pembelianService.ts`, add a new method after `receiveGoods`:

```typescript
async transferWarehouse(sku: string, from: 'atas' | 'bawah', to: 'atas' | 'bawah', qty: number): Promise<void> {
  const { error } = await supabase!.rpc('transfer_warehouse', {
    p_sku: sku, p_from: from, p_to: to, p_qty: qty,
  });
  if (error) throw error;
},
```

- [ ] **Step 5: Build to verify**

```bash
npm run build
```

Expected: TypeScript errors about `ReceiveGoodsModal.tsx` calling `receiveGoods` without `warehouse` — that's expected and fixed in Task 6. No other errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabaseClient.ts src/lib/pembelianService.ts
git commit -m "feat(service): add warehouse param to decrementStock, receiveGoods; add transferWarehouse"
```

---

### Task 4: StockManagerScreen.tsx — warehouse display and edit

**Files:**
- Modify: `src/components/StockManagerScreen.tsx`

- [ ] **Step 1: Update editValues state type**

In `StockManagerScreen.tsx`, find the `editValues` useState at line ~156. Replace:

```typescript
const [editValues, setEditValues] = useState<Record<string, { price: string; stock: string; harga_modal: number | null; specs: Record<string, string> }>>({});
```

With:

```typescript
const [editValues, setEditValues] = useState<Record<string, { price: string; stock: string; stock_atas: string; stock_bawah: string; harga_modal: number | null; specs: Record<string, string> }>>({});
```

- [ ] **Step 2: Update startEdit to include stock_atas/stock_bawah**

Find `startEdit` at line ~208. Replace:

```typescript
const startEdit = (item: StockItem) => {
  setEditingSkus(prev => new Set([...prev, item.sku]));
  setEditValues(prev => ({
    ...prev,
    [item.sku]: {
      price: String(item.price),
      stock: String(item.stock),
      harga_modal: item.harga_modal ?? null,
      specs: Object.fromEntries(
        Object.entries(item.specs ?? {}).map(([k, v]) => [k, String(v)])
      ),
    },
  }));
};
```

With:

```typescript
const startEdit = (item: StockItem) => {
  setEditingSkus(prev => new Set([...prev, item.sku]));
  setEditValues(prev => ({
    ...prev,
    [item.sku]: {
      price: String(item.price),
      stock: String(item.stock),
      stock_atas: String(item.stock_atas ?? item.stock),
      stock_bawah: String(item.stock_bawah ?? 0),
      harga_modal: item.harga_modal ?? null,
      specs: Object.fromEntries(
        Object.entries(item.specs ?? {}).map(([k, v]) => [k, String(v)])
      ),
    },
  }));
};
```

- [ ] **Step 3: Update saveEdit to use stock_atas/stock_bawah**

Find `saveEdit` at line ~227. Replace:

```typescript
const saveEdit = (sku: string) => {
  const vals = editValues[sku];
  if (!vals) return;
  const item = stockList.find(i => i.sku === sku);
  if (!item) return;
  const price = parseInt(vals.price.replace(/\D/g, '')) || 0;
  const stock = parseInt(vals.stock) || 0;
  const name = generateName(item.category, vals.specs);
  if (!name) {
    showToast('⚠️ Mohon lengkapi spesifikasi produk!', 'warning');
    return;
  }
  const updated = stockList.map(i =>
    i.sku === sku
      ? { ...i, price, stock, harga_modal: vals.harga_modal ?? null, specs: vals.specs, name, status: (stock < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron' }
      : i
  );
  onStockUpdate(updated);
  cancelEdit(sku);
  showToast('✅ Produk berhasil diperbarui.');
};
```

With:

```typescript
const saveEdit = (sku: string) => {
  const vals = editValues[sku];
  if (!vals) return;
  const item = stockList.find(i => i.sku === sku);
  if (!item) return;
  const price = parseInt(vals.price.replace(/\D/g, '')) || 0;
  const stock_atas = parseInt(vals.stock_atas) || 0;
  const stock_bawah = parseInt(vals.stock_bawah) || 0;
  const stock = stock_atas + stock_bawah;
  const name = generateName(item.category, vals.specs);
  if (!name) {
    showToast('⚠️ Mohon lengkapi spesifikasi produk!', 'warning');
    return;
  }
  const updated = stockList.map(i =>
    i.sku === sku
      ? { ...i, price, stock, stock_atas, stock_bawah, harga_modal: vals.harga_modal ?? null, specs: vals.specs, name, status: (stock < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron' }
      : i
  );
  onStockUpdate(updated);
  cancelEdit(sku);
  showToast('✅ Produk berhasil diperbarui.');
};
```

- [ ] **Step 4: Replace stock column in table row with Atas/Bawah display**

Find the stock input column in the row (around line 721–730):

```tsx
                  <div className="w-full md:w-28 shrink-0 flex items-center gap-2">
                    <input
                      type="text"
                      value={item.stock}
                      onChange={e => handleCellEdit(item.sku, 'stock', e.target.value)}
                      disabled={isEditing}
                      className={`w-full px-3 py-2.5 bg-white rounded-xl focus:ring-1 text-center text-xs font-extrabold shadow-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isWarning ? 'border-rose-400 focus:ring-rose-500 text-rose-600 border-2' : 'border-slate-200 focus:ring-[#2d8a4e] text-slate-800'}`}
                    />
                    <span className="text-xs font-extrabold text-slate-400 shrink-0">Pcs</span>
                  </div>
```

Replace with:

```tsx
                  <div className="w-full md:w-36 shrink-0">
                    <div className="flex gap-1 text-[10px] font-bold">
                      <span className="bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg text-blue-700">
                        Atas: {item.stock_atas ?? item.stock}
                      </span>
                      <span className="bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg text-amber-700">
                        Bawah: {item.stock_bawah ?? 0}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-400 mt-0.5 font-semibold">
                      Total: {item.stock} pcs
                    </div>
                  </div>
```

- [ ] **Step 5: Add Transfer button to row action buttons**

Find the row action buttons div (around line 744–757) that contains the Edit and Delete buttons. Add a Transfer button after the Edit button:

```tsx
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => isEditing ? cancelEdit(item.sku) : startEdit(item)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black border cursor-pointer transition-all ${isEditing ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-[#c7d7f5] bg-[#eff4ff] text-[#1e3d60] hover:bg-blue-100'}`}
                    >
                      {isEditing
                        ? <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" />Tutup</span>
                        : '✏ Edit'
                      }
                    </button>
                    <button
                      onClick={() => setTransferItem(item)}
                      className="px-3 py-1.5 rounded-full text-[10px] font-black border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-all"
                    >
                      ⇄ Transfer
                    </button>
                    <button onClick={() => handleDeleteItem(item.sku)} className="p-1.5 text-rose-400 hover:text-rose-600 rounded-full hover:bg-rose-50 cursor-pointer transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
```

- [ ] **Step 6: Add transferItem state and WarehouseTransferModal import**

At the top of the `StockManagerScreen` component function (after the existing `useState` declarations), add:

```typescript
import WarehouseTransferModal from './WarehouseTransferModal';
```

(Add this import at the top of the file with other imports.)

Inside the component function, add:

```typescript
const [transferItem, setTransferItem] = useState<StockItem | null>(null);
```

At the bottom of the JSX return (before the closing `</div>` of the outer container), add the modal:

```tsx
      {transferItem && (
        <WarehouseTransferModal
          item={transferItem}
          onClose={() => setTransferItem(null)}
          onTransferred={() => {
            setTransferItem(null);
            showToast('✅ Transfer stok berhasil.');
          }}
          showToast={showToast}
        />
      )}
```

- [ ] **Step 7: Replace single Stok input in edit panel with Stok Atas + Stok Bawah inputs**

In the edit panel (inside `{isEditing && vals && (...)}` around line 760), find:

```tsx
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">Stok (Pcs)</label>
                        <input
                          type="number"
                          value={vals.stock}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], stock: e.target.value } }))}
                          className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                        />
                      </div>
```

Replace with:

```tsx
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest pl-1">Stok Gudang Atas</label>
                        <input
                          type="number"
                          min="0"
                          value={vals.stock_atas}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], stock_atas: e.target.value } }))}
                          className="w-full bg-blue-50 rounded-xl px-3 py-2 border border-blue-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold text-amber-600 uppercase tracking-widest pl-1">Stok Gudang Bawah</label>
                        <input
                          type="number"
                          min="0"
                          value={vals.stock_bawah}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], stock_bawah: e.target.value } }))}
                          className="w-full bg-amber-50 rounded-xl px-3 py-2 border border-amber-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
```

- [ ] **Step 8: Build to verify (expect missing WarehouseTransferModal)**

```bash
npm run build
```

Expected: TypeScript error about `WarehouseTransferModal` not found — that's correct. Fixed in Task 5.

- [ ] **Step 9: Commit**

```bash
git add src/components/StockManagerScreen.tsx
git commit -m "feat(stock): show per-warehouse breakdown, add Transfer button, warehouse edit inputs"
```

---

### Task 5: Create WarehouseTransferModal.tsx

**Files:**
- Create: `src/components/WarehouseTransferModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/components/WarehouseTransferModal.tsx`:

```tsx
import React, { useState } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService } from '../lib/pembelianService';

interface WarehouseTransferModalProps {
  item: StockItem;
  onClose: () => void;
  onTransferred: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function WarehouseTransferModal({ item, onClose, onTransferred, showToast }: WarehouseTransferModalProps) {
  const [from, setFrom] = useState<'atas' | 'bawah'>('atas');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);

  const to: 'atas' | 'bawah' = from === 'atas' ? 'bawah' : 'atas';
  const fromQty = from === 'atas' ? (item.stock_atas ?? item.stock) : (item.stock_bawah ?? 0);
  const toQty = from === 'atas' ? (item.stock_bawah ?? 0) : (item.stock_atas ?? item.stock);
  const fromLabel = from === 'atas' ? 'Gudang Atas' : 'Gudang Bawah';
  const toLabel = from === 'atas' ? 'Gudang Bawah' : 'Gudang Atas';
  const fromColor = from === 'atas' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-amber-50 border-amber-200 text-amber-700';
  const toColor = from === 'atas' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700';

  async function handleConfirm() {
    const n = parseInt(qty);
    if (!n || n <= 0) { showToast('Masukkan jumlah yang valid.', 'warning'); return; }
    if (n > fromQty) { showToast(`Stok ${fromLabel} hanya ${fromQty} pcs.`, 'warning'); return; }
    setSaving(true);
    try {
      await purchaseOrderService.transferWarehouse(item.sku, from, to, n);
      onTransferred();
    } catch (e: any) {
      showToast(e.message ?? 'Transfer gagal.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-extrabold text-[#012749]">Transfer Stok — {item.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`flex-1 border rounded-2xl p-3 text-center ${fromColor}`}>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1">Dari</div>
              <div className="text-sm font-extrabold">{fromLabel}</div>
              <div className="text-xs font-bold mt-1">{fromQty} pcs</div>
            </div>
            <button
              onClick={() => setFrom(f => f === 'atas' ? 'bawah' : 'atas')}
              className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
              title="Swap arah"
            >
              <ArrowRight className="w-4 h-4 text-slate-500" />
            </button>
            <div className={`flex-1 border rounded-2xl p-3 text-center ${toColor}`}>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1">Ke</div>
              <div className="text-sm font-extrabold">{toLabel}</div>
              <div className="text-xs font-bold mt-1">{toQty} pcs</div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Jumlah Transfer (Pcs)</label>
            <input
              type="number"
              min="1"
              max={fromQty}
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder={`Maks ${fromQty}`}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#2d8a4e]"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-50 cursor-pointer">Batal</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Memproses...' : `Transfer ke ${toLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/WarehouseTransferModal.tsx
git commit -m "feat(ui): add WarehouseTransferModal for moving stock between warehouses"
```

---

### Task 6: ReceiveGoodsModal.tsx — add warehouse selector

**Files:**
- Modify: `src/components/pembelian/ReceiveGoodsModal.tsx`

- [ ] **Step 1: Add warehouse state**

In `ReceiveGoodsModal.tsx`, after the existing `useState` declarations (around line 36), add:

```typescript
const [warehouse, setWarehouse] = useState<'atas' | 'bawah'>('atas');
```

- [ ] **Step 2: Add warehouse selector in the form**

In the form, find the `<div className="grid grid-cols-2 gap-4">` (around line 105) that contains the date fields. Add the warehouse selector as a third field by changing the grid to 3 columns and adding the selector:

Replace the grid div opening tag:

```tsx
          <div className="grid grid-cols-2 gap-4">
```

With:

```tsx
          <div className="grid grid-cols-3 gap-4">
```

And after the Jatuh Tempo Pembayaran div (closing `</div>` at line ~116), add:

```tsx
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Gudang Tujuan <span className="text-rose-500">*</span></label>
              <select
                value={warehouse}
                onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="atas">Gudang Atas</option>
                <option value="bawah">Gudang Bawah</option>
              </select>
            </div>
```

- [ ] **Step 3: Pass warehouse to receiveGoods**

Find the `handleConfirm` function. Find `purchaseOrderService.receiveGoods(po.id, {...})` at line ~68. Replace:

```typescript
      await purchaseOrderService.receiveGoods(po.id, {
        received_at: new Date(receivedAt).toISOString(),
        payment_due_at: paymentDueAt,
        invoice_url: invoiceUrl,
        conditions: Object.fromEntries(
          Object.entries(conditions).map(([id, c]) => {
            const cond = c as ItemCondition;
            return [
              id,
              { qty_received: cond.qty_received, qty_damaged: cond.qty_damaged, damage_notes: cond.damage_notes || undefined }
            ];
          })
        ),
      });
```

With:

```typescript
      await purchaseOrderService.receiveGoods(po.id, {
        received_at: new Date(receivedAt).toISOString(),
        payment_due_at: paymentDueAt,
        invoice_url: invoiceUrl,
        conditions: Object.fromEntries(
          Object.entries(conditions).map(([id, c]) => {
            const cond = c as ItemCondition;
            return [
              id,
              { qty_received: cond.qty_received, qty_damaged: cond.qty_damaged, damage_notes: cond.damage_notes || undefined }
            ];
          })
        ),
        warehouse,
      });
```

- [ ] **Step 4: Build to verify**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/pembelian/ReceiveGoodsModal.tsx
git commit -m "feat(pembelian): add warehouse selector to ReceiveGoodsModal"
```

---

### Task 7: KasirScreen.tsx SaleModal — add warehouse selector

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Find SaleModal component in KasirScreen.tsx**

The `SaleModal` component begins around line 500. It has its own state variables. Find where the component's state is declared (look for `const [items, setItems]`, `const [customerName`, etc.).

- [ ] **Step 2: Add warehouse state to SaleModal**

In the SaleModal function body, after the existing state declarations, add:

```typescript
const [warehouse, setWarehouse] = useState<'atas' | 'bawah'>('atas');
```

- [ ] **Step 3: Pass warehouse to decrementStock in handleSave**

In `handleSave` (line ~673), find:

```typescript
      for (const item of items) {
        try {
          await stockService.decrementStock(item.sku, item.qty);
        } catch {
          showToast(`Gagal kurangi stok ${item.name}.`, 'warning');
        }
      }
```

Replace with:

```typescript
      for (const item of items) {
        try {
          await stockService.decrementStock(item.sku, item.qty, warehouse);
        } catch {
          showToast(`Gagal kurangi stok ${item.name}.`, 'warning');
        }
      }
```

- [ ] **Step 4: Add warehouse selector to SaleModal UI**

In the SaleModal JSX, find the header section (around line 693–699) with the channel name. After the closing `</div>` of the header content div (after `<p className="text-xs text-gray-400">Pilih item dari stok</p>`), add the warehouse selector. Place it in the header area:

```tsx
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500">Gudang:</span>
            <select
              value={warehouse}
              onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}
              className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            >
              <option value="atas">Gudang Atas</option>
              <option value="bawah">Gudang Bawah</option>
            </select>
          </div>
```

Add this in the header `<div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">`, specifically inside the first `<div>` that contains the title and subtitle.

- [ ] **Step 5: Build to verify**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): add warehouse selector to SaleModal, pass to decrementStock"
```

---

### Task 8: App.tsx — map stock_atas/stock_bawah from Supabase

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update the initial stock load mapping**

In `App.tsx`, find the `useEffect` stock load at line ~105. Find the `mapped` variable:

```typescript
          const mapped: StockItem[] = data.map(item => ({
            sku: item.sku,
            name: item.name,
            category: item.category,
            price: Number(item.price),
            stock: Number(item.stock),
            status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
            specs: (item.specs as Record<string, string | number>) ?? {},
          }));
```

Replace with:

```typescript
          const mapped: StockItem[] = data.map(item => ({
            sku: item.sku,
            name: item.name,
            category: item.category,
            price: Number(item.price),
            stock: Number(item.stock),
            stock_atas: Number(item.stock_atas ?? item.stock),
            stock_bawah: Number(item.stock_bawah ?? 0),
            status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
            specs: (item.specs as Record<string, string | number>) ?? {},
          }));
```

- [ ] **Step 2: Update handleStockRefresh mapping**

Find `handleStockRefresh` at line ~136. Find the same `mapped` variable inside it:

```typescript
        const mapped: StockItem[] = data.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: Number(item.price),
          stock: Number(item.stock),
          status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
          specs: (item.specs as Record<string, string | number>) ?? {},
        }));
```

Replace with:

```typescript
        const mapped: StockItem[] = data.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: Number(item.price),
          stock: Number(item.stock),
          stock_atas: Number(item.stock_atas ?? item.stock),
          stock_bawah: Number(item.stock_bawah ?? 0),
          status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
          specs: (item.specs as Record<string, string | number>) ?? {},
        }));
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): map stock_atas/stock_bawah from Supabase into StockItem"
```

---

### Task 9: Push and update progress.md

- [ ] **Step 1: Update progress.md**

Add at the end of `progress.md`:

```markdown
## Warehouse Management — DONE (2026-06-05)

- Added `stock_atas` and `stock_bawah` columns to `stocks` table
- Created `sync_stock_total` BEFORE trigger — keeps `stock = stock_atas + stock_bawah` automatically
- Created `decrement_stock(p_sku, p_qty, p_warehouse DEFAULT 'atas')` RPC — warehouse-aware stock decrement
- Created `transfer_warehouse(p_sku, p_from, p_to, p_qty)` RPC — atomic transfer between warehouses
- Updated `receive_purchase_order` with `p_warehouse DEFAULT 'atas'` — receiving into correct warehouse
- `stockService.decrementStock` gains `warehouse` param; fallback path updated to use `stock_atas`/`stock_bawah`
- `supabaseService.upsertStock` now sends `stock_atas`/`stock_bawah` (trigger computes `stock`)
- `pembelianService.receiveGoods` gains `warehouse` param; `transferWarehouse` added
- `StockManagerScreen`: row shows "Atas: X | Bawah: Y"; edit panel has 2 warehouse inputs; Transfer button
- New `WarehouseTransferModal` — from/to cards, qty input, calls `transfer_warehouse` RPC
- `ReceiveGoodsModal`: warehouse selector (Gudang Atas / Gudang Bawah)
- `KasirScreen SaleModal`: warehouse selector passed to `decrementStock`
- `App.tsx`: stock mapping now includes `stock_atas` and `stock_bawah`
```

- [ ] **Step 2: Commit and push**

```bash
git add progress.md
git commit -m "docs(progress): record warehouse management completion"
git push origin main
```

Expected: Cloud Build triggers frontend deploy.
