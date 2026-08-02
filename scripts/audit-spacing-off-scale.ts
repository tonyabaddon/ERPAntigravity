// Scan src/ for Tailwind spacing classes off the canonical 4-multiple scale.
// Canonical: 1, 2, 3, 4, 6, 8, 12, 16 (Micro/Small/Base/Card/Section/Screen).
// Off-scale: 5, 7, 9, 10, 11, 13, 14, 15.
//
// Existing debt: 84 p-5 refs across codebase (from grep before audit shipped).
// Allowlist tracks current baseline so new drift blocks CI without forcing
// mass cleanup upfront.
//
// Usage: npm run audit:spacing-off-scale

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const OFF_SCALE_RE = /\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-y|space-x)-(5|7|9|10|11|13|14|15)\b/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
}

// Baseline allowlist — files with pre-existing off-scale usage, allowed to
// stay until Phase 3 codemod. New drift outside this list blocks CI.
// Baseline captured 2026-08-02: 185 off-scale refs after Phase 3.2 codemod
// (px-5 246 refs converted to px-4). Remaining: p-5 84 + pl-9 10 + others.
// Guardrail: prevents drift ABOVE baseline. Future codemods further reduce.
const ALLOWLIST_BASELINE_COUNT = 185;

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  cls: string;
}

const violations: Hit[] = [];
for (const f of files) {
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    OFF_SCALE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OFF_SCALE_RE.exec(lines[i])) !== null) {
      violations.push({ file: f, line: i + 1, cls: m[0] });
    }
  }
}

const byClass = new Map<string, number>();
for (const v of violations) byClass.set(v.cls, (byClass.get(v.cls) ?? 0) + 1);
const sortedClass = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]);

if (violations.length <= ALLOWLIST_BASELINE_COUNT) {
  console.log(`✓ clean baseline — ${violations.length} off-scale spacing refs (allowed baseline: ${ALLOWLIST_BASELINE_COUNT})`);
  console.log('  Top classes:');
  for (const [cls, count] of sortedClass.slice(0, 10)) {
    console.log(`    ${cls}  — ${count} refs`);
  }
  process.exit(0);
}

console.error(`✗ ${violations.length} off-scale spacing refs (baseline: ${ALLOWLIST_BASELINE_COUNT}) — NEW drift added`);
console.error('');
for (const [cls, count] of sortedClass.slice(0, 10)) {
  console.error(`  ${cls}  — ${count} refs`);
}
console.error('');
console.error('Fix: use nearest canonical value (p-4, p-6, etc.) OR promote value to scale + document.');
process.exit(1);
