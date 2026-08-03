#!/usr/bin/env bash
# Semantic color layer partial (Track A #3 conservative subset).
# Collapses medium-to-deep text-red-* → text-caleo-danger.
#
# Scope: text-red-{500,600,700,800,900} — deep reds always mean semantic
# "danger". Pale reds (200/300/400) LEFT ALONE — used on dark backgrounds
# where caleo-danger (#C0392B) would over-emphasize.
#
# Also leaves alone: bg-red-*, border-red-* — shade variations carry meaning
# (light bg-red-50 vs heavy bg-red-500 are visually distinct semantics).
# Track B module sweeps handle these with per-site judgment.
#
# Excludes: *.test.{tsx,ts}, DesignSystemPage.tsx
# Idempotent: safe to re-run.

set -euo pipefail

echo "=== text-red-{500,600,700,800,900} → text-caleo-danger ==="
grep -rl 'text-red-\(5\|6\|7\|8\|9\)00\b' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx' \
  | { while IFS= read -r f; do
      perl -i -pe '
        s/\btext-red-500\b/text-caleo-danger/g;
        s/\btext-red-600\b/text-caleo-danger/g;
        s/\btext-red-700\b/text-caleo-danger/g;
        s/\btext-red-800\b/text-caleo-danger/g;
        s/\btext-red-900\b/text-caleo-danger/g;
      ' "$f"
    done; } || true

echo "=== Verification: residual text-red-{500..900}:"
{ grep -rn 'text-red-\(5\|6\|7\|8\|9\)00\b' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:' \
  || echo "  (clean — 0 residual)"; } | head -10

echo ""
echo "=== Pale text-red kept (200/300/400 for dark-bg contexts):"
grep -c 'text-red-\(2\|3\|4\)00\b' -rE src --include='*.tsx' --include='*.ts' 2>/dev/null | head
