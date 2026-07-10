BEGIN;

-- Task 16 (Wave 6, dispatched early): extend platform_admin_audit action CHECK
-- to permit new audit action values emitted by Tasks 4/6/9/11/13/14.
--
-- Existing 16 values (Wave 4a/5) are preserved verbatim from prod snapshot.
-- 7 new Wave 6 values are appended.
--
-- Retargeted from plan's audit_log/event_type (tenant-scope) to
-- platform_admin_audit/action (platform-scope) after MCP-verified schema.

ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT IF EXISTS platform_admin_audit_action_check;

ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    -- Existing Wave 4a/5 values (verbatim from prod snapshot)
    'IMPERSONATE_START', 'IMPERSONATE_END',
    'CREATE_TENANT', 'CHANGE_PLAN', 'CHANGE_FEATURES',
    'SUSPEND', 'ACTIVATE', 'ARCHIVE', 'RENEW_SUBSCRIPTION',
    'SUSPEND_TENANT', 'ACTIVATE_TENANT', 'UPDATE_PLAN',
    'RECORD_PAYMENT', 'UPDATE_PAYMENT', 'DELETE_PAYMENT', 'UPLOAD_PAYMENT_PROOF',
    -- Wave 6 additions
    'PROVISION_TENANT', 'DEPROVISION_TENANT',
    'CREATE_SALES_REP', 'DEACTIVATE_SALES_REP',
    'TOGGLE_MODULE',
    'VERIFY_PAYMENT', 'REJECT_PAYMENT'
  ));

COMMIT;
