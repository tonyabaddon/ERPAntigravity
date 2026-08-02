#!/usr/bin/env bash
# Typography scale codemod (2026-08-02).
# Per spec: docs/superpowers/specs/2026-08-02-typography-scale-design.md
#
# Converts inline text-[Npx] arbitrary values to canonical tokens:
#   - Non-Tailwind sizes (9/10/11/13/15) → --text-caleo-N tokens (added to index.css)
#   - Tailwind defaults (12/14/16/18/20/24) → text-xs/sm/base/lg/xl/2xl
#   - 8px → caleo-9 (round up, unreadable minimum per font_sizing memory)
#   - 10.5px → caleo-10 (round down, prevent visual weight increase)
#
# Excludes: *.test.{tsx,ts}, *_test.{tsx,ts}, DesignSystemPage.tsx, src/lib/**/pdf/*.ts
# Idempotent: safe to re-run.

set -euo pipefail

echo "=== Typography codemod ==="
grep -rl 'text-\[[0-9]' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts)$|_test\.(tsx|ts)$|DesignSystemPage\.tsx|src/lib/sales/pdf/' \
  | { while IFS= read -r f; do
      perl -i -pe '
        # Standard integer px sizes
        s/\btext-\[8px\]/text-caleo-9/g;
        s/\btext-\[9px\]/text-caleo-9/g;
        s/\btext-\[10px\]/text-caleo-10/g;
        s/\btext-\[11px\]/text-caleo-11/g;
        s/\btext-\[12px\]/text-xs/g;
        s/\btext-\[13px\]/text-caleo-13/g;
        s/\btext-\[14px\]/text-sm/g;
        s/\btext-\[15px\]/text-caleo-15/g;
        s/\btext-\[16px\]/text-base/g;
        s/\btext-\[17px\]/text-lg/g;
        s/\btext-\[18px\]/text-lg/g;
        s/\btext-\[20px\]/text-xl/g;
        s/\btext-\[22px\]/text-2xl/g;
        s/\btext-\[24px\]/text-2xl/g;
        s/\btext-\[26px\]/text-2xl/g;
        s/\btext-\[28px\]/text-3xl/g;
        # Half-pixel sizes (round per direction rules)
        s/\btext-\[8\.5px\]/text-caleo-9/g;
        s/\btext-\[9\.5px\]/text-caleo-10/g;
        s/\btext-\[10\.5px\]/text-caleo-10/g;
        s/\btext-\[11\.5px\]/text-caleo-11/g;
        s/\btext-\[12\.5px\]/text-caleo-13/g;
      ' "$f"
    done; } || true

echo "=== Verification: residual text-[Npx] should be 0 ==="
{ grep -rn 'text-\[[0-9]' src --include='*.tsx' --include='*.ts' \
  | grep -vE '\.test\.(tsx|ts):|_test\.(tsx|ts):|DesignSystemPage\.tsx:|src/lib/sales/pdf/' \
  || echo "  (clean — 0 residual sites)"; } | head -20
