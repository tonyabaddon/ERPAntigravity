// Runtime audit: every tenant must satisfy Day-1 invariants required for
// core sales/inventory flows to work.
//
// Invariants checked:
//   1. Every tenant has ≥1 active warehouse (else Penawaran/Kasir wizards
//      block Step 2 with "gudang wajib dipilih" — Miss-log 2026-07-31,
//      migration 000547 root-fix).
//
// This is a RUNTIME check against prod DB (not a static file scan) because
// the invariant is about DATA state, not code. Complements the static
// audits (audit:secdef-null-tenant, audit:secdef-auth-schema-owner, etc.)
// which prevent regressions at code-write time.
//
// Not wired into the Stop hook: hook runs at turn-end and doesn't reliably
// have DB credentials. Run manually before releases OR set up a scheduled
// job (cron / GitHub Action daily) that reads Supabase creds from secrets.
//
// Usage:
//   set -a && source backend-go/.env && set +a && npm run audit:tenant-invariants
//   (or) SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run audit:tenant-invariants
//
// Exit 0 = all invariants hold. Exit 1 = one or more tenants violate (prints).

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('audit:tenant-invariants — SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  console.error('  hint: set -a && source backend-go/.env && set +a && npm run audit:tenant-invariants');
  process.exit(2);
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface Warehouse {
  tenant_id: string;
  is_active: boolean;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key!,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    throw new Error(`GET /rest/v1/${path} → HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

const tenants = await fetchJson<Tenant[]>('tenants?select=id,name,slug,status');
const warehouses = await fetchJson<Warehouse[]>('warehouses?select=tenant_id,is_active');

const activeByTenant = new Map<string, number>();
for (const w of warehouses) {
  if (!w.is_active) continue;
  activeByTenant.set(w.tenant_id, (activeByTenant.get(w.tenant_id) ?? 0) + 1);
}

interface Violation {
  invariant: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  detail: string;
}

const violations: Violation[] = [];

// Invariant 1: every tenant has ≥1 active warehouse
for (const t of tenants) {
  if (t.status !== 'ACTIVE') continue; // skip suspended/deprovisioned
  const count = activeByTenant.get(t.id) ?? 0;
  if (count === 0) {
    violations.push({
      invariant: 'active_warehouse_ge_1',
      tenant_id: t.id,
      tenant_name: t.name,
      tenant_slug: t.slug,
      detail: `tenant has 0 active warehouses — Penawaran/Kasir wizard Step 2 will block. Run: SELECT public._seed_default_warehouse('${t.id}'::uuid); OR insert via SQL.`,
    });
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — all ${tenants.length} tenant(s) satisfy invariants (1 checked: active_warehouse ≥ 1)`);
  process.exit(0);
}

console.error(`✗ ${violations.length} tenant invariant violation(s):`);
console.error('');
for (const v of violations) {
  console.error(`  [${v.invariant}] ${v.tenant_name} (${v.tenant_slug}, ${v.tenant_id})`);
  console.error(`    ${v.detail}`);
  console.error('');
}
process.exit(1);
