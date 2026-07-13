-- 20261115000149_rakit_lines_extend.sql
-- Item #2: Additive extend of rakit_job_lines + rakit_components for
-- service catalog linkage. Reuse existing columns (labor_cost, tracking_mode,
-- service_type, fifo_cost_snapshot) per spec Column Reuse Mapping.

ALTER TABLE public.rakit_job_lines
  ADD COLUMN IF NOT EXISTS service_catalog_id UUID
    REFERENCES public.service_catalog(id),
  ADD COLUMN IF NOT EXISTS invoice_display_override TEXT
    CHECK (invoice_display_override IS NULL OR
           invoice_display_override IN ('lump_sum', 'itemized'));

ALTER TABLE public.rakit_job_lines DROP CONSTRAINT IF EXISTS chk_rakit_service_type;

CREATE INDEX IF NOT EXISTS idx_rakit_job_lines_catalog
  ON public.rakit_job_lines (service_catalog_id)
  WHERE service_catalog_id IS NOT NULL;

ALTER TABLE public.rakit_components
  ADD COLUMN IF NOT EXISTS service_catalog_bom_id UUID
    REFERENCES public.service_catalog_bom(id);

COMMENT ON COLUMN public.rakit_job_lines.service_catalog_id IS
  'Item #2: FK to service_catalog master. NULL for legacy pre-Item-#2 rows.';
COMMENT ON COLUMN public.rakit_job_lines.invoice_display_override IS
  'Item #2: per-order invoice display override. NULL = use catalog default.';
COMMENT ON COLUMN public.rakit_components.service_catalog_bom_id IS
  'Item #2: FK back to BOM master row snapshot came from. NULL for ad-hoc adds.';
