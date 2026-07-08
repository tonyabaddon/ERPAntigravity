// scripts/audit-view-security-invoker.ts
//
// Sweeps every public view for `security_invoker=true`. Fails (exit 1) if any
// view is missing the setting. Origin story: on 2026-07-07 a demo tenant
// (Toko Jaya Makmur) saw Garindo's Kas Toko balance leak into their Kas & Bank
// screen via public.cash_account_balances — the view runs as its owner
// (postgres, BYPASSRLS) unless security_invoker is set. See migration
// 20261115000028 for the fix and progress.md for the postmortem.
//
// Exceptions (documented in the ALLOW list below): views whose queries
// intentionally recurse through a broken RLS policy and must stay non-invoker
// until the policy is repaired. Each exception carries a task-ID reference.
//
// Usage: npx tsx scripts/audit-view-security-invoker.ts
//        (uses SUPABASE_DB_URL env var, defaults to local supabase)
// CI:    add to isolation-audit workflow alongside RLS checks.

import { Client } from 'pg';

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@localhost:54322/postgres';

/** Views intentionally kept as non-invoker. Every entry must reference the
 * open task blocking the fix. Empty this list once the tasks land. */
const ALLOWED_NON_INVOKER: Record<string, string> = {
  // Joins tenant_users; a_self_or_tenant_admin policy self-recurses under
  // invoker mode -> 42P17. See progress.md task #56 (tenant_users RLS fix).
  v_tenant_usage_summary: 'task#56: tenant_users RLS self-recursion',
};

interface Row {
  view_name: string;
  is_security_invoker: boolean;
}

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<Row>(`
      SELECT
        c.relname AS view_name,
        COALESCE(
          (SELECT bool_or(opt LIKE 'security_invoker=true')
           FROM unnest(c.reloptions) AS opt),
          false
        ) AS is_security_invoker
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
      ORDER BY c.relname
    `);

    const leaking: string[] = [];
    const okCount = rows.filter(r => r.is_security_invoker).length;

    for (const r of rows) {
      if (r.is_security_invoker) continue;
      if (ALLOWED_NON_INVOKER[r.view_name]) {
        console.log(
          `ALLOW ${r.view_name} — ${ALLOWED_NON_INVOKER[r.view_name]}`,
        );
        continue;
      }
      leaking.push(r.view_name);
    }

    console.log('');
    console.log(`Scanned ${rows.length} public views`);
    console.log(`  ${okCount} security_invoker=true`);
    console.log(`  ${Object.keys(ALLOWED_NON_INVOKER).length} allowed exceptions`);
    console.log(`  ${leaking.length} LEAK candidates`);

    if (leaking.length > 0) {
      console.error('');
      console.error('FAIL — the following views bypass RLS via owner (postgres, BYPASSRLS):');
      for (const v of leaking) console.error(`  - ${v}`);
      console.error('');
      console.error('Fix: ALTER VIEW public.<name> SET (security_invoker = true);');
      console.error('Or add to ALLOWED_NON_INVOKER in this script with a task ref.');
      process.exit(1);
    }
    console.log('');
    console.log('OK — all public views enforce RLS via security_invoker.');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
