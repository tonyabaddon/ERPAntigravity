// tests/isolation/cari-by-foto-tenant.test.ts
//
// Regression for the cross-tenant leak in Cari by Foto (fixed by migration
// 20261115000540). The RPC search_products_by_embedding previously had no
// tenant filter, and the backend Go handler ran it as the `postgres` pool
// user (bypasses RLS), so a query from tenant B could return matches from
// tenant A's indexed photos. Fix: added `p_tenant_id uuid` parameter,
// filtering both the embedding CTE and the stocks JOIN.
//
// This test hits the SQL layer directly (via pg client) rather than the
// backend Go endpoint because that's where the fix lives — matching the
// class-fix pattern used by other tests in this dir.

import { describe, it, expect, beforeAll } from 'vitest';
import { Client as PgClient } from 'pg';
import { resetFixtures, TENANT_A, TENANT_B } from './setup';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

// A deterministic 512-dim vector. Not L2-normalised (search RPC only cares
// about relative cosine, and identical embeddings give cosine = 1.0
// regardless of magnitude).
function makeVector(seed: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 512; i++) {
    parts.push((seed + i * 0.001).toFixed(6));
  }
  return `[${parts.join(',')}]`;
}

async function seedEmbedding(pg: PgClient, tenantId: string, sku: string, vec: string) {
  await pg.query(
    `INSERT INTO public.stocks (sku, name, category, price, stock, status, tenant_id)
     VALUES ($1, $2, 'test', 0, 0, 'active', $3)
     ON CONFLICT (sku) DO NOTHING`,
    [sku, `stock ${sku}`, tenantId]
  );
  await pg.query(
    `INSERT INTO public.stock_photo_embeddings (tenant_id, sku, photo_path, embedding)
     VALUES ($1::uuid, $2, $3, $4::vector)
     ON CONFLICT (sku, photo_path) DO UPDATE SET embedding = EXCLUDED.embedding, indexed_at = now()`,
    [tenantId, sku, `test-path/${sku}.jpg`, vec]
  );
}

describe('Cari by Foto — cross-tenant isolation (RPC layer)', () => {
  const IDENTICAL_VEC = makeVector(0.5);

  beforeAll(async () => {
    await resetFixtures();
    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    try {
      // Clean any prior-run CF-* rows first — otherwise `ON CONFLICT (sku)
      // DO NOTHING` in seedEmbedding would silently keep an old tenant_id
      // when a future edit intends to swap it, masking isolation regressions.
      await pg.query(`DELETE FROM public.stock_photo_embeddings WHERE sku LIKE 'CF-%'`);
      await pg.query(`DELETE FROM public.stocks WHERE sku LIKE 'CF-%'`);

      // Two tenants, identical embedding for each. Any leak would surface
      // as tenant A's search returning B's row (or vice versa).
      await seedEmbedding(pg, TENANT_A, 'CF-TA-1', IDENTICAL_VEC);
      await seedEmbedding(pg, TENANT_B, 'CF-TB-1', IDENTICAL_VEC);
    } finally {
      await pg.end();
    }
  });

  it('tenant A search returns only tenant A matches', async () => {
    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    try {
      const { rows } = await pg.query<{ sku: string; similarity: number }>(
        `SELECT sku, similarity FROM public.search_products_by_embedding($1::vector, 0.0, 10, $2::uuid)`,
        [IDENTICAL_VEC, TENANT_A]
      );
      const skus = rows.map(r => r.sku);
      expect(skus).toContain('CF-TA-1');
      expect(skus).not.toContain('CF-TB-1');
    } finally {
      await pg.end();
    }
  });

  it('tenant B search returns only tenant B matches', async () => {
    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    try {
      const { rows } = await pg.query<{ sku: string }>(
        `SELECT sku FROM public.search_products_by_embedding($1::vector, 0.0, 10, $2::uuid)`,
        [IDENTICAL_VEC, TENANT_B]
      );
      const skus = rows.map(r => r.sku);
      expect(skus).toContain('CF-TB-1');
      expect(skus).not.toContain('CF-TA-1');
    } finally {
      await pg.end();
    }
  });

  it('NULL tenant_id returns zero rows (safe default for absent-JWT calls)', async () => {
    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `SELECT sku FROM public.search_products_by_embedding($1::vector, 0.0, 10, NULL::uuid)`,
        [IDENTICAL_VEC]
      );
      expect(rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });
});
