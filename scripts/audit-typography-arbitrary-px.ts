// Scan src/ for arbitrary text-[Npx] Tailwind classes. Post-2026-08-02
// (Track A #2 typography codemod), all inline text sizes should use canonical
// tokens: --text-caleo-{9,10,11,13,15} for in-between sizes, and Tailwind
// defaults text-xs/sm/base/lg/xl/2xl/3xl for standard sizes.
//
// Baseline zero absolute (same shape as audit:radius-non-canonical).
//
// Allowlist:
// - src/components/designSystem/DesignSystemPage.tsx — preview shows anti-patterns
// - text-[Npx] inside class strings with `material-symbols-outlined` — icon font
//   glyph size, not text size (whitelist noted below)
//
// Per spec: docs/superpowers/specs/2026-08-02-typography-scale-design.md
//
// Usage: npm run audit:typography-arbitrary-px
// Exit 0 = clean. Exit 1 = drift surfaced.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const RE = /text-\[\d+(?:\.\d+)?px\]/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip jsPDF file paths — jspdf uses setFontSize(px), not Tailwind classes
      if (full.endsWith('/lib/sales/pdf')) continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
}

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  match: string;
  context: string;
}

const violations: Hit[] = [];
for (const f of files) {
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(lines[i])) !== null) {
      // Material Symbols glyph sizing — class list contains
      // `material-symbols-outlined` on same line
      if (lines[i].includes('material-symbols-outlined')) continue;
      violations.push({
        file: f,
        line: i + 1,
        match: m[0],
        context: lines[i].trim().slice(0, 80),
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — no arbitrary text-[Npx] sizes`);
  process.exit(0);
}

console.error(`✗ ${violations.length} arbitrary text-[Npx] site(s) — regression from typography scale PR:`);
console.error('');
for (const v of violations.slice(0, 20)) {
  console.error(`  ${v.file}:${v.line}  ${v.match}`);
  console.error(`    ${v.context}`);
}
if (violations.length > 20) {
  console.error(`  ... and ${violations.length - 20} more`);
}
console.error('');
console.error('Fix: use canonical tokens:');
console.error('  9-15px → text-caleo-{9,10,11,13,15} (defined in src/index.css)');
console.error('  12/14/16/18/20/24px → text-xs/sm/base/lg/xl/2xl (Tailwind defaults)');
console.error('  Material Symbols glyph sizing → keep text-[Npx] (auto-allowlisted)');
process.exit(1);
