-- Migration 332: P2-#7 audit log sweep via row-level triggers.
--
-- Rather than manually instrumenting 50+ RPCs (each ~10-15 min careful work),
-- install a generic AFTER trigger on high-risk tables that captures
-- INSERT/UPDATE/DELETE with actor + row diff. Complements existing per-RPC
-- instrumentation on top revenue-path RPCs (kasir_sale, tempo_invoice,
-- pembayaran per migration 000325).
--
-- Design:
--   - Function public._audit_row_change() — SECDEF, owner vosi_rpc_owner.
--   - Payload includes op, table, actor UID (from JWT), row_id, full new+old
--     column values (as jsonb).
--   - Tenant ID: NEW.tenant_id / OLD.tenant_id, or NEW.id for the tenants
--     table itself, or zero-UUID marker for global tables (plans).
--   - New policy p_audit_trigger_insert on audit_log allows vosi_rpc_owner
--     to INSERT any row (trusted trigger context, distinct from per-tenant
--     t_insert_own).
--
-- Tables in scope for this migration (10 highest-risk):
--   1. tenants                — tenant lifecycle
--   2. tenant_users           — access control + role changes
--   3. tenant_subscriptions   — plan + feature_overrides changes
--   4. plans                  — plan definition changes
--   5. platform_admins        — platform admin add/remove
--   6. chart_of_accounts      — COA config
--   7. bank_accounts          — bank account changes
--   8. cash_accounts          — cash account changes
--   9. store_settings         — store-wide config
--  10. company_settings       — company-wide config
--
-- Follow-up (Phase 3): expand to payment tables (pembayaran*, payments*),
-- journal_entries + journal_entry_lines. Deferred here because payment path
-- is already partially covered by per-RPC audit (record_pembayaran).
--
-- Idempotent per CLAUDE.md.

BEGIN;

DROP POLICY IF EXISTS p_audit_trigger_insert ON public.audit_log;
CREATE POLICY p_audit_trigger_insert ON public.audit_log
  FOR INSERT
  TO vosi_rpc_owner
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_uid uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_tenant_id uuid;
  v_row_id text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF TG_TABLE_NAME = 'tenants' THEN
      v_tenant_id := OLD.id;
      v_row_id := OLD.id::text;
    ELSIF TG_TABLE_NAME = 'plans' THEN
      v_tenant_id := '00000000-0000-0000-0000-000000000000'::uuid;
      v_row_id := (to_jsonb(OLD)->>'code');
    ELSE
      v_tenant_id := (to_jsonb(OLD)->>'tenant_id')::uuid;
      v_row_id := COALESCE(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'user_id', '');
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
$$;

ALTER FUNCTION public._audit_row_change() OWNER TO vosi_rpc_owner;

-- Idempotent trigger installation on 10 highest-risk tables
DO $mig$
DECLARE
  v_tables text[] := ARRAY[
    'tenants', 'tenant_users', 'tenant_subscriptions', 'plans',
    'platform_admins', 'chart_of_accounts', 'bank_accounts',
    'cash_accounts', 'store_settings', 'company_settings'
  ];
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', v_tbl);
    EXECUTE format(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public._audit_row_change()',
      v_tbl
    );
  END LOOP;
END $mig$;

COMMIT;
