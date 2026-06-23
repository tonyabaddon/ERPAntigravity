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
  converted_to_kasir_tx_id    uuid REFERENCES public.kasir_transactions(id) ON DELETE SET NULL,
  converted_to_order_id       uuid REFERENCES public.orders(id) ON DELETE SET NULL,
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
  'JSONB array mirroring kasir_transactions.items shape. sku nullable untuk jasa lump-sum.';
