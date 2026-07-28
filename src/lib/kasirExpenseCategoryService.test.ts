import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kasirExpenseCategoryService } from './kasirExpenseCategoryService';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;

describe('kasirExpenseCategoryService', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('create calls kasir_expense_category_create with trimmed label', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1', label: 'Sewa', active: true }, error: null });
    const row = await kasirExpenseCategoryService.create('  Sewa  ');
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_category_create', {
      p_label: 'Sewa',
      p_insert_after_id: null,
    });
    expect(row.id).toBe('r1');
  });

  it('create passes insertAfterId when given', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r2' }, error: null });
    await kasirExpenseCategoryService.create('X', 'after-id');
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_category_create', {
      p_label: 'X',
      p_insert_after_id: 'after-id',
    });
  });

  it('create throws with KECT code parsed from PG error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'KECT_LABEL_DUPLICATE' } });
    await expect(kasirExpenseCategoryService.create('Sewa')).rejects.toThrow('KECT_LABEL_DUPLICATE');
  });

  it('update passes only provided fields', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1' }, error: null });
    await kasirExpenseCategoryService.update('r1', { label: 'New' });
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_category_update', {
      p_id: 'r1', p_label: 'New', p_active: null,
    });
  });

  it('softDelete + restore call correct RPCs', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1' }, error: null });
    await kasirExpenseCategoryService.softDelete('r1');
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_category_soft_delete', { p_id: 'r1' });
    await kasirExpenseCategoryService.restore('r1');
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_category_restore', { p_id: 'r1' });
  });

  it('reorder passes uuid array', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    const rows = await kasirExpenseCategoryService.reorder(['a', 'b']);
    expect(mockRpc).toHaveBeenCalledWith('kasir_expense_categories_reorder', {
      p_ordered_ids: ['a', 'b'],
    });
    expect(rows.length).toBe(2);
  });
});
