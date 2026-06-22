-- supabase/migrations/20260622000007_pengaturan_write_rpcs.sql
-- Phase 1 final-review fix C1: SECURITY DEFINER mutation RPCs for Pengaturan panels.
--
-- Background: migrations 1/3/4 REVOKE INSERT/UPDATE/DELETE FROM authenticated on
-- approval_settings, tenant_settings, service_types. The 4 Pengaturan panels were
-- shipping with direct PostgREST .update()/.insert() calls — every save would 403
-- at runtime. This was masked by mocked unit tests.
--
-- Defense-in-depth: each RPC is SECURITY DEFINER + role-gated to Owner /
-- Staff Admin Toko (matches feedback_cost_upgrade_approval memory + Garindo's
-- single-tenant Owner=Admin model). Mirrors the pattern used in mig
-- 20260622000005 / 20260622000006 for the new Pembelian approval RPCs.
--
-- Phase 1: tenant_id IS NULL filter assumes single-tenant singleton row.

-- ─── 1. approval_settings.set_approval_setting ────────────────────────
CREATE OR REPLACE FUNCTION public.set_approval_setting(
  p_request_type public.approval_request_type,
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan approval needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  -- Defense-in-depth: NULL v_role (no admin_users row) must FAIL CLOSED, not pass.
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan approval requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  UPDATE public.approval_settings
     SET approval_required     = COALESCE((p_patch->>'approval_required')::BOOLEAN, approval_required),
         verification_method   = COALESCE(p_patch->>'verification_method', verification_method),
         threshold_amount      = CASE WHEN p_patch ? 'threshold_amount'
                                      THEN NULLIF(p_patch->>'threshold_amount', '')::NUMERIC
                                      ELSE threshold_amount END,
         threshold_qty         = CASE WHEN p_patch ? 'threshold_qty'
                                      THEN NULLIF(p_patch->>'threshold_qty', '')::INTEGER
                                      ELSE threshold_qty END,
         threshold_percent     = CASE WHEN p_patch ? 'threshold_percent'
                                      THEN NULLIF(p_patch->>'threshold_percent', '')::NUMERIC
                                      ELSE threshold_percent END,
         approver_role         = COALESCE(p_patch->>'approver_role', approver_role),
         requestor_bypass_self = COALESCE((p_patch->>'requestor_bypass_self')::BOOLEAN, requestor_bypass_self),
         reason_required       = COALESCE((p_patch->>'reason_required')::BOOLEAN, reason_required),
         updated_at            = now(),
         updated_by            = auth.uid()
   WHERE request_type = p_request_type
     AND tenant_id IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.set_approval_setting(public.approval_request_type, JSONB) TO authenticated;

-- ─── 2. tenant_settings.set_tenant_modul ──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_tenant_modul(
  p_key TEXT,
  p_value BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_sql  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan modul needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan modul requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  -- Whitelist guard — prevents arbitrary column injection via p_key.
  IF p_key NOT IN (
    'modul_kasir', 'modul_tempo', 'modul_pengiriman',
    'modul_multi_warehouse', 'modul_akuntansi',
    'modul_jasa_layanan', 'modul_bom_recipe'
  ) THEN
    RAISE EXCEPTION 'INVALID_MODUL_KEY: %', p_key;
  END IF;

  v_sql := format(
    'UPDATE public.tenant_settings SET %I = $1, updated_at = now(), updated_by = $2 WHERE tenant_id IS NULL',
    p_key
  );
  EXECUTE v_sql USING p_value, auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.set_tenant_modul(TEXT, BOOLEAN) TO authenticated;

-- ─── 3. tenant_settings.set_tenant_pajak ──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_tenant_pajak(
  p_patch JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan pajak needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan pajak requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  UPDATE public.tenant_settings
     SET pajak_mode               = COALESCE(p_patch->>'pajak_mode', pajak_mode),
         pajak_ppn_rate_umum      = COALESCE((p_patch->>'pajak_ppn_rate_umum')::NUMERIC, pajak_ppn_rate_umum),
         pajak_ppn_rate_mewah     = COALESCE((p_patch->>'pajak_ppn_rate_mewah')::NUMERIC, pajak_ppn_rate_mewah),
         pajak_final_rate         = COALESCE((p_patch->>'pajak_final_rate')::NUMERIC, pajak_final_rate),
         pajak_umkm_jenis_badan   = COALESCE(p_patch->>'pajak_umkm_jenis_badan', pajak_umkm_jenis_badan),
         pajak_umkm_terdaftar_at  = CASE WHEN p_patch ? 'pajak_umkm_terdaftar_at'
                                         THEN NULLIF(p_patch->>'pajak_umkm_terdaftar_at', '')::DATE
                                         ELSE pajak_umkm_terdaftar_at END,
         pajak_umkm_expires_at    = CASE WHEN p_patch ? 'pajak_umkm_expires_at'
                                         THEN NULLIF(p_patch->>'pajak_umkm_expires_at', '')::DATE
                                         ELSE pajak_umkm_expires_at END,
         pajak_npwp               = CASE WHEN p_patch ? 'pajak_npwp'
                                         THEN p_patch->>'pajak_npwp'
                                         ELSE pajak_npwp END,
         pajak_nik_as_npwp        = COALESCE((p_patch->>'pajak_nik_as_npwp')::BOOLEAN, pajak_nik_as_npwp),
         pajak_efaktur_enabled    = COALESCE((p_patch->>'pajak_efaktur_enabled')::BOOLEAN, pajak_efaktur_enabled),
         pajak_pkp_registered_at  = CASE WHEN p_patch ? 'pajak_pkp_registered_at'
                                         THEN NULLIF(p_patch->>'pajak_pkp_registered_at', '')::DATE
                                         ELSE pajak_pkp_registered_at END,
         pajak_coretax_id         = CASE WHEN p_patch ? 'pajak_coretax_id'
                                         THEN p_patch->>'pajak_coretax_id'
                                         ELSE pajak_coretax_id END,
         updated_at               = now(),
         updated_by               = auth.uid()
   WHERE tenant_id IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.set_tenant_pajak(JSONB) TO authenticated;

-- ─── 4. service_types.upsert_service_type ─────────────────────────────
-- p_id NULL  → INSERT, returns new id
-- p_id set   → UPDATE, returns same id
CREATE OR REPLACE FUNCTION public.upsert_service_type(
  p_id BIGINT,
  p_input JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_id   BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan service_types needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan service_types requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.service_types (
      tenant_id,
      code,
      name,
      description,
      pricing_model,
      requires_material_lock,
      default_account_revenue,
      default_account_cogs,
      color_hex,
      is_active,
      display_order
    ) VALUES (
      NULL,
      p_input->>'code',
      p_input->>'name',
      p_input->>'description',
      COALESCE(p_input->>'pricing_model', 'LUMP_SUM'),
      COALESCE((p_input->>'requires_material_lock')::BOOLEAN, FALSE),
      NULL,
      NULL,
      p_input->>'color_hex',
      COALESCE((p_input->>'is_active')::BOOLEAN, TRUE),
      COALESCE((p_input->>'display_order')::INTEGER, 0)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  ELSE
    UPDATE public.service_types
       SET code                   = COALESCE(p_input->>'code', code),
           name                   = COALESCE(p_input->>'name', name),
           description            = CASE WHEN p_input ? 'description'
                                         THEN p_input->>'description'
                                         ELSE description END,
           pricing_model          = COALESCE(p_input->>'pricing_model', pricing_model),
           requires_material_lock = COALESCE((p_input->>'requires_material_lock')::BOOLEAN, requires_material_lock),
           color_hex              = CASE WHEN p_input ? 'color_hex'
                                         THEN p_input->>'color_hex'
                                         ELSE color_hex END,
           is_active              = COALESCE((p_input->>'is_active')::BOOLEAN, is_active),
           display_order          = COALESCE((p_input->>'display_order')::INTEGER, display_order),
           updated_at             = now()
     WHERE id = p_id;
    RETURN p_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_service_type(BIGINT, JSONB) TO authenticated;

-- ─── 5. service_types.deactivate_service_type ─────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_service_type(
  p_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: pengaturan service_types needs an authenticated caller';
  END IF;
  SELECT role INTO v_role FROM public.admin_users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('Owner', 'Staff Admin Toko') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: pengaturan service_types requires Owner or Staff Admin Toko, got %', COALESCE(v_role, '<null>');
  END IF;

  UPDATE public.service_types
     SET is_active  = FALSE,
         updated_at = now()
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.deactivate_service_type(BIGINT) TO authenticated;
