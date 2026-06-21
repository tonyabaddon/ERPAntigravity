-- supabase/migrations/20260622000003_tenant_settings_table.sql
-- Phase 1 task 3 — tenant_settings: modul switches + pajak 2026.
-- Regulasi: UU HPP No. 7/2021 + PMK 131/2024 + PP 55/2022 + DJP Juli 2024.

CREATE TABLE public.tenant_settings (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,
  -- Modul switches (7)
  modul_kasir              BOOLEAN NOT NULL DEFAULT TRUE,
  modul_tempo              BOOLEAN NOT NULL DEFAULT TRUE,
  modul_pengiriman         BOOLEAN NOT NULL DEFAULT TRUE,
  modul_multi_warehouse    BOOLEAN NOT NULL DEFAULT TRUE,
  modul_akuntansi          BOOLEAN NOT NULL DEFAULT TRUE,
  modul_jasa_layanan       BOOLEAN NOT NULL DEFAULT TRUE,
  modul_bom_recipe         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Pajak mode
  pajak_mode               TEXT NOT NULL DEFAULT 'FINAL_UMKM'
                           CHECK (pajak_mode IN ('PKP', 'NON_PKP', 'FINAL_UMKM')),
  pajak_ppn_rate_umum      NUMERIC(5,2) DEFAULT 11.00,
  pajak_ppn_rate_mewah     NUMERIC(5,2) DEFAULT 12.00,
  pajak_final_rate         NUMERIC(5,2) DEFAULT 0.50,
  -- UMKM
  pajak_umkm_jenis_badan   TEXT CHECK (pajak_umkm_jenis_badan IN ('PT','CV','OP','KOPERASI','FIRMA')),
  pajak_umkm_terdaftar_at  DATE,
  pajak_umkm_expires_at    DATE,
  -- NPWP / NIK
  pajak_npwp               TEXT,
  pajak_nik_as_npwp        BOOLEAN NOT NULL DEFAULT FALSE,
  -- PKP details (placeholder for V2 e-Faktur + Coretax)
  pajak_efaktur_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  pajak_pkp_registered_at  DATE,
  pajak_coretax_id         TEXT,
  -- Audit
  pajak_regulation_year    INTEGER NOT NULL DEFAULT 2026,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID
);

CREATE UNIQUE INDEX idx_tenant_settings_singleton ON public.tenant_settings
  ((CASE WHEN tenant_id IS NULL THEN 'SINGLETON' ELSE tenant_id::TEXT END));

GRANT SELECT ON public.tenant_settings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_settings FROM PUBLIC, anon, authenticated;

-- Garindo seed (regulasi 2026). Founder OQ7: konfirm jenis_badan + terdaftar_at sebelum production cutover.
-- Default placeholder: OP (Orang Pribadi), terdaftar 2022-01-01 → expires 2029-01-01.
INSERT INTO public.tenant_settings (
  tenant_id,
  pajak_mode,
  pajak_umkm_jenis_badan,
  pajak_umkm_terdaftar_at,
  pajak_umkm_expires_at,
  pajak_regulation_year
) VALUES (
  NULL,
  'FINAL_UMKM',
  'OP',
  '2022-01-01',
  '2029-01-01',
  2026
);
