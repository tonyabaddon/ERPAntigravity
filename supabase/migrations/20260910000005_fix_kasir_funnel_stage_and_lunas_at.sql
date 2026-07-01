-- 20260910000005 — fix kasir_transactions.funnel_stage / funnel_sub_stage /
--                   lunas_at population + backfill historical rows
--
-- Bug found during E2E audit on 2026-07-01 (invoice WLK-20260701-001):
-- `record_kasir_sale` writes a PAID+LUNAS row but the DB shows
-- `funnel_stage=1`, `funnel_sub_stage='1a'`, `lunas_at=NULL`. Confusing on
-- Daftar Pesanan funnel screen (PAID rows landing in "Bertanya" instead of
-- "Diterima"), and downstream analytics that count `lunas_at IS NOT NULL`
-- for lunas-time-to-close never fire.
--
-- ROOT CAUSE
--
-- Column defaults from 20260625000001_funnel_stage_columns.sql:
--   funnel_stage smallint NOT NULL DEFAULT 1
--   funnel_sub_stage text NOT NULL DEFAULT '1a'
--   lunas_at timestamptz NULL   (no default)
--
-- The `record_kasir_sale` RPC INSERT (per 20260723000002 phase0b_dual_write,
-- 20260801000004 with_discount, 20260901000005 tier) never sets any of
-- these — it relies on defaults. There is no trigger to map status → stage
-- on INSERT.
--
-- Backfill in 20260625000005 fixed the batch that existed as of that date
-- (65 rows landed at funnel_stage=5). Everything committed AFTER Jun 13
-- with status=PAID has been stuck at funnel_stage=1 / '1a' ever since:
--   SELECT count(*) FROM kasir_transactions
--    WHERE status='PAID' AND funnel_stage=1;  -- 23 rows on 2026-07-02
--
-- `lunas_at` is worse — no code path sets it. All 88 PAID rows have it NULL.
--
-- FIX
--
-- 1. Trigger `kasir_status_derives_funnel_and_lunas`: BEFORE INSERT OR
--    UPDATE OF status. Derives funnel_stage / funnel_sub_stage / lunas_at
--    from `status` using the same mapping as 20260625000005 backfill:
--
--      status                    → (funnel_stage, funnel_sub_stage, lunas_at)
--      PAID / LUNAS / COMPLETED  → (5, '5a', COALESCE(NEW.lunas_at, now()))
--      WIP / PENDING_LOCK_APPROVAL / AWAITING_LUNAS / INVOICE_TEMPO
--                                → (3, sub_map, NEW.lunas_at)
--      CANCELLED                 → (6, '6a', NEW.lunas_at)
--      NULL / other              → leave as-is (default 1/'1a' fires)
--
--    Only overwrites funnel_stage/funnel_sub_stage when the incoming values
--    still match the default (1, '1a') — respects any caller that already
--    supplied explicit stage. Same guard as the 20260625000005 backfill.
--
--    On UPDATE OF status: only recomputes when the status actually
--    transitioned into a lunas-family status (idempotent replays are safe).
--
-- 2. Backfill any historical rows that got stuck.
--
-- Follow-up NOT included: `funnel_stage=3` mapping requires knowing the
-- sub-stage from more than just `status` (WIP → '3a' vs. PENDING_LOCK
-- → '3g'). The trigger uses the same lookup as the backfill migration.
-- If a future spec adds more granular sub-stages, adjust the CASE.

CREATE OR REPLACE FUNCTION public.kasir_derive_stage_and_lunas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fire for income-type rows (skip expenses, adjustments, etc.)
  IF NEW.type IS DISTINCT FROM 'income' THEN
    RETURN NEW;
  END IF;

  -- Map status → (stage, sub_stage). Preserve explicit non-default caller
  -- values by only overwriting when funnel_stage/funnel_sub_stage match
  -- the column defaults (1, '1a').
  IF NEW.funnel_stage = 1 AND NEW.funnel_sub_stage = '1a' AND NEW.status IS NOT NULL THEN
    CASE NEW.status
      WHEN 'PAID', 'LUNAS', 'COMPLETED' THEN
        NEW.funnel_stage    := 5::smallint;
        NEW.funnel_sub_stage := '5a';
      WHEN 'WIP' THEN
        NEW.funnel_stage    := 3::smallint;
        NEW.funnel_sub_stage := '3a';
      WHEN 'PENDING_LOCK_APPROVAL' THEN
        NEW.funnel_stage    := 3::smallint;
        NEW.funnel_sub_stage := '3g';
      WHEN 'AWAITING_LUNAS' THEN
        NEW.funnel_stage    := 3::smallint;
        NEW.funnel_sub_stage := '3d';
      WHEN 'INVOICE_TEMPO' THEN
        NEW.funnel_stage    := 3::smallint;
        NEW.funnel_sub_stage := '3a';
      WHEN 'CANCELLED' THEN
        NEW.funnel_stage    := 6::smallint;
        NEW.funnel_sub_stage := '6a';
      ELSE
        NULL;  -- unknown status → leave defaults
    END CASE;
  END IF;

  -- lunas_at: set to now() when transitioning INTO a lunas-family status
  -- and it's still NULL. Idempotent replay-safe: does not overwrite an
  -- already-set value.
  IF NEW.lunas_at IS NULL AND NEW.status IN ('PAID', 'LUNAS', 'COMPLETED') THEN
    NEW.lunas_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kasir_derive_stage_and_lunas_ins ON public.kasir_transactions;
CREATE TRIGGER trg_kasir_derive_stage_and_lunas_ins
  BEFORE INSERT ON public.kasir_transactions
  FOR EACH ROW EXECUTE FUNCTION public.kasir_derive_stage_and_lunas();

DROP TRIGGER IF EXISTS trg_kasir_derive_stage_and_lunas_upd ON public.kasir_transactions;
CREATE TRIGGER trg_kasir_derive_stage_and_lunas_upd
  BEFORE UPDATE OF status ON public.kasir_transactions
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.kasir_derive_stage_and_lunas();

-- Backfill: fix the 23 stuck PAID rows + populate lunas_at for all 88
-- historical PAID rows that were missing it. Uses `date` as a best-guess
-- proxy for lunas_at since we don't have the original timestamp — better
-- than NULL for analytics that check `lunas_at IS NOT NULL`.

UPDATE public.kasir_transactions
SET funnel_stage = 5::smallint,
    funnel_sub_stage = '5a',
    lunas_at = COALESCE(lunas_at, (date::timestamp AT TIME ZONE 'Asia/Jakarta'))
WHERE type = 'income'
  AND status IN ('PAID', 'LUNAS', 'COMPLETED')
  AND (
    (funnel_stage = 1 AND funnel_sub_stage = '1a')
    OR lunas_at IS NULL
  );
