# Caleo Design System — Conformance Baseline

**Date:** 2026-08-02
**Purpose:** Measured baseline of design-system drift across the codebase. Every audit locks its current count as maximum; new drift blocks CI. Phase 3 reduces baseline via targeted codemods.

Regenerate: `npm run audit:hardcoded-color-hex; npm run audit:spacing-off-scale; npm run audit:radius-non-canonical; npm run audit:hardcoded-empty-state`.

---

## Overall drift snapshot

| Audit | Baseline | Blocking behavior | Notes |
|---|---|---|---|
| `audit:hardcoded-color-hex` | 1,357 refs / 169 unique colors | Blocks if NEW > baseline | Top: `#e5eeff`(115), `#c7d7f5`(114), `#eff4ff`(97). Legitimate soft-blue palette worth tokenizing. |
| `audit:spacing-off-scale` | 431 refs | Blocks if NEW > baseline | Dominant: `px-5`(246), `p-5`(84). Migrate to `px-4` or `px-6`. |
| `audit:radius-non-canonical` | **0** refs | Blocks any regression | Post-PR #77 (2026-07-31): all radius flat 2px (`rounded-sm`) or semantic `rounded-full`. |
| `audit:hardcoded-empty-state` | 103 files allowlisted | Blocks NEW files with "Belum ada"/"Tidak ada" | Migrate to `<EmptyState />` in Phase 3. |

---

## Drift prioritization (Phase 3 candidates)

### High-impact / Automatable

1. **`#012749` codemod** — 650× inline hex references. Add `--color-caleo-primary: #012749` token, codemod `bg-[#012749]` → `bg-[var(--color-caleo-primary)]`. Semantic no-op. Ships in one PR.
2. **`#e5eeff` + `#c7d7f5` + `#eff4ff` tokenization** — 326 combined refs. Add tokens + codemod.
3. **`px-5` → `px-4`** — 246 refs. Blanket codemod probably safe.

### Medium-impact / Judgment required

4. **`p-5` → `p-4` or `p-6`** — 84 refs. Per-site judgment.
5. **`<EmptyState />` migration** — 103 files. Preserve context (hints, CTAs) per site.

### Low-impact / Deferred

6. Other 60+ minor hex colors, each <20 refs. Skip.

---

## Regeneration workflow

When Phase 3 codemod reduces drift:
1. Run relevant audit — get new count.
2. Update `BASELINE_COUNT` in the audit script.
3. Update this doc.
4. Commit + PR — audit stays green at reduced baseline.

Never raise baseline to accommodate new drift.

---

## What this baseline does NOT measure

- **Semantic correctness** — audit checks classes + hex, not "is this the RIGHT color for this UI element".
- **Cross-screen consistency** — same button in two screens: both may pass if both tokenized.
- **WCAG contrast ratios** — separate scope.
- **Text label consistency** — separate scope.

---

## Related files

- Audit scripts: `scripts/audit-hardcoded-color-hex.ts`, `scripts/audit-spacing-off-scale.ts`, `scripts/audit-radius-non-canonical.ts`, `scripts/audit-hardcoded-empty-state.ts`
- Token catalog: `src/index.css` @theme block
- Design system preview: `npm run build:design-system` → `public/design-system.html`
