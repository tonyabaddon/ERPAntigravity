-- supabase/migrations/20260613000002d_warehouses_admin_rpcs.sql
-- Phase 2d of configurable warehouses: 5 warehouse admin RPCs.
-- All SECURITY DEFINER + SET search_path = public + GRANT EXECUTE TO authenticated.
-- All check Owner role via admin_users.
--
-- RPCs:
--   create_warehouse        — insert row; auto-default for first warehouse; audit log
--   update_warehouse        — COALESCE patch; conditional audit rows per changed field
--   set_default_warehouse   — clear old default first (partial UNIQUE safe); audit log
--   deactivate_warehouse    — 3-guard check (stock qty, pending approvals, recent ledger)
--   force_deactivate_warehouse — Owner PIN verify (bcrypt + lockout) then deactivate

BEGIN;

-- ─── create_warehouse ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_warehouse(
  p_code        text,
  p_name        text,
  p_address     text DEFAULT NULL,
  p_sort_order  int  DEFAULT 100
) RETURNS public.warehouses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_first boolean;
  v_row   public.warehouses;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'create_warehouse: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'create_warehouse: Owner role required';
  END IF;

  -- Auto-default: first warehouse for this tenant (tenant_id IS NULL for the
  -- single-tenant deployment) gets is_default=true so the app is never without
  -- a default. The partial UNIQUE index (warehouses_one_default_per_tenant)
  -- ensures at most one is_default=true row per tenant at any time.
  v_first := NOT EXISTS (SELECT 1 FROM warehouses WHERE tenant_id IS NULL);

  INSERT INTO warehouses (tenant_id, code, name, address, is_default, sort_order)
       VALUES (NULL, upper(p_code), p_name, p_address, v_first, p_sort_order)
  RETURNING * INTO v_row;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, after)
       VALUES (v_row.id, v_actor, 'create', to_jsonb(v_row));

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.create_warehouse(text, text, text, int) TO authenticated;

-- ─── update_warehouse ──────────────────────────────────────────────────────
-- COALESCE-patch: NULL args keep the existing value (callers pass NULL to
-- leave a field unchanged). Emits a conditional audit row per changed field:
--   rename          if name changed
--   address_update  if address changed (NULL-safe comparison)
--   sort_update     if sort_order changed
CREATE OR REPLACE FUNCTION public.update_warehouse(
  p_id         uuid,
  p_name       text DEFAULT NULL,
  p_address    text DEFAULT NULL,
  p_sort_order int  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old   public.warehouses;
  v_new   public.warehouses;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'update_warehouse: Owner role required';
  END IF;

  SELECT * INTO v_old FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warehouse % not found', p_id;
  END IF;

  UPDATE warehouses
     SET name       = COALESCE(p_name,       name),
         address    = COALESCE(p_address,    address),
         sort_order = COALESCE(p_sort_order, sort_order),
         updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_new;

  -- Emit only the fields that actually changed to keep the audit log tight.
  IF p_name IS NOT NULL AND v_old.name <> v_new.name THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'rename', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
  IF p_address IS NOT NULL AND COALESCE(v_old.address, '') <> COALESCE(v_new.address, '') THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'address_update', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
  IF p_sort_order IS NOT NULL AND v_old.sort_order <> v_new.sort_order THEN
    INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, after)
         VALUES (p_id, v_actor, 'sort_update', to_jsonb(v_old), to_jsonb(v_new));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.update_warehouse(uuid, text, text, int) TO authenticated;

-- ─── set_default_warehouse ─────────────────────────────────────────────────
-- Clears the existing default BEFORE setting the new one in the same
-- transaction so the partial UNIQUE index (warehouses_one_default_per_tenant)
-- is never violated. IS NOT DISTINCT FROM handles the NULL tenant_id case.
CREATE OR REPLACE FUNCTION public.set_default_warehouse(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'set_default_warehouse: Owner role required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM warehouses WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warehouse % not found', p_id;
  END IF;

  -- Clear existing default first so the UNIQUE index is not violated when
  -- setting the new default on the same tenant.
  UPDATE warehouses
     SET is_default = false, updated_at = now()
   WHERE tenant_id IS NOT DISTINCT FROM v_tenant
     AND is_default = true;

  UPDATE warehouses
     SET is_default = true, updated_at = now()
   WHERE id = p_id;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action)
       VALUES (p_id, v_actor, 'set_default');
END $$;

GRANT EXECUTE ON FUNCTION public.set_default_warehouse(uuid) TO authenticated;

-- ─── deactivate_warehouse ──────────────────────────────────────────────────
-- Three safety guards before deactivating (raises P0001 on any violation):
--   (a) stock_levels qty > 0  — outstanding inventory must be zeroed or transferred first
--   (b) pending approval_requests for this warehouse — active approval workflow
--   (c) stock_movements in the last 30 days — recent ledger activity
-- Also refuses to deactivate the is_default warehouse.
CREATE OR REPLACE FUNCTION public.deactivate_warehouse(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_n     int;
  v_row   public.warehouses;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'deactivate_warehouse: Owner role required';
  END IF;

  SELECT * INTO v_row FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warehouse % not found', p_id;
  END IF;
  IF v_row.is_default THEN
    RAISE EXCEPTION 'Tidak bisa nonaktifkan gudang default. Set gudang lain sebagai default dulu.';
  END IF;

  -- Guard (a): outstanding inventory
  SELECT count(*) INTO v_n
    FROM stock_levels
   WHERE warehouse_id = p_id AND qty > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'masih ada % SKU dengan stok > 0 di gudang ini', v_n;
  END IF;

  -- Guard (b): pending approvals linked to this warehouse
  SELECT count(*) INTO v_n
    FROM stock_adjustments sa
    JOIN approval_requests ar ON sa.approval_request_id = ar.id
   WHERE sa.warehouse_id = p_id AND ar.status = 'pending';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'masih ada % approval pending untuk gudang ini', v_n;
  END IF;

  -- Guard (c): recent ledger activity (30-day window)
  SELECT count(*) INTO v_n
    FROM stock_movements
   WHERE warehouse_id = p_id
     AND created_at > now() - interval '30 days';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'gudang masih ada ledger entry dalam 30 hari terakhir';
  END IF;

  UPDATE warehouses SET is_active = false, updated_at = now() WHERE id = p_id;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before)
       VALUES (p_id, v_actor, 'deactivate', to_jsonb(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.deactivate_warehouse(uuid) TO authenticated;

-- ─── force_deactivate_warehouse (Owner PIN) ────────────────────────────────
-- Bypasses the three safety guards from deactivate_warehouse but requires:
--   - p_reason >= 5 characters (mandatory audit note)
--   - valid Owner PIN (bcrypt compare via pgcrypto.crypt)
--   - PIN not locked (pin_locked_until > now() check)
-- On wrong PIN: increment pin_failed_count; arm 1-hour lockout once count >= 5.
-- On correct PIN: reset pin_failed_count + pin_locked_until.
-- crypt() lives in the extensions schema — SET search_path = public, extensions.
CREATE OR REPLACE FUNCTION public.force_deactivate_warehouse(
  p_id      uuid,
  p_pin     text,
  p_reason  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_row    public.warehouses;
  v_hash   text;
  v_locked timestamptz;
  v_fails  int;
BEGIN
  -- Validate reason length first (user-facing gate, no auth needed)
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'force_deactivate_warehouse: reason note required (min 5 chars)';
  END IF;

  -- Owner role check
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'force_deactivate_warehouse: Owner role required';
  END IF;

  -- Read PIN state from the acting Owner's row
  SELECT approval_pin_hash, pin_locked_until, pin_failed_count
    INTO v_hash, v_locked, v_fails
    FROM admin_users
   WHERE id = v_actor;

  -- Lockout check: even correct PIN is rejected while locked
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'Owner PIN locked until %', v_locked;
  END IF;

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'Owner PIN not configured';
  END IF;

  -- bcrypt compare: crypt(supplied_pin, stored_hash) = stored_hash
  IF crypt(p_pin, v_hash) <> v_hash THEN
    -- Bump failure counter; arm lockout once post-increment count reaches 5
    UPDATE admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE
             WHEN pin_failed_count + 1 >= 5 THEN now() + interval '1 hour'
             ELSE pin_locked_until
           END
     WHERE id = v_actor;
    RAISE EXCEPTION 'PIN salah';
  END IF;

  -- Correct PIN: reset failure state
  UPDATE admin_users
     SET pin_failed_count = 0,
         pin_locked_until = NULL
   WHERE id = v_actor;

  -- Warehouse existence + default guard
  SELECT * INTO v_row FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warehouse % not found', p_id;
  END IF;
  IF v_row.is_default THEN
    RAISE EXCEPTION 'Tidak bisa force-deactivate gudang default';
  END IF;

  UPDATE warehouses SET is_active = false, updated_at = now() WHERE id = p_id;

  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before, reason_note)
       VALUES (p_id, v_actor, 'force_deactivate', to_jsonb(v_row), p_reason);
END $$;

GRANT EXECUTE ON FUNCTION public.force_deactivate_warehouse(uuid, text, text) TO authenticated;

COMMIT;
