# Unified Sales Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sales touchpoint (WhatsApp orders + kasir POS transactions + new walk-in draft orders) visible across PelangganScreen, OrderHistoryScreen, and PipelineScreen with proper channel attribution.

**Architecture:** Keep `orders` and `kasir_transactions` as two source-of-truth tables (orders = fulfillment, kasir = cashbook). Bridge them with (a) a `customer_id` FK on `kasir_transactions` so a customer's full history can be unioned, and (b) a `sales_channel` column on `orders` so walk-in draft orders can live alongside WhatsApp orders. UI screens union the two tables in app code and render a channel badge per row. KasirScreen gains a second flow — "Buat Sales Order (Belum Dibayar)" — that writes to `orders` instead of `kasir_transactions`; marking it paid later transitions the order AND writes the paired kasir row via a single RPC.

**Tech Stack:** Supabase PostgreSQL + supabase-js v2 + React 19 + Vite + TypeScript. No test framework — verification is manual via `npm run lint`, dev server (`npm run dev`), and direct SQL queries in the Supabase SQL editor.

**Spec:** `docs/superpowers/specs/2026-06-08-unified-sales-channel-design.md`

**Verification convention:**
- Every code change must pass `npm run lint` (= `tsc --noEmit`).
- Every migration is verified by running it against the active Supabase project (the user's DB) via the Supabase SQL editor, then checking the schema with `\d table_name` style queries.
- UI changes verified by `npm run dev` + the listed user steps.

---

## File Structure

**New files:**
- `supabase/migrations/20260608000001_kasir_customer_id.sql` — adds kasir_transactions.customer_id + backfill
- `supabase/migrations/20260608000002_orders_sales_channel.sql` — adds orders.sales_channel
- `supabase/migrations/20260608000003_mark_walkin_order_paid_rpc.sql` — atomic transition for walk-in order → paid
- `src/lib/salesEntries.ts` — pure helper for merging orders + kasir_transactions into a unified `SalesEntry[]`

**Modified files:**
- `src/types.ts` — add `SalesChannel`, `SalesEntry`, extend `DbOrder` and `KasirTransaction`
- `src/lib/supabaseClient.ts` — new `salesEntriesService`, extend `customersService.fetchProfile`, extend `kasirService.insertSaleTransaction`, add `orderService.createWalkinDraft` + `orderService.markWalkinPaid`
- `src/components/KasirScreen.tsx` — second action "Buat Sales Order (Belum Dibayar)"; pass customer_id when inserting kasir transaction
- `src/components/PelangganScreen.tsx` — render unified `salesEntries` with channel badge
- `src/components/OrderHistoryScreen.tsx` — union with kasir, add channel filter, channel badge per card
- `src/components/PipelineScreen.tsx` — include walk-in draft orders, "Tandai Lunas" button per draft

---

## Task 1: Migration — `kasir_transactions.customer_id` + backfill

**Files:**
- Create: `supabase/migrations/20260608000001_kasir_customer_id.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Link kasir_transactions to customers so PelangganScreen can show POS history.
-- Nullable on purpose: walk-in sales without name/phone stay anonymous.

ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS customer_id text REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_kasir_customer_id
  ON public.kasir_transactions(customer_id);

-- Backfill: best-effort match by exact phone == wa_number.
-- Unmatched rows (different phone format, no phone entered) stay NULL.
UPDATE public.kasir_transactions kt
SET customer_id = c.id
FROM public.customers c
WHERE kt.customer_id IS NULL
  AND kt.customer_phone IS NOT NULL
  AND kt.customer_phone = c.wa_number;
```

- [ ] **Step 2: Apply migration in Supabase SQL editor**

Paste the file contents into the SQL editor for the project and run. Expected: `ALTER TABLE`, `CREATE INDEX`, `UPDATE N` (N = number of backfilled rows).

- [ ] **Step 3: Verify schema**

Run in SQL editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'kasir_transactions' AND column_name = 'customer_id';
```
Expected: one row, `text`, `YES`.

- [ ] **Step 4: Verify backfill quality**

```sql
SELECT
  COUNT(*)                                  AS total,
  COUNT(*) FILTER (WHERE customer_id IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE customer_phone IS NOT NULL AND customer_id IS NULL) AS phone_set_but_unmatched
FROM kasir_transactions
WHERE type = 'income';
```
Expected: `linked` should be >0 for any customer who exists in both tables. Note `phone_set_but_unmatched` — these usually mean a phone format mismatch (user can spot-check 2-3 manually).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260608000001_kasir_customer_id.sql
git commit -m "feat(kasir): add customer_id FK to kasir_transactions with backfill"
```

---

## Task 2: Migration — `orders.sales_channel`

**Files:**
- Create: `supabase/migrations/20260608000002_orders_sales_channel.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Tag the originating channel on orders so walk-in draft orders can coexist
-- with WhatsApp orders in the same table.
-- Existing rows default to 'whatsapp' since that was the only source until now.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sales_channel text NOT NULL DEFAULT 'whatsapp';

-- Constrain values. NB: tokopedia/grosir do NOT use the orders table —
-- they remain in kasir_transactions (immediate paid sales only).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_sales_channel_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_sales_channel_check
      CHECK (sales_channel IN ('whatsapp', 'walkin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_sales_channel_status
  ON public.orders(sales_channel, status);
```

- [ ] **Step 2: Apply migration in Supabase SQL editor**

Paste & run. Expected: `ALTER TABLE`, constraint added, `CREATE INDEX`.

- [ ] **Step 3: Verify**

```sql
SELECT sales_channel, COUNT(*) FROM orders GROUP BY sales_channel;
```
Expected: all existing rows show `whatsapp` (the default backfill).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608000002_orders_sales_channel.sql
git commit -m "feat(orders): add sales_channel column (whatsapp|walkin)"
```

---

## Task 3: Migration — `mark_walkin_order_paid` RPC

**Files:**
- Create: `supabase/migrations/20260608000003_mark_walkin_order_paid_rpc.sql`

- [ ] **Step 1: Write the RPC**

```sql
-- Atomic transition: walk-in order goes from WAITING_PAYMENT (or DP_VERIFIED)
-- to PAYMENT_VERIFIED, AND inserts the paired kasir_transactions income row
-- so the daily cashbook stays accurate.
--
-- Returns the new kasir_transactions row.

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
  v_order   public.orders%ROWTYPE;
  v_kasir   public.kasir_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF v_order.sales_channel <> 'walkin' THEN
    RAISE EXCEPTION 'order % is not a walk-in order (channel=%)',
      p_order_id, v_order.sales_channel;
  END IF;
  IF v_order.status = 'PAYMENT_VERIFIED' THEN
    RAISE EXCEPTION 'order % already paid', p_order_id;
  END IF;

  UPDATE public.orders
  SET status              = 'PAYMENT_VERIFIED',
      payment_verified_at = now(),
      updated_at          = now()
  WHERE id = p_order_id;

  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, customer_id, customer_name, customer_phone, customer_company,
    invoice_number
  ) VALUES (
    p_paid_date,
    'income',
    'walkin',
    COALESCE(v_order.items, '[]'::jsonb),
    COALESCE(v_order.total, 0),
    COALESCE(v_order.hpp_total, 0),
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

- [ ] **Step 2: Apply migration in Supabase SQL editor**

- [ ] **Step 3: Smoke-test the RPC manually**

Pick an existing walk-in order id (you'll have one after Task 7's manual test), or skip this step until after Task 7. To verify when ready:

```sql
SELECT * FROM mark_walkin_order_paid(
  '<order_uuid>'::uuid,
  'cash',
  '<existing_invoice_number>'
);
```
Expected: returns one `kasir_transactions` row; the order's status flipped to `PAYMENT_VERIFIED`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608000003_mark_walkin_order_paid_rpc.sql
git commit -m "feat(orders): add mark_walkin_order_paid RPC for atomic walk-in payment"
```

---

## Task 4: TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `SalesChannel` type and extend `DbOrder` + `KasirTransaction`**

Find the existing `KasirChannel` type around line 336 and the `DbOrder` interface around line 159. Make these changes:

In `src/types.ts`, add right after the existing `KasirChannel` line:

```typescript
export type SalesChannel = 'whatsapp' | 'walkin' | 'tokopedia' | 'grosir';
```

In the `DbOrder` interface, add a new field (place it after `customer_id`):

```typescript
  sales_channel: 'whatsapp' | 'walkin';
```

In the `KasirTransaction` interface, add a new field (place it after `customer_company`):

```typescript
  customer_id?: string | null;
```

In the `NewSaleTransaction` interface, add the same field as optional:

```typescript
  customer_id?: string;
```

- [ ] **Step 2: Add the unified `SalesEntry` view-model at the end of the file**

```typescript
export interface SalesEntry {
  source: 'order' | 'kasir';
  id: string;
  display_id: string;
  channel: SalesChannel;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  items: Array<{ name: string; qty: number; sku?: string }>;
  total: number;
  status: string;
  created_at: string;
  // For walk-in draft orders we need the underlying order id so Pipeline can
  // call mark_walkin_order_paid; null for kasir-sourced entries.
  walkin_order_id: string | null;
}
```

- [ ] **Step 3: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0. If errors mention missing properties elsewhere, those callsites need updating in later tasks — fine for now if errors are only about properties this task added (those will be backfilled by their owning tasks).

If lint fails on existing code that previously type-checked, you've introduced a regression — undo and fix.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add SalesChannel, SalesEntry; extend DbOrder/KasirTransaction"
```

---

## Task 5: `salesEntries.ts` helper

**Files:**
- Create: `src/lib/salesEntries.ts`

- [ ] **Step 1: Write the helper**

```typescript
import type { DbOrder, KasirTransaction, SalesEntry, SalesChannel } from '../types';

export function orderToSalesEntry(o: DbOrder): SalesEntry {
  return {
    source: 'order',
    id: `order:${o.id}`,
    display_id: o.gjp_order_id ?? o.id.slice(0, 8),
    channel: (o.sales_channel ?? 'whatsapp') as SalesChannel,
    customer_id: o.customer_id ?? null,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_company: o.customer_company,
    items: (o.items ?? []).map(i => ({ name: i.name, qty: i.qty, sku: i.sku })),
    total: o.total,
    status: o.status,
    created_at: o.created_at,
    walkin_order_id: o.sales_channel === 'walkin' ? o.id : null,
  };
}

export function kasirToSalesEntry(t: KasirTransaction): SalesEntry {
  // Kasir income rows are always paid at insert time.
  const channel: SalesChannel = (t.channel ?? 'walkin') as SalesChannel;
  return {
    source: 'kasir',
    id: `kasir:${t.id}`,
    display_id: t.invoice_number ?? t.id.slice(0, 8),
    channel,
    customer_id: t.customer_id ?? null,
    customer_name: t.customer_name ?? '(Tanpa Nama)',
    customer_phone: t.customer_phone ?? null,
    customer_company: t.customer_company ?? null,
    items: (t.items ?? []).map(i => ({ name: i.name, qty: i.qty, sku: i.sku })),
    total: t.subtotal,
    status: 'PAID',
    created_at: t.created_at,
    walkin_order_id: null,
  };
}

export function mergeSalesEntries(
  orders: DbOrder[],
  kasir: KasirTransaction[]
): SalesEntry[] {
  const entries: SalesEntry[] = [
    ...orders.map(orderToSalesEntry),
    ...kasir.filter(t => t.type === 'income').map(kasirToSalesEntry),
  ];
  return entries.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  whatsapp:  'WhatsApp',
  walkin:    'Walk-in',
  tokopedia: 'Tokopedia',
  grosir:    'Grosir',
};

export const CHANNEL_BADGE_CLASS: Record<SalesChannel, string> = {
  whatsapp:  'bg-emerald-100 text-emerald-800',
  walkin:    'bg-slate-100 text-slate-700',
  tokopedia: 'bg-green-100 text-green-800',
  grosir:    'bg-amber-100 text-amber-800',
};
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/salesEntries.ts
git commit -m "feat(lib): salesEntries helper for unified order+kasir view"
```

---

## Task 6: `supabaseClient.ts` — services

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Extend `kasirService.insertSaleTransaction` to accept `customer_id`**

Locate `insertSaleTransaction` around line 921. Replace its body with:

```typescript
  async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    let customer_id = tx.customer_id ?? null;

    // If no customer_id provided but phone+name are, try to find or create the customer.
    if (!customer_id && tx.customer_phone && tx.customer_name) {
      const phone = tx.customer_phone.trim();
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('wa_number', phone)
        .maybeSingle();
      if (existing) {
        customer_id = existing.id;
      } else {
        const newId = crypto.randomUUID();
        const { error: insertErr } = await supabase
          .from('customers')
          .upsert(
            { id: newId, wa_number: phone, name: tx.customer_name.trim(), company: tx.customer_company?.trim() ?? '' },
            { onConflict: 'wa_number', ignoreDuplicates: false }
          );
        if (!insertErr) customer_id = newId;
      }
    }

    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({ ...tx, type: 'income', customer_id })
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
  },
```

- [ ] **Step 2: Extend `customersService.fetchProfile` to include kasir**

Locate `fetchProfile` around line 677. Replace its body with:

```typescript
  async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
    if (!supabase) throw new Error('Supabase not configured');
    const [customerRes, kasirRes] = await Promise.all([
      supabase
        .from('customers')
        .select('*, orders!orders_customer_id_fkey(*), leads!leads_customer_id_fkey(*)')
        .eq('id', customerId)
        .single(),
      supabase
        .from('kasir_transactions')
        .select('*')
        .eq('customer_id', customerId)
        .eq('type', 'income')
        .order('created_at', { ascending: false }),
    ]);
    if (customerRes.error) throw customerRes.error;
    if (kasirRes.error)    throw kasirRes.error;

    const profile = customerRes.data as any;
    profile.orders = (profile.orders ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.leads = (profile.leads ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.kasir_transactions = (kasirRes.data ?? []) as any[];
    return profile as DbCustomerProfile;
  },
```

Also update the `DbCustomerProfile` type. In `src/types.ts`, find `DbCustomerProfile` (search for `interface DbCustomerProfile`) and add a new field:

```typescript
  kasir_transactions: KasirTransaction[];
```

- [ ] **Step 3: Add `orderService.createWalkinDraft`**

Locate the `orderService` block (search for `export const orderService`). Add this method inside the object, after `fetchAll`:

```typescript
  async createWalkinDraft(input: {
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_company: string;
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

- [ ] **Step 4: Add `orderService.markWalkinPaid`**

In the same `orderService` block:

```typescript
  async markWalkinPaid(
    orderId: string,
    paymentMethod: 'cash' | 'transfer' | 'qris',
    invoiceNumber: string
  ): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('mark_walkin_order_paid', {
      p_order_id:       orderId,
      p_payment_method: paymentMethod,
      p_invoice_number: invoiceNumber,
    });
    if (error) throw error;
    return data as KasirTransaction;
  },
```

Make sure `KasirTransaction` is imported at the top of `supabaseClient.ts`. Open the imports — if `KasirTransaction` isn't imported, add it to the existing import from `'../types'`.

- [ ] **Step 5: Add `salesEntriesService` for OrderHistory's union query**

Place after `kasirService`'s closing `};`:

```typescript
export const salesEntriesService = {
  async fetchAll(): Promise<{ orders: DbOrder[]; kasir: KasirTransaction[] }> {
    if (!supabase) throw new Error('Supabase not configured');
    const [ordersRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('kasir_transactions').select('*').eq('type', 'income').order('created_at', { ascending: false }),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (kasirRes.error)  throw kasirRes.error;
    return {
      orders: (ordersRes.data ?? []) as DbOrder[],
      kasir:  (kasirRes.data  ?? []) as KasirTransaction[],
    };
  },

  async fetchOpenWalkinDrafts(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('sales_channel', 'walkin')
      .in('status', [
        'WAITING_PAYMENT', 'PAYMENT_UPLOADED',
        'WAITING_DP',      'DP_UPLOADED', 'DP_VERIFIED',
      ])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbOrder[];
  },
};
```

- [ ] **Step 6: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabaseClient.ts src/types.ts
git commit -m "feat(client): customer_id on kasir insert, fetchProfile unions kasir, walkin draft + markPaid"
```

---

## Task 7: KasirScreen — wire customer_id + add walkin draft action

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Pass `customer_id` when creating a kasir transaction**

Locate the sale insert path around lines 642-668 (the section that builds `newTx` and calls `kasirService.insertSaleTransaction`). The existing flow already auto-creates customers; we need to capture the customer_id and feed it into the insert.

Replace the block starting at `const newTx: NewSaleTransaction = {` with:

```typescript
      // Resolve customer_id BEFORE inserting the kasir row.
      let resolvedCustomerId: string | undefined = selectedCustomerId ?? undefined;
      if (!resolvedCustomerId && customerName.trim() && customerPhone.trim()) {
        try {
          await customersService.createCustomer(
            customerPhone.trim(),
            customerName.trim(),
            customerCompany.trim()
          );
          // createCustomer is upsert(ignoreDuplicates:true), so look up the id.
          const allCustomers = await customersService.fetchAll();
          resolvedCustomerId = allCustomers.find(
            c => c.wa_number === customerPhone.trim()
          )?.id;
        } catch {
          showToast('Transaksi disimpan, tapi gagal simpan data pelanggan.', 'warning');
        }
      }

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
        customer_id: resolvedCustomerId,
        invoice_number: invoiceNumber,
      };

      const saved = await kasirService.insertSaleTransaction(newTx);
```

Then remove the now-redundant "Auto-save new customer" block that ran AFTER `insertSaleTransaction` — it's been moved above.

- [ ] **Step 2: Add a "Buat Sales Order (Belum Dibayar)" button next to the existing save button**

Find the modal's footer button (the one currently calling the save function). In the buttons row, add a sibling button BEFORE the current "Simpan" button. Channel matters — only show for `walkin`:

```tsx
{channel === 'walkin' && (
  <button
    onClick={() => handleSaveDraft()}
    disabled={saving || items.length === 0}
    className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-xl transition-colors"
  >
    Buat Sales Order (Belum Dibayar)
  </button>
)}
```

- [ ] **Step 3: Implement `handleSaveDraft`**

Add this function inside the component, next to the existing save handler. Reuse the same items + customer fields, but call `orderService.createWalkinDraft`:

```typescript
async function handleSaveDraft() {
  if (items.length === 0) { showToast('Pilih item terlebih dahulu.', 'warning'); return; }
  if (!customerName.trim() || !customerPhone.trim()) {
    showToast('Nama dan nomor HP pelanggan wajib diisi untuk draft.', 'warning');
    return;
  }
  setSaving(true);
  try {
    // Same FIFO logic as paid sale — reuse existing block.
    const itemsWithFifo = await Promise.all(
      items.map(async item => {
        const { totalCost } = await stockService.previewFifoCost(item.sku, item.qty, warehouse);
        return {
          sku: item.sku,
          name: item.name,
          qty: item.qty,
          unit_price: item.unit_price,
          subtotal: item.qty * item.unit_price,
          hpp_per_unit: item.qty > 0 ? totalCost / item.qty : 0,
          hpp_subtotal: totalCost,
        };
      })
    );

    // Resolve customer_id (same path as paid sale).
    let resolvedCustomerId: string | null = selectedCustomerId ?? null;
    if (!resolvedCustomerId) {
      try {
        await customersService.createCustomer(customerPhone.trim(), customerName.trim(), customerCompany.trim());
        const allCustomers = await customersService.fetchAll();
        resolvedCustomerId = allCustomers.find(c => c.wa_number === customerPhone.trim())?.id ?? null;
      } catch { /* tolerate */ }
    }

    const draft = await orderService.createWalkinDraft({
      customer_id:      resolvedCustomerId,
      customer_name:    customerName.trim(),
      customer_phone:   customerPhone.trim(),
      customer_company: customerCompany.trim(),
      items:            itemsWithFifo.map(({ _key, ...rest }: any) => rest),
      subtotal,
      hpp_total:        itemsWithFifo.reduce((s, i) => s + i.hpp_subtotal, 0),
      total:            subtotal,
    });

    showToast('Sales order (belum dibayar) tersimpan. Cek menu Pipeline.', 'success');
    onClose();
  } catch (e) {
    console.error(e);
    showToast('Gagal menyimpan draft.', 'warning');
  } finally {
    setSaving(false);
  }
}
```

If `previewFifoCost` is not the actual helper name, grep for the FIFO preview function in the current file and use the matching name. The point is to reuse whatever existing FIFO computation the paid-sale flow uses; don't duplicate logic.

Also make sure `orderService` is imported at the top of the file alongside `kasirService`:

```typescript
import { kasirService, stockService, customersService, orderService, isSupabaseConfigured } from '../lib/supabaseClient';
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 5: Manual verification — paid sale path**

Start dev server:
```bash
npm run dev
```
Open the app, go to Kasir, "Walk-in" channel, add an item, fill name + phone, click "Simpan" (the existing paid flow). Then:
- SQL editor: `SELECT customer_id, customer_name FROM kasir_transactions ORDER BY created_at DESC LIMIT 1;`
- Expected: `customer_id` is non-null.

- [ ] **Step 6: Manual verification — walk-in draft path**

In Kasir Walk-in channel, click the new "Buat Sales Order (Belum Dibayar)" button. Verify:
- Toast appears, modal closes.
- SQL editor: `SELECT id, sales_channel, status, customer_id, total FROM orders ORDER BY created_at DESC LIMIT 1;`
- Expected: row with `sales_channel='walkin'`, `status='WAITING_PAYMENT'`, customer_id set, total matches.

Keep this order id — you'll use it in Task 8 verification.

- [ ] **Step 7: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): persist customer_id, add walkin draft order action"
```

---

## Task 8: PelangganScreen — unified Riwayat Pesanan

**Files:**
- Modify: `src/components/PelangganScreen.tsx`

- [ ] **Step 1: Build a derived `salesEntries` list**

Add import at the top:

```typescript
import { mergeSalesEntries, CHANNEL_LABEL, CHANNEL_BADGE_CLASS } from '../lib/salesEntries';
```

Then inside the component, near the existing `profile` derivations, compute:

```typescript
const salesEntries = profile
  ? mergeSalesEntries(profile.orders, profile.kasir_transactions ?? [])
  : [];
const totalSpend = salesEntries
  .filter(e => e.status === 'PAYMENT_VERIFIED' || e.status === 'PAID' || e.status === 'COMPLETED')
  .reduce((s, e) => s + e.total, 0);
```

- [ ] **Step 2: Use `salesEntries` in the stats row + total spend**

Locate the stats row around line 287-305. Replace the "Pesanan" stat value with `salesEntries.length.toString()` and the "total belanja" amount (around line 272) with `formatRupiah(totalSpend)`.

- [ ] **Step 3: Render `salesEntries` in the Riwayat Pesanan section**

Replace the orders block (lines 308-335) with:

```tsx
{/* Sales entries section */}
<div className="px-5 py-4">
  <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
    Riwayat Pesanan ({salesEntries.length})
  </div>
  {salesEntries.length === 0 ? (
    <p className="text-sm text-gray-400">Belum ada pesanan.</p>
  ) : (
    salesEntries.map(entry => {
      const badge = STATUS_BADGE[entry.status] ??
        (entry.status === 'PAID'
          ? { label: '✓ Lunas (Kasir)', className: 'bg-green-100 text-green-800' }
          : { label: entry.status, className: 'bg-gray-100 text-gray-600' });
      const totalColor = TOTAL_COLOR[entry.status] ?? (entry.status === 'PAID' ? 'text-green-700' : 'text-gray-700');
      return (
        <div key={entry.id} className="border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 text-xs">
          <div className="flex justify-between items-center mb-1 gap-2">
            <span className="font-bold font-mono text-gray-700 truncate">{entry.display_id}</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CHANNEL_BADGE_CLASS[entry.channel]}`}>
                {CHANNEL_LABEL[entry.channel]}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
            </div>
          </div>
          <div className="text-gray-500 text-[11px]">
            {entry.items[0]?.name ?? '—'}
            {entry.items.length > 1 && ` +${entry.items.length - 1}`}
            {' · '}{formatDate(entry.created_at)}
          </div>
          <div className={`font-extrabold text-sm mt-1 ${totalColor}`}>{formatRupiah(entry.total)}</div>
        </div>
      );
    })
  )}
</div>
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 5: Manual verification**

`npm run dev`. Open Pelanggan. Pick the customer used in Task 7 verification. Expected to see:
- Both the kasir transaction AND the walk-in draft order rendered as entries
- Each row shows channel badge ("Walk-in") + status badge ("✓ Lunas (Kasir)" or "⏳ Menunggu Bayar")
- "Pesanan" count = total entries, "total belanja" reflects only paid ones

- [ ] **Step 6: Commit**

```bash
git add src/components/PelangganScreen.tsx
git commit -m "feat(pelanggan): unified Riwayat Pesanan across orders + kasir"
```

---

## Task 9: OrderHistoryScreen — union + channel filter

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Switch from `orderService.fetchAll` to `salesEntriesService.fetchAll` + merge**

Imports at the top:

```typescript
import { salesEntriesService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { mergeSalesEntries, CHANNEL_LABEL, CHANNEL_BADGE_CLASS } from '../lib/salesEntries';
import type { SalesEntry, SalesChannel } from '../types';
```

State change — replace the `orders` state with `entries: SalesEntry[]`. In the fetch effect:

```typescript
useEffect(() => {
  if (!isSupabaseConfigured) return;
  let cancelled = false;
  (async () => {
    try {
      const { orders, kasir } = await salesEntriesService.fetchAll();
      if (!cancelled) setEntries(mergeSalesEntries(orders, kasir));
    } catch {
      showToast('Gagal memuat riwayat pesanan.', 'warning');
    }
  })();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 2: Adapt `filterOrders` to operate on `SalesEntry[]`**

Rename to `filterEntries` and update tabs:

```typescript
function filterEntries(
  entries: SalesEntry[],
  tab: FilterTab,
  search: string,
  channel: 'all' | SalesChannel,
): SalesEntry[] {
  let filtered = entries;
  if (channel !== 'all') {
    filtered = filtered.filter(e => e.channel === channel);
  }
  if (tab === 'pending')   filtered = filtered.filter(e => e.status === 'PENDING_ADMIN_CONFIRMATION');
  if (tab === 'waiting')   filtered = filtered.filter(e => e.status === 'WAITING_PAYMENT' || e.status === 'WAITING_DP' || e.status === 'DP_VERIFIED');
  if (tab === 'uploaded')  filtered = filtered.filter(e => e.status === 'PAYMENT_UPLOADED' || e.status === 'DP_UPLOADED');
  if (tab === 'done')      filtered = filtered.filter(e => e.status === 'PAYMENT_VERIFIED' || e.status === 'COMPLETED' || e.status === 'PAID');
  if (tab === 'cancelled') filtered = filtered.filter(e => e.status === 'CANCELLED' || e.status === 'PAYMENT_REJECTED' || e.status === 'DP_PROOF_REJECTED');
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.customer_name.toLowerCase().includes(q) ||
      e.display_id.toLowerCase().includes(q) ||
      (e.customer_phone ?? '').includes(q)
    );
  }
  return filtered;
}
```

- [ ] **Step 3: Add channel filter dropdown to the header**

Add a new state:
```typescript
const [channelFilter, setChannelFilter] = useState<'all' | SalesChannel>('all');
```

Render the dropdown next to the search box. Use the same styling as existing filters in the file:

```tsx
<select
  value={channelFilter}
  onChange={e => setChannelFilter(e.target.value as 'all' | SalesChannel)}
  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
>
  <option value="all">Semua Channel</option>
  <option value="whatsapp">WhatsApp</option>
  <option value="walkin">Walk-in</option>
  <option value="tokopedia">Tokopedia</option>
  <option value="grosir">Grosir</option>
</select>
```

- [ ] **Step 4: Render each card with channel badge**

Find the card render in the map block. Add a channel badge alongside the existing status badge:

```tsx
<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CHANNEL_BADGE_CLASS[entry.channel]}`}>
  {CHANNEL_LABEL[entry.channel]}
</span>
```

Map all references from `order` → `entry` and use `entry.display_id` instead of `order.gjp_order_id`. For the kasir status `'PAID'`, fall back to a friendly badge as in Task 8:

```typescript
const badge = STATUS_BADGE[entry.status] ??
  (entry.status === 'PAID'
    ? { label: '✓ Lunas (Kasir)', className: 'bg-green-100 text-green-800' }
    : { label: entry.status, className: 'bg-gray-100 text-gray-600' });
```

- [ ] **Step 5: Handle the "open customer" action**

The existing click handler calls `onOpenCustomer(order.customer_id)`. Adapt to `entry.customer_id` and guard nulls:

```tsx
onClick={e => { e.stopPropagation(); if (entry.customer_id) onOpenCustomer(entry.customer_id); }}
```

- [ ] **Step 6: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 7: Manual verification**

`npm run dev`. Open Riwayat Pesanan. Expected:
- Walk-in kasir sales + Tokopedia/Grosir kasir sales now appear alongside WhatsApp orders
- Channel filter dropdown narrows correctly
- "Selesai" tab includes both PAYMENT_VERIFIED (orders) and kasir "PAID" entries
- Channel badges visible on every card

- [ ] **Step 8: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(order-history): union kasir + orders, add channel filter and badges"
```

---

## Task 10: PipelineScreen — walk-in drafts + Tandai Lunas

**Files:**
- Modify: `src/components/PipelineScreen.tsx`

- [ ] **Step 1: Define a `PipelineEntry` union and fetch both sources**

At top of the file, add imports:

```typescript
import { leadsService, customersService, orderService, salesEntriesService, isSupabaseConfigured } from '../lib/supabaseClient';
import type { DbLead, DbOrder } from '../types';
import { CHANNEL_LABEL, CHANNEL_BADGE_CLASS } from '../lib/salesEntries';
```

Define a discriminated union inside the file (above the component):

```typescript
type PipelineEntry =
  | { kind: 'lead';         id: string; data: DbLead;  customer_name: string; updated_at: string; status: string }
  | { kind: 'walkin_order'; id: string; data: DbOrder; customer_name: string; updated_at: string; status: string };
```

Replace the existing `leadsService.fetchAll()` call with parallel fetch:

```typescript
const [leadsRes, walkinRes] = await Promise.all([
  leadsService.fetchAll(),
  salesEntriesService.fetchOpenWalkinDrafts(),
]);
const entries: PipelineEntry[] = [
  ...leadsRes.map(l => ({
    kind: 'lead' as const,
    id:   `lead:${l.id}`,
    data: l,
    customer_name: (l as any).customers?.name ?? l.wa_number,
    updated_at: l.updated_at,
    status: l.status,
  })),
  ...walkinRes.map(o => ({
    kind: 'walkin_order' as const,
    id:   `wo:${o.id}`,
    data: o,
    customer_name: o.customer_name,
    updated_at: o.updated_at ?? o.created_at,
    // Map walk-in order status to the existing lead-style columns so the funnel
    // layout still works: WAITING_* → IN_PROGRESS, PAYMENT_UPLOADED → IN_PROGRESS,
    // DP_VERIFIED → IN_PROGRESS.
    status: 'IN_PROGRESS',
  })),
].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
```

Update state type from `DbLead[]` to `PipelineEntry[]`.

- [ ] **Step 2: Update card rendering to handle both kinds**

Wherever the current code iterates over leads to render cards, switch on `entry.kind`. For `walkin_order`, render channel badge + a "Tandai Lunas" button.

Suggested per-card template:

```tsx
{entries.map(entry => (
  <div key={entry.id} className="...existing classes...">
    <div className="flex justify-between items-start mb-2">
      <div>
        <div className="font-bold text-sm text-gray-800">{entry.customer_name}</div>
        {entry.kind === 'walkin_order' && (
          <div className="text-[10px] text-gray-500 font-mono">{entry.data.gjp_order_id ?? entry.data.id.slice(0,8)}</div>
        )}
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
        entry.kind === 'lead' ? CHANNEL_BADGE_CLASS.whatsapp : CHANNEL_BADGE_CLASS.walkin
      }`}>
        {entry.kind === 'lead' ? CHANNEL_LABEL.whatsapp : CHANNEL_LABEL.walkin}
      </span>
    </div>
    {entry.kind === 'walkin_order' && (
      <button
        onClick={() => handleMarkPaid(entry.data)}
        className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold py-2 rounded-lg transition-colors"
      >
        Tandai Lunas
      </button>
    )}
    {/* existing lead actions render only when entry.kind === 'lead' */}
  </div>
))}
```

- [ ] **Step 3: Implement `handleMarkPaid`**

```typescript
async function handleMarkPaid(order: DbOrder) {
  const method = window.prompt('Metode pembayaran: cash / transfer / qris', 'cash');
  if (!method) return;
  if (!['cash','transfer','qris'].includes(method)) {
    showToast('Metode tidak valid.', 'warning'); return;
  }
  const invoice = window.prompt('Nomor invoice', order.gjp_order_id ?? `INV-${order.id.slice(0,8)}`);
  if (!invoice) return;
  try {
    await orderService.markWalkinPaid(order.id, method as 'cash'|'transfer'|'qris', invoice);
    showToast('Pesanan ditandai lunas.', 'success');
    // refetch
    const [leadsRes, walkinRes] = await Promise.all([
      leadsService.fetchAll(),
      salesEntriesService.fetchOpenWalkinDrafts(),
    ]);
    setEntries(/* same merge as Step 1 */);
  } catch (e) {
    console.error(e);
    showToast('Gagal menandai lunas.', 'warning');
  }
}
```

Extract the merge logic from Step 1 into a local helper to avoid duplication:

```typescript
function mergeToEntries(leads: DbLead[], walkin: DbOrder[]): PipelineEntry[] {
  return [
    ...leads.map(l => ({ kind: 'lead' as const, ... })),
    ...walkin.map(o => ({ kind: 'walkin_order' as const, ... })),
  ].sort((a,b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 5: Manual verification end-to-end**

`npm run dev`. Steps:
1. Pipeline shows existing WA leads alongside the walk-in draft from Task 7.
2. Each card shows correct channel badge.
3. Click "Tandai Lunas" on the walk-in card → enter cash / arbitrary invoice → toast says success.
4. SQL editor:
   ```sql
   SELECT id, status FROM orders WHERE id = '<order_uuid>';
   SELECT * FROM kasir_transactions WHERE invoice_number = '<invoice>';
   ```
   Expected: order status = `PAYMENT_VERIFIED`; kasir_transactions has new income row matching the order.
5. The card disappears from Pipeline (no longer "open").
6. The same entry now appears in OrderHistory's "Selesai" tab as a kasir entry AND the order's status updated.

- [ ] **Step 6: Commit**

```bash
git add src/components/PipelineScreen.tsx
git commit -m "feat(pipeline): include walk-in draft orders, atomic Tandai Lunas"
```

---

## Task 11: progress.md + final commit

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Append a "What changed" entry**

Open `progress.md` and append (at the end of the file) a dated section summarizing the unified sales channel work — what was built, which migrations were applied, which screens changed. Per the project's CLAUDE.md gotcha, this is required after task completion. Keep it factual, no marketing copy.

Template:
```markdown
## 2026-06-08 — Unified Sales Channel

**Migrations applied**
- 20260608000001_kasir_customer_id.sql — kasir_transactions.customer_id FK + backfill
- 20260608000002_orders_sales_channel.sql — orders.sales_channel ('whatsapp'|'walkin')
- 20260608000003_mark_walkin_order_paid_rpc.sql — atomic walk-in payment RPC

**Screens updated**
- PelangganScreen — Riwayat Pesanan now unions orders + kasir_transactions
- OrderHistoryScreen — channel filter dropdown; lists every channel
- PipelineScreen — walk-in draft orders show alongside WA leads; "Tandai Lunas" transitions atomically
- KasirScreen — persists customer_id on every sale; new "Buat Sales Order (Belum Dibayar)" walk-in action

**Spec/plan**
- docs/superpowers/specs/2026-06-08-unified-sales-channel-design.md
- docs/superpowers/plans/2026-06-08-unified-sales-channel.md
```

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "docs: update progress with unified sales channel completion"
```

---

## Self-Review Checklist (performed by plan author)

- [x] Spec coverage: Issue 1 (PelangganScreen) → Tasks 1, 6 step 2, 8. Issue 2 (OrderHistory all channels) → Task 9. Issue 3 (Pipeline walk-in) → Tasks 2, 3, 6 steps 3-4, 7, 10.
- [x] Placeholder scan: every code step contains full code. The `mergeToEntries` extraction in Task 10 step 3 references "same merge as Step 1" — executor must inline the actual function body in both places; called out explicitly.
- [x] Type consistency: `SalesEntry`, `SalesChannel`, `DbOrder.sales_channel`, `KasirTransaction.customer_id` defined in Task 4 and used consistently in 5/6/8/9/10.
- [x] No tests framework — verification is `npm run lint` + dev-server + SQL checks. Explicitly stated in plan header.
