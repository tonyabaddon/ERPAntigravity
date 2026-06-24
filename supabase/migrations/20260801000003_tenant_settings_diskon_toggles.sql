-- supabase/migrations/20260801000003_tenant_settings_diskon_toggles.sql
-- Diskon Fitur: tenant_settings 3 toggle diskon + extend set_tenant_modul whitelist.
-- Default semua TRUE supaya backward-compat (UI baru langsung visible saat deploy).

BEGIN;

ALTER TABLE public.tenant_settings
  ADD COLUMN modul_diskon_kasir     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN modul_diskon_penjualan BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN modul_diskon_tagihan   BOOLEAN NOT NULL DEFAULT TRUE;

-- Extend set_tenant_modul whitelist
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
    'modul_jasa_layanan', 'modul_bom_recipe',
    'modul_diskon_kasir', 'modul_diskon_penjualan', 'modul_diskon_tagihan'
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

COMMIT;
