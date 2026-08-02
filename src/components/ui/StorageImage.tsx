/**
 * StorageImage — lazy-loading inline image component for private Supabase storage.
 *
 * Uses IntersectionObserver to detect viewport entry, then fetches a signed URL
 * only when the image is about to enter the visible area. Signed URLs are cached
 * in a module-level Map keyed by "<bucket>:<path>" to avoid redundant sign calls
 * on scroll-back.
 *
 * File-type detection: if the path has a non-image extension (pdf, doc, xls, etc.)
 * this falls back to a <StorageLink> text link so PDF attachments don't break.
 *
 * States:
 *   idle      → skeleton placeholder (before entering viewport)
 *   loading   → skeleton with pulse animation (signed URL pending)
 *   loaded    → img tag rendered
 *   error     → icon + tooltip; retries once with a fresh signed URL
 *
 * Props:
 *   bucket      — storage bucket id (e.g. "payment-proofs", "purchase-documents")
 *   path        — storage path OR legacy full https:// URL
 *   alt         — img alt text
 *   className   — applied to the outer wrapper div
 *   aspectRatio — CSS aspect-ratio value (default "4/5"); prevents CLS
 *   onClick     — optional click handler on the wrapper (e.g. open full-size modal)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSignedStorageUrl } from '../../lib/chatMediaSignedUrl';
import { StorageLink } from './StorageLink';

// Image extensions we attempt to display inline
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg']);

// Non-image extensions that should fall back to a link
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip']);

/** Module-level signed URL cache to survive remounts and scroll-back. */
const signedUrlCache = new Map<string, string>();

function getCacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function getExtension(path: string): string {
  const lastSegment = path.split('/').pop() ?? path;
  const dot = lastSegment.lastIndexOf('.');
  if (dot === -1) return '';
  return lastSegment.slice(dot + 1).toLowerCase();
}

function isNonImagePath(path: string): boolean {
  const ext = getExtension(path);
  // If extension is an explicit document type, fall back to link
  if (DOCUMENT_EXTENSIONS.has(ext)) return true;
  // If extension is known image, it's fine
  if (IMAGE_EXTENSIONS.has(ext)) return false;
  // No extension or unknown — try as image (onError handles failure)
  return false;
}

export interface StorageImageProps {
  bucket: string;
  /** Storage path (tenants/...) OR legacy full https:// URL. */
  path: string | null | undefined;
  alt: string;
  className?: string;
  /** CSS aspect-ratio value, e.g. "4/5" or "1/1". Prevents CLS. Default: "4/5". */
  aspectRatio?: string;
  onClick?: () => void;
}

type ImageState = 'idle' | 'loading' | 'loaded' | 'error';

export function StorageImage({
  bucket,
  path,
  alt,
  className,
  aspectRatio = '4/5',
  onClick,
}: StorageImageProps) {
  const [state, setState] = useState<ImageState>('idle');
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hasTriggered = useRef(false);
  const retried = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const fetchSignedUrl = useCallback(async (forceRefresh = false) => {
    if (!path) return;
    if (!isMounted.current) return;

    setState('loading');

    const cacheKey = getCacheKey(bucket, path);

    if (!forceRefresh && signedUrlCache.has(cacheKey)) {
      const cached = signedUrlCache.get(cacheKey)!;
      if (isMounted.current) {
        setSignedUrl(cached);
        setState('loaded');
      }
      return;
    }

    // Legacy full URL — use as-is
    if (/^https?:\/\//.test(path)) {
      signedUrlCache.set(cacheKey, path);
      if (isMounted.current) {
        setSignedUrl(path);
        setState('loaded');
      }
      return;
    }

    const url = await getSignedStorageUrl(bucket, path);
    if (!isMounted.current) return;

    if (url) {
      signedUrlCache.set(cacheKey, url);
      setSignedUrl(url);
      setState('loaded');
    } else {
      setState('error');
    }
  }, [bucket, path]);

  // IntersectionObserver — fires fetchSignedUrl when image enters viewport
  useEffect(() => {
    if (!path || hasTriggered.current) return;

    const el = wrapperRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasTriggered.current) {
          // Debounce 100ms to avoid burst on rapid scroll
          if (debounceTimer.current) clearTimeout(debounceTimer.current);
          debounceTimer.current = setTimeout(() => {
            if (!hasTriggered.current) {
              hasTriggered.current = true;
              fetchSignedUrl();
            }
          }, 100);
        }
      },
      { rootMargin: '200px' } // Start loading slightly before visible
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [path, fetchSignedUrl]);

  const handleError = useCallback(() => {
    if (!retried.current) {
      retried.current = true;
      // Evict cache and retry with fresh signed URL
      if (path) signedUrlCache.delete(getCacheKey(bucket, path));
      fetchSignedUrl(true);
    } else {
      if (isMounted.current) setState('error');
    }
  }, [bucket, path, fetchSignedUrl]);

  // Early returns for empty path
  if (!path) return null;

  // Non-image file type → fall back to StorageLink
  if (isNonImagePath(path)) {
    return (
      <StorageLink bucket={bucket} storageRef={path} className={className}>
        {alt}
      </StorageLink>
    );
  }

  const wrapperStyle: React.CSSProperties = {
    aspectRatio,
    cursor: onClick ? 'pointer' : undefined,
  };

  return (
    <div
      ref={wrapperRef}
      className={[
        'relative overflow-hidden rounded',
        className,
      ].filter(Boolean).join(' ')}
      style={wrapperStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      aria-label={onClick ? alt : undefined}
    >
      {/* Skeleton state — shown until image loads */}
      {(state === 'idle' || state === 'loading') && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse rounded" />
      )}

      {/* Error state */}
      {state === 'error' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 rounded"
          title="Gagal memuat gambar"
        >
          <span className="text-gray-400 text-xl">⚠️</span>
          <span className="text-[9px] text-gray-400 mt-1">Gagal muat</span>
        </div>
      )}

      {/* Loaded state */}
      {state === 'loaded' && signedUrl && (
        <img
          src={signedUrl}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover rounded"
          onError={handleError}
          loading="lazy"
        />
      )}
    </div>
  );
}
