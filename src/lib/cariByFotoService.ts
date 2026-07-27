import { supabase } from './supabaseClient';
import { getBackendUrl } from './backendUrl';

export interface SearchResult {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  min_stock: number;
  photo_url: string;
  similarity: number;
  warehouse_stock: Record<string, number>;
}

// Backend expects the caller's tenant_id via the JWT Authorization header
// (extracted server-side via api.ExtractJWTClaims with HS256 verification).
// Missing header → searchByPhoto returns empty results (safe default;
// prevents cross-tenant leak). indexPhotos returns 401 (rejected outright —
// the only caller is ProductForm which always has a logged-in session).
//
// If getSession() returns null we try refreshSession() once before giving up —
// covers the common case where the access_token expired mid-session but the
// refresh_token is still valid. If both fail, throw SESSION_EXPIRED so the
// caller (ProductForm) can surface a re-login prompt instead of firing an
// un-authed POST that returns silent-empty results.
async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  const refresh = await supabase.auth.refreshSession();
  if (refresh.data.session?.access_token) {
    return { Authorization: `Bearer ${refresh.data.session.access_token}` };
  }
  throw new Error('SESSION_EXPIRED: silakan login ulang untuk pakai Cari by Foto');
}

export async function searchByPhoto(blob: Blob): Promise<{ results: SearchResult[] }> {
  const fd = new FormData();
  fd.append('photo', blob, 'query.jpg');
  const resp = await fetch(`${getBackendUrl()}/api/v1/products/search-by-photo`, {
    method: 'POST',
    headers: await authHeader(),
    body: fd,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`search-by-photo ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return { ...data, results: data.results ?? [] };
}

export async function indexPhotos(sku: string, photoPaths: string[]): Promise<{ indexed: number; error?: string }> {
  const resp = await fetch(`${getBackendUrl()}/api/v1/products/index-photos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ sku, photo_paths: photoPaths }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`index-photos ${resp.status}: ${text}`);
  }
  return resp.json();
}
