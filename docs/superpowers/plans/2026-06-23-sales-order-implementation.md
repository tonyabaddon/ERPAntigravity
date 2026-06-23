# Sales Order (Penawaran) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sales Order (Penawaran) flow alongside existing Sales Invoice — pre-commit quote ke customer, no stock movement, no payment method. Customer accept → convert ke Sales Invoice via wizard pre-filled.

**Architecture:** New `sales_orders` table + 3 RPCs + new `DaftarPenawaranScreen` + extend existing `CatatPenjualanWizard` dengan `mode='quote'|'invoice'` prop. Conversion 2-step: pre-fill via `fromSalesOrderId` URL param, then `markSalesOrderConverted` after SI saved. Bonus: `+ Produk Baru` inline form di Step 2 (shared SO + SI). New `quotation` variant di `SalesInvoicePDF`.

**Tech Stack:** React + TypeScript (Vite); Vitest only (no RTL/jsdom); Tailwind v4 (CDN dev, theme in src/index.css); Supabase Postgres + RLS + Realtime; PostgREST RPC via supabase-js. Migration naming `YYYYMMDDHHmmss_*.sql`.

## Global Constraints

- **Spec source:** `docs/superpowers/specs/2026-06-23-sales-order-design.md` — all locked decisions in §1 (Goal & Non-goals), wording in §11, permissions in §12.
- **Mockup:** `docs/superpowers/mockups/2026-06-23-sales-order-design.html` — 7 frames.
- **SO does NOT touch stock.** No `decrement_stock` / `deduct_stock_fifo` calls. No `stock_movements` rows. Items[] stored as-is including hpp snapshot.
- **Wizard default mode is `'invoice'`.** `'quote'` is opt-in via URL `?mode=quote` or component prop.
- **Conversion is 2-step:** `?fromSo=<id>` pre-fills wizard → after SI save success, call `markSalesOrderConverted(soId, kasirTxId | orderId)`. Never modify SO via the SI save RPC.
- **No auto-expire.** Manual close via `closeSalesOrder(soId, reason)` only.
- **Reuse `permissions.kasir` flag.** No new permission keys. Same flag gates SO create, SI create, lite-product create, view Daftar Penawaran.
- **Items[] shape identical to `kasir_transactions.items`:** `{sku, name, qty, unit_price, hpp_per_unit, subtotal, hpp_subtotal, warehouse_id}`. `sku` nullable for jasa lump-sum.
- **TEMPO conversion** → `markSalesOrderConverted` uses `p_target_order_id` (FK to `orders`). LUNAS/DP/WIP → `p_target_kasir_tx_id` (FK to `kasir_transactions`). Exactly one non-null.
- **`quotation` variant in `SalesInvoicePDF`** — adds to existing `'dp' | 'lunas'` union. Renders PENAWARAN stamp, hides ongkir/alamat/payment sections.
- **Wording rename is user-facing strings only.** File names, route names (`?screen=penjualanBaru`), TypeScript type keys (`jasa_rakit`), and component names (`CatatPenjualanWizard.tsx`) unchanged.
- **New product lite-create** stocks INSERT defaults: `stock_atas=0`, `stock_bawah=0`, `status='aktif'`, `specs={}`, `photo_urls=[]`, `initial_stock_approved=true`. Required from form: name + category + price. Recommended: harga_modal + unit.
- **Migration slot range:** `20260725000001-005` (claimed past current `20260724*` head).
- **Channel CHECK constraint:** `orders_sales_channel_check` was expanded to 14 channels in PR #45 (`20260630000008`). `sales_orders` uses same `validate_sales_channel()` function, so no separate CHECK.

---

## Pre-flight: Branch Setup

- [ ] **Step 1: Create feature branch from origin/main**

```bash
git fetch origin
git checkout -b feat/sales-order-penawaran origin/main
git log --oneline -3
```

Expected: HEAD at `40f44fa docs(diskon): Task 1 progress log` or later.

- [ ] **Step 2: Verify clean workspace**

```bash
git status -s
```

Expected: empty (or only untracked files outside `src/`, `supabase/`, `docs/`).

- [ ] **Step 3: Confirm tests pass on baseline**

```bash
npm test --silent -- --run 2>&1 | tail -3
npx tsc --noEmit
```

Expected: all tests pass, no TS errors.

---

## Phase A — Backend (5 migrations + SQL smoke per task)

### Task 1: Create `sales_orders` table + `sales_order_counters` sequence table

**Files:**
- Create: `supabase/migrations/20260725000001_sales_orders_table.sql`

**Interfaces:**
- Consumes: existing `customers(id)`, `kasir_transactions(id)`, `orders(id)`, `auth.users(id)` FK targets.
- Produces: `public.sales_orders` table + `public.sales_order_counters` table + RLS policies. Schema columns + types listed in spec §3.1 and §3.2.

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260725000001_sales_orders_table.sql`:

```sql
-- Sales Order (Penawaran) — pre-commit quote document.
-- No stock movement, no payment fields. Convert path tracks FK to
-- either kasir_transactions (LUNAS/DP/WIP) or orders (TEMPO) — never both.

CREATE TABLE public.sales_orders (
  id                          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  so_number                   text NOT NULL UNIQUE,
  date                        date NOT NULL DEFAULT CURRENT_DATE,
  channel                     text NOT NULL,
  items                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal                    numeric NOT NULL,
  customer_id                 text REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name               text NOT NULL,
  customer_phone              text,
  customer_company            text,
  notes                       text,
  status                      text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CONVERTED','CLOSED')),
  converted_to_kasir_tx_id    text REFERENCES public.kasir_transactions(id) ON DELETE SET NULL,
  converted_to_order_id       text REFERENCES public.orders(id) ON DELETE SET NULL,
  closed_reason               text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_orders_converted_fk_check CHECK (
    status <> 'CONVERTED'
    OR converted_to_kasir_tx_id IS NOT NULL
    OR converted_to_order_id IS NOT NULL
  ),
  CONSTRAINT sales_orders_converted_fk_xor CHECK (
    converted_to_kasir_tx_id IS NULL
    OR converted_to_order_id IS NULL
  )
);

CREATE INDEX idx_sales_orders_status_date ON public.sales_orders (status, date DESC);
CREATE INDEX idx_sales_orders_customer_id ON public.sales_orders (customer_id);
CREATE INDEX idx_sales_orders_so_number   ON public.sales_orders (so_number);

CREATE TABLE public.sales_order_counters (
  channel  text NOT NULL,
  date     date NOT NULL,
  counter  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, date)
);

-- RLS: read all (operator dashboard), write only via SECURITY DEFINER RPCs
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_orders_select_authenticated
  ON public.sales_orders FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies — RPCs use SECURITY DEFINER.

CREATE POLICY sales_order_counters_select_authenticated
  ON public.sales_order_counters FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.sales_orders IS
  'Sales Order (Penawaran) — pre-commit quote ke customer. No stock movement, no payment. Convert ke Sales Invoice via mark_sales_order_converted RPC.';

COMMENT ON COLUMN public.sales_orders.items IS
  'JSONB array mirroring kasir_transactions.items shape. sku nullable for jasa lump-sum.';
```

- [ ] **Step 2: Apply migration to remote**

Use Supabase MCP `apply_migration` tool with `name=sales_orders_table` and the SQL from Step 1.

Expected: `{"success":true}`.

- [ ] **Step 3: Verify schema landed**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sales_orders'
ORDER BY ordinal_position;
```

Expected rows: `id`, `so_number`, `date`, `channel`, `items`, `subtotal`, `customer_id`, `customer_name`, `customer_phone`, `customer_company`, `notes`, `status`, `converted_to_kasir_tx_id`, `converted_to_order_id`, `closed_reason`, `created_at`, `created_by`.

- [ ] **Step 4: Verify CHECK constraints**

Run via Supabase MCP `execute_sql`:

```sql
SELECT conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
WHERE t.relname='sales_orders' AND contype='c';
```

Expected: 3 CHECK constraints — `sales_orders_status_check` (OPEN/CONVERTED/CLOSED), `sales_orders_converted_fk_check`, `sales_orders_converted_fk_xor`.

- [ ] **Step 5: Smoke-test CHECK constraints**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
BEGIN
  -- 1. Cannot have status=CONVERTED with both FK null
  BEGIN
    INSERT INTO public.sales_orders
      (so_number, channel, items, subtotal, customer_name, status)
    VALUES
      ('SMOKE-1', 'walkin', '[]', 0, 'Smoke', 'CONVERTED');
    RAISE EXCEPTION 'Expected CHECK failure but row inserted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: CONVERTED without FK rejected';
  END;

  -- 2. Cannot have both FKs set
  BEGIN
    INSERT INTO public.sales_orders
      (so_number, channel, items, subtotal, customer_name, status,
       converted_to_kasir_tx_id, converted_to_order_id)
    VALUES
      ('SMOKE-2', 'walkin', '[]', 0, 'Smoke', 'OPEN', 'k1', 'o1');
    RAISE EXCEPTION 'Expected CHECK failure but row inserted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: both FKs rejected';
  END;

  -- 3. OPEN with both FK null is OK
  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status)
  VALUES
    ('SMOKE-3', 'walkin', '[]', 0, 'Smoke', 'OPEN');
  RAISE NOTICE 'PASS: OPEN inserted';

  -- Rollback all smoke data
  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke test complete — all assertions passed';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: NOTICE messages confirming all 3 assertions PASS, then "Smoke test complete".

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260725000001_sales_orders_table.sql
git commit -m "feat(sales-order): sales_orders + sales_order_counters tables + RLS

Pre-commit quote document. No stock movement, no payment fields.
Convert target tracked via converted_to_kasir_tx_id (LUNAS/DP/WIP) OR
converted_to_order_id (TEMPO) — XOR enforced by CHECK constraint.
Status CHECK: OPEN/CONVERTED/CLOSED.

RLS: SELECT for authenticated; writes via SECURITY DEFINER RPCs only."
```

---

### Task 2: `next_sales_order_number` helper RPC

**Files:**
- Create: `supabase/migrations/20260725000002_next_sales_order_number.sql`

**Interfaces:**
- Consumes: `public.sales_order_counters(channel, date, counter)` from Task 1.
- Produces: `public.next_sales_order_number(p_channel text, p_date date) RETURNS int` — atomic INSERT…ON CONFLICT UPDATE returning new counter.

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260725000002_next_sales_order_number.sql`:

```sql
-- Atomic per-(channel, date) sequence for SO numbering.
-- Mirror of next_kasir_number pattern. Used by create_sales_order.

CREATE OR REPLACE FUNCTION public.next_sales_order_number(
  p_channel text,
  p_date    date
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_counter int;
BEGIN
  INSERT INTO public.sales_order_counters (channel, date, counter)
  VALUES (p_channel, p_date, 1)
  ON CONFLICT (channel, date)
    DO UPDATE SET counter = sales_order_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_sales_order_number(text, date) TO anon, authenticated;
```

- [ ] **Step 2: Apply migration to remote**

Use Supabase MCP `apply_migration` with `name=next_sales_order_number` and the SQL.

Expected: `{"success":true}`.

- [ ] **Step 3: Smoke-test counter increments**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE
  v1 int; v2 int; v3 int;
BEGIN
  v1 := public.next_sales_order_number('walkin', '2099-01-01');
  v2 := public.next_sales_order_number('walkin', '2099-01-01');
  v3 := public.next_sales_order_number('grosir', '2099-01-01');

  ASSERT v1 = 1, format('Expected 1, got %s', v1);
  ASSERT v2 = 2, format('Expected 2, got %s', v2);
  ASSERT v3 = 1, format('Expected 1 for separate channel, got %s', v3);

  RAISE NOTICE 'PASS: counters incremented correctly';

  -- Rollback test data
  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke test complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: "PASS: counters incremented correctly".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260725000002_next_sales_order_number.sql
git commit -m "feat(sales-order): next_sales_order_number helper RPC

Atomic per-(channel, date) counter mirroring next_kasir_number pattern.
Used by create_sales_order to reserve SO number before row insert."
```

---

### Task 3: `create_sales_order` RPC

**Files:**
- Create: `supabase/migrations/20260725000003_create_sales_order_rpc.sql`

**Interfaces:**
- Consumes: `next_sales_order_number(p_channel, p_date)` from Task 2; `validate_sales_channel(p_channel)` (existing); `customers(id, wa_number, name, company)` (existing).
- Produces: `public.create_sales_order(p_payload jsonb) RETURNS public.sales_orders` — returns full inserted row.

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260725000003_create_sales_order_rpc.sql`:

```sql
-- Create a Sales Order (Penawaran). No stock movement.
-- Find-or-create customer pattern mirrors record_kasir_sale.

CREATE OR REPLACE FUNCTION public.create_sales_order(p_payload jsonb)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so             public.sales_orders%ROWTYPE;
  v_channel        text;
  v_date           date;
  v_items          jsonb;
  v_subtotal       numeric;
  v_customer_id    text;
  v_customer_name  text;
  v_customer_phone text;
  v_customer_company text;
  v_notes          text;
  v_counter        int;
  v_prefix         text;
  v_so_number      text;
  v_actor          uuid;
BEGIN
  v_actor   := auth.uid();
  v_channel := COALESCE(p_payload->>'channel', '');
  v_date    := COALESCE((p_payload->>'date')::date, CURRENT_DATE);
  v_items   := COALESCE(p_payload->'items', '[]'::jsonb);
  v_subtotal := COALESCE((p_payload->>'subtotal')::numeric, 0);
  v_customer_id      := NULLIF(p_payload->>'customer_id', '');
  v_customer_name    := COALESCE(p_payload->>'customer_name', '');
  v_customer_phone   := NULLIF(p_payload->>'customer_phone', '');
  v_customer_company := NULLIF(p_payload->>'customer_company', '');
  v_notes            := NULLIF(p_payload->>'notes', '');

  PERFORM public.validate_sales_channel(v_channel);
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'p_items must contain at least one line';
  END IF;
  IF length(btrim(v_customer_name)) = 0 THEN
    RAISE EXCEPTION 'customer_name is required';
  END IF;

  -- Find-or-create customer (mirror record_kasir_sale lines 73-93)
  IF v_customer_id IS NULL
     AND v_customer_phone IS NOT NULL AND length(btrim(v_customer_phone)) > 0 THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE wa_number = btrim(v_customer_phone)
    LIMIT 1;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO public.customers (id, wa_number, name, company)
      VALUES (
        v_customer_id,
        btrim(v_customer_phone),
        btrim(v_customer_name),
        COALESCE(btrim(v_customer_company), '')
      )
      ON CONFLICT (wa_number) DO UPDATE
        SET name = EXCLUDED.name
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  -- Reserve SO number
  v_counter := public.next_sales_order_number(v_channel, v_date);
  v_prefix := CASE v_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;
  v_so_number := 'SO-' || v_prefix
    || '-' || to_char(v_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  INSERT INTO public.sales_orders (
    so_number, date, channel, items, subtotal,
    customer_id, customer_name, customer_phone, customer_company,
    notes, status, created_by
  ) VALUES (
    v_so_number, v_date, v_channel, v_items, v_subtotal,
    v_customer_id, v_customer_name, v_customer_phone, v_customer_company,
    v_notes, 'OPEN', v_actor
  )
  RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sales_order(jsonb) TO anon, authenticated;
```

- [ ] **Step 2: Apply migration to remote**

Use Supabase MCP `apply_migration` with `name=create_sales_order_rpc` and the SQL.

Expected: `{"success":true}`.

- [ ] **Step 3: Smoke-test happy path**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE
  v_so public.sales_orders;
  v_payload jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  v_payload := jsonb_build_object(
    'channel', 'walkin',
    'date', '2099-12-01',
    'items', jsonb_build_array(jsonb_build_object(
      'sku', 'TEST-SKU', 'name', 'Test Item', 'qty', 2,
      'unit_price', 50000, 'hpp_per_unit', 30000,
      'subtotal', 100000, 'hpp_subtotal', 60000,
      'warehouse_id', NULL
    )),
    'subtotal', 100000,
    'customer_name', 'Smoke Customer',
    'customer_phone', '081999000111'
  );

  v_so := public.create_sales_order(v_payload);

  ASSERT v_so.status = 'OPEN', 'Expected OPEN status';
  ASSERT v_so.so_number LIKE 'SO-WLK-20991201-%', format('Bad number: %s', v_so.so_number);
  ASSERT v_so.subtotal = 100000, 'Bad subtotal';
  ASSERT v_so.customer_id IS NOT NULL, 'Customer should be linked';

  RAISE NOTICE 'PASS: SO created %', v_so.so_number;

  -- Verify NO stock_movements created
  DECLARE v_count int;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM public.stock_movements
      WHERE related_doc_id = v_so.so_number;
    ASSERT v_count = 0, 'SO must not create stock_movements';
  END;
  RAISE NOTICE 'PASS: no stock_movements';

  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke test complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: PASS messages + "Smoke test complete".

- [ ] **Step 4: Smoke-test invalid channel rejection**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  BEGIN
    PERFORM public.create_sales_order(jsonb_build_object(
      'channel', 'badchannel',
      'items', jsonb_build_array(jsonb_build_object('sku','x','qty',1)),
      'subtotal', 1, 'customer_name', 'x'));
    RAISE EXCEPTION 'Expected rejection but RPC succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%channel%' OR SQLERRM LIKE '%validate%' THEN
      RAISE NOTICE 'PASS: invalid channel rejected (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
```

Expected: "PASS: invalid channel rejected".

- [ ] **Step 5: Smoke-test empty items rejection**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  BEGIN
    PERFORM public.create_sales_order(jsonb_build_object(
      'channel', 'walkin', 'items', '[]'::jsonb,
      'subtotal', 0, 'customer_name', 'x'));
    RAISE EXCEPTION 'Expected rejection but RPC succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%at least one line%' THEN
      RAISE NOTICE 'PASS: empty items rejected';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
```

Expected: "PASS: empty items rejected".

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260725000003_create_sales_order_rpc.sql
git commit -m "feat(sales-order): create_sales_order RPC — no stock movement

Validates channel + non-empty items + customer name. Find-or-create
customer (same pattern as record_kasir_sale). Reserves SO number via
next_sales_order_number. Inserts row with status=OPEN, created_by=auth.uid.

Smoke tests verify: happy path inserts row with no stock_movements,
invalid channel rejected, empty items rejected."
```

---

### Task 4: `mark_sales_order_converted` RPC

**Files:**
- Create: `supabase/migrations/20260725000004_mark_sales_order_converted_rpc.sql`

**Interfaces:**
- Consumes: `public.sales_orders` (Task 1); `kasir_transactions(id)`, `orders(id)` (existing — both `uuid` typed).
- Produces: `public.mark_sales_order_converted(p_so_id text, p_target_kasir_tx_id uuid, p_target_order_id uuid) RETURNS public.sales_orders` — exactly one target FK must be non-null; raises if SO not OPEN.

**NOTE — type correction from T1:** The brief originally specified `text` for the FK columns, but live DB schema confirmed `kasir_transactions.id` and `orders.id` are both `uuid`. T1 implementer adjusted the migration accordingly. T4 RPC param types must be `uuid` to match. The SQL in Step 1 below uses `text` — implementer must change to `uuid` (and update all `text` references for these params throughout the migration body).

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260725000004_mark_sales_order_converted_rpc.sql`:

```sql
-- Mark a Sales Order as CONVERTED — called after Sales Invoice saved.
-- Exactly one target FK must be non-null:
--   p_target_kasir_tx_id → kasir_transactions (LUNAS/DP/WIP path)
--   p_target_order_id    → orders (TEMPO path)

CREATE OR REPLACE FUNCTION public.mark_sales_order_converted(
  p_so_id              text,
  p_target_kasir_tx_id uuid DEFAULT NULL,
  p_target_order_id    uuid DEFAULT NULL
)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so public.sales_orders%ROWTYPE;
  v_exists boolean;
BEGIN
  IF (p_target_kasir_tx_id IS NULL AND p_target_order_id IS NULL)
     OR (p_target_kasir_tx_id IS NOT NULL AND p_target_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_target_kasir_tx_id or p_target_order_id must be non-null';
  END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales Order % not found', p_so_id;
  END IF;
  IF v_so.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Sales Order % status is %, expected OPEN', p_so_id, v_so.status;
  END IF;

  IF p_target_kasir_tx_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.kasir_transactions WHERE id = p_target_kasir_tx_id)
      INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'kasir_transactions row % not found', p_target_kasir_tx_id;
    END IF;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.orders WHERE id = p_target_order_id)
      INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'orders row % not found', p_target_order_id;
    END IF;
  END IF;

  UPDATE public.sales_orders
    SET status = 'CONVERTED',
        converted_to_kasir_tx_id = p_target_kasir_tx_id,
        converted_to_order_id = p_target_order_id
    WHERE id = p_so_id
    RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_sales_order_converted(text, uuid, uuid) TO anon, authenticated;
```

- [ ] **Step 2: Apply migration to remote**

Use Supabase MCP `apply_migration` with `name=mark_sales_order_converted_rpc` and the SQL.

Expected: `{"success":true}`.

- [ ] **Step 3: Smoke-test happy path (kasir_tx target)**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE
  v_so_id text;
  v_kt_id text;
  v_result public.sales_orders;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  -- Seed an OPEN SO
  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status)
  VALUES
    ('SMOKE-CONV-1', 'walkin', '[{"sku":"x","qty":1}]'::jsonb, 100, 'Smoke', 'OPEN')
  RETURNING id INTO v_so_id;

  -- Pick any existing kasir_transactions id
  SELECT id INTO v_kt_id FROM public.kasir_transactions LIMIT 1;
  IF v_kt_id IS NULL THEN
    RAISE NOTICE 'SKIP: no kasir_transactions row to target';
    RAISE EXCEPTION 'smoke complete — rollback';
  END IF;

  v_result := public.mark_sales_order_converted(v_so_id, v_kt_id, NULL);

  ASSERT v_result.status = 'CONVERTED', 'Expected CONVERTED';
  ASSERT v_result.converted_to_kasir_tx_id = v_kt_id, 'FK not set';
  ASSERT v_result.converted_to_order_id IS NULL, 'Order FK should be null';
  RAISE NOTICE 'PASS: kasir_tx target conversion';

  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: "PASS: kasir_tx target conversion".

- [ ] **Step 4: Smoke-test reject already-CONVERTED**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE
  v_so_id text;
  v_kt_id text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  SELECT id INTO v_kt_id FROM public.kasir_transactions LIMIT 1;
  IF v_kt_id IS NULL THEN
    RAISE EXCEPTION 'smoke complete — rollback';
  END IF;

  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status,
     converted_to_kasir_tx_id)
  VALUES
    ('SMOKE-CONV-2', 'walkin', '[{"sku":"x","qty":1}]'::jsonb, 100, 'Smoke',
     'CONVERTED', v_kt_id)
  RETURNING id INTO v_so_id;

  BEGIN
    PERFORM public.mark_sales_order_converted(v_so_id, v_kt_id, NULL);
    RAISE EXCEPTION 'Expected rejection but succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%expected OPEN%' THEN
      RAISE NOTICE 'PASS: already-CONVERTED rejected';
    ELSE
      RAISE;
    END IF;
  END;

  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: "PASS: already-CONVERTED rejected".

- [ ] **Step 5: Smoke-test reject both-FKs-null**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE v_so_id text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status)
  VALUES
    ('SMOKE-CONV-3', 'walkin', '[{"sku":"x","qty":1}]'::jsonb, 100, 'Smoke', 'OPEN')
  RETURNING id INTO v_so_id;

  BEGIN
    PERFORM public.mark_sales_order_converted(v_so_id, NULL, NULL);
    RAISE EXCEPTION 'Expected rejection but succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Exactly one%' THEN
      RAISE NOTICE 'PASS: both-null rejected';
    ELSE
      RAISE;
    END IF;
  END;

  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: "PASS: both-null rejected".

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260725000004_mark_sales_order_converted_rpc.sql
git commit -m "feat(sales-order): mark_sales_order_converted RPC

Called after Sales Invoice saved. Exactly one of p_target_kasir_tx_id
(LUNAS/DP/WIP) or p_target_order_id (TEMPO) must be non-null. Raises if
SO not OPEN, target row missing, or both/neither FK passed.

Smoke tests verify: happy path kasir_tx target, already-CONVERTED rejected,
both-null rejected."
```

---

### Task 5: `close_sales_order` RPC

**Files:**
- Create: `supabase/migrations/20260725000005_close_sales_order_rpc.sql`

**Interfaces:**
- Consumes: `public.sales_orders` (Task 1).
- Produces: `public.close_sales_order(p_so_id text, p_reason text) RETURNS public.sales_orders` — flips OPEN → CLOSED with reason.

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260725000005_close_sales_order_rpc.sql`:

```sql
-- Manually close a Sales Order (lost deal, stale, customer ghosted).
-- Terminal state — closed SO cannot be reopened or converted.

CREATE OR REPLACE FUNCTION public.close_sales_order(
  p_so_id  text,
  p_reason text
)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so public.sales_orders%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Close reason is required';
  END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales Order % not found', p_so_id;
  END IF;
  IF v_so.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Sales Order % status is %, expected OPEN', p_so_id, v_so.status;
  END IF;

  UPDATE public.sales_orders
    SET status = 'CLOSED', closed_reason = btrim(p_reason)
    WHERE id = p_so_id
    RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_sales_order(text, text) TO anon, authenticated;
```

- [ ] **Step 2: Apply migration to remote**

Use Supabase MCP `apply_migration` with `name=close_sales_order_rpc` and the SQL.

Expected: `{"success":true}`.

- [ ] **Step 3: Smoke-test happy path + edge cases**

Run via Supabase MCP `execute_sql`:

```sql
DO $$
DECLARE
  v_so_id text;
  v_result public.sales_orders;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users LIMIT 1), true);

  -- Happy path
  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status)
  VALUES
    ('SMOKE-CLOSE-1', 'walkin', '[{"sku":"x","qty":1}]'::jsonb, 100, 'Smoke', 'OPEN')
  RETURNING id INTO v_so_id;

  v_result := public.close_sales_order(v_so_id, 'Lost deal: harga tidak match');

  ASSERT v_result.status = 'CLOSED', 'Expected CLOSED';
  ASSERT v_result.closed_reason = 'Lost deal: harga tidak match', 'Bad reason';
  RAISE NOTICE 'PASS: SO closed';

  -- Empty reason rejected
  INSERT INTO public.sales_orders
    (so_number, channel, items, subtotal, customer_name, status)
  VALUES
    ('SMOKE-CLOSE-2', 'walkin', '[{"sku":"x","qty":1}]'::jsonb, 100, 'Smoke', 'OPEN')
  RETURNING id INTO v_so_id;

  BEGIN
    PERFORM public.close_sales_order(v_so_id, '');
    RAISE EXCEPTION 'Expected rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%reason is required%' THEN
      RAISE NOTICE 'PASS: empty reason rejected';
    ELSE
      RAISE;
    END IF;
  END;

  -- Already-CLOSED rejected
  BEGIN
    PERFORM public.close_sales_order(v_result.id, 'second attempt');
    RAISE EXCEPTION 'Expected rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%expected OPEN%' THEN
      RAISE NOTICE 'PASS: already-CLOSED rejected';
    ELSE
      RAISE;
    END IF;
  END;

  RAISE EXCEPTION 'smoke complete — rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'smoke complete — rollback' THEN
    RAISE NOTICE 'Smoke complete';
  ELSE
    RAISE;
  END IF;
END $$;
```

Expected: 3 PASS messages.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260725000005_close_sales_order_rpc.sql
git commit -m "feat(sales-order): close_sales_order RPC

Terminal CLOSED state with required reason. Rejects empty reason and
already-non-OPEN status. Smoke tests verify all paths."
```

---

## Phase B — Types + Wrappers

### Task 6: `types.ts` updates

**Files:**
- Modify: `src/types.ts` (3 locations: ActivePage union, InvoiceVariant union, new DbSalesOrder interface)

**Interfaces:**
- Consumes: existing `KasirItem`, `OrdersChannel`, `KasirChannel` types.
- Produces: `DbSalesOrder` interface; `ActivePage` += `'daftarPenawaran'`; `InvoiceVariant` already declared in SalesInvoicePDF (Task 14 extends it — leave that local).

- [ ] **Step 1: Locate ActivePage union and add `daftarPenawaran`**

Find current `ActivePage` definition:

```bash
grep -n "export type ActivePage" src/types.ts
```

Expected: shows the union definition line.

- [ ] **Step 2: Edit `src/types.ts` — extend `ActivePage`**

Locate the line ending with `| 'invoicePreview';` (current last entry per recent work) and add `'daftarPenawaran'` to the union:

```typescript
// BEFORE (current):
export type ActivePage = 'dashboard' | 'sales-inbox' | ... | 'invoicePreview';

// AFTER:
export type ActivePage = 'dashboard' | 'sales-inbox' | ... | 'invoicePreview' | 'daftarPenawaran';
```

- [ ] **Step 3: Add `DbSalesOrder` interface at end of file**

Append to `src/types.ts`:

```typescript
/**
 * Sales Order (Penawaran) — pre-commit quote to customer.
 * No stock movement, no payment fields. Items shape mirrors kasir_transactions.items.
 * Convert path: status='OPEN' → 'CONVERTED' (with either converted_to_kasir_tx_id
 * for LUNAS/DP/WIP, or converted_to_order_id for TEMPO; never both) OR
 * 'CLOSED' (manual, with closed_reason). Terminal once non-OPEN.
 */
export interface DbSalesOrder {
  id: string;
  so_number: string;
  date: string;                  // ISO date
  channel: string;               // OrdersChannel-compatible
  items: KasirItem[];            // sku nullable for jasa lump-sum
  subtotal: number;              // products + jasa, no ongkir
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  notes: string | null;
  status: 'OPEN' | 'CONVERTED' | 'CLOSED';
  converted_to_kasir_tx_id: string | null;
  converted_to_order_id: string | null;
  closed_reason: string | null;
  created_at: string;            // ISO timestamp
  created_by: string | null;     // uuid
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -5
```

Expected: empty output (no TS errors).

- [ ] **Step 5: Run vitest baseline (should still pass)**

```bash
npm test --silent -- --run 2>&1 | tail -3
```

Expected: same test count, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(sales-order): types.ts — DbSalesOrder + ActivePage daftarPenawaran

DbSalesOrder mirrors the sales_orders table schema. ActivePage union
extended for the new daftarPenawaran route (sidebar menu)."
```

---

### Task 7: `salesOrderService.ts` wrappers + vitest

**Files:**
- Create: `src/lib/salesOrderService.ts`
- Create: `src/lib/salesOrderService.test.ts`

**Interfaces:**
- Consumes: `supabase` client from `./supabaseClient`; `DbSalesOrder` from `../types`.
- Produces:
  - `createSalesOrder(payload: CreateSalesOrderInput): Promise<DbSalesOrder>`
  - `fetchSalesOrderById(soId: string): Promise<DbSalesOrder | null>`
  - `fetchSalesOrders(filter?: { status?: DbSalesOrder['status'] }): Promise<DbSalesOrder[]>`
  - `markSalesOrderConverted(soId: string, target: { kasirTxId?: string; orderId?: string }): Promise<DbSalesOrder>`
  - `closeSalesOrder(soId: string, reason: string): Promise<DbSalesOrder>`

Input shape:

```typescript
export interface CreateSalesOrderInput {
  channel: string;
  date?: string;            // default today
  items: KasirItem[];
  subtotal: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  notes: string | null;
}
```

- [ ] **Step 1: Write the failing vitest**

Create `src/lib/salesOrderService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabaseClient module before importing service
vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import {
  createSalesOrder,
  fetchSalesOrderById,
  fetchSalesOrders,
  markSalesOrderConverted,
  closeSalesOrder,
} from './salesOrderService';
import { supabase } from './supabaseClient';

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe('createSalesOrder', () => {
  it('calls create_sales_order RPC with payload jsonb', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1', so_number: 'SO-WLK-x' }, error: null });
    const result = await createSalesOrder({
      channel: 'walkin',
      items: [{ sku: 'x', name: 'X', qty: 1, unit_price: 100, hpp_per_unit: 50,
                subtotal: 100, hpp_subtotal: 50, warehouse_id: null, warehouse: null }],
      subtotal: 100,
      customer_id: null,
      customer_name: 'Test',
      customer_phone: '081',
      customer_company: null,
      notes: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('create_sales_order', expect.objectContaining({
      p_payload: expect.objectContaining({ channel: 'walkin', customer_name: 'Test' }),
    }));
    expect(result.id).toBe('so-1');
  });

  it('throws when RPC returns error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(createSalesOrder({
      channel: 'walkin', items: [], subtotal: 0,
      customer_id: null, customer_name: 'x',
      customer_phone: null, customer_company: null, notes: null,
    })).rejects.toThrow('boom');
  });
});

describe('markSalesOrderConverted', () => {
  it('calls RPC with kasir_tx_id when kasirTxId provided', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await markSalesOrderConverted('so-1', { kasirTxId: 'kt-9' });
    expect(rpcMock).toHaveBeenCalledWith('mark_sales_order_converted', {
      p_so_id: 'so-1',
      p_target_kasir_tx_id: 'kt-9',
      p_target_order_id: null,
    });
  });

  it('calls RPC with order_id when orderId provided', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await markSalesOrderConverted('so-1', { orderId: 'o-7' });
    expect(rpcMock).toHaveBeenCalledWith('mark_sales_order_converted', {
      p_so_id: 'so-1',
      p_target_kasir_tx_id: null,
      p_target_order_id: 'o-7',
    });
  });

  it('throws if neither target provided', async () => {
    await expect(markSalesOrderConverted('so-1', {}))
      .rejects.toThrow(/exactly one/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws if both targets provided', async () => {
    await expect(markSalesOrderConverted('so-1', { kasirTxId: 'kt', orderId: 'o' }))
      .rejects.toThrow(/exactly one/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('closeSalesOrder', () => {
  it('calls RPC with id + reason', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await closeSalesOrder('so-1', 'Lost deal');
    expect(rpcMock).toHaveBeenCalledWith('close_sales_order', {
      p_so_id: 'so-1',
      p_reason: 'Lost deal',
    });
  });

  it('throws on empty reason client-side', async () => {
    await expect(closeSalesOrder('so-1', '   ')).rejects.toThrow(/reason/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('fetchSalesOrderById', () => {
  it('returns null when not found', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await fetchSalesOrderById('missing');
    expect(result).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('sales_orders');
    expect(eqMock).toHaveBeenCalledWith('id', 'missing');
  });

  it('returns the row when found', async () => {
    const so = { id: 'so-1', so_number: 'SO-X' };
    const maybeSingleMock = vi.fn().mockResolvedValueOnce({ data: so, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await fetchSalesOrderById('so-1');
    expect(result).toEqual(so);
  });
});

describe('fetchSalesOrders', () => {
  it('filters by status when provided', async () => {
    const orderMock = vi.fn().mockResolvedValueOnce({ data: [], error: null });
    const eqMock = vi.fn().mockReturnValue({ order: orderMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock, order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    await fetchSalesOrders({ status: 'OPEN' });
    expect(eqMock).toHaveBeenCalledWith('status', 'OPEN');
  });

  it('fetches all when no filter', async () => {
    const orderMock = vi.fn().mockResolvedValueOnce({ data: [], error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    await fetchSalesOrders();
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npm test --silent -- --run src/lib/salesOrderService.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module './salesOrderService'`.

- [ ] **Step 3: Write `src/lib/salesOrderService.ts`**

```typescript
import type { DbSalesOrder, KasirItem } from '../types';
import { supabase } from './supabaseClient';

export interface CreateSalesOrderInput {
  channel: string;
  date?: string;
  items: KasirItem[];
  subtotal: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  notes: string | null;
}

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<DbSalesOrder> {
  const { data, error } = await supabase.rpc('create_sales_order', {
    p_payload: {
      channel: input.channel,
      date: input.date,
      items: input.items,
      subtotal: input.subtotal,
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      customer_company: input.customer_company,
      notes: input.notes,
    },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('create_sales_order returned no row');
  return data as DbSalesOrder;
}

export async function fetchSalesOrderById(soId: string): Promise<DbSalesOrder | null> {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('id', soId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbSalesOrder | null) ?? null;
}

export async function fetchSalesOrders(
  filter?: { status?: DbSalesOrder['status'] },
): Promise<DbSalesOrder[]> {
  let query = supabase.from('sales_orders').select('*');
  if (filter?.status) {
    query = query.eq('status', filter.status);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DbSalesOrder[];
}

export async function markSalesOrderConverted(
  soId: string,
  target: { kasirTxId?: string; orderId?: string },
): Promise<DbSalesOrder> {
  const hasKt = typeof target.kasirTxId === 'string' && target.kasirTxId.length > 0;
  const hasOrder = typeof target.orderId === 'string' && target.orderId.length > 0;
  if (hasKt === hasOrder) {
    throw new Error('Exactly one of kasirTxId or orderId must be provided');
  }
  const { data, error } = await supabase.rpc('mark_sales_order_converted', {
    p_so_id: soId,
    p_target_kasir_tx_id: hasKt ? target.kasirTxId! : null,
    p_target_order_id: hasOrder ? target.orderId! : null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('mark_sales_order_converted returned no row');
  return data as DbSalesOrder;
}

export async function closeSalesOrder(soId: string, reason: string): Promise<DbSalesOrder> {
  if (!reason || reason.trim().length === 0) {
    throw new Error('Close reason is required');
  }
  const { data, error } = await supabase.rpc('close_sales_order', {
    p_so_id: soId,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('close_sales_order returned no row');
  return data as DbSalesOrder;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npm test --silent -- --run src/lib/salesOrderService.test.ts 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: zero TS errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/salesOrderService.ts src/lib/salesOrderService.test.ts
git commit -m "feat(sales-order): salesOrderService wrappers + vitest coverage

createSalesOrder / fetchSalesOrderById / fetchSalesOrders /
markSalesOrderConverted / closeSalesOrder. Client-side guard rails:
markSalesOrderConverted enforces exactly-one-target XOR; closeSalesOrder
requires non-empty trimmed reason."
```

---

### Task 8: `productWrappers.ts` `insertNewProduct` + vitest

**Files:**
- Create: `src/lib/products/productWrappers.ts`
- Create: `src/lib/products/productWrappers.test.ts`

**Interfaces:**
- Consumes: `supabase` from `../supabaseClient`; `SupabaseStockItem` from `../supabaseClient`.
- Produces: `insertNewProduct(args: InsertNewProductInput): Promise<SupabaseStockItem>` — INSERTs row into `stocks` with stock_atas=0, stock_bawah=0, status='aktif'.

Input shape:

```typescript
export interface InsertNewProductInput {
  name: string;            // required
  category: string;        // required
  price: number;           // required (harga jual)
  harga_modal?: number;    // recommended
  unit?: string;           // default 'pcs'
  subcategory?: string;
  brand?: string;
}
```

- [ ] **Step 1: Write the failing vitest**

Create `src/lib/products/productWrappers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

import { insertNewProduct } from './productWrappers';
import { supabase } from '../supabaseClient';

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fromMock.mockReset();
});

describe('insertNewProduct', () => {
  function setupSuccess(row: object) {
    const single = vi.fn().mockResolvedValueOnce({ data: row, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ insert });
    return { insert, select, single };
  }

  it('inserts row with required defaults', async () => {
    const { insert } = setupSuccess({ sku: 'new-sku', name: 'X', stock_atas: 0 });
    await insertNewProduct({ name: 'X', category: 'MCB', price: 1000 });

    expect(fromMock).toHaveBeenCalledWith('stocks');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'X',
      category: 'MCB',
      price: 1000,
      stock_atas: 0,
      stock_bawah: 0,
      stock: 0,
      status: 'aktif',
      unit: 'pcs',
    }));
  });

  it('uses provided optional values', async () => {
    const { insert } = setupSuccess({ sku: 'new-sku', name: 'X' });
    await insertNewProduct({
      name: 'X', category: 'MCB', price: 1000,
      harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
    }));
  });

  it('throws on missing name', async () => {
    await expect(insertNewProduct({ name: '   ', category: 'MCB', price: 1 }))
      .rejects.toThrow(/name/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('throws on missing category', async () => {
    await expect(insertNewProduct({ name: 'X', category: '', price: 1 }))
      .rejects.toThrow(/category/i);
  });

  it('throws on non-positive price', async () => {
    await expect(insertNewProduct({ name: 'X', category: 'MCB', price: 0 }))
      .rejects.toThrow(/price/i);
  });

  it('throws when Supabase returns error', async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'unique fail' } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ insert });

    await expect(insertNewProduct({ name: 'X', category: 'MCB', price: 1 }))
      .rejects.toThrow('unique fail');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npm test --silent -- --run src/lib/products/productWrappers.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/products/productWrappers.ts`**

```typescript
import type { SupabaseStockItem } from '../supabaseClient';
import { supabase } from '../supabaseClient';

export interface InsertNewProductInput {
  name: string;
  category: string;
  price: number;
  harga_modal?: number;
  unit?: string;
  subcategory?: string;
  brand?: string;
}

/**
 * Lite-create a new product from the wizard's Step 2 inline form.
 * stocks defaults: stock_atas=0, stock_bawah=0, status='aktif', initial_stock_approved=true.
 * Photos/specs/min_stock left at column defaults — set later via Produk & Stok screen.
 */
export async function insertNewProduct(args: InsertNewProductInput): Promise<SupabaseStockItem> {
  if (!args.name || args.name.trim().length === 0) {
    throw new Error('Product name is required');
  }
  if (!args.category || args.category.trim().length === 0) {
    throw new Error('Product category is required');
  }
  if (!Number.isFinite(args.price) || args.price <= 0) {
    throw new Error('Product price must be a positive number');
  }

  const row: Record<string, unknown> = {
    name: args.name.trim(),
    category: args.category.trim(),
    price: args.price,
    stock: 0,
    stock_atas: 0,
    stock_bawah: 0,
    status: 'aktif',
    unit: args.unit?.trim() || 'pcs',
  };
  if (typeof args.harga_modal === 'number') row.harga_modal = args.harga_modal;
  if (args.subcategory && args.subcategory.trim()) row.subcategory = args.subcategory.trim();
  if (args.brand && args.brand.trim()) row.brand = args.brand.trim();

  const { data, error } = await supabase.from('stocks').insert(row).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('insertNewProduct returned no row');
  return data as SupabaseStockItem;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npm test --silent -- --run src/lib/products/productWrappers.test.ts 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/products/productWrappers.ts src/lib/products/productWrappers.test.ts
git commit -m "feat(sales-order): insertNewProduct wrapper for lite-create in wizard

Required: name + category + price. Defaults: stock_atas=0, stock_bawah=0,
status='aktif', unit='pcs'. Photos/specs/min_stock omitted (set later via
Produk & Stok screen). Validation: trim non-empty name+category, price > 0."
```

---

## Phase C — Wizard internal extensions

### Task 9: `NewProductInlineForm.tsx` + vitest validation

**Files:**
- Create: `src/components/penjualan/wizard/NewProductInlineForm.tsx`
- Create: `src/lib/wizard/newProductValidation.ts`
- Create: `src/lib/wizard/newProductValidation.test.ts`

**Interfaces:**
- Consumes: `insertNewProduct` from `../../../lib/products/productWrappers`; `SupabaseStockItem` from `../../../lib/supabaseClient`.
- Produces:
  - `validateNewProductForm(state): { ok: boolean; errors: string[] }` — pure validator.
  - `<NewProductInlineForm onSaved onCancel showToast />` — uses validator + wrapper.

Component props:

```typescript
interface Props {
  onSaved: (product: SupabaseStockItem) => void;  // called after successful INSERT
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  existingCategories: string[];                    // dropdown options
}
```

- [ ] **Step 1: Write the failing validator test**

Create `src/lib/wizard/newProductValidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateNewProductForm } from './newProductValidation';

describe('validateNewProductForm', () => {
  const valid = { name: 'MCB Schneider 25A', category: 'MCB', price: '50000', hppText: '30000', unit: 'pcs' };

  it('passes for fully-valid input', () => {
    const r = validateNewProductForm(valid);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects empty name', () => {
    const r = validateNewProductForm({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/nama/i);
  });

  it('rejects empty category', () => {
    const r = validateNewProductForm({ ...valid, category: '' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/kategori/i);
  });

  it('rejects non-positive price', () => {
    const r = validateNewProductForm({ ...valid, price: '0' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/harga jual/i);
  });

  it('rejects non-numeric price', () => {
    const r = validateNewProductForm({ ...valid, price: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/harga jual/i);
  });

  it('allows empty hpp (optional)', () => {
    const r = validateNewProductForm({ ...valid, hppText: '' });
    expect(r.ok).toBe(true);
  });

  it('rejects negative hpp', () => {
    const r = validateNewProductForm({ ...valid, hppText: '-10' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/hpp/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test --silent -- --run src/lib/wizard/newProductValidation.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

Create `src/lib/wizard/newProductValidation.ts`:

```typescript
export interface NewProductFormState {
  name: string;
  category: string;
  price: string;      // raw input as string (parsed inside)
  hppText: string;    // optional
  unit: string;
}

export interface NewProductValidationResult {
  ok: boolean;
  errors: string[];
}

function parseRupiah(raw: string): number {
  // accept "45.000", "45,000", "45000"
  const cleaned = raw.replace(/[.,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function validateNewProductForm(s: NewProductFormState): NewProductValidationResult {
  const errors: string[] = [];
  if (!s.name || s.name.trim().length === 0) errors.push('Nama produk wajib diisi');
  if (!s.category || s.category.trim().length === 0) errors.push('Kategori wajib dipilih');
  const price = parseRupiah(s.price);
  if (!Number.isFinite(price) || price <= 0) errors.push('Harga jual wajib > 0');
  if (s.hppText && s.hppText.trim().length > 0) {
    const hpp = parseRupiah(s.hppText);
    if (!Number.isFinite(hpp) || hpp < 0) errors.push('HPP harus angka ≥ 0');
  }
  return { ok: errors.length === 0, errors };
}

export function parsePriceLike(raw: string): number {
  return parseRupiah(raw);
}
```

- [ ] **Step 4: Run validator test — expect pass**

```bash
npm test --silent -- --run src/lib/wizard/newProductValidation.test.ts 2>&1 | tail -5
```

Expected: pass.

- [ ] **Step 5: Write the React component**

Create `src/components/penjualan/wizard/NewProductInlineForm.tsx`:

```typescript
import { useState } from 'react';
import type { SupabaseStockItem } from '../../../lib/supabaseClient';
import { insertNewProduct } from '../../../lib/products/productWrappers';
import {
  validateNewProductForm,
  parsePriceLike,
  type NewProductFormState,
} from '../../../lib/wizard/newProductValidation';

interface Props {
  onSaved: (product: SupabaseStockItem) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  existingCategories: string[];
}

const COMMON_UNITS = ['pcs', 'm', 'rol', 'box', 'set', 'kg'];

export default function NewProductInlineForm(props: Props) {
  const [state, setState] = useState<NewProductFormState>({
    name: '', category: '', price: '', hppText: '', unit: 'pcs',
  });
  const [subcategory, setSubcategory] = useState('');
  const [brand, setBrand] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Build category options from existing + always show "+ Kategori baru..."
  const categoryOptions = Array.from(new Set([...props.existingCategories])).sort();

  const validation = validateNewProductForm(state);

  const onSubmit = async () => {
    if (!validation.ok) {
      props.showToast(validation.errors[0], 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const price = parsePriceLike(state.price);
      const hpp = state.hppText.trim().length > 0 ? parsePriceLike(state.hppText) : undefined;
      const product = await insertNewProduct({
        name: state.name,
        category: state.category,
        price,
        harga_modal: hpp,
        unit: state.unit,
        subcategory: subcategory.trim() || undefined,
        brand: brand.trim() || undefined,
      });
      props.showToast(`Produk baru tersimpan: ${product.name}`, 'success');
      props.onSaved(product);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      props.showToast(`Gagal simpan produk: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-2 border-[#012749]/30 rounded-xl p-4 bg-[#012749]/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-extrabold text-[#012749]">Produk Baru</div>
          <div className="text-[11px] text-slate-600">Akan tersimpan ke daftar Produk & Stok dengan stok awal 0.</div>
        </div>
        <button type="button" onClick={props.onCancel} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-2">
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama Produk <span className="text-red-500">*</span></label>
          <input value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            placeholder="Mis: MCB Schneider 25A 1P"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Kategori <span className="text-red-500">*</span></label>
          <input list="np-cat-options" value={state.category}
            onChange={(e) => setState((s) => ({ ...s, category: e.target.value }))}
            placeholder="Mis: MCB"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
          <datalist id="np-cat-options">
            {categoryOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Unit</label>
          <select value={state.unit}
            onChange={(e) => setState((s) => ({ ...s, unit: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg">
            {COMMON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Harga Jual (Rp) <span className="text-red-500">*</span></label>
          <input value={state.price}
            onChange={(e) => setState((s) => ({ ...s, price: e.target.value }))}
            placeholder="Mis: 45.000"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Harga Modal / HPP (Rp)</label>
          <input value={state.hppText}
            onChange={(e) => setState((s) => ({ ...s, hppText: e.target.value }))}
            placeholder="Optional · recommend isi"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Sub-kategori / Brand (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)}
              placeholder="Sub-kategori" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
            <input value={brand} onChange={(e) => setBrand(e.target.value)}
              placeholder="Brand" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-amber-700 mt-3 italic">
        ⚠️ Ini lite-create — foto, specs lengkap, min stock, dll. bisa di-set nanti via menu <strong>Produk & Stok</strong>. Stok awal 0 (semua gudang) — pesanan ini otomatis pre-order sampai pembelian masuk.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={props.onCancel} disabled={submitting}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
        <button type="button" onClick={onSubmit} disabled={!validation.ok || submitting}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Menyimpan…' : '✓ Simpan & Tambah ke Cart'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/penjualan/wizard/NewProductInlineForm.tsx \
  src/lib/wizard/newProductValidation.ts \
  src/lib/wizard/newProductValidation.test.ts
git commit -m "feat(sales-order): NewProductInlineForm + validator

Inline form opens in wizard Step 2 to create a new product without
leaving the wizard. Validates name + category + price > 0, HPP optional.
On Simpan: INSERT via insertNewProduct (stock_atas=0, stock_bawah=0,
status='aktif') then callback to parent which auto-adds qty=1 to cart."
```

---

### Task 10: `Step2Items.tsx` — wire up `+ Produk Baru`

**Files:**
- Modify: `src/components/penjualan/wizard/Step2Items.tsx`

**Interfaces:**
- Consumes: `NewProductInlineForm` (Task 9); existing `onAddItem(stock: SupabaseStockItem)` prop already on the component.
- Produces: extended Step2Items renders "Produk belum ada di daftar?" + button + inline form. On save, calls `onAddItem(product)` like a regular search-result add (the orchestrator's addItem handles cart insertion).

- [ ] **Step 1: Read the current file**

```bash
wc -l src/components/penjualan/wizard/Step2Items.tsx
```

Expected: ~180 lines (per the mockup-match PR #48).

- [ ] **Step 2: Edit `src/components/penjualan/wizard/Step2Items.tsx`**

Add the import + state + UI. Locate the search-results block (`{filtered.length > 0 && ...}`) and add the "+ Produk Baru" row AFTER the results block but BEFORE the `Tambah Jasa` label.

Add import at top of file:

```typescript
import { useState } from 'react';
import NewProductInlineForm from './NewProductInlineForm';
// existing imports...
```

Inside the component, add state:

```typescript
const [showNewProductForm, setShowNewProductForm] = useState(false);

// Derive categories for the form's datalist
const existingCategories = Array.from(new Set(props.stocks.map((s) => s.category).filter(Boolean)));
```

Replace the existing JSX block between the `filtered.length > 0 && (...)` results block and the `<label>Tambah Jasa</label>` header with:

```tsx
        {filtered.length > 0 && (
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
            {/* ... existing rendering ... */}
          </div>
        )}

        {/* + Produk Baru affordance — always visible below results */}
        {!showNewProductForm && (
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <div className="text-slate-500">
              {q.trim().length > 0 && filtered.length === 0
                ? 'Produk tidak ketemu di daftar?'
                : 'Produk belum ada di daftar?'}
            </div>
            <button
              type="button"
              onClick={() => setShowNewProductForm(true)}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
            >
              + Produk Baru
            </button>
          </div>
        )}

        {showNewProductForm && (
          <NewProductInlineForm
            onSaved={(product) => {
              props.onAddItem(product);
              setShowNewProductForm(false);
            }}
            onCancel={() => setShowNewProductForm(false)}
            showToast={props.showToast}
            existingCategories={existingCategories}
          />
        )}

        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 mt-4">Tambah Jasa (Optional)</label>
          {/* existing RakitButtonsRow + hint */}
        </div>
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -5
```

Expected: empty.

- [ ] **Step 4: Run full vitest**

```bash
npm test --silent -- --run 2>&1 | tail -3
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/penjualan/wizard/Step2Items.tsx
git commit -m "feat(sales-order): Step2Items — wire up + Produk Baru inline form

Always-visible CTA below search results. Copy adapts to whether user has
an active search query. On save → calls onAddItem like a regular search
hit; orchestrator's addItem inserts qty=1 cart row with pre-order badge
(stock_atas=0, stock_bawah=0 from lite-create)."
```

---

### Task 11: `Step3Payment.tsx` — `mode` prop branch

**Files:**
- Modify: `src/components/penjualan/wizard/Step3Payment.tsx`

**Interfaces:**
- Consumes: existing props (payment fields, totals, ongkir, address, notes, save handler).
- Produces: new `mode?: 'invoice' | 'quote'` prop (default `'invoice'`). When `mode='quote'`, renders simplified light Step 3: info banner + catatan textarea + amber summary card (subtotal only) + amber Simpan button. No payment-type cards, no method buttons, no TEMPO context, no DP detail box, no ongkir field, no alamat textarea.

- [ ] **Step 1: Add `mode` prop to interface**

Locate the `interface Props` block in `Step3Payment.tsx`. Add:

```typescript
interface Props {
  // ... existing props ...
  mode?: 'invoice' | 'quote';   // default 'invoice'
}
```

- [ ] **Step 2: Branch render at top of return**

Inside the component, near the top (before existing JSX), pull mode with default:

```typescript
const mode = props.mode ?? 'invoice';
```

Then wrap the existing return in a conditional:

```tsx
if (mode === 'quote') {
  return renderQuoteMode();
}
return renderInvoiceMode();  // existing JSX moves into this function
```

Where `renderInvoiceMode` is a closure containing the current JSX exactly as-is, and `renderQuoteMode` is the new simplified layout. Both have access to `props` and existing computed values via closure.

- [ ] **Step 3: Implement `renderQuoteMode`**

```tsx
function renderQuoteMode() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
      <div className="lg:col-span-7 space-y-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl">ℹ️</div>
            <div>
              <div className="text-sm font-extrabold text-blue-900 mb-1">Mode Penawaran (Sales Order)</div>
              <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                <li>Tidak perlu pilih payment method — penawaran belum commit ke pembayaran.</li>
                <li><strong>Ongkir + alamat pengiriman diisi nanti</strong> waktu convert ke Sales Invoice.</li>
                <li>Stok tidak akan bergerak saat disimpan.</li>
                <li>Customer accept → klik <strong>"→ Jadi Sales Invoice"</strong> di Daftar Penawaran.</li>
              </ul>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
            Catatan / Syarat Penawaran (optional)
          </label>
          <textarea rows={4}
            value={props.notes}
            onChange={(e) => props.onNotesChange(e.target.value)}
            placeholder="Mis: Penawaran berlaku selama harga komponen tidak naik. Garansi pabrik 1 tahun. Ongkir dihitung saat di-convert jadi invoice."
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#012749]/30 focus:border-[#012749]"
          />
          <p className="text-[11px] text-slate-500 mt-1.5 italic">Note ini tampil di PDF Penawaran dan di Daftar Penawaran.</p>
        </div>
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-xs text-amber-800">
            <span>Subtotal produk</span>
            <span>{formatRp(props.subtotal)}</span>
          </div>
          <div className="border-t border-amber-200 my-1.5"></div>
          <div className="flex justify-between text-sm font-bold text-amber-900">
            <span>TOTAL PENAWARAN</span>
            <span className="text-xl">{formatRp(props.subtotal)}</span>
          </div>
          <div className="text-[10px] text-amber-700 italic mt-2">
            ⚠️ Total ini belum termasuk ongkir. Ongkir dihitung saat di-convert ke Sales Invoice.
          </div>
        </div>

        <button type="button" onClick={onSimpan} disabled={submitting || !validation.ok}
          className="w-full px-6 py-3 text-sm font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting ? 'Menyimpan…' : '✓ Simpan Sales Order'}
        </button>
        {!validation.ok && validation.errors?.[0] && (
          <p className="text-[11px] text-rose-600 text-center">{validation.errors[0]}</p>
        )}
      </div>
    </div>
  );
}
```

The `validation` and `submitting` and `onSimpan` references match the closure scope of the existing component.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: empty.

- [ ] **Step 5: Run full vitest**

```bash
npm test --silent -- --run 2>&1 | tail -3
```

Expected: all tests pass (existing tests cover invoice-mode; quote-mode tested via wizard integration in T19).

- [ ] **Step 6: Commit**

```bash
git add src/components/penjualan/wizard/Step3Payment.tsx
git commit -m "feat(sales-order): Step3Payment mode='quote' branch

When mode='quote': render light layout — info banner + catatan textarea
+ amber summary card (subtotal=total) + amber Simpan button. No payment
type cards, no method buttons, no TEMPO context, no DP detail, no
ongkir/alamat. mode default 'invoice' preserves existing behavior."
```

---

## Phase D — Wizard orchestrator

### Task 12: `CatatPenjualanWizard.tsx` — `mode` + `fromSalesOrderId` + dispatch + pre-fill

**Files:**
- Modify: `src/components/penjualan/CatatPenjualanWizard.tsx`

**Interfaces:**
- Consumes: `createSalesOrder`, `fetchSalesOrderById`, `markSalesOrderConverted` from `../../lib/salesOrderService`; existing `record_kasir_sale`/`create_tempo_invoice`/`insertWipWithRakit` paths.
- Produces: extended wizard with:
  - new props `mode?: 'invoice' | 'quote'` (default `'invoice'`) and `fromSalesOrderId?: string`.
  - pre-fill effect: on mount, if `fromSalesOrderId` provided, fetch SO and seed channel/customer/cart/rakit/notes.
  - save dispatch branch: mode='quote' → createSalesOrder → navigate('daftarPenawaran'); mode='invoice' + fromSalesOrderId → existing save path THEN markSalesOrderConverted.

- [ ] **Step 1: Extend props interface**

Locate `CatatPenjualanWizardProps` interface. Add:

```typescript
export interface CatatPenjualanWizardProps {
  // ... existing props ...
  mode?: 'invoice' | 'quote';
  fromSalesOrderId?: string;
}
```

- [ ] **Step 2: Add imports**

At the top of `CatatPenjualanWizard.tsx`:

```typescript
import {
  createSalesOrder,
  fetchSalesOrderById,
  markSalesOrderConverted,
} from '../../lib/salesOrderService';
```

- [ ] **Step 3: Pull mode + fromSalesOrderId from props**

Inside the component:

```typescript
const mode = props.mode ?? 'invoice';
const fromSalesOrderId = props.fromSalesOrderId;
```

- [ ] **Step 4: Add the pre-fill effect**

Add this useEffect AFTER the existing master-data fetch effect:

```typescript
// Pre-fill from SO when converting Sales Order → Sales Invoice.
// One-shot: fetches SO and seeds channel/customer/items/notes. Operator
// can still edit anything before saving the SI.
useEffect(() => {
  if (!fromSalesOrderId) return;
  let cancelled = false;
  void (async () => {
    try {
      const so = await fetchSalesOrderById(fromSalesOrderId);
      if (cancelled || !so) return;
      setChannel(so.channel as KasirChannel);
      // Customer: try match in local customers, else build a stub
      const match = customers.find((c) => c.id === so.customer_id);
      if (match) {
        setCustomer(match);
      } else if (so.customer_id) {
        setCustomer({
          id: so.customer_id,
          name: so.customer_name,
          wa_number: so.customer_phone ?? '',
          company: so.customer_company ?? '',
          address: null,
          created_at: '',
          allows_tempo: false,
          term_days: 0,
          credit_limit: 0,
          order_count: 0,
          total_spend: 0,
        } as DbCustomerWithStats);
      }
      // Items: split SKU rows from jasa lump-sum rows
      const skuRows: CartItem[] = [];
      const jasaRows: RakitLine[] = [];
      for (const it of so.items) {
        if (it.sku) {
          skuRows.push({
            _key: ++_itemSeq,
            sku: it.sku,
            name: it.name,
            qty: it.qty,
            unit_price: it.unit_price,
            hpp_per_unit: it.hpp_per_unit,
            subtotal: it.subtotal,
            hpp_subtotal: it.hpp_subtotal,
            warehouse: null,
            warehouse_id: it.warehouse_id ?? null,
          });
        } else {
          jasaRows.push({
            id: `prefill-${Math.random().toString(36).slice(2)}`,
            type: 'jasa_custom_panel',  // default; user can adjust
            description: it.name,
            estimatedPrice: it.unit_price,
            hppEstimate: it.hpp_per_unit,
          });
        }
      }
      setCart(skuRows);
      setRakitLines(jasaRows);
      setNotes(so.notes ?? '');
      showToast(`Pre-filled dari ${so.so_number}`, 'success');
    } catch (err) {
      showToast(`Gagal pre-fill dari SO: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fromSalesOrderId, customers.length]);
```

- [ ] **Step 5: Branch save dispatch — quote mode**

Locate the save dispatch function. Add the quote-mode branch FIRST (before the existing TEMPO/WIP/standard branches):

```typescript
// New: mode='quote' → createSalesOrder, no payment/ongkir/alamat
if (mode === 'quote') {
  const skuItems = cart.map(({ _key, ...rest }) => rest);
  const serviceItems = rakitLines.map((l) => ({
    sku: null,
    name: l.description,
    qty: 1,
    unit_price: l.estimatedPrice,
    hpp_per_unit: l.hppEstimate,
    subtotal: l.estimatedPrice,
    hpp_subtotal: l.hppEstimate,
    warehouse_id: null,
    warehouse: null,
  }));
  const so = await createSalesOrder({
    channel,
    items: [...skuItems, ...serviceItems],
    subtotal,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.wa_number || null,
    customer_company: customer.company || null,
    notes: notes.trim() || null,
  });
  showToast(`Sales Order ${so.so_number} tersimpan`, 'success');
  if (onNavigate) onNavigate('daftarPenawaran'); else onBack();
  return;
}
```

- [ ] **Step 6: Wire markSalesOrderConverted after invoice save**

After EACH of the existing save paths (TEMPO, WIP, standard), if `fromSalesOrderId` is present, call `markSalesOrderConverted` with the returned id:

For TEMPO path:
```typescript
const orderId = await createTempoInvoice({...});
if (fromSalesOrderId) {
  try {
    await markSalesOrderConverted(fromSalesOrderId, { orderId });
  } catch (err) {
    showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  }
}
```

For WIP path:
```typescript
const { txId } = await kasirService.insertWipWithRakit({...});
if (fromSalesOrderId) {
  try {
    await markSalesOrderConverted(fromSalesOrderId, { kasirTxId: txId });
  } catch (err) {
    showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  }
}
```

For standard (record_kasir_sale) path:
```typescript
const tx = await kasirService.recordSale({...});
if (fromSalesOrderId) {
  try {
    await markSalesOrderConverted(fromSalesOrderId, { kasirTxId: tx.id });
  } catch (err) {
    showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  }
}
```

- [ ] **Step 7: Update header chrome for mode='quote'**

In the wizard's header render, swap title based on mode:

```tsx
<h1 className="text-lg font-extrabold {mode === 'quote' ? 'text-amber-800' : 'text-[#012749]'}">
  {mode === 'quote' && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold tracking-wider mr-2">QUOTE MODE</span>}
  {mode === 'quote' ? 'Sales Order' : 'Sales Invoice'}
</h1>
```

And subtitle slug for Step 3:
```tsx
const stepSlug = currentStep === 1
  ? 'Pilih channel & customer'
  : currentStep === 2
  ? 'Tambah produk & jasa'
  : (mode === 'quote' ? 'Finalisasi penawaran' : 'Pembayaran & finalisasi');
```

- [ ] **Step 8: Pass `mode` prop to Step3Payment**

In the wizard's render, where `<Step3Payment ...>` is mounted, add:

```tsx
<Step3Payment
  mode={mode}
  /* ... existing props ... */
/>
```

- [ ] **Step 9: Pre-fill banner**

If `fromSalesOrderId` is set, render an emerald banner above stepper:

```tsx
{fromSalesOrderId && (
  <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
    <div className="flex items-center gap-2 text-xs">
      <span className="text-emerald-600 text-base">✓</span>
      <span className="text-emerald-900">
        <strong>Pre-filled dari Sales Order</strong> — Channel, customer, items, dan catatan sudah diisi. Bisa adjust kalau scope berubah.
      </span>
    </div>
  </div>
)}
```

- [ ] **Step 10: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: zero TS errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/components/penjualan/CatatPenjualanWizard.tsx
git commit -m "feat(sales-order): CatatPenjualanWizard mode + fromSalesOrderId + dispatch

Two new props:
- mode: 'invoice' | 'quote' (default 'invoice'). Header title swaps,
  QUOTE MODE badge shown for quote, Step 3 subtitle updates,
  save dispatch routes to createSalesOrder.
- fromSalesOrderId: pre-fills channel/customer/cart/rakit/notes from
  the source SO on mount, shows emerald banner.

After successful Sales Invoice save (TEMPO/WIP/standard paths), if
fromSalesOrderId is set, calls markSalesOrderConverted to flip SO to
CONVERTED. Mark failure shows warning but doesn't roll back SI."
```

---

## Phase E — New screen

### Task 13: `DaftarPenawaranScreen.tsx`

**Files:**
- Create: `src/components/penjualan/DaftarPenawaranScreen.tsx`

**Interfaces:**
- Consumes: `fetchSalesOrders`, `closeSalesOrder` from `../../lib/salesOrderService`; `formatRp` from `../../lib/format`; `navigate` from `../../lib/urlRoute`; `DbSalesOrder` type from `../../types`.
- Produces: full screen with summary cards (Open count + Open total Rp, Converted 7d count, Closed 7d count, Conversion Rate %), tab strip (Semua/Open/Converted/Closed), search input, table with per-row actions (Konversi / Lihat / Tutup).

- [ ] **Step 1: Write the file**

Create `src/components/penjualan/DaftarPenawaranScreen.tsx`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import type { DbSalesOrder } from '../../types';
import { formatRp } from '../../lib/format';
import { navigate } from '../../lib/urlRoute';
import { fetchSalesOrders, closeSalesOrder } from '../../lib/salesOrderService';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type StatusFilter = 'all' | 'OPEN' | 'CONVERTED' | 'CLOSED';

export default function DaftarPenawaranScreen({ showToast }: Props) {
  const [rows, setRows] = useState<DbSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [closeModal, setCloseModal] = useState<{ so: DbSalesOrder; reason: string } | null>(null);
  const [closing, setClosing] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchSalesOrders();
      setRows(data);
    } catch (err) {
      showToast(`Gagal load: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const counts = useMemo(() => {
    const open = rows.filter((r) => r.status === 'OPEN');
    const converted = rows.filter((r) => r.status === 'CONVERTED');
    const closed = rows.filter((r) => r.status === 'CLOSED');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentConv = converted.filter((r) => new Date(r.created_at).getTime() >= sevenDaysAgo);
    const recentClosed = closed.filter((r) => new Date(r.created_at).getTime() >= sevenDaysAgo);
    const decided = recentConv.length + recentClosed.length;
    const rate = decided > 0 ? Math.round((recentConv.length / decided) * 100) : 0;
    return {
      open: open.length,
      openTotal: open.reduce((s, r) => s + Number(r.subtotal), 0),
      convertedTotal: recentConv.reduce((s, r) => s + Number(r.subtotal), 0),
      converted: recentConv.length,
      closed: recentClosed.length,
      rate,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab !== 'all') out = out.filter((r) => r.status === tab);
    if (search.trim().length > 0) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        r.so_number.toLowerCase().includes(q)
        || r.customer_name.toLowerCase().includes(q)
        || (r.customer_phone ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, tab, search]);

  const onConvert = (so: DbSalesOrder) => {
    if (so.status !== 'OPEN') {
      showToast(`SO sudah ${so.status}. Tidak bisa di-convert.`, 'warning');
      return;
    }
    navigate('penjualanBaru', { fromSo: so.id });
  };

  const onCloseSubmit = async () => {
    if (!closeModal || closeModal.reason.trim().length === 0) return;
    setClosing(true);
    try {
      await closeSalesOrder(closeModal.so.id, closeModal.reason);
      showToast(`SO ${closeModal.so.so_number} ditutup`, 'success');
      setCloseModal(null);
      await reload();
    } catch (err) {
      showToast(`Gagal tutup: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-[#012749]">Daftar Penawaran</h1>
            <p className="text-xs text-slate-500 mt-0.5">Sales Order ke customer. Belum commit · stok belum bergerak.</p>
          </div>
          <button onClick={() => navigate('penjualanBaru', { mode: 'quote' })}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90">
            + Sales Order Baru
          </button>
        </div>

        {/* Summary cards */}
        <div className="px-6 pt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">SO Open</div>
            <div className="text-lg font-extrabold text-amber-900 mt-1">{counts.open}</div>
            <div className="text-[11px] text-amber-700">{formatRp(counts.openTotal)} total</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Converted (7 hari)</div>
            <div className="text-lg font-extrabold text-emerald-900 mt-1">{counts.converted}</div>
            <div className="text-[11px] text-emerald-700">{formatRp(counts.convertedTotal)} menjadi SI</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Closed (7 hari)</div>
            <div className="text-lg font-extrabold text-slate-700 mt-1">{counts.closed}</div>
            <div className="text-[11px] text-slate-500">Lost deal</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Conversion Rate</div>
            <div className="text-lg font-extrabold text-[#012749] mt-1">{counts.rate}%</div>
            <div className="text-[11px] text-slate-500">{counts.converted} dari {counts.converted + counts.closed} decided</div>
          </div>
        </div>

        {/* Tabs + search */}
        <div className="px-6 pt-5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(['all', 'OPEN', 'CONVERTED', 'CLOSED'] as const).map((t) => {
              const label = t === 'all' ? 'Semua' : t === 'OPEN' ? 'Open' : t === 'CONVERTED' ? 'Converted' : 'Closed';
              const count = t === 'all' ? rows.length : rows.filter((r) => r.status === t).length;
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md ${tab === t ? 'bg-white text-[#012749] shadow-sm' : 'text-slate-600 hover:bg-white/50'}`}>
                  {label} ({count})
                </button>
              );
            })}
          </div>
          <input type="text" placeholder="Cari nomor SO / customer / HP..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg w-64" />
        </div>

        {/* Table */}
        <div className="px-6 py-4">
          {loading ? (
            <p className="text-center text-slate-400 py-8 text-sm">Memuat...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">Tidak ada Sales Order.</p>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">SO Number</th>
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-left">Tanggal</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className={`border-t border-slate-100 ${r.status === 'CONVERTED' ? 'bg-emerald-50/30' : r.status === 'CLOSED' ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-4 py-3 font-bold text-[#012749]">{r.so_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{r.customer_name}</div>
                        <div className="text-[11px] text-slate-500">{r.customer_phone ?? '—'} · {r.channel}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#012749]">{formatRp(Number(r.subtotal))}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(r.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.status === 'OPEN' ? 'bg-amber-100 text-amber-800'
                          : r.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {r.status === 'OPEN' && (
                            <>
                              <button onClick={() => onConvert(r)}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-[#2d8a4e] text-white hover:bg-[#236b3d]">
                                → Jadi Sales Invoice
                              </button>
                              <button onClick={() => setCloseModal({ so: r, reason: '' })}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50">
                                Tutup
                              </button>
                            </>
                          )}
                          {r.status === 'CLOSED' && r.closed_reason && (
                            <span className="text-[10px] text-slate-500 italic">Lost: {r.closed_reason}</span>
                          )}
                          {r.status === 'CONVERTED' && r.converted_to_kasir_tx_id && (
                            <span className="text-[10px] font-bold text-emerald-700">→ {r.converted_to_kasir_tx_id.slice(0, 8)}</span>
                          )}
                          {r.status === 'CONVERTED' && r.converted_to_order_id && (
                            <span className="text-[10px] font-bold text-emerald-700">→ TEMPO {r.converted_to_order_id.slice(0, 8)}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-3 italic">
            💡 SO yang sudah CLOSED tidak bisa di-reopen — bikin SO baru kalau customer berubah pikiran.
          </p>
        </div>
      </div>

      {/* Close modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="text-lg font-extrabold text-[#012749] mb-2">Tutup Sales Order</div>
            <div className="text-xs text-slate-600 mb-4">
              SO <strong>{closeModal.so.so_number}</strong> akan ditandai CLOSED. Operasi ini tidak bisa di-undo.
            </div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Alasan <span className="text-red-500">*</span></label>
            <textarea rows={3}
              value={closeModal.reason}
              onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })}
              placeholder="Mis: customer pilih supplier lain, harga tidak match, scope berubah, dll."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCloseModal(null)} disabled={closing}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
              <button onClick={onCloseSubmit}
                disabled={closing || closeModal.reason.trim().length === 0}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                {closing ? 'Menutup…' : 'Tutup SO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: zero TS errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/DaftarPenawaranScreen.tsx
git commit -m "feat(sales-order): DaftarPenawaranScreen — listing + tabs + close modal

Summary cards: Open count + Rp total, Converted (7d), Closed (7d),
Conversion Rate. Tabs Semua/Open/Converted/Closed. Search by SO number,
customer name, or phone. Per-row actions:
- OPEN: → Jadi Sales Invoice (navigate fromSo=<id>) + Tutup (modal)
- CONVERTED: shows FK to kasir_tx or orders
- CLOSED: shows closed_reason

Close modal requires non-empty reason."
```

---

## Phase F — PDF

### Task 14: `SalesInvoicePDF.tsx` — `quotation` variant

**Files:**
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx`

**Interfaces:**
- Consumes: existing `InvoiceVariant` type (`'dp' | 'lunas'`); component props.
- Produces: extended `InvoiceVariant = 'dp' | 'lunas' | 'quotation'`. When variant='quotation': rotated PENAWARAN stamp, hide payment/alamat sections, hide ongkir line in totals, label "TOTAL PENAWARAN".

- [ ] **Step 1: Extend `InvoiceVariant` type**

Locate the type definition at top of `SalesInvoicePDF.tsx`:

```typescript
// BEFORE:
export type InvoiceVariant = 'dp' | 'lunas';

// AFTER:
export type InvoiceVariant = 'dp' | 'lunas' | 'quotation';
```

- [ ] **Step 2: Add `quotation` rendering branch**

Add a derived flag near the top of the component:
```typescript
const isQuotation = variant === 'quotation';
```

In the JSX, find the title/header block and replace the title text + add stamp:

```tsx
<div style={{ position: 'relative' }}>
  {isQuotation && (
    <div style={{
      position: 'absolute', top: 20, right: 20, transform: 'rotate(-12deg)',
      border: '3px solid #d97706', color: '#d97706', fontWeight: 900,
      padding: '4px 12px', fontSize: 18, letterSpacing: 4,
      background: 'rgba(255,255,255,0.7)', zIndex: 10,
    }}>
      PENAWARAN
    </div>
  )}
  <div>
    {/* existing letterhead */}
  </div>
</div>
```

Title bar:
```tsx
<div>
  {isQuotation ? 'SALES ORDER' : 'INVOICE'}
</div>
```

Document number prefix:
```tsx
<div>
  {isQuotation ? transaction.so_number : transaction.invoice_number}
</div>
```

For quotation, `transaction.so_number` will need to be passed when this PDF is opened from a Sales Order context. For Phase 1, the PDF is invoked from InvoicePreviewScreen which only fetches kasir_transactions — quotation PDF is NOT yet linked from a Sales Order viewer. Wire the quotation variant call later in T19 smoke when adding SO row "Lihat PDF" action.

Customer block — hide alamat line when quotation:
```tsx
{!isQuotation && transaction.delivery_address && (
  <div>Alamat: {transaction.delivery_address}</div>
)}
{isQuotation && (
  <div style={{ fontStyle: 'italic', color: '#64748b', fontSize: 10 }}>
    Alamat pengiriman ditentukan saat Sales Invoice diterbitkan.
  </div>
)}
```

Totals — hide ongkir row when quotation:
```tsx
{!isQuotation && (transaction.ongkir_amount ?? 0) > 0 && (
  <tr><td>Ongkir</td><td>{formatRp(transaction.ongkir_amount ?? 0)}</td></tr>
)}
<tr>
  <td><strong>{isQuotation ? 'TOTAL PENAWARAN' : 'TOTAL INVOICE'}</strong></td>
  <td><strong>{formatRp(isQuotation ? transaction.subtotal : (transaction.total_amount ?? transaction.subtotal))}</strong></td>
</tr>
{isQuotation && (
  <tr><td colSpan={2} style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
    * Belum termasuk ongkir. Final total saat Sales Invoice.
  </td></tr>
)}
```

Payment section — hide entirely when quotation:
```tsx
{!isQuotation && (
  <>
    {/* existing TANGGAL JATUH TEMPO, payment method, etc */}
  </>
)}
```

Footer disclaimer:
```tsx
{isQuotation && (
  <div style={{ borderTop: '1px solid #cbd5e1', marginTop: 16, paddingTop: 12, fontSize: 10, color: '#64748b' }}>
    Dokumen ini bukan invoice resmi. Untuk pemesanan, konfirmasi ke admin untuk diteruskan menjadi Sales Invoice.
  </div>
)}
```

- [ ] **Step 3: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/SalesInvoicePDF.tsx
git commit -m "feat(sales-order): SalesInvoicePDF quotation variant

InvoiceVariant += 'quotation'. When variant='quotation': rotated PENAWARAN
stamp top-right, title 'SALES ORDER' instead of 'INVOICE', alamat block
replaced with italic 'ditentukan saat Sales Invoice', totals hide ongkir
+ rename to TOTAL PENAWARAN + footnote, payment section hidden entirely,
footer adds 'bukan invoice resmi' disclaimer.

PDF transaction prop expects so_number when variant='quotation'."
```

---

## Phase G — Routing + chrome

### Task 15: `urlRoute.ts` — `daftarPenawaran` in `ACTIVE_PAGES`

**Files:**
- Modify: `src/lib/urlRoute.ts`

**Interfaces:**
- Consumes: existing `ACTIVE_PAGES: ReadonlySet<ActivePage>`.
- Produces: `'daftarPenawaran'` added to the Set so the URL `?screen=daftarPenawaran` doesn't get coerced to dashboard.

- [ ] **Step 1: Edit `src/lib/urlRoute.ts`**

Locate the `ACTIVE_PAGES` constant and add `'daftarPenawaran'`:

```typescript
export const ACTIVE_PAGES: ReadonlySet<ActivePage> = new Set<ActivePage>([
  'dashboard',
  // ... existing entries ...
  'invoicePreview',
  'daftarPenawaran',
]);
```

- [ ] **Step 2: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/urlRoute.ts
git commit -m "feat(sales-order): ACTIVE_PAGES += daftarPenawaran

Allow ?screen=daftarPenawaran without coercion to dashboard."
```

---

### Task 16: `App.tsx` — `case 'daftarPenawaran'` mount + URL params

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `DaftarPenawaranScreen` (Task 13); URL params from `useURLRoute()` (existing).
- Produces: `case 'daftarPenawaran'` mounts the screen. The `penjualanBaru` case passes `mode` and `fromSalesOrderId` props from URL params to `CatatPenjualanWizard`.

- [ ] **Step 1: Add import**

At the top of `src/App.tsx`:

```typescript
import DaftarPenawaranScreen from './components/penjualan/DaftarPenawaranScreen';
```

- [ ] **Step 2: Add `case 'daftarPenawaran'`**

Locate the renderActivePage switch. Add a case after `'invoicePreview'`:

```tsx
case 'daftarPenawaran':
  return <DaftarPenawaranScreen showToast={triggerToast} />;
```

- [ ] **Step 3: Wire URL params to CatatPenjualanWizard**

Locate the `case 'penjualanBaru'` block. Extract `mode` and `fromSo` from URL route params:

```tsx
case 'penjualanBaru': {
  const wizardMode = route.params.mode === 'quote' ? 'quote' : 'invoice';
  const wizardFromSo = route.params.fromSo;
  return (
    <CatatPenjualanWizard
      currentUser={currentUser}
      showToast={triggerToast}
      initialChannel={penjualanInitialChannel}
      initialPrefillSku={penjualanInitialPrefillSku}
      mode={wizardMode}
      fromSalesOrderId={wizardFromSo}
      onBack={() => navigate('kasir')}
      onSaved={(txId) => { setInvoicePreviewOrderId(txId); }}
      onNavigate={(page) => navigate(page)}
    />
  );
}
```

- [ ] **Step 4: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: zero TS errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(sales-order): App.tsx — daftarPenawaran mount + wizard mode/fromSo URL wiring

case 'daftarPenawaran' renders DaftarPenawaranScreen. case 'penjualanBaru'
now reads ?mode=quote and ?fromSo=<id> URL params and passes them as
props to CatatPenjualanWizard."
```

---

### Task 17: `Sidebar.tsx` — new menuItem

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: existing `menuItems` array + `FileText` icon from lucide-react (or similar).
- Produces: new entry `{ id: 'daftarPenawaran', label: 'Penawaran', icon: FileText, category: 'operasional', permKey: 'kasir' }` between Penjualan and Kasir.

- [ ] **Step 1: Import icon**

Locate the lucide-react import at top of `src/components/Sidebar.tsx` and add `FileText`:

```typescript
import {
  // ... existing ...
  FileText,
} from 'lucide-react';
```

- [ ] **Step 2: Insert menuItem entry**

Locate the `menuItems` array. Insert AFTER the `salesLanding` (Penjualan) entry and BEFORE `kasir`:

```typescript
{ id: 'daftarPenawaran', label: 'Penawaran', icon: FileText, category: 'operasional', permKey: 'kasir' },
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -5
```

Expected: empty.

- [ ] **Step 4: Run full vitest**

```bash
npm test --silent -- --run 2>&1 | tail -3
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sales-order): Sidebar — new Penawaran menu entry

Operasional category, between Penjualan and Kasir. permKey='kasir'
(reuse existing flag — no new permissions per spec)."
```

---

### Task 18: `SalesLandingScreen` + `SalesTabStrip` wording + new button

**Files:**
- Modify: `src/components/sales/SalesLandingScreen.tsx`
- Modify: `src/components/sales/SalesTabStrip.tsx`

**Interfaces:**
- Consumes: existing nav helpers + button labels.
- Produces: SalesLandingScreen adds "+ Sales Order" alongside renamed "+ Sales Invoice"; SalesTabStrip renames its single tab.

- [ ] **Step 1: Rename in SalesTabStrip**

Locate the existing label `📝 Catat Penjualan` in `src/components/sales/SalesTabStrip.tsx` and replace with `📝 Sales Invoice`.

```bash
grep -n "Catat Penjualan" src/components/sales/SalesTabStrip.tsx
```

Then edit the matched line(s) to use the new label.

- [ ] **Step 2: Update SalesLandingScreen — rename existing button + add new button**

Read `src/components/sales/SalesLandingScreen.tsx`. Find the existing "+ Catat Penjualan" button and:
1. Rename its label to "+ Sales Invoice".
2. Add a second button "+ Sales Order" navigating to `?screen=penjualanBaru&mode=quote`.

The two-button layout matches mockup Frame 1:

```tsx
<div className="grid grid-cols-2 gap-4">
  <button onClick={() => navigate('penjualanBaru')}
    className="border-2 border-[#012749] bg-[#012749]/5 rounded-2xl p-6 text-left hover:bg-[#012749]/10 transition">
    <div className="text-3xl mb-2">🧾</div>
    <div className="text-base font-extrabold text-[#012749]">+ Sales Invoice</div>
    <div className="text-xs text-slate-600 mt-1">
      Catat penjualan yang sudah commit — customer bayar sekarang (LUNAS / DP) atau TEMPO. Stok bergerak, invoice resmi keluar.
    </div>
  </button>
  <button onClick={() => navigate('penjualanBaru', { mode: 'quote' })}
    className="border-2 border-amber-400 bg-amber-50 rounded-2xl p-6 text-left hover:bg-amber-100 transition">
    <div className="text-3xl mb-2">📄</div>
    <div className="text-base font-extrabold text-amber-800">+ Sales Order</div>
    <div className="text-xs text-amber-700 mt-1">
      Bikin penawaran ke customer. Belum commit, tidak ada payment method, stok tidak bergerak. Kalau customer accept → lanjut jadi Sales Invoice.
    </div>
  </button>
</div>
```

(Replace the existing single-button block. Keep any surrounding layout — section title, etc. — and only touch the action area.)

- [ ] **Step 3: Typecheck + full vitest**

```bash
npx tsc --noEmit && npm test --silent -- --run 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/sales/SalesLandingScreen.tsx src/components/sales/SalesTabStrip.tsx
git commit -m "feat(sales-order): SalesLanding + SalesTabStrip wording + Sales Order button

SalesLandingScreen: rename + Catat Penjualan → + Sales Invoice (navy);
add + Sales Order (amber) routing to ?mode=quote.
SalesTabStrip: tab label 📝 Catat Penjualan → 📝 Sales Invoice."
```

---

## Phase H — Final smoke

### Task 19: Full suite + TS clean + browser smoke checklist

**Files:** none modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run TypeScript clean check**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: empty output.

- [ ] **Step 2: Run full vitest suite**

```bash
npm test --silent -- --run 2>&1 | tail -5
```

Expected: all tests pass; new tests counted (salesOrderService, productWrappers, newProductValidation).

- [ ] **Step 3: Verify migrations applied**

Run via Supabase MCP `execute_sql`:

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version LIKE '202607250000%' ORDER BY version;
```

Expected: 5 rows: `20260725000001` through `20260725000005`.

- [ ] **Step 4: Verify RPCs exist + signatures**

Run via Supabase MCP `execute_sql`:

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('create_sales_order', 'mark_sales_order_converted',
                    'close_sales_order', 'next_sales_order_number')
ORDER BY p.proname;
```

Expected: 4 rows with correct signatures:
- `close_sales_order(text, text)`
- `create_sales_order(jsonb)`
- `mark_sales_order_converted(text, uuid, uuid)`
- `next_sales_order_number(text, date)`

- [ ] **Step 5: Browser smoke checklist (post-deploy)**

After PR merges + Cloud Build deploys + revision promoted:

- [ ] Navigate `?screen=salesLanding` → see two buttons "+ Sales Invoice" (navy) + "+ Sales Order" (amber).
- [ ] Click "+ Sales Order" → URL becomes `?screen=penjualanBaru&mode=quote` → wizard header shows "Sales Order" + QUOTE MODE badge.
- [ ] Step 1: pick walk-in + customer → Lanjut active.
- [ ] Step 2: search a product → click "+ Tambah" → cart populated.
- [ ] Step 2: search "produknonexist" → see "Produk tidak ketemu di daftar?" → click "+ Produk Baru" → fill form → Simpan → product auto-added to cart with PRE-ORDER badge.
- [ ] Step 2: footer warning "Quote mode: stok TIDAK akan dikurang".
- [ ] Step 3: shows info banner + catatan textarea + amber summary card + amber Simpan button. NO payment-type cards, NO method buttons, NO ongkir, NO alamat.
- [ ] Simpan → toast "Sales Order SO-XXX tersimpan" → URL becomes `?screen=daftarPenawaran` → SO visible in Open tab.
- [ ] Verify in Supabase MCP execute_sql: SO row exists with status='OPEN', no stock_movements created.
- [ ] Sidebar: "Penawaran" menu item visible → click → DaftarPenawaranScreen renders.
- [ ] Click "→ Jadi Sales Invoice" on the OPEN row → URL becomes `?screen=penjualanBaru&fromSo=<id>` → wizard opens with mode='invoice', emerald banner "Pre-filled dari Sales Order".
- [ ] Channel + customer + cart + notes pre-filled. Step 3 shows full invoice UI.
- [ ] Pick LUNAS → Simpan → InvoicePreviewScreen.
- [ ] Verify in Supabase MCP execute_sql: SO status='CONVERTED', converted_to_kasir_tx_id set.
- [ ] Daftar Penawaran: SO moved to Converted tab.
- [ ] Close another OPEN SO → modal opens → fill reason → Tutup → SO moves to Closed tab + shows "Lost: <reason>".
- [ ] Try clicking "→ Jadi Sales Invoice" on the CONVERTED SO → button not rendered (per code: only OPEN status shows actions).

- [ ] **Step 6: Commit smoke checklist results (optional progress note)**

Update `progress.md` with smoke results.

```bash
git add progress.md
git commit -m "docs(progress): Sales Order feature — full smoke verification"
```

---

## Self-Review Notes

**Spec coverage cross-check (spec §2-12):**
- §2 architecture → Phase A (DB) + B (wrappers) + C/D (wizard) + E (screen) + F (PDF) + G (chrome). ✓
- §3 data model → T1 (table + counters). ✓
- §4 RPCs → T2 (helper), T3 (create), T4 (mark), T5 (close). ✓
- §5 frontend components → T6 (types), T7 (service), T8 (productWrappers), T9 (form + validator), T13 (screen), and modified file changes in T10-T18. ✓
- §6 data flow → all 4 scenarios (Create SO, Convert, Close, Add new product) covered by browser smoke in T19. ✓
- §7 wizard mode prop design → T12 implements `mode` + `fromSalesOrderId` + pre-fill effect + dispatch branch. ✓
- §8 quotation PDF variant → T14. ✓
- §9 error handling → T7/T8 client-side guards (XOR target, non-empty reason, validation), T3-T5 RPC guards. RPC race left as documented warning toast in T12. ✓
- §10 testing → vitest for wrappers/validator (T7, T8, T9); SQL smoke per backend task; browser smoke in T19. ✓
- §11 wording rename → T18 (SalesLanding + SalesTabStrip); T12 (wizard header). ✓
- §12 permissions → reuse `kasir` flag — see Sidebar entry in T17. ✓

**Placeholder scan:** No TBD/TODO. Each step has either code or exact command + expected output.

**Type consistency:** `DbSalesOrder` interface in T6 matches Section 3.1 of spec exactly. Wrapper signatures in T7 align with the type. Mode prop is `'invoice' | 'quote'` across T11/T12. `InvoiceVariant` extends `'dp' | 'lunas'` with `'quotation'` in T14, matching the spec's union. Wizard `fromSalesOrderId` URL param matches the route param `fromSo` consistently.
