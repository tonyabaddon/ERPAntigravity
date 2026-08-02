# Focus-Ring Standardization — Design Spec

**Date:** 2026-08-02
**Status:** Design approved inline; formalizing for SDD execution
**Author:** Claude (autonomous SDD session, on founder approval)
**Blast radius:** ~509 focus:* class-name sites across ~150-200 FE files. Visual change is subtle (mouse-click ring disappears; keyboard-focus ring becomes uniform gold).
**Reversibility:** Reversible / tactical — full revert = revert the PR (single squash commit).

---

## 1. Context

Design system rollout Track A codemod #1. Current state per drift audit:

- **208 sites** with `focus:outline-none` (keyboard-focus removed with paired ring — a11y baseline OK, but see below)
- **509 total `focus:*` refs** across ~150-200 FE files
- **0 sites** using modern `focus-visible:` — every mouse click also flashes the ring (annoying UX for mouse users; correct keyboard-focus behavior missing)
- **Non-brand ring colors mixed with brand:** 19× `indigo-300`, 8× `emerald-500`, 7× `rose-300`, 7× `blue-400`, 5× `orange-300`, 4× `blue-500` — total 50+ non-brand rings vs only 18× `caleo-gold`
- **Reference: `RecordPaymentModal.tsx`** already uses `focus:ring-caleo-gold` — de facto standard, but needs to become `focus-visible:`

## 2. Decision

Codemod all `focus:*` ring/outline classes to `focus-visible:*` with `caleo-gold` as the brand-canonical ring color. Add a global `:focus-visible` CSS fallback in `src/index.css` for interactive elements without explicit rings. Ship an absolute-baseline audit + Stop hook wire to prevent regression.

**Canonical pattern (post-codemod):**
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2
```

**Global CSS fallback** (in `src/index.css`, defense-in-depth):
```css
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

## 3. Alternatives considered

### Alternative A: Per-role ring colors (gold for CTAs, navy for inputs, danger for destructive)

Split ring color by element role: gold for primary CTAs, `caleo-primary` (navy) for inputs, `caleo-danger` for destructive buttons.

**Rejected because:**
- Requires per-site judgment (can't be mechanical codemod — must know "is this element a CTA?")
- No clear boundary between button types in current codebase
- Founder's earlier design conversation locked in single-canonical `caleo-gold` for simplicity + parity with shipped `RecordPaymentModal`
- Split-by-role can be added as v2 refinement without breaking this PR

### Alternative B: Keep `focus:` (don't switch to `focus-visible:`)

Preserve current behavior — ring appears on both mouse click and keyboard Tab.

**Rejected because:**
- Every mouse click flashes the ring (annoying UX)
- Modern best practice is `focus-visible:` (WCAG-aligned)
- Browser support baseline since ~2021 (all target browsers safe)
- Codemod cost is same either way (mechanical prefix swap)

### Alternative C: No global CSS fallback (rely only on per-site classes)

Skip the `:focus-visible` global rule in `src/index.css`. Every focusable element must declare its own ring via Tailwind class.

**Rejected because:**
- Custom `role="button"` divs, third-party components, and `[tabindex]` elements often lack explicit ring classes
- Global fallback catches missing-ring bugs invisibly (defense-in-depth)
- Global rule is 8 lines; cost is trivial

## 4. Consequences

### Positive
- Uniform brand-gold focus indicator on keyboard nav across every module
- Mouse click no longer flashes ring (cleaner UX for pointing-device users)
- Third-party + custom-role elements get consistent focus visual via global fallback
- Audit prevents drift regression (baseline zero, absolute)

### Negative
- Snapshot tests will diff (~200 test files affected by className changes) — regenerate as part of PR
- If a rare CTA needs a different ring color (e.g., dark-background), it needs explicit `focus-visible:ring-<other>` override (audit allows brand colors only)
- Visual gate must catch any subtle regression on gold-on-gold or thin-input contexts

### Blast radius
- Class-string rewrites in ~150-200 FE files
- One new CSS rule set in `src/index.css`
- One new audit script + Stop hook wire
- One miss-log entry (class-fix pattern per CLAUDE.md 3+ occurrence rule — this is the semantic-drift/consistency class of finding)

## 5. Scale-ceiling check

Process spec-adjacent, but standard 6-question check:

1. **Ceiling at 10× scale:** Focus-visible support baseline since 2021, browsers unchanged. Design ceiling is not the constraint — visual review is.
2. **Hot path:** N/A — this is CSS/HTML, no query pattern involved.
3. **Partition-ready:** N/A.
4. **Idempotent:** codemod is idempotent (re-running produces same output — the audit blocks new drift).
5. **Long ops:** codemod runs in seconds; no runtime long-ops.
6. **Cost curve:** zero infra cost.

## 6. Architecture

### 6.1 Codemod substitutions

Applied via `perl -i -pe` across `src/**/*.{tsx,ts}` (excluding `_test.tsx`, `_test.ts`, `.test.tsx`, `.test.ts`, and `DesignSystemPage.tsx`):

| Before | After |
|---|---|
| `focus:outline-none` | `focus-visible:outline-none` |
| `focus:ring-2` | `focus-visible:ring-2` |
| `focus:ring-1` | `focus-visible:ring-1` |
| `focus:ring-0` | `focus-visible:ring-0` |
| `focus:ring-caleo-gold` | `focus-visible:ring-caleo-gold` (modifier swap, color unchanged) |
| `focus:ring-caleo-primary` | `focus-visible:ring-caleo-primary` (rare; preserve semantic if present) |
| `focus:ring-caleo-danger` | `focus-visible:ring-caleo-danger` (preserve semantic if present) |
| `focus:ring-(indigo\|emerald\|blue\|rose\|orange\|violet\|pink\|slate\|zinc\|gray\|neutral\|stone\|sky\|cyan\|teal\|lime\|yellow\|amber\|fuchsia\|purple\|red\|green)-\d+` | `focus-visible:ring-caleo-gold` (brand default) |

**Two-pass codemod (mechanical, no per-site judgment):**
1. **Pass 1** — all substitutions in the table above → convert every `focus:*` and non-brand color to `focus-visible:ring-caleo-gold` per the table.
2. **Pass 2** — mechanical semantic-danger sweep: find every line matching BOTH `focus-visible:ring-caleo-gold` AND (`bg-caleo-danger` OR `border-caleo-danger`), swap `caleo-gold` → `caleo-danger` on those specific lines only.

Both passes ship in the same codemod script within the same commit. The audit allowlists `focus-visible:ring-caleo-danger` when accompanied by `bg-caleo-danger`/`border-caleo-danger` in the same class list.

### 6.2 Global CSS fallback

Add to `src/index.css` inside `@layer utilities` (or as a top-level rule after `@theme`):

```css
/* Focus-visible standardization — keyboard-focus only (mouse click stays quiet).
   Site-specific focus-visible:ring-* classes still win via higher specificity.
   Global fallback is a safety net for interactive elements without explicit rings
   (custom [role="button"] divs, third-party components, [tabindex] elements). */
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

### 6.3 Audit — `scripts/audit-focus-ring-drift.ts`

Baseline 0 absolute (same shape as `audit:radius-non-canonical`). Bans:
- Any `\bfocus:` prefix combined with `ring-` or `outline-` in same class string — must be `focus-visible:`.
- Any non-brand ring color: `focus-visible:ring-(?!caleo-)[a-z]+-\d+`.

**Allowlist:** `src/components/designSystem/DesignSystemPage.tsx` (preview intentionally shows anti-patterns for illustration).

**Wire to `.claude/settings.json` Stop hook** as 12th audit in chain. Failure message: `"audit:focus-ring-drift — focus:* classes or non-brand ring colors sneaked in; use focus-visible:ring-caleo-gold (or caleo-danger for semantic danger). Global :focus-visible fallback in src/index.css covers elements without explicit rings."`.

### 6.4 Design-system preview

Add a "Focus states" subsection in `src/components/designSystem/DesignSystemPage.tsx` illustrating:
- Default focus-visible ring on button (gold, 2px, 2px offset)
- Danger button focus (red, when we ship semantic-color layer PR)
- Input focus
- Mouse-click behavior (no ring) vs Tab behavior (gold ring) — annotated

### 6.5 Visual-diff gate consumption

**This is the first real consumer of the visual-diff tool (PR #92).** Per CLAUDE.md `## Protocol: Visual approval gate (FE PRs)`:

1. Implement branch (codemod + CSS + audit + Stop hook wire)
2. Take baseline screenshots via chrome-devtools MCP against `https://app.caleo.id` as Toko Jaya Makmur (config's Track A sample: dashboard, kasir, penjualan, laporan, designSystemPreview)
3. Take candidate screenshots (branch tag URL OR local `npm run dev`)
4. Save pairs to `public/visual-diff/focus-ring-standardization/{before,after}/`
5. Write manifest per spec §6.2 schema
6. `npm run visual-diff:build -- --manifest=public/visual-diff/focus-ring-standardization/manifest.json`
7. Present `public/visual-diff-focus-ring-standardization.html` in chat
8. Wait for founder "go" before opening PR + merging + promoting

**Mouse-click vs Tab-key visual difference:** for a fair before/after screenshot comparison, take BOTH:
- Before: click a button, screenshot showing old blue/gold ring flash
- After: click same button, screenshot showing NO ring (correct focus-visible behavior)
- Before: Tab to button, screenshot old ring
- After: Tab to same button, screenshot new uniform gold ring

### 6.6 Snapshot test regeneration + route sanity

Two easy-miss steps the plan MUST include (per advisor):

- **Snapshot regeneration:** after codemod, run `npx vitest run -u` once to accept the mechanical className diffs on ~200 snapshot files. Skipping this = Stop hook blocks merge + 20-min debugging tax.
- **Visual-diff config route sanity:** before running MCP screenshots, verify every path in `.claude/visual-diff.config.json` matches an actual React Router route (`grep -rn 'path='` in `src/App.tsx` or equivalent router config). A 404 path silently screenshots an error page and passes the visual gate for the wrong reason.

## 7. Follow-up work

Tasks spawned by this spec:

1. **This spec's implementation plan** — writing-plans skill dispatches next
2. **Semantic-color layer PR** (deferred, next in queue after focus-ring) — will preserve `focus-visible:ring-caleo-danger` on danger-role buttons (spec §6.1 special case)
3. **Per-module sweeps** (Track B) — as each module gets swept, verify focus-ring compliance is preserved and add module screens to `.claude/visual-diff.config.json`
4. **Design-system preview enhancement** — add "Focus states" subsection (Task within this plan or split into follow-up)

## 8. Success criteria

- `npm run audit:focus-ring-drift` = 0 sites (absolute baseline)
- All keyboard-focus paths in Dashboard, Kasir, Penjualan, Laporan, Pembelian, Admin show consistent gold ring
- Mouse click no longer flashes ring on any button/input/link
- Visual-diff report shows semantic-equivalent layout on all sampled screens
- Snapshot tests regenerated (mechanical className diff — not a real regression)

## 9. Miss-log alignment

This spec exercises the visual-approval gate for the first time (validation of PR #92's usefulness). Any missed regression caught by the gate = validation win. Any regression that slips past gate → miss-log entry with prevention rule.

## 10. I verified

- **[VERIFIED]** Drift counts via live grep: 208 `focus:outline-none`, 168 `focus:ring-2`, 50+ non-brand ring colors, 0 `focus-visible:` — matches earlier analysis
- **[VERIFIED]** `RecordPaymentModal.tsx` uses `focus:ring-caleo-gold` — 5 sites — de facto standard identified
- **[VERIFIED]** `--color-caleo-gold` token exists in `src/index.css` — `#F9B233`
- **[VERIFIED]** Visual-diff tool available (`npm run visual-diff:build` works, per PR #92)
- **[REASONED]** Global `:focus-visible` CSS specificity behaves as documented (Tailwind arbitrary classes win)
- **[REASONED]** Snapshot test count ~200 files affected — will regenerate mechanically
- **[ASSUMED]** MCP chrome-devtools availability during visual-diff step — fallback to `npm run dev` if browser profile locked

## 11. Adversarial critique

- **Q: Global `:focus-visible` rule clashes with existing per-site rings?** A: No — Tailwind utilities win via specificity. Global is safety net.
- **Q: Gold-on-gold background = invisible ring?** A: Verified: no button uses `bg-caleo-gold` in current codebase. Zero sites at risk.
- **Q: Snapshot tests will explode?** A: Yes, mechanically. Regenerate as part of PR (documented in plan).
- **Q: `outline-offset: 2px` clash with dense inputs (Excel-style tables)?** A: Watch during MCP screenshot walk. If problematic, drop to `1px` or use `box-shadow` inset.
- **Q: What about legit `focus:ring-caleo-gold` (18 sites already correct)?** A: Codemod converts modifier `focus:` → `focus-visible:` — color unchanged. Preserves semantic.
- **Q: Third-party (sonner, react-query) styles clash?** A: They own their focus. Global rule falls back only when they don't declare — safe.
- **Q: What if the PR introduces regression on a screen we didn't screenshot?** A: Track A sample covers 5 top-traffic screens (Dashboard, Kasir, Penjualan, Laporan, designSystemPreview). If sample looks identical, mechanical codemod is high-confidence for other screens. Follow-up Track B module sweeps re-verify per module.
- **Q: Focus behavior on iOS Safari or mobile?** A: `:focus-visible` supported. Touch input doesn't fire focus per spec — no impact. Verify during mobile-view MCP screenshot if any target module.

## 12. Timeline

- **Spec:** written 2026-08-02, awaiting advisor call + founder approval
- **Plan:** writing-plans dispatches next after spec approval
- **Implementation:** 1 SDD session (~2-3h); codemod + tests + audit + Stop hook wire
- **Visual-diff gate:** 20-30 min for MCP screenshots + founder review
- **Merge + no promote** (or promote if founder wants next-morning verification): per Stage 1-2-3 flow
- **First cross-cutting Track A codemod complete** → moves rollout to typography (next in queue)
