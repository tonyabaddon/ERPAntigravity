import { supabase } from './supabaseClient';

/**
 * Resolves a chat-media reference to a displayable URL.
 *
 * Handles two formats to support zero-downtime deployment:
 *   - Legacy: full public URL (https://...supabase.co/storage/v1/object/public/chat-media/...)
 *     → returned as-is (bucket was public when these were created; files remain accessible
 *       until data migration script moves them to tenant-prefixed paths)
 *   - New: tenant-scoped storage path (tenants/{tenant_id}/{uuid}_{filename})
 *     → signed URL with 1-hour TTL via Supabase Storage
 *
 * Returns null if signing fails; callers should show a fallback UI (e.g., "[lampiran]").
 *
 * @param mediaRef - Either a full https:// URL (legacy) or a storage path (new)
 */
export async function getSignedChatMediaUrl(mediaRef: string): Promise<string | null> {
  if (!mediaRef) return null;

  // Legacy rows: media_url stored the full public URL
  // Return as-is — the file is still accessible while bucket migration is pending
  if (/^https?:\/\//.test(mediaRef)) {
    return mediaRef;
  }

  // New rows: media_url stores the storage path (tenants/{tenant_id}/...)
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from('chat-media')
    .createSignedUrl(mediaRef, 60 * 60); // 1-hour TTL

  if (error) {
    console.error('[chat-media] signed URL failed:', { path: mediaRef, error });
    return null;
  }

  return data?.signedUrl ?? null;
}
