-- supabase/migrations/20261115000480_bot_analytics_rpc.sql
-- Follow-up F3: SECDEF RPC for CaleoBotDashboard analytics.
-- Replaces direct anon-key SELECT on caleo_admin_bot_analytics (no RLS,
-- service_role-only per original grant). Only Caleo platform admins may call.

-- ── Ensure vosi_rpc_owner can read the analytics table ────────────────────────
-- (Schema-level grant may already cover this, but be explicit for safety.)
GRANT SELECT ON public.caleo_admin_bot_analytics TO vosi_rpc_owner;

-- ── RPC: get_bot_analytics_summary ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bot_analytics_summary(
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since         TIMESTAMPTZ;
  v_today_start   TIMESTAMPTZ;
  v_week_start    TIMESTAMPTZ;
  v_month_start   TIMESTAMPTZ;

  v_prospects_today   BIGINT;
  v_prospects_week    BIGINT;
  v_prospects_month   BIGINT;
  v_total_prospects   BIGINT;
  v_demo_count        BIGINT;
  v_signup_count      BIGINT;

  v_top_faqs          JSONB;
  v_escalation_7d     JSONB;
BEGIN
  -- ── Auth gate: platform admins only ───────────────────────────────────────
  IF NOT _is_platform_admin_active_from_jwt() THEN
    RAISE EXCEPTION USING
      errcode = 'P0403',
      message = 'BOT_ANALYTICS_FORBIDDEN';
  END IF;

  -- ── Time boundaries (UTC) ─────────────────────────────────────────────────
  v_since       := NOW() - (p_days || ' days')::INTERVAL;
  v_today_start := date_trunc('day', NOW());
  v_week_start  := date_trunc('week', NOW());   -- Mon 00:00 UTC
  v_month_start := date_trunc('month', NOW());

  -- ── Prospect counts ───────────────────────────────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE first_message_at >= v_today_start),
    COUNT(*) FILTER (WHERE first_message_at >= v_week_start),
    COUNT(*) FILTER (WHERE first_message_at >= v_month_start),
    COUNT(*),
    COUNT(*) FILTER (WHERE demo_scheduled_at IS NOT NULL),
    COUNT(*) FILTER (WHERE converted_to_signup_at IS NOT NULL)
  INTO
    v_prospects_today,
    v_prospects_week,
    v_prospects_month,
    v_total_prospects,
    v_demo_count,
    v_signup_count
  FROM public.caleo_admin_bot_analytics
  WHERE first_message_at >= v_since;

  -- ── Top 5 FAQs — unnest each session's faq_hits JSONB array ──────────────
  -- faq_hits is jsonb (array of strings), e.g. ["harga","harga","setup"]
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('faq_id', faq_id, 'count', hit_count)
      ORDER BY hit_count DESC
    ),
    '[]'::jsonb
  )
  INTO v_top_faqs
  FROM (
    SELECT
      elem::text AS faq_id,
      COUNT(*) AS hit_count
    FROM public.caleo_admin_bot_analytics,
         jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(faq_hits) = 'array' THEN faq_hits
             ELSE '[]'::jsonb
           END
         ) AS elem
    WHERE first_message_at >= v_since
      AND elem IS NOT NULL
      AND elem <> ''
    GROUP BY elem
    ORDER BY hit_count DESC
    LIMIT 5
  ) AS faq_agg;

  -- ── Escalation rate — last 7 days ─────────────────────────────────────────
  -- Returns array of {date, rate_pct} ordered oldest → newest
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date',     to_char(day_start AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        'rate_pct', CASE
                      WHEN total_sessions = 0 THEN 0
                      ELSE ROUND((escalated_sessions::NUMERIC / total_sessions) * 100)
                    END
      )
      ORDER BY day_start
    ),
    '[]'::jsonb
  )
  INTO v_escalation_7d
  FROM (
    SELECT
      date_trunc('day', gs)::TIMESTAMPTZ AS day_start,
      COUNT(a.id)                         AS total_sessions,
      COUNT(a.id) FILTER (WHERE a.escalated_at IS NOT NULL) AS escalated_sessions
    FROM generate_series(
      date_trunc('day', NOW()) - INTERVAL '6 days',
      date_trunc('day', NOW()),
      INTERVAL '1 day'
    ) AS gs
    LEFT JOIN public.caleo_admin_bot_analytics a
      ON  a.first_message_at >= gs
      AND a.first_message_at <  gs + INTERVAL '1 day'
    GROUP BY gs
    ORDER BY gs
  ) AS esc_agg;

  -- ── Assemble result ───────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'prospects_today',       v_prospects_today,
    'prospects_week',        v_prospects_week,
    'prospects_month',       v_prospects_month,
    'top_faqs',              COALESCE(v_top_faqs, '[]'::jsonb),
    'escalation_rate_7d',    COALESCE(v_escalation_7d, '[]'::jsonb),
    'funnel', jsonb_build_object(
      'prospects',       v_total_prospects,
      'demo_scheduled',  v_demo_count,
      'signup',          v_signup_count
    )
  );
END;
$$;

ALTER FUNCTION public.get_bot_analytics_summary(INT)
  OWNER TO vosi_rpc_owner;

REVOKE ALL ON FUNCTION public.get_bot_analytics_summary(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bot_analytics_summary(INT) TO authenticated;

COMMENT ON FUNCTION public.get_bot_analytics_summary(INT) IS
  'Returns Caleo Bot analytics summary as JSONB. Restricted to platform admins only (P0403 on non-admin call). p_days controls look-back window (default 30).';
