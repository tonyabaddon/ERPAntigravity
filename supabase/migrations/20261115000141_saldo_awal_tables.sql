-- 20261115000141_saldo_awal_tables.sql
-- Item #5: 4 new tables for Saldo Awal wizard + Year-End Close events.
-- See docs/superpowers/specs/2026-07-13-saldo-awal-year-end-close-design.md §4.

-- 1. saldo_awal_snapshots — wizard state + audit
CREATE TABLE IF NOT EXISTS public.saldo_awal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cutover_date DATE NOT NULL,
  step_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted','reversed')),
  posted_je_id UUID,
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_je_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_saldo_awal_one_active
  ON public.saldo_awal_snapshots (tenant_id) WHERE status = 'posted';
CREATE UNIQUE INDEX IF NOT EXISTS ux_saldo_awal_one_draft
  ON public.saldo_awal_snapshots (tenant_id) WHERE status = 'draft';

ALTER TABLE public.saldo_awal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldo_awal_snapshots FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_select_own' AND polrelid='public.saldo_awal_snapshots'::regclass) THEN
    CREATE POLICY p_select_own ON public.saldo_awal_snapshots
      FOR SELECT USING (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_platform_admin_readall' AND polrelid='public.saldo_awal_snapshots'::regclass) THEN
    CREATE POLICY p_platform_admin_readall ON public.saldo_awal_snapshots
      FOR SELECT USING (public.is_platform_admin());
  END IF;
END $$;


-- 2. opening_ar_lines — AR detail per customer (opt-in)
CREATE TABLE IF NOT EXISTS public.opening_ar_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES public.saldo_awal_snapshots(id) ON DELETE CASCADE,
  customer_id TEXT,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  original_due_date DATE,
  invoice_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opening_ar_snapshot
  ON public.opening_ar_lines (tenant_id, snapshot_id);

ALTER TABLE public.opening_ar_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_ar_lines FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_select_own' AND polrelid='public.opening_ar_lines'::regclass) THEN
    CREATE POLICY p_select_own ON public.opening_ar_lines
      FOR SELECT USING (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_platform_admin_readall' AND polrelid='public.opening_ar_lines'::regclass) THEN
    CREATE POLICY p_platform_admin_readall ON public.opening_ar_lines
      FOR SELECT USING (public.is_platform_admin());
  END IF;
END $$;


-- 3. opening_ap_lines — AP detail per supplier (opt-in)
CREATE TABLE IF NOT EXISTS public.opening_ap_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES public.saldo_awal_snapshots(id) ON DELETE CASCADE,
  supplier_id UUID,
  supplier_name TEXT NOT NULL CHECK (length(trim(supplier_name)) > 0),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  original_due_date DATE,
  invoice_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opening_ap_snapshot
  ON public.opening_ap_lines (tenant_id, snapshot_id);

ALTER TABLE public.opening_ap_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_ap_lines FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_select_own' AND polrelid='public.opening_ap_lines'::regclass) THEN
    CREATE POLICY p_select_own ON public.opening_ap_lines
      FOR SELECT USING (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_platform_admin_readall' AND polrelid='public.opening_ap_lines'::regclass) THEN
    CREATE POLICY p_platform_admin_readall ON public.opening_ap_lines
      FOR SELECT USING (public.is_platform_admin());
  END IF;
END $$;


-- 4. year_end_close_events — annual close tracker
CREATE TABLE IF NOT EXISTS public.year_end_close_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_year INT NOT NULL CHECK (fiscal_year >= 2020 AND fiscal_year <= 2100),
  net_income NUMERIC(15,2) NOT NULL,
  posted_je_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversed_je_id UUID,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_year_end_close_one_active
  ON public.year_end_close_events (tenant_id, fiscal_year) WHERE status = 'posted';

ALTER TABLE public.year_end_close_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.year_end_close_events FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_select_own' AND polrelid='public.year_end_close_events'::regclass) THEN
    CREATE POLICY p_select_own ON public.year_end_close_events
      FOR SELECT USING (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_platform_admin_readall' AND polrelid='public.year_end_close_events'::regclass) THEN
    CREATE POLICY p_platform_admin_readall ON public.year_end_close_events
      FOR SELECT USING (public.is_platform_admin());
  END IF;
END $$;
