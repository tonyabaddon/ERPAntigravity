/**
 * migrate-product-photos-paths.ts
 *
 * Migrates existing product-photos files from legacy SKU-prefixed paths to
 * the tenant-scoped path pattern: tenants/{tenant_id}/products/{uuid}.jpg
 *
 * Background: Prior to migration 302 (20261115000302_product_photos_tenant_scoped.sql),
 * product-photos files used path pattern `{sku}/{order}.jpg` (or a short-UUID/{order}.jpg
 * for files uploaded after the first FE refactor). Any authenticated user from any tenant
 * could overwrite any tenant's product photos by knowing the path.
 *
 * After this script runs:
 *   - All 29 storage files moved to tenants/{garindo_id}/products/{new_uuid}.jpg
 *   - stocks.photo_urls JSONB updated: both .path and .url fields updated per photo
 *   - stock_photo_embeddings.photo_path updated (used by search_products_by_embedding RPC
 *     to return photo URLs to the Go backend for Cari by Foto feature)
 *
 * Idempotent:
 *   - Files already at tenants/ prefix are skipped (already migrated)
 *   - stocks rows already updated (photo_urls contains tenants/ paths) are skipped
 *   - stock_photo_embeddings rows already updated are skipped
 *
 * Run:
 *   SUPABASE_URL=https://ekhhojaezdfjfwuxyjkl.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   npx tsx scripts/migrate-product-photos-paths.ts
 *
 * IMPORTANT: Run AFTER migration 302 is applied to prod. The new RLS policies
 * only allow writes to tenants/{tenant_id}/products/... paths, so old paths
 * become read-only for users. New uploads from the updated FE will use the
 * new path pattern. This script migrates the existing 29 files.
 *
 * Scope expansion vs dispatch: also updates stock_photo_embeddings.photo_path
 * so that the search_products_by_embedding RPC (used by Cari by Foto) continues
 * to return valid image URLs after migration. Without this, Cari by Foto results
 * would show broken images.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Service-role client bypasses RLS — required for cross-table atomic updates
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BUCKET = 'product-photos';
const GARINDO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

// Build public URL for product-photos (bucket stays public)
function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function main() {
  console.log('=== product-photos path migration (302) ===');
  console.log(`Target tenant: ${GARINDO_TENANT_ID} (Garindo Jaya Panel)`);
  console.log('New path pattern: tenants/{tenant_id}/products/{uuid}.jpg');
  console.log('');

  // Step 1: List all files in the bucket
  const { data: allFiles, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 200 });

  if (listErr) {
    console.error('Failed to list bucket root:', listErr);
    process.exit(1);
  }

  // Collect all file paths recursively — files are nested in prefix folders
  const filePaths: string[] = [];

  for (const item of allFiles ?? []) {
    if (item.id) {
      // It's a file at the root level (shouldn't happen but handle it)
      filePaths.push(item.name);
    } else {
      // It's a folder prefix — list its contents
      const { data: subFiles, error: subErr } = await supabase.storage
        .from(BUCKET)
        .list(item.name, { limit: 100 });

      if (subErr) {
        console.warn(`[warn] Could not list ${item.name}/: ${subErr.message}`);
        continue;
      }

      for (const sub of subFiles ?? []) {
        if (sub.id) {
          filePaths.push(`${item.name}/${sub.name}`);
        }
      }
    }
  }

  console.log(`Found ${filePaths.length} total file(s) in bucket.`);

  // Separate already-migrated from legacy
  const legacyPaths = filePaths.filter(p => !p.startsWith('tenants/'));
  const alreadyMigrated = filePaths.filter(p => p.startsWith('tenants/'));

  console.log(`  Already migrated (tenants/ prefix): ${alreadyMigrated.length}`);
  console.log(`  Legacy (need migration): ${legacyPaths.length}`);
  console.log('');

  if (legacyPaths.length === 0) {
    console.log('All files already migrated. Nothing to do.');
  }

  // Step 2: Fetch stocks with photo_urls for path→sku lookup and DB update
  const { data: stockRows, error: stockErr } = await supabase
    .from('stocks')
    .select('sku, tenant_id, photo_urls')
    .not('photo_urls', 'eq', '[]')
    .not('photo_urls', 'is', null)
    .limit(500);

  if (stockErr) {
    console.error('Failed to fetch stocks:', stockErr);
    process.exit(1);
  }

  // Build map: old_path → { sku, tenant_id }
  const pathToStock: Record<string, { sku: string; tenant_id: string }> = {};
  for (const row of stockRows ?? []) {
    const photos = row.photo_urls as Array<{ url: string; path: string; order: number; uploaded_at: string }>;
    for (const photo of photos ?? []) {
      if (photo.path) {
        pathToStock[photo.path] = { sku: row.sku, tenant_id: row.tenant_id };
      }
    }
  }

  // Step 3: Fetch all stock_photo_embeddings for path lookup
  const { data: embRows, error: embErr } = await supabase
    .from('stock_photo_embeddings')
    .select('sku, photo_path')
    .limit(1000);

  if (embErr) {
    console.warn('[warn] Could not fetch stock_photo_embeddings:', embErr.message);
  }

  // Build map: old_path → sku (for embeddings update)
  const embPathToSku: Record<string, string> = {};
  for (const row of embRows ?? []) {
    if (row.photo_path && !row.photo_path.startsWith('tenants/')) {
      embPathToSku[row.photo_path] = row.sku;
    }
  }

  console.log(`stocks with photo_urls: ${stockRows?.length ?? 0}`);
  console.log(`stock_photo_embeddings (legacy paths): ${Object.keys(embPathToSku).length}`);
  console.log('');

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  // Track old→new path mappings for bulk DB update
  const pathMappings: Array<{ oldPath: string; newPath: string }> = [];

  // Step 4: Migrate each legacy file via Storage Move API
  for (const oldPath of legacyPaths) {
    const newUuid = randomUUID();
    const ext = oldPath.endsWith('.jpg') ? 'jpg' : oldPath.split('.').pop() ?? 'jpg';
    const newPath = `tenants/${GARINDO_TENANT_ID}/products/${newUuid}.${ext}`;

    // Move file (Storage Move API — physically moves S3 object, not metadata-only)
    const { error: moveErr } = await supabase.storage
      .from(BUCKET)
      .move(oldPath, newPath);

    if (moveErr) {
      console.error(`[error] move ${oldPath} → ${newPath}: ${moveErr.message}`);
      errors++;
      continue;
    }

    console.log(`[move]  ${oldPath} → ${newPath}`);
    pathMappings.push({ oldPath, newPath });
    migrated++;
  }

  console.log('');

  // Step 5: Update stocks.photo_urls for each migrated path
  // Group mappings by sku to do one UPDATE per stock row
  if (pathMappings.length > 0) {
    console.log('--- Updating stocks.photo_urls ---');

    // Build sku → [{oldPath, newPath}] map
    const skuMappings: Record<string, Array<{ oldPath: string; newPath: string }>> = {};
    for (const mapping of pathMappings) {
      const stock = pathToStock[mapping.oldPath];
      if (!stock) {
        // Orphan file (no matching stocks row) — storage moved, no DB update needed
        console.log(`[orphan] ${mapping.oldPath} → ${mapping.newPath} (no stocks row — storage moved only)`);
        continue;
      }
      if (!skuMappings[stock.sku]) {
        skuMappings[stock.sku] = [];
      }
      skuMappings[stock.sku].push(mapping);
    }

    for (const sku of Object.keys(skuMappings)) {
      const mappings = skuMappings[sku];

      // Fetch current photo_urls for this SKU
      const { data: stockRow, error: fetchErr } = await supabase
        .from('stocks')
        .select('photo_urls')
        .eq('sku', sku)
        .single();

      if (fetchErr || !stockRow) {
        console.error(`[error] fetch stocks.${sku}: ${fetchErr?.message}`);
        errors++;
        continue;
      }

      const photos = stockRow.photo_urls as Array<{
        url: string; path: string; order: number; uploaded_at: string;
      }>;

      // Apply all path → new path replacements
      const updatedPhotos = photos.map(photo => {
        const match = mappings.find(m => m.oldPath === photo.path);
        if (!match) return photo;
        return {
          ...photo,
          path: match.newPath,
          url: publicUrl(match.newPath),
        };
      });

      const { error: updateErr } = await supabase
        .from('stocks')
        .update({ photo_urls: updatedPhotos })
        .eq('sku', sku);

      if (updateErr) {
        console.error(`[error] update stocks.${sku} photo_urls: ${updateErr.message}`);
        errors++;
      } else {
        console.log(`[stocks] updated ${sku}: ${mappings.length} photo(s) re-pathed`);
      }
    }
  }

  // Step 6: Update stock_photo_embeddings.photo_path
  if (pathMappings.length > 0) {
    console.log('');
    console.log('--- Updating stock_photo_embeddings.photo_path ---');
    console.log('(Required for search_products_by_embedding RPC / Cari by Foto integrity)');

    for (const { oldPath, newPath } of pathMappings) {
      if (!embPathToSku[oldPath]) {
        // No embedding for this path (test files, unindexed photos)
        continue;
      }

      const { error: embUpdateErr } = await supabase
        .from('stock_photo_embeddings')
        .update({ photo_path: newPath })
        .eq('photo_path', oldPath);

      if (embUpdateErr) {
        console.error(`[error] update stock_photo_embeddings ${oldPath}: ${embUpdateErr.message}`);
        errors++;
      } else {
        console.log(`[embed] updated embedding path: ${oldPath} → ${newPath}`);
      }
    }
  }

  console.log('');
  console.log(`=== Done. Moved: ${migrated}, Skipped: ${skipped}, Errors: ${errors} ===`);

  if (errors > 0) {
    console.error(`\n${errors} error(s) encountered. Review logs above.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
