-- 20260608000008_rakit_workflow_schema.sql
-- Sub-project B: Rakit Workflow
-- Extends kasir_transactions with WIP/PENDING_LOCK_APPROVAL states + lock/cancel metadata.
-- Adds rakit_job_lines, rakit_components, rakit_audit_log.
--
-- NOTE: This migration depends on sub-project A (Sales Recording overhaul) which
-- introduces the `status` column on kasir_transactions. Sub-project A must be
-- merged and applied before this migration runs.

-- 1. Extend kasir_transactions status enum (CHECK constraint, no enum type)
ALTER TABLE public.kasir_transactions
  DROP CONSTRAINT IF EXISTS chk_kasir_status;

ALTER TABLE public.kasir_transactions
  ADD CONSTRAINT chk_kasir_status CHECK (
    status IN ('PAID','AWAITING_LUNAS','COMPLETED','CANCELLED','WIP','PENDING_LOCK_APPROVAL')
  );

-- 2. Lock/cancel metadata columns on kasir_transactions
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS service_summary TEXT,
  ADD COLUMN IF NOT EXISTS lock_submitted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS lock_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS lock_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS lock_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_refund_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cancel_forfeit_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kasir_pending_approval
  ON public.kasir_transactions(lock_submitted_at)
  WHERE status = 'PENDING_LOCK_APPROVAL';

CREATE INDEX IF NOT EXISTS idx_kasir_wip
  ON public.kasir_transactions(created_at)
  WHERE status = 'WIP';

-- 3. rakit_job_lines: one row per rakit (jasa_rakit or jasa_custom_panel) within a transaction
CREATE TABLE IF NOT EXISTS public.rakit_job_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES public.kasir_transactions(id) ON DELETE CASCADE,
  line_number           INT NOT NULL,
  service_type          TEXT NOT NULL,
  description           TEXT NOT NULL,
  estimated_price       NUMERIC(15,2) NOT NULL,
  final_price           NUMERIC(15,2),
  tracking_mode         TEXT NOT NULL DEFAULT 'detail',
  labor_cost            NUMERIC(15,2) NOT NULL DEFAULT 0,
  lump_sum_hpp          NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp_owner_override    NUMERIC(15,2),
  hpp_final             NUMERIC(15,2),
  stock_adjustment_id   UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rakit_service_type     CHECK (service_type IN ('jasa_rakit', 'jasa_custom_panel')),
  CONSTRAINT chk_rakit_tracking_mode    CHECK (tracking_mode IN ('detail', 'lumpsum')),
  CONSTRAINT chk_rakit_prices_positive  CHECK (
    estimated_price > 0 AND (final_price IS NULL OR final_price > 0)
  ),
  CONSTRAINT chk_rakit_mode_consistency CHECK (
    (tracking_mode = 'detail' AND lump_sum_hpp = 0) OR
    (tracking_mode = 'lumpsum' AND labor_cost = 0)
  ),
  UNIQUE (transaction_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_rakit_lines_transaction ON public.rakit_job_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_rakit_lines_type ON public.rakit_job_lines(service_type);

-- 4. rakit_components: detail-mode komponen list per rakit line
CREATE TABLE IF NOT EXISTS public.rakit_components (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rakit_line_id         UUID NOT NULL REFERENCES public.rakit_job_lines(id) ON DELETE CASCADE,
  sku                   TEXT NOT NULL,
  name                  TEXT NOT NULL,
  qty                   NUMERIC(15,3) NOT NULL,
  warehouse             TEXT NOT NULL DEFAULT 'atas',
  fifo_cost_snapshot    NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rakit_comp_qty_pos     CHECK (qty > 0),
  CONSTRAINT chk_rakit_comp_warehouse   CHECK (warehouse IN ('atas', 'bawah'))
);

CREATE INDEX IF NOT EXISTS idx_rakit_components_line ON public.rakit_components(rakit_line_id);
CREATE INDEX IF NOT EXISTS idx_rakit_components_sku ON public.rakit_components(sku);

-- 5. rakit_audit_log: tracks all state transitions + edits
CREATE TABLE IF NOT EXISTS public.rakit_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES public.kasir_transactions(id) ON DELETE CASCADE,
  rakit_line_id   UUID REFERENCES public.rakit_job_lines(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  field_changed   TEXT,
  old_value       JSONB,
  new_value       JSONB,
  reason          TEXT,
  actor_id        UUID NOT NULL REFERENCES auth.users(id),
  actor_role      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_audit_action CHECK (action IN (
    'create','edit_cosmetic','edit_material','submit','withdraw','approve','reject','cancel','pelunasan'
  ))
);

CREATE INDEX IF NOT EXISTS idx_rakit_audit_transaction
  ON public.rakit_audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_rakit_audit_created
  ON public.rakit_audit_log(created_at DESC);

-- 6. View: forfeit revenue summary by month
CREATE OR REPLACE VIEW public.kasir_rakit_forfeit_summary AS
SELECT
  date_trunc('month', cancelled_at) AS month,
  SUM(cancel_forfeit_amount)        AS total_forfeit,
  COUNT(*)                          AS cancel_count
FROM public.kasir_transactions
WHERE status = 'CANCELLED'
  AND cancel_forfeit_amount IS NOT NULL
  AND cancel_forfeit_amount > 0
GROUP BY date_trunc('month', cancelled_at);

-- 7. RLS — enable on new tables, allow authenticated read/write (refined later)
ALTER TABLE public.rakit_job_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rakit_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rakit_audit_log  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rakit_job_lines' AND policyname = 'rakit_lines_all'
  ) THEN
    CREATE POLICY rakit_lines_all ON public.rakit_job_lines
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rakit_components' AND policyname = 'rakit_components_all'
  ) THEN
    CREATE POLICY rakit_components_all ON public.rakit_components
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rakit_audit_log' AND policyname = 'rakit_audit_all'
  ) THEN
    CREATE POLICY rakit_audit_all ON public.rakit_audit_log
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
