# Phase A Architecture Spike Report

**Date:** 2026-07-03
**Duration:** ~30 min (vs. 1 day budgeted)
**Scope:** Verify 4 load-bearing assumptions in `docs/superpowers/specs/2026-07-03-multi-tenant-phase-a-design.md`
**Environment:** Production Supabase project `ekhhojaezdfjfwuxyjkl` (ERP MSME AI Studio, ap-northeast-1). All test artifacts cleaned up; production restored to pre-spike state.

## TL;DR — Go / No-Go

**NO-GO on current architecture as written.** One assumption FAILS (§3.1 `pgrst.db_pre_request`) and one is CONFIRMED as an active risk that needs Task 8.5 to ship (§3.5.2 SECDEF+BYPASSRLS). Two assumptions PASS (regex fix works; DB size 7% of cap).

**Recommended pivot:** replace `pgrst.db_pre_request` single-point-setter with **Supabase Auth Hook** (`custom_access_token_hook`) injecting `tenant_id` claim into JWT. This is officially supported, free tier, no per-request overhead, more secure (JWT is signed).

Full findings + 3 architecture options below.

---

## Step 1 — `pgrst.db_pre_request` on Supabase Cloud → **FAIL**

**Method:**
1. Created harmless test function `_spike_test_pre_request()` that INSERTs to a log table, catches all exceptions.
2. `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public._spike_test_pre_request'` — succeeded.
3. Verified stored in `pg_roles.rolconfig`.
4. `NOTIFY pgrst, 'reload config'` — succeeded.
5. Confirmed PostgREST listening via `pg_stat_activity`:
   ```
   usename=authenticator application_name=postgrest query='LISTEN "pgrst"'
   ```
6. Sent 6 API requests via `curl` to `/rest/v1/company_settings` — all HTTP 200.
7. Log table: **0 fires**.

**Result:** The setting is stored in Postgres, PostgREST is listening on `pgrst` channel, permissions and grants are correct, but the pre-request function does **not fire on real API requests**. Supabase's PostgREST appears to filter or ignore the per-role `pgrst.db_pre_request` setting at the connection acquisition layer.

**Impact:** Spec §3.1 single-point-setter design does NOT work on Supabase Cloud managed. Every downstream reference to `_pgrst_pre_request()` (§3.1, §3.6, §5.3 template using `_guard_expiry_write() IS NULL`, plan Task 8, plan Task 11) is invalidated.

**Cleanup:** `ALTER ROLE authenticator RESET pgrst.db_pre_request` executed. `NOTIFY pgrst, 'reload config'` sent. rolconfig restored to Supabase defaults (`session_preload_libraries=supautils,safeupdate`, `statement_timeout=8s`, `lock_timeout=8s`). Test function and log table dropped.

**Bonus finding:** Supabase already sets `statement_timeout=8s` on authenticator (not `10s` as in spec §3.5.7). Update spec to acknowledge this Supabase default.

---

## Step 2 — Auto-wrap regex on DECLARE-block RPCs → **PASS (revised regex works)**

**Method:** Applied both original and revised regexes to `_apply_price_change` (a real SECURITY DEFINER RPC with DECLARE block).

**Result:**
| Regex | Matched? | Verdict |
|---|---|---|
| Original `\$[a-zA-Z0-9_]*\$\s*BEGIN` | NO — output identical to input | **would silently miss** |
| Revised `\nBEGIN\n` (line-anchored) | YES — inject succeeded | **works** |

Sample output snippet after revised regex:
```
BEGIN
  PERFORM public._guard_expiry_write();
  SELECT decided_by INTO v_actor
    FROM public.approval_requests
   WHERE id = p_approval_id;
  ...
```

Injection lands at the correct location (top of function body, after DECLARE but before business logic).

**Scale finding:** production has **162 SECURITY DEFINER RPCs**, of which **112 have DECLARE + write** — i.e., 112 would be silently missed by the original regex. Revised regex is mandatory before Task 8 ships.

---

## Step 3 — Cross-tenant leak via SECDEF + BYPASSRLS → **CONFIRMED (baseline for Task 8.5)**

**Method:** Enumerate ownership of all SECDEF RPCs; verify BYPASSRLS role attributes on Supabase's baseline roles.

**Result:**

- All 163 SECDEF RPCs in `public` schema owned by `postgres`.
- `pg_roles` attribute check:
  ```
  postgres:      rolbypassrls=true   ← the leak vector
  service_role:  rolbypassrls=true
  supabase_admin: rolsuper=true
  authenticator: rolbypassrls=false
  authenticated: rolbypassrls=false
  anon:          rolbypassrls=false
  ```

**Implication:** every SECDEF RPC runs as `postgres` → RLS **bypassed even with FORCE RLS** → if the RPC body queries `stocks`, `customers`, etc. without an explicit `WHERE tenant_id = ...` filter, tenant B calling that RPC sees tenant A's rows.

**Verdict:** Task 8.5 (SECURITY DEFINER audit + ownership migration to `vosi_rpc_owner` role, plus explicit tenant filters in high-risk RPCs) is a **PHASE A SHIP BLOCKER**. Cannot onboard tenant #2 until this is done.

---

## Step 4 — DB size headroom → **PASS (very comfortable)**

**Result:**
- Production DB size: **35 MB**
- Free tier cap: 500 MB
- Utilization: **7%**
- Headroom for tenant #2: 465 MB

Verdict: free tier data cap is not the immediate bottleneck. Onboarding 2–3 additional MSME tenants would still fit. The §7.6 auto-pause landmine remains the real production concern (unchanged).

---

## Architecture Pivot Options — user must pick before we proceed

Since Step 1 failed, the design MUST change. Three viable pivots, ranked by my recommendation:

### Option A — **Supabase Auth Hook `custom_access_token_hook` injects `tenant_id` claim** (recommended)

**Mechanism:** register a Postgres function as the JWT customization hook via Supabase Dashboard → Authentication → Hooks → Custom Access Token. On every JWT issue/refresh, the hook reads `tenant_users` for the user and injects `tenant_id` (and `is_platform_admin`) as claims into the JWT. RLS policies then use `(auth.jwt() ->> 'tenant_id')::uuid = tenant_id`.

**Pros:**
- Officially supported on Supabase free tier
- Zero per-request overhead (JWT is signed once at issue, cached in browser)
- Tamper-proof (JWT signature)
- No PgBouncer GUC leak risk
- No 200-RPC audit for `_set_tenant_context()` calls

**Cons:**
- Multi-tenant users need JWT re-issue to switch tenant → for MSME context this is fine (users rarely multi-tenant)
- Impersonation flow: super-admin calls `impersonate(slug)` RPC → server calls `auth.admin.updateUserById(user, { app_metadata: { impersonating: '<slug>' } })` → user's next token refresh includes the impersonation claim → hook resolves impersonation to concrete tenant_id
- `_resolve_tenant_id()` helper body must change from GUC read to JWT read

**Effort delta vs. original spec:** roughly -1 day (simpler than pre-request wiring). Task 8 shrinks significantly; Task 11 pgTAP shrinks. Frontend changes are essentially the same.

### Option B — Per-RPC GUC-setter wrapper (auto-wrapped like `_guard_expiry_write`)

**Mechanism:** Every write RPC gets an additional injected line: `PERFORM _set_tenant_context()`. Function reads `current_setting('request.jwt.claims', true)` → parses `sub` (user_id) → looks up `tenant_users` → sets `app.current_tenant_id` GUC transaction-local. RLS policies unchanged (still use `_resolve_tenant_id()`).

**Pros:**
- Existing `_resolve_tenant_id()` semantic preserved
- Doesn't require Auth Hook config
- Localized to write RPCs (reads use RLS naturally)

**Cons:**
- Extra DB lookup per RPC call (100 ns – 1 ms overhead)
- Reads that don't go through RPC (direct `.select()` from client) still need something — probably requires RLS to look up tenant_users on the fly per row → expensive
- Adds one more thing to the auto-wrap script

**Effort delta:** neutral (same complexity as Task 8).

### Option C — Client-side tenant_id in every query + strict RLS

**Mechanism:** Frontend always includes `x-tenant-id` header OR `tenant_id` query param. RLS reads the header and validates against JWT's user membership. No hook needed.

**Pros:** simplest architecture; no server-side hooks at all.

**Cons:** every existing RPC needs signature change to accept tenant_id. Verbose. Client bugs (forgetting to pass tenant_id) become cross-tenant leaks. Adversarial testing harder.

**Not recommended** — offloads too much correctness to client.

---

## Recommended path forward

1. **User picks pivot option** (A / B / C).
2. If **A** (recommended): I revise spec §3 to use custom_access_token_hook + revise plan Task 8, 11, 12. Effort estimate drops from 18 → ~16 days.
3. If **B**: I revise spec §3 to use per-RPC wrapper pattern + revise Task 8 auto-wrap to inject `_set_tenant_context()` alongside `_guard_expiry_write()`. Effort stays 18 days.
4. Independent of the pivot, Task 8.5 (SECDEF ownership migration to `vosi_rpc_owner`) remains as-is — the BYPASSRLS finding is real and unrelated to hook mechanism.
5. Regex fix (Step 2) already in the plan — no action needed.
6. §7.6 auto-pause landmine remains — no engineering fix; only Pro tier ($25/mo) upgrade at real go-live.

## Data verifying my claims (verbatim from production)

- Auth hook / db_pre_request test — function stored, PostgREST listening, 6 requests sent, 0 fires
- SECDEF RPC ownership: 163 RPCs all `postgres`-owned
- Role attributes: `postgres.rolbypassrls=true`, `service_role.rolbypassrls=true`
- DB size: 35 MB / 500 MB = 7%
- Regex verification on `_apply_price_change`: original miss=true, revised miss=false, injection at correct location
