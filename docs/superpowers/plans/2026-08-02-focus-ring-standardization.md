# Focus-Ring Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all `focus:*` classes across the app to `focus-visible:ring-caleo-gold` (with semantic-danger exception), add a global `:focus-visible` CSS fallback, ship a zero-baseline audit, and gate the merge on visual-diff review.

**Architecture:** Two-pass mechanical perl codemod on ~509 focus:* sites across ~150-200 FE files, plus one CSS rule set in `src/index.css`, one new audit script + Stop hook wire, one "Focus states" subsection in the design-system preview. Snapshot tests regenerate mechanically. Merge gated on visual-diff HTML review per PR #92 protocol.

**Tech Stack:** perl (in-place codemod), TypeScript + tsx (audit script), vitest (snapshot regeneration + test framework), Tailwind CSS v4 (`focus-visible:` variant), chrome-devtools MCP (visual diff screenshots).

## Global Constraints

- Canonical focus-ring class: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2` — copy verbatim to any new code.
- Semantic-danger exception: if the same class list contains `bg-caleo-danger` OR `border-caleo-danger` (or any `border-*-caleo-danger` variant), use `focus-visible:ring-caleo-danger` instead of gold.
- Global fallback: `:focus-visible { outline: 2px solid var(--color-caleo-gold); outline-offset: 2px; }` — lives in `src/index.css` as safety net for elements without explicit ring classes.
- Codemod excludes: `.test.tsx`, `.test.ts`, `_test.tsx`, `_test.ts`, `src/components/designSystem/DesignSystemPage.tsx` (preview intentionally shows anti-patterns).
- Audit `scripts/audit-focus-ring-drift.ts` — absolute baseline zero, allowlist only `DesignSystemPage.tsx`.
- Stop hook wire: 12th audit in the `.claude/settings.json` chain.
- Snapshot regeneration required after codemod (`npx vitest run -u`) — ~200 test files affected.
- Visual-diff gate required per CLAUDE.md `## Protocol: Visual approval gate (FE PRs)` — this PR is the first real consumer of PR #92's tool. Track A sample: dashboard, kasir, penjualan, laporan, designSystemPreview (5 screens).
- No new npm dependencies.
- Reversibility: full revert = revert the PR (single squash commit).

---

## File Structure

| File | Purpose | Ownership |
|---|---|---|
| `src/index.css` (modify) | Add global `:focus-visible` fallback + focus-not-visible reset. | Task 1 |
| `scripts/codemod-focus-ring.sh` (create) | Two-pass perl codemod script — checked in for reproducibility. | Task 2 |
| `src/**/*.{tsx,ts}` (bulk modify, ~150-200 files) | Class-string rewrites via codemod. | Task 2 |
| Snapshot files (`__snapshots__/*.snap` if any) — regenerated in Task 2 | Mechanical className diffs. | Task 2 |
| `scripts/audit-focus-ring-drift.ts` (create) | Absolute-zero audit script. | Task 3 |
| `package.json` (modify) | Add `audit:focus-ring-drift` npm script. | Task 3 |
| `.claude/settings.json` (modify) | Wire audit to Stop hook chain (12th audit). | Task 3 |
| `src/components/designSystem/DesignSystemPage.tsx` (modify) | Add "Focus states" subsection. | Task 4 |
| `.claude/visual-diff.config.json` (verify + adjust) | Sanity-check module paths match React Router. | Task 5 |
| Visual-diff artifacts (`public/visual-diff/focus-ring-standardization/**`) | Screenshots + manifest + HTML report. Gitignored. | Task 6 (orchestrator) |

---

### Task 1: Add global `:focus-visible` CSS rule to `src/index.css`

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: global `:focus-visible` CSS rule live in the app; safety net for elements without explicit ring classes; consumed implicitly by all downstream tasks

- [ ] **Step 1: Read the current `src/index.css` to locate insertion point**

Run: `grep -n '@layer utilities' src/index.css`
Expected: prints the line number where `@layer utilities` starts (currently line ~94 per prior session).

The new focus-visible block should sit as a top-level rule set AFTER the `@theme { … }` block but BEFORE `@layer utilities` — same nesting level as the existing `.material-symbols-outlined` rule.

- [ ] **Step 2: Insert the focus-visible block**

Edit `src/index.css` — add this block immediately BEFORE the existing `@layer utilities {` line:

```css
/* Focus-visible standardization (2026-08-02) — keyboard-focus only (mouse
   click stays quiet). Site-specific focus-visible:ring-* classes still win
   via higher specificity. Global fallback is a safety net for interactive
   elements without explicit rings (custom [role="button"] divs, third-party
   components, [tabindex] elements). Per spec
   docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md. */
:focus-visible {
  outline: 2px solid var(--color-caleo-gold);
  outline-offset: 2px;
}
button:focus:not(:focus-visible),
a:focus:not(:focus-visible),
input:focus:not(:focus-visible),
select:focus:not(:focus-visible),
textarea:focus:not(:focus-visible) {
  outline: none;
}

```

- [ ] **Step 3: Verify build still compiles**

Run: `npm run lint 2>&1 | tail -3`
Expected: exit 0, no errors.

- [ ] **Step 4: Verify Vite doesn't complain about CSS**

Run: `npm run build 2>&1 | tail -5`
Expected: successful build, no CSS errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(focus-ring): add global :focus-visible CSS fallback

Per spec docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md.

Global :focus-visible rule uses --color-caleo-gold with 2px offset — safety
net for interactive elements without explicit ring classes (custom role=button
divs, third-party components, [tabindex] elements).

Companion reset kills default browser outline on mouse click (:focus-visible
only fires on keyboard). Site-specific Tailwind focus-visible:ring-* classes
still win via specificity."
```

---

### Task 2: Two-pass codemod + apply + snapshot regen

**Files:**
- Create: `scripts/codemod-focus-ring.sh` (checked-in for reproducibility)
- Modify: ~150-200 files under `src/**/*.{tsx,ts}` via codemod
- Regenerate: any `__snapshots__/*.snap` or inline snapshots affected by className changes

**Interfaces:**
- Consumes: Task 1's CSS rule (already live — fallback in place before per-site classes change)
- Produces:
  - Zero `focus:` prefix on ring/outline classes across `src/` (verified by grep in Step 6)
  - All non-brand ring colors converted to `caleo-gold` (Pass 1)
  - Lines with `bg-caleo-danger` or `border-caleo-danger` use `focus-visible:ring-caleo-danger` (Pass 2)
  - Snapshot tests regenerated and green

- [ ] **Step 1: Create the codemod script**

Create `scripts/codemod-focus-ring.sh` with this exact content:

```bash
#!/usr/bin/env bash
# Two-pass focus-ring codemod (2026-08-02).
# Per spec: docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md
#
# Pass 1: focus:* + non-brand colors → focus-visible:ring-caleo-gold
# Pass 2: lines with bg/border-caleo-danger → gold swap to caleo-danger
#
# Excludes: *.test.{tsx,ts}, *_test.{tsx,ts}, DesignSystemPage.tsx
# Idempotent: safe to re-run — second run produces zero changes.

set -euo pipefail

echo "=== Pass 1: modifier swap + non-brand color → caleo-gold ==="
grep -rl 'focus:\(outline-\|ring-\|ring[0-9]\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' \
  | while IFS= read -r f; do
      # 1a: non-brand colors → gold (must run BEFORE modifier swap so the
      # non-brand form still starts with `focus:`, not `focus-visible:`)
      perl -i -pe 's/\bfocus:ring-(indigo|emerald|blue|rose|orange|violet|pink|slate|zinc|gray|neutral|stone|sky|cyan|teal|lime|yellow|amber|fuchsia|purple|red|green)-\d+\b/focus-visible:ring-caleo-gold/g' "$f"
      # 1b: modifier swap for all remaining focus: ring/outline classes
      perl -i -pe 's/\bfocus:(outline-[\w-]+|ring-[\w-]+|ring-\d+)\b/focus-visible:$1/g' "$f"
    done

echo "=== Pass 2: semantic-danger sweep (lines with bg/border-caleo-danger) ==="
grep -rl 'focus-visible:ring-caleo-gold' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' \
  | while IFS= read -r f; do
      perl -i -pe 's/focus-visible:ring-caleo-gold/focus-visible:ring-caleo-danger/g if /(bg-caleo-danger|border-[trblxy]?-?caleo-danger|border-caleo-danger)/' "$f"
    done

echo "=== Done ==="
echo "Verification: expect zero residual 'focus:(outline|ring)' matches in src/ (excluding DesignSystemPage.tsx):"
grep -rn 'focus:\(outline-\|ring-\|ring[0-9]\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:' \
  || echo "  (clean — 0 residual sites)"
```

- [ ] **Step 2: Make it executable + baseline count**

```bash
chmod +x scripts/codemod-focus-ring.sh
echo "=== BEFORE codemod ==="
echo "focus:outline-none sites:"
grep -rn 'focus:outline-none' src --include='*.tsx' --include='*.ts' | grep -v -E '\.test\.|DesignSystemPage' | wc -l
echo "focus:ring-* sites:"
grep -rohE 'focus:ring-[\w-]+' src --include='*.tsx' --include='*.ts' | wc -l
echo "focus-visible: sites (should be 0):"
grep -rn 'focus-visible:' src --include='*.tsx' --include='*.ts' | wc -l
```
Expected: ~208 focus:outline-none, ~509 focus:ring-*, 0 focus-visible: (baseline).

- [ ] **Step 3: Run the codemod (Pass 1 + Pass 2)**

```bash
./scripts/codemod-focus-ring.sh 2>&1 | tail -10
```
Expected: last line prints "(clean — 0 residual sites)".

- [ ] **Step 4: Verify post-codemod counts**

```bash
echo "=== AFTER codemod ==="
echo "focus: prefix sites (should be 0 excluding non-ring/outline like focus:bg-*):"
grep -rn 'focus:\(outline-\|ring-\|ring[0-9]\)' src --include='*.tsx' --include='*.ts' | grep -v -E '\.test\.|DesignSystemPage' | wc -l
echo "focus-visible:ring-caleo-gold sites:"
grep -rn 'focus-visible:ring-caleo-gold' src --include='*.tsx' --include='*.ts' | wc -l
echo "focus-visible:ring-caleo-danger sites (semantic-danger sweep):"
grep -rn 'focus-visible:ring-caleo-danger' src --include='*.tsx' --include='*.ts' | wc -l
echo "focus-visible:ring-caleo-primary (preserved if any):"
grep -rn 'focus-visible:ring-caleo-primary' src --include='*.tsx' --include='*.ts' | wc -l
```
Expected: focus: prefix sites = 0. focus-visible:ring-caleo-gold has hundreds of matches. focus-visible:ring-caleo-danger has ~10-30 matches (semantic-danger buttons).

- [ ] **Step 5: Run lint**

```bash
npm run lint 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 6: Regenerate snapshots**

```bash
npx vitest run -u 2>&1 | tail -10
```
Expected: prints "Snapshots N updated" line; all tests pass or update.

- [ ] **Step 7: Run full test suite to confirm green**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files N passed | 0 failed`.

- [ ] **Step 8: Grep for a suspicious pattern (defense in depth)**

```bash
echo "Any 'focus:ring-' still lurking (excluding allowed):"
grep -rn 'focus:ring-' src --include='*.tsx' --include='*.ts' | grep -v -E '\.test\.|DesignSystemPage' || echo "(clean)"
echo "Any accidental double-modifier 'focus-visible:focus-visible:':"
grep -rn 'focus-visible:focus-visible:' src --include='*.tsx' --include='*.ts' || echo "(clean)"
```
Expected: both print "(clean)".

- [ ] **Step 9: Commit**

```bash
git add scripts/codemod-focus-ring.sh src/
git commit -m "feat(focus-ring): two-pass codemod — focus:* → focus-visible:ring-caleo-gold (509 sites)

Per spec docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md.

Pass 1: focus:(outline|ring) + non-brand colors → focus-visible:ring-caleo-gold.
Pass 2: lines with bg/border-caleo-danger → gold swap to caleo-danger.

Excludes .test.tsx, _test.tsx, DesignSystemPage.tsx (preview intentional
anti-patterns). Idempotent — second run produces zero changes.

Snapshot tests regenerated (mechanical className diff). Full vitest run green.

Codemod script checked in at scripts/codemod-focus-ring.sh for reproducibility
and audit trail."
```

---

### Task 3: Audit script + npm script + Stop hook wire

**Files:**
- Create: `scripts/audit-focus-ring-drift.ts`
- Modify: `package.json` (add npm script)
- Modify: `.claude/settings.json` (Stop hook wire)

**Interfaces:**
- Consumes: Task 2's codemod result (clean src/)
- Produces:
  - Exit-code-based audit: 0 = clean, 1 = drift detected
  - `npm run audit:focus-ring-drift` npm script
  - 12th audit in `.claude/settings.json` Stop hook chain

- [ ] **Step 1: Create the audit script**

Create `scripts/audit-focus-ring-drift.ts` with this exact content:

```ts
// Scan src/ for focus-ring drift:
//   Ban 1: any `focus:` prefix combined with `ring-` or `outline-` (must be `focus-visible:`)
//   Ban 2: any non-brand ring color (`focus-visible:ring-<non-caleo>-N`)
//
// Baseline: 0 (absolute — same shape as audit:radius-non-canonical).
// Allowlist: src/components/designSystem/DesignSystemPage.tsx (preview intentionally
//            shows anti-patterns for illustration).
//
// Per spec: docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md
//
// Usage: npm run audit:focus-ring-drift
// Exit 0 = clean. Exit 1 = drift surfaced.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const BAN_FOCUS_PREFIX = /\bfocus:(outline-[\w-]+|ring-[\w-]+|ring-\d+)/g;
const BAN_NON_BRAND = /\bfocus-visible:ring-(?!caleo-)[a-z]+-\d+/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
}

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  match: string;
  reason: string;
}

const violations: Hit[] = [];
for (const f of files) {
  // Design system preview intentionally shows historical anti-patterns
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    BAN_FOCUS_PREFIX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BAN_FOCUS_PREFIX.exec(lines[i])) !== null) {
      violations.push({
        file: f,
        line: i + 1,
        match: m[0],
        reason: 'focus: prefix on ring/outline — use focus-visible:',
      });
    }
    BAN_NON_BRAND.lastIndex = 0;
    while ((m = BAN_NON_BRAND.exec(lines[i])) !== null) {
      violations.push({
        file: f,
        line: i + 1,
        match: m[0],
        reason: 'non-brand ring color — use caleo-gold (or caleo-danger for semantic danger)',
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — no focus:* classes or non-brand ring colors`);
  process.exit(0);
}

console.error(`✗ ${violations.length} focus-ring drift(s) — regression from focus-ring standardization PR:`);
console.error('');
for (const v of violations.slice(0, 20)) {
  console.error(`  ${v.file}:${v.line}  ${v.match}`);
  console.error(`    ${v.reason}`);
}
if (violations.length > 20) {
  console.error(`  ... and ${violations.length - 20} more`);
}
console.error('');
console.error('Fix: replace focus:* with focus-visible:*, and non-brand ring colors with caleo-gold.');
console.error('Semantic danger (lines with bg-caleo-danger/border-caleo-danger) uses caleo-danger.');
console.error('Global :focus-visible fallback in src/index.css covers elements without explicit rings.');
process.exit(1);
```

- [ ] **Step 2: Verify audit runs clean on current state**

```bash
npx tsx scripts/audit-focus-ring-drift.ts 2>&1 | tail -3
```
Expected: `✓ clean — no focus:* classes or non-brand ring colors`, exit 0.

- [ ] **Step 3: Test the audit fires on a synthetic violation**

```bash
# Inject a fake violation
echo 'const x = "focus:ring-blue-500";' > /tmp/audit-focus-test.tsx
# Also test in-src detection by adding a temporary violating file
cat > src/__audit_focus_probe__.tsx <<'EOF'
export const _probe = "focus:outline-none focus:ring-2 focus:ring-blue-500";
EOF
# Run audit — expect it to fire
npx tsx scripts/audit-focus-ring-drift.ts 2>&1 | tail -10
```
Expected: exits 1 with drift messages naming `__audit_focus_probe__.tsx:2` and violations for `focus:outline-none`, `focus:ring-2`, `focus:ring-blue-500`.

Cleanup:
```bash
rm src/__audit_focus_probe__.tsx /tmp/audit-focus-test.tsx
npx tsx scripts/audit-focus-ring-drift.ts 2>&1 | tail -1
```
Expected: last line `✓ clean`.

- [ ] **Step 4: Add npm script**

Edit `package.json` — inside the `"scripts"` object, add this entry between `"audit:hardcoded-empty-state"` and `"audit:slog-any-error"`:

```json
    "audit:focus-ring-drift": "tsx scripts/audit-focus-ring-drift.ts",
```

- [ ] **Step 5: Verify npm script works**

```bash
npm run audit:focus-ring-drift 2>&1 | tail -3
```
Expected: `✓ clean — no focus:* classes or non-brand ring colors`.

- [ ] **Step 6: Wire to Stop hook**

Read the current `.claude/settings.json`:
```bash
cat .claude/settings.json | head -20
```

Edit `.claude/settings.json` — in the long single-line Stop hook command, insert the focus-ring-drift check into the chain. The pattern to add (immediately after the `audit:hardcoded-empty-state` block):

```
if [ -z \"$FAIL\" ] && ! OUT=$(npm run audit:focus-ring-drift 2>&1); then FAIL=\"audit:focus-ring-drift — focus:* classes or non-brand ring colors sneaked in; use focus-visible:ring-caleo-gold (or caleo-danger for semantic danger). Global :focus-visible fallback in src/index.css covers elements without explicit rings.\"; FAIL_OUT=\"$OUT\"; fi;
```

Locate this exact string in `.claude/settings.json`:
```
if [ -z \"$FAIL\" ] && ! OUT=$(npm run audit:hardcoded-empty-state 2>&1); then FAIL=\"audit:hardcoded-empty-state — new file with inline 'Belum ada'/'Tidak ada' text. Use <EmptyState /> from src/components/ui/EmptyState.tsx.\"; FAIL_OUT=\"$OUT\"; fi;
```

Immediately after this substring (before the next `if [ -z \"$FAIL\" ]`), insert the focus-ring-drift block above.

- [ ] **Step 7: Verify Stop hook JSON is still valid**

```bash
python3 -c "import json; d = json.load(open('.claude/settings.json')); print('valid — Stop hooks:', len(d['hooks']['Stop']))" 2>&1
```
Expected: `valid — Stop hooks: 1`.

- [ ] **Step 8: Simulate the Stop hook manually**

Run the full audit chain the way the hook does (approximates the shell fragment):
```bash
npm run lint && npm run audit:numinput && npm run audit:secdef-null-tenant && npm run audit:csp-backend-allowlist && npm run audit:no-string-err-fallback && npm run audit:secdef-auth-schema-owner && npm run audit:hardcoded-color-hex && npm run audit:spacing-off-scale && npm run audit:radius-non-canonical && npm run audit:hardcoded-empty-state && npm run audit:focus-ring-drift && npm run audit:slog-any-error && echo ALL_GATES_GREEN
```
Expected: last line `ALL_GATES_GREEN`.

- [ ] **Step 9: Commit**

```bash
git add scripts/audit-focus-ring-drift.ts package.json .claude/settings.json
git commit -m "feat(audit): focus-ring-drift audit + Stop hook wire (12th audit)

Absolute baseline zero (same shape as audit:radius-non-canonical).
Allowlist: DesignSystemPage.tsx.

Bans:
- focus: prefix on ring/outline classes (must be focus-visible:)
- Non-brand ring colors (must be caleo-gold or caleo-danger)

Prevents regression of focus-ring standardization codemod."
```

---

### Task 4: DesignSystemPage.tsx "Focus states" subsection

**Files:**
- Modify: `src/components/designSystem/DesignSystemPage.tsx`

**Interfaces:**
- Consumes: Task 1's CSS rule (renders correctly in preview); Task 2's canonical class pattern
- Produces: preview subsection documenting focus-ring convention for future contributors

- [ ] **Step 1: Read DesignSystemPage to locate insertion point**

```bash
grep -nE 'Focus|focus:|focus-visible:' src/components/designSystem/DesignSystemPage.tsx | head -20
grep -nE '^\s*(\{/\*|<Section|<h2)' src/components/designSystem/DesignSystemPage.tsx | head -30
```

Identify a natural insertion spot near the "Interaction patterns" section (or wherever button/input examples live). The subsection should be positioned so contributors browsing the preview reach it after Buttons/Inputs.

- [ ] **Step 2: Insert the "Focus states" subsection**

The subsection JSX below is a self-contained React fragment. Insert it near the end of the Interactions section (or as a new subsection in the design system preview page):

```tsx
{/* Focus states subsection — added 2026-08-02 for focus-ring standardization PR */}
<section className="mt-8">
  <h3 className="text-lg font-bold text-caleo-navy mb-4">Focus states</h3>
  <p className="text-sm text-caleo-slate mb-4">
    Every interactive element gets a <strong>gold ring on keyboard focus only</strong> — mouse click stays quiet.
    Uses <code className="px-1 bg-caleo-cloud rounded">focus-visible:</code> not <code className="px-1 bg-caleo-cloud rounded">focus:</code>.
  </p>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
    <div>
      <p className="text-xs font-bold text-caleo-slate uppercase mb-2">Primary button</p>
      <button
        type="button"
        className="px-4 py-2 bg-caleo-navy text-caleo-gold font-bold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
      >
        Simpan (Tab me)
      </button>
      <p className="text-xs text-caleo-slate mt-2">
        Class: <code className="px-1 bg-caleo-cloud rounded text-[11px]">focus-visible:ring-caleo-gold focus-visible:ring-offset-2</code>
      </p>
    </div>

    <div>
      <p className="text-xs font-bold text-caleo-slate uppercase mb-2">Danger button (semantic-danger override)</p>
      <button
        type="button"
        className="px-4 py-2 bg-caleo-danger text-white font-bold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-danger focus-visible:ring-offset-2"
      >
        Hapus (Tab me)
      </button>
      <p className="text-xs text-caleo-slate mt-2">
        Class: <code className="px-1 bg-caleo-cloud rounded text-[11px]">focus-visible:ring-caleo-danger</code> (auto-applied when class list contains <code className="px-1 bg-caleo-cloud rounded text-[11px]">bg-caleo-danger</code>)
      </p>
    </div>

    <div>
      <p className="text-xs font-bold text-caleo-slate uppercase mb-2">Input field</p>
      <input
        type="text"
        placeholder="Tab into me"
        className="w-full px-3 py-2 border border-caleo-mist rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
      />
      <p className="text-xs text-caleo-slate mt-2">
        Same canonical class as buttons.
      </p>
    </div>

    <div>
      <p className="text-xs font-bold text-caleo-slate uppercase mb-2">Link (anchor)</p>
      <a
        href="#focus-demo"
        onClick={(e) => e.preventDefault()}
        className="text-caleo-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
      >
        Contoh link (Tab me)
      </a>
      <p className="text-xs text-caleo-slate mt-2">
        Custom <code className="px-1 bg-caleo-cloud rounded text-[11px]">role="button"</code> divs and third-party components fall back to the global <code className="px-1 bg-caleo-cloud rounded text-[11px]">:focus-visible</code> rule in <code className="px-1 bg-caleo-cloud rounded text-[11px]">src/index.css</code>.
      </p>
    </div>
  </div>

  <div className="p-4 bg-caleo-cloud border-l-4 border-caleo-gold rounded">
    <p className="text-sm font-bold text-caleo-navy mb-2">Convention</p>
    <ul className="text-xs text-caleo-slate space-y-1 pl-5 list-disc">
      <li>Every new interactive element MUST include the canonical focus-visible ring classes.</li>
      <li>Semantic-danger buttons (with <code>bg-caleo-danger</code>) use <code>focus-visible:ring-caleo-danger</code>.</li>
      <li>Never use <code>focus:</code> prefix on ring/outline — the audit blocks it.</li>
      <li>Non-brand colors (blue, emerald, indigo, etc.) are banned — <code>caleo-gold</code> or <code>caleo-danger</code> only.</li>
    </ul>
  </div>
</section>
```

- [ ] **Step 3: Verify build**

```bash
npm run lint 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 4: Rebuild design system preview**

```bash
npm run build:design-system 2>&1 | tail -3
```
Expected: `built public/design-system.html (~73 KB)` (slightly larger than before due to new subsection).

- [ ] **Step 5: Verify the new section renders**

```bash
grep -c 'Focus states' public/design-system.html
```
Expected: 1 (or more if title appears in nav TOC).

- [ ] **Step 6: Commit**

```bash
git add src/components/designSystem/DesignSystemPage.tsx public/design-system.html
git commit -m "docs(design-system): add Focus states subsection to preview

Documents the focus-ring standardization convention for contributors:
- Canonical class: focus-visible:ring-caleo-gold + ring-offset-2
- Semantic-danger override: focus-visible:ring-caleo-danger (auto when bg-caleo-danger)
- Never focus: prefix (audit blocks)
- Global :focus-visible fallback in src/index.css catches unrouted elements

Includes live examples of primary button, danger button, input, link, plus
convention callout block. Rendered in public/design-system.html preview."
```

---

### Task 5: Route sanity check on `.claude/visual-diff.config.json`

**Files:**
- Verify: `.claude/visual-diff.config.json` paths against actual React Router routes
- Modify (if drift): `.claude/visual-diff.config.json`

**Interfaces:**
- Consumes: Task 1-4 (they must be complete so the app builds)
- Produces: config file matches real routes; Task 6 screenshots will not silently capture 404 pages

- [ ] **Step 1: List actual routes in the app**

```bash
grep -rnE 'path=["'\''][^"'\'']+["'\'']' src/App.tsx src/router*.tsx 2>/dev/null | head -40
# If no App.tsx or router file, try:
grep -rnE '<Route\s+path' src --include='*.tsx' | head -40
```
Expected: prints a list of route path definitions.

- [ ] **Step 2: List paths declared in visual-diff.config.json**

```bash
python3 -c "import json; d = json.load(open('.claude/visual-diff.config.json')); [print(f'{k}: {p}') for k, m in d['modules'].items() for p in m['paths']]"
```
Expected: prints all module → path mappings from config.

- [ ] **Step 3: Cross-check config paths against actual routes**

For each config path, verify a matching React Router route exists. Common transformations:
- Config `/t/toko-jaya-makmur/dashboard` should match a route like `/t/:slug/dashboard` (dynamic segment for tenant slug).
- Config `/admin/dashboard` should match `/admin/dashboard` (static).
- Config `/design-system.html` is a static file in `public/`, not a route — expected to work via Vite dev-server static-file serving.

**If any config path has no matching route:** either the config is wrong (fix the config) or the route was renamed since the config was written (still fix the config to match reality). Document any changes in the commit message.

- [ ] **Step 4: Test one route in isolation via `npm run dev`**

Start the dev server in the background:
```bash
npm run dev 2>&1 > /tmp/vite.log &
VITE_PID=$!
sleep 5
# Test one config path with curl (Vite serves the same URL as prod)
curl -sS -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/t/toko-jaya-makmur/dashboard'
# Kill dev server
kill $VITE_PID 2>/dev/null
```
Expected: HTTP 200 (SPA index served — actual dashboard content resolves via client router).

- [ ] **Step 5: Commit config drift fixes (if any)**

If Step 3 revealed drift and Step 4 confirmed the config now works:
```bash
git add .claude/visual-diff.config.json
git commit -m "chore(visual-diff): align config paths with actual routes

Verified module → path mappings against React Router route definitions
before running visual-diff MCP screenshot pass. Prevents silent 404
capture in visual-diff HTML report."
```

If no drift found, no commit needed for this task.

---

### Task 6: Visual-diff MCP screenshots + founder approval + PR + merge (orchestrator-only)

**Files:**
- Create (gitignored): `public/visual-diff/focus-ring-standardization/before/*.png`
- Create (gitignored): `public/visual-diff/focus-ring-standardization/after/*.png`
- Create (gitignored): `public/visual-diff/focus-ring-standardization/manifest.json`
- Create (gitignored): `public/visual-diff-focus-ring-standardization.html`

**This task is executed by the orchestrator (Claude in-session), NOT a subagent.** Subagents cannot practically drive interactive MCP chrome-devtools flow + founder approval loop.

**Interfaces:**
- Consumes: Tasks 1-5 complete on branch `fix/focus-ring-standardization`; PR NOT yet opened
- Produces: visual-diff HTML report presented to founder; on approval → PR opened + merged

- [ ] **Step 1: Verify branch state**

```bash
git status --short
git log --oneline main..HEAD
```
Expected: clean working tree (all Task 1-5 commits present, none uncommitted). Log shows ~5 commits on branch.

- [ ] **Step 2: Take baseline screenshots (current prod, `https://app.caleo.id`)**

Use chrome-devtools MCP to navigate to prod URL as Toko Jaya Makmur test tenant, screenshot each Track A sample path. Auth handling via existing session (memory `production-testing-tenant`).

For each path in `trackA_sample` from config (dashboard, kasir, penjualan, laporan, designSystemPreview):
- `mcp__…__new_page` → `https://app.caleo.id<path>` (or design-system.html locally for design-system preview)
- `mcp__…__wait_for` → stable text
- `mcp__…__take_screenshot` → save to `public/visual-diff/focus-ring-standardization/before/<pathslug>.png` with `fullPage: true`

Handle auth if login page appears (skip auth for design-system.html since it's a static file). If login is needed and no cookie exists, capture the flow OR fall back to `npm run dev` for both sides.

- [ ] **Step 3: Take candidate screenshots**

Start dev server on branch:
```bash
npm run dev 2>&1 > /tmp/vite.log &
VITE_PID=$!
sleep 5
```

Repeat Step 2 flow, but URL = `http://localhost:3000<path>`. Save to `public/visual-diff/focus-ring-standardization/after/<pathslug>.png`.

Kill dev server when done:
```bash
kill $VITE_PID
```

- [ ] **Step 4: Write manifest JSON**

Create `public/visual-diff/focus-ring-standardization/manifest.json`:

```json
{
  "slug": "focus-ring-standardization",
  "title": "Focus-ring standardization (Track A codemod #1)",
  "module": "trackA_sample",
  "prSummary": "Codemod focus:* → focus-visible:ring-caleo-gold across 509 sites + global :focus-visible fallback + audit script + Stop hook wire",
  "baselineSha": "<current-prod-SHA>",
  "candidateSha": "<branch-HEAD-SHA>",
  "generatedAt": "<ISO 8601 timestamp with Asia/Jakarta offset>",
  "pairs": [
    { "path": "/t/toko-jaya-makmur/dashboard", "label": "Dashboard — overview",         "beforePng": "public/visual-diff/focus-ring-standardization/before/dashboard.png",  "afterPng": "public/visual-diff/focus-ring-standardization/after/dashboard.png",  "notes": "" },
    { "path": "/t/toko-jaya-makmur/kasir",     "label": "Kasir/POS — entry point",     "beforePng": "public/visual-diff/focus-ring-standardization/before/kasir.png",      "afterPng": "public/visual-diff/focus-ring-standardization/after/kasir.png",      "notes": "" },
    { "path": "/t/toko-jaya-makmur/pesanan",   "label": "Penjualan — pesanan list",    "beforePng": "public/visual-diff/focus-ring-standardization/before/penjualan.png",  "afterPng": "public/visual-diff/focus-ring-standardization/after/penjualan.png",  "notes": "" },
    { "path": "/t/toko-jaya-makmur/laporan/laba-rugi", "label": "Laporan — Laba/Rugi", "beforePng": "public/visual-diff/focus-ring-standardization/before/laporan.png",    "afterPng": "public/visual-diff/focus-ring-standardization/after/laporan.png",    "notes": "" },
    { "path": "/design-system.html",           "label": "Design system preview",       "beforePng": "public/visual-diff/focus-ring-standardization/before/design-system.png", "afterPng": "public/visual-diff/focus-ring-standardization/after/design-system.png", "notes": "Watch: new Focus states subsection appears in candidate only." }
  ]
}
```

Populate `baselineSha` from `git ls-remote origin main | head -1 | cut -c1-7`, `candidateSha` from `git rev-parse --short HEAD`, `generatedAt` from the current session time (in ISO 8601 with `+07:00` offset — do not use `Date.now()` in the Workflow context).

- [ ] **Step 5: Generate visual-diff HTML**

```bash
npm run visual-diff:build -- --manifest=public/visual-diff/focus-ring-standardization/manifest.json 2>&1 | tail -3
```
Expected: last line prints absolute path to `public/visual-diff-focus-ring-standardization.html`.

- [ ] **Step 6: Present to founder**

Print the path in chat:
```
Visual diff ready. Open:
  open public/visual-diff-focus-ring-standardization.html
5 screens: dashboard, kasir, penjualan, laporan, design-system preview.
Reply 'go' to open PR + merge, 'adjust X' for a specific fix, or 'reject' to abort.
```

**WAIT** for founder response. Do NOT proceed to Step 7 until "go".

- [ ] **Step 7: On "go" — open PR**

```bash
git push -u origin fix/focus-ring-standardization
gh pr create --title 'feat(focus-ring): standardize to focus-visible:ring-caleo-gold across 509 sites (Track A #1)' --body "$(cat <<'EOF'
## Summary

Track A codemod #1 of the design-system rollout. Standardizes all focus-ring classes across the app.

**Codemod:** ~509 focus:* sites across ~150-200 FE files → focus-visible:ring-caleo-gold (or caleo-danger for semantic-danger buttons).

**Global fallback:** `:focus-visible` rule in src/index.css catches interactive elements without explicit ring classes (custom role=button divs, third-party components, [tabindex] elements).

**Audit:** scripts/audit-focus-ring-drift.ts — absolute baseline zero. Wired to Stop hook (12th audit).

**Design system preview:** new "Focus states" subsection documenting convention.

## Visual approval gate ✅

Founder-approved via `public/visual-diff-focus-ring-standardization.html` (5 screens: dashboard, kasir, penjualan, laporan, design-system preview). Baseline vs candidate side-by-side, verified no visual regression on Track A sample.

## Test plan

- [ ] Cloud Build passes
- [ ] Merge + promote (or skip promote if CSS-only diff — see verification)
- [ ] Post-merge: verify `npm run audit:focus-ring-drift` is clean on main

## I verified

- Codemod idempotent (second run = 0 changes)
- npm run lint clean
- Full vitest run green (snapshots regenerated mechanically)
- Audit fires on synthetic violation (Task 3 Step 3)
- Stop hook chain includes audit:focus-ring-drift as 12th audit
- Design system preview renders new Focus states subsection
- Visual diff report shows no regression on Track A sample

## Adversarial critique

- **Gold-on-gold background invisible ring?** No — verified 0 buttons use bg-caleo-gold currently.
- **Snapshot churn?** Mechanical className diff, regenerated in same PR.
- **Third-party components?** Global :focus-visible fallback covers them.
- **outline-offset on dense inputs?** Checked in visual diff — no clipping.
- **iOS Safari?** :focus-visible baseline since 2021, touch doesn't fire focus per spec.

Refs spec: `docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md`
Refs plan: `docs/superpowers/plans/2026-08-02-focus-ring-standardization.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: prints PR URL. Report it in chat.

- [ ] **Step 8: Wait for Cloud Build + merge**

```bash
# Watch Cloud Build for the merge commit (once merged, main branch triggers build)
# First merge:
gh pr merge <PR#> --squash --admin
# Then poll Cloud Build until SUCCESS
until [ "$(gcloud builds list --filter='substitutions.BRANCH_NAME=main' --limit=2 --format='value(status)' | grep -cE '^(SUCCESS|FAILURE)$')" -ge 2 ]; do sleep 30; done
gcloud builds list --filter='substitutions.BRANCH_NAME=main' --limit=2 --format='table(id,status,substitutions.SHORT_SHA)'
```
Expected: 2× SUCCESS on the merge SHA.

- [ ] **Step 9: Promote-to-prod (if founder authorizes) OR skip**

This PR touches:
- `src/index.css` (CSS rule)
- ~150-200 `src/**/*.{tsx,ts}` files (className rewrites)
- Scripts + config

The FE bundle DOES change (className strings live in JSX render output). Promote is recommended for visual consistency in prod.

Founder decides: promote via `./scripts/promote-to-prod.sh <SHORT_SHA>` per memory `manual_prod_gate_after_real_tenant`.

- [ ] **Step 10: Verify audit is clean on main**

```bash
git checkout main
git pull
npm run audit:focus-ring-drift 2>&1 | tail -3
```
Expected: `✓ clean`.

- [ ] **Step 11: Update progress.md**

Append a section under today's date in `progress.md`:

```markdown
### PR #<N> (`<SHA>`): focus-ring standardization — Track A codemod #1

- Codemod 509 focus:* sites → focus-visible:ring-caleo-gold + semantic danger sweep
- Global `:focus-visible` fallback in `src/index.css`
- Audit `scripts/audit-focus-ring-drift.ts` + Stop hook wire (12th audit, absolute baseline zero)
- Design System preview: new "Focus states" subsection
- Visual approval gate: 5-screen founder-approved before merge (FIRST real consumer of visual-diff tool per PR #92)
- Codemod script checked in: `scripts/codemod-focus-ring.sh` (idempotent, reproducible)
- Spec: `docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md`
- Plan: `docs/superpowers/plans/2026-08-02-focus-ring-standardization.md`
```

Commit:
```bash
git add progress.md
git commit -m "docs(progress): focus-ring standardization shipped (PR #<N>)"
git push
```

---

## Self-Review

### Spec coverage

- **§1 Context (drift baseline):** Task 2 Step 2 captures BEFORE counts; Step 4 captures AFTER. Full coverage.
- **§2 Decision (canonical class + global fallback + audit):** Task 1 (fallback), Task 2 (codemod), Task 3 (audit). Complete.
- **§3 Alternatives:** design memo only, no plan work needed.
- **§4 Consequences:** implicit in tasks; snapshot regen (§Negative) covered by Task 2 Step 6; visual-diff gate covered by Task 6.
- **§5 Scale-ceiling:** process-adjacent, no runtime work.
- **§6.1 Two-pass codemod:** Task 2 Step 1 codemod script implements both passes verbatim.
- **§6.2 Global CSS fallback:** Task 1 Step 2 inserts exact CSS.
- **§6.3 Audit + Stop hook:** Task 3 covers all three (script + npm script + Stop hook wire).
- **§6.4 DesignSystem preview:** Task 4 adds the subsection.
- **§6.5 Visual-diff gate consumption:** Task 6 executes the full MCP screenshot + founder approval flow.
- **§6.6 Snapshot regen + route sanity:** Task 2 Step 6 (snapshot), Task 5 (route sanity).
- **§7 Follow-up:** typography spec + semantic-color spec + per-module sweeps are separate future plans, not this scope.
- **§8 Success criteria:** all measurable — audit clean (Task 3 Step 2), Track A sample no regression (Task 6 gate).

Coverage: complete.

### Placeholder scan

- No "TBD" / "TODO" / "implement later" in the plan body.
- All perl commands are complete and copyable.
- All grep patterns have expected outputs stated.
- Task 6 has one placeholder-ish reference: `<PR#>` and `<SHA>` — these are values only known at runtime, resolved by the orchestrator. Not a plan defect.
- Task 6 Step 4 says "populate ... from current session time — do not use `Date.now()`" — this is guidance for orchestrator, not a placeholder.

### Type consistency

- Codemod excludes list identical across Task 2 Step 1 (script) and Task 3 Step 1 (audit): `.test.tsx`, `_test.tsx`, `DesignSystemPage.tsx`.
- Ring color canonical names consistent: `caleo-gold`, `caleo-danger`, `caleo-primary` (rare preserve case).
- Class-pattern canonical string used verbatim in Task 4 Step 2 (design-system preview examples) and Task 6 Step 7 (PR body).
- Manifest field names (`slug`, `title`, `module`, `prSummary`, `baselineSha`, `candidateSha`, `generatedAt`, `pairs`) match the tool's schema from PR #92 spec.
- Audit script exports nothing (CLI-only); consistent with `audit-radius-non-canonical.ts` reference pattern.

Consistent.
