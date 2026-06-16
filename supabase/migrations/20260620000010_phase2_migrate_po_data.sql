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
