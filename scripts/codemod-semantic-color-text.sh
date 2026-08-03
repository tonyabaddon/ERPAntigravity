#!/usr/bin/env bash
# Semantic color layer text-only codemod (Track A #3 continued).
#
# Collapses medium-to-deep text-{emerald,green,rose} to canonical caleo-*.
#
# Scope:
# - text-emerald-{500,600,650,700,800,900,950} → text-caleo-success
# - text-green-{500,600,700,800,900}          → text-caleo-success
# - text-rose-{500,600,700,800,900}           → text-caleo-danger
#
# Pale variants (100/200/300/400) LEFT ALONE — dark-background contexts
# where canonical semantic tokens would over-emphasize.
#
# Also leaves alone: bg-*, border-* — shade variations carry meaning
# (bg-emerald-50 soft callout vs bg-emerald-500 heavy affirm are distinct).
# Track B module sweeps handle these per-site.
#
# Excludes: *.test.{tsx,ts}, DesignSystemPage.tsx
# Idempotent: safe to re-run.

set -euo pipefail

echo "=== text-emerald + text-green → text-caleo-success ==="
grep -rl 'text-emerald-\(5\|6\|7\|8\|9\)\|text-green-\(5\|6\|7\|8\|9\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' \
  | { while IFS= read -r f; do
      perl -i -pe '
        s/\btext-emerald-500\b/text-caleo-success/g;
        s/\btext-emerald-600\b/text-caleo-success/g;
        s/\btext-emerald-650\b/text-caleo-success/g;
        s/\btext-emerald-700\b/text-caleo-success/g;
        s/\btext-emerald-800\b/text-caleo-success/g;
        s/\btext-emerald-900\b/text-caleo-success/g;
        s/\btext-emerald-950\b/text-caleo-success/g;
        s/\btext-green-500\b/text-caleo-success/g;
        s/\btext-green-600\b/text-caleo-success/g;
        s/\btext-green-700\b/text-caleo-success/g;
        s/\btext-green-800\b/text-caleo-success/g;
        s/\btext-green-900\b/text-caleo-success/g;
      ' "$f"
    done; } || true

echo "=== text-rose-{500..900} → text-caleo-danger ==="
grep -rl 'text-rose-\(5\|6\|7\|8\|9\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' \
  | { while IFS= read -r f; do
      perl -i -pe '
        s/\btext-rose-500\b/text-caleo-danger/g;
        s/\btext-rose-600\b/text-caleo-danger/g;
        s/\btext-rose-700\b/text-caleo-danger/g;
        s/\btext-rose-800\b/text-caleo-danger/g;
        s/\btext-rose-900\b/text-caleo-danger/g;
      ' "$f"
    done; } || true

echo "=== Verification ==="
{ grep -rn 'text-\(emerald\|green\|rose\)-\(5\|6\|7\|8\|9\)' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:' \
  || echo "  (clean — 0 residual)"; } | head -10
