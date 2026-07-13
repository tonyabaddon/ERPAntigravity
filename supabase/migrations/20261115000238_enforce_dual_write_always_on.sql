-- Slot 238 — W2 fix: enforce enable_dual_write_to_gl = TRUE for every tenant.
--
-- Audit W2: `enable_dual_write_to_gl` is checked by ~20 JE-posting RPCs but
-- has been TRUE for every tenant since inception. It is dead-weight optional-
-- ity. The audit recommended dropping the gate entirely; that would require
-- rewriting every RPC body. Compromise: keep the column (RPCs still read it,
-- no-op impact), but enforce it TRUE via CHECK so it cannot be flipped OFF.
-- New tenants seeded via _seed_tenant_accounting default TRUE already.
--
-- Follow-up: as each JE-posting RPC gets its next refactor, drop the
-- `IF v_dual_write THEN` guard. Not batched today to avoid a monster diff.
--
-- Idempotent: DROP IF EXISTS on the constraint, then ADD.

-- Step 1: force any legacy NULL/FALSE row to TRUE (defensive, all 3 current tenants already TRUE)
UPDATE public.accounting_config
   SET enable_dual_write_to_gl = TRUE
 WHERE enable_dual_write_to_gl IS DISTINCT FROM TRUE;

-- Step 2: enforce via CHECK
ALTER TABLE public.accounting_config
  DROP CONSTRAINT IF EXISTS chk_dual_write_always_on;

ALTER TABLE public.accounting_config
  ADD CONSTRAINT chk_dual_write_always_on
  CHECK (enable_dual_write_to_gl = TRUE);

-- Step 3: also enforce default TRUE (redundant with existing default, but explicit)
ALTER TABLE public.accounting_config
  ALTER COLUMN enable_dual_write_to_gl SET DEFAULT TRUE;

ALTER TABLE public.accounting_config
  ALTER COLUMN enable_dual_write_to_gl SET NOT NULL;

COMMENT ON COLUMN public.accounting_config.enable_dual_write_to_gl IS
  'DEPRECATED — always TRUE (enforced by chk_dual_write_always_on). Kept for backward compatibility with existing RPCs that guard on it; drop when individual RPCs are next refactored.';
