-- 20261115000522_kasir_expense_categories_seed_and_backfill.sql
-- Idempotent seed function + one-shot backfill for existing tenants.
-- Called on new tenant provision (future integration) + once now for backfill.

-- ── Seed function ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._seed_kasir_expense_categories(p_tenant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO public.kasir_expense_categories
    (tenant_id, label, sort_order, is_system)
  VALUES
    (p_tenant_id, 'Gaji',                    10,  false),
    (p_tenant_id, 'Utilitas',                20,  false),
    (p_tenant_id, 'Transportasi',            30,  false),
    (p_tenant_id, 'Marketing',               40,  false),
    (p_tenant_id, 'Lain-lain',               50,  false),
    (p_tenant_id, 'Pembelian Stok',          100, true),
    (p_tenant_id, 'Pembelian Pass-Through',  110, true),
    (p_tenant_id, 'MDR EDC',                 120, true)
  ON CONFLICT ON CONSTRAINT ux_kasir_expense_categories_tenant_label_ci DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END $$;

ALTER FUNCTION public._seed_kasir_expense_categories(uuid) OWNER TO vosi_rpc_owner;

COMMENT ON FUNCTION public._seed_kasir_expense_categories(uuid) IS
  'Seed default kasir expense categories for a tenant. Idempotent (ON CONFLICT DO NOTHING). '
  'Called on tenant provision + one-shot backfill for existing tenants at migration 522.';

-- ── One-shot backfill for existing tenants ───────────────────────────────────

DO $$
DECLARE
  r_tenant record;
  v_total_inserted int := 0;
  v_this_batch int;
BEGIN
  FOR r_tenant IN SELECT id FROM public.tenants LOOP
    v_this_batch := public._seed_kasir_expense_categories(r_tenant.id);
    v_total_inserted := v_total_inserted + v_this_batch;
  END LOOP;

  RAISE NOTICE 'kasir_expense_categories backfill: seeded % row(s) across % tenant(s)',
    v_total_inserted,
    (SELECT count(*) FROM public.tenants);
END $$;
