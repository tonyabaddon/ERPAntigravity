-- 20261115000148_service_catalog_tables.sql
-- Item #2: Service Catalog base tables.
-- Tenant-scoped, composite FK to chart_of_accounts prevents cross-tenant leak.
-- RLS policies include vosi_rpc_owner in p_select_own per memory
-- secdef_returning_gap (save_service_catalog uses INSERT RETURNING).

CREATE TABLE IF NOT EXISTS public.service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  default_labor_amount NUMERIC(15,2) DEFAULT 0 CHECK (default_labor_amount >= 0),
  default_include_material BOOLEAN DEFAULT TRUE,
  invoice_display TEXT DEFAULT 'lump_sum'
    CHECK (invoice_display IN ('lump_sum', 'itemized')),
  revenue_coa_code TEXT NOT NULL,
  labor_cost_coa_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT service_catalog_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT service_catalog_revenue_coa_fk
    FOREIGN KEY (tenant_id, revenue_coa_code)
    REFERENCES public.chart_of_accounts (tenant_id, account_code),
  CONSTRAINT service_catalog_labor_coa_fk
    FOREIGN KEY (tenant_id, labor_cost_coa_code)
    REFERENCES public.chart_of_accounts (tenant_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_tenant_active
  ON public.service_catalog (tenant_id, is_active, category);

CREATE TABLE IF NOT EXISTS public.service_catalog_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id UUID NOT NULL
    REFERENCES public.service_catalog(id) ON DELETE CASCADE,
  component_sku VARCHAR(50) NOT NULL REFERENCES public.stocks(sku),
  default_qty NUMERIC(15,4) NOT NULL CHECK (default_qty > 0),
  notes TEXT,
  sort_order INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_bom_service
  ON public.service_catalog_bom (service_catalog_id);

ALTER TABLE public.service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_bom FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_select_own ON public.service_catalog;
CREATE POLICY p_select_own ON public.service_catalog FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS p_write_own ON public.service_catalog;
CREATE POLICY p_write_own ON public.service_catalog FOR ALL
  TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS p_select_own ON public.service_catalog_bom;
CREATE POLICY p_select_own ON public.service_catalog_bom FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND (sc.tenant_id = public._resolve_tenant_id() OR public.is_platform_admin())
    )
  );

DROP POLICY IF EXISTS p_write_own ON public.service_catalog_bom;
CREATE POLICY p_write_own ON public.service_catalog_bom FOR ALL
  TO vosi_rpc_owner
  USING (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND sc.tenant_id = public._resolve_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_catalog sc
      WHERE sc.id = service_catalog_bom.service_catalog_id
        AND sc.tenant_id = public._resolve_tenant_id()
    )
  );

GRANT SELECT ON public.service_catalog TO authenticated;
GRANT SELECT ON public.service_catalog_bom TO authenticated;
GRANT ALL ON public.service_catalog TO vosi_rpc_owner;
GRANT ALL ON public.service_catalog_bom TO vosi_rpc_owner;

COMMENT ON TABLE public.service_catalog IS
  'Item #2: Tenant-configurable service master. Deprecates service_types.';
COMMENT ON TABLE public.service_catalog_bom IS
  'Item #2: BOM master per service catalog entry. Empty = labor-only mode.';
