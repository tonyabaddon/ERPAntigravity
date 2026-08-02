// Scan src/ for radius classes other than `rounded` (Tailwind default 4px)
// and `rounded-full`. Post-2026-08-02 v2, all radius unified to 4px
// (`rounded`) or semantic circular (`rounded-full`).
//
// This audit prevents regression to rounded-sm/md/lg/xl/2xl/3xl.
//
// Usage: npm run audit:radius-non-canonical
// Exit 0 = clean (no old radius classes). Exit 1 = regressions surfaced.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const BANNED_RE = /\brounded-(sm|md|lg|xl|2xl|3xl)\b/g;

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
  cls: string;
}

const violations: Hit[] = [];
for (const f of files) {
  // Design system preview intentionally shows historical anti-patterns
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    BANNED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BANNED_RE.exec(lines[i])) !== null) {
      violations.push({ file: f, line: i + 1, cls: m[0] });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — no rounded-sm/md/lg/xl/2xl/3xl (all radius is 'rounded' 4px or rounded-full)`);
  process.exit(0);
}

const byClass = new Map<string, number>();
for (const v of violations) byClass.set(v.cls, (byClass.get(v.cls) ?? 0) + 1);
const sortedClass = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]);

console.error(`✗ ${violations.length} non-canonical radius class(es) — regression from PR3 (2026-08-02):`);
console.error('');
for (const [cls, count] of sortedClass) {
  console.error(`  ${cls}  — ${count} refs`);
}
console.error('');
console.error('Fix: replace with rounded-sm (or rounded-full if semantic circular).');
console.error('First 10 sites:');
for (const v of violations.slice(0, 10)) {
  console.error(`  ${v.file}:${v.line}  ${v.cls}`);
}
process.exit(1);
