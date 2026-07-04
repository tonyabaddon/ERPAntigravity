// tests/isolation/rls-cross-tenant.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { supabaseClient, simulateAuth, resetFixtures, getTablesInCategory,
         TENANT_A, TENANT_B, USER_A, SLUG_A } from './setup';

describe('RLS: cross-tenant isolation', () => {
  let tables_T: string[];

  beforeAll(async () => {
    await resetFixtures();
    tables_T = await getTablesInCategory('T');
    expect(tables_T.length).toBeGreaterThan(0);
  });

  beforeEach(async () => {
    await simulateAuth(USER_A, SLUG_A);
  });

  for (const table of tables_T) {
    describe(`${table}`, () => {
      it('User A only sees tenant A rows on SELECT', async () => {
        const { data, error } = await supabaseClient.from(table).select('tenant_id');
        expect(error).toBeNull();
        expect(data?.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
      });

      it('User A cannot UPDATE tenant B rows', async () => {
        const { data, error } = await supabaseClient.from(table)
          .update({ updated_at: new Date().toISOString() } as any)
          .eq('tenant_id', TENANT_B)
          .select();
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it('User A cannot INSERT with tenant_id = B', async () => {
        const { error } = await supabaseClient.from(table).insert({ tenant_id: TENANT_B } as any);
        expect(error).toBeTruthy();
      });

      it('User A cannot DELETE tenant B rows', async () => {
        const { data, error } = await supabaseClient.from(table)
          .delete().eq('tenant_id', TENANT_B).select();
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    });
  }
});
