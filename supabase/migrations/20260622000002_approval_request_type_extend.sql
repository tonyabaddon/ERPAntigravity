-- Phase 1 task 2: extend approval_request_type ENUM + seed 19 rows for Garindo.
-- Memory: feedback_no_approval_workflow.md — Pembelian default approval_required=FALSE.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_order_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_order_amend';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'tagihan_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'supplier_payment';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'bnl_create';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'tukar_faktur';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'purchase_return';
