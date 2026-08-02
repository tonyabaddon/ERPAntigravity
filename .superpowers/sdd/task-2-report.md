# Task 2 Report: Two-pass codemod + snapshot regen

**Status:** DONE

**Commit:** d5b1a5b — "feat(focus-ring): two-pass codemod — focus:* → focus-visible:ring-caleo-gold (637 sites)"

**Branch:** fix/focus-ring-standardization (base commit de2976e)

---

## Summary

Two-pass focus-ring codemod applied across src/. Script checked in at `scripts/codemod-focus-ring.sh`. Idempotent. Full vitest suite green.

---

## Test summary

**Lint:** `npm run lint` — clean (tsc --noEmit, zero errors)

**Vitest (snapshot regen + full run):**
- `npx vitest run -u` — 134 files passed, 1154 tests passed, 2 skipped. Zero snapshot updates (no snapshot tests cover className attributes in these components).
- `npx vitest run` — 134 files passed, 1154 tests passed, 2 skipped.

**Before/after grep counts:**

| Metric | Before | After |
|---|---|---|
| `focus:outline-none` sites (excl. tests + DesignSystemPage) | 206 | 0 |
| `focus:ring-*` sites (all variants) | ~430 | 0 |
| Total `focus:` ring/outline sites | 637 | 0 |
| `focus-visible:ring-caleo-gold` | 0 | 204 |
| `focus-visible:ring-caleo-danger` | 0 | 1 |
| `focus-visible:outline-none` | 0 | 206 |
| `focus-visible:ring-0` (ring suppressed) | 0 | 11 |

**Defense-in-depth checks:**
- `focus:ring-` lurking (excluding allowed): **(clean)**
- `focus-visible:focus-visible:` double-modifier: **(clean)**
- Idempotency: second run diff vs pre-run state = zero changes (verified via `cp src /tmp && run && diff -rq`)

---

## Script details

`scripts/codemod-focus-ring.sh` implements 3 sub-passes in Pass 1:

- **1a:** Named non-brand Tailwind colors (`indigo|blue|rose|...`) → `focus-visible:ring-caleo-gold`
- **1b:** Word-char ring/outline class names: `focus:(outline-[\w-]+|ring-[\w-]+|ring-\d+)` → `focus-visible:$1`
- **1c (added vs brief):** Arbitrary-value ring patterns `focus:ring-[var(...)]` and `focus:ring-[#hex]/N` → `focus-visible:ring-caleo-gold`. Brief's Pass 1b regex used `[\w-]+` which doesn't match bracket notation. 126 sites had this pattern (CSS var + hex arbitrary values). Regex fix: lookahead `(?=\s|"|'|\`|$)` avoids `\b` (fails after `]` which is non-word char).

**Pass 2:** Lines with `bg-caleo-danger|border-caleo-danger` swap gold → danger. Result: 1 site (semantic-danger button).

**Excludes:** `*.test.{tsx,ts}`, `*_test.{tsx,ts}`, `DesignSystemPage.tsx`

---

## Concerns

1. **`focus:ring-0` (ring suppression) kept as `focus-visible:ring-0`:** These are intentional ring suppressions on hidden/transparent inputs (select arrows, bare text inputs). The modifier swap is correct — they should not show ring on keyboard focus either, and `focus-visible:ring-0` is semantically appropriate (no ring needed for elements without visible interactive affordance). Not a bug.

2. **Checkbox elements (NotificationSettingsScreen, AuthScreen, WhatsappAiScreen):** These had `focus:ring-[#2d8a4e]/20` (very faint ring intended for native checkbox appearance). Step 1c now converts these to `focus-visible:ring-caleo-gold`. This is spec-correct — Task 1's global CSS provides the fallback and these elements will get the canonical gold ring on keyboard focus. Visual regression testing in Task 6 will confirm.

3. **204 gold + 1 danger = 205 ring sites vs 206 outline-none:** The mismatch is expected — some inputs had `focus:outline-none` without a companion `focus:ring-*` (they relied only on outline removal with no ring added). Those are now `focus-visible:outline-none` standalone. Task 1's global CSS fallback covers them.

4. **Snapshot tests:** Zero updates because no vitest snapshot tests capture className attributes of these components. Visual correctness is deferred to Task 6 MCP screenshot workflow.

---

## Files modified

- `scripts/codemod-focus-ring.sh` (new, executable)
- 89 `src/**/*.tsx` files (codemod-applied)

**Report path:** `.superpowers/sdd/task-2-report.md`

---

## Fix report — Pass 3

**Status:** DONE

**Commit:** dc0dab1 — "fix(focus-ring): add Pass 3 — append ring-offset-2 to canonical 4-part"

**Problem:** Task 2 shipped a 3-part canonical pattern (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold`). Spec §2 requires 4-part including `focus-visible:ring-offset-2`. Reviewer flagged the gap.

**Fix:** Added Pass 3 to `scripts/codemod-focus-ring.sh` (script updated from "Two-pass" to "Three-pass" in header). Also fixed a latent `set -euo pipefail` issue where `grep | grep -vE` piped to `while` would exit code 1 when no matches remain (idempotent re-runs would fail); wrapped all grep pipelines in `{ ... || true; }`.

**Before/after ring-offset-2 counts:**

| Metric | Before Pass 3 | After Pass 3 |
|---|---|---|
| `ring-caleo-gold` + `ring-2` + no `ring-offset-` (gap sites) | 153 | 0 |
| `ring-caleo-danger` + `ring-2` + no `ring-offset-` (gap sites) | 1 | 0 |
| `ring-caleo-gold` + `ring-offset-2` (canonical 4-part) | 0 | 153 |
| `ring-caleo-danger` + `ring-offset-2` (canonical 4-part) | 0 | 1 |
| Total `ring-offset-2` sites | 0 | 154 |

**Correctly skipped:**
- 51 gold sites with no `ring-2` (outline-only pattern — offset meaningless without ring)
- 11 `ring-0` sites (ring explicitly suppressed — offset meaningless)
- 1 pre-existing `ring-offset-1` site (`ModuleTogglePanel.tsx`) — no gold/danger, not in scope

**Tests run:**
- `npm run lint` — clean (tsc --noEmit, zero errors)
- `npx vitest run` — 134 files passed, 1154 tests passed, 2 skipped

**Idempotency check:** Second script run diff vs pre-run state = zero changes — `IDEMPOTENT ✓`

**Files modified in this fix:**
- `scripts/codemod-focus-ring.sh` (Pass 3 added, grep pipelines hardened)
- 54 `src/**/*.tsx` files (Pass 3 applied)
