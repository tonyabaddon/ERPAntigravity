-- Migration: kasir_discount approval gate — enum + columns (Item #4, slot 110)
-- Extends approval_settings framework validated in Item #1.
-- Additive schema only. No behavior change until tenant toggles approval_required=true.
--
-- NOTE: ALTER TYPE ADD VALUE cannot be used in the same transaction as an INSERT
-- that references the new enum value (Postgres error 55P04). Seed rows are in
-- slot 111 (20261115000111_kasir_discount_seed.sql) which runs after this commit.

-- 1. Enum extension
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'approval_request_type' AND e.enumlabel = 'kasir_discount') THEN
    ALTER TYPE public.approval_request_type ADD VALUE 'kasir_discount';
  END IF;
END $$;

-- 2. Columns on kasir_transactions
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS discount_approval_request_id BIGINT REFERENCES public.approval_requests(id),
  ADD COLUMN IF NOT EXISTS discount_approval_status TEXT
    CHECK (discount_approval_status IS NULL
        OR discount_approval_status IN ('awaiting','approved','rejected','canceled'));
