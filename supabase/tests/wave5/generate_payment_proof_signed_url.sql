-- ============================================================
-- pgTAP: generate_payment_proof_signed_url
--
-- This RPC was NOT implemented because storage.*sign* SQL functions
-- do not exist in this Supabase project (verified via MCP:
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='storage' AND proname LIKE '%sign%' → 0 rows).
--
-- The FE must use the Supabase client SDK directly:
--   supabase.storage.from('payment-proofs').createSignedUrl(objectKey, 3600)
--
-- This file documents the test contract that WOULD apply if the RPC
-- were implemented, for future reference when Supabase exposes a
-- storage sign-URL Postgres API.
-- ============================================================

BEGIN;
SELECT plan(1);

-- ── Smoke test: function does NOT exist (expected state) ──────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'generate_payment_proof_signed_url'
      AND pronamespace = 'public'::regnamespace
  ),
  'generate_payment_proof_signed_url function does not exist (no SQL sign-URL API available; FE uses client SDK)'
);

SELECT * FROM finish();
ROLLBACK;
