-- Stock Fraud Prevention Phase 2 Task 10: request_price_change +
-- commit_approved_price_change RPCs.
--
-- Closes the third Owner-approval gate (after adjustment in T3/T4 and opname
-- in T7/T8). Same two-RPC shape: a request opener that creates the gate +
-- satellite workflow row, and a commit closer that applies the change AFTER
-- _transition_approval has flipped approval_requests.status='approved'.
--
-- Key contracts pinned by the tests in approvals_test.go:
--
--   1. request_price_change SNAPSHOTS stocks.<field> into
--      price_change_requests.old_value at request time. Even though T9's
--      REVOKE makes a stocks.price drift between request and commit
--      unreachable through ordinary client paths, snapshotting belt-and-
--      suspenders the audit story: the history row records the value the
--      Owner actually approved against.
--
--   2. commit_approved_price_change RAISES 'not approved' if the gate is
--      still pending. Mirrors T4's commit_approved_adjustment string so
--      callers (Go backend, WA webhook) can pattern-match a single error
--      across all approval flows.
--
--   3. Happy path: stocks.<field> := new_value, ONE stock_price_history row
--      written with source='approval', and the satellite price_change_requests
--      row is flipped to status='approved' with decided_at/committed_at set.
--      The history row inherits the T9 append-only contract automatically
--      (the BEFORE UPDATE/DELETE trigger fires regardless of how the row got
--      there).
--
-- ENTRY-POINT PARAMETER: commit_approved_price_change takes the
-- approval_request id (not the price_change_requests id). The tests pass
-- `aid` (returned by request_price_change → approval_requests.id) directly
-- to the commit. We then locate the satellite by approval_request_id.
-- Symmetric with T4's commit_approved_adjustment(p_approval_id).
--
-- DYNAMIC SQL: the column name (price | harga_modal) is data-dependent. We
-- whitelist it via the CHECK constraint on price_change_requests.field PLUS
-- an IF-guard in request_price_change for fail-fast UX, then quote with
-- format(%I) when assembling the EXECUTE strings. The whitelist makes the
-- %I quoting belt-and-suspenders against an unknown column ever flowing
-- through.
--
-- NUMBERING: …016, the next free slot after T9's …015.

-- ─────────────────────────────────────────────────────────────────────────
-- request_price_change — open the gate + satellite.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_price_change(
  p_sku           TEXT,
  p_field         TEXT,
  p_new_value     NUMERIC,
  p_reason_note   TEXT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID;
  v_old      NUMERIC;
  v_approval BIGINT;
  v_payload  JSONB;
BEGIN
  -- Resolve actor: explicit arg → auth.uid() → system sentinel UUID. Same
  -- COALESCE pattern as request_adjustment so a NOT NULL requested_by is
  -- always satisfied even when the call originates from a server-side
  -- automation without a JWT.
  v_actor := COALESCE(
    p_actor_user_id,
    auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  -- Field whitelist — fail fast with a friendly error rather than letting a
  -- bad %I substitution surface as a column-does-not-exist later.
  IF p_field NOT IN ('price', 'harga_modal') THEN
    RAISE EXCEPTION 'invalid field %, must be price or harga_modal', p_field;
  END IF;

  IF p_new_value < 0 THEN
    RAISE EXCEPTION 'new_value must be >= 0';
  END IF;

  -- Snapshot current stocks.<field> via dynamic SQL. Column whitelisted
  -- above; %I quotes defensively. Row-lock not required here: we don't
  -- mutate stocks until commit time, and the snapshotted value is what
  -- the Owner sees in the approval card regardless of any later drift.
  EXECUTE format('SELECT %I FROM public.stocks WHERE sku = $1', p_field)
    INTO v_old USING p_sku;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'sku % not found in stocks', p_sku;
  END IF;

  v_payload := jsonb_build_object(
    'sku',         p_sku,
    'field',       p_field,
    'old_value',   v_old,
    'new_value',   p_new_value,
    'reason_note', p_reason_note
  );

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('price_change'::public.approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO public.price_change_requests
    (sku, field, old_value, new_value, reason_note,
     approval_request_id, requested_by)
  VALUES
    (p_sku, p_field, v_old, p_new_value, p_reason_note,
     v_approval, v_actor);

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_price_change(
  TEXT, TEXT, NUMERIC, TEXT, UUID
) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- commit_approved_price_change — apply the change once the gate is approved.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.commit_approved_price_change(
  p_approval_id   BIGINT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_ar    RECORD;
  v_pcr   RECORD;
BEGIN
  v_actor := COALESCE(
    p_actor_user_id,
    auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  -- Step 1: lock the gate row and verify it has been approved. Locking
  -- serializes against a concurrent reject_price_change (future T11).
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    -- Test pattern-matches on 'not approved' substring; keep verbatim.
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  -- Step 2: lock the satellite row. status='pending' guard catches a
  -- double-commit attempt even if the gate was somehow re-approved after a
  -- prior commit (defensive — _transition_approval's status='pending'
  -- WHERE clause already prevents the gate from moving twice).
  SELECT * INTO v_pcr
    FROM public.price_change_requests
   WHERE approval_request_id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no price_change_request for approval_request %', p_approval_id;
  END IF;
  IF v_pcr.status <> 'pending' THEN
    RAISE EXCEPTION 'price_change_request % already %', v_pcr.id, v_pcr.status;
  END IF;

  -- Step 3: apply the price update to stocks. Field is whitelisted by the
  -- price_change_requests CHECK constraint at INSERT time, so by the time
  -- we read it here it can only be 'price' or 'harga_modal'. %I quotes
  -- belt-and-suspenders.
  EXECUTE format('UPDATE public.stocks SET %I = $1 WHERE sku = $2', v_pcr.field)
    USING v_pcr.new_value, v_pcr.sku;

  -- Step 4: write the immutable audit row. source='approval' distinguishes
  -- it from 'seed' rows reserved for tests/data migrations.
  INSERT INTO public.stock_price_history
    (sku, field, old_value, new_value, source,
     related_request_id, actor_user_id, actor_role)
  VALUES
    (v_pcr.sku, v_pcr.field, v_pcr.old_value, v_pcr.new_value, 'approval',
     v_pcr.id, v_actor, 'price_change_commit');

  -- Step 5: close out the satellite workflow row.
  UPDATE public.price_change_requests
     SET status       = 'approved',
         decided_at   = now(),
         decided_by   = v_actor,
         committed_at = now()
   WHERE id = v_pcr.id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_price_change(BIGINT, UUID) TO authenticated;
