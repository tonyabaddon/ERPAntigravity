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
