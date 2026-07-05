-- Phase B Wave 5 — Task 1
-- Extends plans with price_annual (IDR) + seed the 3 known plan codes.
-- Founder can edit via /admin/plans (Wave 4a Task 8a update_plan_admin RPC —
-- price_annual will need to be added to the update_plan_admin whitelist in a
-- follow-up Wave 5 hotfix if founder wants to edit prices via UI; for now the
-- seed is the source of truth).

BEGIN;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_annual NUMERIC(15, 2);

UPDATE public.plans SET price_annual = 1200000 WHERE code = 'STARTER' AND price_annual IS NULL;
UPDATE public.plans SET price_annual = 3600000 WHERE code = 'PRO'     AND price_annual IS NULL;
UPDATE public.plans SET price_annual = 9000000 WHERE code = 'PREMIUM' AND price_annual IS NULL;

COMMIT;
