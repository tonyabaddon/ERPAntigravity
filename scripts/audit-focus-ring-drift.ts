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
// Ban only actual ring COLOR utilities (not ring-offset, ring-opacity, or ring-width)
const BAN_NON_BRAND = /\bfocus-visible:ring-(?!caleo-)(?!offset-|opacity-)(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/g;

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
