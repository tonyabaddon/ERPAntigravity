/**
 * migrate-chat-media-paths.ts
 *
 * Migrates existing chat-media files from legacy root paths to the
 * tenant-prefixed path pattern: tenants/{tenant_id}/{uuid}_{filename}
 *
 * Background: Prior to migration 300 (20261115000300_chat_media_tenant_prefix.sql),
 * chat-media files were uploaded to the bucket root with path `${Date.now()}_${filename}`.
 * The `messages.media_url` column stored the full public URL:
 *   https://<project>.supabase.co/storage/v1/object/public/chat-media/1234567890_photo.jpg
 *
 * After this script runs:
 *   - Storage files moved to tenants/{tenant_id}/{uuid}_{filename}
 *   - messages.media_url updated to the new storage PATH (not URL), so
 *     getSignedChatMediaUrl() handles signed URL generation on the client
 *
 * Idempotent: files already in tenants/ prefix are skipped.
 *
 * Run:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   npx tsx scripts/migrate-chat-media-paths.ts
 *
 * IMPORTANT: Run AFTER migration 300 is applied to prod but BEFORE FE deploy,
 * or immediately after FE deploy (the renderer handles both formats gracefully).
 * Bucket must be private before this runs (migration 300 handles that).
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Service-role client bypasses RLS — required for cross-tenant migration
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Extract storage object name from a legacy full public URL
// Input:  https://<project>.supabase.co/storage/v1/object/public/chat-media/1234567890_photo.jpg
// Output: 1234567890_photo.jpg
function extractObjectName(fullUrl: string): string | null {
  try {
    const url = new URL(fullUrl);
    // Path format: /storage/v1/object/public/chat-media/<object-name>
    const prefix = '/storage/v1/object/public/chat-media/';
    if (url.pathname.startsWith(prefix)) {
      return decodeURIComponent(url.pathname.slice(prefix.length));
    }
    // Fallback: path without chat-media bucket prefix
    const altPrefix = '/storage/v1/object/sign/chat-media/';
    if (url.pathname.startsWith(altPrefix)) {
      const withQuery = url.pathname.slice(altPrefix.length);
      return decodeURIComponent(withQuery.split('?')[0]);
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Chat-media path migration ===');
  console.log('Target: move root-path files to tenants/{tenant_id}/{uuid}_{filename}');
  console.log('');

  // Fetch all messages with media_url that look like legacy full URLs
  // (new-style paths start with "tenants/" and are not http URLs)
  // LIMIT 10000: PostgREST default max is 1000 rows — without an explicit limit
  // only the first 1000 rows would be processed silently. 10000 is a safe upper
  // bound for a single-instance migration; if hit, re-run (idempotency ensures
  // already-migrated rows are excluded by the media_url LIKE http% filter).
  const { data: legacyMessages, error: fetchErr } = await supabase
    .from('messages')
    .select('id, tenant_id, media_url, conversation_id')
    .like('media_url', 'http%')
    .limit(10000);

  if (fetchErr) {
    console.error('Failed to fetch legacy messages:', fetchErr);
    process.exit(1);
  }

  const legacyCount = legacyMessages?.length ?? 0;

  if (legacyCount === 0) {
    console.log('No legacy media_url rows found. Nothing to migrate.');
    return;
  }

  // Warn if we hit the requested limit — result may be truncated
  if (legacyCount === 10000) {
    console.warn(
      '⚠️  WARNING: Reached limit of 10000 legacy rows. Result may be truncated.\n' +
      '   Re-run this script after this batch completes to process remaining rows.\n' +
      '   Idempotency guarantee: already-migrated rows are excluded by media_url LIKE http% filter.'
    );
  }

  console.log(`Found ${legacyCount} legacy media_url row(s) to process.`);
  console.log('');

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const msg of legacyMessages) {
    const objectName = extractObjectName(msg.media_url);

    if (!objectName) {
      console.warn(`[skip] message ${msg.id}: cannot parse object name from URL: ${msg.media_url}`);
      skipped++;
      continue;
    }

    // Skip if already in tenants/ prefix (shouldn't happen given LIKE 'http%' filter, but be safe)
    if (objectName.startsWith('tenants/')) {
      console.log(`[skip] message ${msg.id}: object already in tenants/ prefix`);
      skipped++;
      continue;
    }

    // If tenant_id is missing on the message row, try to get it from the conversation
    let tenantId: string | null = msg.tenant_id;
    if (!tenantId) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('tenant_id')
        .eq('id', msg.conversation_id)
        .single();
      tenantId = conv?.tenant_id ?? null;
    }

    if (!tenantId) {
      console.warn(`[skip] message ${msg.id}: no tenant_id found (file: ${objectName})`);
      skipped++;
      continue;
    }

    const newPath = `tenants/${tenantId}/${randomUUID()}_${objectName}`;

    // Download existing file
    const { data: fileData, error: downloadErr } = await supabase.storage
      .from('chat-media')
      .download(objectName);

    if (downloadErr || !fileData) {
      console.warn(`[skip] message ${msg.id}: download failed for ${objectName}: ${downloadErr?.message}`);
      skipped++;
      continue;
    }

    // Upload to new tenant-prefixed path
    const { error: uploadErr } = await supabase.storage
      .from('chat-media')
      .upload(newPath, fileData, { upsert: false });

    if (uploadErr) {
      console.error(`[error] message ${msg.id}: upload to ${newPath} failed: ${uploadErr.message}`);
      errors++;
      continue;
    }

    // Update messages.media_url to the new storage PATH (not URL)
    // Renderer's getSignedChatMediaUrl() will generate signed URLs on demand
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ media_url: newPath })
      .eq('id', msg.id);

    if (updateErr) {
      console.error(`[error] message ${msg.id}: DB update failed: ${updateErr.message}`);
      // Don't delete the uploaded copy — we can retry the update
      errors++;
      continue;
    }

    // Delete old file from bucket root
    const { error: deleteErr } = await supabase.storage
      .from('chat-media')
      .remove([objectName]);

    if (deleteErr) {
      // Non-fatal: old file cleanup can be done manually; new path is active
      console.warn(`[warn] message ${msg.id}: old file delete failed (non-fatal): ${deleteErr.message}`);
    }

    console.log(`[migrate] ${objectName} → ${newPath}`);
    migrated++;
  }

  console.log('');
  console.log(`=== Done. Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors} ===`);

  if (errors > 0) {
    console.error(`\n${errors} error(s) encountered. Review logs above and re-run to retry.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
