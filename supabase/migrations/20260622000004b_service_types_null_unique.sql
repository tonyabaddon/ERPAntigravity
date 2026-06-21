-- Phase 1 task 4 follow-up fix (review finding).
-- UNIQUE (tenant_id, code) does NOT enforce singleton for tenant_id IS NULL
-- because PostgreSQL treats NULL ≠ NULL in default unique checks. Same fix
-- pattern as Task 1 (uq_approval_settings_null_tenant). Phase 1 uses
-- tenant_id=NULL exclusively, so this guard prevents silent duplicates once
-- Task 13 wires serviceTypesService.create via admin UI.

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_types_null_tenant_code
  ON public.service_types (code)
  WHERE tenant_id IS NULL;
