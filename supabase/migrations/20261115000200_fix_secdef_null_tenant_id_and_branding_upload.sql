-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000200 — Fix "new row violates RLS" for SECDEF RPCs that hardcode
-- tenant_id NULL, plus add authenticated-role write policy for `branding`
-- storage bucket so logo upload works for signed-in Owner accounts.
--
-- Reproduces the user-visible bugs:
--   1. Kas & Bank → Simpan Akun    → "new row violates RLS for cash_accounts"
--   2. Tambah Gudang               → "new row violates RLS for warehouses"
--   3. Upload logo                 → 42501 on storage.objects (branding)
--   4. Tambah service_type         → same failure mode as #2
--
-- Root cause (post Phase A):
-- * cash_accounts / warehouses / service_types / store_settings columns have
--   DEFAULT public._resolve_tenant_id(), and RLS `t_insert_own` requires
--   tenant_id = _resolve_tenant_id().
-- * SECDEF RPCs `create_warehouse` and `upsert_service_type` explicitly write
--   `VALUES (NULL, …)` for the tenant_id column, so the DEFAULT never fires
--   and RLS then compares NULL to the tenant UUID → false → 42501.
--
-- Also: `create_warehouse.v_first` checked `tenant_id IS NULL` — legacy
-- single-tenant logic. In the new world no row has NULL tenant_id, so v_first
-- was always TRUE → every new warehouse would be flagged is_default=true,
-- which then violates the `warehouses_one_default_per_tenant` partial UNIQUE
-- on the second insert.
--
-- Bug 2 (cash_accounts) is a client-side issue only — the RLS/DEFAULT stack
-- is already correct. Fixed in a separate client PR.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) create_warehouse: use _resolve_tenant_id() + fix v_first predicate ───
CREATE OR REPLACE FUNCTION public.create_warehouse(
  p_code text,
  p_name text,
  p_address text DEFAULT NULL::text,
  p_sort_order integer DEFAULT 100
)
RETURNS public.warehouses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  uuid := public._current_user_id();
  v_tenant uuid := public._resolve_tenant_id();
  v_first  boolean;
  v_row    public.warehouses;
BEGIN
  PERFORM public._guard_expiry_write();
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'create_warehouse: Owner role required';
  END IF;

  -- First warehouse for THIS tenant auto-gets is_default=true so the app is
  -- never without a default. The partial UNIQUE index
  -- (warehouses_one_default_per_tenant) enforces at-most-one is_default=true
  -- per tenant.
  v_first := NOT EXISTS (SELECT 1 FROM public.warehouses WHERE tenant_id = v_tenant);

  INSERT INTO public.warehouses (tenant_id, code, name, address, is_default, sort_order)
       VALUES (v_tenant, upper(p_code), p_name, p_address, v_first, p_sort_order)
  RETURNING * INTO v_row;

  INSERT INTO public.warehouse_audit_log (warehouse_id, actor_user_id, action, after)
       VALUES (v_row.id, v_actor, 'create', to_jsonb(v_row));

  RETURN v_row;
END $function$;

-- ─── 2) upsert_service_type: same NULL-tenant fix on the INSERT arm ──────────
CREATE OR REPLACE FUNCTION public.upsert_service_type(p_id bigint, p_input jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
  v_id   BIGINT;
BEGIN
  PERFORM public._guard_expiry_write();
  IF public._current_user_id() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan service_types needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = public._current_user_id();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan service_types requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.service_types (
      tenant_id, code, name, description, pricing_model, requires_material_lock,
      default_account_revenue, default_account_cogs, color_hex, is_active, display_order
    ) VALUES (
      public._resolve_tenant_id(),
      p_input->>'code',
      p_input->>'name',
      p_input->>'description',
      COALESCE(p_input->>'pricing_model', 'LUMP_SUM'),
      COALESCE((p_input->>'requires_material_lock')::BOOLEAN, FALSE),
      NULL, NULL,
      p_input->>'color_hex',
      COALESCE((p_input->>'is_active')::BOOLEAN, TRUE),
      COALESCE((p_input->>'display_order')::INTEGER, 0)
    ) RETURNING id INTO v_id;
    RETURN v_id;
  ELSE
    UPDATE public.service_types
       SET code                   = COALESCE(p_input->>'code', code),
           name                   = COALESCE(p_input->>'name', name),
           description            = CASE WHEN p_input ? 'description' THEN p_input->>'description' ELSE description END,
           pricing_model          = COALESCE(p_input->>'pricing_model', pricing_model),
           requires_material_lock = COALESCE((p_input->>'requires_material_lock')::BOOLEAN, requires_material_lock),
           color_hex              = CASE WHEN p_input ? 'color_hex' THEN p_input->>'color_hex' ELSE color_hex END,
           is_active              = COALESCE((p_input->>'is_active')::BOOLEAN, is_active),
           display_order          = COALESCE((p_input->>'display_order')::INTEGER, display_order),
           updated_at             = now()
     WHERE id = p_id;
    RETURN p_id;
  END IF;
END $function$;

-- ─── 3) branding bucket: allow authenticated to write ────────────────────────
-- Prior state only granted `anon` INSERT/UPDATE/DELETE, so signed-in Owner
-- accounts hit RLS 42501 when uploading logos. Keep the anon policy in place
-- (unused today; harmless) and add a parallel authenticated policy.
DROP POLICY IF EXISTS branding_authenticated_write ON storage.objects;
CREATE POLICY branding_authenticated_write
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'branding')
  WITH CHECK (bucket_id = 'branding');

COMMIT;
