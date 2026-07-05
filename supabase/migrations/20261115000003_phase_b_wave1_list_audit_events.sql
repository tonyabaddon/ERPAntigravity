BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- list_audit_events(p_filters jsonb)
-- Returns paginated rows from platform_admin_audit.
--
-- Drift fixes applied vs. original plan:
--   1. id: BIGINT (not UUID)
--   2. admin_email: read directly from a.admin_email (no auth.users subquery)
--   3. detail: column is `detail` (not `detail_json`)
--   4. Unknown filter key raises 22023 (whitelist enforcement)
--   5. Pagination via page/page_size (or legacy limit/offset) supported
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_audit_events(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id           BIGINT,
  ts           TIMESTAMPTZ,
  admin_email  TEXT,
  tenant_slug  TEXT,
  action_code  TEXT,
  detail       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  -- Allowed filter keys
  v_allowed_keys TEXT[] := ARRAY[
    'tenant_id', 'action_code', 'actor', 'from_ts', 'to_ts',
    'search', 'page', 'page_size', 'limit', 'offset'
  ];
  v_unknown_keys TEXT[];

  -- Filter values
  v_tenant_id  UUID        := (p_filters->>'tenant_id')::UUID;
  v_action     TEXT        := p_filters->>'action_code';
  v_actor      TEXT        := p_filters->>'actor';      -- matches admin_email ILIKE
  v_search     TEXT        := p_filters->>'search';     -- free-text in action/admin_email
  v_from       TIMESTAMPTZ := (p_filters->>'from_ts')::TIMESTAMPTZ;
  v_to         TIMESTAMPTZ := (p_filters->>'to_ts')::TIMESTAMPTZ;

  -- Pagination — support page/page_size OR legacy limit/offset
  v_page       INT  := COALESCE((p_filters->>'page')::INT, 1);
  v_page_size  INT  := COALESCE((p_filters->>'page_size')::INT,
                                 (p_filters->>'limit')::INT,
                                 50);
  v_offset     INT  := COALESCE((p_filters->>'offset')::INT,
                                 (v_page - 1) * v_page_size);
BEGIN
  -- ── P0403 gate ────────────────────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Whitelist unknown filter keys ─────────────────────────────────────────
  SELECT ARRAY_AGG(k)
  INTO v_unknown_keys
  FROM jsonb_object_keys(p_filters) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'Unknown filter key(s): ' || array_to_string(v_unknown_keys, ', ');
  END IF;

  -- ── Cap page_size ─────────────────────────────────────────────────────────
  IF v_page_size > 500 THEN v_page_size := 500; END IF;
  IF v_page_size < 1  THEN v_page_size := 50;  END IF;

  -- ── Query ─────────────────────────────────────────────────────────────────
  RETURN QUERY
  SELECT
    a.id,
    a.created_at                                        AS ts,
    a.admin_email,                                      -- drift fix: direct column, no subquery
    t.slug                                              AS tenant_slug,
    a.action                                            AS action_code,
    a.detail                                            -- drift fix: column is `detail`
  FROM public.platform_admin_audit a
  LEFT JOIN public.tenants t ON t.id = a.tenant_id
  WHERE
    (v_tenant_id IS NULL OR a.tenant_id = v_tenant_id)
    AND (v_action  IS NULL OR v_action  = '' OR a.action = v_action)
    AND (v_actor   IS NULL OR v_actor   = '' OR a.admin_email ILIKE '%' || v_actor || '%')
    AND (v_search  IS NULL OR v_search  = ''
         OR a.action ILIKE '%' || v_search || '%'
         OR a.admin_email ILIKE '%' || v_search || '%')
    AND (v_from    IS NULL OR a.created_at >= v_from)
    AND (v_to      IS NULL OR a.created_at <= v_to)
  ORDER BY a.created_at DESC
  LIMIT v_page_size
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_audit_events(jsonb) FROM PUBLIC;
ALTER  FUNCTION public.list_audit_events(jsonb) OWNER TO vosi_rpc_owner;
GRANT  EXECUTE ON FUNCTION public.list_audit_events(jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_audit_events(jsonb) IS
  'category=P; Wave 1 Phase B: paginated audit event list. Filters: tenant_id, action_code, actor, from_ts, to_ts, search, page, page_size. id is BIGINT. Unknown filter keys raise 22023.';

COMMIT;
