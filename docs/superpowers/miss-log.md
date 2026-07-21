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
