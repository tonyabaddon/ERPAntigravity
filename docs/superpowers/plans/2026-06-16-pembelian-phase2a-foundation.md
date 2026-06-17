# Pembelian Phase 2a (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor existing PO into Pesanan + Tagihan + Pembayaran 3-entity model. Migrate existing PO data big-bang. Ship CRUD pages + Beranda dashboard (KPI strip lite). Tukar Faktur (Phase 2b) and full AP Report (Phase 2c) out of scope here.

**Architecture:** New `pesanan` table is the PO refactor (DRAFT/ORDERED/CLOSED). Existing `purchase_invoices` extends with `pesanan_id` + `tukar_faktur_id` + `paid_amount` (BNL Phase 1 rows preserved with type='PASSTHROUGH'; new STOCK rows = Tagihan, require pesanan_id via CHECK constraint). New `pembayaran` + `pembayaran_items` junction supports consolidated + partial payment. All writes go through SECURITY DEFINER RPCs.

**Tech Stack:** Supabase (Postgres + RLS + Storage), TypeScript, React, Vite, Tailwind, lucide-react, vitest, existing apply-migration Go tool.

**Spec:** `docs/superpowers/specs/2026-06-16-pembelian-phase2-implementation-design.md`
**Worktree:** `.claude/worktrees/pembelian-phase2` on branch `feat/pembelian-phase2`
**Migration slot:** `20260620000XXX`

---

## File Map

**Backend (SQL migrations):**
- Create `supabase/migrations/20260620000001_phase2_pesanan_schema.sql`
- Create `supabase/migrations/20260620000002_phase2_pembayaran_schema.sql`
- Create `supabase/migrations/20260620000003_phase2_pi_extend.sql`
- Create `supabase/migrations/20260620000004_phase2_rpcs_pesanan.sql`
- Create `supabase/migrations/20260620000005_phase2_rpcs_tagihan_extend.sql`
- Create `supabase/migrations/20260620000006_phase2_rpcs_pembayaran.sql`
- Create `supabase/migrations/20260620000007_phase2_rpcs_smart_helpers.sql`
- Create `supabase/migrations/20260620000010_phase2_migrate_po_data.sql`

**Tests:**
- Create `tests/integration/pesanan-rpcs.test.ts`
- Create `tests/integration/tagihan-stock-rpcs.test.ts`
- Create `tests/integration/pembayaran-rpcs.test.ts`
- Create `tests/integration/po-migration.test.ts`

**Types & services:**
- Modify `src/types.ts` (append Pesanan + Pembayaran types)
- Create `src/lib/pesananService.ts`
- Create `src/lib/pembayaranService.ts`
- Modify `src/lib/purchaseInvoiceService.ts` (extend for type='STOCK')

**Frontend pages (new):**
- Create `src/components/pembelian/pesanan/PesananList.tsx`
- Create `src/components/pembelian/pesanan/PesananFormPage.tsx`
- Create `src/components/pembelian/pesanan/PesananDetailPage.tsx`
- Create `src/components/pembelian/tagihan/TagihanList.tsx`
- Create `src/components/pembelian/tagihan/TagihanFormPage.tsx`
- Create `src/components/pembelian/tagihan/TagihanDetailPage.tsx`
- Create `src/components/pembelian/pembayaran/PembayaranList.tsx`
- Create `src/components/pembelian/pembayaran/PembayaranFormPage.tsx`
- Create `src/components/pembelian/pembayaran/PembayaranDetailPage.tsx`
- Create `src/components/pembelian/beranda/BerandaPembelian.tsx` (lite)

**Frontend integration:**
- Modify `src/components/PembelianScreen.tsx` (replace orders tab with Pesanan/Tagihan/Pembayaran/Beranda)
- Modify `src/App.tsx` (deep-link `?pesanan=PSN-...`, `?tagihan=TGH-...`, `?pembayaran=PMB-...`)

**Docs:**
- Modify `progress.md`

---

## Task 1: Schema — `pesanan` + `pesanan_items`

**Files:** Create `supabase/migrations/20260620000001_phase2_pesanan_schema.sql`

- [ ] **Step 1:** Write migration with this exact content:

```sql
-- supabase/migrations/20260620000001_phase2_pesanan_schema.sql
-- Phase 2a foundation: new pesanan table (PO refactor). DRAFT/ORDERED/CLOSED lifecycle.
-- Existing purchase_orders untouched (will be split-migrated in 000010_migrate_po_data).

BEGIN;

CREATE TABLE public.pesanan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pesanan_number      text UNIQUE NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','ORDERED','CLOSED')),
  notes               text,
  ordered_at          timestamptz,
  expected_receive_at date,
  closed_at           timestamptz,
  tax_rate            numeric NOT NULL DEFAULT 0,
  tax_amount          numeric NOT NULL DEFAULT 0,
  subtotal            numeric NOT NULL DEFAULT 0,
  total               numeric NOT NULL DEFAULT 0,
  created_by_user_id  uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by_user_id   uuid REFERENCES auth.users(id),
  void_reason         text,
  CONSTRAINT pesanan_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pesanan_supplier_status_idx ON public.pesanan (supplier_id, status);
CREATE INDEX pesanan_status_ordered_idx ON public.pesanan (status, ordered_at DESC);
CREATE INDEX pesanan_list_idx ON public.pesanan (created_at DESC) WHERE voided_at IS NULL;

CREATE TABLE public.pesanan_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pesanan_id          uuid NOT NULL REFERENCES public.pesanan(id) ON DELETE CASCADE,
  sku                 varchar NOT NULL REFERENCES public.stocks(sku) ON DELETE RESTRICT,
  product_name        text NOT NULL,
  qty                 int NOT NULL CHECK (qty > 0),
  unit_cost           numeric NOT NULL CHECK (unit_cost >= 0),
  subtotal            numeric NOT NULL CHECK (subtotal >= 0),
  qty_received_total  int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pesanan_items_pesanan_idx ON public.pesanan_items (pesanan_id);
CREATE INDEX pesanan_items_sku_idx ON public.pesanan_items (sku);

CREATE TRIGGER trg_pesanan_updated_at
  BEFORE UPDATE ON public.pesanan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.pesanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pesanan_read ON public.pesanan FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pesanan_items_read ON public.pesanan_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pesanan_no_direct_write ON public.pesanan FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pesanan_items_no_direct_write ON public.pesanan_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
```

- [ ] **Step 2:** Commit only this file:

```bash
git add supabase/migrations/20260620000001_phase2_pesanan_schema.sql
git commit -m "feat(pembelian): pesanan + pesanan_items schema (Phase 2a Task 1)"
```

---

## Task 2: Schema — `pembayaran` + `pembayaran_items` junction

**Files:** Create `supabase/migrations/20260620000002_phase2_pembayaran_schema.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000002_phase2_pembayaran_schema.sql
-- Phase 2a foundation: pembayaran (payment) + junction items.
-- 1 Pembayaran : N pembayaran_items (each points to Tagihan XOR Tukar Faktur).
-- Supports partial payment (amount editable per item) + consolidated payment.

BEGIN;

CREATE TABLE public.pembayaran (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pembayaran_number   text UNIQUE NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  paid_at             timestamptz NOT NULL DEFAULT now(),
  payment_method      text NOT NULL CHECK (payment_method IN ('CASH','TRANSFER','CHEQUE','EDC')),
  account_id          uuid NULL,
  account_label       text,
  amount_total        numeric NOT NULL DEFAULT 0 CHECK (amount_total >= 0),
  discount_amount     numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  proof_url           text,
  status              text NOT NULL DEFAULT 'LUNAS'
                        CHECK (status IN ('LUNAS','VOIDED')),
  notes               text,
  created_by_user_id  uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by_user_id   uuid REFERENCES auth.users(id),
  void_reason         text,
  CONSTRAINT pembayaran_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pembayaran_supplier_paid_idx ON public.pembayaran (supplier_id, paid_at DESC);
CREATE INDEX pembayaran_status_idx ON public.pembayaran (status, paid_at DESC);

CREATE TABLE public.pembayaran_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pembayaran_id       uuid NOT NULL REFERENCES public.pembayaran(id) ON DELETE CASCADE,
  tagihan_id          uuid NULL REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
  tukar_faktur_id     uuid NULL,
  amount              numeric NOT NULL CHECK (amount > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pembayaran_items_xor
    CHECK ((tagihan_id IS NOT NULL) <> (tukar_faktur_id IS NOT NULL))
);

CREATE INDEX pembayaran_items_pembayaran_idx ON public.pembayaran_items (pembayaran_id);
CREATE INDEX pembayaran_items_tagihan_idx ON public.pembayaran_items (tagihan_id) WHERE tagihan_id IS NOT NULL;
CREATE INDEX pembayaran_items_tf_idx ON public.pembayaran_items (tukar_faktur_id) WHERE tukar_faktur_id IS NOT NULL;

CREATE TRIGGER trg_pembayaran_updated_at
  BEFORE UPDATE ON public.pembayaran
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.pembayaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembayaran_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pembayaran_read ON public.pembayaran FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pembayaran_items_read ON public.pembayaran_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pembayaran_no_direct_write ON public.pembayaran FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pembayaran_items_no_direct_write ON public.pembayaran_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000002_phase2_pembayaran_schema.sql
git commit -m "feat(pembelian): pembayaran + items junction schema (Phase 2a Task 2)"
```

---

## Task 3: Schema — extend `purchase_invoices` for Tagihan type='STOCK'

**Files:** Create `supabase/migrations/20260620000003_phase2_pi_extend.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000003_phase2_pi_extend.sql
-- Phase 2a foundation: extend purchase_invoices to support Tagihan type='STOCK'.
-- Adds pesanan_id (REQUIRED for STOCK), tukar_faktur_id (NULL until Phase 2b), paid_amount (partial payment tracking).
-- Adds DIBAYAR_SEBAGIAN status. Adds CHECK constraint enforcing STOCK requires pesanan_id, PASSTHROUGH requires order_id (mutually exclusive).

BEGIN;

ALTER TABLE public.purchase_invoices ADD COLUMN pesanan_id uuid NULL
  REFERENCES public.pesanan(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_invoices ADD COLUMN tukar_faktur_id uuid NULL;
ALTER TABLE public.purchase_invoices ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0
  CHECK (paid_amount >= 0);

ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS pi_status_check;
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_status_check
  CHECK (status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN','LUNAS'));

ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_type_linkage_check
  CHECK (
    (type = 'PASSTHROUGH' AND pesanan_id IS NULL AND order_id IS NOT NULL)
    OR
    (type = 'STOCK' AND pesanan_id IS NOT NULL AND order_id IS NULL)
  );

ALTER TABLE public.purchase_invoice_items ADD COLUMN pesanan_item_id uuid NULL
  REFERENCES public.pesanan_items(id) ON DELETE SET NULL;

CREATE INDEX pi_pesanan_idx ON public.purchase_invoices (pesanan_id) WHERE pesanan_id IS NOT NULL;
CREATE INDEX pi_tukar_faktur_idx ON public.purchase_invoices (tukar_faktur_id) WHERE tukar_faktur_id IS NOT NULL;
CREATE INDEX pi_items_pesanan_item_idx ON public.purchase_invoice_items (pesanan_item_id) WHERE pesanan_item_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000003_phase2_pi_extend.sql
git commit -m "feat(pembelian): extend purchase_invoices for Tagihan type=STOCK + paid_amount tracking (Phase 2a Task 3)"
```

---

## Task 4: RPCs — Pesanan lifecycle

**Files:** Create `supabase/migrations/20260620000004_phase2_rpcs_pesanan.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000004_phase2_rpcs_pesanan.sql
-- generate_pesanan_number, record_pesanan, mark_pesanan_ordered, update_pesanan, void_pesanan.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pesanan_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  year_month text;
  next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pesanan_number, '-', 4) AS int)), 0) + 1
  INTO next_seq
  FROM public.pesanan
  WHERE pesanan_number LIKE 'PSN-' || year_month || '-%';
  RETURN 'PSN-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pesanan(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan_number text;
  v_pesanan_id uuid;
  v_supplier_id uuid;
  v_initial_status text;
  v_subtotal numeric := 0;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_item jsonb;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_initial_status := COALESCE(payload->>'initial_status', 'DRAFT');
  v_tax_rate := COALESCE((payload->>'tax_rate')::numeric, 0);

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;
  IF v_initial_status NOT IN ('DRAFT','ORDERED') THEN
    RAISE EXCEPTION 'initial_status must be DRAFT or ORDERED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;
  v_tax_amount := v_subtotal * v_tax_rate;

  v_pesanan_number := public.generate_pesanan_number();

  INSERT INTO public.pesanan (
    pesanan_number, supplier_id, status, notes, ordered_at, expected_receive_at,
    tax_rate, tax_amount, subtotal, total, created_by_user_id
  ) VALUES (
    v_pesanan_number, v_supplier_id, v_initial_status,
    payload->>'notes',
    CASE WHEN v_initial_status = 'ORDERED' THEN now() ELSE NULL END,
    (payload->>'expected_receive_at')::date,
    v_tax_rate, v_tax_amount, v_subtotal, v_subtotal + v_tax_amount,
    auth.uid()
  ) RETURNING id INTO v_pesanan_id;

  INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal)
  SELECT v_pesanan_id, item->>'sku', item->>'product_name',
         (item->>'qty')::int, (item->>'unit_cost')::numeric,
         (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  RETURN jsonb_build_object('pesanan_number', v_pesanan_number, 'pesanan_id', v_pesanan_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pesanan_ordered(p_pesanan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only DRAFT can be marked ORDERED (current: %)', v_status;
  END IF;
  UPDATE public.pesanan SET status='ORDERED', ordered_at=now(), updated_at=now()
  WHERE id = p_pesanan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pesanan(p_pesanan_id uuid, payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan public.pesanan%ROWTYPE;
  v_subtotal numeric := 0;
  v_tax_rate numeric;
  v_item jsonb;
BEGIN
  SELECT * INTO v_pesanan FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_pesanan.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only DRAFT Pesanan can be edited (current: %)', v_pesanan.status;
  END IF;

  v_tax_rate := COALESCE((payload->>'tax_rate')::numeric, v_pesanan.tax_rate);
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  UPDATE public.pesanan SET
    supplier_id = COALESCE((payload->>'supplier_id')::uuid, supplier_id),
    notes = payload->>'notes',
    expected_receive_at = (payload->>'expected_receive_at')::date,
    tax_rate = v_tax_rate,
    tax_amount = v_subtotal * v_tax_rate,
    subtotal = v_subtotal,
    total = v_subtotal + (v_subtotal * v_tax_rate),
    updated_at = now()
  WHERE id = p_pesanan_id;

  DELETE FROM public.pesanan_items WHERE pesanan_id = p_pesanan_id;
  INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal)
  SELECT p_pesanan_id, item->>'sku', item->>'product_name',
         (item->>'qty')::int, (item->>'unit_cost')::numeric,
         (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pesanan(p_pesanan_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan public.pesanan%ROWTYPE;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pesanan FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_pesanan.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Pesanan already voided'; END IF;

  UPDATE public.pesanan SET
    voided_at = now(), voided_by_user_id = auth.uid(), void_reason = p_reason,
    updated_at = now()
  WHERE id = p_pesanan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pesanan_closed_if_fulfilled(p_pesanan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_all_fulfilled boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM public.pesanan_items
    WHERE pesanan_id = p_pesanan_id AND qty_received_total < qty
  ) INTO v_all_fulfilled;
  IF v_all_fulfilled THEN
    UPDATE public.pesanan SET status='CLOSED', closed_at=now(), updated_at=now()
    WHERE id = p_pesanan_id AND status='ORDERED';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pesanan_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pesanan(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pesanan_ordered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pesanan(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pesanan(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pesanan_closed_if_fulfilled(uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000004_phase2_rpcs_pesanan.sql
git commit -m "feat(pembelian): Pesanan RPCs — generate/record/mark_ordered/update/void/auto-close (Phase 2a Task 4)"
```

---

## Task 5: RPC — extend `record_pi` for type='STOCK' (with pesanan_id required)

**Files:** Create `supabase/migrations/20260620000005_phase2_rpcs_tagihan_extend.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000005_phase2_rpcs_tagihan_extend.sql
-- Extend record_pi to support type='STOCK' (Tagihan) with pesanan_id required,
-- auto stock_lots insert + stocks.stock increment. Existing type='PASSTHROUGH' (BNL) flow unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type text;
  v_pi_number text;
  v_pi_id uuid;
  v_supplier_id uuid;
  v_order_id uuid;
  v_pesanan_id uuid;
  v_supplier_invoice_number text;
  v_ignore_dup boolean;
  v_existing_pi text;
  v_initial_status text;
  v_payment_due_at date;
  v_paid_at timestamptz;
  v_subtotal numeric := 0;
  v_supplier_name text;
  v_ref_label text;
  v_item jsonb;
  v_pesanan_item_id uuid;
  v_sku varchar;
  v_qty int;
  v_unit_cost numeric;
  v_warehouse_id uuid;
BEGIN
  v_type := COALESCE(payload->>'type', 'PASSTHROUGH');
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_supplier_invoice_number := payload->>'supplier_invoice_number';
  v_ignore_dup := COALESCE((payload->>'ignore_duplicate_warning')::boolean, false);
  v_initial_status := COALESCE(payload->>'initial_status', 'BELUM_LUNAS');

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  IF v_type = 'PASSTHROUGH' THEN
    v_order_id := (payload->>'order_id')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'order_id required for PASSTHROUGH'; END IF;
  ELSIF v_type = 'STOCK' THEN
    v_pesanan_id := (payload->>'pesanan_id')::uuid;
    IF v_pesanan_id IS NULL THEN
      RAISE EXCEPTION 'pesanan_id required for type=STOCK. Buat Pesanan dulu, atau pakai Belanja Numpang Lewat untuk pass-through customer.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid type: %', v_type;
  END IF;

  IF v_supplier_invoice_number IS NOT NULL AND NOT v_ignore_dup THEN
    SELECT pi_number INTO v_existing_pi FROM public.purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND supplier_invoice_number = v_supplier_invoice_number
      AND voided_at IS NULL LIMIT 1;
    IF v_existing_pi IS NOT NULL THEN
      RETURN jsonb_build_object('warning','duplicate_supplier_invoice','existing_pi',v_existing_pi);
    END IF;
  END IF;

  v_pi_number := public.generate_pi_number();

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, pesanan_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, paid_amount, notes, created_by_user_id
  ) VALUES (
    v_pi_number, v_type, v_supplier_id, v_order_id, v_pesanan_id,
    COALESCE((payload->>'purchase_date')::date, CURRENT_DATE),
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, v_paid_at, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, v_initial_status,
    CASE WHEN v_initial_status = 'LUNAS' THEN v_subtotal ELSE 0 END,
    payload->>'notes', auth.uid()
  ) RETURNING id INTO v_pi_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::int;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_pesanan_item_id := NULLIF(v_item->>'pesanan_item_id','')::uuid;
    v_warehouse_id := NULLIF(v_item->>'warehouse_id','')::uuid;

    INSERT INTO public.purchase_invoice_items (
      pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id
    ) VALUES (
      v_pi_id, v_sku, v_item->>'product_name',
      v_qty, v_unit_cost, (v_item->>'sell_price')::numeric,
      v_qty * v_unit_cost, v_pesanan_item_id
    );

    IF v_type = 'STOCK' THEN
      INSERT INTO public.stock_lots (sku, source_id, source_type, unit_cost, qty, received_at, warehouse_id)
      VALUES (v_sku, v_pi_id, 'TAGIHAN', v_unit_cost, v_qty, now(), v_warehouse_id);

      IF v_warehouse_id IS NOT NULL THEN
        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
        VALUES (v_sku, v_warehouse_id, v_qty)
        ON CONFLICT (sku, warehouse_id) DO UPDATE
          SET qty = stock_levels.qty + EXCLUDED.qty;
      END IF;

      IF v_pesanan_item_id IS NOT NULL THEN
        UPDATE public.pesanan_items SET qty_received_total = qty_received_total + v_qty
        WHERE id = v_pesanan_item_id;
      END IF;
    END IF;
  END LOOP;

  IF v_type = 'STOCK' AND v_pesanan_id IS NOT NULL THEN
    PERFORM public.set_pesanan_closed_if_fulfilled(v_pesanan_id);
  END IF;

  IF v_initial_status = 'LUNAS' THEN
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    v_ref_label := CASE v_type
      WHEN 'STOCK' THEN 'utk Pesanan ' || (SELECT pesanan_number FROM public.pesanan WHERE id = v_pesanan_id)
      ELSE 'utk Order ' || COALESCE(v_order_id::text,'')
    END;
    INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
    VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      CASE v_type WHEN 'STOCK' THEN 'Pembelian Stok' ELSE 'Pembelian Pass-Through' END,
      'TGH ' || v_pi_number || ' — ' || COALESCE(v_supplier_name,'') || ' — ' || v_ref_label,
      v_subtotal, 0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000005_phase2_rpcs_tagihan_extend.sql
git commit -m "feat(pembelian): extend record_pi for Tagihan type=STOCK with pesanan_id required + stock_lots insert (Phase 2a Task 5)"
```

---

## Task 6: RPCs — Pembayaran lifecycle

**Files:** Create `supabase/migrations/20260620000006_phase2_rpcs_pembayaran.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000006_phase2_rpcs_pembayaran.sql
-- generate_pembayaran_number, record_pembayaran (atomic: insert + update Tagihan paid_amount + status + Kasir expense), void_pembayaran (reverse).

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pembayaran_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE year_month text; next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pembayaran_number, '-', 4) AS int)), 0) + 1
  INTO next_seq FROM public.pembayaran
  WHERE pembayaran_number LIKE 'PMB-' || year_month || '-%';
  RETURN 'PMB-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public._recompute_tagihan_status(p_tagihan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total numeric; v_paid numeric;
BEGIN
  SELECT total INTO v_total FROM public.purchase_invoices WHERE id = p_tagihan_id;
  SELECT COALESCE(SUM(pi_t.amount), 0) INTO v_paid
  FROM public.pembayaran_items pi_t
  JOIN public.pembayaran p ON p.id = pi_t.pembayaran_id
  WHERE pi_t.tagihan_id = p_tagihan_id AND p.status <> 'VOIDED';

  UPDATE public.purchase_invoices SET
    paid_amount = v_paid,
    status = CASE
      WHEN v_paid <= 0 THEN 'BELUM_LUNAS'
      WHEN v_paid < v_total THEN 'DIBAYAR_SEBAGIAN'
      ELSE 'LUNAS'
    END,
    paid_at = CASE WHEN v_paid >= v_total THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_tagihan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pembayaran(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_number text;
  v_id uuid;
  v_supplier_id uuid;
  v_amount_total numeric := 0;
  v_item jsonb;
  v_tagihan_id uuid;
  v_tagihan_total numeric;
  v_tagihan_paid numeric;
  v_supplier_name text;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_amount_total := v_amount_total + (v_item->>'amount')::numeric;
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      SELECT total, paid_amount INTO v_tagihan_total, v_tagihan_paid
      FROM public.purchase_invoices WHERE id = v_tagihan_id FOR UPDATE;
      IF v_tagihan_paid + (v_item->>'amount')::numeric > v_tagihan_total + 0.01 THEN
        RAISE EXCEPTION 'Tagihan % overpayment (current paid % + new % > total %)',
          v_tagihan_id, v_tagihan_paid, (v_item->>'amount')::numeric, v_tagihan_total;
      END IF;
    END IF;
  END LOOP;

  v_number := public.generate_pembayaran_number();
  INSERT INTO public.pembayaran (
    pembayaran_number, supplier_id, paid_at, payment_method,
    account_id, account_label, amount_total, discount_amount, proof_url, notes, created_by_user_id
  ) VALUES (
    v_number, v_supplier_id,
    COALESCE((payload->>'paid_at')::timestamptz, now()),
    payload->>'payment_method',
    NULLIF(payload->>'account_id','')::uuid,
    payload->>'account_label',
    v_amount_total,
    COALESCE((payload->>'discount_amount')::numeric, 0),
    payload->>'proof_url',
    payload->>'notes',
    auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
  SELECT v_id,
    NULLIF(item->>'tagihan_id','')::uuid,
    NULLIF(item->>'tukar_faktur_id','')::uuid,
    (item->>'amount')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      PERFORM public._recompute_tagihan_status(v_tagihan_id);
    END IF;
  END LOOP;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
  INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
  VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Stok',
    'Pembayaran ' || v_number || ' — ' || COALESCE(v_supplier_name,''),
    v_amount_total - COALESCE((payload->>'discount_amount')::numeric, 0),
    0
  );

  RETURN jsonb_build_object('pembayaran_number', v_number, 'pembayaran_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pembayaran(p_pembayaran_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pembayaran public.pembayaran%ROWTYPE;
  v_item record;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pembayaran FROM public.pembayaran WHERE id = p_pembayaran_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran not found'; END IF;
  IF v_pembayaran.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Already voided'; END IF;

  UPDATE public.pembayaran SET
    status='VOIDED', voided_at=now(), voided_by_user_id=auth.uid(), void_reason=p_reason,
    updated_at=now()
  WHERE id = p_pembayaran_id;

  FOR v_item IN SELECT tagihan_id FROM public.pembayaran_items
                WHERE pembayaran_id = p_pembayaran_id AND tagihan_id IS NOT NULL LOOP
    PERFORM public._recompute_tagihan_status(v_item.tagihan_id);
  END LOOP;

  INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
  VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Stok',
    'VOID Pembayaran ' || v_pembayaran.pembayaran_number || ' — ' || p_reason,
    -(v_pembayaran.amount_total - v_pembayaran.discount_amount),
    0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pembayaran_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pembayaran(uuid, text) TO authenticated;

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000006_phase2_rpcs_pembayaran.sql
git commit -m "feat(pembelian): Pembayaran RPCs — record + void with auto Tagihan status recompute + Kasir expense (Phase 2a Task 6)"
```

---

## Task 7: RPC — `pembayaran_suggest_outstanding` + lite AP dashboard

**Files:** Create `supabase/migrations/20260620000007_phase2_rpcs_smart_helpers.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000007_phase2_rpcs_smart_helpers.sql
-- pembayaran_suggest_outstanding: returns outstanding Tagihan for given supplier.
-- ap_dashboard_lite: KPI totals + per-supplier outstanding (no aging/cash-flow yet — those are Phase 2c).

BEGIN;

CREATE OR REPLACE FUNCTION public.pembayaran_suggest_outstanding(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tagihan', COALESCE(jsonb_agg(t ORDER BY t->>'payment_due_at'), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'pi_number', pi_number,
      'total', total,
      'paid_amount', paid_amount,
      'outstanding', total - paid_amount,
      'payment_due_at', payment_due_at,
      'supplier_invoice_number', supplier_invoice_number
    ) AS t
    FROM public.purchase_invoices
    WHERE supplier_id = p_supplier_id
      AND status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN')
      AND voided_at IS NULL
      AND tukar_faktur_id IS NULL
  ) sub;
  RETURN COALESCE(v_result, jsonb_build_object('tagihan','[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.ap_dashboard_lite() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_total_outstanding numeric;
  v_due_this_month numeric;
  v_next_7d numeric;
  v_overdue_count int;
  v_overdue_amount numeric;
  v_per_supplier jsonb;
BEGIN
  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_total_outstanding
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_due_this_month
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND payment_due_at >= date_trunc('month', v_today)::date
    AND payment_due_at < (date_trunc('month', v_today) + interval '1 month')::date;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_next_7d
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND payment_due_at BETWEEN v_today AND v_today + 7;

  SELECT COUNT(*), COALESCE(SUM(total - paid_amount), 0)
  INTO v_overdue_count, v_overdue_amount
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND payment_due_at < v_today;

  SELECT jsonb_agg(s ORDER BY (s->>'outstanding')::numeric DESC) INTO v_per_supplier
  FROM (
    SELECT jsonb_build_object(
      'supplier_id', s.id,
      'supplier_name', s.name,
      'outstanding', COALESCE(SUM(pi.total - pi.paid_amount), 0),
      'tagihan_count', COUNT(pi.id),
      'due_soonest', MIN(pi.payment_due_at)
    ) AS s
    FROM public.suppliers s
    JOIN public.purchase_invoices pi ON pi.supplier_id = s.id
    WHERE pi.status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND pi.voided_at IS NULL
    GROUP BY s.id, s.name
  ) sub;

  RETURN jsonb_build_object(
    'kpi', jsonb_build_object(
      'total_outstanding', v_total_outstanding,
      'due_this_month', v_due_this_month,
      'next_7_days', v_next_7d,
      'overdue', jsonb_build_object('amount', v_overdue_amount, 'count', v_overdue_count)
    ),
    'per_supplier', COALESCE(v_per_supplier, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pembayaran_suggest_outstanding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ap_dashboard_lite() TO authenticated;

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000007_phase2_rpcs_smart_helpers.sql
git commit -m "feat(pembelian): smart helpers — suggest_outstanding + ap_dashboard_lite KPI strip (Phase 2a Task 7)"
```

---

## Task 8: Migration — big-bang split existing PO data

**Files:** Create `supabase/migrations/20260620000010_phase2_migrate_po_data.sql`

- [ ] **Step 1:** Write migration:

```sql
-- supabase/migrations/20260620000010_phase2_migrate_po_data.sql
-- Big-bang split: existing purchase_orders → pesanan + tagihan (purchase_invoices STOCK) + pembayaran.
-- Atomic. Idempotent guard: skip if pesanan already populated.

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.pesanan LIMIT 1) THEN
    RAISE NOTICE 'pesanan already populated — skipping PO migration';
    RETURN;
  END IF;
END $$;

WITH po_with_seq AS (
  SELECT id, po_number, supplier_id, status, notes, ordered_at, received_at, payment_due_at, paid_at,
         invoice_url, payment_proof_url, tax_rate, tax_amount, subtotal, total, created_at,
         'PSN-' || to_char(created_at, 'YYYY-MM') || '-' ||
         LPAD(row_number() OVER (PARTITION BY to_char(created_at,'YYYY-MM') ORDER BY created_at, id)::text, 3, '0') AS new_psn
  FROM public.purchase_orders
),
ins_pesanan AS (
  INSERT INTO public.pesanan (
    id, pesanan_number, supplier_id, status, notes, ordered_at, closed_at,
    tax_rate, tax_amount, subtotal, total, created_at
  )
  SELECT
    id, new_psn, supplier_id,
    CASE status
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'ORDERED' THEN 'ORDERED'
      WHEN 'RECEIVED' THEN 'CLOSED'
      WHEN 'PAID' THEN 'CLOSED'
      ELSE 'DRAFT'
    END,
    notes, ordered_at,
    CASE WHEN status IN ('RECEIVED','PAID') THEN received_at ELSE NULL END,
    tax_rate, tax_amount, subtotal, total, created_at
  FROM po_with_seq
  RETURNING id, pesanan_number
)
SELECT 1;

INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal, qty_received_total)
SELECT
  poi.po_id, poi.sku, poi.product_name, poi.qty, poi.unit_cost, poi.subtotal,
  CASE WHEN po.status IN ('RECEIVED','PAID') THEN poi.qty ELSE 0 END
FROM public.purchase_order_items poi
JOIN public.purchase_orders po ON po.id = poi.po_id;

WITH po_received AS (
  SELECT po.*, 'TGH-' || to_char(po.received_at, 'YYYY-MM') || '-' ||
         LPAD(row_number() OVER (PARTITION BY to_char(po.received_at,'YYYY-MM') ORDER BY po.received_at, po.id)::text, 3, '0') AS new_tgh
  FROM public.purchase_orders po
  WHERE po.status IN ('RECEIVED','PAID') AND po.received_at IS NOT NULL
),
ins_tagihan AS (
  INSERT INTO public.purchase_invoices (
    id, pi_number, type, supplier_id, pesanan_id, purchase_date,
    supplier_invoice_photo_url, payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, paid_amount, created_at
  )
  SELECT
    gen_random_uuid(), new_tgh, 'STOCK', supplier_id, id, received_at::date,
    invoice_url, 'TRANSFER', payment_due_at, paid_at, payment_proof_url,
    subtotal, total,
    CASE status WHEN 'RECEIVED' THEN 'BELUM_LUNAS' WHEN 'PAID' THEN 'LUNAS' END,
    CASE status WHEN 'PAID' THEN total ELSE 0 END,
    received_at
  FROM po_received
  RETURNING id, pi_number, pesanan_id, supplier_id, paid_at, total, status
)
INSERT INTO public.purchase_invoice_items (pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id)
SELECT
  it.id, poi.sku, poi.product_name, poi.qty, poi.unit_cost,
  0, poi.subtotal, poi.id
FROM ins_tagihan it
JOIN public.purchase_order_items poi ON poi.po_id = it.pesanan_id;

WITH po_paid AS (
  SELECT po.id AS po_id, po.supplier_id, po.paid_at, po.total, po.payment_proof_url,
         'PMB-' || to_char(po.paid_at, 'YYYY-MM') || '-' ||
         LPAD(row_number() OVER (PARTITION BY to_char(po.paid_at,'YYYY-MM') ORDER BY po.paid_at, po.id)::text, 3, '0') AS new_pmb
  FROM public.purchase_orders po
  WHERE po.status = 'PAID' AND po.paid_at IS NOT NULL
),
ins_pembayaran AS (
  INSERT INTO public.pembayaran (
    pembayaran_number, supplier_id, paid_at, payment_method, amount_total, proof_url, status, created_at
  )
  SELECT new_pmb, supplier_id, paid_at, 'TRANSFER', total, payment_proof_url, 'LUNAS', paid_at
  FROM po_paid
  RETURNING id, pembayaran_number, supplier_id, paid_at, amount_total
)
INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, amount)
SELECT pmb.id, pi.id, pi.total
FROM ins_pembayaran pmb
JOIN public.purchase_invoices pi ON pi.supplier_id = pmb.supplier_id AND pi.paid_at = pmb.paid_at AND pi.type = 'STOCK';

COMMIT;
```

- [ ] **Step 2:** Commit:

```bash
git add supabase/migrations/20260620000010_phase2_migrate_po_data.sql
git commit -m "feat(pembelian): big-bang split PO data → Pesanan + Tagihan + Pembayaran (Phase 2a Task 8)"
```

---

## Task 9: Integration tests — Pesanan RPCs

**Files:** Create `tests/integration/pesanan-rpcs.test.ts`

- [ ] **Step 1:** Write test file:

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string;
let sku: string;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('record_pesanan', () => {
  test('creates DRAFT Pesanan with PSN-YYYY-MM-NNN number', async () => {
    const { data, error } = await sb.rpc('record_pesanan', {
      payload: {
        supplier_id: supplierId,
        initial_status: 'DRAFT',
        items: [{ sku, product_name: 'Test', qty: 10, unit_cost: 1000 }],
      },
    });
    expect(error).toBeNull();
    expect((data as any).pesanan_number).toMatch(/^PSN-\d{4}-\d{2}-\d{3}$/);
  });

  test('creates ORDERED Pesanan with ordered_at set', async () => {
    const { data, error } = await sb.rpc('record_pesanan', {
      payload: {
        supplier_id: supplierId,
        initial_status: 'ORDERED',
        items: [{ sku, product_name: 'Test', qty: 5, unit_cost: 2000 }],
      },
    });
    expect(error).toBeNull();
    const { data: row } = await sb.from('pesanan').select('status, ordered_at').eq('id', (data as any).pesanan_id).single();
    expect(row!.status).toBe('ORDERED');
    expect(row!.ordered_at).not.toBeNull();
  });

  test('rejects missing supplier_id', async () => {
    const { error } = await sb.rpc('record_pesanan', {
      payload: { initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    expect(error).not.toBeNull();
  });

  test('rejects empty items', async () => {
    const { error } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [] },
    });
    expect(error).not.toBeNull();
  });
});

describe('mark_pesanan_ordered', () => {
  test('DRAFT → ORDERED', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('mark_pesanan_ordered', { p_pesanan_id: (data as any).pesanan_id });
    expect(error).toBeNull();
    const { data: row } = await sb.from('pesanan').select('status').eq('id', (data as any).pesanan_id).single();
    expect(row!.status).toBe('ORDERED');
  });

  test('rejects ORDERED (not DRAFT)', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('mark_pesanan_ordered', { p_pesanan_id: (data as any).pesanan_id });
    expect(error).not.toBeNull();
  });
});

describe('void_pesanan', () => {
  test('rejects reason < 10 chars', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('void_pesanan', { p_pesanan_id: (data as any).pesanan_id, p_reason: 'short' });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2:** Commit:

```bash
git add tests/integration/pesanan-rpcs.test.ts
git commit -m "test(pembelian): Pesanan RPC integration tests (Phase 2a Task 9)"
```

---

## Task 10: Integration tests — Tagihan type=STOCK + Pembayaran

**Files:** Create `tests/integration/tagihan-stock-rpcs.test.ts` + `tests/integration/pembayaran-rpcs.test.ts`

- [ ] **Step 1:** `tagihan-stock-rpcs.test.ts`:

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, sku: string, pesananId: string, pesananItemId: string;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
  const { data: psn } = await sb.rpc('record_pesanan', {
    payload: { supplier_id: supplierId, initial_status: 'ORDERED',
      items: [{ sku, product_name: 'X', qty: 100, unit_cost: 1000 }] },
  });
  pesananId = (psn as any).pesanan_id;
  const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', pesananId);
  pesananItemId = items![0].id;
});

describe('record_pi type=STOCK', () => {
  test('creates Tagihan STOCK with pesanan_id and increments stock', async () => {
    const { data: before } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    const { data, error } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: pesananId,
        payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 60, unit_cost: 1000, sell_price: 0, pesanan_item_id: pesananItemId }] },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
    const { data: after } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    expect(after!.stock).toBeGreaterThan(before!.stock);
  });

  test('rejects STOCK without pesanan_id', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 0 }] },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/pesanan_id required for type=STOCK/);
  });

  test('updates pesanan_items.qty_received_total via trigger', async () => {
    const { data } = await sb.from('pesanan_items').select('qty_received_total').eq('id', pesananItemId).single();
    expect(data!.qty_received_total).toBeGreaterThanOrEqual(60);
  });
});
```

- [ ] **Step 2:** `pembayaran-rpcs.test.ts`:

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, tagihanId: string, tagihanTotal: number;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  const sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
  const { data: psn } = await sb.rpc('record_pesanan', {
    payload: { supplier_id: supplierId, initial_status: 'ORDERED',
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 10000 }] },
  });
  const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', (psn as any).pesanan_id);
  const { data: tgh } = await sb.rpc('record_pi', {
    payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: (psn as any).pesanan_id,
      payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 10000, sell_price: 0, pesanan_item_id: items![0].id }] },
  });
  tagihanId = (tgh as any).pi_id;
  tagihanTotal = 10000;
});

describe('record_pembayaran', () => {
  test('full payment → Tagihan status LUNAS', async () => {
    const { data, error } = await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'TRANSFER',
        items: [{ tagihan_id: tagihanId, amount: tagihanTotal }] },
    });
    expect(error).toBeNull();
    expect((data as any).pembayaran_number).toMatch(/^PMB-\d{4}-\d{2}-\d{3}$/);
    const { data: t } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', tagihanId).single();
    expect(t!.status).toBe('LUNAS');
    expect(Number(t!.paid_amount)).toBe(tagihanTotal);
  });

  test('partial payment → DIBAYAR_SEBAGIAN', async () => {
    const sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
    const { data: psn } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 5000 }] },
    });
    const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', (psn as any).pesanan_id);
    const { data: tgh } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: (psn as any).pesanan_id,
        payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 5000, sell_price: 0, pesanan_item_id: items![0].id }] },
    });
    await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'CASH',
        items: [{ tagihan_id: (tgh as any).pi_id, amount: 2000 }] },
    });
    const { data: t } = await sb.from('purchase_invoices').select('status').eq('id', (tgh as any).pi_id).single();
    expect(t!.status).toBe('DIBAYAR_SEBAGIAN');
  });

  test('rejects overpayment', async () => {
    const { error } = await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'CASH',
        items: [{ tagihan_id: tagihanId, amount: 999999 }] },
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3:** Commit both:

```bash
git add tests/integration/tagihan-stock-rpcs.test.ts tests/integration/pembayaran-rpcs.test.ts
git commit -m "test(pembelian): Tagihan STOCK + Pembayaran integration tests (Phase 2a Task 10)"
```

---

## Task 11: TypeScript types

**Files:** Modify `src/types.ts` (append to end)

- [ ] **Step 1:** Append:

```typescript
// ── Phase 2: Pesanan + Pembayaran ──
export type PesananStatus = 'DRAFT' | 'ORDERED' | 'CLOSED';
export type TagihanStatus = 'BELUM_LUNAS' | 'DIBAYAR_SEBAGIAN' | 'LUNAS';
export type PembayaranStatus = 'LUNAS' | 'VOIDED';

export interface DbPesananItem {
  id: string;
  pesanan_id: string;
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  subtotal: number;
  qty_received_total: number;
  created_at: string;
}

export interface DbPesanan {
  id: string;
  pesanan_number: string;
  supplier_id: string;
  status: PesananStatus;
  notes: string | null;
  ordered_at: string | null;
  expected_receive_at: string | null;
  closed_at: string | null;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  supplier?: DbSupplier;
  items?: DbPesananItem[];
}

export interface PesananItemDraft {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
}

export interface RecordPesananPayload {
  supplier_id: string;
  initial_status: 'DRAFT' | 'ORDERED';
  notes?: string;
  expected_receive_at?: string;
  tax_rate?: number;
  items: PesananItemDraft[];
}

export interface DbPembayaranItem {
  id: string;
  pembayaran_id: string;
  tagihan_id: string | null;
  tukar_faktur_id: string | null;
  amount: number;
  created_at: string;
}

export interface DbPembayaran {
  id: string;
  pembayaran_number: string;
  supplier_id: string;
  paid_at: string;
  payment_method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'EDC';
  account_id: string | null;
  account_label: string | null;
  amount_total: number;
  discount_amount: number;
  proof_url: string | null;
  status: PembayaranStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  void_reason: string | null;
  supplier?: DbSupplier;
  items?: DbPembayaranItem[];
}

export interface PembayaranItemDraft {
  tagihan_id?: string;
  tukar_faktur_id?: string;
  amount: number;
}

export interface RecordPembayaranPayload {
  supplier_id: string;
  paid_at?: string;
  payment_method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'EDC';
  account_id?: string;
  account_label?: string;
  discount_amount?: number;
  proof_url?: string;
  notes?: string;
  items: PembayaranItemDraft[];
}

export interface SuggestOutstandingTagihanRow {
  id: string;
  pi_number: string;
  total: number;
  paid_amount: number;
  outstanding: number;
  payment_due_at: string | null;
  supplier_invoice_number: string | null;
}

export interface ApDashboardLite {
  kpi: {
    total_outstanding: number;
    due_this_month: number;
    next_7_days: number;
    overdue: { amount: number; count: number };
  };
  per_supplier: Array<{
    supplier_id: string;
    supplier_name: string;
    outstanding: number;
    tagihan_count: number;
    due_soonest: string | null;
  }>;
}
```

- [ ] **Step 2:** Commit:

```bash
npx tsc --noEmit
git add src/types.ts
git commit -m "types(pembelian): Phase 2a — Pesanan + Pembayaran + lite dashboard (Phase 2a Task 11)"
```

---

## Task 12: Service — `pesananService.ts`

**Files:** Create `src/lib/pesananService.ts`

- [ ] **Step 1:** Write:

```typescript
import { supabase } from './supabaseClient';
import type { DbPesanan, RecordPesananPayload } from '../types';

export const pesananService = {
  async fetchAll(filter: { from?: string; to?: string; status?: string } = {}): Promise<DbPesanan[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase.from('pesanan')
      .select('*, suppliers(*), pesanan_items(*)')
      .order('created_at', { ascending: false });
    if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
    if (filter.from) q = q.gte('created_at', filter.from);
    if (filter.to) q = q.lte('created_at', filter.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ ...r, supplier: r.suppliers, items: r.pesanan_items ?? [] }));
  },
  async fetchByNumber(num: string): Promise<DbPesanan | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('pesanan')
      .select('*, suppliers(*), pesanan_items(*)')
      .eq('pesanan_number', num).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...(data as any), supplier: (data as any).suppliers, items: (data as any).pesanan_items ?? [] };
  },
  async record(payload: RecordPesananPayload): Promise<{ pesanan_number: string; pesanan_id: string }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pesanan', { payload });
    if (error) throw error;
    return data as any;
  },
  async markOrdered(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('mark_pesanan_ordered', { p_pesanan_id: id });
    if (error) throw error;
  },
  async update(id: string, payload: Omit<RecordPesananPayload,'initial_status'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_pesanan', { p_pesanan_id: id, payload });
    if (error) throw error;
  },
  async void(id: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pesanan', { p_pesanan_id: id, p_reason: reason });
    if (error) throw error;
  },
};
```

- [ ] **Step 2:** Commit:

```bash
npx tsc --noEmit
git add src/lib/pesananService.ts
git commit -m "feat(pembelian): pesananService — CRUD + lifecycle wrappers (Phase 2a Task 12)"
```

---

## Task 13: Service — `pembayaranService.ts`

**Files:** Create `src/lib/pembayaranService.ts`

- [ ] **Step 1:** Write:

```typescript
import { supabase } from './supabaseClient';
import type { DbPembayaran, RecordPembayaranPayload, SuggestOutstandingTagihanRow, ApDashboardLite } from '../types';

export const pembayaranService = {
  async fetchAll(filter: { supplierId?: string; status?: string } = {}): Promise<DbPembayaran[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase.from('pembayaran')
      .select('*, suppliers(*), pembayaran_items(*)')
      .order('paid_at', { ascending: false });
    if (filter.supplierId) q = q.eq('supplier_id', filter.supplierId);
    if (filter.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ ...r, supplier: r.suppliers, items: r.pembayaran_items ?? [] }));
  },
  async fetchByNumber(num: string): Promise<DbPembayaran | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('pembayaran')
      .select('*, suppliers(*), pembayaran_items(*)')
      .eq('pembayaran_number', num).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...(data as any), supplier: (data as any).suppliers, items: (data as any).pembayaran_items ?? [] };
  },
  async record(payload: RecordPembayaranPayload): Promise<{ pembayaran_number: string; pembayaran_id: string }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pembayaran', { payload });
    if (error) throw error;
    return data as any;
  },
  async void(id: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pembayaran', { p_pembayaran_id: id, p_reason: reason });
    if (error) throw error;
  },
  async suggestOutstanding(supplierId: string): Promise<SuggestOutstandingTagihanRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('pembayaran_suggest_outstanding', { p_supplier_id: supplierId });
    if (error) throw error;
    return (data as any)?.tagihan ?? [];
  },
  async fetchDashboardLite(): Promise<ApDashboardLite> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('ap_dashboard_lite');
    if (error) throw error;
    return data as ApDashboardLite;
  },
};
```

- [ ] **Step 2:** Commit:

```bash
npx tsc --noEmit
git add src/lib/pembayaranService.ts
git commit -m "feat(pembelian): pembayaranService + smart-helper wrappers (Phase 2a Task 13)"
```

---

## Task 14: Frontend — `PesananList` + `PesananFormPage` + `PesananDetailPage`

**Files:** Create 3 files under `src/components/pembelian/pesanan/`

- [ ] **Step 1:** Create `PesananList.tsx` — list with KPI strip + status filter + table. (Mirror existing `PembelianScreen` orders table pattern: rows with `pesanan_number`, supplier, item count, total, status badge, actions.)

```tsx
import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { pesananService } from '../../../lib/pesananService';
import type { DbPesanan, PesananStatus } from '../../../types';

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string|null) => s ? new Date(s).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';

interface Props {
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onCreate: () => void;
  onOpenDetail: (psn: string) => void;
}

const STATUS_BADGE: Record<PesananStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ORDERED: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800',
};

export default function PesananList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbPesanan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL'|PesananStatus>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try { setList(await pesananService.fetchAll()); }
    catch (e: any) { showToast(e?.message ?? 'Gagal load Pesanan', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const filtered = list.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (search && !p.pesanan_number.toLowerCase().includes(search.toLowerCase()) && !p.supplier?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: '#012749' }}>Pesanan (Purchase Order)</h2>
          <div className="text-xs text-gray-500">Step 1: pesan ke supplier sebelum barang datang</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg" style={{ background:'#012749' }}>
          <Plus className="w-4 h-4" /> Buat Pesanan
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-44" placeholder="Cari PSN / supplier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="ALL">Semua status</option>
          <option value="DRAFT">Draft</option>
          <option value="ORDERED">Ordered</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
         : filtered.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Belum ada Pesanan.</div>
         : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Pesanan</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Items</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 border-b border-gray-100">
                  <td className="px-5 py-4">
                    <div className="font-bold text-sm" style={{ color:'#012749' }}>{p.pesanan_number}</div>
                    <div className="text-xs text-gray-500">{fmtDate(p.created_at)}</div>
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold">{p.supplier?.name ?? '—'}</td>
                  <td className="px-5 py-4 text-center text-sm">{p.items?.length ?? 0}</td>
                  <td className="px-5 py-4 text-right text-sm font-bold">{fmtRp(p.total)}</td>
                  <td className="px-5 py-4 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => onOpenDetail(p.pesanan_number)} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">Detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Create `PesananFormPage.tsx` — supplier picker (reuse from BNL), items table with `SkuPickerWithInlineCreate` (reuse), tax field, status DRAFT/ORDERED radio, Simpan/Simpan & Kirim button. (Mirror BNL form pattern, simpler — no payment section since payment is on Tagihan.)

Refer to existing `src/components/pembelian/bnl/BelanjaNumpangLewatFormPage.tsx` for pattern. Replace pieces:
- Drop Order picker → not needed for Pesanan
- Drop payment section → not needed for Pesanan
- Add expected_receive_at date input
- Action buttons: Batal / Simpan Draft / Simpan & Kirim ke Supplier (sets initial_status='ORDERED')

- [ ] **Step 3:** Create `PesananDetailPage.tsx` — header with status badge + actions (Mark Ordered if DRAFT, Edit if DRAFT, Void if not CLOSED, Buat Tagihan if ORDERED), info cards (supplier + dates + total), items table with qty_received_total progress bars.

Actions on ORDERED: "Buat Tagihan" button → opens Tagihan form pre-filled with this Pesanan.

- [ ] **Step 4:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/components/pembelian/pesanan/
git commit -m "feat(pembelian): Pesanan list + form + detail pages (Phase 2a Task 14)"
```

---

## Task 15: Frontend — Tagihan pages (List + Form + Detail)

**Files:** Create 3 files under `src/components/pembelian/tagihan/`

- [ ] **Step 1:** `TagihanList.tsx` — similar shape to PesananList but reads `purchase_invoices` filtered by `type='STOCK'`. Use existing `purchaseInvoiceService.fetchAll({ type: 'STOCK' })`. Show columns: TGH-number, Supplier, Pesanan link, Total, Paid/Outstanding, Status, JT, Aksi (Bayar shortcut, Detail).

- [ ] **Step 2:** `TagihanFormPage.tsx` — receive-goods form. Required: Pesanan picker (from Pesanan that are ORDERED). Pre-fill items from Pesanan with `qty Dipesan / Diterima / Rusak / Warehouse`. Payment section: method + due date + status (Bayar Sekarang / Bayar Nanti). Reuse BNL form patterns.

Key behavior: when Pesanan picked, fetch its items via `pesananService.fetchByNumber`, populate items array with `qty: 0` (operator enters Diterima), preserve `pesanan_item_id` per row for trigger to update `qty_received_total`.

- [ ] **Step 3:** `TagihanDetailPage.tsx` — same shape as BNL detail but with Pesanan link card + paid_amount progress bar.

- [ ] **Step 4:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/components/pembelian/tagihan/
git commit -m "feat(pembelian): Tagihan list + form + detail (type=STOCK) — receive flow from Pesanan (Phase 2a Task 15)"
```

---

## Task 16: Frontend — Pembayaran pages

**Files:** Create 3 files under `src/components/pembelian/pembayaran/`

- [ ] **Step 1:** `PembayaranList.tsx` — list of Pembayaran rows. Columns: PMB-number, Supplier, Tanggal, Method, Amount, Status, Aksi.

- [ ] **Step 2:** `PembayaranFormPage.tsx` — consolidated payment form. Sections: (1) Supplier picker, (2) outstanding Tagihan picker via `pembayaranService.suggestOutstanding`, with per-row amount editable for partial, (3) Payment method + account_label + discount + proof upload, (4) running total.

Smart-suggestion buttons: "Pilih semua outstanding" / "Pilih yang JT minggu ini". Validation: sum amounts > 0, each amount ≤ Tagihan outstanding.

- [ ] **Step 3:** `PembayaranDetailPage.tsx` — read-only detail with covered Tagihan list, void action.

- [ ] **Step 4:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/components/pembelian/pembayaran/
git commit -m "feat(pembelian): Pembayaran list + form + detail — consolidated + partial payment support (Phase 2a Task 16)"
```

---

## Task 17: Frontend — `BerandaPembelian` (lite)

**Files:** Create `src/components/pembelian/beranda/BerandaPembelian.tsx`

- [ ] **Step 1:** Write component that calls `pembayaranService.fetchDashboardLite()` on mount and renders:
- 4-card KPI strip (Total Outstanding / JT Bulan Ini / 7 Hari ke Depan / Terlambat)
- Per-supplier table with "Bayar" action (navigates to Pembayaran form pre-filled with supplier_id)

No aging chart / cash flow forecast (Phase 2c). Refresh on tab refocus.

- [ ] **Step 2:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/components/pembelian/beranda/
git commit -m "feat(pembelian): BerandaPembelian lite — KPI strip + per-supplier outstanding (Phase 2a Task 17)"
```

---

## Task 18: PembelianScreen menu refactor

**Files:** Modify `src/components/PembelianScreen.tsx`

- [ ] **Step 1:** Add new sub-tabs `'beranda' | 'pesanan' | 'tagihan' | 'pembayaran'` between existing `'orders' | 'bnl' | 'suppliers'`. Replace old `'orders'` rendering with new Pesanan view (and old `OrdersTab` deprecated — can be removed once migration verified). Add view-mode types for each: pesanan-list/create/edit/detail, tagihan-list/create/edit/detail, pembayaran-list/create/detail.

Default tab on mount: `'beranda'`.

Tabs order: Beranda | Pesanan | Tagihan | Belanja Numpang Lewat | Pembayaran | Supplier.

- [ ] **Step 2:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): PembelianScreen menu refactor — Beranda/Pesanan/Tagihan/Pembayaran sub-tabs (Phase 2a Task 18)"
```

---

## Task 19: App.tsx deep-link routing

**Files:** Modify `src/App.tsx`

- [ ] **Step 1:** Parse new query params: `pesanan`, `tagihan`, `pembayaran`. Pass to PembelianScreen as `initialPesananNumber`, `initialTagihanNumber`, `initialPembayaranNumber`. Mirror existing `initialDetailPoNumber` + `initialBnlPiNumber` pattern.

- [ ] **Step 2:** Type-check + commit:

```bash
npx tsc --noEmit
git add src/App.tsx
git commit -m "feat(pembelian): App.tsx deep-link routing for ?pesanan/?tagihan/?pembayaran (Phase 2a Task 19)"
```

---

## Task 20: Smoke test + progress.md

- [ ] **Step 1:** Apply all 8 Phase 2a migrations to staging Supabase via:

```bash
export SUPABASE_DB_CONNECTION="$(grep '^SUPABASE_DB_CONNECTION=' backend-go/.env | sed 's/^SUPABASE_DB_CONNECTION=//')"
for m in 20260620000001_phase2_pesanan_schema.sql \
         20260620000002_phase2_pembayaran_schema.sql \
         20260620000003_phase2_pi_extend.sql \
         20260620000004_phase2_rpcs_pesanan.sql \
         20260620000005_phase2_rpcs_tagihan_extend.sql \
         20260620000006_phase2_rpcs_pembayaran.sql \
         20260620000007_phase2_rpcs_smart_helpers.sql \
         20260620000010_phase2_migrate_po_data.sql; do
  /tmp/apply-migration "supabase/migrations/$m"
done
```

- [ ] **Step 2:** Run integration tests:

```bash
npx vitest run tests/integration/pesanan-rpcs.test.ts tests/integration/tagihan-stock-rpcs.test.ts tests/integration/pembayaran-rpcs.test.ts
```

Expected: all PASS.

- [ ] **Step 3:** Manual browser smoke (Pembelian → Beranda → see KPI; → Pesanan → buat DRAFT → mark ordered → buat Tagihan from it → verify stocks.stock increment → record Pembayaran → verify status LUNAS).

- [ ] **Step 4:** Append to `progress.md`:

```markdown
## 2026-06-XX — Pembelian Phase 2a (Foundation) — IMPLEMENTATION COMPLETE
- 8 SQL migrations applied (Pesanan/Pembayaran schemas + RPCs + PI extension + big-bang PO split)
- 3 integration test files passing
- Frontend: Pesanan/Tagihan/Pembayaran/Beranda pages + PembelianScreen refactor + deep-link routing
- Migration verified: existing PO data successfully split (X Pesanan, Y Tagihan, Z Pembayaran)
- Branch: feat/pembelian-phase2
- Next: Phase 2b (Tukar Faktur) once Phase 2a stable for 1 week
```

- [ ] **Step 5:** Final commit:

```bash
git add progress.md
git commit -m "docs(progress): Phase 2a foundation complete"
```

---

## Self-Review

**Spec coverage check:**
- §3 Entity model + mandatory PO-first flow → Tasks 1-3 schema, Task 5 RPC validation
- §4.1 pesanan schema → Task 1 ✓
- §4.2 purchase_invoices extension → Task 3 ✓
- §4.4 pembayaran schema → Task 2 ✓
- §5.1 Pesanan RPCs → Task 4 ✓
- §5.2 Tagihan extend → Task 5 ✓
- §5.4 Pembayaran RPCs → Task 6 ✓
- §5.5 smart helpers → Task 7 ✓
- §6 migration big-bang → Task 8 ✓
- §7 frontend file structure → Tasks 12-19 ✓
- §11 BR1/BR2/BR4/BR5/BR7 → enforced via RPC + CHECK constraints

**Out of 2a scope (covered by Phase 2b/2c plans):** Tukar Faktur entity + reconciliation panel + AP Aging chart + cash flow forecast.

**Type consistency:** `PesananStatus`/`TagihanStatus`/`PembayaranStatus` enums defined Task 11 and reused throughout. `DbPesanan`/`DbPembayaran` shape stable.

**Placeholder scan:** Tasks 14/15/16 have partial code skeletons because the page-level components share patterns with existing Phase 1 BNL files — implementer should mirror those patterns rather than receiving full verbose code here (reduces plan size and matches established codebase conventions).
