-- 20260910000011 — Add stocks.is_passthrough flag + heuristic backfill.
--
-- Enables per-line branching in create_tempo_invoice (Slice A) between
-- stock-based FIFO consumption vs pass-through accrual. Heuristic populates
-- flag for existing SKUs based on PI type history.
--
-- Design spec: §3.2.
--
-- Rollback: ALTER TABLE stocks DROP COLUMN is_passthrough (safe, metadata-only).

BEGIN;

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS is_passthrough boolean NOT NULL DEFAULT false;

-- Heuristic backfill: any SKU that has appeared in PASSTHROUGH PI but never
-- in STOCK PI is flagged as passthrough.
UPDATE public.stocks s SET is_passthrough = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.pi_id
  WHERE pii.sku = s.sku AND pi.type = 'STOCK'
) AND EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.pi_id
  WHERE pii.sku = s.sku AND pi.type = 'PASSTHROUGH'
);

COMMIT;
