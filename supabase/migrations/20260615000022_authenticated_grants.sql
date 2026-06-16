-- supabase/migrations/20260615000022_authenticated_grants.sql
-- ProductForm submit hit 403 "permission denied for table stocks" when
-- POSTing via the authenticated role. The existing tables have RLS policies
-- that USING/WITH CHECK (true), but table-level GRANTs to `authenticated`
-- were missing. Bulk upload worked because that path runs while operating
-- as a less-restricted role. Fix: grant INSERT/UPDATE/DELETE/SELECT
-- to authenticated for the tables Phase 2 writes from the UI.
--
-- Idempotent: GRANT statements are repeatable.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocks               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_brands       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_units        TO authenticated;
GRANT SELECT, INSERT                ON public.approval_requests   TO authenticated;
GRANT SELECT, INSERT                ON public.ai_call_log         TO authenticated;
