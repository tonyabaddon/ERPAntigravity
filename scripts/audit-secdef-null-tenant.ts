// Scan supabase/migrations/*.sql for SECURITY DEFINER functions that INSERT
// into tenant-scoped tables with a hardcoded NULL for tenant_id.
//
// Failure mode this catches (Bug F-18 / F-19 shape):
//   CREATE FUNCTION ... SECURITY DEFINER ...
//   INSERT INTO public.warehouses (tenant_id, code, name, ...)
//     VALUES (NULL, upper(p_code), p_name, ...)
//
// The tenant_id column has DEFAULT public._resolve_tenant_id(), so the fix is
// either drop tenant_id from the column list OR pass _resolve_tenant_id()
// as the value. Hardcoding NULL breaks RLS across all tenants.
//
// Usage: npm run audit:secdef-null-tenant
// Exit 0 = clean, exit 1 = suspicious migrations found (prints them).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
// Any INSERT that lists tenant_id in the column tuple AND uses NULL as the
// value at the tenant_id position. Approximation — a proper AST would be
// safer but this catches the historical shape reliably enough for CI.
const PATTERN = /INSERT\s+INTO\s+(?:public\.)?\w+\s*\([^)]*\btenant_id\b[^)]*\)\s*VALUES\s*\([^)]*\bNULL\b[^)]*\)/i;

// Only care about SECURITY DEFINER context. Cheap check: file also contains
// CREATE (OR REPLACE)? FUNCTION ... SECURITY DEFINER.
const SECDEF_MARKER = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]{0,2000}SECURITY\s+DEFINER/i;

function scanFile(path: string): string[] {
  const body = readFileSync(path, 'utf8');
  if (!SECDEF_MARKER.test(body)) return [];
  const hits: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (PATTERN.test(line)) hits.push(line.trim());
  }
  return hits;
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

const violations: Array<{ file: string; line: string }> = [];
for (const f of files) {
  for (const line of scanFile(join(MIGRATIONS_DIR, f))) {
    violations.push({ file: f, line });
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — scanned ${files.length} migration files, no SECDEF INSERTs with NULL tenant_id`);
  process.exit(0);
}

console.error(`✗ ${violations.length} suspicious SECDEF INSERTs with NULL tenant_id:`);
for (const v of violations) {
  console.error(`  ${v.file}: ${v.line}`);
}
console.error('\nFix: drop tenant_id from the column list (let the DEFAULT _resolve_tenant_id() fire), or set explicitly to _resolve_tenant_id().');
process.exit(1);
