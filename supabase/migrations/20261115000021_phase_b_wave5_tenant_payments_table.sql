BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 2
-- tenant_payments table + indexes + FORCE RLS + audit CHECK extension
--
-- Schema drift corrections:
--   • spec said `audit_id UUID REFERENCES platform_admin_audit(id)`
--     but platform_admin_audit.id is BIGINT (Wave 1 Task 3 finding).
--     Using BIGINT here.
--
-- Verified via MCP before writing:
--   • platform_admin_audit.id is bigint ✓
--   • auth.users cross-schema FK is permitted (kasir_transactions,
--     stock_adjustments both reference auth.users from public schema) ✓
--   • vosi_rpc_owner role exists ✓
--   • tenant_activity_daily policy uses same {authenticated,vosi_rpc_owner}
--     + _is_platform_admin_from_jwt() shape — mirrored exactly here ✓
--   • Current audit CHECK has 12 codes (through UPDATE_PLAN); adding 4 more ✓
-- ============================================================

-- ── Step 1: Extend platform_admin_audit action CHECK whitelist ───────────────
-- Cumulative set (union of all prior slots + Wave 5 Task 2 additions):
--   Wave 1 seed:     IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT,
--                    CHANGE_PLAN, CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE
--   Wave 4a Task 1:  RENEW_SUBSCRIPTION
--   Wave 4a Task 2:  SUSPEND_TENANT, ACTIVATE_TENANT
--   Wave 4a Task 3:  UPDATE_PLAN
--   Wave 5 Task 2:   RECORD_PAYMENT, UPDATE_PAYMENT, DELETE_PAYMENT,
--                    UPLOAD_PAYMENT_PROOF  (this migration)

ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT IF EXISTS platform_admin_audit_action_check;

ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
    CHECK (action = ANY (ARRAY[
      'IMPERSONATE_START'::text,
      'IMPERSONATE_END'::text,
      'CREATE_TENANT'::text,
      'CHANGE_PLAN'::text,
      'CHANGE_FEATURES'::text,
      'SUSPEND'::text,
      'ACTIVATE'::text,
      'ARCHIVE'::text,
      'RENEW_SUBSCRIPTION'::text,
      'SUSPEND_TENANT'::text,
      'ACTIVATE_TENANT'::text,
      'UPDATE_PLAN'::text,
      'RECORD_PAYMENT'::text,
      'UPDATE_PAYMENT'::text,
      'DELETE_PAYMENT'::text,
      'UPLOAD_PAYMENT_PROOF'::text
    ]));

-- ── Step 2: Create tenant_payments table ────────────────────────────────────

CREATE TABLE public.tenant_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'IDR',
  payment_method      TEXT NOT NULL CHECK (payment_method IN (
    'BANK_TRANSFER','CASH','E_WALLET','QRIS','VIRTUAL_ACCOUNT','OTHER'
  )),
  bank_name           TEXT CHECK (bank_name IN (
    'BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','BSI','DANAMON',
    'BTN','MEGA','MAYBANK','PANIN','OCBC','JAGO','SEA_BANK','OTHER'
  ) OR bank_name IS NULL),
  ewallet_provider    TEXT CHECK (ewallet_provider IN (
    'OVO','GOPAY','DANA','LINKAJA','SHOPEEPAY','JENIUS_PAY','OTHER'
  ) OR ewallet_provider IS NULL),
  payment_date        DATE NOT NULL,
  period_from         DATE NOT NULL,
  period_to           DATE NOT NULL CHECK (period_to >= period_from),
  proof_url           TEXT,
  bank_reference      TEXT,
  notes               TEXT,
  recorded_by_admin   UUID NOT NULL REFERENCES auth.users(id),
  audit_id            BIGINT REFERENCES public.platform_admin_audit(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_bank_required CHECK (
    (payment_method IN ('BANK_TRANSFER','VIRTUAL_ACCOUNT') AND bank_name IS NOT NULL)
    OR payment_method NOT IN ('BANK_TRANSFER','VIRTUAL_ACCOUNT')
  ),
  CONSTRAINT payment_ewallet_required CHECK (
    (payment_method IN ('E_WALLET','QRIS') AND ewallet_provider IS NOT NULL)
    OR payment_method NOT IN ('E_WALLET','QRIS')
  )
);

-- ── Step 3: Indexes ──────────────────────────────────────────────────────────

CREATE INDEX idx_tenant_payments_tenant_date
  ON public.tenant_payments(tenant_id, payment_date DESC);

CREATE INDEX idx_tenant_payments_period
  ON public.tenant_payments(period_from, period_to);

-- ── Step 4: updated_at auto-touch trigger ────────────────────────────────────
-- Consistent with all other tables in this project that carry updated_at.

CREATE TRIGGER tenant_payments_set_updated_at
  BEFORE UPDATE ON public.tenant_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Step 5: Table comment ────────────────────────────────────────────────────

COMMENT ON TABLE public.tenant_payments IS
  'category=P; VOSI revenue tracking (manual entry).';

-- ── Step 6: FORCE RLS + policy ───────────────────────────────────────────────
-- Same shape as tenant_activity_daily: PERMISSIVE FOR ALL,
-- TO authenticated, vosi_rpc_owner, USING + WITH CHECK = _is_platform_admin_from_jwt().

ALTER TABLE public.tenant_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY p_platform_admin_only ON public.tenant_payments
  AS PERMISSIVE FOR ALL
  TO authenticated, vosi_rpc_owner
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());

COMMIT;
