// Scan backend-go/ for `slog.Any("error", <var>)` where <var> is anything
// other than `r` (panic recover() value, which is interface{} and cannot
// safely have .Error() called on it).
//
// Why: slog.Any renders errors via reflection and produces `error={}` in
// production logs — completely opaque, breaks observability. The Go
// equivalent of the FE String(err) → "[object Object]" class-error
// (miss-log Entry #5 / audit:no-string-err-fallback).
//
// Fix: replace `slog.Any("error", err)` with
// `slog.String("error", err.Error())`. See PR fix/slog-error-observability.
//
// Usage: npm run audit:slog-any-error
// Exit 0 = clean. Exit 1 = regressions surfaced.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'backend-go';
const RE = /slog\.Any\("error",\s*([a-zA-Z_][a-zA-Z0-9_.]*)\)/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'vendor' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.go$/.test(entry) && !/_test\.go$/.test(entry)) out.push(full);
  }
}

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  varname: string;
  raw: string;
}

const violations: Hit[] = [];
for (const f of files) {
  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(lines[i])) !== null) {
      const varname = m[1];
      // Allow bare `r` — convention for panic recover() value; interface{}
      // so cannot call .Error() on it. slog.Any is the correct choice.
      if (varname === 'r') continue;
      violations.push({ file: f, line: i + 1, varname, raw: lines[i].trim() });
    }
  }
}

if (violations.length === 0) {
  console.log('✓ clean — no slog.Any("error", err) sites (Go equivalent of [object Object] bug)');
  process.exit(0);
}

console.error(`✗ ${violations.length} slog.Any("error", ...) site(s) — renders as "error={}" in prod logs:`);
console.error('');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  var=${v.varname}`);
  console.error(`    ${v.raw}`);
}
console.error('');
console.error('Fix: replace with slog.String("error", <var>.Error())');
console.error('(Guard first if <var> may be nil — this pattern only appears inside `if err != nil` in existing code.)');
process.exit(1);
