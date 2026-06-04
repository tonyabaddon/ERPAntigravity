# Pembelian FIFO + Overdue + Delete DRAFT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Pembelian module by adding FIFO cost accounting for stock lots, overdue PO visual indicators, and delete-DRAFT functionality.

**Architecture:** Three layers of change: (1) two Supabase migrations add `stock_lots` table + three updated/new RPCs; (2) `pembelianService.ts` and `KasirScreen.tsx` wire in FIFO cost deduction at point of sale; (3) `PembelianScreen.tsx` gets delete DRAFT, overdue badges, overdue sorting, and an updated summary card.

**Tech Stack:** React 18 + TypeScript, Supabase PostgreSQL (RPC, Row Level Security), Supabase MCP tool for applying migrations, Tailwind CSS.

**Context — what already exists (do NOT rebuild these):**
- `supabase/migrations/20260604000005_pembelian_module.sql` — suppliers, purchase_orders, purchase_order_items tables, generate_po_number, receive_purchase_order (v1), receive_replacement RPCs
- `supabase/migrations/20260604000010_receive_po_add_payment_fields.sql` — updated receive_purchase_order with payment_due_at + invoice_url params
- `src/lib/pembelianService.ts` — full CRUD for suppliers and POs; fetchSummary returning `{ totalMtd, dueMtd, totalUnpaid, countMtd }`
- `src/components/PembelianScreen.tsx` + all sub-modals in `src/components/pembelian/` — fully built UI
- `MarkAsPaidModal.tsx` — already calls `kasirService.insertExpense()` on PO payment
- Kasir sale flow in `KasirScreen.tsx` already decrements `stocks.stock` via `stockService.decrementStock`; HPP currently sourced from static `stocks.harga_modal`

---

## File Map

| File | What changes |
|------|-------------|
| `supabase/migrations/20260604000014_stock_lots.sql` | Create stock_lots table + RLS policies + seed from existing stocks |
| `supabase/migrations/20260604000015_fifo_rpcs.sql` | Update receive_purchase_order (add lot INSERT), update receive_replacement (add lot INSERT), create deduct_stock_fifo RPC |
| `src/lib/pembelianService.ts` | Add `delete(poId)`, add `deductFifo(sku, qty)`, update `fetchSummary` return type (`totalUnpaid` → `overdueAmount`) |
| `src/components/KasirScreen.tsx` | Import pembelianService; update `handleSave` to call `deductFifo` per item before building the transaction |
| `src/components/PembelianScreen.tsx` | Update summary state type, add `handleDelete`, add overdue detection + sorting, add "Terlambat" badge, add "Hapus" button, update 3rd summary card |

---

## Task 1: stock_lots table + seed migration

**Files:**
- Create: `supabase/migrations/20260604000014_stock_lots.sql`

- [ ] **Step 1: Write the migration file**

Create `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20260604000014_stock_lots.sql` with this exact content:

```sql
-- ── stock_lots: FIFO batch cost tracking ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           varchar NOT NULL REFERENCES public.stocks(sku),
  po_id         uuid    REFERENCES public.purchase_orders(id),
  unit_cost     numeric NOT NULL DEFAULT 0,
  qty_received  int     NOT NULL,
  qty_remaining int     NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_lots' AND policyname = 'anon full access stock_lots'
  ) THEN
    CREATE POLICY "anon full access stock_lots"
      ON public.stock_lots FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_lots' AND policyname = 'authenticated full access stock_lots'
  ) THEN
    CREATE POLICY "authenticated full access stock_lots"
      ON public.stock_lots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed: bootstrap FIFO from current stock levels.
-- received_at is set 10 years in the past so seed lots are deducted before any real PO lots.
INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
SELECT
  sku,
  NULL,
  COALESCE(harga_modal, 0),
  stock,
  stock,
  now() - INTERVAL '10 years'
FROM public.stocks
WHERE stock > 0;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Call `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `stock_lots`
- `query`: (contents of the file above)

Expected: success, no errors.

- [ ] **Step 3: Verify table and seed data exist**

Call `mcp__plugin_supabase_supabase__execute_sql` with:
```sql
SELECT COUNT(*) AS lot_count FROM public.stock_lots;
```

Expected: returns a count equal to the number of SKUs that have `stock > 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604000014_stock_lots.sql
git commit -m "feat(db): add stock_lots table for FIFO cost accounting, seed from existing stocks"
```

---

## Task 2: FIFO RPCs — update receive_purchase_order, update receive_replacement, create deduct_stock_fifo

**Files:**
- Create: `supabase/migrations/20260604000015_fifo_rpcs.sql`

- [ ] **Step 1: Write the migration file**

Create `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20260604000015_fifo_rpcs.sql` with this exact content:

```sql
-- ── Updated receive_purchase_order: inserts a stock_lot per received SKU ───

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text DEFAULT NULL,
  p_conditions     jsonb DEFAULT '{}'::jsonb
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
        UPDATE public.stocks
        SET stock = stock + v_qty_received, updated_at = now()
        WHERE sku = v_item.sku;

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

-- ── Updated receive_replacement: inserts a stock_lot for replacement units ─

CREATE OR REPLACE FUNCTION public.receive_replacement(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sku         varchar;
  v_qty_damaged int;
  v_unit_cost   numeric;
  v_po_id       uuid;
BEGIN
  SELECT poi.sku, poi.qty_damaged, poi.unit_cost, poi.po_id
  INTO v_sku, v_qty_damaged, v_unit_cost, v_po_id
  FROM public.purchase_order_items poi
  WHERE poi.id = p_item_id AND poi.damage_status = 'RETURNED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found or not in RETURNED status', p_item_id;
  END IF;

  IF v_qty_damaged > 0 AND v_sku IS NOT NULL THEN
    UPDATE public.stocks
    SET stock = stock + v_qty_damaged, updated_at = now()
    WHERE sku = v_sku;

    INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
    VALUES (v_sku, v_po_id, v_unit_cost, v_qty_damaged, v_qty_damaged, now());
  END IF;

  UPDATE public.purchase_order_items
  SET damage_status = 'REPLACED'
  WHERE id = p_item_id;
END;
$$;

-- ── deduct_stock_fifo: FIFO lot deduction, returns total COGS ─────────────

CREATE OR REPLACE FUNCTION public.deduct_stock_fifo(
  p_sku varchar,
  p_qty int
)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_lot          record;
  v_remaining    int     := p_qty;
  v_total_cost   numeric := 0;
  v_deduct       int;
  v_fallback_hpp numeric := 0;
BEGIN
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost
    FROM public.stock_lots
    WHERE sku = p_sku AND qty_remaining > 0
    ORDER BY received_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct := LEAST(v_remaining, v_lot.qty_remaining);
    UPDATE public.stock_lots
    SET qty_remaining = qty_remaining - v_deduct
    WHERE id = v_lot.id;
    v_total_cost := v_total_cost + (v_deduct * v_lot.unit_cost);
    v_remaining  := v_remaining - v_deduct;
  END LOOP;

  -- Fallback: lots exhausted before qty satisfied — use stocks.harga_modal
  IF v_remaining > 0 THEN
    SELECT COALESCE(harga_modal, 0) INTO v_fallback_hpp
    FROM public.stocks WHERE sku = p_sku;
    v_total_cost := v_total_cost + (v_remaining * v_fallback_hpp);
    RAISE WARNING 'deduct_stock_fifo: % units of SKU % had no lot coverage, used harga_modal fallback', v_remaining, p_sku;
  END IF;

  RETURN v_total_cost;
END;
$$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Call `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `fifo_rpcs`
- `query`: (contents of the file above)

Expected: success, three functions created/replaced.

- [ ] **Step 3: Smoke-test deduct_stock_fifo**

Call `mcp__plugin_supabase_supabase__execute_sql`:
```sql
-- Find a SKU with a seeded lot
SELECT sku, unit_cost, qty_remaining FROM public.stock_lots WHERE qty_remaining > 0 LIMIT 1;
```

Note the SKU returned (call it `TEST_SKU`). Then:
```sql
-- Verify the function returns the lot's unit_cost (qty=1 should return unit_cost of oldest lot)
SELECT public.deduct_stock_fifo('TEST_SKU', 1);
```

Expected: returns the numeric `unit_cost` of that SKU's oldest lot.

Restore immediately:
```sql
UPDATE public.stock_lots
SET qty_remaining = qty_remaining + 1
WHERE id = (
  SELECT id FROM public.stock_lots WHERE sku = 'TEST_SKU' ORDER BY received_at ASC LIMIT 1
);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604000015_fifo_rpcs.sql
git commit -m "feat(db): FIFO RPCs — stock_lots on receive_purchase_order + receive_replacement, add deduct_stock_fifo"
```

---

## Task 3: Kasir FIFO integration

**Files:**
- Modify: `src/lib/pembelianService.ts`
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add `delete` and `deductFifo` to pembelianService.ts**

Open `src/lib/pembelianService.ts`. Find the `fetchSummary` method (line ~187). Insert the two new methods **before** `fetchSummary`, inside `purchaseOrderService`:

Find this exact line:
```typescript
  async fetchSummary(): Promise<{ totalMtd: number; dueMtd: number; totalUnpaid: number; countMtd: number }> {
```

Insert before it:
```typescript
  async delete(poId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('purchase_orders').delete().eq('id', poId);
    if (error) throw error;
  },

  async deductFifo(sku: string, qty: number): Promise<number> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('deduct_stock_fifo', { p_sku: sku, p_qty: qty });
    if (error) throw error;
    return Number(data ?? 0);
  },

```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean compile).

- [ ] **Step 3: Add pembelianService import to KasirScreen.tsx**

Open `src/components/KasirScreen.tsx`. Find the existing supabaseClient import line (it starts with `import { kasirService,`). Add a new import line directly after it:

After:
```typescript
import { kasirService, stockService, customersService, companySettingsService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
```

Add:
```typescript
import { purchaseOrderService } from '../lib/pembelianService';
```

- [ ] **Step 4: Update handleSave to resolve FIFO cost before building the transaction**

In `KasirScreen.tsx`, find `async function handleSave(print: boolean)`. Inside it, find the block that builds `newTx` — it currently starts with:

```typescript
      const newTx: NewSaleTransaction = {
        date: selectedDate,
        channel,
        items: items.map(({ _key, ...rest }) => rest),
        subtotal,
        hpp_total: hppTotal,
```

Replace from `const newTx` through the closing `};` of the newTx object with:

```typescript
      // Resolve true COGS via FIFO before recording the transaction.
      // deductFifo decrements stock_lots.qty_remaining and returns total cost.
      const itemsWithFifo = await Promise.all(
        items.map(async (item) => {
          const totalCost = await purchaseOrderService.deductFifo(item.sku, item.qty);
          return {
            ...item,
            hpp_per_unit: item.qty > 0 ? totalCost / item.qty : 0,
            hpp_subtotal: totalCost,
          };
        })
      );

      const newTx: NewSaleTransaction = {
        date: selectedDate,
        channel,
        items: itemsWithFifo.map(({ _key, ...rest }) => rest),
        subtotal,
        hpp_total: itemsWithFifo.reduce((s, i) => s + i.hpp_subtotal, 0),
        payment_method: paymentMethod,
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        customer_company: customerCompany || undefined,
        invoice_number: invoiceNumber,
      };
```

Leave everything after `newTx` (the `insertSaleTransaction` call, customer auto-save, `decrementStock` loop, `onSaved`) unchanged.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean compile).

- [ ] **Step 6: Commit**

```bash
git add src/lib/pembelianService.ts src/components/KasirScreen.tsx
git commit -m "feat(kasir): FIFO lot deduction for accurate COGS per sale transaction"
```

---

## Task 4: PembelianScreen — Delete DRAFT + Overdue indicator + summary card

**Files:**
- Modify: `src/lib/pembelianService.ts`
- Modify: `src/components/PembelianScreen.tsx`

- [ ] **Step 1: Update fetchSummary in pembelianService.ts**

`totalUnpaid` (all outstanding) is replaced by `overdueAmount` (only past-due). Find and replace the entire `fetchSummary` method:

```typescript
  async fetchSummary(): Promise<{ totalMtd: number; dueMtd: number; totalUnpaid: number; countMtd: number }> {
    if (!supabase) return { totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 };
    const { data } = await supabase
      .from('purchase_orders')
      .select('total, status, payment_due_at, created_at');
    const rows = (data ?? []) as Array<{ total: number; status: string; payment_due_at?: string; created_at: string }>;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const monthStartDate = monthStart.slice(0, 10);
    const totalMtd = rows.filter(r => r.created_at >= monthStart).reduce((s, r) => s + Number(r.total), 0);
    const countMtd = rows.filter(r => r.created_at >= monthStart).length;
    const dueMtd = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at >= monthStartDate && r.payment_due_at <= monthEndDate)
      .reduce((s, r) => s + Number(r.total), 0);
    const totalUnpaid = rows
      .filter(r => r.status === 'RECEIVED')
      .reduce((s, r) => s + Number(r.total), 0);
    return { totalMtd, dueMtd, totalUnpaid, countMtd };
  },
```

Replace with:

```typescript
  async fetchSummary(): Promise<{ totalMtd: number; dueMtd: number; overdueAmount: number; countMtd: number }> {
    if (!supabase) return { totalMtd: 0, dueMtd: 0, overdueAmount: 0, countMtd: 0 };
    const { data } = await supabase
      .from('purchase_orders')
      .select('total, status, payment_due_at, created_at');
    const rows = (data ?? []) as Array<{ total: number; status: string; payment_due_at?: string; created_at: string }>;
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const monthStartDate = monthStart.slice(0, 10);
    const totalMtd = rows.filter(r => r.created_at >= monthStart).reduce((s, r) => s + Number(r.total), 0);
    const countMtd = rows.filter(r => r.created_at >= monthStart).length;
    const dueMtd = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at >= monthStartDate && r.payment_due_at <= monthEndDate)
      .reduce((s, r) => s + Number(r.total), 0);
    const overdueAmount = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at < todayDate)
      .reduce((s, r) => s + Number(r.total), 0);
    return { totalMtd, dueMtd, overdueAmount, countMtd };
  },
```

- [ ] **Step 2: Update summary state type in PembelianScreen.tsx**

Find:
```typescript
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 });
```

Replace with:
```typescript
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, overdueAmount: 0, countMtd: 0 });
```

- [ ] **Step 3: Update the 3rd summary card**

Find:
```tsx
          <div className="bg-white rounded-xl border border-rose-200 p-4">
            <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Total Belum Dibayar</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.totalUnpaid)}</p>
            <p className="text-xs text-rose-400 mt-1">semua PO outstanding</p>
          </div>
```

Replace with:
```tsx
          <div className="bg-white rounded-xl border border-rose-200 p-4">
            <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Terlambat Bayar</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.overdueAmount)}</p>
            <p className="text-xs text-rose-400 mt-1">melewati jatuh tempo, belum lunas</p>
          </div>
```

- [ ] **Step 4: Add OVERDUE to LEFT_BORDER**

Find:
```typescript
const LEFT_BORDER: Record<string, string> = {
  ORDERED:  'border-l-4 border-l-blue-400',
  RECEIVED: 'border-l-4 border-l-amber-400',
};
```

Replace with:
```typescript
const LEFT_BORDER: Record<string, string> = {
  ORDERED:  'border-l-4 border-l-blue-400',
  RECEIVED: 'border-l-4 border-l-amber-400',
  OVERDUE:  'border-l-4 border-l-rose-500',
};
```

- [ ] **Step 5: Add isOverdue helper, sort overdue to top, and handleDelete**

Inside `function OrdersTab(...)`, find:

```typescript
  const filtered = orders.filter(o => {
    const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });
```

Replace with:

```typescript
  const today = new Date().toISOString().slice(0, 10);

  function isOverdue(po: DbPurchaseOrder): boolean {
    return po.status === 'RECEIVED' && !!po.payment_due_at && po.payment_due_at < today;
  }

  const filtered = orders
    .filter(o => {
      const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
        (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || o.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (isOverdue(a) && !isOverdue(b)) return -1;
      if (!isOverdue(a) && isOverdue(b)) return 1;
      return 0;
    });
```

Then find `async function handleMarkOrdered(po: DbPurchaseOrder)`. After its closing `}`, insert:

```typescript
  async function handleDelete(po: DbPurchaseOrder) {
    if (!confirm(`Hapus PO "${po.po_number}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await purchaseOrderService.delete(po.id);
      showToast(`${po.po_number} dihapus.`, 'success');
      onRefresh();
    } catch (e: any) {
      console.error('Delete PO error:', e);
      showToast(e?.message ?? 'Gagal menghapus PO.', 'warning');
    }
  }
```

- [ ] **Step 6: Update PO row — overdue border, overdue due-date cell, Hapus button**

Find the PO row `<div>` opening tag:
```tsx
              <div key={po.id} className={`grid grid-cols-7 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${LEFT_BORDER[po.status] ?? ''}`}>
```

Replace with:
```tsx
              <div key={po.id} className={`grid grid-cols-7 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${isOverdue(po) ? LEFT_BORDER.OVERDUE : (LEFT_BORDER[po.status] ?? '')}`}>
```

Find the due-date cell:
```tsx
                <span className={`col-span-1 text-xs text-center font-semibold ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                  {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                </span>
```

Replace with:
```tsx
                <div className="col-span-1 flex flex-col items-center gap-0.5">
                  <span className={`text-xs font-semibold ${isOverdue(po) ? 'text-rose-600' : po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                    {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                  </span>
                  {isOverdue(po) && (
                    <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full leading-tight">Terlambat</span>
                  )}
                </div>
```

Find the DRAFT actions block:
```tsx
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => setEditPo(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
                    </>
                  )}
```

Replace with:
```tsx
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => setEditPo(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
                      <button onClick={() => handleDelete(po)} className="text-xs text-rose-600 px-2 py-1 rounded border border-rose-200 hover:bg-rose-50">Hapus</button>
                    </>
                  )}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean compile).

- [ ] **Step 8: Build to verify no Vite errors**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -15
```

Expected: build succeeds, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pembelianService.ts src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): overdue indicator + sort-to-top, delete DRAFT PO, Terlambat Bayar summary card"
```

---

## Task 5: Update progress.md

- [ ] **Step 1: Append entry to progress.md**

Open `progress.md` and append a new section covering:
- stock_lots FIFO table created and seeded from existing stock (harga_modal as unit_cost, received_at = 10 years ago)
- `deduct_stock_fifo` RPC: deducts oldest lots first, returns true COGS; falls back to `harga_modal` if lots exhausted
- `receive_purchase_order` and `receive_replacement` now create `stock_lots` entries on every receipt
- Kasir sale flow: calls `deduct_stock_fifo` per item before recording transaction — HPP in kasir_transactions now reflects true FIFO cost
- Delete DRAFT PO added (with confirm dialog)
- Overdue PO indicator: red left border + "Terlambat" badge on due date + sorted to top of list
- Summary card 3 changed from "Total Belum Dibayar" (all unpaid) to "Terlambat Bayar" (past-due only)

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "chore: update progress.md with FIFO, overdue indicator, delete DRAFT"
```
