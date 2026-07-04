import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as jwt from 'jsonwebtoken';

export const TENANT_A = 'aaaa1111-0000-0000-0000-000000000001';
export const TENANT_B = 'bbbb2222-0000-0000-0000-000000000001';
export const USER_A   = 'aaaa9999-0000-0000-0000-000000000001';
export const USER_B   = 'bbbb9999-0000-0000-0000-000000000001';
export const USER_SUPER = 'cccc9999-0000-0000-0000-000000000001';
export const SLUG_A = 'test-a';
export const SLUG_B = 'test-b';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

let _authHeader: string = '';

export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (input, init) => {
      const h = new Headers(init?.headers);
      if (_authHeader) h.set('Authorization', `Bearer ${_authHeader}`);
      return fetch(input, { ...init, headers: h });
    }
  }
});

export async function resetFixtures(): Promise<void> {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    // Clean prior test state (idempotent)
    await pg.query(`
      DELETE FROM tenant_users WHERE tenant_id IN ($1, $2);
      DELETE FROM tenant_subscriptions WHERE tenant_id IN ($1, $2);
      DELETE FROM tenants WHERE id IN ($1, $2);
      DELETE FROM platform_admins WHERE user_id = $3;
      DELETE FROM auth.users WHERE id IN ($4, $5, $3);
    `.replace(/\$1/g, `'${TENANT_A}'`).replace(/\$2/g, `'${TENANT_B}'`)
      .replace(/\$3/g, `'${USER_SUPER}'`).replace(/\$4/g, `'${USER_A}'`).replace(/\$5/g, `'${USER_B}'`));

    // Seed
    await pg.query(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_A}', 'a@isolation.test'),
        ('${USER_B}', 'b@isolation.test'),
        ('${USER_SUPER}', 'super@isolation.test');
      INSERT INTO tenants (id, slug, name) VALUES
        ('${TENANT_A}', '${SLUG_A}', 'Isolation Test A'),
        ('${TENANT_B}', '${SLUG_B}', 'Isolation Test B');
      INSERT INTO tenant_users (tenant_id, user_id, role) VALUES
        ('${TENANT_A}', '${USER_A}', 'owner'),
        ('${TENANT_B}', '${USER_B}', 'owner');
      INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at) VALUES
        ('${TENANT_A}', 'PREMIUM', '2026-01-01', '2099-12-31'),
        ('${TENANT_B}', 'PREMIUM', '2026-01-01', '2099-12-31');
      INSERT INTO platform_admins (user_id, email) VALUES ('${USER_SUPER}', 'super@isolation.test');
    `);

    // Seed one row per T-table (bypasses RLS since running as superuser)
    await pg.query(`
      INSERT INTO stocks (sku, name, tenant_id) VALUES
        ('A-SKU-1', 'A Stock', '${TENANT_A}'),
        ('B-SKU-1', 'B Stock', '${TENANT_B}')
      ON CONFLICT (sku) DO NOTHING;
      -- Add other T-table seeds as needed
    `);
  } finally {
    await pg.end();
  }
}

export async function simulateAuth(userId: string, tenantSlug: string, impersonateSlug?: string): Promise<void> {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    // Query DB: get tenant_id from tenants WHERE slug = tenantSlug
    const tenantResult = await pg.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = $1',
      [tenantSlug]
    );
    if (tenantResult.rows.length === 0) {
      throw new Error(`Tenant with slug ${tenantSlug} not found`);
    }
    const tenant_id = tenantResult.rows[0].id;

    // Get is_platform_admin from platform_admins WHERE user_id = userId
    const adminResult = await pg.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = $1) AS exists',
      [userId]
    );
    const is_platform_admin = adminResult.rows[0]?.exists ?? false;

    // Get expiry_state from v_tenant_effective_features WHERE tenant_id = <resolved>
    const featuresResult = await pg.query<{ expiry_mode: string }>(
      'SELECT expiry_mode FROM v_tenant_effective_features WHERE tenant_id = $1',
      [tenant_id]
    );
    const tenant_expiry_mode = featuresResult.rows[0]?.expiry_mode ?? 'none';
    const tenant_status = tenant_expiry_mode === 'none' ? 'active' : 'expiring';

    let impersonating_tenant_id: string | undefined;
    let impersonating_slug: string | undefined;

    // If impersonateSlug: get impersonated tenant_id
    if (impersonateSlug) {
      const impersonateResult = await pg.query<{ id: string }>(
        'SELECT id FROM tenants WHERE slug = $1',
        [impersonateSlug]
      );
      if (impersonateResult.rows.length === 0) {
        throw new Error(`Impersonate tenant with slug ${impersonateSlug} not found`);
      }
      impersonating_tenant_id = impersonateResult.rows[0].id;
      impersonating_slug = impersonateSlug;
    }

    // Build claims JSON with all the fields
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      exp: now + 3600,
      iat: now,
      tenant_id,
      tenant_status,
      tenant_expiry_mode,
      is_platform_admin,
      impersonating: !!impersonating_tenant_id,
      impersonating_tenant_id,
      impersonating_slug
    };

    // Mint JWT via jsonwebtoken.sign
    _authHeader = jwt.sign(claims, SUPABASE_JWT_SECRET);
  } finally {
    await pg.end();
  }
}

export async function getTablesInCategory(cat: 'T' | 'G' | 'P' | 'A' | 'S'): Promise<string[]> {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    const { rows } = await pg.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND obj_description(c.oid, 'pg_class') = 'category=' || $1
      ORDER BY c.relname
    `, [cat]);
    return rows.map(r => r.table_name);
  } finally {
    await pg.end();
  }
}
