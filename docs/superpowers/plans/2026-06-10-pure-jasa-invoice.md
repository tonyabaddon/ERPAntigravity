# Pure-Jasa Lunas Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner save and print a Lunas/DP invoice from a cart that contains only Jasa Rakit or Jasa Custom Panel lines (no SKU items), bypassing WIP + lock-approval.

**Architecture:** Pure-jasa carts route through the existing `record_kasir_sale` RPC. Service lines ride in the same `items[]` JSON payload as SKU lines, distinguished by `sku=null`. The RPC skips null-sku items in its stock-deduction/FIFO loops and passes owner-typed HPP through verbatim. Mixed carts (SKU + jasa) keep the unchanged WIP + lock-approval path. The cart UI gains an HPP input on the Jasa Rakit / Custom Panel inline form; one validation fix and one branch-condition update in `PenjualanBaruScreen` open the new path.

**Tech Stack:** Postgres / Supabase PL-pgSQL (RPC), React + TypeScript (Vite), Vitest integration tests against live Supabase, chrome-devtools-mcp for browser verification.

**Spec:** `docs/superpowers/specs/2026-06-10-pure-jasa-invoice-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql` | Create | RPC body update: skip `sku IS NULL` items in aggregation/FIFO; pass-through HPP for service lines |
| `tests/integration/sales-recording.test.ts` | Modify | Add 2 tests: pure-service-line RPC happy path + mixed-cart RPC regression |
| `src/components/penjualan/RakitInlineForm.tsx` | Modify | New "HPP (modal)" number input; widened `onAdd` payload |
| `src/components/PenjualanBaruScreen.tsx` | Modify | (1) `rakitLines` state shape gains `hppEstimate`. (2) `handleSave` validation accepts pure-jasa cart. (3) New `isMixedCart` gate replaces `hasRakit` for the WIP branch. (4) Builds unified `items[]` for pure-jasa `recordSale`. (5) WIP banner gated on `isMixedCart` |
| `src/components/penjualan/SalesInvoicePDF.tsx` | Modify | Render `item.sku` subtitle only when truthy |
| `progress.md` | Modify | New session entry |

---

## Task 1: SQL migration — `record_kasir_sale` skips null-sku items

**Files:**
- Create: `supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql`
- Modify: `tests/integration/sales-recording.test.ts` (append 2 new tests inside the existing `describe('record_kasir_sale RPC', ...)` block at line 362)

- [ ] **Step 1: Write the failing tests**

Open `tests/integration/sales-recording.test.ts`. Inside the existing `describe('record_kasir_sale RPC', () => { ... })` block (currently ends at line 426), append these two tests just before the closing `});` of the describe:

```typescript
test('RPC accepts service line with sku=null and skips stock deduction', async () => {
  const today = new Date().toISOString().slice(0, 10);

  // Snapshot stock before — should be unchanged after the call.
  const { data: beforeStock } = await supabase
    .from('stocks')
    .select('stock_atas, stock_bawah')
    .eq('sku', TEST_SKU)
    .single();

  const { data, error } = await supabase.rpc('record_kasir_sale', {
    p_date:              today,
    p_channel:           'walkin',
    p_items:             [
      {
        sku: null,
        name: 'Jasa Rakit — Box Wiring PT XYZ',
        qty: 1,
        unit_price: 1500000,
        subtotal: 1500000,
        hpp_per_unit: 800000,
        hpp_subtotal: 800000,
        warehouse: null,
      },
    ],
    p_subtotal:          1500000,
    p_payment_method:    'cash',
    p_payment_subtype:   null,
    p_payment_type:      'FULL',
    p_dp_amount:         0,
    p_dp_input_type:     null,
    p_ongkir_amount:     0,
    p_notes:             null,
    p_total_amount:      1500000,
    p_customer_name:     `${TEST_PREFIX}-rpc-pure-jasa`,
    p_customer_phone:    '0812-TEST-rpc-pure-jasa',
    p_customer_company:  null,
    p_delivery_address:  null,
    p_tokped_order_no:   null,
    p_wa_phone:          null,
    p_wa_chat_url:       null,
    p_customer_id:       null,
  });
  expect(error).toBeNull();
  expect(data).toBeTruthy();
  expect(data.status).toBe('PAID');
  expect(Number(data.hpp_total)).toBe(800000); // owner-typed HPP propagates verbatim
  expect(data.items).toHaveLength(1);
  expect(data.items[0].sku).toBeNull();
  expect(Number(data.items[0].hpp_per_unit)).toBe(800000);
  expect(Number(data.items[0].hpp_subtotal)).toBe(800000);

  // Stock untouched — RPC must skip null-sku in aggregation.
  const { data: afterStock } = await supabase
    .from('stocks')
    .select('stock_atas, stock_bawah')
    .eq('sku', TEST_SKU)
    .single();
  expect(afterStock?.stock_atas).toBe(beforeStock?.stock_atas);
  expect(afterStock?.stock_bawah).toBe(beforeStock?.stock_bawah);
});

test('RPC handles mixed cart: SKU line deducts stock, service line passes through', async () => {
  const today = new Date().toISOString().slice(0, 10);

  const { data: beforeStock } = await supabase
    .from('stocks')
    .select('stock_atas')
    .eq('sku', TEST_SKU)
    .single();

  const { data, error } = await supabase.rpc('record_kasir_sale', {
    p_date:              today,
    p_channel:           'walkin',
    p_items:             [
      { sku: TEST_SKU, name: 'Test SKU', qty: 1, unit_price: 50000, subtotal: 50000, warehouse: 'atas' },
      {
        sku: null,
        name: 'Jasa Custom Panel',
        qty: 1,
        unit_price: 500000,
        subtotal: 500000,
        hpp_per_unit: 200000,
        hpp_subtotal: 200000,
        warehouse: null,
      },
    ],
    p_subtotal:          550000,
    p_payment_method:    'cash',
    p_payment_subtype:   null,
    p_payment_type:      'FULL',
    p_dp_amount:         0,
    p_dp_input_type:     null,
    p_ongkir_amount:     0,
    p_notes:             null,
    p_total_amount:      550000,
    p_customer_name:     `${TEST_PREFIX}-rpc-mixed`,
    p_customer_phone:    '0812-TEST-rpc-mixed',
    p_customer_company:  null,
    p_delivery_address:  null,
    p_tokped_order_no:   null,
    p_wa_phone:          null,
    p_wa_chat_url:       null,
    p_customer_id:       null,
  });
  expect(error).toBeNull();
  expect(data).toBeTruthy();

  // SKU line deducts 1 from stock_atas; service line is no-op for stock.
  const { data: afterStock } = await supabase
    .from('stocks')
    .select('stock_atas')
    .eq('sku', TEST_SKU)
    .single();
  expect((afterStock?.stock_atas ?? 0)).toBe((beforeStock?.stock_atas ?? 0) - 1);

  // hpp_total = FIFO-walked SKU cost + verbatim service HPP.
  // Seeded harga_modal = 30000 (TEST_SKU lot from beforeAll), so SKU contributes 30000.
  expect(Number(data.hpp_total)).toBe(30000 + 200000);
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run:
```bash
npm run test:integration -- -t "record_kasir_sale RPC"
```

Expected: the two new tests FAIL with the existing RPC's `malformed item in p_items: sku=, qty=1` error (raised at line 140-141 of `20260609000001_record_kasir_sale_rpc.sql`). The pre-existing two tests in the same describe must still PASS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql` with this exact body:

```sql
-- record_kasir_sale (revision 2026-06-10): support pure-service lines.
--
-- Cart lines with sku=null represent Jasa Rakit / Jasa Custom Panel service
-- billing — no stock deduction, no FIFO walk. The RPC must:
--   * Skip null-sku items in the (sku, warehouse) aggregation loop.
--   * In the per-item re-emit loop, pass hpp_per_unit / hpp_subtotal from the
--     input verbatim for null-sku items (owner-typed estimate).
--   * Still count service-line hpp_subtotal toward v_hpp_total so
--     kasir_transactions.hpp_total reflects total cost.
--
-- All other behavior (customer find-or-create, invoice counter, FIFO for SKU
-- items, status derivation) is unchanged from 20260609000001.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date              date,
  p_channel           text,
  p_items             jsonb,
  p_subtotal          numeric,
  p_payment_method    text,
  p_payment_subtype   text,
  p_payment_type      text,
  p_dp_amount         numeric,
  p_dp_input_type     text,
  p_ongkir_amount     numeric,
  p_notes             text,
  p_total_amount      numeric,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_company  text,
  p_delivery_address  text,
  p_tokped_order_no   text,
  p_wa_phone          text,
  p_wa_chat_url       text,
  p_customer_id       text
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_customer_id    text := p_customer_id;
  v_counter        int;
  v_invoice_prefix text;
  v_invoice_number text;
  v_status         text;
  v_kasir          public.kasir_transactions%ROWTYPE;
  v_agg            record;
  v_agg_cost       numeric;
  v_cost_map       jsonb := '{}'::jsonb;
  v_items_out      jsonb := '[]'::jsonb;
  v_item           jsonb;
  v_item_out       jsonb;
  v_sku            text;
  v_qty            int;
  v_warehouse      text;
  v_hpp_per_unit   numeric;
  v_hpp_subtotal   numeric;
  v_hpp_total      numeric := 0;
  v_key            text;
BEGIN
  -- 1. Input validation. Fail fast before any side effects.
  IF p_channel NOT IN ('walkin', 'tokopedia', 'grosir', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid channel: % (expected walkin|tokopedia|grosir|whatsapp)', p_channel;
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'qris', 'edc') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris|edc)', p_payment_method;
  END IF;
  IF p_payment_type NOT IN ('FULL', 'DP') THEN
    RAISE EXCEPTION 'invalid payment_type: % (expected FULL|DP)', p_payment_type;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must contain at least one line';
  END IF;

  -- 2. Find-or-create customer if not already linked.
  IF v_customer_id IS NULL
     AND p_customer_phone IS NOT NULL AND length(btrim(p_customer_phone)) > 0
     AND p_customer_name  IS NOT NULL AND length(btrim(p_customer_name))  > 0 THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE wa_number = btrim(p_customer_phone)
    LIMIT 1;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO public.customers (id, wa_number, name, company)
      VALUES (
        v_customer_id,
        btrim(p_customer_phone),
        btrim(p_customer_name),
        COALESCE(btrim(p_customer_company), '')
      )
      ON CONFLICT (wa_number) DO UPDATE
        SET name = EXCLUDED.name
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  -- 3. Reserve the invoice number BEFORE stock mutations.
  v_counter := public.next_kasir_number(p_channel, p_date);
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'whatsapp'  THEN 'WAM'
    ELSE 'GRS'
  END;
  v_invoice_number := v_invoice_prefix
    || '-' || to_char(p_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  -- 4. Aggregate (sku, warehouse) for SKU lines only. Service lines
  --    (sku IS NULL) are skipped here: no stock decrement, no FIFO walk.
  FOR v_agg IN
    SELECT
      item->>'sku' AS sku,
      COALESCE(item->>'warehouse', 'atas') AS warehouse,
      SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    WHERE item->>'sku' IS NOT NULL
    GROUP BY 1, 2
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'malformed item in p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_agg_cost := public.deduct_stock_fifo(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_hpp_total := v_hpp_total + v_agg_cost;

    v_key := v_agg.sku || '||' || v_agg.warehouse;
    v_cost_map := v_cost_map || jsonb_build_object(
      v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END
    );
  END LOOP;

  -- 5. Re-emit items[]. SKU lines fill hpp_per_unit/hpp_subtotal from
  --    v_cost_map. Service lines (sku IS NULL) pass through the
  --    input's hpp_per_unit / hpp_subtotal verbatim and add to v_hpp_total.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku       := v_item->>'sku';
    v_qty       := (v_item->>'qty')::int;
    IF v_sku IS NULL THEN
      v_hpp_per_unit := COALESCE((v_item->>'hpp_per_unit')::numeric, 0);
      v_hpp_subtotal := COALESCE((v_item->>'hpp_subtotal')::numeric, v_hpp_per_unit * v_qty);
      v_hpp_total    := v_hpp_total + v_hpp_subtotal;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    ELSE
      v_warehouse := COALESCE(v_item->>'warehouse', 'atas');
      v_key       := v_sku || '||' || v_warehouse;
      v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
      v_hpp_subtotal := v_hpp_per_unit * v_qty;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    END IF;
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  -- 6. Insert kasir_transactions row.
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    tokped_order_no, wa_phone, wa_chat_url, status,
    customer_id, customer_name, customer_phone, customer_company,
    delivery_address, invoice_number
  ) VALUES (
    p_date,
    'income',
    p_channel::public.kasir_channel,
    v_items_out,
    p_subtotal,
    v_hpp_total,
    p_payment_method::public.kasir_payment_method,
    p_payment_subtype,
    p_payment_type,
    COALESCE(p_dp_amount, 0),
    p_dp_input_type,
    COALESCE(p_ongkir_amount, 0),
    p_notes,
    p_total_amount,
    p_tokped_order_no,
    p_wa_phone,
    p_wa_chat_url,
    v_status,
    v_customer_id,
    p_customer_name,
    p_customer_phone,
    p_customer_company,
    p_delivery_address,
    v_invoice_number
  )
  RETURNING * INTO v_kasir;

  RETURN v_kasir;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
) TO anon, authenticated;
```

- [ ] **Step 4: Apply migration to live Supabase**

Use the project's standard psql recipe. From the repo root:

```bash
CONNSTR=$(grep '^SUPABASE_DB_CONNECTION=' backend-go/.env | sed 's/^SUPABASE_DB_CONNECTION=//')
psql "$CONNSTR" -f supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql
```

Expected output:
```
CREATE FUNCTION
GRANT
```

If `psql` is not on PATH, use the libpq binary path verified in earlier sessions: `/opt/homebrew/Cellar/libpq/18.4/bin/psql`.

- [ ] **Step 5: Re-run the failing tests, expect pass**

Run:
```bash
npm run test:integration -- -t "record_kasir_sale RPC"
```

Expected: all 4 tests in the `record_kasir_sale RPC` describe pass (2 pre-existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260610000001_record_kasir_sale_service_lines.sql tests/integration/sales-recording.test.ts
git commit -m "feat(kasir): record_kasir_sale supports sku=null service lines

Cart lines for Jasa Rakit / Jasa Custom Panel with no SKU now bypass the
stock-deduction / FIFO walk. Owner-typed hpp_per_unit + hpp_subtotal pass
through verbatim and still feed v_hpp_total so kasir_transactions.hpp_total
matches the cart cost.

Adds 2 integration tests pinning the null-sku + mixed-cart contracts."
```

---

## Task 2: `RakitInlineForm` — capture HPP at cart time

**Files:**
- Modify: `src/components/penjualan/RakitInlineForm.tsx`

- [ ] **Step 1: Update the file in place**

Replace the entire body of `src/components/penjualan/RakitInlineForm.tsx` with:

```tsx
// src/components/penjualan/RakitInlineForm.tsx
import React, { useState } from 'react';
import type { RakitServiceType } from '../../types';

interface RakitInlineFormProps {
  type: RakitServiceType;
  onAdd: (line: {
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
    hppEstimate: number;
  }) => void;
  onCancel: () => void;
}

export default function RakitInlineForm({ type, onAdd, onCancel }: RakitInlineFormProps) {
  const [description, setDescription] = useState('');
  const [estimatedPrice, setEstimatedPrice] = useState<number>(0);
  const [hppEstimate, setHppEstimate] = useState<number>(0);
  const isCustom = type === 'jasa_custom_panel';

  const canSubmit = description.trim().length > 0 && estimatedPrice > 0;
  const submit = () => {
    if (!canSubmit) return;
    onAdd({ type, description: description.trim(), estimatedPrice, hppEstimate });
    setDescription('');
    setEstimatedPrice(0);
    setHppEstimate(0);
  };

  const placeholder = isCustom
    ? 'Mis. Custom Panel Distribusi 3-fase — PLN 50kVA'
    : 'Mis. Box Wiring untuk PT XYZ — 1 unit';

  return (
    <div className={`bg-white border ${isCustom ? 'border-sky-300' : 'border-orange-300'} rounded-xl p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
            isCustom ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}>
            {isCustom ? '📦 Jasa Custom Panel' : '⚡ Jasa Rakit'}
          </span>
          <span className="text-[11px] text-slate-500">isi detail di bawah</span>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-rose-500 text-base">✕</button>
      </div>
      <div>
        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Deskripsi (singkat, tampil di invoice)</div>
        <input
          type="text"
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
          placeholder={placeholder}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Estimasi Harga (quote disepakati)</div>
          <input
            type="number"
            min={0}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
            placeholder="0"
            value={estimatedPrice || ''}
            onChange={e => setEstimatedPrice(Number(e.target.value || 0))}
          />
        </div>
        <div>
          <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">HPP (modal)</div>
          <input
            type="number"
            min={0}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
            placeholder="0"
            value={hppEstimate || ''}
            onChange={e => setHppEstimate(Number(e.target.value || 0))}
          />
        </div>
      </div>
      <div className="text-[11px] text-slate-500">
        ℹ Admin bisa adjust ke harga final saat lock kalau scope berubah (untuk cart dengan SKU). Untuk cart pure-jasa, HPP di sini final.
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-[12px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
          Batal
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`px-3 py-2 rounded-lg text-[12px] font-extrabold text-white transition ${
            isCustom ? 'bg-sky-500 hover:bg-sky-600' : 'bg-amber-500 hover:bg-amber-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          + Tambah ke Cart
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npm run lint
```

Expected: 0 TypeScript errors. (`npm run lint` runs `tsc --noEmit`.) Note: this command will surface a type error in `PenjualanBaruScreen.tsx` because `addRakitLine` doesn't yet accept `hppEstimate` — that's expected and fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/RakitInlineForm.tsx
git commit -m "feat(rakit-form): capture HPP (modal) alongside Estimasi Harga"
```

---

## Task 3: `PenjualanBaruScreen` — open the pure-jasa save path

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Widen the rakit cart state shape**

Edit `src/components/PenjualanBaruScreen.tsx` around line 76. Change:

```tsx
  const [rakitLines, setRakitLines] = useState<Array<{
    id: string;
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
  }>>([]);
```

to:

```tsx
  const [rakitLines, setRakitLines] = useState<Array<{
    id: string;
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
    hppEstimate: number;
  }>>([]);
```

- [ ] **Step 2: Update `addRakitLine` signature**

In the same file around line 93, change:

```tsx
  const addRakitLine = (line: { type: RakitServiceType; description: string; estimatedPrice: number }) => {
```

to:

```tsx
  const addRakitLine = (line: { type: RakitServiceType; description: string; estimatedPrice: number; hppEstimate: number }) => {
```

The body (`const id = ...; setRakitLines(prev => [...prev, { id, ...line }]); cancelRakitForm();`) stays the same — spread propagates the new field.

- [ ] **Step 3: Introduce `isMixedCart` and `isPureJasa`**

Around line 113-114, change:

```tsx
  // Rakit derived values
  const hasRakit = rakitLines.length > 0;
  const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);
```

to:

```tsx
  // Rakit derived values
  const hasRakit = rakitLines.length > 0;
  const isMixedCart = hasRakit && cart.length > 0;
  const isPureJasa = hasRakit && cart.length === 0;
  const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);
```

- [ ] **Step 4: Fix validation to accept pure-jasa cart**

Around line 163 inside `handleSave`, change:

```tsx
    if (cart.length === 0) { showToast('Tambahkan minimal 1 item.', 'warning'); return; }
```

to:

```tsx
    if (cart.length === 0 && rakitLines.length === 0) {
      showToast('Tambahkan minimal 1 item atau jasa.', 'warning');
      return;
    }
```

- [ ] **Step 5: Re-gate the WIP branch on mixed cart**

Around line 183, change:

```tsx
    // WIP branch: when rakit lines exist, save as WIP and navigate to wip-list
    if (hasRakit) {
```

to:

```tsx
    // WIP branch: mixed carts (SKU + jasa) go through lock-approval so SKU
    // stock can be deducted at lock time. Pure-jasa carts fall through to
    // the recordSale path below.
    if (isMixedCart) {
```

- [ ] **Step 6: Build unified `items[]` for pure-jasa `recordSale`**

After the WIP branch's `return;` (around line 230-231) and before `setSaving(true);` for the recordSale path (around line 233), no change needed yet.

The recordSale call at line 236 currently uses `cart.map(({ _key, ...rest }) => rest)`. For pure-jasa, we need to append service lines to this array. Change:

```tsx
      const saved = await kasirService.recordSale({
        date: today,
        channel,
        items: cart.map(({ _key, ...rest }) => rest),
        subtotal,
```

to:

```tsx
      const skuItems = cart.map(({ _key, ...rest }) => rest);
      const serviceItems = rakitLines.map(l => ({
        sku: null,
        name: l.description,
        qty: 1,
        unit_price: l.estimatedPrice,
        hpp_per_unit: l.hppEstimate,
        subtotal: l.estimatedPrice,
        hpp_subtotal: l.hppEstimate,
        warehouse: null,
      }));
      const saved = await kasirService.recordSale({
        date: today,
        channel,
        items: [...skuItems, ...serviceItems],
        subtotal,
```

Leave the rest of the `kasirService.recordSale` call (payment, customer, total_amount, etc.) unchanged.

- [ ] **Step 7: Update the `RecordKasirSaleInput.items` type to allow null sku**

The `recordSale` payload is typed in `src/lib/supabaseClient.ts`. Find the `RecordKasirSaleInput` type. Run:

```bash
grep -n "RecordKasirSaleInput\|items: Array" src/lib/supabaseClient.ts | head -10
```

Find the `items` field on `RecordKasirSaleInput` (it currently constrains items to `{ sku: string; ... }`). Update the `sku` field's type to `string | null` and `warehouse` to `WarehouseLocation | null`. If the type definition lives in `src/types.ts` instead, edit there. Apply the same `string | null` / `null` widening.

Example diff (paste the surrounding interface from your grep output, then change the two fields):

```tsx
// before
items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number; hpp_per_unit?: number; hpp_subtotal?: number; warehouse?: WarehouseLocation }>;
// after
items: Array<{ sku: string | null; name: string; qty: number; unit_price: number; subtotal: number; hpp_per_unit?: number; hpp_subtotal?: number; warehouse?: WarehouseLocation | null }>;
```

(If the actual field layout differs, keep the existing field names and only widen `sku` and `warehouse`.)

- [ ] **Step 8: Gate the WIP banner on `isMixedCart`**

Around line 369-374, change:

```tsx
                  {hasRakit && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-800 mt-3">
                      ⚠ <strong>Transaksi ini akan masuk status WIP</strong> karena ada jasa rakit.
                      Lock + approval owner diperlukan sebelum stock decrement &amp; pelunasan.
                    </div>
                  )}
```

to:

```tsx
                  {isMixedCart && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-800 mt-3">
                      ⚠ <strong>Transaksi ini akan masuk status WIP</strong> karena ada SKU + jasa rakit di cart yang sama.
                      Lock + approval owner diperlukan sebelum stock decrement &amp; pelunasan.
                    </div>
                  )}
                  {isPureJasa && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[12px] text-emerald-800 mt-3">
                      💡 Cart pure-jasa &mdash; invoice langsung dicetak tanpa lock/approval.
                    </div>
                  )}
```

- [ ] **Step 9: Verify it compiles**

Run:
```bash
npm run lint
```

Expected: 0 TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx src/lib/supabaseClient.ts src/types.ts
git commit -m "feat(penjualan): pure-jasa cart saves direct Lunas invoice (skip WIP)

Cart with only Jasa Rakit / Jasa Custom Panel lines now routes through
record_kasir_sale instead of insertWipWithRakit. Service lines ride in the
items[] payload as sku=null with owner-typed HPP from RakitInlineForm.
Mixed carts (SKU + jasa) keep the existing WIP+lock flow."
```

(`src/types.ts` may not be in the diff if the type lived in `supabaseClient.ts` — `git add` is forgiving of missing paths.)

---

## Task 4: `SalesInvoicePDF` — hide empty sku subtitle

**Files:**
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx:209`

- [ ] **Step 1: Guard the sku div**

Around line 207-210 of `src/components/penjualan/SalesInvoicePDF.tsx`, find:

```tsx
              <td className="px-1 py-1 border-b border-dotted border-slate-300">
                <div className="font-bold">{item.name}</div>
                <div className="text-[10px] text-slate-500">{item.sku}</div>
              </td>
```

Change the second inner `<div>` to render only when `item.sku` is truthy:

```tsx
              <td className="px-1 py-1 border-b border-dotted border-slate-300">
                <div className="font-bold">{item.name}</div>
                {item.sku && <div className="text-[10px] text-slate-500">{item.sku}</div>}
              </td>
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npm run lint
```

Expected: 0 TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/SalesInvoicePDF.tsx
git commit -m "fix(invoice-pdf): omit empty sku subtitle for service lines"
```

---

## Task 5: Build, deploy, verify end-to-end in the live app

**Files:** none modified — verification only.

- [ ] **Step 1: Local production build**

Run:
```bash
npm run build
```

Expected: `dist/assets/index-*.js` written, no TS errors. Note the new bundle hash from the output — you'll use it to identify the deploy.

- [ ] **Step 2: Confirm push, then push to main**

Push triggers Cloud Build → Cloud Run deploy. Before pushing, surface to the user that this deploys to the live Cloud Run instance (the user is the deploy authority on this project — confirm intent before the push).

After user confirms:

```bash
git push origin main
```

- [ ] **Step 3: Poll for new bundle live**

Run this loop (it exits on bundle change or after 7 minutes):

```bash
OLD=$(curl -s "https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Current bundle: $OLD"
START=$(date +%s)
while true; do
  CURRENT=$(curl -s "https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
  ELAPSED=$(($(date +%s) - START))
  if [ "$CURRENT" != "$OLD" ] && [ -n "$CURRENT" ]; then
    echo "[t=${ELAPSED}s] NEW BUNDLE LIVE: $CURRENT"
    break
  fi
  if [ $ELAPSED -gt 420 ]; then
    echo "[t=${ELAPSED}s] TIMEOUT — still $CURRENT"
    exit 1
  fi
  echo "[t=${ELAPSED}s] still $CURRENT"
  sleep 20
done
```

Expected: bundle hash changes within ~3 minutes.

- [ ] **Step 4: Verify pure-jasa Lunas in chrome-devtools-mcp**

In the existing chrome-devtools tab (or open a new page on the Cloud Run URL):

1. `mcp__chrome-devtools__navigate_page` with `type: reload, ignoreCache: true`.
2. Click "Catat Penjualan" sidebar item.
3. `take_snapshot` to find UIDs.
4. Click "+ Tambah Jasa Rakit" (the amber button).
5. `fill` description with "Test Pure Jasa Rakit"; `fill` Estimasi Harga with "1500000"; `fill` HPP with "800000".
6. Click "+ Tambah ke Cart".
7. Fill customer name "QA Pure Jasa" and customer phone "0812-QA-PURE".
8. Click "💾 Simpan & Cetak Invoice Lunas".
9. `wait_for` text "Invoice" (the PDF modal title) or "WLK-" (invoice number prefix).

Pass criteria:
- Console clean (no errors via `list_console_messages` filtered to `error`).
- Invoice PDF opens (snapshot shows the modal with the service description and the invoice number).
- No "Tambahkan minimal 1 item" toast.
- No redirect to WIP list.

- [ ] **Step 5: Verify mixed-cart regression (still WIP)**

Same tab, navigate back to Catat Penjualan:

1. Add one SKU item (search for any product and click add).
2. Add one Jasa Rakit line.
3. Customer + phone.
4. Click Simpan.

Pass criteria:
- Toast "✅ Transaksi WIP tersimpan…" appears.
- Navigation to WIP list page happens.
- Amber WIP banner was visible before save.

- [ ] **Step 6: Verify empty cart still rejects**

1. Open Catat Penjualan with empty cart.
2. Click Simpan.

Pass criteria:
- Toast: "Tambahkan minimal 1 item atau jasa."

- [ ] **Step 7: Commit nothing, log the verification result inline**

No commit in this task — verification only. Note any pass/fail observations to feed into Task 6.

---

## Task 6: Update `progress.md`

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Prepend a new entry**

At the very top of `progress.md` (after the first `# ERP Antigravity — Implementation Progress` line), add a new section. Replace the values in `[brackets]` with the actual commits and bundle hash from Tasks 1–5.

```markdown
## 2026-06-10 — Pure-jasa Lunas invoice (skip WIP) — DONE

- **Problem**: Cart with only Jasa Rakit / Jasa Custom Panel (no SKU) couldn't reach "Simpan & Cetak Invoice Lunas" — validation toasted "Tambahkan minimal 1 item" and, even past that, `if (hasRakit)` forced WIP+lock-approval.
- **Change**:
  - `record_kasir_sale` RPC ([commit hash]) now skips items where `sku IS NULL` in the stock-deduction/FIFO aggregation. Service lines pass `hpp_per_unit` / `hpp_subtotal` through verbatim and still add to `v_hpp_total`. Migration `20260610000001_record_kasir_sale_service_lines.sql` applied to live Supabase.
  - `RakitInlineForm` ([commit hash]) gains an HPP (modal) input alongside Estimasi Harga.
  - `PenjualanBaruScreen` ([commit hash]) routes pure-jasa carts (`hasRakit && cart.length === 0`) through `recordSale` instead of `insertWipWithRakit`. Mixed carts (`hasRakit && cart.length > 0`) still go to WIP. WIP banner renamed and gated on `isMixedCart`; new green banner appears for pure-jasa.
  - `SalesInvoicePDF` ([commit hash]) omits the SKU subtitle when `item.sku` is null/empty.
- **Tests**: 2 new integration tests in `tests/integration/sales-recording.test.ts` pin the null-sku RPC and mixed-cart contracts. `npm run lint`: 0 errors. `vite build`: clean ([new bundle hash]).
- **Verified live**: pure-jasa Lunas invoice prints directly, mixed cart still routes to WIP list, empty cart still toasts. Cloud Run revision [revision id] on `https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/`.
- **Spec**: `docs/superpowers/specs/2026-06-10-pure-jasa-invoice-design.md`. **Plan**: `docs/superpowers/plans/2026-06-10-pure-jasa-invoice.md`.
- **Out of scope** (per spec): mixed-cart bypass, edit-HPP-later UI, component inventory tracking on pure-jasa, `LockSubmissionModal` / approval inbox changes.

---
```

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "docs(progress): pure-jasa Lunas invoice — skip WIP for pure-jasa carts"
```

---

## Self-review checklist (already done — quoted for reference)

- **Spec coverage**: Task 1 covers RPC change + tests. Task 2 covers HPP capture. Task 3 covers validation, branching, items[] union, WIP banner. Task 4 covers PDF rendering. Task 5 covers build + deploy + verify. Task 6 covers progress.md.
- **Type consistency**: `hppEstimate` is the single name used in RakitInlineForm props, PenjualanBaruScreen state, and the service-line payload. `isMixedCart` / `isPureJasa` are the single gate names. `record_kasir_sale` RPC argument list is unchanged (signature preserved); only the body changes.
- **Migration slot**: `20260610000001` — verified clear against highest existing `20260609000011`.
- **Risk surface**: the RPC's null-sku skip in the aggregation loop is the load-bearing change. Task 1 pins both the null-sku happy path AND the mixed-cart contract with integration tests against the live DB, so a regression at the RPC level is caught before any frontend work runs.
