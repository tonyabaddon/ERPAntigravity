-- 20260910000004 — Phase 2 batch 2c: RLS for stock_opname_sessions + audit_log
--
-- Continues the batched Phase 2 sweep. Adds an important wrinkle: audit_log
-- has a direct client-side INSERT (order-modification audit-before-mutate
-- pattern at EditOrderModal.tsx:59). A pure "SELECT-only" policy would break
-- the order-edit flow, so this migration adds a scoped INSERT policy for
-- audit_log too.
--
--   * stock_opname_sessions (208 rows)
--       - Read: authenticated ONLY. Consumer: opname history list
--         (`listOpnameSessions`) + detail (`getOpnameSession`).
--       - Client sites: supabaseClient.ts:1968 (`listOpnameSessions`, limit
--         + ORDER BY started_at), 1979 (`getOpnameSession` by id).
--       - Mutations: SD RPCs (start_opname, submit_opname, commit_opname_*,
--         reject_opname_*). No client INSERT/UPDATE/DELETE.
--       - No tenant_id column — link via counted_by_user_id + admin_users.
--         Multi-tenant Sub-Project A TODO: tighten USING(true) to a filter
--         on counted_by_user_id's tenant.
--
--   * audit_log (31 rows, append-only log)
--       - Read: authenticated ONLY. Consumers:
--           - `fetchOpnameAuditLog` (event_type IN opname_*)
--           - `fetchRakitLockHistory` (event_type IN rakit_lock_*)
--           - `fetchRecentRejectsByOrder` (event_type='rakit_lock_rejected')
--           - `PreOrderFulfillmentsCard` (event_type='preorder_fulfilled')
--         All reads are filtered by event_type + time window client-side.
--       - Write: authenticated INSERT gated on actor_user_id = auth.uid().
--         The only client-side write is at EditOrderModal.tsx:59, part of
--         an audit-before-mutate pattern (audit succeeds first, then the
--         kasir_transactions UPDATE). Losing this write path would leave
--         the order-edit feature broken; forbidding it entirely would
--         require reworking that flow to route through an SD RPC.
--       - WITH CHECK invariant: `actor_user_id = auth.uid()` — client can
--         only insert audit rows attributing themselves as actor. Prevents
--         impersonation (writing a row that blames another user).
--       - `actor_user_id IS NULL` inserts (system events) fall to SD RPCs,
--         which bypass RLS anyway.
--       - No tenant_id column — audit_log carries all-tenant events; when
--         Sub-Project A ships, add a tenant_id column + tighten policies.
--
-- Access-level gating (Owner/Admin only for audit_log SELECT) is not
-- enforced at the DB layer here. UI restricts most audit reads to admin
-- screens, but PostgREST would let any authenticated user SELECT by
-- event_type. Follow-up: add role-gated read via is_owner_or_admin()
-- helper. Out of scope for this batch; matches current runtime behavior.
--
-- Grants: still wide-open (SELECT/INSERT/UPDATE/DELETE for anon+authenticated
-- on both tables) — same as batch 2b. RLS is the only block until a
-- separate REVOKE migration lands.
--
-- What changes for anon:
--   BEFORE: full SELECT/INSERT/UPDATE/DELETE. Anyone with the anon key
--           could read all audit events (including sensitive fields in
--           `payload` jsonb), forge audit rows for arbitrary actors, or
--           delete evidence.
--   AFTER:  SELECT → [] (no policy). INSERT → 42501 (no policy). Same for
--           UPDATE/DELETE.
--
-- What changes for authenticated:
--   BEFORE: unrestricted SELECT/INSERT/UPDATE/DELETE.
--   AFTER:  SELECT allowed (USING true). INSERT allowed only on audit_log
--           with `actor_user_id = auth.uid()` invariant. UPDATE/DELETE
--           blocked. stock_opname_sessions has no client INSERT need, so
--           no INSERT policy for it.
--
-- Verification post-apply:
--   1. pg_class.relrowsecurity=true for both.
--   2. Anon curl GET /rest/v1/stock_opname_sessions → [] (was: real rows).
--   3. Anon curl GET /rest/v1/audit_log → [] (was: real rows).
--   4. Anon POST /rest/v1/audit_log {...} → 42501 (was: 201 Created).
--   5. Authenticated POST audit_log with actor_user_id=self → 201 (works).
--   6. Authenticated POST audit_log with actor_user_id=<other-uuid> →
--      42501 (impersonation blocked).
--   7. Live UI: Stok Opname landing lists sessions; Sales Order detail
--      shows rakit lock history; dashboard shows pre-order fulfillments;
--      editing an order records the audit row and then updates the kasir
--      transaction.
--
-- Rollback (emergency only, re-opens the hole):
--   DROP POLICY stock_opname_sessions_read_authenticated ON public.stock_opname_sessions;
--   DROP POLICY audit_log_read_authenticated ON public.audit_log;
--   DROP POLICY audit_log_write_self_as_actor ON public.audit_log;
--   ALTER TABLE public.stock_opname_sessions DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_opname_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_opname_sessions_read_authenticated ON public.stock_opname_sessions;
CREATE POLICY stock_opname_sessions_read_authenticated
  ON public.stock_opname_sessions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS audit_log_read_authenticated ON public.audit_log;
CREATE POLICY audit_log_read_authenticated
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS audit_log_write_self_as_actor ON public.audit_log;
CREATE POLICY audit_log_write_self_as_actor
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_user_id = auth.uid());
