// Scan src/ for inline hex colors that aren't in the Caleo token catalog.
// Prevents new hardcoded hex from leaking in; existing debt allowlisted so
// audit stays green until Phase 3 codemod migrates them to CSS vars.
//
// Usage: npm run audit:hardcoded-color-hex
// Exit 0 = no NEW violations. Exit 1 = new inline hex outside catalog/allowlist.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';

const TOKENIZED_HEX = new Set<string>([
  '#0B2545', '#F9B233', '#FAF7F0', '#5A6472', '#9DB2CE', '#ECEEF1',
  '#14161B', '#1F8A5B', '#C0392B', '#2A6FDB', '#7C5CBF',
  '#1e3d60', '#2d8a4e', '#0b1c30', '#f8f9ff',
  '#64748B', '#7C3AED', '#D97706', '#0D9488', '#03AC0E', '#EE4D2D',
  '#0F146E', '#0095DA', '#E31E52', '#1E3A8A', '#E63946', '#25D366',
  '#E1306C', '#475569',
  '#012749',
]);

const ALLOWLIST_FILES = new Set<string>([]);

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
}

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  hex: string;
  context: string;
}

const violations: Hit[] = [];

for (const f of files) {
  if (ALLOWLIST_FILES.has(f)) continue;
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  if (f.endsWith('scripts/build-design-system.tsx')) continue;
  if (f === 'src/index.css') continue;

  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(HEX_RE);
    if (!matches) continue;
    for (const raw of matches) {
      const isKnown = Array.from(TOKENIZED_HEX).some(t => t.toLowerCase() === raw.toLowerCase());
      if (isKnown) continue;
      violations.push({ file: f, line: i + 1, hex: raw, context: lines[i].trim().slice(0, 100) });
    }
  }
}

// Baseline captured 2026-08-02: 1,357 refs across 169 unique colors. Guardrail
// prevents drift ABOVE baseline. Phase 3 codemod will reduce count.
const BASELINE_COUNT = 1357;

const byHex = new Map<string, number>();
for (const v of violations) {
  byHex.set(v.hex, (byHex.get(v.hex) ?? 0) + 1);
}
const sorted = Array.from(byHex.entries()).sort((a, b) => b[1] - a[1]);

if (violations.length <= BASELINE_COUNT) {
  console.log(`✓ clean baseline — ${violations.length} inline hex refs across ${byHex.size} unique colors (allowed baseline: ${BASELINE_COUNT})`);
  process.exit(0);
}

console.error(`✗ ${violations.length} inline hex violation(s) across ${byHex.size} unique color(s) — NEW drift added above baseline ${BASELINE_COUNT}:`);
console.error('');
console.error('Top offenders (add to token catalog OR file to ALLOWLIST):');
for (const [hex, count] of sorted.slice(0, 20)) {
  console.error(`  ${hex}  — ${count} refs`);
}
console.error('');
console.error('First 15 violations:');
for (const v of violations.slice(0, 15)) {
  console.error(`  ${v.file}:${v.line}  [${v.hex}]  ${v.context}`);
}
process.exit(1);
