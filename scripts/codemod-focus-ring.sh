#!/usr/bin/env bash
# Three-pass focus-ring codemod (2026-08-02).
# Per spec: docs/superpowers/specs/2026-08-02-focus-ring-standardization-design.md
#
# Pass 1: focus:* + non-brand colors → focus-visible:ring-caleo-gold
# Pass 2: lines with bg/border-caleo-danger → gold swap to caleo-danger
# Pass 3: append focus-visible:ring-offset-2 to complete canonical 4-part pattern
#         (lines with ring-caleo-{gold,danger} + ring-2 but not yet ring-offset-*)
#
# Excludes: *.test.{tsx,ts}, *_test.{tsx,ts}, DesignSystemPage.tsx
# Idempotent: safe to re-run — second run produces zero changes.

set -euo pipefail

echo "=== Pass 1: modifier swap + non-brand color → caleo-gold ==="
{ grep -rl 'focus:\(outline-\|ring-\|ring[0-9]\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' || true; } \
  | while IFS= read -r f; do
      # 1a: non-brand colors → gold (must run BEFORE modifier swap so the
      # non-brand form still starts with `focus:`, not `focus-visible:`)
      perl -i -pe 's/\bfocus:ring-(indigo|emerald|blue|rose|orange|violet|pink|slate|zinc|gray|neutral|stone|sky|cyan|teal|lime|yellow|amber|fuchsia|purple|red|green)-\d+\b/focus-visible:ring-caleo-gold/g' "$f"
      # 1b: modifier swap for all remaining focus: ring/outline classes (word-char names)
      perl -i -pe 's/\bfocus:(outline-[\w-]+|ring-[\w-]+|ring-\d+)\b/focus-visible:$1/g' "$f"
      # 1c: arbitrary-value ring patterns: focus:ring-[...] and focus:ring-[...]/N
      # (CSS var / hex arbitrary values) → focus-visible:ring-caleo-gold
      # These are non-standard per-site color overrides; canonical is caleo-gold.
      # Note: trailing lookahead (?=\s|"|'|`|$) avoids \b which fails after ']' (non-word char).
      perl -i -pe 's/\bfocus:ring-\[[^\]]+\](?:\/\d+)?(?=\s|"|'"'"'|`|$)/focus-visible:ring-caleo-gold/g' "$f"
    done

echo "=== Pass 2: semantic-danger sweep (lines with bg/border-caleo-danger) ==="
{ grep -rl 'focus-visible:ring-caleo-gold' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' || true; } \
  | while IFS= read -r f; do
      perl -i -pe 's/focus-visible:ring-caleo-gold/focus-visible:ring-caleo-danger/g if /(bg-caleo-danger|border-[trblxy]?-?caleo-danger|border-caleo-danger)/' "$f"
    done

echo "=== Pass 3: append ring-offset-2 to complete canonical 4-part pattern ==="
{ grep -rl 'focus-visible:ring-caleo-\(gold\|danger\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' || true; } \
  | while IFS= read -r f; do
      # Only modify lines that have ring-2 (ring is active) AND no ring-offset- yet
      perl -i -pe '
        if (/\bfocus-visible:ring-2\b/ && !/focus-visible:ring-offset-/) {
          s/(focus-visible:ring-caleo-(gold|danger))/$1 focus-visible:ring-offset-2/g;
        }
      ' "$f"
    done

echo "=== Done ==="
echo "Verification: expect zero residual 'focus:(outline|ring)' matches in src/ (excluding DesignSystemPage.tsx):"
grep -rn 'focus:\(outline-\|ring-\|ring[0-9]\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:' \
  || echo "  (clean — 0 residual sites)"
echo "Verification (Pass 3): expect zero lines with ring-caleo-{gold,danger} + ring-2 but no ring-offset:"
{ grep -rn 'focus-visible:ring-caleo-\(gold\|danger\)' src --include='*.tsx' --include='*.ts' \
  | grep 'focus-visible:ring-2' \
  | grep -v 'focus-visible:ring-offset-' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:' \
  || true; } \
  | { grep '' || echo "  (clean — 0 sites missing ring-offset-2)"; }
