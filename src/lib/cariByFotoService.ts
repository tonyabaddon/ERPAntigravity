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

import { getBackendUrl } from './backendUrl';

export async function searchByPhoto(blob: Blob): Promise<{ results: SearchResult[] }> {
  const fd = new FormData();
  fd.append('photo', blob, 'query.jpg');
  const resp = await fetch(`${getBackendUrl()}/api/v1/products/search-by-photo`, {
    method: 'POST',
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku, photo_paths: photoPaths }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`index-photos ${resp.status}: ${text}`);
  }
  return resp.json();
}
