import { describe, it, expect } from 'vitest';
import { compressImage, PRE_COMPRESS_MAX_BYTES } from './productPhotoService';

function fakeImageFile(sizeBytes: number, type = 'image/png'): File {
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], 'x.png', { type });
}

describe('compressImage', () => {
  it('rejects non-image', async () => {
    const f = new File([new Uint8Array(10)], 'x.txt', { type: 'text/plain' });
    await expect(compressImage(f)).rejects.toThrow(/gambar/);
  });

  it('rejects > 5MB pre-compress', async () => {
    const f = fakeImageFile(PRE_COMPRESS_MAX_BYTES + 1);
    await expect(compressImage(f)).rejects.toThrow(/terlalu besar/);
  });
});
