BEGIN;

-- 1. Anomaly log table
CREATE TABLE IF NOT EXISTS public.gl_dual_write_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_rpc text NOT NULL,
  source_ref_table text NOT NULL,
  source_ref_id uuid NOT NULL,
  error_code text,
  error_message text NOT NULL,
  attempted_payload jsonb NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_gl_anomalies_unresolved
  ON public.gl_dual_write_anomalies (created_at DESC)
  WHERE resolved_at IS NULL;

-- No RLS — service-role only writes; future Phase 0c will add Owner read policy

-- 2. accounting_config default account FKs
ALTER TABLE public.accounting_config
  ADD COLUMN IF NOT EXISTS default_kas_account_id uuid REFERENCES public.cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_bank_account_id uuid REFERENCES public.cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_qris_account_id uuid REFERENCES public.cash_accounts(id),
  ADD COLUMN IF NOT EXISTS default_edc_account_id uuid REFERENCES public.cash_accounts(id);

-- 3. Seed Garindo defaults
UPDATE public.accounting_config
SET
  default_kas_account_id = COALESCE(default_kas_account_id, (
    SELECT id FROM public.cash_accounts
    WHERE account_type = 'KAS' AND is_active = true
    ORDER BY sort_order, created_at
    LIMIT 1
  )),
  default_bank_account_id = COALESCE(default_bank_account_id, (
    SELECT id FROM public.cash_accounts
    WHERE account_type = 'BANK' AND is_active = true
    ORDER BY sort_order, created_at
    LIMIT 1
  ))
WHERE tenant_id IS NULL;

-- 4. orders.cash_account_id (destination for piutang payment)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_account_id uuid REFERENCES public.cash_accounts(id);

COMMIT;
