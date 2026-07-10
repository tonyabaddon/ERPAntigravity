-- Migration 20261115000035: deprovision_tenant RPC
-- Wave 6 Task 6: hard-delete a tenant atomically (super_admin only).
--
-- FK blockers found and resolved:
--   1. platform_admin_audit.tenant_id FK was ON DELETE NO ACTION → SET NULL
--      (audit rows survive; tenant_id becomes null after cascade; detail->tenant_snapshot preserved)
--   2. tenant_payments.tenant_id FK was ON DELETE RESTRICT → SET NULL
--      (preserves platform revenue history; unlinks from deleted tenant)
--
-- Execution order inside the RPC:
--   1. Snapshot tenant row
--   2. Insert audit row WHILE tenant still exists (FK = valid at INSERT time)
--   3. Delete explicit non-cascade tables: admin_users, tenant_users, store_settings, tenant_subscriptions
--   4. DELETE FROM tenants → FK cascade handles all other tenant-scoped tables
--      → platform_admin_audit.tenant_id and tenant_payments.tenant_id SET NULL automatically

-- ── FK patches ────────────────────────────────────────────────────────────────

ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_tenant_id_fkey,
  ADD CONSTRAINT platform_admin_audit_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

ALTER TABLE public.tenant_payments
  DROP CONSTRAINT tenant_payments_tenant_id_fkey,
  ADD CONSTRAINT tenant_payments_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

-- ── RPC ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.deprovision_tenant(
  p_tenant_id UUID,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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
  DELETE FROM public.admin_users         WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_users        WHERE tenant_id = p_tenant_id;
  DELETE FROM public.store_settings      WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;

  -- Delete the tenant row — remaining FKs with ON DELETE CASCADE fire here.
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'deleted_slug', v_tenant_snapshot->>'slug',
    'deleted_at',   now(),
    'actor',        auth.uid()
  );
END;
$function$;

ALTER FUNCTION public.deprovision_tenant(UUID, TEXT) OWNER TO postgres;
REVOKE ALL   ON FUNCTION public.deprovision_tenant(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deprovision_tenant(UUID, TEXT) TO authenticated;
