// Fail if any src file uses the `err instanceof Error ? err.message : String(err)`
// pattern. Supabase's PostgrestError is a plain object (not an Error instance),
// so `String(err)` returns "[object Object]" and hides the real message.
//
// Class-error history (per docs/superpowers/miss-log.md #4 + progress.md 2026-07-24):
//   - PinPad → owner PIN approval blocked, shown as "[object Object]"
//   - WarehouseTransferCreateScreen → Kirim / Kirim+PDF blocked, same symptom
//
// Fix: import `extractErrorMessage` from `src/lib/extractErrorMessage.ts` and
// use it in catch blocks. It handles both Error instances AND plain objects
// with a `.message` field (PostgrestError, custom errors, etc.).
//
// Usage: npm run audit:no-string-err-fallback
// Exit 0 = clean, exit 1 = violations printed with file:line.

import { execSync } from 'node:child_process';

// Match: `<ident> instanceof Error ? <same-or-diff-ident>.message : String(<ident>)`
// We keep the ident capture loose because some sites use `e`, `err`, `error`.
// The audit is intentionally aggressive: if the diff to fix has legitimate
// non-object-error handling, migrate to `extractErrorMessage()` which
// already covers Error, PostgrestError, and string throws (returns
// "Unknown error" as last resort).
const PATTERN = String.raw`instanceof Error \? \w+\.message : String\(\w+\)`;

const EXCLUDES = [
  'src/lib/extractErrorMessage.ts', // the helper itself references the shape
  '.test.',                          // test fixtures may intentionally throw plain objects
];

function scan(): Array<{ file: string; line: number; text: string }> {
  let raw = '';
  try {
    raw = execSync(
      `grep -rnE '${PATTERN}' src --include='*.ts' --include='*.tsx'`,
      { encoding: 'utf8' },
    );
  } catch (e) {
    // grep exits 1 when no matches → clean
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const raw_line of raw.split('\n')) {
    if (!raw_line.trim()) continue;
    if (EXCLUDES.some(ex => raw_line.includes(ex))) continue;
    const m = /^([^:]+):(\d+):(.*)$/.exec(raw_line);
    if (!m) continue;
    hits.push({ file: m[1], line: Number(m[2]), text: m[3].trim() });
  }
  return hits;
}

const hits = scan();
if (hits.length === 0) {
  console.log('✓ clean — no `err instanceof Error ? .message : String(err)` fallbacks; use extractErrorMessage()');
  process.exit(0);
}

console.error(`✗ ${hits.length} site(s) still use the [object Object] anti-pattern:`);
console.error(`  Fix: import { extractErrorMessage } from '.../lib/extractErrorMessage';`);
console.error(`       const msg = extractErrorMessage(err);`);
console.error(`  Why: Supabase PostgrestError is a plain object; String(err) → "[object Object]", masking the real message.\n`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}`);
  console.error(`    ${h.text}`);
}
process.exit(1);
