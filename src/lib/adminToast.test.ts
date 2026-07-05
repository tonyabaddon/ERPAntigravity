import { describe, it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { adminToast } from './adminToast';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('adminToast', () => {
  it('forwards success calls to sonner', () => {
    adminToast.success('Tersimpan', 'Berhasil disimpan');
    expect(toast.success).toHaveBeenCalledWith('Tersimpan', { description: 'Berhasil disimpan' });
  });
  it('forwards error calls without description', () => {
    adminToast.error('Gagal');
    expect(toast.error).toHaveBeenCalledWith('Gagal', { description: undefined });
  });
  it('forwards info calls', () => {
    adminToast.info('Info', 'Detail informasi');
    expect(toast.info).toHaveBeenCalledWith('Info', { description: 'Detail informasi' });
  });
});
