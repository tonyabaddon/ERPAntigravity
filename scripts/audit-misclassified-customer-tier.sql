-- audit-misclassified-customer-tier.sql
--
-- Read-only audit: surface customers with default_pricing_tier = 'eceran'
-- but signals suggesting they should be 'grosir' (business context: they
-- have a company name filled in, OR they've been granted TEMPO — both
-- typical wholesale-buyer signals).
--
-- Usage (from MCP execute_sql or psql):
--   Set p_tenant_id to the target tenant UUID, then run:
--     :setvar tenant_id '<uuid-here>'
--   Or replace $1 with the literal UUID before running.
--
-- Output is a candidate list for the tenant owner to review. No auto-fix.
-- Owner corrects tier from the Pelanggan Screen edit modal.
--
-- Related spec: docs/superpowers/specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md

SELECT
  id,
  name,
  company,
  wa_number,
  allows_tempo,
  created_at
FROM public.customers
WHERE tenant_id = $1
  AND default_pricing_tier = 'eceran'
  AND (
    (company IS NOT NULL AND company <> '')
    OR allows_tempo = TRUE
  )
ORDER BY created_at DESC;
