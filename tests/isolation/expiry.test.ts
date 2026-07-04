// tests/isolation/expiry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Client as PgClient } from 'pg';
import { supabaseClient, simulateAuth, resetFixtures,
         TENANT_A, USER_A, SLUG_A } from './setup';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

async function setExpiryFor(tenantId: string, expiresAt: string) {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  await pg.query(`UPDATE tenant_subscriptions SET expires_at = $1 WHERE tenant_id = $2`, [expiresAt, tenantId]);
  await pg.end();
}

describe('Expiry enforcement', () => {
  beforeAll(async () => { await resetFixtures(); });

  it('ACTIVE tenant CAN write', async () => {
    await setExpiryFor(TENANT_A, '2099-12-31');
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-ACTIVE-${Date.now()}`, name: 'active', tenant_id: TENANT_A
    } as any);
    expect(error).toBeNull();
  });

  it('GRACE tenant CAN still write (within 7-day window)', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, yesterday);
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-GRACE-${Date.now()}`, name: 'grace', tenant_id: TENANT_A
    } as any);
    expect(error).toBeNull();
  });

  it('READONLY tenant CANNOT write', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, eightDaysAgo);
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-RO-${Date.now()}`, name: 'ro', tenant_id: TENANT_A
    } as any);
    expect(error).toBeTruthy();
    expect(error?.message).toContain('SUBSCRIPTION_EXPIRED_READONLY');
  });

  it('READONLY tenant CAN still SELECT', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, eightDaysAgo);
    await simulateAuth(USER_A, SLUG_A);
    const { data, error } = await supabaseClient.from('stocks').select('sku').limit(1);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});
