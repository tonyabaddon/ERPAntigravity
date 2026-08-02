# Typography Scale — Design Spec

**Date:** 2026-08-02
**Status:** Autonomous execution mandate (founder away 12h)
**Blast radius:** ~2125 inline `text-[Npx]` sites across ~200-300 FE files. Semantic-equivalent codemod — resting-state visual identical.
**Reversibility:** Reversible / tactical — full revert via git revert.

---

## 1. Context

Track A codemod #2 of design-system rollout. Current state: **2125+ inline `text-[Npx]` arbitrary values** vs 0 canonical tokens. Tailwind defaults cover 12/14/16/18/20/24 but the "in-between" sizes (9/10/11/13/15) are inline arbitrary values with no token. Per memory `font_sizing`: base 13-14px UI, 11-12px PDF — these are load-bearing sizes.

## 2. Decision

Add 5 numeric-px tokens (`--text-caleo-9`, `-10`, `-11`, `-13`, `-15`) in `src/index.css` `@theme` block. Codemod all inline `text-[Npx]` → tokens (or Tailwind defaults for 12/14/16/18/20/24). Add absolute-zero audit + Stop hook wire.

Numeric-px shape chosen per founder approval earlier this session (semantic aliases like `caption/body/heading` deferred to v2).

## 3. Substitution table

| Before | After | Refs (baseline) |
|---|---|---|
| `text-[8px]`  | `text-caleo-9` (round up — 8px unreadable per font_sizing memory) | 10 |
| `text-[9px]`  | `text-caleo-9`  | 108 |
| `text-[10px]` | `text-caleo-10` | 429 |
| `text-[10.5px]` | `text-caleo-10` (round down) | 48 |
| `text-[11px]` | `text-caleo-11` | 704 |
| `text-[12px]` | `text-xs` (Tailwind default = 12) | 357 |
| `text-[13px]` | `text-caleo-13` | 408 |
| `text-[14px]` | `text-sm`  | 38 |
| `text-[15px]` | `text-caleo-15` | 14 |
| `text-[16px]` | `text-base` | 9 |
| `text-[18px]` | `text-lg`   | (small) |
| `text-[20px]` | `text-xl`   | (small) |
| `text-[24px]` | `text-2xl`  | (small) |

Total: ~2125 substitutions across ~200-300 files.

## 4. Codemod safety constraints

- Regex strictly `text-\[\d+(\.\d+)?px\]` — MUST NOT touch `text-[var(--...)]` (color) or `text-[#...]` (color hex).
- Skip `src/components/designSystem/DesignSystemPage.tsx` — preview intentionally shows arbitrary sizes.
- Skip `src/lib/**/pdf/*.ts` — jspdf `setFontSize(11)` is a different API. Class regex won't match them anyway, but exclude as defense-in-depth (miss-log Entry #10 lesson).
- Skip `*.test.tsx`, `*.test.ts` — snapshots regenerate mechanically.

## 5. Global CSS additions

Add to `src/index.css` `@theme` block:

```css
/* Caleo typography size tokens (2026-08-02 v1). Fill in-between sizes not
   covered by Tailwind defaults (xs=12, sm=14, base=16, lg=18, xl=20, 2xl=24).
   Font-size only, no line-height binding — matches current text-[Npx] behavior. */
--text-caleo-9:  9px;
--text-caleo-10: 10px;
--text-caleo-11: 11px;
--text-caleo-13: 13px;
--text-caleo-15: 15px;
```

## 6. Audit

`scripts/audit-typography-arbitrary-px.ts` — bans `text-\[\d+(\.\d+)?px\]` pattern with `DesignSystemPage.tsx` allowlist. Absolute baseline zero. Wired to Stop hook.

## 7. Success criteria

- `npm run audit:typography-arbitrary-px` = 0 sites (absolute)
- Full vitest green (mechanical class-string diff, no snapshot updates expected on current suite)
- No jspdf files touched (verified by grep excluding `src/lib/sales/pdf/`)
- Staging visual comparison shows no size regression

## 8. Adversarial critique

- **Will this break jsPDF like PR #83?** No — Tailwind class rewrites in `*.tsx`. jspdf `setFontSize()` is separate API. Regex `\d+(\.\d+)?px` doesn't match CSS vars or hex.
- **Non-token color `text-[var(--color-caleo-primary)]` (300 refs)?** Not touched — regex requires numeric-with-px suffix.
- **Snapshot churn?** Class-string diff — regenerate mechanically.
- **Line-height binding?** Deliberately deferred — keeps parity with current `text-[Npx]` behavior. Add LH tokens in future PR if needed.
- **Rounding 10.5 → 10 vs 11?** Round DOWN — prevents visual weight increase. Consistent with typographic hierarchy conventions.
- **8px → 9px round-up?** 10 sites use 8px. Per font_sizing memory (11-12px PDF minimum), 8px is genuinely unreadable. Rounding up to 9 preserves intent while approaching readable minimum.

## 9. I verified

- Live grep: 2125+ inline `text-[Npx]` refs across 10+ unique sizes
- `--text-caleo-*` naming pattern consistent with existing `--color-caleo-*`, `--radius-caleo-*`, `--shadow-caleo-*` tokens
- Tailwind v4 `@theme` block supports adding font-size tokens as `--text-<name>` (existing precedent in codebase)
- Prior codemod PR (radius, PR #87) proved same regex approach works
- Route sanity + focus-ring PR #93 confirm the tooling flow

## 10. Follow-up

- Track A #3 (semantic color layer) next
- Track B per-module sweeps after all Track A codemods complete
- Line-height + font-family bindings on typography tokens = future refinement
