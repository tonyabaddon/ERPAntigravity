-- Phase 1 follow-up (2026-07-22): three fixes to make deprovision_tenant
-- actually work end-to-end, captured after a dry-run exposed all three:
--
--   1. Ownership drift — deprovision_tenant was flipped to postgres via
--      ad-hoc psql during the dry-run to unblock cleanup. Same reason as
--      mig 511: SECDEF owned by vosi_rpc_owner cannot read auth.users
--      or platform_admins under RLS. This mig makes that flip durable.
--
--   2. Orphan rows — deprovision_tenant body deletes admin_users,
--      tenant_users, store_settings, tenant_subscriptions, then tenants.
--      It does NOT clean up accounting_config, cash_accounts, or
--      chart_of_accounts (~72 rows per tenant). Those get left orphaned
--      after every deprovision. Explicit DELETEs added in dependency
--      order (accounting_config → cash_accounts → chart_of_accounts).
--
--   3. Audit trigger self-FK — _audit_row_change() on tenants DELETE
--      INSERTs into audit_log with FK to tenants(id) that's being
--      deleted in the same statement → 23503 constraint violation.
--      Fix: skip the auto-audit row when TG_OP='DELETE' AND
--      TG_TABLE_NAME='tenants'. The DEPROVISION_TENANT action is
--      already captured in platform_admin_audit with the full snapshot,
--      so no audit info is lost.
--
-- Verified via psql dry-run of provision + deprovision on a throwaway
-- tenant (2026-07-22 17:15). Cleanup succeeded with 0 orphan rows.

-- ─── Fix 1: capture ownership drift ─────────────────────────────────────
ALTER FUNCTION public.deprovision_tenant(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.deprovision_tenant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deprovision_tenant(uuid, text) TO authenticated;

-- ─── Fix 2 + 3: rewrite deprovision_tenant body ──────────────────────────
CREATE OR REPLACE FUNCTION public.deprovision_tenant(p_tenant_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_snapshot JSONB;
BEGIN
  -- Auth gate: super_admin ONLY
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED'
      USING errcode = 'P0403';
  END IF;

  -- Snapshot for audit
  SELECT to_jsonb(t.*) INTO v_tenant_snapshot
  FROM public.tenants t WHERE t.id = p_tenant_id;

  IF v_tenant_snapshot IS NULL THEN
    RAISE EXCEPTION 'deprovision_tenant: tenant % not found', p_tenant_id
      USING errcode = 'P0002';
  END IF;

  -- Audit trail FIRST — while FK on tenants(id) is still valid.
  -- After DELETE FROM tenants below, platform_admin_audit.tenant_id will be
  -- SET NULL by the FK cascade; the snapshot in detail preserves the id.
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.platform_admins WHERE user_id = auth.uid()),
    p_tenant_id,
    'DEPROVISION_TENANT',
    jsonb_build_object(
      'tenant_snapshot', v_tenant_snapshot,
      'reason',          p_reason
    )
  );

  -- Explicit deletes for tables that are CASCADE but we want guaranteed order,
  -- plus any tables with FK policies that need explicit removal.
  DELETE FROM public.admin_users          WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_users         WHERE tenant_id = p_tenant_id;
  DELETE FROM public.store_settings       WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;

  -- Accounting-related rows: order matters (accounting_config FKs to
  -- cash_accounts.default_kas_account_id; cash_accounts FKs to
  -- chart_of_accounts.coa_account_id).
  DELETE FROM public.accounting_config    WHERE tenant_id = p_tenant_id;
  DELETE FROM public.cash_accounts        WHERE tenant_id = p_tenant_id;
  DELETE FROM public.chart_of_accounts    WHERE tenant_id = p_tenant_id;

  -- Delete the tenant row — remaining FKs with ON DELETE CASCADE fire here.
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'deleted_slug', v_tenant_snapshot->>'slug',
    'deleted_at',   now(),
    'actor',        auth.uid()
  );
END;
$function$;

ALTER FUNCTION public.deprovision_tenant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deprovision_tenant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deprovision_tenant(uuid, text) TO authenticated;

-- ─── Fix 3: audit trigger skip for tenants DELETE ────────────────────────
CREATE OR REPLACE FUNCTION public._audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_uid uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_tenant_id uuid;
  v_row_id text;
  v_payload jsonb;
BEGIN
  -- Skip auto-audit for tenants DELETE: audit_log has ON DELETE CASCADE FK
  -- to tenants(id), so inserting a new row referencing a row being deleted
  -- in the same statement triggers 23503. The DEPROVISION_TENANT action is
  -- captured in platform_admin_audit with the full snapshot instead.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'tenants' THEN
    RETURN OLD;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    IF TG_TABLE_NAME = 'plans' THEN
      v_tenant_id := '00000000-0000-0000-0000-000000000000'::uuid;
      v_row_id := (to_jsonb(OLD)->>'code');
    ELSE
      v_tenant_id := (to_jsonb(OLD)->>'tenant_id')::uuid;
      v_row_id := COALESCE(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'user_id', '');
    END IF;
    -- Skip auto-audit if the referenced tenant is already gone (cascaded
    -- DELETE from a tenant DELETE). Same FK issue as tenants-DELETE case.
    IF v_tenant_id IS NOT NULL
       AND v_tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id) THEN
      RETURN OLD;
    END IF;
    v_payload := jsonb_build_object('op', 'DELETE', 'table', TG_TABLE_NAME, 'old', to_jsonb(OLD));
  ELSE
    IF TG_TABLE_NAME = 'tenants' THEN
      v_tenant_id := NEW.id;
      v_row_id := NEW.id::text;
    ELSIF TG_TABLE_NAME = 'plans' THEN
      v_tenant_id := '00000000-0000-0000-0000-000000000000'::uuid;
      v_row_id := (to_jsonb(NEW)->>'code');
    ELSE
      v_tenant_id := (to_jsonb(NEW)->>'tenant_id')::uuid;
      v_row_id := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'user_id', '');
    END IF;
    v_payload := jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME, 'row_id', v_row_id, 'new', to_jsonb(NEW));
    IF TG_OP = 'UPDATE' THEN
      v_payload := v_payload || jsonb_build_object('old', to_jsonb(OLD));
    END IF;
  END IF;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_user_id, event_type, payload)
  VALUES (v_tenant_id, v_actor_uid, 'row_change:' || TG_TABLE_NAME || ':' || TG_OP, v_payload);

  RETURN COALESCE(NEW, OLD);
END;
$function$;
