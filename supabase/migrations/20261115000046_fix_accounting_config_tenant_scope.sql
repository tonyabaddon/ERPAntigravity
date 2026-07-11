-- 20261115000046_fix_accounting_config_tenant_scope.sql
--
-- QA cycle Session 1 finding (P0): every write RPC that dispatches a GL
-- dual-write reads `public.accounting_config WHERE tenant_id IS NULL LIMIT 1`.
-- That was correct in the single-config-row era; after multi-tenant landed,
-- per-tenant rows have `tenant_id` populated, so the lookup returns 0 rows
-- and the RPC silently skips the entire GL block (guarded by
-- `IF COALESCE(v_dual_write, false)` which is false when the SELECT missed).
--
-- Verified empirically 2026-07-11:
--   - Garindo has `accounting_config` row with `tenant_id = 11111111-...` and
--     `enable_dual_write_to_gl = true`, `default_kas_account_id` set.
--   - Recorded a walk-in cash sale via UI → `kasir_transactions` row created,
--     `stock_movements` created, but ZERO rows in `journal_entries` for the
--     sale, ZERO rows in `gl_dual_write_anomalies` (the fail-soft table).
--     Only path that produces this pattern is the GL block being skipped
--     entirely — confirming the `tenant_id IS NULL` mismatch.
--   - Historical `KASIR_SALE` GL entries: 11 out of 83 income kasir_transactions
--     for Garindo. Suggests bug has been present since multi-tenant rollout;
--     the 11 GL entries are from pre-Phase-A seed / test runs.
--
-- Affected RPCs (all present the same pattern):
--   record_kasir_sale       — Kasir sale (WLK/GSR/SLS/EXP/etc)
--   record_pi               — Purchase invoice
--   record_pembayaran       — Supplier payment
--   record_piutang_payment  — Customer tempo payment
--   _phase0c_backfill_historical — one-shot backfill helper
--
-- Fix: rewrite the RPC bodies in place, replacing
--   `FROM public.accounting_config WHERE tenant_id IS NULL LIMIT 1`
-- with
--   `FROM public.accounting_config WHERE tenant_id = public._resolve_tenant_id() LIMIT 1`
-- Done via `pg_get_functiondef` + `regexp_replace` + `EXECUTE` so we do not
-- have to hand-copy each ~500-line RPC body.

BEGIN;

-- Two regex passes because the RPC bodies use slightly different formatting:
-- some have `FROM public.accounting_config WHERE tenant_id IS NULL LIMIT 1`,
-- others have `FROM accounting_config\n  WHERE tenant_id IS NULL` without the
-- `public.` prefix or `LIMIT 1`. Broader second pattern catches the rest.

DO $$
DECLARE
  r record;
  v_body text;
BEGIN
  FOR r IN
    SELECT p.proname, p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND p.proname IN (
        'record_kasir_sale',
        'record_pi',
        'record_pembayaran',
        'record_piutang_payment',
        '_phase0c_backfill_historical'
      )
      AND pg_get_functiondef(p.oid) ~ 'FROM\s+(public\.)?accounting_config\s+WHERE\s+tenant_id\s+IS\s+NULL'
  LOOP
    v_body := pg_get_functiondef(r.oid);
    v_body := regexp_replace(
      v_body,
      'FROM\s+(public\.)?accounting_config\s+WHERE\s+tenant_id\s+IS\s+NULL',
      'FROM public.accounting_config WHERE tenant_id = public._resolve_tenant_id()',
      'g'
    );
    EXECUTE v_body;
    RAISE NOTICE 'patched %', r.proname;
  END LOOP;
END $$;

COMMIT;
