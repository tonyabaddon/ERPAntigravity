// src/lib/productPhotoService.ts
import { supabase } from './supabaseClient';
import type { ProductPhotoSearchResponse } from '../types';

export const MAX_PHOTOS = 5;
export const MIN_PHOTOS = 0;
export const PRE_COMPRESS_MAX_BYTES = 5 * 1024 * 1024;
export const COMPRESS_LONGEST_DIM = 1024;
export const COMPRESS_JPEG_QUALITY = 0.75;

export type CompressResult = { blob: Blob; width: number; height: number };

/**
 * Resize image to <= COMPRESS_LONGEST_DIM on longest axis and re-encode as JPEG.
 * Throws if input exceeds PRE_COMPRESS_MAX_BYTES or not an image.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar');
  }
  if (file.size > PRE_COMPRESS_MAX_BYTES) {
    throw new Error('File terlalu besar. Max 5MB sebelum compress.');
  }
  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > COMPRESS_LONGEST_DIM ? COMPRESS_LONGEST_DIM / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia');
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Compress gagal'))), 'image/jpeg', COMPRESS_JPEG_QUALITY)
  );
  return { blob, width: w, height: h };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/**
 * Upload compressed photo to product-photos bucket at `{sku}/{order}.jpg`.
 * Returns public URL + storage path.
 */
export async function uploadProductPhoto(
  sku: string,
  order: number,
  blob: Blob
): Promise<{ url: string; path: string }> {
  const path = `${sku}/${order}.jpg`;
  const { error: upErr } = await supabase.storage
    .from('product-photos')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('product-photos').getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Delete photo object (no DB cleanup here; caller updates stocks.photo_urls).
 */
export async function deleteProductPhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from('product-photos').remove([path]);
  if (error) throw error;
}

/**
 * Backend search-by-photo endpoint (filled in Phase 3).
 * For now stub: throws so callers can be wired in Phase 4.
 */
export async function searchByPhoto(_blob: Blob): Promise<ProductPhotoSearchResponse> {
  throw new Error('searchByPhoto not yet wired; Phase 3');
}

/**
 * Request backend to (re)index a product's photos.
 * Filled in Phase 3.
 */
export async function indexProductPhotos(_sku: string, _photoPaths: string[]): Promise<void> {
  throw new Error('indexProductPhotos not yet wired; Phase 3');
}

/**
 * Request backend to describe a single product photo (for "Generate dari Foto").
 * Filled in Phase 3.
 */
export async function describeProductPhoto(_blob: Blob): Promise<string> {
  throw new Error('describeProductPhoto not yet wired; Phase 3');
}
