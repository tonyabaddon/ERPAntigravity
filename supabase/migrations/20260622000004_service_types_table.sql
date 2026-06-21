-- supabase/migrations/20260622000004_service_types_table.sql
-- Phase 1 task 4 — service_types: master jenis jasa (replaces hardcoded Custom/Wiring).

CREATE TABLE public.service_types (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT,
  pricing_model            TEXT NOT NULL DEFAULT 'LUMP_SUM'
                           CHECK (pricing_model IN ('LUMP_SUM', 'PER_HOUR', 'PER_METER', 'PER_UNIT')),
  requires_material_lock   BOOLEAN NOT NULL DEFAULT FALSE,
  default_account_revenue  BIGINT,                            -- FK ke coa_accounts(id) saat Phase 0a akuntansi rilis
  default_account_cogs     BIGINT,
  color_hex                TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_service_types_active ON public.service_types(is_active, display_order);

GRANT SELECT ON public.service_types TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.service_types FROM PUBLIC, anon, authenticated;

-- Garindo seed: 2 jasa existing yang sekarang hardcoded di RakitButtonsRow.
INSERT INTO public.service_types (tenant_id, code, name, pricing_model, requires_material_lock, color_hex, display_order)
  VALUES
    (NULL, 'custom_panel',  'Custom Panel',  'LUMP_SUM', TRUE, '#9333EA', 1),
    (NULL, 'wiring_panel',  'Wiring Panel',  'LUMP_SUM', TRUE, '#0EA5E9', 2);

-- Backfill: existing rakit_lock approval_requests payload tambah service_type_id.
-- Heuristic: kalau payload->>'jasa_type' = 'custom_panel' → service_types code 'custom_panel'.
-- Existing payload kemungkinan: {jasa_type: 'custom_panel' | 'wiring_panel', ...}.
UPDATE public.approval_requests ar
   SET payload = payload || jsonb_build_object(
         'service_type_id',
         (SELECT id FROM public.service_types st WHERE st.code = ar.payload->>'jasa_type' LIMIT 1)
       )
 WHERE request_type = 'rakit_lock'
   AND payload ? 'jasa_type'
   AND NOT (payload ? 'service_type_id');
