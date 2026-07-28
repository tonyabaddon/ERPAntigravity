// One-shot codemod: replace `err instanceof Error ? err.message : String(err)`
// with `extractErrorMessage(err)` across src/, and add the import if missing.
//
// Idempotent: safe to re-run (the pattern won't match after replacement).
// Skips: src/lib/extractErrorMessage.ts, *.test.*
//
// Usage: npx tsx scripts/codemod-string-err-fallback.ts [--dry]

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');

// Match `<ident> instanceof Error ? <same>.message : String(<same>)` with the
// same identifier in all three slots (defensive — different idents would be a
// bug worth surfacing rather than silently rewriting).
const PATTERN = /(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\1\)/g;

const EXCLUDES = ['src/lib/extractErrorMessage.ts', '.test.'];

function listCandidateFiles(): string[] {
  let raw = '';
  try {
    raw = execSync(
      `grep -rlE 'instanceof Error \\? \\w+\\.message : String\\(\\w+\\)' src --include='*.ts' --include='*.tsx'`,
      { encoding: 'utf8' },
    );
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
  return raw.split('\n').filter(f => f && !EXCLUDES.some(ex => f.includes(ex)));
}

function importPathFrom(fromFile: string): string {
  const targetAbs = path.resolve('src/lib/extractErrorMessage');
  const fromDir = path.dirname(path.resolve(fromFile));
  let rel = path.relative(fromDir, targetAbs);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function ensureImport(source: string, fromFile: string): string {
  if (/import\s*\{[^}]*\bextractErrorMessage\b[^}]*\}\s*from/.test(source)) {
    return source; // already imported
  }
  const importLine = `import { extractErrorMessage } from '${importPathFrom(fromFile)}';\n`;
  // Insert after the last existing top-level `import ... from ...;` line.
  const importRe = /^import\s.+?from\s+['"][^'"]+['"];?$/gm;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) {
    // No existing imports — prepend
    return importLine + source;
  }
  return source.slice(0, lastEnd) + '\n' + importLine.trimEnd() + source.slice(lastEnd);
}

function rewriteFile(file: string): { changed: boolean; count: number } {
  const orig = readFileSync(file, 'utf8');
  let hits = 0;
  const rewritten = orig.replace(PATTERN, (_full, ident) => {
    hits++;
    return `extractErrorMessage(${ident})`;
  });
  if (hits === 0) return { changed: false, count: 0 };
  const withImport = ensureImport(rewritten, file);
  if (!DRY) writeFileSync(file, withImport);
  return { changed: true, count: hits };
}

const files = listCandidateFiles();
if (files.length === 0) {
  console.log('✓ nothing to do — no candidate sites');
  process.exit(0);
}

console.log(`${DRY ? '[dry-run] ' : ''}${files.length} file(s) with the anti-pattern:`);
let total = 0;
for (const f of files) {
  const { count } = rewriteFile(f);
  total += count;
  console.log(`  ${f}: ${count} replacement(s)`);
}
console.log(`\n${DRY ? '[would replace] ' : ''}${total} site(s) across ${files.length} file(s).`);
if (DRY) console.log('Re-run without --dry to apply.');
