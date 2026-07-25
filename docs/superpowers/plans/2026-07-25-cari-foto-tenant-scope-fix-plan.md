# Plan — Cari by Foto tenant-scope + observability fix

**Slug:** `cari-foto-tenant-scope-fix`
**Branch:** `fix/cari-foto-tenant-scope` (worktree at `.claude/worktrees/cari-foto-tenant-fix`)
**Migration slot:** `20261115000540` (memory `migration_slot_allocation`)
**Date:** 2026-07-25
**Author:** Claude Opus 4.7 (session `e7fdddff`)

## Context

Bug chain discovered while validating CSP-fix landing:

1. **Founder-reported symptom:** upload foto Panel Besi ke Cari by Foto → hasil match tetapi SKU direkomendasi berbeda dari expected. Investigation reveals photo attached to wrong SKU during upload (data entry), and search returned closest visual match (correctly identified as Panel Besi).
2. **Deeper bug 1 [CRITICAL, data loss]:** `IndexPhotos` backend INSERT silent-fails via FK violation on `tenant_id` when backend Go pooler has no JWT context (`_resolve_tenant_id()` returns sentinel UUID that isn't in `tenants` table). 4 SKUs in Testing Jaya Panel confirmed as photos-uploaded-but-0-embeddings (`434265b7`, `617ebed9`, `ca2a458d`, `e9fe7c88`); most recent silent-fail was 2026-07-24 13:29 UTC.
3. **Deeper bug 2 [CRITICAL, cross-tenant leak]:** `search_products_by_embedding` RPC has no `tenant_id` filter; JOIN to `stocks` also unfiltered. Backend Go bypasses RLS (postgres pool role). Any tenant's Cari-by-Foto call can return matches from any other tenant's indexed photos. Not yet materialized (only 1 tenant has embeddings), but a landmine as tenants onboard.
4. **Deeper bug 3 [MEDIUM, observability]:** `clip_inference_log.tenant_id NOT NULL DEFAULT _resolve_tenant_id()` — same silent-fail pattern; 0 log entries past 24h even though endpoint has been called. Pipeline health invisible.
5. **Deeper bug 4 [HIGH, silent error swallow]:** `ProductForm.tsx:193` uses `void indexPhotos(...).catch(() => {})` — user never sees indexing errors, data drift accumulates silently.

## Historical evidence

- 15 embeddings for Testing Jaya Panel indexed 2026-06-18 04:58 UTC in a single 11-second window — bulk seed script, not FE flow
- FE `void indexPhotos()` wired 2026-06-18 17:53 WIB (commit `4abc9dd`), 6h AFTER seed
- 3 orphan photos (2026-06-20 / 06-23) uploaded via FE never got indexed — pre-Phase-A cause unknown (backend may not have been deployed / model not loaded)
- 4th orphan (2026-07-24) definitively FK-violation via Phase-A NOT NULL + `_resolve_tenant_id()` sentinel

## Fix strategy

**Explicit tenant_id parameter through the whole stack.** Backend extracts `tenant_id` from JWT (Authorization header), passes as explicit parameter to RPC + INSERT. Avoids session GUC state leaks in pooled connections. Matches audit-friendly explicit-scoping pattern already used in other backend Go RPC callers.

**Deploy-safe two-phase (accept-both-for-one-release):**
- **This release:** backend accepts BOTH JWT-present and JWT-absent requests. JWT-present → uses tenant_id, works correctly. JWT-absent → logs warning, returns empty results (search) / 400 with clear message (index). No cross-tenant leak because absent-tenant returns empty. FE always sends JWT.
- **Follow-up release (separate PR, after 1 week burn-in):** tighten to strict 401 on missing JWT.

Rationale: eliminates FE/BE deploy sequencing hazard. Cross-tenant leak stops immediately (empty-on-absent is safer than any-tenant-on-absent). Advisor's recommendation.

## Files touched (planned)

### Backend Go (3 files, ~80 lines net)

1. `backend-go/products_search.go` — `SearchByPhoto` + `IndexPhotos` + `logInference`
   - Add `extractTenantIDFromJWT(r *http.Request) (uuid.UUID, bool)` helper
   - Modify RPC call to pass `tenant_id` param
   - Modify INSERT to include tenant_id in columns
   - Log JWT-absent warnings via slog

2. `backend-go/products_search_test.go` (new) — unit tests for JWT extraction + tenant scoping

3. Possibly `backend-go/internal/api/context_middleware.go` — reuse `extractJWTClaims` helper (already exists there)

### SQL migration (1 file, slot 540)

4. `supabase/migrations/20261115000540_cari_foto_tenant_scope_rpc.sql`
   - `DROP FUNCTION IF EXISTS public.search_products_by_embedding(vector, real, integer)` (drop old signature)
   - `CREATE OR REPLACE FUNCTION public.search_products_by_embedding(query_embedding vector, similarity_threshold real DEFAULT 0.70, result_limit integer DEFAULT 5, p_tenant_id uuid DEFAULT NULL)` — new signature; `p_tenant_id` filter in CTE + JOIN
   - `GRANT EXECUTE` to authenticated + service_role
   - Idempotent (all `IF EXISTS` / `OR REPLACE`)

### Frontend (2 files, ~30 lines)

5. `src/lib/cariByFotoService.ts` — attach `Authorization: Bearer <access_token>` header from `supabase.auth.getSession()` to both `searchByPhoto` and `indexPhotos` fetch calls

6. `src/components/produk/ProductForm.tsx:193` — replace `void indexPhotos(...).catch(() => {})` with awaited call inside `try` block, showing toast on failure ("Foto tersimpan, tapi belum bisa dicari via AI. Retry?"). Add retry button in photo card UI on `status: 'index_failed'`.

### Regression tests (1 file)

7. `tests/isolation/cari-by-foto-tenant.test.ts` — 2 scenarios:
   - Tenant A indexes photo → Tenant B searches → results MUST be empty
   - Tenant A indexes photo → Tenant A searches → results MUST contain that photo

## Data repair (post-fix, separate one-shot)

After fix ships + verified:
- Script `scripts/backfill-cari-foto-embeddings.sh` (one-shot, not committed)
- Query `SELECT sku FROM stocks WHERE jsonb_array_length(photo_urls) > 0 AND sku NOT IN (SELECT DISTINCT sku FROM stock_photo_embeddings)`
- For each: `curl POST /api/v1/products/index-photos` with proper JWT
- Run once per production tenant that has orphan photos

## Impact analysis

**Direct importers:**
- `backend-go/products_search.go` — routes registered at `main.go:449-450` (SearchByPhoto, IndexPhotos)
- `src/lib/cariByFotoService.ts` — 3 refs (`CariByFotoModal.tsx:3`, `KasirScreen.tsx:22`, `ProductForm.tsx` via indexPhotos)
- `search_products_by_embedding` RPC — 1 caller: `products_search.go:127`

**Indirect callers:**
- `HasilCariFotoModal.tsx` — displays results (no change needed; empty state already covered)

**Tests:**
- `src/components/produk/productFormValidate.test.ts` — validation only, not affected
- `src/lib/productPhotoService.test.ts` — compression only, not affected
- NEW: `tests/isolation/cari-by-foto-tenant.test.ts`

**DB touchpoints:**
- `stock_photo_embeddings` (INSERT + SELECT)
- `stocks` (SELECT via JOIN)
- `clip_inference_log` (INSERT)
- `tenants` (FK reference)

**Verdict:** 6 files touched (3 BE, 1 SQL, 2 FE) + 2 test files. Plan covers all identified paths. Data repair scoped as post-fix one-shot, not blocker for shipping code.

## Rollback plan

- If FE deploy causes regression: `promote-to-prod.sh` with previous FE SHA reverts FE-only
- If BE deploy causes regression: `promote-to-prod.sh` with previous BE SHA reverts BE-only
- If SQL migration causes issue: `DROP FUNCTION public.search_products_by_embedding(vector, real, integer, uuid)` + restore old signature from migration `20260616000010`. Advisors `postgres_needs_recheck` for RPC drop.

## Verification plan

**Stage 1 — Local:**
- `npm run lint` clean
- `npm run audit:numinput` + `audit:secdef-null-tenant` + `audit:csp-backend-allowlist` clean
- `npx vitest run --changed` green
- New isolation test passes
- `psql` smoke: apply migration to local Supabase branch, verify RPC signature via `\df`, seed 2 tenants each with 1 embedding, run RPC as each — verify tenant scoping

**Stage 2 — Deploy:**
- `git push origin fix/cari-foto-tenant-scope`
- If parallel session hasn't already merged this branch, open PR to main
- Cloud Build FE + BE + migration apply
- Founder promote via `./scripts/promote-to-prod.sh <SHORT_SHA>` (manual gate per rule `feedback_manual_prod_gate_after_real_tenant`)
- Note: FE promotes first in `apply_and_verify`, then BE — safe order for this class

**Stage 3 — Prod smoke on `app.caleo.id`:**
Since chrome MCP disconnected, verification is founder-driven:

1. Founder logs into Testing Jaya Panel (tenant with 15 existing embeddings)
2. Kasir → Cari by Foto → upload the same Panel Besi photo (`e84390e0-...jpg`) that they attached to chat
3. **Expected:** results appear with AA201712OD as top match (~0.99), AA201712ID second (~0.90). NEW: `617ebed9` MCB Schneider should now ALSO appear (assuming backfill scripted post-deploy) as self-match sim=1.0
4. Founder logs into Toko Jaya Makmur (tenant with 0 embeddings)
5. Kasir → Cari by Foto → upload same photo
6. **Expected:** amber "Tidak menemukan produk yang cukup mirip" — proves no cross-tenant leak
7. Founder opens ProductForm in Toko Jaya Makmur → upload a new product photo → verify no error toast (indexing works)
8. `gcloud logging read '"CSP-REPORT"'` — verify no new CSP violations for backend hostname
9. `psql` check: `SELECT count(*) FROM stock_photo_embeddings WHERE tenant_id=<toko_jaya_id>` — should be 1 after step 7

## Explicit non-goals (out of scope)

- Data cleanup for wrong-photo-attached-to-wrong-SKU (e.g., `617ebed9` MCB Schneider having Panel Besi photo) — this is user data-entry issue, requires re-uploading correct photo
- Tightening backend to strict-401 on missing JWT — planned follow-up release after 1 week burn-in
- Optimizing CLIP cold-start latency (~10s) — orthogonal
- Backfilling embeddings for orphan photos on real customer tenants — needs founder confirm each has real product data first

## Confidence marks on the plan

- **[VERIFIED]** Root cause of Bug 1: `psql` DO block simulated backend INSERT and got FK violation on sentinel UUID
- **[VERIFIED]** Root cause of Bug 2: curl without JWT returned Testing Jaya Panel results = cross-tenant leak; backend `current_user` confirmed as `postgres`
- **[VERIFIED]** Root cause of Bug 3: `\d clip_inference_log` shows NOT NULL tenant_id DEFAULT; `SELECT count(*) WHERE called_at > now() - '24h'` = 0
- **[VERIFIED]** 4 orphan SKUs list from SQL query (`WHERE photos > 0 AND embeddings = 0`)
- **[VERIFIED]** FE `void indexPhotos(...).catch(() => {})` at `ProductForm.tsx:193` — grep-confirmed
- **[REASONED]** Fix approach: explicit tenant_id param over session GUC — based on Supabase docs + PostgREST pattern applicability to non-PostgREST client
- **[REASONED]** Accept-both-for-one-release strategy — advisor's recommendation, orthogonal to root cause fix
- **[ASSUMED]** Backfill script will need founder-provided JWT tokens (or admin service-role bypass) — will confirm during data-repair step

## Follow-up work (separate PRs, out of this scope)

- Strict-401 tightening (~7 days after this ships)
- Extend fix pattern to other backend Go endpoints that touch tenant-scoped data (audit needed — `logInference` similar issue, and possibly other endpoints)
- Backfill script for real customer tenants that have accumulated orphan photos
- Rebuild `clip_inference_log` DEFAULT to fall back to `NULL::uuid` (allow NULL for platform-level logs when JWT absent) OR require explicit tenant_id param (align with other tables)
