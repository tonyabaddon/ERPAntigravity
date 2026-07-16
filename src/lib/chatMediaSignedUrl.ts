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

  // Legacy rows: media_url stored the full public URL.
  // NOTE: After migration 300 applies, Supabase's public URL endpoint returns HTTP 400
  // for all chat-media files regardless of path. This passthrough only works BEFORE
  // migration 300 applies. Deployment order MUST be strict:
  //   1. Apply migration 300 (bucket → private, new RLS policies)
  //   2. Run scripts/migrate-chat-media-paths.ts to COMPLETION (moves files + updates media_url to new paths)
  //   3. THEN git push to deploy new FE
  // If FE deploys before data script completes, legacy chat attachments will be broken
  // for existing conversations. The passthrough here exists only as safety for edge cases
  // where a legacy URL slips through — it will resolve to a broken image, but won't crash the UI.
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
