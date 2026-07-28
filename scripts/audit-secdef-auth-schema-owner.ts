// Scan supabase/migrations/*.sql for SECURITY DEFINER functions that
// reference schema `auth` (auth.uid(), auth.users, auth.jwt(), auth.role())
// AND are owned by `vosi_rpc_owner`. In Supabase-managed Postgres,
// `vosi_rpc_owner` lacks USAGE on schema auth (owned by supabase_auth_admin,
// grants are blocked). Any SECDEF function that hits `auth.*` inside the
// body must be `OWNER TO postgres` (superuser bypass) or the call fails at
// runtime with SQLSTATE 42501 "permission denied for schema auth".
//
// Class-error history (per docs/superpowers/miss-log.md):
//   - Entry #4 (2026-07-24): migration 000514 reverted 22 functions,
//     migration 000519 reverted 10 more — PIN approval, warehouse admin
//     RPCs, provision_tenant, verify_owner_pin, etc.
//   - This one (2026-07-28, hotfix 000525): 6 kasir_expense_category
//     functions from migration 000523 — Panel + Kasir dropdown would
//     have crashed for real users. 4th recurrence triggered the CLAUDE.md
//     class-fix rule (audit + codemod ship together).
//
// Fix pattern: `ALTER FUNCTION public.<fn>(...) OWNER TO postgres;` at
// the end of the CREATE block.
//
// P3-05 goal (least-privilege) still valid — the option is to rewrite
// function bodies to use `current_setting('request.jwt.claims')` (no auth
// schema access needed). See `_resolve_tenant_id()` as reference. Until
// that refactor lands, the guardrail is: ownership stays `postgres`.
//
// Usage: npm run audit:secdef-auth-schema-owner
// Exit 0 = clean, exit 1 = violation printed with file:line.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';

// Historical migrations that INTRODUCED the pattern but were later
// FIXED by another migration in the same set (000514/000519/000525).
// Prod DB was verified clean (0 violations) as of 2026-07-28 after
// migration 000525 landed. Future migrations must not add to this list —
// they must ship OWNER TO postgres from birth, or rewrite bodies to
// avoid auth.* calls entirely.
const ALLOWLIST = new Set<string>([
  '20261115000002_phase_b_wave1_list_tenants_admin.sql',
  '20261115000003_phase_b_wave1_list_audit_events.sql',
  '20261115000005_phase_b_wave1_list_tenant_users_admin.sql',
  '20261115000321_job_queue_rpcs.sql',
  '20261115000322_job_queue_fixes.sql',
  '20261115000331_export_tenant_data_rpc.sql',
  '20261115000509_provision_tenant_env_param.sql',
  '20261115000516_provision_tenant_owner_permissions_43_key.sql',
  '20261115000523_kasir_expense_categories_rpcs.sql',
  // 000525 references "OWNER TO vosi_rpc_owner" in comments only —
  // the actual ALTERs move to postgres. Included so scanner doesn't
  // false-positive on the comment.
  '20261115000525_kasir_expense_rpcs_owner_postgres.sql',
]);

// Strip -- line comments so grep-like checks don't trip on comment text.
function stripLineComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

const AUTH_REF = /\bauth\.(uid|users|jwt|role|email)\b/;
const SECDEF   = /\bSECURITY\s+DEFINER\b/i;
const OWNER_VOSI = /\bOWNER\s+TO\s+vosi_rpc_owner\b/i;

interface Hit {
  file: string;
  reason: string;
}

const hits: Hit[] = [];

for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
  if (!name.endsWith('.sql')) continue;
  if (ALLOWLIST.has(name)) continue;

  const raw = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  const src = stripLineComments(raw);

  if (!OWNER_VOSI.test(src)) continue;
  if (!SECDEF.test(src)) continue;
  if (!AUTH_REF.test(src)) continue;

  hits.push({
    file: name,
    reason:
      'Contains SECURITY DEFINER + auth.<uid|users|jwt|role|email> + OWNER TO vosi_rpc_owner. ' +
      'This will fail at runtime with SQLSTATE 42501 "permission denied for schema auth" ' +
      'because vosi_rpc_owner lacks USAGE on schema auth in Supabase-managed Postgres.',
  });
}

if (hits.length === 0) {
  console.log(
    '✓ clean — no new SECURITY DEFINER functions with auth.* body owned by vosi_rpc_owner; ' +
      'use OWNER TO postgres (or rewrite to current_setting(\'request.jwt.claims\')).'
  );
  process.exit(0);
}

console.error(`✗ ${hits.length} migration(s) introduce the SECDEF+auth+vosi_rpc_owner anti-pattern:`);
console.error('');
console.error('  Fix:  ALTER FUNCTION public.<fn>(...) OWNER TO postgres;');
console.error('  Why:  vosi_rpc_owner lacks USAGE on schema auth in Supabase; auth.uid() ' +
              'fails at runtime with SQLSTATE 42501.');
console.error('  Ref:  docs/superpowers/miss-log.md Entry #4 (P3-05) + this session\'s Entry #8.');
console.error('');
for (const h of hits) {
  console.error(`  ${h.file}`);
  console.error(`    ${h.reason}`);
}
process.exit(1);
