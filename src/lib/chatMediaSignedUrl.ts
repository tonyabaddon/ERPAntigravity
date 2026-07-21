import { supabase } from './supabaseClient';
import { captureError } from './captureError';

/**
 * Resolves a storage reference to a displayable signed URL.
 *
 * Handles two formats to support zero-downtime deployment:
 *   - Legacy: full public URL (https://...supabase.co/storage/v1/object/public/...)
 *     → returned as-is (see bucket-specific notes below)
 *   - New: tenant-scoped storage path (tenants/{tenant_id}/...)
 *     → signed URL with 1-hour TTL via Supabase Storage
 *
 * Returns null if signing fails; callers should show a fallback UI (e.g., "[lampiran]").
 *
 * @param bucket   - Storage bucket id (e.g. 'chat-media', 'payment-proofs', 'purchase-documents')
 * @param mediaRef - Either a full https:// URL (legacy) or a storage path (new)
 */
export async function getSignedStorageUrl(bucket: string, mediaRef: string): Promise<string | null> {
  if (!mediaRef) return null;

  // Legacy rows: stored the full public URL from getPublicUrl().
  // NOTE: For now-private buckets, old public/ URLs return HTTP 400. This passthrough
  // exists only as graceful degradation (caller sees a broken image, not a crash).
  // The DB backfill in migration 301 converts old URLs → storage paths for affected rows.
  if (/^https?:\/\//.test(mediaRef)) {
    return mediaRef;
  }

  // New rows: stores the storage path (tenants/{tenant_id}/...)
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(mediaRef, 60 * 60); // 1-hour TTL

  if (error) {
    captureError(error, { feature: 'chat_media', action: 'create_signed_url', bucket, path: mediaRef });
    return null;
  }

  return data?.signedUrl ?? null;
}

/**
 * Convenience wrapper for chat-media bucket.
 * Kept for backwards-compat with existing callers (SalesInboxScreen).
 */
export async function getSignedChatMediaUrl(mediaRef: string): Promise<string | null> {
  return getSignedStorageUrl('chat-media', mediaRef);
}
