-- Backfill funnel_stage + funnel_sub_stage from legacy status enum.
-- Only touch rows still at default (funnel_stage=1, funnel_sub_stage='1a') to be idempotent.
UPDATE kasir_transactions
SET
  funnel_sub_stage = CASE status
    WHEN 'WIP' THEN '3a'
    WHEN 'PENDING_LOCK_APPROVAL' THEN '3g'
    WHEN 'AWAITING_LUNAS' THEN '3d'
    WHEN 'LUNAS' THEN '5a'
    WHEN 'PAID' THEN '5a'
    WHEN 'COMPLETED' THEN '5a'
    WHEN 'CANCELLED' THEN '6a'
    WHEN 'INVOICE_TEMPO' THEN '3a'
    ELSE funnel_sub_stage
  END,
  funnel_stage = CASE status
    WHEN 'WIP' THEN 3::smallint
    WHEN 'PENDING_LOCK_APPROVAL' THEN 3::smallint
    WHEN 'AWAITING_LUNAS' THEN 3::smallint
    WHEN 'LUNAS' THEN 5::smallint
    WHEN 'PAID' THEN 5::smallint
    WHEN 'COMPLETED' THEN 5::smallint
    WHEN 'CANCELLED' THEN 6::smallint
    WHEN 'INVOICE_TEMPO' THEN 3::smallint
    ELSE funnel_stage
  END
WHERE type = 'income'
  AND funnel_stage = 1
  AND funnel_sub_stage = '1a'
  AND status IS NOT NULL
  AND status IN ('WIP', 'PENDING_LOCK_APPROVAL', 'AWAITING_LUNAS', 'LUNAS', 'PAID', 'COMPLETED', 'CANCELLED', 'INVOICE_TEMPO');
