// tests/isolation/impersonation.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Client as PgClient } from 'pg';
import { supabaseClient, simulateAuth, resetFixtures,
         TENANT_A, TENANT_B, USER_A, USER_SUPER, SLUG_A, SLUG_B } from './setup';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

describe('Platform admin impersonation', () => {
  beforeAll(async () => { await resetFixtures(); });

  it('Platform admin CAN read tenant B via impersonation', async () => {
    await simulateAuth(USER_SUPER, '', SLUG_B);
    const { data, error } = await supabaseClient.from('stocks').select('tenant_id');
    expect(error).toBeNull();
    expect(data?.every((r: any) => r.tenant_id === TENANT_B)).toBe(true);
  });

  it('Non-admin cannot impersonate', async () => {
    await simulateAuth(USER_A, SLUG_A, SLUG_B);
    const { data } = await supabaseClient.from('stocks').select('tenant_id');
    // Impersonation header ignored for non-admin; user A only sees tenant A rows
    expect(data?.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it('impersonate_tenant writes an audit row', async () => {
    await simulateAuth(USER_SUPER, '', SLUG_B);
    const { error } = await supabaseClient.rpc('impersonate_tenant', { p_slug: SLUG_B });
    expect(error).toBeNull();

    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    const { rows } = await pg.query(
      `SELECT * FROM platform_admin_audit WHERE admin_user_id=$1 AND tenant_id=$2 AND action='IMPERSONATE_START' ORDER BY created_at DESC LIMIT 1`,
      [USER_SUPER, TENANT_B]);
    await pg.end();
    expect(rows.length).toBe(1);
  });
});
