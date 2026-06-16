import { describe, it, expect } from 'vitest';
import { MIN_PHOTOS, MAX_PHOTOS } from '../../lib/productPhotoService';

function validatePhotoCount(n: number): { ok: boolean; msg?: string } {
  if (n < MIN_PHOTOS) return { ok: false, msg: 'Minimal 1 foto produk wajib.' };
  if (n > MAX_PHOTOS) return { ok: false, msg: 'Maksimal 5 foto.' };
  return { ok: true };
}

describe('validatePhotoCount', () => {
  it('rejects 0', () => expect(validatePhotoCount(0).ok).toBe(false));
  it('accepts 1', () => expect(validatePhotoCount(1).ok).toBe(true));
  it('accepts 5', () => expect(validatePhotoCount(5).ok).toBe(true));
  it('rejects 6', () => expect(validatePhotoCount(6).ok).toBe(false));
});
