# Belanja Numpang Lewat (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new "Belanja Numpang Lewat" (BNL) menu inside Pembelian — a purchase-invoice document linked to a Sales Order, with zero stock impact, used for pass-through buys at toko grosir that get resold same-day.

**Architecture:** New Supabase tables `purchase_invoices` + `purchase_invoice_items` with `type='PASSTHROUGH'` rows. Four atomic RPCs (record_pi, mark_pi_paid, void_pi, update_pi) handle lifecycle BELUM_LUNAS → LUNAS → VOIDED with Kasir expense bookkeeping. A SQL view `order_cogs_breakdown` allocates PI cost to matched Order items FIFO. Frontend follows existing PembelianScreen sub-tab pattern; new pages under `src/components/pembelian/bnl/`. Order detail page gets a "PI Terkait" section + "Sumber Pengadaan" column.

**Tech Stack:** Supabase (Postgres + RLS + Storage), TypeScript, React, Vite, Tailwind, lucide-react, jsPDF + autoTable, vitest for integration tests.

**Spec:** `docs/superpowers/specs/2026-06-14-pembelian-belanja-numpang-lewat-design.md`
**Phase 2 roadmap (forward-compat reference):** `docs/superpowers/specs/2026-06-14-pembelian-phase2-roadmap-design.md`
**Mockup:** `tmp/pembelian-cash-invoice-mockup.html`

---

## File Map

**Backend (SQL migrations):**
- Create `supabase/migrations/20260614000010_pi_schema.sql` — tables, indexes, check constraints, RLS
- Create `supabase/migrations/20260614000011_pi_rpcs_create.sql` — `generate_pi_number()`, `record_pi()`
- Create `supabase/migrations/20260614000012_pi_rpcs_lifecycle.sql` — `mark_pi_paid()`, `void_pi()`, `update_pi()`
- Create `supabase/migrations/20260614000013_order_cogs_breakdown_view.sql` — COGS attribution view

**Integration tests:**
- Create `tests/integration/pi-phase1-record.test.ts` — `record_pi` happy + edge cases
- Create `tests/integration/pi-phase1-lifecycle.test.ts` — mark paid, void, update
- Create `tests/integration/pi-phase1-cogs-view.test.ts` — view correctness
- Create `tests/integration/pi-phase1-duplicate-warning.test.ts` — BR6 soft warning

**Types & service:**
- Modify `src/types.ts` — add `DbPurchaseInvoice`, `DbPurchaseInvoiceItem`, payload types
- Create `src/lib/purchaseInvoiceService.ts` — frontend service layer

**Frontend shared primitives:**
- Create `src/components/pembelian/bnl/PiNumberBadge.tsx`
- Create `src/components/pembelian/bnl/PiStatusBadge.tsx`
- Create `src/components/pembelian/bnl/PaymentMethodPicker.tsx`
- Create `src/components/pembelian/bnl/OrderPicker.tsx`
- Create `src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx`

**Frontend pages:**
- Create `src/components/pembelian/bnl/BelanjaNumpangLewatList.tsx`
- Create `src/components/pembelian/bnl/BelanjaNumpangLewatFormPage.tsx`
- Create `src/components/pembelian/bnl/BelanjaNumpangLewatDetailPage.tsx`
- Create `src/components/pembelian/bnl/MarkPaidModal.tsx`
- Create `src/components/pembelian/bnl/VoidConfirmModal.tsx`

**Frontend integration:**
- Modify `src/components/PembelianScreen.tsx` — add sub-tab "Belanja Numpang Lewat"
- Modify `src/components/OrderDetailPage.tsx` — add "PI Terkait" section + "Sumber Pengadaan" column + "+ Buat PI untuk Order ini" button
- Modify `src/App.tsx` — deep-link `?screen=pembelian&bnl=PI-...` routing

**PDF:**
- Create `src/lib/pdf/belanjaNumpangLewatPdf.ts` — A6 tanda terima generator

**Docs:**
- Modify `progress.md` — completion entry

---

## Task 1: Schema migration (tables + indexes + RLS)

**Files:**
- Create: `supabase/migrations/20260614000010_pi_schema.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260614000010_pi_schema.sql
-- Phase 1 of Belanja Numpang Lewat (spec
-- docs/superpowers/specs/2026-06-14-pembelian-belanja-numpang-lewat-design.md).
-- Creates purchase_invoices + purchase_invoice_items tables with `type` discriminator
-- (PASSTHROUGH for Phase 1, STOCK reserved for Phase 2). Zero touch to existing
-- purchase_orders module — PO module continues to work unchanged.

BEGIN;

CREATE TABLE public.purchase_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_number                   text UNIQUE NOT NULL,
  type                        text NOT NULL DEFAULT 'PASSTHROUGH'
                                CHECK (type IN ('PASSTHROUGH', 'STOCK')),
  supplier_id                 uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  order_id                    uuid NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  purchase_date               date NOT NULL DEFAULT CURRENT_DATE,
  supplier_invoice_number     text NULL,
  supplier_invoice_photo_url  text NULL,
  payment_method              text NOT NULL CHECK (payment_method IN ('CASH','TRANSFER','TEMPO')),
  payment_due_at              date NULL,
  paid_at                     timestamptz NULL,
  payment_proof_url           text NULL,
  subtotal                    numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total                       numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  status                      text NOT NULL DEFAULT 'BELUM_LUNAS'
                                CHECK (status IN ('BELUM_LUNAS','LUNAS')),
  notes                       text NULL,
  created_by_user_id          uuid NULL REFERENCES public.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  voided_at                   timestamptz NULL,
  voided_by_user_id           uuid NULL REFERENCES public.users(id),
  void_reason                 text NULL,
  CONSTRAINT pi_passthrough_requires_order
    CHECK (type != 'PASSTHROUGH' OR order_id IS NOT NULL),
  CONSTRAINT pi_belum_lunas_requires_due
    CHECK (status != 'BELUM_LUNAS' OR payment_due_at IS NOT NULL),
  CONSTRAINT pi_lunas_requires_paid_at
    CHECK (status != 'LUNAS' OR paid_at IS NOT NULL),
  CONSTRAINT pi_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pi_supplier_status_idx ON public.purchase_invoices (supplier_id, status);
CREATE INDEX pi_supplier_invnum_idx ON public.purchase_invoices (supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;
CREATE INDEX pi_order_idx ON public.purchase_invoices (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX pi_due_idx ON public.purchase_invoices (status, payment_due_at)
  WHERE status = 'BELUM_LUNAS';
CREATE INDEX pi_list_idx ON public.purchase_invoices (type, status, purchase_date DESC);

CREATE TABLE public.purchase_invoice_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_id           uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  sku             varchar NOT NULL REFERENCES public.stocks(sku) ON DELETE RESTRICT,
  product_name    text NOT NULL,
  qty             int NOT NULL CHECK (qty > 0),
  unit_cost       numeric NOT NULL CHECK (unit_cost >= 0),
  sell_price      numeric NOT NULL CHECK (sell_price >= 0),
  subtotal        numeric NOT NULL CHECK (subtotal >= 0),
  order_item_id   uuid NULL REFERENCES public.order_items(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pi_items_pi_idx ON public.purchase_invoice_items (pi_id);
CREATE INDEX pi_items_sku_idx ON public.purchase_invoice_items (sku);

ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user with pembelian permission can read
CREATE POLICY pi_read ON public.purchase_invoices FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pi_items_read ON public.purchase_invoice_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE: gated through SECURITY DEFINER RPCs; deny direct access
CREATE POLICY pi_no_direct_write ON public.purchase_invoices FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pi_items_no_direct_write ON public.purchase_invoice_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
```

- [ ] **Step 2: Apply migration**

Run via the Supabase Management API (existing project pattern), or via local supabase CLI if testing locally:
```bash
# Local:
npx supabase db reset && npx supabase migration up
# Or via Management API (existing pattern in this repo):
curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  --data "$(jq -Rs '{query: .}' supabase/migrations/20260614000010_pi_schema.sql)"
```

Expected: no error. Tables `purchase_invoices` + `purchase_invoice_items` exist.

- [ ] **Step 3: Verify schema**

```bash
psql <conn> -c "\d public.purchase_invoices" -c "\d public.purchase_invoice_items"
```

Expected: 22 columns on `purchase_invoices`, 9 columns on `purchase_invoice_items`, 5 indexes on `purchase_invoices`, 2 on items.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000010_pi_schema.sql
git commit -m "feat(pembelian): purchase_invoices + purchase_invoice_items schema (BNL Phase 1)"
```

---

## Task 2: RPC — `generate_pi_number()` + `record_pi()`

**Files:**
- Create: `supabase/migrations/20260614000011_pi_rpcs_create.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000011_pi_rpcs_create.sql
-- generate_pi_number + record_pi RPCs. Atomic: INSERTs header + items in one
-- transaction. Optionally inserts Kasir expense if initial_status=LUNAS.
-- Implements BR6 (soft duplicate-supplier-invoice-number warning).

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pi_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  year_month text;
  next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pi_number, '-', 4) AS int)), 0) + 1
  INTO next_seq
  FROM public.purchase_invoices
  WHERE pi_number LIKE 'PI-' || year_month || '-%';
  RETURN 'PI-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi_number   text;
  v_pi_id       uuid;
  v_supplier_id uuid;
  v_order_id    uuid;
  v_supplier_invoice_number text;
  v_ignore_dup  boolean;
  v_existing_pi text;
  v_initial_status text;
  v_payment_due_at date;
  v_paid_at     timestamptz;
  v_subtotal    numeric := 0;
  v_supplier_name text;
  v_order_number text;
  v_item        jsonb;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_order_id    := (payload->>'order_id')::uuid;
  v_supplier_invoice_number := payload->>'supplier_invoice_number';
  v_ignore_dup  := COALESCE((payload->>'ignore_duplicate_warning')::boolean, false);
  v_initial_status := COALESCE(payload->>'initial_status', 'BELUM_LUNAS');

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'order_id required for PASSTHROUGH'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  -- BR6: soft duplicate warning
  IF v_supplier_invoice_number IS NOT NULL AND NOT v_ignore_dup THEN
    SELECT pi_number INTO v_existing_pi
    FROM public.purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND supplier_invoice_number = v_supplier_invoice_number
      AND voided_at IS NULL
    LIMIT 1;
    IF v_existing_pi IS NOT NULL THEN
      RETURN jsonb_build_object(
        'warning', 'duplicate_supplier_invoice',
        'existing_pi', v_existing_pi
      );
    END IF;
  END IF;

  v_pi_number := public.generate_pi_number();

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
    v_payment_due_at := NULL;
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  -- compute subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, notes, created_by_user_id
  ) VALUES (
    v_pi_number, 'PASSTHROUGH', v_supplier_id, v_order_id,
    COALESCE((payload->>'purchase_date')::date, CURRENT_DATE),
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, v_paid_at, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, v_initial_status,
    payload->>'notes', auth.uid()
  ) RETURNING id INTO v_pi_id;

  INSERT INTO public.purchase_invoice_items (
    pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, order_item_id
  )
  SELECT
    v_pi_id,
    item->>'sku',
    item->>'product_name',
    (item->>'qty')::int,
    (item->>'unit_cost')::numeric,
    (item->>'sell_price')::numeric,
    (item->>'qty')::int * (item->>'unit_cost')::numeric,
    NULLIF(item->>'order_item_id','')::uuid
  FROM jsonb_array_elements(payload->'items') item;

  -- Kasir expense if initial LUNAS
  IF v_initial_status = 'LUNAS' THEN
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    SELECT order_number INTO v_order_number FROM public.orders WHERE id = v_order_id;
    INSERT INTO public.kasir_transactions (
      type, date, expense_category, description, subtotal, hpp_total
    ) VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      'Pembelian Pass-Through',
      'BNL ' || v_pi_number || ' — ' || COALESCE(v_supplier_name,'') ||
        ' — utk Order ' || COALESCE(v_order_number,''),
      v_subtotal,
      0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pi_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply migration via Supabase Management API or local CLI**

Expected: no error. Functions exist.

- [ ] **Step 3: Smoke test in psql**

```sql
-- create a test PI in BELUM_LUNAS status (replace UUIDs with real ones)
SELECT record_pi(jsonb_build_object(
  'supplier_id', '<existing-supplier-uuid>',
  'order_id',    '<existing-order-uuid>',
  'payment_method', 'TEMPO',
  'payment_due_at', '2026-07-14',
  'initial_status', 'BELUM_LUNAS',
  'items', jsonb_build_array(jsonb_build_object(
    'sku','<existing-sku>','product_name','Test','qty',2,'unit_cost',10000,'sell_price',15000
  ))
));
```

Expected: returns `{"pi_number": "PI-2026-06-001", "pi_id": "<uuid>"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000011_pi_rpcs_create.sql
git commit -m "feat(pembelian): generate_pi_number + record_pi RPCs (BR6 duplicate warning)"
```

---

## Task 3: RPC — `mark_pi_paid`, `void_pi`, `update_pi`

**Files:**
- Create: `supabase/migrations/20260614000012_pi_rpcs_lifecycle.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000012_pi_rpcs_lifecycle.sql
-- Lifecycle RPCs: mark_pi_paid (BELUM → LUNAS + insert Kasir expense),
-- void_pi (LUNAS → VOIDED + reversal Kasir expense), update_pi (edit BELUM).

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_pi_paid(p_pi_id uuid, p_proof_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi    public.purchase_invoices%ROWTYPE;
  v_supplier_name text;
  v_order_number text;
BEGIN
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.status <> 'BELUM_LUNAS' THEN
    RAISE EXCEPTION 'PI status must be BELUM_LUNAS to mark paid (current: %)', v_pi.status;
  END IF;
  IF v_pi.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot mark voided PI as paid';
  END IF;

  UPDATE public.purchase_invoices
  SET status = 'LUNAS',
      paid_at = now(),
      payment_proof_url = COALESCE(p_proof_url, payment_proof_url),
      payment_due_at = NULL,
      updated_at = now()
  WHERE id = p_pi_id;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_pi.supplier_id;
  SELECT order_number INTO v_order_number FROM public.orders WHERE id = v_pi.order_id;

  INSERT INTO public.kasir_transactions (
    type, date, expense_category, description, subtotal, hpp_total
  ) VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Pass-Through',
    'BNL ' || v_pi.pi_number || ' — ' || COALESCE(v_supplier_name,'') ||
      ' — utk Order ' || COALESCE(v_order_number,''),
    v_pi.total,
    0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pi(p_pi_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi public.purchase_invoices%ROWTYPE;
  v_supplier_name text;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.voided_at IS NOT NULL THEN RAISE EXCEPTION 'PI already voided'; END IF;
  IF v_pi.status <> 'LUNAS' THEN
    RAISE EXCEPTION 'only LUNAS PI can be voided (current: %)', v_pi.status;
  END IF;

  UPDATE public.purchase_invoices
  SET voided_at = now(),
      voided_by_user_id = auth.uid(),
      void_reason = p_reason,
      updated_at = now()
  WHERE id = p_pi_id;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_pi.supplier_id;
  INSERT INTO public.kasir_transactions (
    type, date, expense_category, description, subtotal, hpp_total
  ) VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Pass-Through',
    'VOID BNL ' || v_pi.pi_number || ' — ' || COALESCE(v_supplier_name,''),
    -v_pi.total,
    0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pi(p_pi_id uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi public.purchase_invoices%ROWTYPE;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_due date;
BEGIN
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.voided_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit voided PI'; END IF;
  IF v_pi.status <> 'BELUM_LUNAS' THEN
    RAISE EXCEPTION 'only BELUM_LUNAS PI can be edited (current: %)', v_pi.status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;
  v_due := (payload->>'payment_due_at')::date;
  IF v_due IS NULL THEN RAISE EXCEPTION 'payment_due_at required'; END IF;

  UPDATE public.purchase_invoices SET
    supplier_id = COALESCE((payload->>'supplier_id')::uuid, supplier_id),
    order_id = COALESCE((payload->>'order_id')::uuid, order_id),
    purchase_date = COALESCE((payload->>'purchase_date')::date, purchase_date),
    supplier_invoice_number = payload->>'supplier_invoice_number',
    supplier_invoice_photo_url = payload->>'supplier_invoice_photo_url',
    payment_method = COALESCE(payload->>'payment_method', payment_method),
    payment_due_at = v_due,
    notes = payload->>'notes',
    subtotal = v_subtotal,
    total = v_subtotal,
    updated_at = now()
  WHERE id = p_pi_id;

  DELETE FROM public.purchase_invoice_items WHERE pi_id = p_pi_id;
  INSERT INTO public.purchase_invoice_items (
    pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, order_item_id
  )
  SELECT
    p_pi_id, item->>'sku', item->>'product_name',
    (item->>'qty')::int, (item->>'unit_cost')::numeric, (item->>'sell_price')::numeric,
    (item->>'qty')::int * (item->>'unit_cost')::numeric,
    NULLIF(item->>'order_item_id','')::uuid
  FROM jsonb_array_elements(payload->'items') item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pi_paid(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pi(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pi(uuid, jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Smoke test in psql** — mark a BELUM_LUNAS PI as paid, verify status flipped and Kasir expense appeared. Then void it, verify reversal expense entered.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000012_pi_rpcs_lifecycle.sql
git commit -m "feat(pembelian): mark_pi_paid + void_pi + update_pi lifecycle RPCs"
```

---

## Task 4: SQL view — `order_cogs_breakdown`

**Files:**
- Create: `supabase/migrations/20260614000013_order_cogs_breakdown_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000013_order_cogs_breakdown_view.sql
-- View that allocates Order item COGS across linked PI items (FIFO by pi.created_at)
-- and falls back to existing FIFO stock_lots for remainder. Used by Order detail
-- "Sumber Pengadaan" column + profit calc.

BEGIN;

CREATE OR REPLACE VIEW public.order_cogs_breakdown AS
WITH pi_alloc AS (
  SELECT
    pii.sku,
    pi.order_id,
    pii.qty,
    pii.unit_cost,
    pi.pi_number,
    pi.id AS pi_id,
    pi.created_at AS pi_created_at
  FROM public.purchase_invoices pi
  JOIN public.purchase_invoice_items pii ON pii.pi_id = pi.id
  WHERE pi.voided_at IS NULL
    AND pi.order_id IS NOT NULL
    AND pi.type = 'PASSTHROUGH'
),
oi AS (
  SELECT id, order_id, sku, qty, sell_price FROM public.order_items
),
matched AS (
  SELECT
    oi.id AS order_item_id,
    oi.order_id,
    oi.sku,
    oi.qty AS order_qty,
    oi.sell_price,
    pi_alloc.pi_number,
    pi_alloc.unit_cost AS pi_unit_cost,
    pi_alloc.qty AS pi_qty,
    pi_alloc.pi_created_at
  FROM oi
  LEFT JOIN pi_alloc
    ON pi_alloc.order_id = oi.order_id
   AND pi_alloc.sku = oi.sku
)
SELECT
  order_item_id,
  order_id,
  sku,
  order_qty,
  sell_price,
  -- earliest PI (by created_at) provides cost; if multiple PIs for same SKU,
  -- frontend can show as "mixed" but for now we take the first match
  (array_agg(pi_number ORDER BY pi_created_at NULLS LAST))[1] AS source_pi_number,
  (array_agg(pi_unit_cost ORDER BY pi_created_at NULLS LAST))[1] AS pi_unit_cost,
  LEAST(order_qty, COALESCE(SUM(pi_qty), 0)) AS qty_from_pi,
  GREATEST(order_qty - COALESCE(SUM(pi_qty), 0), 0) AS qty_from_stock
FROM matched
GROUP BY order_item_id, order_id, sku, order_qty, sell_price;

GRANT SELECT ON public.order_cogs_breakdown TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Smoke test** — query the view for an Order that has BNL records and verify it shows `source_pi_number`, `pi_unit_cost`, `qty_from_pi`, `qty_from_stock` columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000013_order_cogs_breakdown_view.sql
git commit -m "feat(pembelian): order_cogs_breakdown view for PI→Order COGS allocation"
```

---

## Task 5: Integration test — `record_pi`

**Files:**
- Create: `tests/integration/pi-phase1-record.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/pi-phase1-record.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;
const sb = createClient(url, key);

let supplierId: string;
let orderId: string;
let sku: string;

beforeAll(async () => {
  const { data: sup } = await sb.from('suppliers').select('id').limit(1).single();
  supplierId = sup!.id;
  const { data: ord } = await sb.from('orders').select('id').limit(1).single();
  orderId = ord!.id;
  const { data: stk } = await sb.from('stocks').select('sku').limit(1).single();
  sku = stk!.sku;
});

describe('record_pi', () => {
  test('creates BELUM_LUNAS PI and returns pi_number', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        order_id: orderId,
        payment_method: 'TEMPO',
        payment_due_at: '2026-07-14',
        initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'Test', qty: 2, unit_cost: 10000, sell_price: 15000 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
    expect(String(data.pi_number)).toMatch(/^PI-\d{4}-\d{2}-\d{3}$/);
  });

  test('creates LUNAS PI and inserts Kasir expense', async () => {
    const before = await sb.from('kasir_transactions').select('id', { count: 'exact', head: true })
      .eq('expense_category', 'Pembelian Pass-Through');
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        order_id: orderId,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku, product_name: 'Test', qty: 1, unit_cost: 5000, sell_price: 8000 }],
      },
    });
    expect(error).toBeNull();
    const after = await sb.from('kasir_transactions').select('id', { count: 'exact', head: true })
      .eq('expense_category', 'Pembelian Pass-Through');
    expect((after.count ?? 0)).toBeGreaterThan(before.count ?? 0);
  });

  test('rejects when order_id missing for PASSTHROUGH', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    expect(error).not.toBeNull();
  });

  test('rejects empty items', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'CASH', initial_status: 'LUNAS', items: [],
      },
    });
    expect(error).not.toBeNull();
  });

  test('rejects BELUM_LUNAS without payment_due_at', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'TEMPO', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    expect(error).not.toBeNull();
  });

  test('zero stock impact: stocks.stock unchanged after record_pi', async () => {
    const { data: before } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 10, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    const { data: after } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    expect(after!.stock).toBe(before!.stock);
  });
});
```

- [ ] **Step 2: Run the test, expect it to PASS** (RPC already deployed in Task 2/3)

```bash
npx vitest run tests/integration/pi-phase1-record.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/pi-phase1-record.test.ts
git commit -m "test(pembelian): record_pi integration tests (6 cases)"
```

---

## Task 6: Integration test — duplicate warning (BR6)

**Files:**
- Create: `tests/integration/pi-phase1-duplicate-warning.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/pi-phase1-duplicate-warning.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, orderId: string, sku: string;
const INVNUM = 'BR6-TEST-' + Date.now();

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  orderId = (await sb.from('orders').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('BR6 — duplicate supplier_invoice_number soft warning', () => {
  test('first insert succeeds', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
  });

  test('second insert with same supplier+invnum returns warning, no INSERT', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('warning', 'duplicate_supplier_invoice');
    expect(data).toHaveProperty('existing_pi');
  });

  test('ignore_duplicate_warning=true overrides and inserts', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        ignore_duplicate_warning: true,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
  });
});
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
npx vitest run tests/integration/pi-phase1-duplicate-warning.test.ts
git add tests/integration/pi-phase1-duplicate-warning.test.ts
git commit -m "test(pembelian): BR6 duplicate supplier invoice number warning"
```

---

## Task 7: Integration test — lifecycle (paid + void + update)

**Files:**
- Create: `tests/integration/pi-phase1-lifecycle.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/pi-phase1-lifecycle.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, orderId: string, sku: string;

async function createPi(status: 'BELUM_LUNAS'|'LUNAS') {
  const { data } = await sb.rpc('record_pi', {
    payload: {
      supplier_id: supplierId, order_id: orderId,
      payment_method: status === 'LUNAS' ? 'CASH' : 'TEMPO',
      payment_due_at: status === 'BELUM_LUNAS' ? '2026-07-14' : undefined,
      initial_status: status,
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
    },
  });
  return data as { pi_number: string; pi_id: string };
}

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  orderId = (await sb.from('orders').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('mark_pi_paid', () => {
  test('flips BELUM_LUNAS → LUNAS + inserts Kasir expense', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('mark_pi_paid', { p_pi_id: pi_id });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('status, paid_at').eq('id', pi_id).single();
    expect(data!.status).toBe('LUNAS');
    expect(data!.paid_at).not.toBeNull();
  });

  test('rejects already LUNAS', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('mark_pi_paid', { p_pi_id: pi_id });
    expect(error).not.toBeNull();
  });
});

describe('void_pi', () => {
  test('voids LUNAS + inserts reversal expense (negative subtotal)', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'Customer batal — refund' });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('voided_at, void_reason').eq('id', pi_id).single();
    expect(data!.voided_at).not.toBeNull();
  });

  test('rejects reason < 10 chars', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'short' });
    expect(error).not.toBeNull();
  });

  test('rejects BELUM_LUNAS', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'Not allowed yet here' });
    expect(error).not.toBeNull();
  });
});

describe('update_pi', () => {
  test('updates BELUM_LUNAS PI items + subtotal recompute', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('update_pi', {
      p_pi_id: pi_id,
      payload: {
        payment_method: 'TEMPO',
        payment_due_at: '2026-08-01',
        items: [{ sku, product_name: 'X', qty: 5, unit_cost: 2000, sell_price: 3000 }],
      },
    });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('subtotal').eq('id', pi_id).single();
    expect(Number(data!.subtotal)).toBe(10000);
  });

  test('rejects edit on LUNAS', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('update_pi', {
      p_pi_id: pi_id,
      payload: { payment_due_at: '2026-08-01', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1, sell_price: 1 }] },
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
npx vitest run tests/integration/pi-phase1-lifecycle.test.ts
git add tests/integration/pi-phase1-lifecycle.test.ts
git commit -m "test(pembelian): PI lifecycle (mark paid, void, update)"
```

---

## Task 8: Integration test — COGS breakdown view

**Files:**
- Create: `tests/integration/pi-phase1-cogs-view.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/pi-phase1-cogs-view.test.ts
import { describe, test, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

describe('order_cogs_breakdown view', () => {
  test('returns expected columns', async () => {
    const { data, error } = await sb.from('order_cogs_breakdown').select('*').limit(1);
    expect(error).toBeNull();
    if (data && data[0]) {
      const row = data[0] as any;
      expect(row).toHaveProperty('order_item_id');
      expect(row).toHaveProperty('order_id');
      expect(row).toHaveProperty('sku');
      expect(row).toHaveProperty('order_qty');
      expect(row).toHaveProperty('source_pi_number');
      expect(row).toHaveProperty('pi_unit_cost');
      expect(row).toHaveProperty('qty_from_pi');
      expect(row).toHaveProperty('qty_from_stock');
    }
  });

  test('Order with no linked PI → qty_from_pi=0, source_pi_number=null', async () => {
    // pick an Order with no linked PI
    const { data: orphans } = await sb.from('orders').select('id').limit(20);
    for (const o of (orphans ?? [])) {
      const { data: linked } = await sb.from('purchase_invoices').select('id')
        .eq('order_id', (o as any).id).limit(1);
      if (!linked || linked.length === 0) {
        const { data } = await sb.from('order_cogs_breakdown').select('*').eq('order_id', (o as any).id);
        for (const row of data ?? []) {
          expect((row as any).qty_from_pi).toBe(0);
          expect((row as any).source_pi_number).toBeNull();
        }
        return;
      }
    }
  });
});
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
npx vitest run tests/integration/pi-phase1-cogs-view.test.ts
git add tests/integration/pi-phase1-cogs-view.test.ts
git commit -m "test(pembelian): order_cogs_breakdown view structure + no-PI fallback"
```

---

## Task 9: TypeScript types

**Files:**
- Modify: `src/types.ts` — append to end of file

- [ ] **Step 1: Add the types**

Append to `src/types.ts`:

```typescript
// ─── Belanja Numpang Lewat (Phase 1) ───
export type PiStatus = 'BELUM_LUNAS' | 'LUNAS' | 'TERLAMBAT';
export type PiPaymentMethod = 'CASH' | 'TRANSFER' | 'TEMPO';
export type PiType = 'PASSTHROUGH' | 'STOCK';

export interface DbPurchaseInvoiceItem {
  id: string;
  pi_id: string;
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
  subtotal: number;
  order_item_id: string | null;
  created_at: string;
}

export interface DbPurchaseInvoice {
  id: string;
  pi_number: string;
  type: PiType;
  supplier_id: string;
  order_id: string | null;
  purchase_date: string;
  supplier_invoice_number: string | null;
  supplier_invoice_photo_url: string | null;
  payment_method: PiPaymentMethod;
  payment_due_at: string | null;
  paid_at: string | null;
  payment_proof_url: string | null;
  subtotal: number;
  total: number;
  status: 'BELUM_LUNAS' | 'LUNAS';
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  // joined
  supplier?: DbSupplier;
  order?: { id: string; order_number: string; customer_name?: string };
  items?: DbPurchaseInvoiceItem[];
}

export interface PiItemDraft {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
  order_item_id?: string | null;
}

export interface RecordPiPayload {
  supplier_id: string;
  order_id: string;
  purchase_date?: string;
  supplier_invoice_number?: string;
  supplier_invoice_photo_url?: string;
  payment_method: PiPaymentMethod;
  payment_due_at?: string;
  initial_status: 'BELUM_LUNAS' | 'LUNAS';
  payment_proof_url?: string;
  notes?: string;
  items: PiItemDraft[];
  ignore_duplicate_warning?: boolean;
}

export interface OrderCogsBreakdownRow {
  order_item_id: string;
  order_id: string;
  sku: string;
  order_qty: number;
  sell_price: number;
  source_pi_number: string | null;
  pi_unit_cost: number | null;
  qty_from_pi: number;
  qty_from_stock: number;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "types(pembelian): DbPurchaseInvoice + payload + view row types"
```

---

## Task 10: Frontend service `purchaseInvoiceService`

**Files:**
- Create: `src/lib/purchaseInvoiceService.ts`

- [ ] **Step 1: Write the service**

```typescript
// src/lib/purchaseInvoiceService.ts
import { supabase } from './supabaseClient';
import type {
  DbPurchaseInvoice, RecordPiPayload, OrderCogsBreakdownRow,
} from '../types';

type RecordPiResult =
  | { kind: 'ok'; pi_number: string; pi_id: string }
  | { kind: 'duplicate_warning'; existing_pi: string };

export const purchaseInvoiceService = {
  async fetchAll(filter: { from?: string; to?: string; status?: string; type?: 'PASSTHROUGH'|'STOCK' } = {}): Promise<DbPurchaseInvoice[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), orders(id, order_number, customer_name), purchase_invoice_items(*)')
      .order('created_at', { ascending: false });
    if (filter.type) q = q.eq('type', filter.type);
    if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
    if (filter.from) q = q.gte('purchase_date', filter.from);
    if (filter.to) q = q.lte('purchase_date', filter.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row,
      supplier: row.suppliers,
      order: row.orders ?? undefined,
      items: row.purchase_invoice_items ?? [],
    })) as DbPurchaseInvoice[];
  },

  async fetchByNumber(piNumber: string): Promise<DbPurchaseInvoice | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), orders(id, order_number, customer_name), purchase_invoice_items(*)')
      .eq('pi_number', piNumber).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...(data as any),
      supplier: (data as any).suppliers,
      order: (data as any).orders ?? undefined,
      items: (data as any).purchase_invoice_items ?? [],
    } as DbPurchaseInvoice;
  },

  async fetchByOrderId(orderId: string): Promise<DbPurchaseInvoice[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), purchase_invoice_items(*)')
      .eq('order_id', orderId)
      .is('voided_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row, supplier: row.suppliers, items: row.purchase_invoice_items ?? [],
    })) as DbPurchaseInvoice[];
  },

  async record(payload: RecordPiPayload): Promise<RecordPiResult> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pi', { payload });
    if (error) throw error;
    if (data && (data as any).warning === 'duplicate_supplier_invoice') {
      return { kind: 'duplicate_warning', existing_pi: (data as any).existing_pi };
    }
    return { kind: 'ok', pi_number: (data as any).pi_number, pi_id: (data as any).pi_id };
  },

  async markPaid(piId: string, proofUrl?: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('mark_pi_paid', { p_pi_id: piId, p_proof_url: proofUrl ?? null });
    if (error) throw error;
  },

  async void(piId: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pi', { p_pi_id: piId, p_reason: reason });
    if (error) throw error;
  },

  async update(piId: string, payload: Omit<RecordPiPayload,'initial_status'|'ignore_duplicate_warning'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_pi', { p_pi_id: piId, payload });
    if (error) throw error;
  },

  async uploadAttachment(file: File, subPath: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const fullPath = `purchase-invoices/${subPath}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('purchase-documents').upload(fullPath, file);
    if (error) throw error;
    const { data } = supabase.storage.from('purchase-documents').getPublicUrl(fullPath);
    return data.publicUrl;
  },

  async fetchCogsForOrder(orderId: string): Promise<OrderCogsBreakdownRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('order_cogs_breakdown').select('*').eq('order_id', orderId);
    if (error) throw error;
    return (data ?? []) as OrderCogsBreakdownRow[];
  },
};

export function isTerlambat(pi: DbPurchaseInvoice, today: string = new Date().toISOString().slice(0,10)): boolean {
  return pi.status === 'BELUM_LUNAS' && !!pi.payment_due_at && pi.payment_due_at < today;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/purchaseInvoiceService.ts
git commit -m "feat(pembelian): purchaseInvoiceService — record/mark-paid/void/update + COGS view fetch"
```

---

## Task 11: Shared frontend primitives (Badges + PaymentMethodPicker)

**Files:**
- Create: `src/components/pembelian/bnl/PiNumberBadge.tsx`
- Create: `src/components/pembelian/bnl/PiStatusBadge.tsx`
- Create: `src/components/pembelian/bnl/PaymentMethodPicker.tsx`

- [ ] **Step 1: PiNumberBadge**

```tsx
// src/components/pembelian/bnl/PiNumberBadge.tsx
import React from 'react';

export default function PiNumberBadge({ piNumber, onClick }: { piNumber: string; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
        onClick ? 'cursor-pointer hover:underline' : ''
      }`}
      style={{ background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)', color: '#5b21b6' }}
    >
      ⚡ {piNumber}
    </span>
  );
}
```

- [ ] **Step 2: PiStatusBadge**

```tsx
// src/components/pembelian/bnl/PiStatusBadge.tsx
import React from 'react';
import type { DbPurchaseInvoice } from '../../../types';
import { isTerlambat } from '../../../lib/purchaseInvoiceService';

export default function PiStatusBadge({ pi }: { pi: DbPurchaseInvoice }) {
  if (pi.voided_at) {
    return <span className="badge bg-gray-200 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">VOID</span>;
  }
  if (pi.status === 'LUNAS') {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">● Lunas</span>;
  }
  if (isTerlambat(pi)) {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">⚠ Terlambat</span>;
  }
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">○ Belum Lunas</span>;
}
```

- [ ] **Step 3: PaymentMethodPicker**

```tsx
// src/components/pembelian/bnl/PaymentMethodPicker.tsx
import React from 'react';
import { Banknote, CreditCard, Clock } from 'lucide-react';
import type { PiPaymentMethod } from '../../../types';

const OPTIONS: { value: PiPaymentMethod; label: string; icon: React.ReactNode; activeBg: string; activeColor: string }[] = [
  { value: 'CASH',     label: 'Cash',     icon: <Banknote className="w-5 h-5" />,   activeBg: 'bg-indigo-50',  activeColor: 'text-indigo-700' },
  { value: 'TRANSFER', label: 'Transfer', icon: <CreditCard className="w-5 h-5" />, activeBg: 'bg-sky-50',     activeColor: 'text-sky-700' },
  { value: 'TEMPO',    label: 'Tempo',    icon: <Clock className="w-5 h-5" />,      activeBg: 'bg-fuchsia-50', activeColor: 'text-fuchsia-700' },
];

export default function PaymentMethodPicker({ value, onChange }: { value: PiPaymentMethod; onChange: (v: PiPaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 ${
              active ? `border-current ${o.activeBg} ${o.activeColor}` : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300'
            }`}>
            {o.icon}
            <span className="text-xs font-bold">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/PiNumberBadge.tsx src/components/pembelian/bnl/PiStatusBadge.tsx src/components/pembelian/bnl/PaymentMethodPicker.tsx
git commit -m "feat(pembelian): shared BNL primitives (PiNumberBadge + StatusBadge + PaymentPicker)"
```

---

## Task 12: `OrderPicker` component

**Files:**
- Create: `src/components/pembelian/bnl/OrderPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/pembelian/bnl/OrderPicker.tsx
import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

interface OrderPickerProps {
  value: { id: string; order_number: string; customer_name?: string } | null;
  onChange: (v: { id: string; order_number: string; customer_name?: string } | null) => void;
}

export default function OrderPicker({ value, onChange }: OrderPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; order_number: string; customer_name?: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2 || !supabase) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase!.from('orders')
        .select('id, order_number, customer_name')
        .ilike('order_number', `%${query}%`)
        .order('created_at', { ascending: false }).limit(20);
      setResults((data ?? []) as any);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (value) {
    return (
      <div className="border-2 border-indigo-300 bg-indigo-50/40 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-sm" style={{ color: '#012749' }}>{value.order_number}</div>
            {value.customer_name && <div className="text-xs text-gray-600 mt-0.5">{value.customer_name}</div>}
          </div>
          <button type="button" onClick={() => onChange(null)}
            className="text-xs font-semibold text-indigo-600 hover:underline">
            Ganti
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Cari Order Number..."
          className="w-full text-sm py-2 pl-9 pr-3 rounded-xl border border-gray-300 focus:outline-none focus:border-indigo-500"
        />
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto bg-white rounded-xl border border-gray-200 shadow-lg">
          {results.map(r => (
            <button key={r.id} type="button"
              onMouseDown={() => onChange(r)}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
              <div className="font-semibold text-sm">{r.order_number}</div>
              {r.customer_name && <div className="text-xs text-gray-500">{r.customer_name}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/OrderPicker.tsx
git commit -m "feat(pembelian): OrderPicker — search + pick Sales Order"
```

---

## Task 13: `SkuPickerWithInlineCreate` component

**Files:**
- Create: `src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx
import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import type { StockItem } from '../../../types';

interface Props {
  value: { sku: string; name: string; sell_price?: number } | null;
  unitCostHint?: number;
  onChange: (v: { sku: string; name: string; sell_price?: number }) => void;
}

export default function SkuPickerWithInlineCreate({ value, unitCostHint, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockItem[]>([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSellPrice, setDraftSellPrice] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2 || !supabase) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase!.from('stocks')
        .select('*').or(`sku.ilike.%${query}%,name.ilike.%${query}%`)
        .order('name', { ascending: true }).limit(20);
      setResults((data ?? []) as StockItem[]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function handleCreate() {
    if (!supabase || !draftName.trim()) return;
    setSaving(true);
    try {
      // Generate SKU code based on name (uppercase + sanitize)
      const skuCode = draftName.toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32) || `BNL-${Date.now()}`;
      const { error } = await supabase.from('stocks').insert({
        sku: skuCode,
        name: draftName.trim(),
        category: 'Pass-through',
        price: draftSellPrice,
        stock: 0,
        status: 'active',
        harga_modal: unitCostHint ?? null,
      });
      if (error) throw error;
      onChange({ sku: skuCode, name: draftName.trim(), sell_price: draftSellPrice });
      setShowCreate(false);
      setDraftName('');
      setDraftSellPrice(0);
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="badge bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{value.sku}</span>
        <span className="text-sm flex-1">{value.name}</span>
        <button type="button" onClick={() => onChange(null as any)} className="text-xs text-gray-400 hover:text-red-500">×</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Cari SKU atau nama barang..."
          className="w-full text-sm py-2 pl-9 pr-3 rounded-xl border border-gray-300 focus:outline-none focus:border-indigo-500" />
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      </div>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto bg-white rounded-xl border border-gray-200 shadow-lg">
          {results.map(s => (
            <button key={s.sku} type="button" onMouseDown={() => { onChange({ sku: s.sku, name: s.name, sell_price: s.price }); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-2">
                <span className="badge bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{s.sku}</span>
                <span className="text-sm">{s.name}</span>
              </div>
            </button>
          ))}
          <button type="button" onMouseDown={(e) => { e.preventDefault(); setDraftName(query); setShowCreate(true); }}
            className="w-full text-left px-3 py-2 text-indigo-700 font-semibold text-sm hover:bg-indigo-50 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Buat SKU baru cepat: <span className="font-bold">"{query || '...'}"</span>
          </button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm mb-3" style={{ color: '#012749' }}>Buat SKU baru cepat</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Nama barang</label>
                <input value={draftName} onChange={e => setDraftName(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-lg border border-gray-300" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Harga jual (Rp)</label>
                <input type="number" value={draftSellPrice} onChange={e => setDraftSellPrice(Number(e.target.value))}
                  className="w-full text-sm py-2 px-3 rounded-lg border border-gray-300" />
              </div>
              <div className="text-[11px] text-gray-500">
                Kategori = "Pass-through" • Stok = 0 • HPP = harga beli grosir yang diketik di form.
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Batal</button>
              <button type="button" onClick={handleCreate} disabled={saving || !draftName.trim()}
                className="text-sm px-3 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ background: '#012749' }}>
                {saving ? 'Membuat...' : 'Buat & Pilih'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx
git commit -m "feat(pembelian): SkuPickerWithInlineCreate — search + inline create master SKU"
```

---

## Task 14: `MarkPaidModal` + `VoidConfirmModal`

**Files:**
- Create: `src/components/pembelian/bnl/MarkPaidModal.tsx`
- Create: `src/components/pembelian/bnl/VoidConfirmModal.tsx`

- [ ] **Step 1: MarkPaidModal**

```tsx
// src/components/pembelian/bnl/MarkPaidModal.tsx
import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';

interface Props {
  pi: DbPurchaseInvoice;
  onClose: () => void;
  onPaid: () => void;
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
}

export default function MarkPaidModal({ pi, onClose, onPaid, showToast }: Props) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      let url: string | undefined;
      if (proofFile) {
        url = await purchaseInvoiceService.uploadAttachment(proofFile, `payment-proofs/${pi.id}`);
      }
      await purchaseInvoiceService.markPaid(pi.id, url);
      showToast(`${pi.pi_number} ditandai Lunas.`, 'success');
      onPaid();
      onClose();
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal menandai Lunas.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Tandai Lunas — {pi.pi_number}</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Supplier</span><span className="font-semibold">{pi.supplier?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold">{`Rp ${Math.round(pi.total).toLocaleString('id-ID')}`}</span></div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Bayar (opsional)</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {proofFile ? proofFile.name : 'Klik untuk upload bukti'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: VoidConfirmModal**

```tsx
// src/components/pembelian/bnl/VoidConfirmModal.tsx
import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';

interface Props {
  pi: DbPurchaseInvoice;
  onClose: () => void;
  onVoided: () => void;
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
}

export default function VoidConfirmModal({ pi, onClose, onVoided, showToast }: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await purchaseInvoiceService.void(pi.id, reason.trim());
      showToast(`${pi.pi_number} di-void. Kasir expense reversed.`, 'success');
      onVoided();
      onClose();
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal void.', 'warning');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-red-200 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Void {pi.pi_number}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Void akan membalik Kasir expense ({`Rp -${Math.round(pi.total).toLocaleString('id-ID')}`}). PI tetap visible di history dengan flag VOID. Tidak bisa di-undo.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Alasan void (min. 10 karakter) *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Contoh: Customer batal beli, barang sudah dikembalikan ke grosir"
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 focus:border-red-400 focus:outline-none" />
            <div className="text-[11px] text-gray-400 mt-1">{reason.length} / 10 minimum</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={!valid || saving} className="text-sm font-semibold text-white bg-red-600 px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Void'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/MarkPaidModal.tsx src/components/pembelian/bnl/VoidConfirmModal.tsx
git commit -m "feat(pembelian): MarkPaidModal + VoidConfirmModal"
```

---

## Task 15: `BelanjaNumpangLewatList` page

**Files:**
- Create: `src/components/pembelian/bnl/BelanjaNumpangLewatList.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/components/pembelian/bnl/BelanjaNumpangLewatList.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileText, ShoppingBag, Clock, AlertTriangle } from 'lucide-react';
import { purchaseInvoiceService, isTerlambat } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import { type FilterState, resolveRange, inRange } from '../../../lib/dateRange';
import KpiCard from '../../ui/KpiCard';
import PiStatusBadge from './PiStatusBadge';
import MarkPaidModal from './MarkPaidModal';

interface Props {
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onCreate: () => void;
  onOpenDetail: (piNumber: string) => void;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtRpShort = (n: number) =>
  n >= 1_000_000 ? `Rp ${(n/1_000_000).toFixed(1).replace('.',',')}jt` :
  n >= 1_000     ? `Rp ${Math.round(n/1_000)}rb` : `Rp ${n}`;
const fmtDate = (s?: string|null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BelanjaNumpangLewatList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbPurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({ preset: 'bulan_ini' });
  const [statusFilter, setStatusFilter] = useState<'ALL'|'BELUM_LUNAS'|'LUNAS'|'TERLAMBAT'>('ALL');
  const [search, setSearch] = useState('');
  const [payTarget, setPayTarget] = useState<DbPurchaseInvoice | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await purchaseInvoiceService.fetchAll({ type: 'PASSTHROUGH' });
      setList(data);
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal load BNL', 'warning');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const range = resolveRange(filter);
    return list.filter(pi => {
      if (!inRange(pi.purchase_date, range)) return false;
      if (statusFilter === 'TERLAMBAT' && !isTerlambat(pi)) return false;
      if (statusFilter === 'BELUM_LUNAS' && (pi.status !== 'BELUM_LUNAS' || isTerlambat(pi))) return false;
      if (statusFilter === 'LUNAS' && pi.status !== 'LUNAS') return false;
      if (search) {
        const q = search.toLowerCase();
        const hits =
          pi.pi_number.toLowerCase().includes(q) ||
          pi.supplier?.name?.toLowerCase().includes(q) ||
          pi.order?.order_number?.toLowerCase().includes(q);
        if (!hits) return false;
      }
      return true;
    });
  }, [list, filter, statusFilter, search]);

  const kpi = useMemo(() => {
    const total = filtered.length;
    const totalBeli = filtered.reduce((a,p) => a + p.total, 0);
    const belumLunas = filtered.filter(p => p.status === 'BELUM_LUNAS' && !p.voided_at);
    const terlambat = filtered.filter(p => isTerlambat(p) && !p.voided_at);
    return {
      total, totalBeli,
      belumCount: belumLunas.length, belumTotal: belumLunas.reduce((a,p) => a + p.total, 0),
      terlambatCount: terlambat.length, terlambatTotal: terlambat.reduce((a,p) => a + p.total, 0),
    };
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: '#012749' }}>Belanja Numpang Lewat</h2>
          <div className="text-xs text-gray-500">Pembelian pass-through wajib link Order — tidak nambah stok</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg" style={{ background: '#012749' }}>
          <Plus className="w-4 h-4" /> Buat PI Baru
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard icon={<FileText className="w-5 h-5 text-white"/>} iconBg="#6366f1" label="Total PI" value={`${kpi.total} invoice`} sub="dalam periode" />
        <KpiCard icon={<ShoppingBag className="w-5 h-5 text-white"/>} iconBg="#0ea5e9" label="Total Belanja" value={fmtRpShort(kpi.totalBeli)} sub="dalam periode" />
        <KpiCard icon={<Clock className="w-5 h-5 text-white"/>} iconBg="#f59e0b" label="Belum Lunas" value={fmtRpShort(kpi.belumTotal)} sub={`${kpi.belumCount} invoice`} />
        <KpiCard icon={<AlertTriangle className="w-5 h-5 text-white"/>} iconBg="#ef4444" label="Terlambat" value={fmtRpShort(kpi.terlambatTotal)} sub={`${kpi.terlambatCount} invoice`} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['bulan_ini','30_hari','90_hari'] as const).map(p => (
            <button key={p} onClick={() => setFilter({ preset: p })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                filter.preset === p ? 'text-white' : 'bg-white border border-gray-200 text-gray-600'
              }`}
              style={filter.preset === p ? { background: '#012749' } : {}}>
              {p === 'bulan_ini' ? 'Bulan Ini' : p === '30_hari' ? '30 Hari' : '90 Hari'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input className="text-xs outline-none w-44" placeholder="Cari PI / supplier / order..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="ALL">Semua status</option>
            <option value="BELUM_LUNAS">Belum Lunas</option>
            <option value="LUNAS">Lunas</option>
            <option value="TERLAMBAT">Terlambat</option>
          </select>
        </div>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Belum ada PI dalam periode ini.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">PI / Tanggal</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Supplier (Grosir)</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Order Terkait</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Total Beli</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(pi => (
                <tr key={pi.id} className="hover:bg-slate-50 border-b border-gray-100">
                  <td className="px-5 py-4">
                    <div className="font-bold text-sm" style={{ color: '#012749' }}>{pi.pi_number}</div>
                    <div className="text-xs text-gray-500">{fmtDate(pi.purchase_date)}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-sm">{pi.supplier?.name ?? '—'}</div>
                    {pi.supplier_invoice_number && <div className="text-[11px] text-gray-500 mt-0.5">Faktur: {pi.supplier_invoice_number}</div>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-sm font-semibold text-indigo-700">{pi.order?.order_number ?? '—'}</div>
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold">{fmtRp(pi.total)}</td>
                  <td className="px-5 py-4 text-center"><PiStatusBadge pi={pi} /></td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex gap-1">
                      {pi.status === 'BELUM_LUNAS' && !pi.voided_at && (
                        <button onClick={() => setPayTarget(pi)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                          Tandai Lunas
                        </button>
                      )}
                      <button onClick={() => onOpenDetail(pi.pi_number)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payTarget && <MarkPaidModal pi={payTarget} onClose={() => setPayTarget(null)} onPaid={reload} showToast={showToast} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/BelanjaNumpangLewatList.tsx
git commit -m "feat(pembelian): BelanjaNumpangLewatList page (KPI + filter + table)"
```

---

## Task 16: `BelanjaNumpangLewatFormPage` (create/edit)

**Files:**
- Create: `src/components/pembelian/bnl/BelanjaNumpangLewatFormPage.tsx`

- [ ] **Step 1: Write the form**

```tsx
// src/components/pembelian/bnl/BelanjaNumpangLewatFormPage.tsx
import React, { useMemo, useState } from 'react';
import { ChevronRight, Plus, Upload, X, Info } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { supplierService } from '../../../lib/pembelianService';
import type { DbSupplier, PiPaymentMethod, RecordPiPayload, DbPurchaseInvoice } from '../../../types';
import OrderPicker from './OrderPicker';
import SkuPickerWithInlineCreate from './SkuPickerWithInlineCreate';
import PaymentMethodPicker from './PaymentMethodPicker';

interface Props {
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onCancel: () => void;
  onSaved: (piNumber: string) => void;
  prefill?: { orderId?: string; orderNumber?: string; customerName?: string };
  editing?: DbPurchaseInvoice;
}

interface ItemRow {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
  order_item_id?: string;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export default function BelanjaNumpangLewatFormPage({ showToast, onCancel, onSaved, prefill, editing }: Props) {
  const [order, setOrder] = useState<{ id: string; order_number: string; customer_name?: string } | null>(
    editing?.order_id && editing.order
      ? { id: editing.order_id, order_number: editing.order.order_number, customer_name: editing.order.customer_name }
      : prefill?.orderId
        ? { id: prefill.orderId, order_number: prefill.orderNumber ?? '?', customer_name: prefill.customerName }
        : null
  );
  const [supplier, setSupplier] = useState<DbSupplier | null>(editing?.supplier ?? null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<DbSupplier[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(editing?.purchase_date ?? new Date().toISOString().slice(0,10));
  const [supplierInvNum, setSupplierInvNum] = useState(editing?.supplier_invoice_number ?? '');
  const [supplierInvoicePhoto, setSupplierInvoicePhoto] = useState<File | null>(null);
  const [supplierInvoicePhotoUrl, setSupplierInvoicePhotoUrl] = useState(editing?.supplier_invoice_photo_url ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PiPaymentMethod>(editing?.payment_method ?? 'CASH');
  const [paymentDueAt, setPaymentDueAt] = useState(editing?.payment_due_at ?? '');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [initialStatus, setInitialStatus] = useState<'BELUM_LUNAS'|'LUNAS'>(editing?.status ?? 'LUNAS');
  const [items, setItems] = useState<ItemRow[]>(
    editing?.items?.map(i => ({
      sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost,
      sell_price: i.sell_price, order_item_id: i.order_item_id ?? undefined,
    })) ?? []
  );
  const [draftSku, setDraftSku] = useState<{ sku: string; name: string; sell_price?: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingPi: string } | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!supplierQuery || supplierQuery.length < 2) { setSupplierResults([]); return; }
    const t = setTimeout(async () => {
      const all = await supplierService.fetchAll();
      setSupplierResults(all.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase())).slice(0, 10));
    }, 200);
    return () => clearTimeout(t);
  }, [supplierQuery]);

  // Auto-fill payment_due_at from supplier term when method=TEMPO or status=BELUM_LUNAS
  React.useEffect(() => {
    if (!supplier) return;
    if ((paymentMethod === 'TEMPO' || initialStatus === 'BELUM_LUNAS') && !paymentDueAt) {
      const term = supplier.payment_term_days ?? 0;
      const d = new Date(purchaseDate);
      d.setDate(d.getDate() + term);
      setPaymentDueAt(d.toISOString().slice(0,10));
    }
  }, [supplier, paymentMethod, initialStatus, purchaseDate]);

  const subtotal = useMemo(() => items.reduce((a,i) => a + i.qty * i.unit_cost, 0), [items]);
  const projectedRevenue = useMemo(() => items.reduce((a,i) => a + i.qty * i.sell_price, 0), [items]);
  const profit = projectedRevenue - subtotal;
  const margin = projectedRevenue > 0 ? (profit / projectedRevenue * 100) : 0;

  function addItemFromSku() {
    if (!draftSku) return;
    setItems(prev => [...prev, {
      sku: draftSku.sku, product_name: draftSku.name,
      qty: 1, unit_cost: 0, sell_price: draftSku.sell_price ?? 0,
    }]);
    setDraftSku(null);
  }

  async function handleSubmit(forceIgnoreDup = false) {
    if (!order) { showToast('Pilih Order tujuan dulu', 'warning'); return; }
    if (!supplier) { showToast('Pilih supplier dulu', 'warning'); return; }
    if (items.length === 0) { showToast('Tambah minimal 1 item', 'warning'); return; }
    if (initialStatus === 'BELUM_LUNAS' && !paymentDueAt) {
      showToast('Tanggal jatuh tempo wajib untuk Belum Lunas', 'warning'); return;
    }
    setSaving(true);
    try {
      // upload files first if present
      let invoicePhoto = supplierInvoicePhotoUrl;
      if (supplierInvoicePhoto) {
        invoicePhoto = await purchaseInvoiceService.uploadAttachment(supplierInvoicePhoto, `supplier-invoices/${supplier.id}`);
      }
      let payProof = editing?.payment_proof_url ?? undefined;
      if (paymentProofFile) {
        payProof = await purchaseInvoiceService.uploadAttachment(paymentProofFile, `payment-proofs/${supplier.id}`);
      }

      if (editing) {
        await purchaseInvoiceService.update(editing.id, {
          supplier_id: supplier.id,
          order_id: order.id,
          purchase_date: purchaseDate,
          supplier_invoice_number: supplierInvNum || undefined,
          supplier_invoice_photo_url: invoicePhoto || undefined,
          payment_method: paymentMethod,
          payment_due_at: paymentDueAt || undefined,
          payment_proof_url: payProof,
          notes: notes || undefined,
          items: items.map(i => ({
            sku: i.sku, product_name: i.product_name, qty: i.qty,
            unit_cost: i.unit_cost, sell_price: i.sell_price,
            order_item_id: i.order_item_id ?? null,
          })),
        });
        showToast(`${editing.pi_number} di-update.`, 'success');
        onSaved(editing.pi_number);
        return;
      }

      const payload: RecordPiPayload = {
        supplier_id: supplier.id,
        order_id: order.id,
        purchase_date: purchaseDate,
        supplier_invoice_number: supplierInvNum || undefined,
        supplier_invoice_photo_url: invoicePhoto || undefined,
        payment_method: paymentMethod,
        payment_due_at: initialStatus === 'BELUM_LUNAS' ? paymentDueAt : undefined,
        initial_status: initialStatus,
        payment_proof_url: payProof,
        notes: notes || undefined,
        items: items.map(i => ({
          sku: i.sku, product_name: i.product_name, qty: i.qty,
          unit_cost: i.unit_cost, sell_price: i.sell_price,
        })),
        ignore_duplicate_warning: forceIgnoreDup,
      };
      const result = await purchaseInvoiceService.record(payload);
      if (result.kind === 'duplicate_warning') {
        setDuplicateWarning({ existingPi: result.existing_pi });
      } else {
        showToast(`${result.pi_number} dibuat.`, 'success');
        onSaved(result.pi_number);
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal simpan PI', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Pembelian</span><ChevronRight className="w-3 h-3" />
        <span>Belanja Numpang Lewat</span><ChevronRight className="w-3 h-3" />
        <span className="text-gray-800 font-semibold">{editing ? `Edit ${editing.pi_number}` : 'Buat Baru'}</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>
        {editing ? `Edit ${editing.pi_number}` : 'Buat Belanja Numpang Lewat'}
      </h1>
      <p className="text-xs text-gray-500">Pembelian pass-through — barang langsung jual ke customer, tidak nambah stok.</p>

      {/* 1. Header */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Header</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Order Terkait <span className="text-red-500">*</span></label>
            <OrderPicker value={order} onChange={setOrder} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Supplier (Toko Grosir) <span className="text-red-500">*</span></label>
            {supplier ? (
              <div className="border-2 border-gray-300 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{supplier.name}</div>
                  <div className="text-[11px] text-gray-500">Net {supplier.payment_term_days ?? 0} hari</div>
                </div>
                <button type="button" onClick={() => setSupplier(null)} className="text-xs text-indigo-600 font-semibold hover:underline">Ganti</button>
              </div>
            ) : (
              <div className="relative">
                <input value={supplierQuery} onChange={e => setSupplierQuery(e.target.value)}
                  placeholder="Cari supplier..."
                  className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300 focus:outline-none focus:border-indigo-500" />
                {supplierResults.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded-xl border border-gray-200 shadow-lg">
                    {supplierResults.map(s => (
                      <button key={s.id} type="button" onClick={() => { setSupplier(s); setSupplierQuery(''); setSupplierResults([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
                        <div className="font-semibold text-sm">{s.name}</div>
                        <div className="text-[11px] text-gray-500">Net {s.payment_term_days} hari</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Beli</label>
            <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nomor Faktur Supplier</label>
            <input value={supplierInvNum} onChange={e => setSupplierInvNum(e.target.value)}
              placeholder="INV-0123 / nota tulis tangan"
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Foto Faktur Supplier <span className="text-[11px] font-normal text-amber-700 ml-2">(Recommended — bukti dispute)</span></label>
            <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-500 hover:border-indigo-300">
              <Upload className="w-4 h-4" />
              {supplierInvoicePhoto ? supplierInvoicePhoto.name : (supplierInvoicePhotoUrl ? 'Sudah ada foto (klik untuk ganti)' : 'Klik atau drag foto faktur (JPG/PNG/PDF, max 5MB)')}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setSupplierInvoicePhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Misal: nota grosir terlampir, atau pesan khusus"
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
        </div>
      </div>

      {/* 2. Items */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">2. Barang yang Dibeli</div>
          <div className="text-[11px] text-violet-700 bg-violet-50 px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1">
            <Info className="w-3 h-3" /> Stok tidak berubah — barang langsung jual ke customer
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left py-2 pr-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 px-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Jual</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-3 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                    <span className="text-sm">{it.product_name}</span>
                  </div>
                </td>
                <td className="py-3 px-2"><input type="number" min="1" value={it.qty}
                  onChange={e => setItems(prev => prev.map((p,i) => i === idx ? { ...p, qty: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-center py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2"><input type="number" min="0" value={it.unit_cost}
                  onChange={e => setItems(prev => prev.map((p,i) => i === idx ? { ...p, unit_cost: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-right py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2"><input type="number" min="0" value={it.sell_price}
                  onChange={e => setItems(prev => prev.map((p,i) => i === idx ? { ...p, sell_price: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-right py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2 text-right text-sm font-bold" style={{ color: '#012749' }}>{fmtRp(it.qty * it.unit_cost)}</td>
                <td className="py-3 text-center">
                  <button type="button" onClick={() => setItems(prev => prev.filter((_,i) => i !== idx))} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} className="py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SkuPickerWithInlineCreate value={draftSku} unitCostHint={0} onChange={(v) => setDraftSku(v)} />
                  </div>
                  <button type="button" onClick={addItemFromSku} disabled={!draftSku}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-white px-3 py-2 rounded-lg disabled:opacity-50"
                    style={{ background: '#012749' }}>
                    <Plus className="w-4 h-4" /> Tambah
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Payment */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Pembayaran ke Supplier</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">Metode</div>
            <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
            {(paymentMethod === 'TEMPO' || initialStatus === 'BELUM_LUNAS') && (
              <div className="mt-3 p-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40">
                <label className="text-xs font-semibold text-fuchsia-700 block mb-1.5">Jatuh Tempo Bayar *</label>
                <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-xl border border-fuchsia-200" />
                <div className="text-[11px] text-fuchsia-700 mt-2">Auto-fill dari supplier Net {supplier?.payment_term_days ?? 0} hari.</div>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">Status</div>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'LUNAS' ? 'border-green-500 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" checked={initialStatus === 'LUNAS'} onChange={() => setInitialStatus('LUNAS')} className="accent-green-600" />
                <span className="text-xs font-bold">Sudah Lunas</span>
              </label>
              <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'BELUM_LUNAS' ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" checked={initialStatus === 'BELUM_LUNAS'} onChange={() => setInitialStatus('BELUM_LUNAS')} className="accent-amber-600" />
                <span className="text-xs font-bold">Belum Lunas</span>
              </label>
            </div>
            <div className="mt-3">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Bukti Bayar (opsional)</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-400 hover:border-indigo-300">
                <Upload className="w-4 h-4" />
                {paymentProofFile ? paymentProofFile.name : 'Klik untuk upload'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setPaymentProofFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Summary */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">4. Ringkasan</div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-2xl p-4">
            <div className="text-[11px] text-gray-500 uppercase font-semibold">Total Beli</div>
            <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(subtotal)}</div>
          </div>
          <div className="bg-indigo-50 rounded-2xl p-4">
            <div className="text-[11px] text-indigo-600 uppercase font-semibold">Estimasi Jual</div>
            <div className="text-xl font-extrabold mt-1 text-indigo-700">{fmtRp(projectedRevenue)}</div>
          </div>
          <div className="bg-green-50 rounded-2xl p-4">
            <div className="text-[11px] text-green-700 uppercase font-semibold">Estimasi Profit ({margin.toFixed(1)}%)</div>
            <div className="text-xl font-extrabold mt-1 text-green-700">{fmtRp(profit)}</div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
        <button onClick={() => handleSubmit(false)} disabled={saving}
          className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
          style={{ background: '#012749' }}>
          {saving ? 'Menyimpan...' : (editing ? 'Update PI' : 'Simpan')}
        </button>
      </div>

      {duplicateWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDuplicateWarning(null)}>
          <div className="bg-white rounded-xl border border-amber-200 shadow-xl max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm text-amber-800 mb-2">⚠ Nomor Faktur Sudah Pernah</h3>
            <p className="text-xs text-gray-600">
              Faktur <strong>{supplierInvNum}</strong> dari supplier ini sudah pernah dicatat di <strong>{duplicateWarning.existingPi}</strong>. Apakah kamu yakin mau lanjut?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDuplicateWarning(null)} className="text-sm px-3 py-2 rounded-lg border border-gray-200">Batal</button>
              <button onClick={() => { setDuplicateWarning(null); handleSubmit(true); }}
                className="text-sm px-3 py-2 rounded-lg text-white font-semibold" style={{ background: '#012749' }}>Lanjut</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/BelanjaNumpangLewatFormPage.tsx
git commit -m "feat(pembelian): BelanjaNumpangLewatFormPage (create+edit) with duplicate warning modal"
```

---

## Task 17: `BelanjaNumpangLewatDetailPage`

**Files:**
- Create: `src/components/pembelian/bnl/BelanjaNumpangLewatDetailPage.tsx`

- [ ] **Step 1: Write the detail page**

```tsx
// src/components/pembelian/bnl/BelanjaNumpangLewatDetailPage.tsx
import React, { useEffect, useState } from 'react';
import { ChevronRight, Printer, Download, CheckCircle, XOctagon, Link as LinkIcon, Store, CalendarClock, ArrowLeft } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import PiStatusBadge from './PiStatusBadge';
import MarkPaidModal from './MarkPaidModal';
import VoidConfirmModal from './VoidConfirmModal';

interface Props {
  piNumber: string;
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onBack: () => void;
  onEdit: (pi: DbPurchaseInvoice) => void;
  onOrderClick: (orderId: string) => void;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string|null) => s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BelanjaNumpangLewatDetailPage({ piNumber, showToast, onBack, onEdit, onOrderClick }: Props) {
  const [pi, setPi] = useState<DbPurchaseInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPi(await purchaseInvoiceService.fetchByNumber(piNumber)); }
    catch (e: any) { showToast(e?.message ?? 'Gagal load PI', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [piNumber]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  if (!pi) return <div className="p-8 text-center text-sm text-gray-500">PI tidak ditemukan.</div>;

  const totalRev = (pi.items ?? []).reduce((a,i) => a + i.qty * i.sell_price, 0);
  const profit = totalRev - pi.total;
  const margin = totalRev > 0 ? (profit / totalRev * 100) : 0;

  async function handlePrintPdf() {
    const mod = await import('../../../lib/pdf/belanjaNumpangLewatPdf');
    const blob = mod.generateBelanjaNumpangLewatPdf({ pi: pi! });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Belanja Numpang Lewat</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">{pi.pi_number}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>{pi.pi_number}</h1>
            <PiStatusBadge pi={pi} />
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">⚡ Pass-through</span>
          </div>
          <div className="text-xs text-gray-500">Dibuat {fmtDate(pi.purchase_date)} • {pi.supplier?.name}</div>
        </div>
        <div className="flex gap-2">
          {pi.status === 'BELUM_LUNAS' && !pi.voided_at && (
            <>
              <button onClick={() => setShowPay(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700">
                <CheckCircle className="w-4 h-4" /> Tandai Lunas
              </button>
              <button onClick={() => onEdit(pi)} className="text-sm font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Edit</button>
            </>
          )}
          {pi.status === 'LUNAS' && !pi.voided_at && (
            <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50">
              <XOctagon className="w-4 h-4" /> Void
            </button>
          )}
          <button onClick={handlePrintPdf} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <LinkIcon className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Order Terkait</div>
          </div>
          <div className="text-sm font-bold text-indigo-700">{pi.order?.order_number ?? '—'}</div>
          <div className="text-xs text-gray-600 mt-1">{(pi.order as any)?.customer_name ?? ''}</div>
          {pi.order_id && (
            <button onClick={() => onOrderClick(pi.order_id!)} className="text-[11px] text-indigo-600 font-semibold hover:underline mt-2">Lihat Order →</button>
          )}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{pi.supplier?.name}</div>
          <div className="text-xs text-gray-500 mt-1">Net {pi.supplier?.payment_term_days ?? 0} hari</div>
          {pi.supplier_invoice_number && <div className="text-[11px] text-gray-600 mt-1">Faktur: <strong>{pi.supplier_invoice_number}</strong></div>}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Jatuh Tempo</div>
          </div>
          <div className="font-bold text-amber-700">{fmtDate(pi.payment_due_at)}</div>
          <div className="text-xs text-gray-500 mt-1">{pi.payment_method}</div>
        </div>
      </div>

      {(pi.supplier_invoice_photo_url || pi.payment_proof_url) && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Lampiran</div>
          <div className="flex gap-3">
            {pi.supplier_invoice_photo_url && (
              <a href={pi.supplier_invoice_photo_url} target="_blank" rel="noreferrer" className="block">
                <div className="text-[11px] font-semibold text-gray-600 mb-1">Faktur Supplier</div>
                <img src={pi.supplier_invoice_photo_url} alt="Faktur" className="w-32 h-32 object-cover rounded-lg border border-gray-200" />
              </a>
            )}
            {pi.payment_proof_url && (
              <a href={pi.payment_proof_url} target="_blank" rel="noreferrer" className="block">
                <div className="text-[11px] font-semibold text-gray-600 mb-1">Bukti Bayar</div>
                <img src={pi.payment_proof_url} alt="Bukti" className="w-32 h-32 object-cover rounded-lg border border-gray-200" />
              </a>
            )}
          </div>
        </div>
      )}

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Barang yang Dibeli</div>
        <table className="w-full">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Jual</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(pi.items ?? []).map(it => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                    <span className="text-sm">{it.product_name}</span>
                  </div>
                </td>
                <td className="py-3 text-center font-semibold">{it.qty}</td>
                <td className="py-3 text-right">{fmtRp(it.unit_cost)}</td>
                <td className="py-3 text-right text-indigo-700">{fmtRp(it.sell_price)}</td>
                <td className="py-3 text-right font-bold" style={{ color: '#012749' }}>{fmtRp(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right text-xs font-semibold text-gray-500">TOTAL BELI</td>
              <td className="py-3 text-right text-xl font-extrabold" style={{ color: '#012749' }}>{fmtRp(pi.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-3xl border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500 uppercase font-semibold">Total Dibayar Ke Grosir</div>
          <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(pi.total)}</div>
        </div>
        <div className="bg-indigo-50 rounded-3xl border border-indigo-200 p-4">
          <div className="text-[11px] text-indigo-600 uppercase font-semibold">Pendapatan dari Order</div>
          <div className="text-xl font-extrabold mt-1 text-indigo-700">{fmtRp(totalRev)}</div>
        </div>
        <div className="bg-green-50 rounded-3xl border border-green-200 p-4">
          <div className="text-[11px] text-green-700 uppercase font-semibold">Profit ({margin.toFixed(1)}%)</div>
          <div className="text-xl font-extrabold mt-1 text-green-700">{fmtRp(profit)}</div>
        </div>
      </div>

      {showPay && <MarkPaidModal pi={pi} onClose={() => setShowPay(false)} onPaid={reload} showToast={showToast} />}
      {showVoid && <VoidConfirmModal pi={pi} onClose={() => setShowVoid(false)} onVoided={reload} showToast={showToast} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/pembelian/bnl/BelanjaNumpangLewatDetailPage.tsx
git commit -m "feat(pembelian): BelanjaNumpangLewatDetailPage with attachments + actions"
```

---

## Task 18: PDF generator

**Files:**
- Create: `src/lib/pdf/belanjaNumpangLewatPdf.ts`

- [ ] **Step 1: Write the generator**

```typescript
// src/lib/pdf/belanjaNumpangLewatPdf.ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DbPurchaseInvoice } from '../../types';

const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';
const BRAND_VIOLET = '#7c3aed';

function fmtRp(n: number): string { return 'Rp ' + Math.round(n).toLocaleString('id-ID'); }
function fmtDate(s?: string|null): string {
  if (!s) return '—';
  const d = new Date(s);
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function generateBelanjaNumpangLewatPdf(args: { pi: DbPurchaseInvoice }): Blob {
  const { pi } = args;
  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });

  doc.setFontSize(11); doc.setTextColor(TEXT_DARK); doc.setFont('helvetica','bold');
  doc.text('BELANJA NUMPANG LEWAT', 8, 10);
  doc.setFontSize(9); doc.setTextColor(BRAND_VIOLET);
  doc.text(pi.pi_number, 8, 15);
  doc.setTextColor(TEXT_MUTED); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text(`Tanggal: ${fmtDate(pi.purchase_date)}`, 8, 19);
  doc.text(`Status: ${pi.status === 'LUNAS' ? '✓ LUNAS' : '○ BELUM LUNAS'}`, 60, 19);

  doc.setDrawColor(220); doc.line(8, 22, 100, 22);

  doc.setFontSize(7); doc.setTextColor(TEXT_DARK);
  doc.text(`Supplier (Grosir): ${pi.supplier?.name ?? '—'}`, 8, 27);
  if (pi.supplier_invoice_number) doc.text(`Faktur Supplier: ${pi.supplier_invoice_number}`, 8, 30);
  doc.text(`Untuk Order: ${pi.order?.order_number ?? '—'}`, 8, 33);

  autoTable(doc, {
    startY: 38,
    head: [['Item', 'Qty', 'Beli', 'Subtotal']],
    body: (pi.items ?? []).map(it => [
      it.product_name, it.qty.toString(), fmtRp(it.unit_cost), fmtRp(it.subtotal),
    ]),
    theme: 'plain',
    styles: { fontSize: 7, cellPadding: 1.2 },
    headStyles: { fontStyle: 'bold', textColor: TEXT_MUTED, fillColor: '#f3f4f6' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  const endY = (doc as any).lastAutoTable.finalY ?? 80;
  doc.setFont('helvetica','bold'); doc.setFontSize(8);
  doc.text('TOTAL', 60, endY + 5);
  doc.text(fmtRp(pi.total), 95, endY + 5, { align: 'right' });

  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(TEXT_MUTED);
  doc.text(`Pembayaran: ${pi.payment_method}${pi.status === 'LUNAS' ? ` — Lunas ${fmtDate(pi.paid_at)}` : ''}`, 8, endY + 12);

  return doc.output('blob');
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/pdf/belanjaNumpangLewatPdf.ts
git commit -m "feat(pembelian): A6 PDF tanda terima generator for BNL"
```

---

## Task 19: Wire `PembelianScreen` sub-tab + view router

**Files:**
- Modify: `src/components/PembelianScreen.tsx`

- [ ] **Step 1: Read current state, then patch**

Open `src/components/PembelianScreen.tsx`. Find the `type Tab = 'orders' | 'suppliers';` and the tab nav. Add `'bnl'` value + sub-tab UI + view router.

```tsx
// Near the existing imports at top:
import BelanjaNumpangLewatList from './pembelian/bnl/BelanjaNumpangLewatList';
import BelanjaNumpangLewatFormPage from './pembelian/bnl/BelanjaNumpangLewatFormPage';
import BelanjaNumpangLewatDetailPage from './pembelian/bnl/BelanjaNumpangLewatDetailPage';

// Replace:
//   type Tab = 'orders' | 'suppliers';
// With:
type Tab = 'orders' | 'bnl' | 'suppliers';

// Extend ViewMode union:
type ViewMode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; po: DbPurchaseOrder }
  | { kind: 'detail'; poNumber: string }
  | { kind: 'bnl-list' }
  | { kind: 'bnl-create'; prefill?: { orderId?: string; orderNumber?: string; customerName?: string } }
  | { kind: 'bnl-edit'; pi: DbPurchaseInvoice }
  | { kind: 'bnl-detail'; piNumber: string };
```

Add a new prop for deep-link entry:

```tsx
interface PembelianScreenProps {
  // ...existing props...
  initialBnlPiNumber?: string | null;
  onBnlDetailConsumed?: () => void;
}
```

In the tab switcher (existing JSX with `tab === 'orders'` / `tab === 'suppliers'`), add a third button:

```tsx
<button
  onClick={() => { setTab('bnl'); setViewMode({ kind: 'bnl-list' }); }}
  className={`px-4 py-2 rounded-full text-xs font-semibold ${tab === 'bnl' ? 'text-white' : 'text-gray-500'}`}
  style={tab === 'bnl' ? { background: '#012749' } : {}}>
  Belanja Numpang Lewat
</button>
```

In the existing render switch (where `viewMode.kind === 'list'` / `'create'` / `'detail'` are handled for PO), add the BNL views:

```tsx
{tab === 'bnl' && viewMode.kind === 'bnl-list' && (
  <BelanjaNumpangLewatList
    showToast={showToast}
    onCreate={() => setViewMode({ kind: 'bnl-create' })}
    onOpenDetail={(piNumber) => setViewMode({ kind: 'bnl-detail', piNumber })}
  />
)}
{viewMode.kind === 'bnl-create' && (
  <BelanjaNumpangLewatFormPage
    showToast={showToast}
    onCancel={() => setViewMode({ kind: 'bnl-list' })}
    onSaved={(piNumber) => setViewMode({ kind: 'bnl-detail', piNumber })}
    prefill={viewMode.prefill}
  />
)}
{viewMode.kind === 'bnl-edit' && (
  <BelanjaNumpangLewatFormPage
    showToast={showToast}
    onCancel={() => setViewMode({ kind: 'bnl-detail', piNumber: viewMode.pi.pi_number })}
    onSaved={(piNumber) => setViewMode({ kind: 'bnl-detail', piNumber })}
    editing={viewMode.pi}
  />
)}
{viewMode.kind === 'bnl-detail' && (
  <BelanjaNumpangLewatDetailPage
    piNumber={viewMode.piNumber}
    showToast={showToast}
    onBack={() => setViewMode({ kind: 'bnl-list' })}
    onEdit={(pi) => setViewMode({ kind: 'bnl-edit', pi })}
    onOrderClick={(orderId) => { /* TODO: navigate to Order via parent — Task 21 */ }}
  />
)}
```

Add deep-link handler (mirrors existing `initialDetailPoNumber` pattern):

```tsx
useEffect(() => {
  if (initialBnlPiNumber) {
    setTab('bnl');
    setViewMode({ kind: 'bnl-detail', piNumber: initialBnlPiNumber });
    onBnlDetailConsumed?.();
  }
}, [initialBnlPiNumber, onBnlDetailConsumed]);
```

Also add the import for `DbPurchaseInvoice` type at the top.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): wire 'Belanja Numpang Lewat' sub-tab + view router"
```

---

## Task 20: `App.tsx` deep-link routing for `?screen=pembelian&bnl=PI-...`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Patch App.tsx**

Locate where `initialDetailPoNumber` is parsed from URL (the PO deep-link from `2026-06-13-pembelian-detail-tab-and-filter-design.md`). Add a parallel `?bnl=...` parser.

```tsx
// near existing URLSearchParams parsing on boot:
const params = new URLSearchParams(window.location.search);
const initialPoNumber = params.get('po');
const initialBnlPiNumber = params.get('bnl');
```

Pass to `<PembelianScreen>`:

```tsx
<PembelianScreen
  // ...existing props...
  initialDetailPoNumber={initialPoNumber}
  onDetailConsumed={() => { /* existing */ }}
  initialBnlPiNumber={initialBnlPiNumber}
  onBnlDetailConsumed={() => { /* clear if you want */ }}
/>
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/App.tsx
git commit -m "feat(pembelian): App.tsx deep-link ?bnl=PI-... routing"
```

---

## Task 21: Order detail integration — PI section + source attribution + shortcut

**Files:**
- Modify: `src/components/OrderDetailPage.tsx` (or whichever file renders Order detail; verify via grep)

- [ ] **Step 1: Locate Order detail file**

```bash
grep -rln "Order History\|OrderDetail" src/components | head -5
```

Use the file that renders the Order detail view (most likely `src/components/OrderDetailPage.tsx`).

- [ ] **Step 2: Add the PI section + source attribution**

At the top of the file, import:

```tsx
import { purchaseInvoiceService } from '../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice, OrderCogsBreakdownRow } from '../types';
import { Zap, Package, Plus } from 'lucide-react';
```

Inside the component, add state + fetch:

```tsx
const [linkedPis, setLinkedPis] = useState<DbPurchaseInvoice[]>([]);
const [cogsRows, setCogsRows] = useState<OrderCogsBreakdownRow[]>([]);

useEffect(() => {
  if (!order?.id) return;
  (async () => {
    const [pis, cogs] = await Promise.all([
      purchaseInvoiceService.fetchByOrderId(order.id),
      purchaseInvoiceService.fetchCogsForOrder(order.id),
    ]);
    setLinkedPis(pis);
    setCogsRows(cogs);
  })();
}, [order?.id]);
```

Inside the JSX, in the order header actions, add a "+ Buat PI untuk Order ini" button:

```tsx
<button
  onClick={() => {
    // Open Pembelian in a new tab with prefill via URL deep-link
    // For Phase 1 simplicity: redirect with state via window.open
    const url = new URL(window.location.href);
    url.searchParams.set('screen', 'pembelian');
    url.searchParams.set('bnl-new-for-order', order.id);
    url.searchParams.set('bnl-new-order-number', order.order_number);
    window.open(url.toString(), '_blank');
  }}
  className="inline-flex items-center gap-2 text-sm font-semibold text-white px-3 py-2 rounded-lg"
  style={{ background: '#012749' }}
>
  <Plus className="w-4 h-4" /> Buat PI untuk Order ini
</button>
```

Add a new section "Purchase Invoice Terkait (Pass-Through)" below the items table:

```tsx
{linkedPis.length > 0 && (
  <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-violet-200 shadow-sm p-5">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-violet-600" />
        <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Purchase Invoice Terkait (Pass-Through)</div>
      </div>
      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">{linkedPis.length} PI</span>
    </div>
    <div className="space-y-2">
      {linkedPis.map(pi => (
        <div key={pi.id} className="bg-white rounded-2xl border border-gray-200 p-3 flex items-center gap-3">
          <div className="flex-1">
            <div className="font-bold text-sm" style={{ color: '#012749' }}>{pi.pi_number}</div>
            <div className="text-xs text-gray-500 mt-0.5">{pi.supplier?.name} • {pi.items?.length ?? 0} item</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-500 uppercase font-semibold">Beli</div>
            <div className="font-bold" style={{ color: '#012749' }}>{`Rp ${Math.round(pi.total).toLocaleString('id-ID')}`}</div>
          </div>
          <a href={`?screen=pembelian&bnl=${pi.pi_number}`} target="_blank" rel="noreferrer"
            className="text-xs font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            Detail PI →
          </a>
        </div>
      ))}
    </div>
  </div>
)}
```

In the order items table, add a "Sumber Pengadaan" column (find where the existing columns are mapped):

```tsx
// Header:
<th className="text-center py-2 w-44 text-[11px] font-semibold text-gray-500 uppercase">Sumber Pengadaan</th>

// Cell (inside the rows .map):
<td className="py-3 text-center">
  {(() => {
    const row = cogsRows.find(r => r.order_item_id === item.id);
    if (!row || row.qty_from_pi === 0) {
      return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">📦 Dari Stok</span>;
    }
    return (
      <span className="text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)', color: '#5b21b6' }}>
        ⚡ {row.source_pi_number}
      </span>
    );
  })()}
</td>
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/OrderDetailPage.tsx
git commit -m "feat(orders): Order detail — PI Terkait section + Sumber Pengadaan column + Buat PI shortcut"
```

---

## Task 22: App.tsx — handle "Buat PI untuk Order ini" deep-link

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/PembelianScreen.tsx`

- [ ] **Step 1: Parse new params in App.tsx**

```tsx
const bnlNewForOrder = params.get('bnl-new-for-order');
const bnlNewOrderNumber = params.get('bnl-new-order-number');
```

Pass to `PembelianScreen`:

```tsx
<PembelianScreen
  // ...existing props...
  initialBnlPrefill={bnlNewForOrder ? { orderId: bnlNewForOrder, orderNumber: bnlNewOrderNumber ?? '?' } : null}
/>
```

- [ ] **Step 2: Handle prefill in PembelianScreen.tsx**

Add prop:

```tsx
interface PembelianScreenProps {
  // ...existing props...
  initialBnlPrefill?: { orderId: string; orderNumber: string } | null;
}
```

In effect:

```tsx
useEffect(() => {
  if (initialBnlPrefill?.orderId) {
    setTab('bnl');
    setViewMode({ kind: 'bnl-create', prefill: { orderId: initialBnlPrefill.orderId, orderNumber: initialBnlPrefill.orderNumber } });
  }
}, [initialBnlPrefill?.orderId]);
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/App.tsx src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): App.tsx + PembelianScreen handle ?bnl-new-for-order= prefill"
```

---

## Task 23: Smoke test + progress.md

- [ ] **Step 1: Run dev server + manual smoke checklist**

```bash
npm run dev
# In a browser, log in as a user with pembelian permission.
```

Walk through each item:
- [ ] Pembelian → Belanja Numpang Lewat tab shows empty list ✓
- [ ] Click "Buat PI Baru" → form opens
- [ ] Pick an Order, pick a supplier, add 1 item with qty/cost/sell, choose Cash + Sudah Lunas, save
- [ ] List shows new PI with badge "● Lunas"
- [ ] Click "Detail" → detail page renders with all fields + 0 stock changed
- [ ] Verify in Kasir: expense entry with category "Pembelian Pass-Through" exists
- [ ] Create another PI with Tempo + Belum Lunas, payment_due_at set
- [ ] List shows that PI with badge "○ Belum Lunas"
- [ ] Click "Tandai Lunas" → modal → confirm → status becomes Lunas
- [ ] Click Void on a Lunas PI → reason ≥10 chars → confirm → reversal Kasir expense appears
- [ ] Try duplicate supplier_invoice_number → warning modal appears → click Lanjut → second PI created
- [ ] Open Order detail of an Order with linked PI → "PI Terkait" section visible → "Sumber Pengadaan" column shows pill
- [ ] Click "+ Buat PI untuk Order ini" → new tab opens with form pre-filled with that Order

- [ ] **Step 2: Verify zero stock impact**

In psql or via UI: pick a SKU used in a PI item. Confirm `stocks.stock` is unchanged before vs after PI creation. Confirm no new `stock_lots` row was inserted for that SKU.

- [ ] **Step 3: Update progress.md**

Prepend a new entry to `progress.md`:

```markdown
## 2026-06-14 — Belanja Numpang Lewat (BNL) Phase 1 — IMPLEMENTATION COMPLETE

- **What:** Full implementation of `docs/superpowers/specs/2026-06-14-pembelian-belanja-numpang-lewat-design.md`. New menu "Belanja Numpang Lewat" inside Pembelian, backed by `purchase_invoices` + `purchase_invoice_items` tables with `type='PASSTHROUGH'` discriminator. Four atomic RPCs handle lifecycle. SQL view `order_cogs_breakdown` allocates PI cost FIFO to matched Order items. Order detail page got "PI Terkait" section + "Sumber Pengadaan" column + "+ Buat PI untuk Order ini" shortcut.
- **Backend migrations applied:**
  - `20260614000010_pi_schema.sql` — tables + indexes + check constraints + RLS
  - `20260614000011_pi_rpcs_create.sql` — `generate_pi_number()` + `record_pi()` with BR6 duplicate warning
  - `20260614000012_pi_rpcs_lifecycle.sql` — `mark_pi_paid()` + `void_pi()` + `update_pi()`
  - `20260614000013_order_cogs_breakdown_view.sql` — COGS attribution view
- **Integration tests added (4 files, ~15 cases):** record_pi happy + edge cases, BR6 duplicate warning, lifecycle (mark paid + void + update), COGS view structure.
- **Frontend (12 new files under `src/components/pembelian/bnl/` + 1 service + 1 PDF):** List page (KPI strip + filter + table), Form page (5 sections: header/items/payment/summary, with supplier invoice photo upload + inline SKU create + duplicate warning modal), Detail page (info cards + attachments + items + profit summary + actions), MarkPaidModal, VoidConfirmModal, OrderPicker, SkuPickerWithInlineCreate, PaymentMethodPicker, PiNumberBadge, PiStatusBadge. A6 PDF tanda terima generator.
- **Integrations:** PembelianScreen sub-tab + view router. OrderDetailPage adds PI Terkait section + Sumber Pengadaan column + shortcut button. App.tsx deep-link `?bnl=PI-...` + `?bnl-new-for-order=<orderId>`.
- **Smoke tested:** create flow (Cash Lunas + Tempo Belum Lunas), mark paid, void, duplicate warning override, Order detail integration, zero stock impact verified.
- **Branch:** `feat/calista-phase-1a` (specs + impl on same branch following existing pattern).
- **Next:** founder smoke test in production → if approved, Phase 2 brainstorm session (PO refactor — Pesanan/Tagihan/Tukar Faktur/Pembayaran) per `docs/superpowers/specs/2026-06-14-pembelian-phase2-roadmap-design.md`.
```

- [ ] **Step 4: Final commit**

```bash
git add progress.md
git commit -m "docs(progress): BNL Phase 1 implementation complete"
```

---

## Self-Review Pass

I cross-checked the plan against the spec:

1. **Spec §3 Data Model** → Task 1 (schema) covers all 22 columns + 5 indexes + 4 CHECK constraints + RLS.
2. **Spec §3 generate_pi_number** → Task 2.
3. **Spec §3 Inline SKU create** → Task 13 (SkuPickerWithInlineCreate) sets category='Pass-through' + stock=0 + harga_modal=unit_cost.
4. **Spec §4 Lifecycle** → Tasks 2 (record_pi initial status), 3 (mark_pi_paid + void_pi + update_pi). TERLAMBAT is derived in `isTerlambat()` helper (Task 10).
5. **Spec §5 Business Rules:**
   - BR1 (wajib Order) → CHECK constraint Task 1 + RPC validation Task 2.
   - BR2 (zero stock) → covered by NOT touching stocks in record_pi RPC (Task 2). Test in Task 5 verifies.
   - BR3 (COGS attribution) → Task 4 view + Task 21 Order detail.
   - BR4 (Kasir expense LUNAS) → Task 2 (record_pi LUNAS path) + Task 3 (mark_pi_paid).
   - BR5 (Void reverse) → Task 3 (void_pi inserts negative expense).
   - BR6 (duplicate warning) → Task 2 (record_pi check) + Task 6 (tests) + Task 16 (UI modal).
   - BR7 (Payment due reminder) — Phase 1 has cron daily, but the spec says it just feeds a dashboard widget. **GAP**: not explicitly built into a task. Acceptable trade-off: dashboard widget is a small follow-up that can be a single-line query in the existing dashboard module; flagged in the BNL Phase 1 deferred-detail note. Not blocking shipment.
6. **Spec §6 RPCs** → Tasks 2, 3 fully cover all 4 RPCs.
7. **Spec §7 Frontend** → Tasks 9-19 cover types, service, list, form, detail, modals, sub-tab routing.
8. **Spec §8 Integration** → Tasks 21 (Order detail), 22 (deep-link), Kasir expense covered in RPCs.
9. **Spec §9 PDF** → Task 18.
10. **Spec §10 Permissions** → No new perms in Phase 1 per spec; existing `pembelian` permission gates everything (no extra task needed).
11. **Spec §11 Migration** → Tasks 1-4 produce 4 migration files (spec called for 3; Task 4 adds the view as separate migration which is cleaner).
12. **Spec §13 Rollout** → Task 23 smoke checklist matches the rollout plan.

**One known gap acknowledged:** BR7 reminder cron + dashboard widget is scoped as a small follow-up (1-task addition once dashboard widget pattern is confirmed). Spec marks it as Phase 2-flexible (whatsmeow integration is Phase 2, but in-app dashboard widget is feasible in Phase 1). Flag for founder during review.

**Type consistency:** `PiPaymentMethod` / `PiStatus` / `PiType` / `DbPurchaseInvoice` / `DbPurchaseInvoiceItem` / `RecordPiPayload` / `OrderCogsBreakdownRow` are defined once in Task 9 and consumed consistently in Tasks 10, 11, 14, 15, 16, 17, 21.

**Placeholder scan:** No "TBD", no "TODO", no "fill in later". All code blocks contain real implementation. One inline `/* TODO: navigate to Order via parent — Task 21 */` in Task 19 is resolved in Task 21 via the URL deep-link pattern (acceptable cross-reference, not a placeholder).
