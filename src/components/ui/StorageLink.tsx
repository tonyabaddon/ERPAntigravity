/**
 * StorageLink — renders a clickable link that resolves a private storage
 * reference (storage path) to a signed URL on click.
 *
 * Supports two formats for the `ref` prop:
 *   - Legacy full public URL (https://...supabase.co/...): opened directly
 *     (bucket was public when these were created; may return 404 if file was
 *     removed, but won't crash the UI)
 *   - New storage path (tenants/{tenant_id}/...): signed URL generated on
 *     click with 1-hour TTL via getSignedStorageUrl()
 *
 * Usage:
 *   <StorageLink bucket="purchase-documents" ref={po.payment_proof_url}>
 *     Lihat Bukti Pembayaran
 *   </StorageLink>
 */

import React, { useState } from 'react';
import { getSignedStorageUrl } from '../../lib/chatMediaSignedUrl';
import { captureError } from '../../lib/captureError';

interface StorageLinkProps {
  bucket: string;
  /** Storage path OR legacy full public URL */
  storageRef: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}

export function StorageLink({ bucket, storageRef, children, className }: StorageLinkProps) {
  const [resolving, setResolving] = useState(false);

  if (!storageRef) return null;

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Legacy full URLs — open directly (no need to sign)
    if (/^https?:\/\//.test(storageRef)) return;

    // Storage path — prevent default, resolve signed URL, then open
    e.preventDefault();
    if (resolving) return;
    setResolving(true);
    try {
      const signedUrl = await getSignedStorageUrl(bucket, storageRef);
      if (signedUrl) {
        window.open(signedUrl, '_blank', 'noreferrer');
      } else {
        captureError(new Error('Failed to resolve signed URL'), { feature: 'storage_link', action: 'resolve_signed_url', bucket, storageRef });
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <a
      href={/^https?:\/\//.test(storageRef) ? storageRef : '#'}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={handleClick}
      aria-disabled={resolving}
    >
      {resolving ? 'Memuat...' : children}
    </a>
  );
}
