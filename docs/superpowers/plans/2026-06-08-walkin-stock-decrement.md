# Walk-in Paid: Stock Decrement & True FIFO HPP — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the inventory-drift gap from the Unified Sales Channel feature: a walk-in draft order marked paid via `mark_walkin_order_paid` currently writes the cashbook + flips order status without touching `stocks` or `stock_lots`. After this work, marking a walk-in order paid decrements both warehouse-column stock AND FIFO lots, and the resulting `kasir_transactions.hpp_total` reflects true FIFO COGS instead of the `harga_modal` snapshot the draft was created with.

**Architecture:** Track the warehouse on each walk-in order (new column `orders.warehouse`). At "Tandai Lunas" time the existing `mark_walkin_order_paid` RPC iterates `v_order.items`, calls the same `decrement_stock` + `deduct_stock_fifo` pair the WhatsApp paid-now and kasir paid-now flows already use, sums the FIFO costs, and writes the corrected `hpp_total` into the paired `kasir_transactions` row. Single transaction — any failure rolls back atomically.

**Tech Stack:** Supabase PostgreSQL + supabase-js v2 + React + TypeScript. No test framework — verification is `npm run lint` + dev server + SQL queries.

**Prerequisite:** Unified Sales Channel migrations 1–4 (and follow-up 5) must already be applied. This plan's migrations layer on top.

**Why not decrement at draft creation?** A walk-in draft is an "I'd like this, let me grab my wallet" state — usually resolved in minutes. Reserving stock at draft time creates phantom-loss risk if the customer wanders off, plus requires release-on-cancel logic. Deferring to paid time means stock stays accurate for everyone else looking at it, at the modest cost of an oversell race if two drafts hold the same last unit. Acceptable for the scale this kasir runs at.

---

## File Structure

**New files:**
- `supabase/migrations/20260608000006_orders_warehouse.sql` — adds `orders.warehouse text` (nullable, only set for walkin)
- `supabase/migrations/20260608000007_mark_walkin_paid_with_stock.sql` — replaces `mark_walkin_order_paid` to also deduct stock + compute true FIFO hpp_total

**Modified files:**
- `src/types.ts` — extend `DbOrder` with `warehouse?: 'atas' | 'bawah' | null`
- `src/lib/supabaseClient.ts` — `orderService.createWalkinDraft` accepts + persists `warehouse`
- `src/components/KasirScreen.tsx` — `handleSaveDraft` passes the existing `warehouse` state to `createWalkinDraft`

---

## Task 1: Migration — `orders.warehouse`

**Files:**
- Create: `supabase/migrations/20260608000006_orders_warehouse.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Walk-in draft orders need to remember which warehouse to deduct from when
-- payment is recorded later. WhatsApp orders default to 'atas' in the Go
-- service (same as the current implicit assumption), so this column is only
-- meaningful for sales_channel = 'walkin'.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS warehouse text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_warehouse_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_warehouse_check
      CHECK (warehouse IS NULL OR warehouse IN ('atas', 'bawah'));
  END IF;
END $$;
```

- [ ] **Step 2: Apply via Supabase SQL editor**

Paste & run. Verify:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'warehouse';
```
Expected: one row, `text`, `YES`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260608000006_orders_warehouse.sql
git commit -m "feat(orders): add warehouse column for walk-in draft deduction routing"
```

- [ ] **Step 4: progress.md entry**

Append a brief entry to `progress.md` (top, after title, same style as prior entries). Commit:

```bash
git add progress.md
git commit -m "docs(progress): walkin-stock T1 orders.warehouse column"
```

---

## Task 2: Migration — Replace `mark_walkin_order_paid` with stock-aware version

**Files:**
- Create: `supabase/migrations/20260608000007_mark_walkin_paid_with_stock.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Replace mark_walkin_order_paid with a version that:
--   1) iterates v_order.items and calls decrement_stock + deduct_stock_fifo
--      per line (same pair the WA + paid-now-kasir flows use),
--   2) sums the true FIFO cost into a v_hpp_total,
--   3) overrides the kasir_transactions.hpp_total with the FIFO value so the
--      cashbook reflects real COGS rather than the harga_modal snapshot the
--      draft was created with.
--
-- Single transaction: if any deduct_stock_fifo raises (e.g., no lots and no
-- harga_modal fallback), the whole call rolls back — order status stays
-- WAITING_PAYMENT, no kasir row is written.
--
-- Warehouse routing: v_order.warehouse is required for walkin orders. If NULL
-- (legacy data or buggy caller), default to 'atas' with a WARNING.

CREATE OR REPLACE FUNCTION public.mark_walkin_order_paid(
  p_order_id        uuid,
  p_payment_method  text,
  p_invoice_number  text,
  p_paid_date       date DEFAULT CURRENT_DATE
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql
AS $$
DECLARE
  v_order        public.orders%ROWTYPE;
  v_kasir        public.kasir_transactions%ROWTYPE;
  v_item         jsonb;
  v_sku          text;
  v_qty          int;
  v_warehouse    text;
  v_lot_cost     numeric;
  v_hpp_total    numeric := 0;
  v_items_out    jsonb   := '[]'::jsonb;
  v_item_out     jsonb;
BEGIN
  IF p_payment_method NOT IN ('cash','transfer','qris') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris)', p_payment_method;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF v_order.sales_channel <> 'walkin' THEN
    RAISE EXCEPTION 'order % is not a walk-in order (channel=%)',
      p_order_id, v_order.sales_channel;
  END IF;
  IF v_order.status NOT IN (
    'WAITING_PAYMENT', 'PAYMENT_UPLOADED',
    'WAITING_DP',      'DP_UPLOADED', 'DP_VERIFIED'
  ) THEN
    RAISE EXCEPTION 'order % cannot be marked paid from status %',
      p_order_id, v_order.status;
  END IF;

  v_warehouse := COALESCE(v_order.warehouse, 'atas');
  IF v_order.warehouse IS NULL THEN
    RAISE WARNING 'order % has NULL warehouse, defaulting to atas', p_order_id;
  END IF;

  -- Walk every item line: drain warehouse column + FIFO lots, accumulate cost.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb))
  LOOP
    v_sku := v_item ->> 'sku';
    v_qty := (v_item ->> 'qty')::int;
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'order % has malformed item %', p_order_id, v_item;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_sku,
      p_qty              => v_qty,
      p_warehouse        => v_warehouse,
      p_related_doc_type => 'order',
      p_related_doc_id   => v_order.id::text,
      p_source           => 'sale_kasir'
    );

    v_lot_cost := public.deduct_stock_fifo(v_sku, v_qty);
    v_hpp_total := v_hpp_total + v_lot_cost;

    -- Re-emit the item with the true FIFO cost so the kasir row's items[]
    -- carries the same COGS the cashbook sums to.
    v_item_out := v_item
      || jsonb_build_object(
           'hpp_subtotal', v_lot_cost,
           'hpp_per_unit', CASE WHEN v_qty > 0 THEN v_lot_cost / v_qty ELSE 0 END
         );
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  UPDATE public.orders
  SET status              = 'PAYMENT_VERIFIED',
      payment_verified_at = now(),
      updated_at          = now(),
      hpp_total           = v_hpp_total,
      items               = v_items_out
  WHERE id = p_order_id;

  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, customer_id, customer_name, customer_phone, customer_company,
    invoice_number
  ) VALUES (
    p_paid_date,
    'income',
    'walkin',
    v_items_out,
    COALESCE(v_order.total, 0),
    v_hpp_total,
    p_payment_method::kasir_payment_method,
    v_order.customer_id,
    v_order.customer_name,
    v_order.customer_phone,
    v_order.customer_company,
    p_invoice_number
  )
  RETURNING * INTO v_kasir;

  RETURN v_kasir;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_walkin_order_paid(uuid, text, text, date) TO anon;
```

- [ ] **Step 2: Apply via Supabase SQL editor**

Paste & run. Verify the function exists:
```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname = 'mark_walkin_order_paid';
```
Expected: one row with the 4 parameters.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260608000007_mark_walkin_paid_with_stock.sql
git commit -m "feat(orders): mark_walkin_order_paid deducts stock + writes true FIFO hpp_total"
```

- [ ] **Step 4: progress.md entry**

Append entry, commit:

```bash
git add progress.md
git commit -m "docs(progress): walkin-stock T2 RPC stock + FIFO hpp"
```

---

## Task 3: TypeScript types + service signature

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Extend `DbOrder`**

In `src/types.ts`, find `DbOrder` (search `interface DbOrder`). Add a new field after `sales_channel`:

```typescript
  warehouse?: 'atas' | 'bawah' | null;
```

- [ ] **Step 2: Extend `orderService.createWalkinDraft` input**

In `src/lib/supabaseClient.ts`, find `createWalkinDraft`. Update the input type and the insert payload:

```typescript
  async createWalkinDraft(input: {
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_company: string;
    warehouse: 'atas' | 'bawah';
    items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number }>;
    subtotal: number;
    hpp_total: number;
    total: number;
  }): Promise<DbOrder> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .insert({
        sales_channel:     'walkin',
        status:            'WAITING_PAYMENT',
        warehouse:         input.warehouse,
        customer_id:       input.customer_id,
        customer_name:     input.customer_name,
        customer_phone:    input.customer_phone,
        customer_company:  input.customer_company,
        customer_address:  '',
        items:             input.items,
        subtotal:          input.subtotal,
        shipping_fee:      0,
        total:             input.total,
        hpp_total:         input.hpp_total,
        payment_type:      'FULL',
        delivery_type:     'PICKUP',
      })
      .select()
      .single();
    if (error) throw error;
    return data as DbOrder;
  },
```

The only changes vs. the existing function: the new `warehouse` field on the input type AND the new `warehouse: input.warehouse` line in the insert payload.

- [ ] **Step 3: Verify lint passes**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run lint
```

Expected: lint will flag `KasirScreen.handleSaveDraft`'s call to `createWalkinDraft` because the new required `warehouse` field isn't passed. That's the next task — fine for now.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts
git commit -m "feat(types/client): warehouse on DbOrder + createWalkinDraft input"
```

- [ ] **Step 5: progress.md entry**

Append + commit.

---

## Task 4: KasirScreen — pass warehouse to draft

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Wire warehouse through `handleSaveDraft`**

In `src/components/KasirScreen.tsx`, find `handleSaveDraft`. The function already has access to a `warehouse` state variable (the same one the paid-sale path uses). Find the `orderService.createWalkinDraft({ ... })` call and add `warehouse` to the input object:

```typescript
    await orderService.createWalkinDraft({
      customer_id:      resolvedCustomerId,
      customer_name:    customerName.trim(),
      customer_phone:   customerPhone.trim(),
      customer_company: customerCompany.trim(),
      warehouse,                       // <-- NEW
      items:            itemsWithFifo,
      subtotal,
      hpp_total:        itemsWithFifo.reduce((s, i) => s + i.hpp_subtotal, 0),
      total:            subtotal,
    });
```

If `warehouse` is typed as `string` in the component's state, narrow it: `warehouse as 'atas' | 'bawah'`. If it's already correctly typed, no cast needed.

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: no NEW errors (the warehouse-required error introduced in the previous task is now resolved).

- [ ] **Step 3: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): pass warehouse to walkin draft so paid-time deduction knows where"
```

- [ ] **Step 4: progress.md entry**

Append + commit.

---

## Task 5: End-to-end manual verification

- [ ] **Step 1: Apply both new migrations** (T1 + T2 above)

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Create a walk-in draft**

1. Open Kasir → Walk-in → pick "Gudang Atas" → add 1-2 items with non-zero stock → fill customer name/phone → click "Buat Sales Order (Belum Dibayar)".
2. SQL check:
   ```sql
   SELECT id, sales_channel, status, warehouse, items, hpp_total
   FROM orders ORDER BY created_at DESC LIMIT 1;
   ```
   Expected: `warehouse='atas'`, `status='WAITING_PAYMENT'`, `hpp_total` = harga_modal snapshot (not yet FIFO).

- [ ] **Step 4: Note pre-paid stock state**

```sql
SELECT sku, stock_atas, stock_bawah FROM stocks WHERE sku IN (<the SKUs from step 3>);
SELECT sku, SUM(qty_remaining) FROM stock_lots WHERE sku IN (<same SKUs>) GROUP BY sku;
```

Record both values.

- [ ] **Step 5: Mark paid via Pipeline**

Open Pipeline → find the walk-in card → click "Tandai Lunas" → cash → invoice. Expect success toast.

- [ ] **Step 6: Verify stock decremented + FIFO HPP**

Re-run the queries from Step 4 — both `stocks.stock_atas` and `stock_lots.qty_remaining` should have decreased by the item qty. Then:

```sql
SELECT id, status, warehouse, hpp_total, items->0->>'hpp_subtotal' AS first_hpp
FROM orders WHERE id = '<order_id>';

SELECT id, hpp_total, items->0->>'hpp_subtotal' AS first_hpp
FROM kasir_transactions WHERE invoice_number = '<invoice>';
```

Expected: order's status='PAYMENT_VERIFIED', `hpp_total` now reflects true FIFO COGS (different from the original harga_modal snapshot if lots were unevenly priced). Kasir row's `hpp_total` matches the order's. Both rows' items[].hpp_subtotal also match.

- [ ] **Step 7: Verify the ledger**

```sql
SELECT sku, qty_delta, source, related_doc_type, related_doc_id, created_at
FROM stock_movements
WHERE related_doc_id = '<order_id>'
ORDER BY created_at;
```

Expected: 2 rows per item (one from `decrement_stock`, one from `deduct_stock_fifo`), both with `related_doc_type='order'` and source='sale_kasir'.

- [ ] **Step 8: Failure path — out-of-stock**

Try to mark paid a walk-in order whose qty exceeds remaining stock. Expect: RPC raises an exception (`deduct_stock_fifo` warns about fallback OR `decrement_stock` clamps to 0). Confirm the order status stays unchanged (transaction rolled back).

- [ ] **Step 9: Commit any small UI polish discovered**

If verification reveals minor UI issues (e.g., the warehouse dropdown wasn't visible in the draft modal), capture them in a small follow-up commit. Otherwise, skip.

---

## Self-Review Checklist (plan author)

- [x] Spec coverage: stock decrement → T2's RPC loop. HPP fidelity → T2 overrides hpp_total. Warehouse routing → T1 column + T3 type + T4 wiring.
- [x] No placeholders: every step has full SQL / code.
- [x] Type consistency: `warehouse: 'atas' | 'bawah'` used identically in `DbOrder`, `createWalkinDraft` input, and KasirScreen state narrowing.
- [x] Single transaction: T2's RPC uses one BEGIN…END block — any throw rolls back the whole call.
- [x] Backward-compatible: existing WhatsApp orders aren't affected (sales_channel='whatsapp' won't enter this RPC).

## Known follow-ups NOT in this plan

- Real-time refresh of kasir transactions in OrderHistoryScreen (separate concern).
- Replacing `window.prompt` UX in Pipeline's Tandai Lunas with a proper modal.
- Release-on-cancel logic for walk-in drafts (if someone cancels via a future "Batalkan" button, we'd need to NOT have decremented stock — already true under this design since decrement happens at paid time only).
