# Per-Module / Per-Scenario Test Plan Template

Copy this to a new file when starting a new session. Format keeps sessions comparable + resumable.

---

## Session N — <scenario or module name>

**Date:** YYYY-MM-DD

**Scope:** which modules / user flows are covered

**Pre-conditions:**
- Tenant impersonation active (or specify JWT identity)
- Seed data required (list customer names, SKU codes, cash account labels, etc.)
- Feature flags on/off

**Test flow (numbered steps):**
1. Navigate to X
2. Click Y
3. Enter Z
4. Verify: <expected observable behavior>

**Data verification (SQL if applicable):**
- After step 4 — expect `orders.status = 'PAYMENT_VERIFIED'`
- After step 6 — expect `journal_entries.entry_number = 'JE-...'` with balanced debit/credit

**Rollback / cleanup:**
- Delete test records via SQL
- Note if not cleaned up (test data lingers)

---

## Findings

For each finding, use format:

### F-1 [🔴 P0 blocker] <short title>

- **Module:** exact screen + tab
- **Reproduction:** minimal steps to trigger
- **Expected:** what should happen
- **Actual:** what happened (paste toast text, error code, wrong number, etc.)
- **Evidence:** MCP snapshot, screenshot path, HTTP status
- **Root cause hypothesis:** (if known)
- **Fix status:** deferred / in-progress / applied in commit `<sha>` / verified

### F-2 [🟠 P1 major] ...

---

## Session outcome

- **Modules verified clean:** list
- **Findings found:** N (breakdown by severity)
- **Fixes applied in session:** commits
- **Follow-ups deferred:** list
- **Next session:** which scenario / module
