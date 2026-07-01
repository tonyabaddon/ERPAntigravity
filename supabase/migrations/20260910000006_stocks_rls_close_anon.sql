-- 20260910000006 — stocks: close the anon holes; authenticated mutation kept
--                   pending an app-level refactor
--
-- BUG FOUND during E2E audit on 2026-07-01: the `stocks` table has RLS
-- enabled but its only policy is
--
--   "Allow Public Access" FOR ALL TO public USING (true) WITH CHECK (true)
--
-- That policy makes RLS toothless — any role can do any operation. Combined
-- with grants:
--   anon:          SELECT / INSERT / DELETE
--   authenticated: SELECT / INSERT / UPDATE / DELETE
--
-- anyone with the anon key (baked into the frontend bundle) could read the
-- full product catalog + prices + costs (harga_modal), forge new products,
-- delete existing rows. Anyone with a valid JWT could additionally UPDATE
-- prices arbitrarily.
--
-- The failing regression test at backend-go/internal/db/approvals_test.go:1289
-- `TestStocksDirectUpdate_AsAuthenticated_Fails` was intended to prove a
-- REVOKE landed making direct UPDATE fail with "permission denied". The
-- REVOKE never landed; the test has been red as a TODO marker.
--
-- WHY THIS ISN'T A FULL FIX
--
-- Closing the authenticated-can-mutate hole cleanly requires refactoring
-- ~7-8 client mutation sites through SECURITY DEFINER RPCs:
--   - src/lib/supabaseClient.ts (UPDATE line 157, DELETE 179, UPDATE 1205,
--     UPSERT 1224, UPSERT 1261)
--   - src/lib/products/productWrappers.ts:49 (INSERT)
--   - src/components/pembelian/bnl/SkuPickerWithInlineCreate.tsx:39 (INSERT)
--
-- Each of those needs to move from raw .insert/.update/.delete/.upsert to
-- calling an RPC like upsert_product / delete_product / adjust_stocks. That
-- is a separate follow-up commit tracked in progress.md.
--
-- WHAT THIS MIGRATION DOES
--
--   1. DROP the "Allow Public Access" ALL policy.
--   2. Add per-operation policies scoped to `authenticated`:
--        - SELECT USING (true)     — public catalog for logged-in users.
--        - INSERT WITH CHECK (true) — matches existing client insert paths.
--        - UPDATE USING (true) WITH CHECK (true) — matches existing paths.
--        - DELETE USING (true)      — matches existing delete paths.
--
-- Net effect for anon (the anon key baked into the bundle):
--   BEFORE: SELECT + INSERT + DELETE all worked via "Allow Public Access".
--   AFTER:  SELECT → []; INSERT → 42501; DELETE → 42501.
--
-- Net effect for authenticated:
--   BEFORE: full CRUD via "Allow Public Access".
--   AFTER:  full CRUD via the four new authenticated-scoped policies.
--   Same UX. No app breakage.
--
-- The failing test stays red — that's expected and documented. When the
-- client-refactor follow-up lands, this migration will be superseded by
-- one that drops the UPDATE policy (and possibly INSERT/DELETE) so mutations
-- must go through SD RPCs, at which point the test flips green.
--
-- Rollback (emergency only):
--   DROP POLICY stocks_read_authenticated ON public.stocks;
--   DROP POLICY stocks_insert_authenticated ON public.stocks;
--   DROP POLICY stocks_update_authenticated ON public.stocks;
--   DROP POLICY stocks_delete_authenticated ON public.stocks;
--   CREATE POLICY "Allow Public Access" ON public.stocks FOR ALL TO public
--     USING (true) WITH CHECK (true);
--   -- (Re-opens the anon holes — do not run unless there's a real problem.)

DROP POLICY IF EXISTS "Allow Public Access" ON public.stocks;

DROP POLICY IF EXISTS stocks_read_authenticated ON public.stocks;
CREATE POLICY stocks_read_authenticated
  ON public.stocks
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS stocks_insert_authenticated ON public.stocks;
CREATE POLICY stocks_insert_authenticated
  ON public.stocks
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS stocks_update_authenticated ON public.stocks;
CREATE POLICY stocks_update_authenticated
  ON public.stocks
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS stocks_delete_authenticated ON public.stocks;
CREATE POLICY stocks_delete_authenticated
  ON public.stocks
  FOR DELETE
  TO authenticated
  USING (true);
