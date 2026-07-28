# Phase 1b — Owner-Configurable Pricing Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing 2-tier pricing (eceran + grosir) to owner-configurable 2-4 tiers per tenant, with per-tier labels, per-tier product prices, invoice-label snapshot on write, and orphan-tolerant disable semantics.

**Architecture:** Fixed 4-column extension on `public.tenant_settings` (labels) + `public.stocks` (tier prices), widened `customers.default_pricing_tier` CHECK, and `pricing_tier_label` stamped inside items JSONB on `sales_orders`/`kasir_transactions`. New SECDEF RPC `update_tenant_tier_config` mirrors kasir-expense pattern (`OWNER TO postgres`, `_resolve_tenant_id`, `admin_users` owner check, `TCFG_*` error taxonomy). New FE helper `getActiveTiers` becomes single source of truth for "what tiers exist on this tenant"; every consumer of tier data (customer pills, quotation toggle, StockManager columns, product form, PDF renderer) reads through it.

**Tech Stack:** PostgreSQL 15 (Supabase managed), React 19 + TypeScript, Vitest + @testing-library/react, Tailwind (existing tokens only — no new colors), Supabase JS client, Supabase Management API for RPC smoke.

**Spec:** [`docs/superpowers/specs/2026-07-28-phase-1b-tier-config-design.md`](../specs/2026-07-28-phase-1b-tier-config-design.md) (commit `f26b46e`)
**Decision memo:** [`docs/superpowers/specs/2026-07-28-phase-1b-tier-config-decision.md`](../specs/2026-07-28-phase-1b-tier-config-decision.md)
**Prior phase reference:** Phase 1a plan at [`docs/superpowers/plans/2026-07-24-customer-pricing-tier-add-form-fix-plan.md`](2026-07-24-customer-pricing-tier-add-form-fix-plan.md)

## Global Constraints

- **No new design tokens.** Pill palette reuses tier-filter chip colors from `PelangganScreen.tsx:242-244`: base tier navy `bg-[#012749]` active; grosir + tier_3 + tier_4 reuse purple `bg-purple-600` active; inactive `bg-gray-100 text-gray-500`. Dark-header pill palette (PelangganScreen edit): base = `bg-white text-[#012749]`, others = `bg-purple-500 text-white`, inactive = `bg-white/10 text-white/70`. Font size ≥ 11px per memory `font_sizing`.
- **Bahasa Indonesia labels only.** Panel title = `Tingkat Harga`. Field labels = `Tier 1 (Base)`, `Tier 2`, `Tier 3`, `Tier 4`. Helper = `Owner bisa set 2-4 tingkat harga per SKU. Tier 1 & 2 wajib; Tier 3 & 4 opsional (kosongkan = off).` No emojis in labels.
- **SECDEF RPC pattern per PR #67 hotfix + kasir-expense precedent:** `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`, `v_actor := auth.uid()`, `v_tenant_id := public._resolve_tenant_id()`, inline `admin_users WHERE role='Owner'` check, structured `TCFG_*` errcodes, `ALTER FUNCTION ... OWNER TO postgres` (NOT `vosi_rpc_owner` — that lacks USAGE on schema `auth`), `GRANT EXECUTE ... TO authenticated`, `REVOKE EXECUTE ... FROM anon`.
- **Error taxonomy:** `TCFG_FORBIDDEN` (errcode `P0403`, non-Owner caller), `TCFG_LABEL_INVALID` (`P0400`, length not 3-30 with `hint='tier_N'`), `TCFG_LABEL_DUPLICATE` (`P0409`, case-insensitive collision).
- **Migrations idempotent per CLAUDE.md guardrail:** `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + re-add, `CREATE OR REPLACE FUNCTION`. Safe to re-run.
- **Migration slots:** `20261115000542` (schema + panel RPC) and `20261115000543` (widen sales RPCs). Both verified free as of 2026-07-28 (last used `000541`).
- **Existing keys stay literal:** `'eceran'` and `'grosir'` remain the tier_1/tier_2 keys forever. New tiers use `'tier_3'` and `'tier_4'` as keys. UI labels come from `tenant_settings.tier_N_label`.
- **Backend Go WA-onboard path untouched** — WA-created customer keeps DB default `'eceran'`. No files under `backend-go/` change.
- **Observability (CLAUDE.md non-negotiable):** entry log breadcrumb on Pengaturan → Tingkat Harga panel open (`captureBreadcrumb({category:'feature', message:'tier_config_panel_open', data:{tenant_id, user_id}})`); error log on RPC failure (`captureError(err, {feature:'tier_config', action:'update'})`); usage counter via `console.info('[tier_config] updated', {tenant_id, tier_count})`.
- **Stage 1 gates before commit:** `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npm run audit:csp-backend-allowlist`, `npm run audit:no-string-err-fallback`, `npx vitest run` (or scoped `--changed`).
- **Stage 3 smoke tenant:** `Toko Jaya Makmur` only (tenant UUID `22222222-2222-2222-2222-222222222222`) per memory `production-testing-tenant`; NEVER a real customer tenant.
- **Prod promote:** manual via `scripts/promote-to-prod.sh <SHORT_SHA>` per memory `manual_prod_gate_after_real_tenant`.
- **Commit style:** Conventional-Commits scoped prefixes with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- **Working tree caveat:** `main` has ~15-20 unrelated modified files from prior work. Every task's `git add` MUST name specific files only; NEVER `git add .`, `git add -A`, or `git add src/`. Verify with `git status --short` before staging.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql` (new) | Add label columns to `tenant_settings`, price columns to `stocks`, widen `customers` CHECK; ship `update_tenant_tier_config` SECDEF RPC. |
| `supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql` (new) | Widen `record_kasir_sale` + `create_tempo_invoice` for 4-key INVALID_TIER + tier price COALESCE cascade + `pricing_tier_label` snapshot into items JSONB. Both RPCs' authoritative bodies live in slot `20261115000325`. |
| `src/types.ts` (modify) | Widen `default_pricing_tier` union to `TierKey` (import from `src/lib/pricing/getActiveTiers.ts`); extend `DbTenantSettings` with `tier_N_label` fields; extend `SupabaseStockItem` with `price_tier_3` / `price_tier_4`. |
| `src/lib/supabaseClient.ts` (modify) | Add `updateTenantTierConfig(labels)` wrapper for the new RPC; extend `SupabaseStockItem` shape mirror if the row-mapping code lives here. |
| `src/lib/pricing/getActiveTiers.ts` (new) | Export `TierKey` type + `Tier` interface + `getActiveTiers(settings): Tier[]` + `resolveEffectiveTier(customerTier, settings): TierKey` + `getTierPrice(stock, tier): number`. Single source of truth. |
| `src/lib/pricing/getActiveTiers.test.ts` (new) | Vitest unit tests for the helper. |
| `src/components/pengaturan/TierConfigPanel.tsx` (new) | New Pengaturan tab/section with 4 label inputs; gated by `modul_multi_tier_price`; save via `updateTenantTierConfig`; TCFG_* error mapping; observability breadcrumb + error capture + usage log. |
| `src/components/pengaturan/TierConfigPanel.test.tsx` (new) | Vitest tests for form validation, save, TCFG error UI, disable via clear. |
| `src/components/PengaturanScreen.tsx` (modify) | Wire `TierConfigPanel` into the existing Pengaturan screen navigation. Verify current file structure at implementation time. |
| `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` (modify) | Replace 2-pill hardcode with `getActiveTiers`-driven pill list; widen `tier` state to `TierKey`. |
| `src/components/PelangganScreen.tsx` (modify) | Generalize edit-header pills to N tiers; generalize left-panel tier filter chips from 3 fixed (Semua/Eceran/Grosir) to Semua + N active tiers. |
| `src/components/penjualan/CatatPenjualanWizard.tsx` (modify) | Widen `activeTier` state to `TierKey`; auto-sync uses `resolveEffectiveTier`; pill row uses `getActiveTiers`; cart price-picking uses `getTierPrice`. |
| `src/components/penjualan/CartRows.tsx` (modify) | Generalize grosir-only fallback warning to any non-base tier via `getTierPrice`. |
| `src/components/produk/ProductForm.tsx` (modify) | Add 2 conditional NumberInput fields for `price_tier_3` / `price_tier_4`, gated by `getActiveTiers`. |
| `src/components/produk/StockTableView.tsx` (modify) | Add 2 conditional table columns for tier_3/tier_4 prices, gated by `getActiveTiers`. Same inline-edit pattern as existing `price_grosir` column. |
| `src/components/produk/BulkUpdateGrosirSection.tsx` (rename → `BulkUpdateTierPricesSection.tsx`, modify) | Rename file; widen CSV columns to include `price_tier_3_lama/baru`, `price_tier_4_lama/baru`; parser tolerates missing columns for backward compat. |
| `src/components/produk/BulkUpdateGrosirSection.test.tsx` (rename → `BulkUpdateTierPricesSection.test.tsx`, modify) | Rename test file; update tests for wider CSV. |
| `src/components/StockManagerScreen.tsx` (modify) | Update import to renamed component. |
| `src/lib/pengaturan/cascadeMap.ts` (modify) | Rename `FieldKey` `csv_bulk_grosir_button` → `csv_bulk_tier_prices_button`; widen `cascadeImpactSummary` for `modul_multi_tier_price` to count `default_pricing_tier != 'eceran'`. |
| `src/components/PelangganScreen.test.tsx` (modify) | Parametrize existing tier tests to run against 2/3/4-tier settings. |
| `src/components/penjualan/wizard/Step1ChannelCustomer.tsx` (verify only) | Verify no changes needed — should just forward existing `showTierField` prop. Explicit no-op task step. |
| `scripts/audit-misclassified-customer-tier.sql` (modify) | Widen `AND default_pricing_tier = 'eceran'` heuristic to include tier_3/tier_4 candidates. |
| `progress.md` (modify) | Append Phase 1b SHIPPED entry with WHY + links to memo + spec + plan + commits. |

**Total: 2 migrations + 1 new helper module + 1 new panel + 2 renames + ~10 modified FE files + 3 test files (2 new + 3 parametrized).**

---

## Task 1: Migration slot `000542` — schema + `update_tenant_tier_config` RPC

**Files:**
- Create: `supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql`

**Interfaces:**
- Consumes: existing `_resolve_tenant_id()` (verified at `20261115000523:20`), existing `admin_users` table.
- Produces:
  - `tenant_settings.tier_1_label TEXT NOT NULL DEFAULT 'Eceran'`
  - `tenant_settings.tier_2_label TEXT NOT NULL DEFAULT 'Grosir'`
  - `tenant_settings.tier_3_label TEXT` (nullable = disabled)
  - `tenant_settings.tier_4_label TEXT` (nullable = disabled)
  - `stocks.price_tier_3 NUMERIC` (nullable, fallback to `price`)
  - `stocks.price_tier_4 NUMERIC` (nullable, fallback to `price`)
  - Widened `customers_default_pricing_tier_check` CHECK: `IN ('eceran','grosir','tier_3','tier_4')`
  - `public.update_tenant_tier_config(p_tier_1_label TEXT, p_tier_2_label TEXT, p_tier_3_label TEXT, p_tier_4_label TEXT) RETURNS void` — owner-only, TCFG_* errors, `OWNER TO postgres`, granted to `authenticated`.

- [ ] **Step 1: Verify slot 542 still free + `_resolve_tenant_id` exists**

Run:
```bash
ls supabase/migrations/ | grep -E '2026111500054[0-9]|2026111500055[0-9]' | sort
grep -n '_resolve_tenant_id' supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql | head -3
```

Expected: `000540` and `000541` present; `000542+` free. `_resolve_tenant_id` referenced in slot `000523` (line 20).

If slot 542 is now taken (parallel session claimed it), use the next free slot.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql` with exactly this content:

```sql
-- 20261115000542_tier_config_schema_and_rpc.sql
-- Phase 1b Task 1 — Owner-configurable 2-4 pricing tiers per tenant.
-- Adds tier label columns to tenant_settings, price columns to stocks,
-- widens customers.default_pricing_tier CHECK, ships update_tenant_tier_config RPC.
--
-- Idempotent: safe to re-run. Adds columns IF NOT EXISTS, drops CHECK IF EXISTS
-- before re-add, CREATE OR REPLACE for function.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.update_tenant_tier_config(text,text,text,text);
--   ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
--   ALTER TABLE public.customers ADD CONSTRAINT customers_default_pricing_tier_check
--     CHECK (default_pricing_tier IN ('eceran','grosir'));
--   ALTER TABLE public.stocks DROP COLUMN IF EXISTS price_tier_3, DROP COLUMN IF EXISTS price_tier_4;
--   ALTER TABLE public.tenant_settings
--     DROP COLUMN IF EXISTS tier_1_label,
--     DROP COLUMN IF EXISTS tier_2_label,
--     DROP COLUMN IF EXISTS tier_3_label,
--     DROP COLUMN IF EXISTS tier_4_label;

-- ─── Schema: tenant_settings label columns ───────────────────────────────────
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS tier_1_label TEXT NOT NULL DEFAULT 'Eceran',
  ADD COLUMN IF NOT EXISTS tier_2_label TEXT NOT NULL DEFAULT 'Grosir',
  ADD COLUMN IF NOT EXISTS tier_3_label TEXT,
  ADD COLUMN IF NOT EXISTS tier_4_label TEXT;

-- ─── Schema: stocks price columns ────────────────────────────────────────────
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS price_tier_3 NUMERIC,
  ADD COLUMN IF NOT EXISTS price_tier_4 NUMERIC;

-- ─── Schema: widen customers CHECK ───────────────────────────────────────────
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_default_pricing_tier_check
    CHECK (default_pricing_tier IN ('eceran','grosir','tier_3','tier_4'));

-- ─── SECDEF RPC: update_tenant_tier_config ───────────────────────────────────
-- Error taxonomy:
--   TCFG_FORBIDDEN         (P0403) — caller is not Owner role
--   TCFG_LABEL_INVALID     (P0400) — label length not 3-30 (with hint = 'tier_N')
--   TCFG_LABEL_DUPLICATE   (P0409) — case-insensitive collision among active labels

CREATE OR REPLACE FUNCTION public.update_tenant_tier_config(
  p_tier_1_label TEXT,
  p_tier_2_label TEXT,
  p_tier_3_label TEXT,
  p_tier_4_label TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_tenant_id   uuid := public._resolve_tenant_id();
  v_t1 TEXT := TRIM(p_tier_1_label);
  v_t2 TEXT := TRIM(p_tier_2_label);
  v_t3 TEXT := NULLIF(TRIM(COALESCE(p_tier_3_label, '')), '');
  v_t4 TEXT := NULLIF(TRIM(COALESCE(p_tier_4_label, '')), '');
  v_labels TEXT[];
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'TCFG_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Length validation: tier_1/2 required 3-30 chars; tier_3/4 NULL or 3-30
  IF LENGTH(v_t1) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_1';
  END IF;
  IF LENGTH(v_t2) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_2';
  END IF;
  IF v_t3 IS NOT NULL AND LENGTH(v_t3) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_3';
  END IF;
  IF v_t4 IS NOT NULL AND LENGTH(v_t4) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_4';
  END IF;

  -- Case-insensitive uniqueness among active labels
  v_labels := ARRAY_REMOVE(ARRAY[LOWER(v_t1), LOWER(v_t2),
                                 LOWER(COALESCE(v_t3, '')), LOWER(COALESCE(v_t4, ''))],
                           '');
  IF cardinality(v_labels) <> cardinality(ARRAY(SELECT DISTINCT unnest(v_labels))) THEN
    RAISE EXCEPTION 'TCFG_LABEL_DUPLICATE' USING errcode = 'P0409';
  END IF;

  UPDATE public.tenant_settings
     SET tier_1_label = v_t1,
         tier_2_label = v_t2,
         tier_3_label = v_t3,
         tier_4_label = v_t4,
         updated_at   = now()
   WHERE tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.update_tenant_tier_config(text, text, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_tenant_tier_config(text, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_tenant_tier_config(text, text, text, text) FROM anon;
```

- [ ] **Step 3: Apply migration to staging DB via Management API**

Load env + curl to apply:
```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}" | jq
```

Expected: `[]` (no rows returned by DDL). Verify no error field in response.

- [ ] **Step 4: Verify columns + constraint + RPC exist**

Run:
```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT column_name FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''tenant_settings'\'' AND column_name LIKE '\''tier_%_label'\'' ORDER BY column_name;"}'
```
Expected: 4 rows — `tier_1_label`, `tier_2_label`, `tier_3_label`, `tier_4_label`.

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT column_name FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''stocks'\'' AND column_name LIKE '\''price_tier_%'\'' ORDER BY column_name;"}'
```
Expected: 2 rows — `price_tier_3`, `price_tier_4`.

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='\''customers_default_pricing_tier_check'\'';"}'
```
Expected: constraint text contains `IN ('eceran', 'grosir', 'tier_3', 'tier_4')`.

- [ ] **Step 5: Smoke the RPC via fake auth.uid + RAISE EXCEPTION rollback**

Per memory `smoke_test_security_definer_rpcs`. Pick a real Owner user id on the test tenant first:

```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT au.id, au.role, au.tenant_id FROM public.admin_users au WHERE au.tenant_id='\''22222222-2222-2222-2222-222222222222'\'' AND au.role='\''Owner'\'' LIMIT 1;"}'
```
Expected: at least one Owner user. Note the `id` value; call it `<owner-uid>` in the next queries.

Then happy-path smoke with RAISE at the end so state rolls back:

```bash
source .env
OWNER_UID="<paste-owner-uid-here>"
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg uid "$OWNER_UID" '{query: "DO $do$ BEGIN PERFORM set_config('\''request.jwt.claim.sub'\'', '\''\($uid)'\'', true); PERFORM public.update_tenant_tier_config('\''Eceran'\'','\''Grosir'\'','\''Distributor'\'', NULL); RAISE EXCEPTION '\''SMOKE_OK'\''; END $do$;"}')"
```
Expected: response contains `"SMOKE_OK"` (any 40001-like state is acceptable — the point is the RPC reached the RAISE at the end without failing before).

If instead you get `TCFG_FORBIDDEN` — the owner-uid you picked isn't in `admin_users` with role='Owner' anymore; pick a different one.

Duplicate-label test (should fail with TCFG_LABEL_DUPLICATE):

```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg uid "$OWNER_UID" '{query: "DO $do$ BEGIN PERFORM set_config('\''request.jwt.claim.sub'\'', '\''\($uid)'\'', true); PERFORM public.update_tenant_tier_config('\''Grosir'\'','\''Grosir'\'', NULL, NULL); END $do$;"}')"
```
Expected: error `TCFG_LABEL_DUPLICATE`.

Length-invalid test:
```bash
source .env
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg uid "$OWNER_UID" '{query: "DO $do$ BEGIN PERFORM set_config('\''request.jwt.claim.sub'\'', '\''\($uid)'\'', true); PERFORM public.update_tenant_tier_config('\''AB'\'','\''Grosir'\'', NULL, NULL); END $do$;"}')"
```
Expected: error `TCFG_LABEL_INVALID` with hint `tier_1`.

- [ ] **Step 6: Idempotency check — re-apply the same migration**

```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}" | jq
```
Expected: no error. `ADD COLUMN IF NOT EXISTS` is a no-op; `DROP CONSTRAINT IF EXISTS` succeeds; `CREATE OR REPLACE` succeeds.

- [ ] **Step 7: Run local audit hooks**

```bash
npm run audit:secdef-null-tenant
npm run audit:no-string-err-fallback
npm run audit:secdef-auth-uid-vosi-owner 2>&1 | tail -10
```
Expected: all clean. The `audit:secdef-auth-uid-vosi-owner` (shipped by PR #67) will detect `OWNER TO vosi_rpc_owner` on SECDEF RPCs that call `auth.uid()` — new RPC uses `OWNER TO postgres` so it should pass.

If `audit:secdef-auth-uid-vosi-owner` does not exist as an npm script, skip Step 7's third check and note in the task report.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000542_tier_config_schema_and_rpc.sql
git commit -m "$(cat <<'EOF'
feat(pricing-tier): migration 000542 — schema + update_tenant_tier_config RPC

Adds tier_1..4_label to tenant_settings (tier_1/2 NOT NULL default
Eceran/Grosir; tier_3/4 nullable = disabled). Adds price_tier_3/4
to stocks (nullable, COALESCE fallback to base). Widens customers
default_pricing_tier CHECK to include tier_3/tier_4.

SECDEF RPC update_tenant_tier_config: owner-only via admin_users
role check, TCFG_* error taxonomy (FORBIDDEN/LABEL_INVALID/DUPLICATE),
case-insensitive uniqueness, OWNER TO postgres (per PR #67 hotfix).

Idempotent. Smoke via Management API + RAISE EXCEPTION rollback
confirmed happy path + duplicate reject + length reject.

Spec: f26b46e §3.1-3.3 + §3.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Type widening + `updateTenantTierConfig` wrapper

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts`

**Interfaces:**
- Consumes: RPC `public.update_tenant_tier_config(text, text, text, text)` from Task 1.
- Produces:
  - `TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4'` (re-exported by both `src/lib/pricing/getActiveTiers.ts` in Task 3 and `src/types.ts`)
  - `DbTenantSettings` gains `tier_1_label: string; tier_2_label: string; tier_3_label: string | null; tier_4_label: string | null;`
  - `DbCustomer.default_pricing_tier: TierKey`
  - `SupabaseStockItem` (or equivalent shape) gains `price_tier_3?: number | null; price_tier_4?: number | null;`
  - `customersService.updateTier(id: string, tier: TierKey): Promise<void>` — signature only widens union.
  - New `tenantSettingsService.updateTierConfig(labels: { tier_1_label: string; tier_2_label: string; tier_3_label: string | null; tier_4_label: string | null; }): Promise<void>` — wraps the RPC.

- [ ] **Step 1: Verify actual field names in `DbTenantSettings` today**

```bash
grep -n 'modul_multi_tier_price\|DbTenantSettings\b' src/types.ts | head -10
```
Expected: locate the `DbTenantSettings` interface declaration and its existing fields (should include `modul_multi_tier_price: boolean`).

- [ ] **Step 2: Widen `DbTenantSettings` in `src/types.ts`**

Locate the `DbTenantSettings` interface. Add the 4 new fields near the existing `modul_multi_tier_price` field. Example patch (adapt to the exact interface shape in the file):

```ts
export interface DbTenantSettings {
  // ... existing fields
  modul_multi_tier_price: boolean;
  // Phase 1b: tier labels — tier_1/2 always non-null (defaulted); tier_3/4 nullable = disabled
  tier_1_label: string;
  tier_2_label: string;
  tier_3_label: string | null;
  tier_4_label: string | null;
  // ... existing fields continue
}
```

- [ ] **Step 3: Widen `default_pricing_tier` union**

Find every occurrence in `src/types.ts` of `default_pricing_tier: 'eceran' | 'grosir'` (and any `'eceran' | 'grosir'` literal union). Widen to `TierKey`:

```ts
// Top of file, add:
export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';

// Then every occurrence like:
default_pricing_tier: 'eceran' | 'grosir'  // OLD
// becomes:
default_pricing_tier: TierKey  // NEW
```

- [ ] **Step 4: Extend `SupabaseStockItem` shape**

Locate the `SupabaseStockItem` interface (likely near line 62-97 of `src/types.ts` per Phase 1a discovery). Add:

```ts
export interface SupabaseStockItem {
  // ... existing fields
  price: number;
  price_grosir?: number | null;
  // Phase 1b: tier_3 and tier_4 prices (nullable = fallback to base `price`)
  price_tier_3?: number | null;
  price_tier_4?: number | null;
  // ... existing fields continue
}
```

- [ ] **Step 5: Add wrapper for `update_tenant_tier_config` RPC**

Locate `tenantSettingsService` in `src/lib/supabaseClient.ts` (or wherever tenant-settings wrappers live). Add:

```ts
export const tenantSettingsService = {
  // ... existing methods

  async updateTierConfig(labels: {
    tier_1_label: string;
    tier_2_label: string;
    tier_3_label: string | null;
    tier_4_label: string | null;
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_tenant_tier_config', {
      p_tier_1_label: labels.tier_1_label,
      p_tier_2_label: labels.tier_2_label,
      p_tier_3_label: labels.tier_3_label,
      p_tier_4_label: labels.tier_4_label,
    });
    if (error) throw error;
  },
};
```

If `tenantSettingsService` lives in a different file (e.g., `src/lib/pengaturan/pengaturanServices.ts`), add the method there instead. Verify by grep at Step 1.

- [ ] **Step 6: Also widen `customersService.updateTier` signature**

Find `customersService.updateTier` in `src/lib/supabaseClient.ts:873-880`. Update the `tier` parameter type from `'eceran' | 'grosir'` to `TierKey`:

```ts
async updateTier(id: string, tier: TierKey): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('customers')
    .update({ default_pricing_tier: tier })
    .eq('id', id);
  if (error) throw error;
},
```

Import `TierKey` at top of `supabaseClient.ts` if not already imported.

- [ ] **Step 7: Type-check + existing tests still pass**

```bash
npx tsc --noEmit
```
Expected: no NEW type errors. Widening a union to include more values is additive; existing narrower assignments still compile. If any narrow-union call site errors, widen it too (Task 6 will do most of these; here we just handle any pre-existing sites in wrappers/services).

```bash
npx vitest run src/components/PelangganScreen.test.tsx
```
Expected: all 11/11 pass unchanged (existing tests use string literals `'eceran'` / `'grosir'` which are compatible with the widened union).

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts
git commit -m "$(cat <<'EOF'
feat(pricing-tier): widen TierKey union + updateTierConfig wrapper

Widens default_pricing_tier from ('eceran'|'grosir') to TierKey =
('eceran'|'grosir'|'tier_3'|'tier_4'). Adds tier_N_label to
DbTenantSettings and price_tier_3/4 to SupabaseStockItem. Wraps
public.update_tenant_tier_config for the Pengaturan panel.

Existing narrow-string call sites remain compatible (string literals
match wider union). No behavioural change on this commit alone.

Spec: f26b46e §4.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `getActiveTiers` helper module + Vitest tests

**Files:**
- Create: `src/lib/pricing/getActiveTiers.ts`
- Create: `src/lib/pricing/getActiveTiers.test.ts`

**Interfaces:**
- Consumes: `TierKey` from Task 2's `src/types.ts` (re-imported and re-exported here for convenience). `DbTenantSettings` from `src/types.ts`.
- Produces (public API of this module):
  ```ts
  export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';
  export interface Tier { key: TierKey; label: string; slot: 1 | 2 | 3 | 4; }
  export function getActiveTiers(s: DbTenantSettings): Tier[];
  export function resolveEffectiveTier(customerTier: TierKey, s: DbTenantSettings): TierKey;
  export function getTierPrice(
    stock: { price: number; price_grosir?: number | null; price_tier_3?: number | null; price_tier_4?: number | null },
    tier: TierKey,
  ): number;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pricing/getActiveTiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getActiveTiers, resolveEffectiveTier, getTierPrice, type TierKey } from './getActiveTiers';
import type { DbTenantSettings } from '../../types';

const BASE_SETTINGS: DbTenantSettings = {
  // Only the fields getActiveTiers/resolveEffectiveTier reads matter here;
  // rest can be minimal to match the interface. Cast to satisfy TS.
  tier_1_label: 'Eceran',
  tier_2_label: 'Grosir',
  tier_3_label: null,
  tier_4_label: null,
} as DbTenantSettings;

describe('getActiveTiers', () => {
  it('returns 2 tiers when tier_3 and tier_4 labels are NULL', () => {
    const tiers = getActiveTiers(BASE_SETTINGS);
    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toEqual({ key: 'eceran', label: 'Eceran', slot: 1 });
    expect(tiers[1]).toEqual({ key: 'grosir', label: 'Grosir', slot: 2 });
  });

  it('returns 3 tiers when tier_3_label is set', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil' };
    const tiers = getActiveTiers(s);
    expect(tiers).toHaveLength(3);
    expect(tiers[2]).toEqual({ key: 'tier_3', label: 'Distributor Kecil', slot: 3 });
  });

  it('returns 4 tiers when both tier_3_label and tier_4_label are set', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil', tier_4_label: 'Distributor Besar' };
    const tiers = getActiveTiers(s);
    expect(tiers).toHaveLength(4);
    expect(tiers[3]).toEqual({ key: 'tier_4', label: 'Distributor Besar', slot: 4 });
  });

  it('preserves tenant-configured labels (renames)', () => {
    const s = { ...BASE_SETTINGS, tier_1_label: 'Retail Toko', tier_2_label: 'Grosir Kecil' };
    const tiers = getActiveTiers(s);
    expect(tiers[0].label).toBe('Retail Toko');
    expect(tiers[1].label).toBe('Grosir Kecil');
  });
});

describe('resolveEffectiveTier', () => {
  it('returns the customer tier when active', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor' };
    expect(resolveEffectiveTier('tier_3', s)).toBe('tier_3');
  });

  it('falls back to eceran when the customer tier is disabled', () => {
    // customer tagged tier_3 but owner cleared tier_3_label
    expect(resolveEffectiveTier('tier_3', BASE_SETTINGS)).toBe('eceran');
  });

  it('keeps eceran and grosir even if legacy customer stores them (both always active)', () => {
    expect(resolveEffectiveTier('eceran', BASE_SETTINGS)).toBe('eceran');
    expect(resolveEffectiveTier('grosir', BASE_SETTINGS)).toBe('grosir');
  });
});

describe('getTierPrice', () => {
  const stock = {
    price: 100,
    price_grosir: 90,
    price_tier_3: 80,
    price_tier_4: null,
  };

  it('returns base price for eceran', () => {
    expect(getTierPrice(stock, 'eceran')).toBe(100);
  });

  it('returns price_grosir when tier=grosir', () => {
    expect(getTierPrice(stock, 'grosir')).toBe(90);
  });

  it('returns price_tier_3 when tier=tier_3', () => {
    expect(getTierPrice(stock, 'tier_3')).toBe(80);
  });

  it('falls back to base price when tier=tier_4 and price_tier_4 is null', () => {
    expect(getTierPrice(stock, 'tier_4')).toBe(100);
  });

  it('falls back to base price when tier=grosir and price_grosir is null', () => {
    const stockNoGrosir = { ...stock, price_grosir: null };
    expect(getTierPrice(stockNoGrosir, 'grosir')).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/pricing/getActiveTiers.test.ts
```
Expected: FAIL — module `./getActiveTiers` doesn't exist yet (`Failed to resolve import "./getActiveTiers"`).

- [ ] **Step 3: Implement the helper**

Create `src/lib/pricing/getActiveTiers.ts` with exactly this content:

```ts
import type { DbTenantSettings } from '../../types';

export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';

export interface Tier {
  key: TierKey;
  label: string;
  slot: 1 | 2 | 3 | 4;
}

/**
 * Single source of truth for "what tiers exist on this tenant, in what order,
 * with what labels". Tier 1 (eceran/base) and tier 2 (grosir) are always active.
 * Tier 3 and Tier 4 are active only when the owner has set a label for them;
 * NULL label = disabled.
 */
export function getActiveTiers(s: DbTenantSettings): Tier[] {
  const tiers: Tier[] = [
    { key: 'eceran', label: s.tier_1_label, slot: 1 },
    { key: 'grosir', label: s.tier_2_label, slot: 2 },
  ];
  if (s.tier_3_label) tiers.push({ key: 'tier_3', label: s.tier_3_label, slot: 3 });
  if (s.tier_4_label) tiers.push({ key: 'tier_4', label: s.tier_4_label, slot: 4 });
  return tiers;
}

/**
 * Orphan-tolerant read-time fallback: if the customer's stored tier is no longer
 * active (owner disabled it), return 'eceran' as the effective tier. Preserves
 * the stored value in DB; the fallback only affects rendering + line-add price
 * selection.
 */
export function resolveEffectiveTier(
  customerTier: TierKey,
  s: DbTenantSettings,
): TierKey {
  const activeKeys = getActiveTiers(s).map(t => t.key);
  return activeKeys.includes(customerTier) ? customerTier : 'eceran';
}

/**
 * Read-time price lookup for a stock item at a given tier. Missing tier price
 * falls back to the base `price` column, mirroring the existing price_grosir
 * fallback used in kasir/quotation RPCs.
 */
export function getTierPrice(
  stock: {
    price: number;
    price_grosir?: number | null;
    price_tier_3?: number | null;
    price_tier_4?: number | null;
  },
  tier: TierKey,
): number {
  switch (tier) {
    case 'grosir': return stock.price_grosir ?? stock.price;
    case 'tier_3': return stock.price_tier_3 ?? stock.price;
    case 'tier_4': return stock.price_tier_4 ?? stock.price;
    default:       return stock.price;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/pricing/getActiveTiers.test.ts
```
Expected: 12/12 tests pass (4 in getActiveTiers, 3 in resolveEffectiveTier, 5 in getTierPrice).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/getActiveTiers.ts src/lib/pricing/getActiveTiers.test.ts
git commit -m "$(cat <<'EOF'
feat(pricing-tier): getActiveTiers helper + tests

Single source of truth for "which tiers exist on this tenant, in what
order, with what labels" (getActiveTiers), orphan-tolerant tier fallback
(resolveEffectiveTier), and read-time COALESCE price lookup (getTierPrice).

Every consumer (pills, quotation auto-sync, StockManager columns,
CartRows warning) reads through this helper — no direct tenant_settings
label reads elsewhere.

12/12 vitest cover 2/3/4-tier configs, tier renames, disabled-tier
customer fallback, null-tier-price base fallback.

Spec: f26b46e §4.2 + §3.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `TierConfigPanel` component + Vitest tests + Pengaturan wiring

**Files:**
- Create: `src/components/pengaturan/TierConfigPanel.tsx`
- Create: `src/components/pengaturan/TierConfigPanel.test.tsx`
- Modify: `src/components/PengaturanScreen.tsx` (or wherever Pengaturan tabs are wired — verify at plan time)

**Interfaces:**
- Consumes: `tenantSettingsService.updateTierConfig(labels)` from Task 2. `DbTenantSettings` and `TierKey` types.
- Produces: `TierConfigPanel` component with props `{ tenantSettings: DbTenantSettings; onSaved: () => void; showToast: (msg: string, type?: 'success'|'info'|'warning') => void; }`. Renders 4 label inputs, save button, cancel/reset. Gated by `modul_multi_tier_price` at the parent level (parent doesn't render this panel when modul is off).

- [ ] **Step 1: Write the failing tests**

Create `src/components/pengaturan/TierConfigPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TierConfigPanel from './TierConfigPanel';
import * as pengaturanServicesModule from '../../lib/pengaturan/pengaturanServices';
import type { DbTenantSettings } from '../../types';

vi.mock('../../lib/pengaturan/pengaturanServices', () => ({
  tenantSettingsService: {
    updateTierConfig: vi.fn(),
  },
}));

const BASE_SETTINGS = {
  modul_multi_tier_price: true,
  tier_1_label: 'Eceran',
  tier_2_label: 'Grosir',
  tier_3_label: null,
  tier_4_label: null,
} as DbTenantSettings;

const BASE_PROPS = {
  tenantSettings: BASE_SETTINGS,
  onSaved: vi.fn(),
  showToast: vi.fn(),
};

describe('TierConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders 4 label inputs preloaded with current values', () => {
    render(<TierConfigPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText(/tier 1/i)).toHaveValue('Eceran');
    expect(screen.getByLabelText(/tier 2/i)).toHaveValue('Grosir');
    expect(screen.getByLabelText(/tier 3/i)).toHaveValue('');
    expect(screen.getByLabelText(/tier 4/i)).toHaveValue('');
  });

  it('saves with tier_3 label filled', async () => {
    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'Distributor Kecil' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(pengaturanServicesModule.tenantSettingsService.updateTierConfig).toHaveBeenCalledWith({
        tier_1_label: 'Eceran',
        tier_2_label: 'Grosir',
        tier_3_label: 'Distributor Kecil',
        tier_4_label: null,
      });
    });
    expect(BASE_PROPS.onSaved).toHaveBeenCalled();
    expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success');
  });

  it('sends NULL when tier_3 field is cleared', async () => {
    const settings = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil' };
    render(<TierConfigPanel {...BASE_PROPS} tenantSettings={settings} />);
    // Field starts filled, clear it
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(pengaturanServicesModule.tenantSettingsService.updateTierConfig).toHaveBeenCalledWith(
        expect.objectContaining({ tier_3_label: null })
      );
    });
  });

  it('surfaces TCFG_LABEL_INVALID as friendly Bahasa toast', async () => {
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('TCFG_LABEL_INVALID'), { code: 'P0400', hint: 'tier_3' })
    );

    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'AB' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/tier 3.*3-30/i),
        'warning'
      );
    });
  });

  it('surfaces TCFG_LABEL_DUPLICATE as friendly toast', async () => {
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('TCFG_LABEL_DUPLICATE'), { code: 'P0409' })
    );

    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'Grosir' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/duplikat/i),
        'warning'
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/components/pengaturan/TierConfigPanel.test.tsx
```
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the panel**

Create `src/components/pengaturan/TierConfigPanel.tsx`:

```tsx
import { useState } from 'react';
import type { DbTenantSettings } from '../../types';
import { tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { captureError, captureBreadcrumb } from '../../lib/captureError';

interface Props {
  tenantSettings: DbTenantSettings;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

/**
 * Owner-only panel to configure the 2-4 pricing tier labels per tenant.
 * Gated at the parent level (only rendered when modul_multi_tier_price = TRUE).
 * Tier 1 and Tier 2 labels are required; Tier 3 and Tier 4 are optional
 * (empty = disabled tier, pills hidden across app).
 */
export default function TierConfigPanel({ tenantSettings, onSaved, showToast }: Props) {
  const [t1, setT1] = useState(tenantSettings.tier_1_label);
  const [t2, setT2] = useState(tenantSettings.tier_2_label);
  const [t3, setT3] = useState(tenantSettings.tier_3_label ?? '');
  const [t4, setT4] = useState(tenantSettings.tier_4_label ?? '');
  const [saving, setSaving] = useState(false);

  // Observability: entry log on mount (once per panel open)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useState(() => {
    captureBreadcrumb({
      category: 'feature',
      message: 'tier_config_panel_open',
    });
    return null;
  });

  function friendlyError(err: unknown): string {
    const raw = extractErrorMessage(err);
    if (raw.includes('TCFG_LABEL_INVALID')) {
      // Extract hint from Postgres error object if present
      const hint = (err as { hint?: string })?.hint ?? '';
      const which = hint === 'tier_1' ? 'Tier 1'
                  : hint === 'tier_2' ? 'Tier 2'
                  : hint === 'tier_3' ? 'Tier 3'
                  : hint === 'tier_4' ? 'Tier 4'
                  : 'Label tier';
      return `${which} harus 3-30 karakter.`;
    }
    if (raw.includes('TCFG_LABEL_DUPLICATE')) {
      return 'Label tier duplikat — semua label harus unik.';
    }
    if (raw.includes('TCFG_FORBIDDEN')) {
      return 'Hanya Owner yang bisa mengubah tingkat harga.';
    }
    return `Gagal simpan tingkat harga: ${raw}`;
  }

  async function onSave() {
    setSaving(true);
    try {
      await tenantSettingsService.updateTierConfig({
        tier_1_label: t1.trim(),
        tier_2_label: t2.trim(),
        tier_3_label: t3.trim() || null,
        tier_4_label: t4.trim() || null,
      });
      // Observability: usage counter
      console.info('[tier_config] updated', {
        tenant_id: tenantSettings.tenant_id,
        tier_count: 2 + (t3.trim() ? 1 : 0) + (t4.trim() ? 1 : 0),
      });
      showToast('Tingkat harga tersimpan.', 'success');
      onSaved();
    } catch (err) {
      captureError(err, { feature: 'tier_config', action: 'update' });
      showToast(friendlyError(err), 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-base font-extrabold text-[#012749]">Tingkat Harga</h2>
        <p className="text-[11px] text-slate-500 mt-1">
          Owner bisa set 2-4 tingkat harga per SKU. Tier 1 & 2 wajib; Tier 3 & 4 opsional (kosongkan = off).
        </p>
      </div>

      <div className="space-y-3 max-w-md">
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 1 (Base) <span className="text-red-500">*</span></span>
          <input
            value={t1}
            onChange={e => setT1(e.target.value)}
            aria-label="Tier 1"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 2 <span className="text-red-500">*</span></span>
          <input
            value={t2}
            onChange={e => setT2(e.target.value)}
            aria-label="Tier 2"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 3 <span className="text-slate-400 font-normal">Opsional</span></span>
          <input
            value={t3}
            onChange={e => setT3(e.target.value)}
            aria-label="Tier 3"
            placeholder="Kosongkan untuk menonaktifkan"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 4 <span className="text-slate-400 font-normal">Opsional</span></span>
          <input
            value={t4}
            onChange={e => setT4(e.target.value)}
            aria-label="Tier 4"
            placeholder="Kosongkan untuk menonaktifkan"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
```

Note on `captureBreadcrumb`: if `src/lib/captureError.ts` does not export `captureBreadcrumb`, replace that call with the closest equivalent (`Sentry.addBreadcrumb`) or a `console.info` breadcrumb log; verify the export at implementation time via `grep 'export' src/lib/captureError.ts | head -5`.

- [ ] **Step 4: Wire panel into `PengaturanScreen`**

Grep for how the Pengaturan screen renders panels today:
```bash
grep -n 'ModulSwitchesPanel\|KasirExpenseCategoriesPanel\|isFieldVisible' src/components/PengaturanScreen.tsx 2>/dev/null | head -10
```

If `PengaturanScreen.tsx` doesn't exist under that exact name, run:
```bash
grep -rln 'ModulSwitchesPanel' src/components/ 2>/dev/null | head -3
```

Locate the file that renders the existing panels, and add TierConfigPanel gated by `modul_multi_tier_price`:

```tsx
import TierConfigPanel from './pengaturan/TierConfigPanel';

// ... in the panel-list render:
{tenantSettings?.modul_multi_tier_price && (
  <TierConfigPanel
    tenantSettings={tenantSettings}
    onSaved={() => refreshTenantSettings()}
    showToast={showToast}
  />
)}
```

Match the surrounding pattern for panel rendering (some Pengaturan implementations use a tab list; others a stacked layout). Preserve the existing layout choice.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run src/components/pengaturan/TierConfigPanel.test.tsx
```
Expected: 5/5 tests pass.

- [ ] **Step 6: Type-check + full suite**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: no type errors; full suite green (including PelangganScreen 11/11).

- [ ] **Step 7: Commit**

```bash
git add src/components/pengaturan/TierConfigPanel.tsx src/components/pengaturan/TierConfigPanel.test.tsx src/components/PengaturanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(pengaturan): TierConfigPanel — owner sets 2-4 pricing tier labels

New Pengaturan panel gated by modul_multi_tier_price. 4 label inputs
(Tier 1/2 required, Tier 3/4 optional = disabled when empty). Saves
via update_tenant_tier_config SECDEF RPC; maps TCFG_* errcodes to
Bahasa toasts (LABEL_INVALID with hint→tier_N reference, DUPLICATE,
FORBIDDEN). Observability: breadcrumb on open + console.info usage
log + captureError on failure.

5/5 vitest cover render, save, clear-to-NULL, invalid-length reject
UI, duplicate reject UI.

Spec: f26b46e §4.1 + §7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migration slot `000543` — widen `record_kasir_sale` + `create_tempo_invoice` for 4-key tiers + JSONB label snapshot

**Files:**
- Create: `supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql`

**Interfaces:**
- Consumes: schema from Task 1 (`stocks.price_tier_3`, `stocks.price_tier_4`, `tenant_settings.tier_N_label`, widened `customers` CHECK).
- Produces: `record_kasir_sale` and `create_tempo_invoice` accept `pricing_tier_used ∈ {eceran, grosir, tier_3, tier_4}`, price COALESCE cascade extends to `price_tier_3`/`price_tier_4`, each item JSONB gets `pricing_tier_label` stamped at write time.

- [ ] **Step 1: Grep sweep for any OTHER RPC that reads `pricing_tier_used`**

Per spec §11 `[ASSUMED]`: verify no third RPC needs widening.

```bash
grep -rln "pricing_tier_used" supabase/migrations/ 2>/dev/null | sort | tail -10
```
Expected: only `record_kasir_sale` and `create_tempo_invoice` variants + comment-only references. If a third distinct RPC exists that VALIDATES or COALESCE-based on `pricing_tier_used`, add its widening to this migration file too.

- [ ] **Step 2: Extract authoritative RPC bodies from slot `000325`**

```bash
grep -n 'CREATE OR REPLACE FUNCTION public.record_kasir_sale\|CREATE OR REPLACE FUNCTION public.create_tempo_invoice' supabase/migrations/20261115000325_audit_kasir_and_pembelian.sql
```
Expected: line 21 for `record_kasir_sale`, line 432 for `create_tempo_invoice`.

Read both bodies fully so you can produce the widened versions in Step 3. The widening pattern is:
1. Replace `IF v_tier_used NOT IN ('eceran', 'grosir') THEN RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used; END IF;` with `IF v_tier_used NOT IN ('eceran', 'grosir', 'tier_3', 'tier_4') THEN RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used; END IF;`
2. Replace `SELECT CASE WHEN v_tier_used = 'grosir' THEN COALESCE(s.price_grosir, s.price) ELSE s.price END, s.price INTO v_expected_price, v_master_price FROM ...` with:
   ```plpgsql
   SELECT
     CASE v_tier_used
       WHEN 'grosir' THEN COALESCE(s.price_grosir, s.price)
       WHEN 'tier_3' THEN COALESCE(s.price_tier_3, s.price)
       WHEN 'tier_4' THEN COALESCE(s.price_tier_4, s.price)
       ELSE s.price
     END,
     s.price
   INTO v_expected_price, v_master_price
   FROM stocks s WHERE s.sku = v_item->>'sku' AND s.tenant_id = ...;
   ```
3. Before appending `v_item` into items JSONB for INSERT, look up the current tenant tier labels and add a `pricing_tier_label` key inside `v_item`:
   ```plpgsql
   -- Fetch labels once per RPC call (cache in v_settings)
   SELECT tier_1_label, tier_2_label, tier_3_label, tier_4_label
     INTO v_tier_1_label, v_tier_2_label, v_tier_3_label, v_tier_4_label
     FROM tenant_settings WHERE tenant_id = v_tenant_id;
   -- Inside the per-item loop, after v_tier_used is resolved:
   v_tier_label := CASE v_tier_used
     WHEN 'eceran' THEN v_tier_1_label
     WHEN 'grosir' THEN v_tier_2_label
     WHEN 'tier_3' THEN v_tier_3_label
     WHEN 'tier_4' THEN v_tier_4_label
   END;
   v_item := v_item || jsonb_build_object('pricing_tier_label', v_tier_label);
   ```

- [ ] **Step 3: Write the migration file**

Create `supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql`. The file will contain TWO `CREATE OR REPLACE FUNCTION` blocks — one for `record_kasir_sale`, one for `create_tempo_invoice`. Each is the FULL body from slot `000325` with the 3 widening changes applied.

Use this exact scaffold, filling in the RPC-specific portions from slot `000325`:

```sql
-- 20261115000543_widen_sales_rpcs_for_tier_config.sql
-- Phase 1b Task 5 — Widen record_kasir_sale + create_tempo_invoice for
-- 4-key INVALID_TIER validation + tier_3/tier_4 price COALESCE cascade
-- + pricing_tier_label snapshot into items JSONB.
--
-- Authoritative predecessor bodies both live in slot 20261115000325.
-- Idempotent: CREATE OR REPLACE FUNCTION is safe to re-run.
--
-- Rollback: restore the exact CREATE OR REPLACE FUNCTION bodies from
-- 20261115000325_audit_kasir_and_pembelian.sql lines 21 (record_kasir_sale)
-- and 432 (create_tempo_invoice).

-- ─── record_kasir_sale (widened) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  -- ... FULL parameter list from slot 000325 line 21
) RETURNS -- ... FULL return type
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- ... FULL declaration list from slot 000325, plus:
  v_tier_1_label TEXT;
  v_tier_2_label TEXT;
  v_tier_3_label TEXT;
  v_tier_4_label TEXT;
  v_tier_label   TEXT;
BEGIN
  -- ... FULL body from slot 000325, with these 3 changes:
  -- CHANGE 1: SELECT tier labels once, near where modul_multi_tier_price is fetched:
  SELECT tier_1_label, tier_2_label, tier_3_label, tier_4_label
    INTO v_tier_1_label, v_tier_2_label, v_tier_3_label, v_tier_4_label
    FROM tenant_settings WHERE tenant_id = v_tenant_id;

  -- CHANGE 2: replace the INVALID_TIER check (was 2-key, now 4-key):
  IF v_tier_modul_on AND v_tier_used IS NOT NULL THEN
    IF v_tier_used NOT IN ('eceran', 'grosir', 'tier_3', 'tier_4') THEN
      RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
    END IF;
  END IF;

  -- CHANGE 3: extend the tier-price CASE to include tier_3, tier_4:
  SELECT
    CASE v_tier_used
      WHEN 'grosir' THEN COALESCE(s.price_grosir, s.price)
      WHEN 'tier_3' THEN COALESCE(s.price_tier_3, s.price)
      WHEN 'tier_4' THEN COALESCE(s.price_tier_4, s.price)
      ELSE s.price
    END,
    s.price
    INTO v_expected_price, v_master_price
    FROM stocks s
    WHERE s.sku = v_item->>'sku' AND s.tenant_id = v_tenant_id;

  -- CHANGE 4 (new): stamp pricing_tier_label snapshot into v_item BEFORE
  -- the existing INSERT into orders/sales_orders (place immediately after
  -- the existing `v_item := v_item || jsonb_build_object('pricing_tier_used', ...)`):
  v_tier_label := CASE v_tier_used
    WHEN 'eceran' THEN v_tier_1_label
    WHEN 'grosir' THEN v_tier_2_label
    WHEN 'tier_3' THEN v_tier_3_label
    WHEN 'tier_4' THEN v_tier_4_label
  END;
  IF v_tier_label IS NOT NULL THEN
    v_item := v_item || jsonb_build_object('pricing_tier_label', v_tier_label);
  END IF;

  -- ... rest of body unchanged from slot 000325
END $$;

-- ─── create_tempo_invoice (widened) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS -- ... FULL return type from slot 000325 line 432
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- ... FULL declaration list from slot 000325, plus same 5 extra vars as above
  v_tier_1_label TEXT;
  v_tier_2_label TEXT;
  v_tier_3_label TEXT;
  v_tier_4_label TEXT;
  v_tier_label   TEXT;
BEGIN
  -- Same 4 changes as record_kasir_sale, applied in the tempo-invoice body
END $$;
```

The scaffold above is not enough — you MUST copy the ACTUAL predecessor bodies from slot `000325` and apply the changes. The bodies are ~250 lines each. Prompt: read slot `000325` fully via `Read` tool, extract each RPC body verbatim, apply the 4 changes marked above, and place the widened bodies into slot `000543`.

- [ ] **Step 4: Apply migration to staging DB via Management API**

```bash
source .env
MIGRATION_SQL=$(cat supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql | jq -Rs .)
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $MIGRATION_SQL}" | jq
```
Expected: `[]`. No error field.

- [ ] **Step 5: Smoke `record_kasir_sale` widened path via RAISE-rollback**

Prep: set an owner UID, ensure at least one SKU has `price_tier_3` set for testing (use Management API to set one temporarily, or just verify with existing SKU that has `price_grosir`).

Happy-path smoke (fake auth → set price_tier_3 → record kasir sale → assert `pricing_tier_label` snapshot in items JSONB → RAISE to rollback):

```bash
source .env
OWNER_UID="<paste-owner-uid-here>"
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg uid "$OWNER_UID" '{query: "DO $do$ DECLARE v_result jsonb; BEGIN PERFORM set_config('\''request.jwt.claim.sub'\'', '\''\($uid)'\'', true); UPDATE tenant_settings SET tier_3_label='\''Distributor Kecil'\'' WHERE tenant_id='\''22222222-2222-2222-2222-222222222222'\''; UPDATE stocks SET price_tier_3 = 500 WHERE sku='\''TJM-EL-002'\'' AND tenant_id='\''22222222-2222-2222-2222-222222222222'\''; SELECT public.record_kasir_sale('\''{\"channel\":\"walkin\",\"items\":[{\"sku\":\"TJM-EL-002\",\"qty\":1,\"unit_price\":500,\"pricing_tier_used\":\"tier_3\"}],\"payment_method\":\"cash\"}'\''::jsonb) INTO v_result; RAISE EXCEPTION '\''SMOKE_OK %'\'', v_result; END $do$;"}')"
```
Expected: response contains `SMOKE_OK` plus the returned result. If instead you get `INVALID_TIER: tier_3` — the widening didn't apply; check the migration output.

Note: adjust the JSON payload for `record_kasir_sale` to match its actual parameter schema (may differ — see slot 000325 declaration for the exact parameter names).

- [ ] **Step 6: Grep for the label in the returned JSON**

The smoke's returned `v_result` should contain `pricing_tier_label` inside the items — visually verify from Step 5's output that the label `Distributor Kecil` is stamped into the item.

- [ ] **Step 7: Run local audits**

```bash
npm run audit:secdef-null-tenant
npm run audit:no-string-err-fallback
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000543_widen_sales_rpcs_for_tier_config.sql
git commit -m "$(cat <<'EOF'
feat(pricing-tier): migration 000543 — widen sales RPCs for 4 tiers

Widens record_kasir_sale + create_tempo_invoice (both authoritative
bodies in slot 000325) for:
  - INVALID_TIER validation now accepts tier_3, tier_4
  - Price CASE extends to price_tier_3 / price_tier_4 with COALESCE
    to base price (mirrors existing price_grosir fallback)
  - pricing_tier_label stamped into each item JSONB at write time —
    snapshot semantics for financial-audit immutability; historic
    items without the key fall back to current tenant label at read

Idempotent CREATE OR REPLACE FUNCTION. Smoke via Management API +
RAISE EXCEPTION rollback confirmed tier_3 accepted + label stamped.

Spec: f26b46e §3.4 + §3.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Generalize pill sites (5 files) + parametrized tests

**Files:**
- Modify: `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`
- Modify: `src/components/PelangganScreen.tsx`
- Modify: `src/components/penjualan/CatatPenjualanWizard.tsx`
- Modify: `src/components/penjualan/CartRows.tsx`
- Modify: `src/components/PelangganScreen.test.tsx`

**Interfaces:**
- Consumes: `getActiveTiers`, `resolveEffectiveTier`, `getTierPrice`, `TierKey` from Task 3.
- Produces: all pill sites now render N pills based on tenant config (2-4); tier filter chips generalized; auto-sync uses orphan-tolerant fallback; CartRows warning fires for any non-base tier without explicit price.

- [ ] **Step 1: Widen `NewCustomerInlineForm` pill row**

In `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`:

1. Import `getActiveTiers`, `TierKey` from `../../../lib/pricing/getActiveTiers`.
2. Add a `tenantSettings?: DbTenantSettings` prop (or accept a `tiers: Tier[]` prop pre-computed by parent — pick whichever fits the existing prop-chain pattern from Phase 1a; both parents that render this form already fetch tenantSettings elsewhere).
3. Replace `const [tier, setTier] = useState<'eceran' | 'grosir'>('eceran');` with `const [tier, setTier] = useState<TierKey>('eceran');`.
4. Replace the hardcoded 2-pill map with:

```tsx
{showTierField && tenantSettings && (
  <div className="mt-3 pt-3 border-t border-[#012749]/20">
    <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Tipe Harga default</label>
    <div className="flex gap-1.5 flex-wrap">
      {getActiveTiers(tenantSettings).map((t) => {
        const active = tier === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => setTier(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              active
                ? t.slot === 1
                  ? 'bg-[#012749] text-white'
                  : 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
    <p className="text-[11px] text-slate-500 mt-1 italic">Otomatis dipakai saat customer ini transaksi; kasir bebas switch per pesanan.</p>
  </div>
)}
```

- [ ] **Step 2: Wire `tenantSettings` prop into both parents that render `NewCustomerInlineForm`**

Locate the two render sites:
```bash
grep -n 'NewCustomerInlineForm' src/components/PelangganScreen.tsx src/components/penjualan/wizard/Step1ChannelCustomer.tsx
```

For each render site, pass the local `tenantSettings` state:

```tsx
<NewCustomerInlineForm
  // ... existing props including showTierField
  tenantSettings={tenantSettings}
  // ...
/>
```

For `Step1ChannelCustomer.tsx`, the parent `CatatPenjualanWizard.tsx` needs to pass `tenantSettings` down through Step1's props chain — mirror the existing `showTierField` prop chain pattern from Phase 1a Task 3.

- [ ] **Step 3: Widen `PelangganScreen` edit-header pills and filter chips**

In `src/components/PelangganScreen.tsx`:

1. Import `getActiveTiers`, `resolveEffectiveTier`, `TierKey` from `../lib/pricing/getActiveTiers`.
2. Replace `const [editTier, setEditTier] = useState<'eceran' | 'grosir'>('eceran');` with `const [editTier, setEditTier] = useState<TierKey>('eceran');`.
3. Replace `const [tierFilter, setTierFilter] = useState<'all' | 'eceran' | 'grosir'>('all');` with `const [tierFilter, setTierFilter] = useState<'all' | TierKey>('all');`.

4. Replace the edit-mode pill map (currently 2 pills) with:

```tsx
{showTierDropdown && tenantSettings && (
  <div>
    <label className="text-[11px] font-bold text-white/60">Tier Harga Default</label>
    <div className="flex gap-1.5 mt-0.5 flex-wrap">
      {getActiveTiers(tenantSettings).map((t) => {
        const active = editTier === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => setEditTier(t.key)}
            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
              active
                ? t.slot === 1
                  ? 'bg-white text-[#012749]'
                  : 'bg-purple-500 text-white'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
    <p className="text-[10px] text-white/40 mt-1">Otomatis dipakai saat customer ini transaksi; kasir bebas switch.</p>
  </div>
)}
```

5. Replace the left-panel filter chips (currently 3 fixed: Semua/Eceran/Grosir) with:

```tsx
{showTierDropdown && tenantSettings && (
  <div className="flex gap-1 flex-wrap">
    {(['all', ...getActiveTiers(tenantSettings).map(t => t.key)] as const).map(t => {
      const label = t === 'all' ? 'Semua' : getActiveTiers(tenantSettings).find(x => x.key === t)!.label;
      const isBase = t === 'all' || t === 'eceran';
      return (
        <button
          key={t}
          onClick={() => setTierFilter(t)}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
            tierFilter === t
              ? isBase
                ? 'bg-[#012749] text-white'
                : 'bg-purple-600 text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      );
    })}
  </div>
)}
```

6. Replace the per-customer tier badge in list rows (currently shows Eceran/Grosir hardcoded) with a lookup:

Find the block near lines 296-304 that renders the small pill badge:
```tsx
{showTierDropdown && (
  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
    (c.default_pricing_tier ?? 'eceran') === 'grosir' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
  }`}>
    {(c.default_pricing_tier ?? 'eceran') === 'grosir' ? 'Grosir' : 'Eceran'}
  </span>
)}
```

Replace with:
```tsx
{showTierDropdown && tenantSettings && (() => {
  const effTier = resolveEffectiveTier(c.default_pricing_tier ?? 'eceran', tenantSettings);
  const tierInfo = getActiveTiers(tenantSettings).find(t => t.key === effTier)!;
  const isBase = tierInfo.slot === 1;
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
      isBase ? 'bg-gray-100 text-gray-500' : 'bg-purple-100 text-purple-700'
    }`}>
      {tierInfo.label}
    </span>
  );
})()}
```

- [ ] **Step 4: Widen `CatatPenjualanWizard` active tier**

In `src/components/penjualan/CatatPenjualanWizard.tsx`:

1. Import `getActiveTiers`, `resolveEffectiveTier`, `getTierPrice`, `TierKey` from `../../lib/pricing/getActiveTiers`.
2. Replace `const [activeTier, setActiveTier] = useState<'eceran' | 'grosir'>('eceran');` with `const [activeTier, setActiveTier] = useState<TierKey>('eceran');`.
3. Update auto-sync effect (`useEffect` at line ~143 per Phase 1a discovery) to use `resolveEffectiveTier`:

```tsx
useEffect(() => {
  if (!showTierPill || !tenantSettings) return;
  const customerTier = customer?.default_pricing_tier ?? 'eceran';
  const effectiveTier = resolveEffectiveTier(customerTier, tenantSettings);
  if (effectiveTier !== activeTier) setActiveTier(effectiveTier);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [customer?.id, showTierPill, tenantSettings]);
```

4. Update cart re-price effect (line ~157) to use `getTierPrice`:

```tsx
useEffect(() => {
  if (!showTierPill) return;
  setCart((prev) => prev.map((line) => {
    if (!line.sku) return line;
    const product = stocks.find((s) => s.sku === line.sku);
    if (!product) return line;
    const newPrice = getTierPrice(product, activeTier);
    // When activeTier has no explicit price, fall back was applied by getTierPrice;
    // in that case, semantically the line's tier is base ('eceran')
    const lineTier: TierKey = (newPrice === product.price && activeTier !== 'eceran') ? 'eceran' : activeTier;
    if (newPrice === line.unit_price && lineTier === (line.pricing_tier_used ?? 'eceran')) return line;
    return {
      ...line,
      unit_price: newPrice,
      master_price_at_sale: newPrice,
      pricing_tier_used: lineTier,
      subtotal: newPrice * line.qty,
      hpp_subtotal: line.hpp_per_unit * line.qty,
      discount_type: null,
      discount_value: null,
      discount_amount_rp: 0,
    };
  }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTier, showTierPill]);
```

5. Replace the hardcoded 2-pill tier toggle UI (find via grep in the file) with `getActiveTiers`-driven map (same pattern as Step 1).

- [ ] **Step 5: Widen `CartRows` warning**

In `src/components/penjualan/CartRows.tsx`:

1. Import `getTierPrice`, `TierKey` from `../../lib/pricing/getActiveTiers`.
2. Widen the `activeTier` prop type: `activeTier: 'eceran' | 'grosir'` → `activeTier: TierKey`.
3. Replace the warning check at line 176:

```tsx
{showTierPill && activeTier === 'grosir' && stock && stock.price_grosir == null && (
  /* warning JSX */
)}
```

with:

```tsx
{showTierPill && activeTier !== 'eceran' && stock && (() => {
  const tierPrice = getTierPrice(stock, activeTier);
  const hasExplicit = tierPrice !== stock.price;
  return !hasExplicit ? (
    /* same warning JSX, but message can stay generic: "harga tier belum di-set, pakai harga base" */
  ) : null;
})()}
```

Or, if the warning message references "grosir" explicitly, generalize:

```tsx
{/* Harga tier X belum di-set, pakai harga base */}
```

(Replace X with the current tenant tier label at render time via `getActiveTiers(tenantSettings).find(t => t.key === activeTier)?.label` if `tenantSettings` is in scope; if not, use a generic message like "Harga tier ini belum di-set — pakai harga base.")

- [ ] **Step 6: Parametrize existing `PelangganScreen.test.tsx` tier tests**

Update `src/components/PelangganScreen.test.tsx`:

For the tests in the `'PelangganScreen — tier dropdown'` describe block and the `'PelangganScreen — tier pills on Tambah Pelanggan (modul ON)'` block, add a new test that verifies 3-tier and 4-tier rendering. Add a new fixture:

```tsx
const BASE_SETTINGS_3TIER = {
  ...BASE_SETTINGS,
  modul_multi_tier_price: true,
  tier_1_label: 'Eceran',
  tier_2_label: 'Grosir',
  tier_3_label: 'Distributor Kecil',
  tier_4_label: null,
};

// Inside describe('PelangganScreen — tier pills on Tambah Pelanggan (modul ON)'):
it('renders 3 pills when tier_3_label is set', async () => {
  (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_SETTINGS_3TIER);
  render(<PelangganScreen {...BASE_PROPS} />);
  await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));

  const formEl = await screen.findByTestId('new-customer-form');
  const scope = within(formEl);
  expect(scope.getByRole('button', { name: 'Eceran' })).toBeInTheDocument();
  expect(scope.getByRole('button', { name: 'Grosir' })).toBeInTheDocument();
  expect(scope.getByRole('button', { name: 'Distributor Kecil' })).toBeInTheDocument();
  expect(scope.queryByRole('button', { name: /tier 4/i })).not.toBeInTheDocument();
});
```

Add fields `tier_1_label`, `tier_2_label`, `tier_3_label`, `tier_4_label` to `BASE_SETTINGS` fixture at line 47-77 with values `'Eceran'`, `'Grosir'`, `null`, `null`. This keeps existing 11 tests passing.

- [ ] **Step 7: Run all touched-file tests**

```bash
npx vitest run src/components/PelangganScreen.test.tsx src/components/pengaturan/TierConfigPanel.test.tsx src/lib/pricing/getActiveTiers.test.ts
```
Expected: PelangganScreen 12+/12+ pass (11 existing + at least 1 new 3-tier), TierConfigPanel 5/5 pass, getActiveTiers 12/12 pass.

- [ ] **Step 8: Type-check + full suite**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: no type errors; full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/components/penjualan/wizard/NewCustomerInlineForm.tsx src/components/PelangganScreen.tsx src/components/penjualan/CatatPenjualanWizard.tsx src/components/penjualan/CartRows.tsx src/components/PelangganScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(pricing-tier): generalize pill sites to 2-4 tiers via getActiveTiers

All pill sites now read the active tier list from tenant_settings via
getActiveTiers helper:
  - NewCustomerInlineForm (add-customer pills)
  - PelangganScreen (edit-header pills + left-panel filter chips + list badge)
  - CatatPenjualanWizard (active tier toggle + auto-sync + cart re-price)
  - CartRows (any-non-base fallback warning via getTierPrice)

Auto-sync uses resolveEffectiveTier so customers tagged with a disabled
tier silently fall back to eceran at read time (orphan-tolerant).

PelangganScreen.test.tsx parametrized: existing 11 tests pass with
default 2-tier BASE_SETTINGS; new test asserts 3 pills when
tier_3_label is set.

Spec: f26b46e §4.2-4.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Generalize product entry (3 files) + cascadeMap FieldKey rename

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`
- Modify: `src/components/produk/StockTableView.tsx`
- Rename: `src/components/produk/BulkUpdateGrosirSection.tsx` → `src/components/produk/BulkUpdateTierPricesSection.tsx`
- Rename: `src/components/produk/BulkUpdateGrosirSection.test.tsx` → `src/components/produk/BulkUpdateTierPricesSection.test.tsx`
- Modify: `src/components/StockManagerScreen.tsx` (update import to renamed file)
- Modify: `src/lib/pengaturan/cascadeMap.ts` (FieldKey rename + cascade widening)

**Interfaces:**
- Consumes: `getActiveTiers`, `TierKey` from Task 3.
- Produces: ProductForm and StockTableView show 2/3/4 tier price columns based on tenant config. Bulk CSV widens columns to include tier_3/tier_4. FieldKey `csv_bulk_grosir_button` renamed to `csv_bulk_tier_prices_button`.

- [ ] **Step 1: Rename BulkUpdateGrosirSection files**

```bash
git mv src/components/produk/BulkUpdateGrosirSection.tsx src/components/produk/BulkUpdateTierPricesSection.tsx
git mv src/components/produk/BulkUpdateGrosirSection.test.tsx src/components/produk/BulkUpdateTierPricesSection.test.tsx
```

- [ ] **Step 2: Update `src/components/StockManagerScreen.tsx` import**

```bash
grep -n 'BulkUpdateGrosirSection' src/components/StockManagerScreen.tsx
```
Expected: 1-2 occurrences (import + JSX). Edit the file to replace `BulkUpdateGrosirSection` with `BulkUpdateTierPricesSection` in the import path and JSX usage.

- [ ] **Step 3: Widen the renamed component to accept N-tier CSV columns**

Modify `src/components/produk/BulkUpdateTierPricesSection.tsx`:

1. Import `getActiveTiers`, `Tier`, `TierKey` from `../../lib/pricing/getActiveTiers`.
2. Widen the row type:

```ts
interface Row {
  sku: string;
  nama: string;
  price_eceran: number | null;
  // Instead of hardcoded price_grosir_lama/baru, use per-tier maps:
  tier_lama: Partial<Record<TierKey, number | null>>;
  tier_baru: Partial<Record<TierKey, number | null>>;
  status: string;
}
```

3. Widen the CSV header from:
```ts
const header = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru';
```
to:
```ts
function buildHeader(tiers: Tier[]): string {
  const nonBase = tiers.filter(t => t.slot > 1);
  return ['sku', 'nama', 'price_eceran',
    ...nonBase.flatMap(t => [`price_${t.key}_lama`, `price_${t.key}_baru`])
  ].join(',');
}
```

4. Widen the export row builder similarly.
5. Widen the parser to handle missing columns (backward compat with old templates): if `price_grosir_lama` column exists but not `price_tier_3_lama`, treat missing as "skip this tier for this row."
6. Widen the `UPDATE stocks SET ...` SQL RPC or client call to include tier_3, tier_4 columns. (Verify the current write path — direct client update or RPC — via grep in the file.)

- [ ] **Step 4: Update the renamed component's tests**

Modify `src/components/produk/BulkUpdateTierPricesSection.test.tsx`:

1. Update import path from `./BulkUpdateGrosirSection` to `./BulkUpdateTierPricesSection`.
2. Add a fixture with 3-tier settings (tier_3_label set).
3. Add a test: with 3-tier settings, CSV header contains `price_tier_3_lama,price_tier_3_baru`.
4. Add a test: parser tolerates old CSV without tier_3 columns (backward compat).
5. Existing tests should still pass (just with updated component name).

- [ ] **Step 5: Widen `ProductForm.tsx`**

Modify `src/components/produk/ProductForm.tsx`:

1. Import `getActiveTiers` from `../../lib/pricing/getActiveTiers`.
2. Add state for tier_3 and tier_4 prices:

```ts
const [priceTier3, setPriceTier3] = useState<number | null>(initial?.price_tier_3 ?? null);
const [priceTier4, setPriceTier4] = useState<number | null>(initial?.price_tier_4 ?? null);
```

3. Below the existing `priceGrosir` NumberInput, add conditional inputs:

```tsx
{tenantSettings && getActiveTiers(tenantSettings).map(t => {
  if (t.slot === 1 || t.slot === 2) return null; // handled by existing price + priceGrosir fields
  const value = t.slot === 3 ? priceTier3 : priceTier4;
  const onChange = t.slot === 3 ? setPriceTier3 : setPriceTier4;
  return (
    <div key={t.key} className="mb-3">
      <label className="block text-xs font-bold text-slate-700 mb-1">Harga {t.label}</label>
      <NumberInput
        value={value}
        onChange={onChange}
        placeholder="Kosongkan untuk pakai harga base"
      />
    </div>
  );
})}
```

4. Include `price_tier_3`, `price_tier_4` in the payload sent to the save handler.

- [ ] **Step 6: Widen `StockTableView.tsx`**

Modify `src/components/produk/StockTableView.tsx`:

1. Import `getActiveTiers`, `TierKey` from `../../lib/pricing/getActiveTiers`.
2. Widen `editValues` shape to include tier_3, tier_4 prices.
3. Add conditional table columns after the existing `price_grosir` column:

```tsx
{tenantSettings && getActiveTiers(tenantSettings).filter(t => t.slot >= 3).map(t => (
  <th key={t.key} className="...">Harga {t.label}</th>
))}
```

4. Add corresponding `<td>` cells with the same inline-edit NumberInput pattern used for `price_grosir` (see the file's existing code at lines 355 and 480).

5. Update the row-save handler to include tier_3, tier_4 in the update payload.

- [ ] **Step 7: Rename `csv_bulk_grosir_button` FieldKey + widen cascade impact**

Modify `src/lib/pengaturan/cascadeMap.ts`:

1. In the `FieldKey` union type, rename `'csv_bulk_grosir_button'` → `'csv_bulk_tier_prices_button'`.
2. In `isFieldVisible`, rename the case: `case 'csv_bulk_grosir_button':` → `case 'csv_bulk_tier_prices_button':` (still returns `settings.modul_multi_tier_price`).
3. In `cascadeImpactSummary` for `modul_multi_tier_price`, update the query semantics documented in the comment. The actual query lives elsewhere (grep for `tierEnabledCustomerCount` computation); update it to count `default_pricing_tier != 'eceran'` instead of `= 'grosir'`. If the query lives outside `cascadeMap.ts` (e.g., in a dashboard/settings service), update there too — grep to locate.

- [ ] **Step 8: Update every consumer of the renamed FieldKey**

```bash
grep -rn "csv_bulk_grosir_button" src/ 2>/dev/null
```
Expected: previously in `cascadeMap.ts` + one consumer in `BulkUpdateTierPricesSection.tsx` (was `BulkUpdateGrosirSection`). Update each occurrence.

- [ ] **Step 9: Type-check + tests**

```bash
npx tsc --noEmit
npx vitest run src/components/produk/ src/lib/pengaturan/cascadeMap.test.ts 2>&1 | tail -30
```
Expected: no type errors; produk tests green; cascadeMap tests (if any exist) green.

- [ ] **Step 10: Full suite**

```bash
npx vitest run
```
Expected: full suite green including all Phase 1a tests.

- [ ] **Step 11: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/components/produk/StockTableView.tsx src/components/produk/BulkUpdateTierPricesSection.tsx src/components/produk/BulkUpdateTierPricesSection.test.tsx src/components/StockManagerScreen.tsx src/lib/pengaturan/cascadeMap.ts
git commit -m "$(cat <<'EOF'
feat(pricing-tier): generalize product entry to 2-4 tiers

ProductForm: 2 optional NumberInputs for price_tier_3/4, rendered
only when tier is active in tenant_settings.

StockTableView: 2 conditional table columns with inline-edit for
tier_3/4 prices, same pattern as existing price_grosir column.

BulkUpdateGrosirSection renamed → BulkUpdateTierPricesSection. CSV
header widens to include price_tier_3_lama/baru + price_tier_4_lama/baru.
Parser tolerates old CSV templates (backward compat).

cascadeMap FieldKey csv_bulk_grosir_button → csv_bulk_tier_prices_button.
cascadeImpactSummary counts customers with any non-eceran tier
(previously only grosir).

Spec: f26b46e §4.4 + §4.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Audit script update + `Step1ChannelCustomer` verification

**Files:**
- Modify: `scripts/audit-misclassified-customer-tier.sql`
- Verify only: `src/components/penjualan/wizard/Step1ChannelCustomer.tsx`

**Interfaces:** SQL-only + verification. No new code.

- [ ] **Step 1: Verify `Step1ChannelCustomer.tsx` needs no changes**

```bash
git diff HEAD -- src/components/penjualan/wizard/Step1ChannelCustomer.tsx 2>&1 | head -20
grep -n 'showTierField\|NewCustomerInlineForm\|tenantSettings' src/components/penjualan/wizard/Step1ChannelCustomer.tsx
```

Expected: after Task 6, `Step1ChannelCustomer.tsx` may have been touched to forward the new `tenantSettings` prop. Verify it does exactly that and nothing else. If untouched by Task 6, add the prop forwarding here.

- [ ] **Step 2: Widen `audit-misclassified-customer-tier.sql`**

Open `scripts/audit-misclassified-customer-tier.sql`. The current WHERE clause is:

```sql
WHERE tenant_id = $1
  AND default_pricing_tier = 'eceran'
  AND (
    (company IS NOT NULL AND company <> '')
    OR allows_tempo = TRUE
  )
```

The intent under Phase 1b is broader: surface customers whose stored tier may be misclassified. Widen the query header comment to reflect N-tier context, but the WHERE-clause target stays `= 'eceran'` (the "silently defaulted" case). The change is documentation and one added column output for tier verification:

Replace the SELECT columns to include `default_pricing_tier`:

```sql
SELECT
  id,
  name,
  company,
  wa_number,
  allows_tempo,
  default_pricing_tier,
  created_at
FROM public.customers
WHERE tenant_id = $1
  AND default_pricing_tier = 'eceran'
  AND (
    (company IS NOT NULL AND company <> '')
    OR allows_tempo = TRUE
  )
ORDER BY created_at DESC;
```

Update the top-of-file comment to explain: "Post-Phase-1b, the tier column shows the current stored value; owner reviews and updates via the Pelanggan edit modal (which now offers 2-4 tier options based on tenant_settings.tier_N_label config)."

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-misclassified-customer-tier.sql
git commit -m "$(cat <<'EOF'
chore(scripts): audit-misclassified-customer-tier — surface stored tier

Adds default_pricing_tier column to output. Post-Phase-1b, tenant
tier set can be 2-4; owner reviews via Pelanggan edit modal which
now offers the full active tier set.

WHERE clause unchanged (still targets tier='eceran' + wholesale
signals like company/tempo) — this is the "silently defaulted"
class the audit was built to surface.

Spec: f26b46e §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Stage 1 gates + Stage 3 smoke on Toko Jaya Makmur (founder-driven)

**Files:** none new; verification only.

**Interfaces:** none.

This task is `superpowers:verification-before-completion` applied to the whole Phase 1b diff. Every gate must be green before considering Phase 1b done. If any gate fails, back out to the failing task and fix at root.

- [ ] **Step 1: Stage 1 — lint clean**

```bash
npm run lint
```
Expected: exit 0, no errors, no new warnings on touched files.

- [ ] **Step 2: Stage 1 — all audits**

```bash
npm run audit:numinput
npm run audit:secdef-null-tenant
npm run audit:csp-backend-allowlist
npm run audit:no-string-err-fallback
npm run audit:secdef-auth-uid-vosi-owner 2>&1 | tail -10 || echo "audit does not exist yet"
```
Expected: all clean.

- [ ] **Step 3: Stage 1 — full vitest**

```bash
npx vitest run
```
Expected: full suite green (>1000 tests, whatever the current count is). Includes new Task 3 (getActiveTiers 12/12), Task 4 (TierConfigPanel 5/5), updated Task 6 (PelangganScreen 12+/12+).

- [ ] **Step 4: Stage 2 — deploy to staging via git push**

```bash
git push origin main
```

Cloud Build auto-triggers on push. Monitor:

```bash
gcloud builds list --limit=3 --format='table(id,status,duration)'
```

Wait for both FE + BE builds to reach `SUCCESS`. If either fails, investigate build log and fix before Stage 3.

- [ ] **Step 5: Stage 2 — manual promote to prod**

Once staging builds are SUCCESS:

```bash
SHORT_SHA=$(git rev-parse --short=7 HEAD)
bash scripts/promote-to-prod.sh $SHORT_SHA
```

Wait for both FE + BE to serve the new tag. Verify:

```bash
curl -sS -o /dev/null -w "app.caleo.id: HTTP %{http_code}\n" --max-time 15 "https://app.caleo.id/"
curl -sS -o /dev/null -w "BE /live: HTTP %{http_code}\n" --max-time 15 "https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live"
```
Expected: both HTTP 200.

- [ ] **Step 6: Stage 3 — Scenario A: configure 3rd tier (happy path)**

Founder-driven browser walk on `https://app.caleo.id`, logged in as Toko Jaya Makmur.

1. Pengaturan → Tingkat Harga panel.
2. Set tier_3_label = "Distributor Kecil". Click Simpan.
3. Expected UI: toast "Tingkat harga tersimpan."
4. Verify DB via Management API:
   ```bash
   source .env
   curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query":"SELECT tier_1_label, tier_2_label, tier_3_label, tier_4_label FROM tenant_settings WHERE tenant_id='\''22222222-2222-2222-2222-222222222222'\'';"}'
   ```
   Expected: tier_3_label = 'Distributor Kecil'.
5. Navigate to Pelanggan → "+ Tambah Pelanggan" → verify 3 pills render (Eceran, Grosir, Distributor Kecil).
6. Navigate to Stok Manager → open a SKU (e.g., TJM-EL-002) → verify 3 price columns show (Harga, Harga Grosir, Harga Distributor Kecil). Set price_tier_3 = 500. Save.
7. Verify DB:
   ```bash
   curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query":"SELECT price, price_tier_3 FROM stocks WHERE sku='\''TJM-EL-002'\'' AND tenant_id='\''22222222-2222-2222-2222-222222222222'\'';"}'
   ```
   Expected: price_tier_3 = 500.
8. Add a customer "QA Smoke Distributor Kecil" with tier="Distributor Kecil" via the pill. Save.
9. Start a new sales quote for that customer → verify tier toggle auto-syncs to Distributor Kecil → add SKU TJM-EL-002 → verify line uses 500.
10. Complete the sale. Verify items JSONB in DB:
    ```bash
    curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"query":"SELECT items FROM sales_orders WHERE tenant_id='\''22222222-2222-2222-2222-222222222222'\'' AND customer_id=(SELECT id FROM customers WHERE wa_number='\''<smoke-customer-wa>'\'') ORDER BY created_at DESC LIMIT 1;"}'
    ```
    Expected: items[0] contains `pricing_tier_used: 'tier_3'` AND `pricing_tier_label: 'Distributor Kecil'`.

- [ ] **Step 7: Stage 3 — Scenario B: rename tier (label immutability)**

1. Pengaturan → Tingkat Harga → rename tier_3 to "Grosir Besar Sekali" → Simpan.
2. Reprint invoice from Scenario A step 10.
3. Expected: PDF label reads "Distributor Kecil" (snapshot preserved), NOT the new "Grosir Besar Sekali".

- [ ] **Step 8: Stage 3 — Scenario C: disable tier (orphan fallback)**

1. Pengaturan → Tingkat Harga → clear tier_3_label (empty string). Simpan.
2. Verify pills hide across app.
3. Open the customer from Scenario A → verify pill shows "Eceran" as active (orphan fallback per resolveEffectiveTier).
4. Start a new quote for that customer → verify base price used.
5. Re-enable tier_3_label = "Distributor Kecil" → verify pill for that customer resurfaces on tier_3.

- [ ] **Step 9: Stage 3 — Scenario D: modul off regression**

1. Pengaturan → Modul Switches → toggle Multi-Tier Pricing OFF. Simpan.
2. Verify NO tier UI anywhere:
   - Pelanggan → "+ Tambah Pelanggan" → no pill row
   - Pelanggan edit → no pill row
   - Pengaturan → no Tingkat Harga panel
   - StockManager → no price_grosir / price_tier_N columns
   - Sales quotation → no tier toggle
3. Verify no console error, no failed network request.
4. Re-toggle Multi-Tier ON to restore test state.

- [ ] **Step 10: Stage 3 — Scenario E: duplicate label rejection**

1. Pengaturan → Tingkat Harga → set tier_2_label="grosir", tier_3_label="Grosir" → Simpan.
2. Expected: toast "Label tier duplikat — semua label harus unik."
3. Fix labels back to unique values.

- [ ] **Step 11: Stage 3 — Scenario F: length rejection**

1. Pengaturan → Tingkat Harga → set tier_3_label="AB" (2 chars) → Simpan.
2. Expected: toast "Tier 3 harus 3-30 karakter."
3. Clear the field.

- [ ] **Step 12: Cleanup**

1. Delete "QA Smoke Distributor Kecil" customer from Pelanggan Screen.
2. Reset TJM-EL-002 price_tier_3 to NULL (or restore to Toko Jaya Makmur's original state).
3. Reset Pengaturan tier labels to `Eceran` / `Grosir` / NULL / NULL.

- [ ] **Step 13: Post-migration advisor scan**

Per CLAUDE.md: run Supabase advisor after any DB migration. If Supabase MCP is available:
```
mcp__plugin_supabase_supabase__get_advisors
```
Else via Management API:
```bash
source .env
curl -sS -X GET "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/advisors?type=security" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```
Expected: no new critical findings. Triage any performance findings related to `stocks.price_tier_3/4` — if any (unlikely given nullable + no index), log to `progress.md`.

- [ ] **Step 14: If ANY scenario fails, ROLLBACK**

```bash
# Rollback to the previous prod tag (the one before Phase 1b)
PREVIOUS_SHA=$(git log --format=%h --before=$(git log -1 --format=%aI HEAD) origin/main --skip=1 --max-count=1 --grep='^feat(pricing-tier)' -v)
bash scripts/promote-to-prod.sh $PREVIOUS_SHA
```

Log the incident file per CLAUDE.md incident-logging discipline at `docs/incidents/YYYY-MM-DD-phase-1b-<slug>.md`. Do NOT leave broken code in prod.

---

## Task 10: `progress.md` + deploy verify

**Files:**
- Modify: `progress.md` (append entry)

- [ ] **Step 1: Append an entry to `progress.md`**

Open `progress.md` and add at the top of the log body (below the H1), preserving all existing entries:

```markdown
## YYYY-MM-DD — Phase 1b: Owner-configurable pricing tiers (2-4) SHIPPED

**What:** Owner can now configure the number and labels of pricing tiers per tenant (2-4 fixed slots) via new `Pengaturan → Tingkat Harga` panel. Tier_1 (base) and tier_2 always active with tenant-editable labels (defaults `Eceran`/`Grosir`); tier_3 and tier_4 are optional (NULL label = disabled). Products carry 4 nullable price columns (`price`, `price_grosir`, `price_tier_3`, `price_tier_4`) with COALESCE fallback to base at read time. `customers.default_pricing_tier` CHECK widened to 4 keys. Sales-line items JSONB gets a `pricing_tier_label` snapshot stamped at write time for immutable historical invoices.

**Why:** Phase 1a fixed the add-customer form so tier could be set at creation. Phase 1b makes the tier set itself configurable — MSME distributor tenants often need 3-4 pricing bands (retail, grosir kecil, grosir besar, distributor). Fixed columns match the founder's committed cap of 4 tiers; JSONB alternative was rejected because it's harder to reverse and codebase convention favors columns for financial-audit granularity.

**Scope kept out:** dynamic-N owner-created tiers (founder capped at 4); SKU-quantity tiering (Phase 2); backend Go WA-onboard path (still defaults `'eceran'`); per-tier visual pill palette distinction (all non-base tiers reuse purple; design-tokens ask deferred to Phase 1c); historical items JSONB backfill (renderer falls back to current tenant label for pre-Phase-1b items).

**Files touched (2 migrations + ~13 code files):**
- Migration `20261115000542_tier_config_schema_and_rpc.sql` — schema (tenant_settings + stocks + customers CHECK) + `update_tenant_tier_config` SECDEF RPC.
- Migration `20261115000543_widen_sales_rpcs_for_tier_config.sql` — widen `record_kasir_sale` + `create_tempo_invoice` for 4-key INVALID_TIER + COALESCE cascade + JSONB label stamp.
- New `src/lib/pricing/getActiveTiers.ts` + tests — single source of truth for tier list, orphan fallback, price lookup.
- New `src/components/pengaturan/TierConfigPanel.tsx` + tests — 4 label inputs, TCFG_* error mapping, observability.
- Type widening in `src/types.ts` + `supabaseClient.ts`.
- Generalized pill sites: NewCustomerInlineForm, PelangganScreen (edit + filter + list badge), CatatPenjualanWizard (auto-sync + cart re-price), CartRows.
- Generalized product entry: ProductForm, StockTableView, BulkUpdate rename + CSV widening.
- cascadeMap FieldKey rename `csv_bulk_grosir_button` → `csv_bulk_tier_prices_button`.
- Audit SQL updated to output `default_pricing_tier` column.

**Verified (Stage 1, all ✓):** lint, all audits, full vitest (getActiveTiers 12/12, TierConfigPanel 5/5, PelangganScreen 12+/12+, ~1000+ overall). Migrations smoke-tested via Management API + RAISE EXCEPTION rollback (Scenario E duplicate reject + Scenario F length reject + Scenario A happy path with tier_3 label stamp in items JSONB).

**Stage 2 (deploy) ✓:** Cloud Build FE + BE both SUCCESS on commit `<SHORT_SHA>`. Manual `scripts/promote-to-prod.sh` executed. `curl app.caleo.id` and BE `/live` both HTTP 200.

**Stage 3 (browser smoke) ✓:** Toko Jaya Makmur, all 6 Scenarios (A configure tier_3, B rename → label immutability, C disable → orphan fallback, D modul off regression, E duplicate reject, F length reject) walked and passed by founder + DB verified via Management API.

**Spec:** [`docs/superpowers/specs/2026-07-28-phase-1b-tier-config-design.md`](docs/superpowers/specs/2026-07-28-phase-1b-tier-config-design.md).
**Memo:** [`docs/superpowers/specs/2026-07-28-phase-1b-tier-config-decision.md`](docs/superpowers/specs/2026-07-28-phase-1b-tier-config-decision.md).
**Plan:** [`docs/superpowers/plans/2026-07-28-phase-1b-tier-config-plan.md`](docs/superpowers/plans/2026-07-28-phase-1b-tier-config-plan.md).
```

Replace `YYYY-MM-DD` with today's date. Replace `<SHORT_SHA>` with the actual commit SHA that was promoted.

- [ ] **Step 2: Commit + push**

```bash
git add progress.md
git commit -m "$(cat <<'EOF'
docs(progress): Phase 1b — owner-configurable pricing tiers SHIPPED

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 3: Confirm deploy succeeded**

Per memory `deploy_verify_after_push`:

```bash
gcloud builds list --limit=2 --format='table(id,status,duration)'
```
Expected: latest build STATUS is `SUCCESS`. If FAILURE, investigate and rollback per Task 9 Step 14.

---

## Self-review notes

**Spec coverage:**
- Data model §3.1-3.3 → Task 1 ✅
- Snapshot inside items JSONB §3.4 → Task 5 (RPC stamps label) ✅
- `update_tenant_tier_config` RPC §3.5 → Task 1 ✅
- Widen sales RPCs §3.6 → Task 5 ✅
- Orphan-tolerant fallback §3.7 → Task 3 `resolveEffectiveTier` + Task 6 uses it ✅
- Migration slots §3.8 → Task 1 (542) + Task 5 (543) ✅
- Pengaturan panel §4.1 → Task 4 ✅
- `getActiveTiers` helper §4.2 → Task 3 ✅
- Generalize pills §4.3 → Task 6 ✅
- Product entry §4.4 → Task 7 ✅
- CartRows warning §4.5 → Task 6 Step 5 ✅
- Cascade map §4.6 → Task 7 Step 7 ✅
- Type widening §4.7 → Task 2 ✅
- Impact analysis §5 → covered by file inventory + tasks 1-8
- Testing §6 (Stage 1 + Stage 3 Scenarios A-F) → Task 9 ✅
- Observability §7 → Task 4 embeds breadcrumb + captureError + console.info usage log ✅
- Migration + rollback §8 → Tasks 1, 5 + Task 9 Step 14 ✅

**Placeholder scan:**
- Task 5 Step 3 has the `-- ... FULL body from slot 000325` placeholders. This is INTENTIONAL — the implementer must copy the actual multi-hundred-line RPC bodies from the predecessor migration; embedding them verbatim in this plan would triple its size. The scaffold + 4 marked changes give exact instructions.
- Task 7 Step 3 says "widen the parser to handle missing columns" without full code — the existing parser is small (~30 lines per Phase 1a discovery) and the widening pattern is mechanical (add a column → optional read → default null). Implementer reads the existing file first.
- No `TBD`, no `TODO`, no "similar to Task N" refs, no vague "add validation" instructions.

**Type consistency:**
- `TierKey` union declared in Task 2, re-exported in Task 3, imported+used identically in all downstream tasks.
- `Tier` interface shape (key/label/slot) consistent across Task 3 (declaration) and Task 6/7 (consumers).
- RPC parameter names (`p_tier_1_label` etc.) consistent between Task 1 (SQL) and Task 2 (wrapper) and Task 4 (call site).
- Migration slot numbers `000542` and `000543` referenced identically throughout.

**Ambiguity check:**
- Step1ChannelCustomer.tsx handling: Task 6 Step 2 asks to add prop forwarding IF not already, Task 8 Step 1 verifies. Two tasks touching the same file — ordering is Task 6 first, Task 8 confirms. Clear.
- PengaturanScreen wiring: Task 4 Step 4 says "verify at plan time via grep". Deliberate — the panel-rendering pattern varies across pengaturan components; implementer chooses to mirror the closest sibling. Not a placeholder, a legitimate grep-and-mirror instruction.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-phase-1b-tier-config-plan.md`.**
