-- 20261115000523_kasir_expense_categories_rpcs.sql
-- 5 SECDEF RPCs for owner CRUD on kasir_expense_categories.
-- All owner-only via inline admin_users role check.
-- Error taxonomy: KECT_FORBIDDEN (P0403), KECT_NOT_FOUND (P0404), KECT_IS_SYSTEM (P0403),
--                 KECT_LABEL_INVALID (P0400), KECT_LABEL_DUPLICATE (P0409), KECT_INVALID_ORDER (P0400).

-- ═══ RPC 1: create ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kasir_expense_category_create(
  p_label text,
  p_insert_after_id uuid DEFAULT NULL
)
RETURNS public.kasir_expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_tenant_id   uuid := public._resolve_tenant_id();
  v_label       text;
  v_sort_order  int;
  v_after_sort  int;
  v_next_sort   int;
  v_row         public.kasir_expense_categories;
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'KECT_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Validate label
  v_label := trim(p_label);
  IF length(v_label) < 3 OR length(v_label) > 40 THEN
    RAISE EXCEPTION 'KECT_LABEL_INVALID' USING errcode = 'P0400';
  END IF;

  -- Duplicate check (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM public.kasir_expense_categories
    WHERE tenant_id = v_tenant_id
      AND lower(label) = lower(v_label)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'KECT_LABEL_DUPLICATE' USING errcode = 'P0409';
  END IF;

  -- Sort order: fractional midpoint if p_insert_after_id given; else MAX+10
  IF p_insert_after_id IS NULL THEN
    SELECT COALESCE(MAX(sort_order), 0) + 10 INTO v_sort_order
      FROM public.kasir_expense_categories
      WHERE tenant_id = v_tenant_id AND NOT is_system AND deleted_at IS NULL;
  ELSE
    SELECT sort_order INTO v_after_sort
      FROM public.kasir_expense_categories
      WHERE id = p_insert_after_id
        AND tenant_id = v_tenant_id
        AND NOT is_system
        AND deleted_at IS NULL;
    IF v_after_sort IS NULL THEN
      RAISE EXCEPTION 'KECT_NOT_FOUND' USING errcode = 'P0404';
    END IF;

    SELECT MIN(sort_order) INTO v_next_sort
      FROM public.kasir_expense_categories
      WHERE tenant_id = v_tenant_id
        AND NOT is_system
        AND deleted_at IS NULL
        AND sort_order > v_after_sort;

    v_sort_order := (v_after_sort + COALESCE(v_next_sort, v_after_sort + 20)) / 2;
  END IF;

  INSERT INTO public.kasir_expense_categories
    (tenant_id, label, sort_order, is_system, active)
  VALUES
    (v_tenant_id, v_label, v_sort_order, false, true)
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

ALTER FUNCTION public.kasir_expense_category_create(text, uuid) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.kasir_expense_category_create(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kasir_expense_category_create(text, uuid) FROM anon;

-- ═══ RPC 2: update ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kasir_expense_category_update(
  p_id uuid,
  p_label text DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS public.kasir_expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_tenant_id uuid := public._resolve_tenant_id();
  v_row       public.kasir_expense_categories;
  v_new_label text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'KECT_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  SELECT * INTO v_row
    FROM public.kasir_expense_categories
    WHERE id = p_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'KECT_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  IF v_row.is_system THEN
    RAISE EXCEPTION 'KECT_IS_SYSTEM' USING errcode = 'P0403';
  END IF;

  IF p_label IS NOT NULL THEN
    v_new_label := trim(p_label);
    IF length(v_new_label) < 3 OR length(v_new_label) > 40 THEN
      RAISE EXCEPTION 'KECT_LABEL_INVALID' USING errcode = 'P0400';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.kasir_expense_categories
      WHERE tenant_id = v_tenant_id
        AND lower(label) = lower(v_new_label)
        AND deleted_at IS NULL
        AND id <> p_id
    ) THEN
      RAISE EXCEPTION 'KECT_LABEL_DUPLICATE' USING errcode = 'P0409';
    END IF;

    v_row.label := v_new_label;
  END IF;

  IF p_active IS NOT NULL THEN
    v_row.active := p_active;
  END IF;

  UPDATE public.kasir_expense_categories
    SET label = v_row.label,
        active = v_row.active,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;

  RETURN v_row;
END $$;

ALTER FUNCTION public.kasir_expense_category_update(uuid, text, boolean) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.kasir_expense_category_update(uuid, text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kasir_expense_category_update(uuid, text, boolean) FROM anon;

-- ═══ RPC 3: soft_delete ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kasir_expense_category_soft_delete(p_id uuid)
RETURNS public.kasir_expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_tenant_id uuid := public._resolve_tenant_id();
  v_row       public.kasir_expense_categories;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'KECT_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  SELECT * INTO v_row
    FROM public.kasir_expense_categories
    WHERE id = p_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
    FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'KECT_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  IF v_row.is_system THEN
    RAISE EXCEPTION 'KECT_IS_SYSTEM' USING errcode = 'P0403';
  END IF;

  UPDATE public.kasir_expense_categories
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;

  RETURN v_row;
END $$;

ALTER FUNCTION public.kasir_expense_category_soft_delete(uuid) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.kasir_expense_category_soft_delete(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kasir_expense_category_soft_delete(uuid) FROM anon;

-- ═══ RPC 4: restore ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kasir_expense_category_restore(p_id uuid)
RETURNS public.kasir_expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_tenant_id uuid := public._resolve_tenant_id();
  v_row       public.kasir_expense_categories;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'KECT_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  SELECT * INTO v_row
    FROM public.kasir_expense_categories
    WHERE id = p_id AND tenant_id = v_tenant_id AND deleted_at IS NOT NULL
    FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'KECT_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  IF v_row.is_system THEN
    RAISE EXCEPTION 'KECT_IS_SYSTEM' USING errcode = 'P0403';
  END IF;

  -- Guard: cannot restore if an active row with same label now exists
  IF EXISTS (
    SELECT 1 FROM public.kasir_expense_categories
    WHERE tenant_id = v_tenant_id
      AND lower(label) = lower(v_row.label)
      AND deleted_at IS NULL
      AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'KECT_LABEL_DUPLICATE' USING errcode = 'P0409';
  END IF;

  UPDATE public.kasir_expense_categories
    SET deleted_at = NULL, updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;

  RETURN v_row;
END $$;

ALTER FUNCTION public.kasir_expense_category_restore(uuid) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.kasir_expense_category_restore(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kasir_expense_category_restore(uuid) FROM anon;

-- ═══ RPC 5: reorder ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kasir_expense_categories_reorder(p_ordered_ids uuid[])
RETURNS SETOF public.kasir_expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_tenant_id uuid := public._resolve_tenant_id();
  v_match_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'KECT_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  IF p_ordered_ids IS NULL OR array_length(p_ordered_ids, 1) = 0 THEN
    RAISE EXCEPTION 'KECT_INVALID_ORDER' USING errcode = 'P0400';
  END IF;

  -- Every id in p_ordered_ids must be a valid, non-system, non-deleted row of this tenant.
  SELECT count(*) INTO v_match_count
    FROM public.kasir_expense_categories
    WHERE id = ANY(p_ordered_ids)
      AND tenant_id = v_tenant_id
      AND NOT is_system
      AND deleted_at IS NULL;

  IF v_match_count <> array_length(p_ordered_ids, 1) THEN
    RAISE EXCEPTION 'KECT_INVALID_ORDER' USING errcode = 'P0400';
  END IF;

  RETURN QUERY
    UPDATE public.kasir_expense_categories t
    SET sort_order = o.rn * 10, updated_at = now()
    FROM (SELECT id, row_number() OVER () AS rn
          FROM unnest(p_ordered_ids) WITH ORDINALITY AS a(id, rn)) o
    WHERE t.id = o.id AND t.tenant_id = v_tenant_id
    RETURNING t.*;
END $$;

ALTER FUNCTION public.kasir_expense_categories_reorder(uuid[]) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.kasir_expense_categories_reorder(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kasir_expense_categories_reorder(uuid[]) FROM anon;

-- ═══ Smoke test (fake auth, rollback via RAISE EXCEPTION) ═════════════════════
-- Per memory smoke_test_security_definer_rpcs: exercises each RPC with a fake
-- JWT sub set to an Owner user of an arbitrary tenant. All mutations rolled
-- back by RAISE EXCEPTION at end. Safe to re-run.

DO $$
DECLARE
  v_owner_id  uuid;
  v_tenant_id uuid;
  v_new_id    uuid;
  v_reordered_id uuid;
BEGIN
  -- Pick any Owner from any tenant for the smoke test
  SELECT id, tenant_id INTO v_owner_id, v_tenant_id
    FROM public.admin_users
    WHERE role = 'Owner' AND status = 'Aktif'
    LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'smoke_test: no Owner found, skipping';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- Positive: create → update → soft_delete → restore
  v_new_id := (public.kasir_expense_category_create('Smoke Test Cat', NULL)).id;
  PERFORM public.kasir_expense_category_update(v_new_id, 'Smoke Renamed', false);
  PERFORM public.kasir_expense_category_soft_delete(v_new_id);
  PERFORM public.kasir_expense_category_restore(v_new_id);

  -- Reorder: get any active non-system id for this tenant to include
  SELECT id INTO v_reordered_id
    FROM public.kasir_expense_categories
    WHERE tenant_id = v_tenant_id AND NOT is_system AND deleted_at IS NULL
    LIMIT 1;

  IF v_reordered_id IS NOT NULL THEN
    PERFORM public.kasir_expense_categories_reorder(ARRAY[v_reordered_id, v_new_id]);
  END IF;

  -- Rollback all mutations via subtransaction: the EXCEPTION handler
  -- catches SQLSTATE P0001 (our SMOKE_TEST_OK marker) and swallows it,
  -- so the outer migration tx commits with the CREATE FUNCTIONs intact
  -- while all smoke-test mutations (create/update/soft_delete/restore/reorder)
  -- get rolled back by the implicit subtransaction the EXCEPTION clause creates.
  --
  -- KECT_* error codes from actual RPC failures use P0400/P0403/P0404/P0409
  -- and would propagate normally, aborting the migration — which is correct
  -- (we want to know if the smoke test caught a real bug).
  RAISE EXCEPTION 'SMOKE_TEST_OK — rollback intended' USING errcode = 'P0001';
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    -- Intentional rollback marker; swallow to let migration commit.
    NULL;
END $$;
