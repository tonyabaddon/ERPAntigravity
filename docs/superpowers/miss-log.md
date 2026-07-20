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
