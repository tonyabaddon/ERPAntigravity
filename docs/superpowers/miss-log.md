# Miss Log — Founder-caught misses + prevention rules

**Purpose:** Append-only log of every time founder had to catch something I missed. Each entry names the pattern + prevention. CLAUDE.md rules get updated when patterns recur.

**Read first 5 entries at every session start** (per CLAUDE.md session-start ritual).

---

## Entry #1 — 2026-07-20 — Phase 1 plan 10 gaps

**Context:** After 7 QA sessions, wrote Phase 1 implementation plan (`docs/superpowers/plans/2026-07-20-qa-week-phase-1-plan.md`). Founder asked "cek lagi tidak ada yang miss?" — 10 gaps surfaced on re-review.

**What was missed:**
1. `gjp_cust_seq` reference grep — never verified deprecation safe
2. Handler `conv.TenantID` fallback — plan said HALT but no concrete SQL fallback
3. Backend Go test mock breakage from signature change — no explicit test-run step
4. Friendly error message for same-tenant duplicate — technical PG error surfaces
5. FK-referencing check on `audit_log(id)` + `pembayaran(id)` before PK migration
6. Supabase Realtime subscription impact from PK change
7. PDF count 12 vs actual 13 (missed `salesOrderPdf`)
8. html2canvas compat with jspdf 4.x
9. `schema_migrations` tracking after direct-psql apply (bootstrap will re-run)
10. Time estimates per task missing

**Root cause:**
- First-pass optimism — presented plan without adversarial self-critique
- Advisor call was made for the SPEC but NOT for the PLAN — treated as optional
- No "## I verified" section forced grep counts / concrete evidence
- Confused "I know this domain" with "I verified this specific fact"

**Prevention (now HARD RULE in CLAUDE.md):**
1. "Pre-presentation discipline" section added — 3 gates before every plan/spec/recommendation
2. Advisor call REQUIRED (not "kalau ingat") for every plan
3. "## I verified" section with concrete evidence (grep counts, SQL results) mandatory
4. "## Adversarial critique" section mandatory
5. Confidence marking `[VERIFIED]` / `[REASONED]` / `[ASSUMED]` on every claim
6. Session-start ritual reads this miss-log — future-me sees pattern

**Files updated:** CLAUDE.md, `.claude/settings.json` (stop-hook), memory `audit-discipline-pre-present`.

---

<!-- New entries appended below. Newest at top for scan-friendliness. -->

## Entry #4 — 2026-07-24 — P3-05 SECDEF ownership 3rd instance: `verify_owner_pin` + 9 others still owned vosi_rpc_owner blocked ALL PIN approvals

**Context:** Founder reported "tidak bisa masukin PIN approval untuk jumlah stock". Reproduced on Toko Jaya Makmur: click Setujui on `initial_stock` → PIN pad opens → type 6 digits → RPC returned HTTP 403 with `{"code":"42501","message":"permission denied for schema auth"}`. OwnerPinPad error extraction bug rendered it as `[object Object]` in the UI (secondary bug — hid the actual cause). Second complaint from founder: "cannot insert PIN for customer tempo that I add during the sales order" — same class, different RPC path.

**What was missed:**
1. Migration `20261115000514` reverted 22 SECDEF functions from OWNER vosi_rpc_owner back to OWNER postgres for the exact "permission denied for schema auth" reason. But the audit that produced that 22-function list was NOT exhaustive — 10 more functions with `prosrc LIKE '%auth.%'` or `auth.uid()` remained owned by vosi_rpc_owner: `verify_owner_pin`, `provision_tenant`, `grant_impersonation`, `revoke_impersonation`, `record_balance_adjustment`, `reject_customer_credit_activate`, `clear_conversation_lock`, `manually_override_conversation_state`, `approve_and_amend_rakit_lock`, `_piutang_write_off_resolve_owner`.
2. When migration 000519 fixed those 10 by reverting to OWNER postgres, a knock-on emerged: 4 remaining vosi_rpc_owner-owned SECDEF wrappers (`approve_customer_credit_activate`, `approve_customer_credit_deactivate`, `approve_customer_credit_limit_change`, `decide_via_wa_button`) call verify_owner_pin internally. Once verify_owner_pin moved back to postgres, those wrappers lost the implicit EXECUTE they had while co-owned. New error surfaced only in the second reproduction (customer_credit_activate PIN).
3. Founder had to test TWO SEPARATE PIN flows to surface both defects. The first fix (migration 519) unblocked initial_stock/adjustment/opname/price_change but silently broke the credit-activate wrapper path. If founder hadn't asked "also check customer tempo", the wrapper regression would have shipped.
4. FE error extraction (`String(supabaseError)` → `"[object Object]"`) hid the actual `permission denied` message for weeks; the visible symptom "cannot input PIN" told nothing about ownership.

**Root cause of the miss:**
- The P3-05 batch was mass-migrated without a completeness check. The `WHERE role='Owner' … LIMIT 1` audit that produced the 22-function list in migration 000514 was written by hand, not from a live pg_proc query.
- SECDEF ownership shuffles have TWO permission edges: OWNER (dictates which schemas the body can read) AND EXECUTE grants to callers. Reverting one function's OWNER without re-granting EXECUTE to peer role-owned callers = knock-on 42501 in a different phrasing.
- FE error handling that converts a plain object to `String(e)` yields `"[object Object]"` — swallows the actual server message. This was a latent bug that only became visible when a real error path fired.

**Prevention:**
1. **Class rule:** any SECDEF function that reads or writes `auth.*` MUST be `OWNER postgres`. Enforce via new audit script: `SELECT proname FROM pg_proc WHERE pg_get_userbyid(proowner) <> 'postgres' AND (prosrc LIKE '%auth.%' OR prosrc LIKE '%auth.uid()%')` — fail if non-empty.
2. **Class rule:** when reverting a SECDEF function's OWNER, GRANT EXECUTE to any role whose SECDEF functions call it. Enumerate callers via `SELECT proname FROM pg_proc WHERE pg_get_userbyid(proowner) <> '<new_owner>' AND prosrc LIKE '%<function_name>%'` before shipping the ownership change.
3. **Class rule:** never render errors via `String(e)`. Detect Supabase PostgrestError shape (`{message, code, hint, details}`) explicitly and surface `.message` — silent `"[object Object]"` is worse than a raw SQL error text.
4. Add CLAUDE.md permanent rule: "Any migration that ALTER FUNCTION OWNER must also enumerate callers + explicit GRANT EXECUTE. Class-fix pattern."

**Empirical confirmation:** Chrome MCP repro on Toko Jaya Makmur:
- Before 519: `POST /rpc/verify_owner_pin [403] {"code":"42501","message":"permission denied for schema auth"}`
- Between 519 & 520: `POST /rpc/approve_customer_credit_activate [403] {"code":"42501","message":"permission denied for function verify_owner_pin"}`
- After 519 + 520: both flows return 200, approval status flips to `approved`, `customers.allows_tempo` mutates true (validated Ibu Sari `credit_limit=5000000, term_days=30`).

**Files updated:** migrations `20261115000519_revert_p3_05_secdef_auth_schema_ownership.sql`, `20261115000520_grant_verify_owner_pin_to_vosi_rpc_owner.sql`, `src/components/approval/OwnerPinPad.tsx` (error extraction fix), `src/components/ui/PinPad.tsx` (shared PinPad — founder-flagged consistency across all persetujuan), consumers updated (OwnerPinPad, ApprovalInboxScreen credit_activate, BalanceAdjustmentModal), this miss-log.

---

## Entry #3 — 2026-07-24 — CSP allowlist drifted from backend URL — silently broke every getBackendUrl() call for 6 days

**Context:** Founder reported "cari by foto tidak bisa upload file". Root cause was NOT the upload path — it was `serve.json` CSP `connect-src` that only allowlisted the Cloud Run `<service>-<hash>-<region>.a.run.app` hostname alias, while `src/lib/backendUrl.ts` fetched the backend via the `<service>-<project_number>.<region>.run.app` alias. Same service, different string. Browser blocked every backend fetch on `app.caleo.id` since CSP flipped Report-Only → enforce on commit `933867b` (2026-07-18). Blast radius: Cari by Foto (search + index), WhatsApp AI (QR, logout, pair-code), bank rekonsiliasi (`recon/upload`, `recon/close`). Only Cari by Foto surfaced because it's the most-used backend-touching feature. WA and recon paths were silently broken for 6 days.

**What was missed:**
1. When `backendUrl.ts` was refactored in commit `6dd9415` (staging/prod split, added `-422860632808.asia-southeast1.run.app` form), CSP was not updated to match. No test caught the drift.
2. When CSP was flipped Report-Only → enforce in commit `933867b`, the pre-existing drift became a hard block. Only WA and recon paths were affected at the time; nobody exercised them so silent failure went unnoticed.
3. The Task 11 gap-fix commit that flipped CSP added a "24h observation" gate BEFORE flip, but observation only caught the Sentry ingest miss — WA/recon paths were not exercised during the window.
4. No CI check verified that hostnames used by the FE existed in the CSP `connect-src`. Every audit script covered SQL/migrations; none covered the frontend↔CSP contract.

**Root cause of the miss:**
- CSP is a client-side gate: the FE code and the CSP header are two separate declarative surfaces that must agree. Only the browser catches the mismatch, and only at runtime, and only when the specific fetch is actually attempted.
- The staging-split refactor and the CSP-enforce flip were 3+ weeks apart and reviewed independently. Neither reviewer had the whole picture.
- Silent-failure blast radius was too small (WA + recon) to trigger anyone before Cari by Foto shipped.

**Prevention:**
1. New audit `scripts/audit-csp-backend-allowlist.ts` — parses `serve.json` CSP + parses `HOSTNAME_TO_BACKEND` values in `src/lib/backendUrl.ts`, fails on any FE hostname absent from the CSP `connect-src`. Wildcard suffix (`*.example.com`) supported.
2. Wired into `.claude/settings.json` Stop hook (`npm run audit:csp-backend-allowlist`) so regression can't ship silently.
3. Class rule to remember: **any FE↔CSP or FE↔CORS contract has two declarative surfaces that must be checked in the same PR.** Refactor of one without touching the other is a red flag; add a CI audit rather than relying on manual review.
4. Consider extending the audit to also parse `Access-Control-Allow-Origin` regex from backend `enableCors` if we ever tighten it beyond `*`.

**Empirical confirmation before fix:** `gcloud logging read '"CSP-REPORT"' --project=gen-lang-client-0410251117 --freshness=7d` returned violation reports for the exact blocked-uri `https://garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app/api/v1/products/search-by-photo` from `document-uri` `https://app.caleo.id/t/garindo/dashboard?screen=kasir`, `disposition=enforce`, `violated-directive=connect-src`. Deductive chain + independent log evidence both point at the same root cause.

**Files updated:** `serve.json` (CSP hostnames added), `scripts/audit-csp-backend-allowlist.ts` (new audit), `package.json` (npm script), `.claude/settings.json` (Stop hook), `progress.md` (root-cause entry), this miss-log.

---

## Entry #2 — 2026-07-22 — Anchored on OTP/pool while impersonation loop was the actual bug

**Context:** Founder reported "can't receive OTP login" → session went deep on Supabase :5432 pool exhaustion (real bug, 2026-07-20 recurrence). Diagnosed + partially fixed pool. Then founder asked "why isn't admin.caleo.id the dashboard for caleo admin?" — I answered "you're seeing the login gate; try login". After I got them logged in via MCP chrome, they saw the Garindo TENANT dashboard, not the Caleo admin dashboard. Actual bug was a stale impersonation row from 2026-07-11 (11 days old) that stamped `impersonating=true` into every JWT the founder was issued.

**What was missed:**
- Founder's "why isn't admin.caleo.id the dashboard for caleo admin?" question wasn't just "you need to login" — it was a POST-LOGIN ROUTING bug that would have shown as the WRONG dashboard even if OTP had never broken.
- Should have checked `AdminRouteGuard.tsx` + JWT claims + `platform_admin_active_impersonation` state THE MOMENT founder described that symptom.
- Instead I anchored on the earlier symptom class ("OTP/pool") and lumped this into the same investigation. Fixed OTP send, thought I fixed the admin dashboard visibility, told founder "just login". Founder logged in → still wrong dashboard → I finally checked routing.

**Root cause of the miss:**
- Two independent symptoms in one session with overlapping surface (both "admin.caleo.id doesn't work") were treated as one bug class.
- Lens-alignment failure: Senior QA lens didn't fire "regression risk in AdminRouteGuard" because I was still in Infra/DB Engineer mode from the pool investigation.
- Advisor was consulted, but AFTER I had committed to the OTP+pool framing. Advisor pointed at pool source (correct for that bug); nobody nudged me to open the routing dimension.

**Prevention (add to CLAUDE.md):**
1. When founder describes a NEW symptom mid-investigation, treat it as an independent bug until PROVEN related. Do not lump.
2. On any "why is X not Y" question about a rendered UI, the first lens check is POST-LOGIN ROUTING + JWT CLAIMS + RLS GATE, not "did the auth flow work". These are different classes.
3. Impersonation state is now part of the "auth-lens checklist": on any admin-visible bug involving a platform admin, `SELECT * FROM platform_admin_active_impersonation WHERE admin_user_id=<founder>` before diagnosing routing.

**Files updated:** `docs/incidents/2026-07-22-otp-and-impersonation-recovery.md`, migration `20261115000508_expire_stale_impersonations_cron.sql`, this miss-log entry.
