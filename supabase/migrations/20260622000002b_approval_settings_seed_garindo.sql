-- Seed 19 approval_settings rows for Garindo (zero-behavior-change).
-- Existing 12: approval_required=TRUE, verification_method='PIN' (current behavior).
-- New 7 Pembelian: approval_required=FALSE per memory feedback_no_approval_workflow.md.

INSERT INTO public.approval_settings (tenant_id, request_type, approval_required, verification_method)
  VALUES
    (NULL, 'adjustment',                    TRUE,  'PIN'),
    (NULL, 'opname',                        TRUE,  'PIN'),
    (NULL, 'initial_stock',                 TRUE,  'PIN'),
    (NULL, 'kasir_price_override',          TRUE,  'PIN'),
    (NULL, 'kasir_void',                    TRUE,  'PIN'),
    (NULL, 'kasir_refund',                  TRUE,  'PIN'),
    (NULL, 'price_change',                  TRUE,  'PIN'),
    (NULL, 'customer_credit_activate',      TRUE,  'PIN'),
    (NULL, 'customer_credit_limit_change',  TRUE,  'PIN'),
    (NULL, 'customer_credit_deactivate',    TRUE,  'PIN'),
    (NULL, 'piutang_write_off',             TRUE,  'PIN'),
    (NULL, 'rakit_lock',                    TRUE,  'PIN'),
    (NULL, 'purchase_order_create',         FALSE, 'NONE'),
    (NULL, 'purchase_order_amend',          FALSE, 'NONE'),
    (NULL, 'tagihan_create',                FALSE, 'NONE'),
    (NULL, 'supplier_payment',              FALSE, 'NONE'),
    (NULL, 'bnl_create',                    FALSE, 'NONE'),
    (NULL, 'tukar_faktur',                  FALSE, 'NONE'),
    (NULL, 'purchase_return',               FALSE, 'NONE');
