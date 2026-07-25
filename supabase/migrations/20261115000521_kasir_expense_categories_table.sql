-- 20261115000521_kasir_expense_categories_table.sql
-- Per-tenant configurable Kasir expense categories.
-- Replaces hardcoded kasir_expense_category enum (deferred DROP TYPE).
-- Design: docs/superpowers/specs/2026-07-24-kasir-expense-categories-configurable-design.md

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kasir_expense_categories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label        text        NOT NULL,
  sort_order   int         NOT NULL DEFAULT 0,
  active       boolean     NOT NULL DEFAULT true,
  is_system    boolean     NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_label_length CHECK (length(trim(label)) BETWEEN 3 AND 40)
);

COMMENT ON TABLE public.kasir_expense_categories IS
  'Per-tenant configurable Kasir expense categories. Replaces kasir_expense_category enum. '
  'is_system=true rows are backend-emitted (Pembelian Stok / Pass-Through / MDR EDC) and '
  'MUST stay invisible in all UI. Owner CRUD via SECDEF RPCs only.';

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Case-insensitive uniqueness per tenant (allows re-use after soft delete).
CREATE UNIQUE INDEX IF NOT EXISTS ux_kasir_expense_categories_tenant_label_ci
  ON public.kasir_expense_categories (tenant_id, lower(label))
  WHERE deleted_at IS NULL;

-- Read path index (covers BOTH panel and dropdown consumers).
-- Panel needs inactive rows too (grays them), so `active` NOT in predicate.
CREATE INDEX IF NOT EXISTS ix_kasir_expense_categories_read
  ON public.kasir_expense_categories (tenant_id, sort_order)
  WHERE deleted_at IS NULL AND NOT is_system;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.kasir_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kasir_expense_categories FORCE ROW LEVEL SECURITY;

-- Tenants read only their own rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'kasir_expense_categories'
      AND policyname = 't_select_own'
  ) THEN
    CREATE POLICY t_select_own ON public.kasir_expense_categories
      FOR SELECT TO authenticated
      USING (tenant_id = public._resolve_tenant_id());
  END IF;
END $$;

-- Platform admins read all rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'kasir_expense_categories'
      AND policyname = 'p_platform_admin_readall'
  ) THEN
    CREATE POLICY p_platform_admin_readall ON public.kasir_expense_categories
      FOR SELECT TO authenticated
      USING (public.is_platform_admin());
  END IF;
END $$;

-- vosi_rpc_owner SECDEF ownership — required for INSERT ... RETURNING inside RPCs
-- (per memory secdef_returning_gap). USING true + WITH CHECK true because the SECDEF
-- RPC itself enforces tenant scoping via WHERE tenant_id = _resolve_tenant_id().
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'kasir_expense_categories'
      AND policyname = 't_select_own_secdef'
  ) THEN
    CREATE POLICY t_select_own_secdef ON public.kasir_expense_categories
      TO vosi_rpc_owner
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Basic table grants for authenticated (SELECT via t_select_own policy).
GRANT SELECT ON public.kasir_expense_categories TO authenticated;
