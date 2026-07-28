import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import KasirExpenseCategoriesPanel from './KasirExpenseCategoriesPanel';

vi.mock('../../lib/hooks/useKasirExpenseCategories', () => ({
  useKasirExpenseCategories: vi.fn(),
  kasirExpenseCategoriesQueryKey: (t: string) => ['kasir-expense-categories', t],
}));
vi.mock('../../lib/kasirExpenseCategoryService', () => ({
  kasirExpenseCategoryService: {
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    restore: vi.fn(),
    reorder: vi.fn(),
  },
}));
// Adapt: real TenantContext uses tenant_id (not tenantId). Mock matches real shape.
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ tenant_id: 't1' }),
}));

import { useKasirExpenseCategories } from '../../lib/hooks/useKasirExpenseCategories';
import { kasirExpenseCategoryService } from '../../lib/kasirExpenseCategoryService';

const mockHook = useKasirExpenseCategories as ReturnType<typeof vi.fn>;
const mockSvc = kasirExpenseCategoryService as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  reorder: ReturnType<typeof vi.fn>;
};

const seedRows = [
  { id: 'r1', tenant_id: 't', label: 'Gaji',     sort_order: 10, active: true,  is_system: false, deleted_at: null, created_at: '', updated_at: '' },
  { id: 'r2', tenant_id: 't', label: 'Utilitas', sort_order: 20, active: false, is_system: false, deleted_at: null, created_at: '', updated_at: '' },
];

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('KasirExpenseCategoriesPanel', () => {
  beforeEach(() => {
    mockHook.mockReset();
    Object.values(mockSvc).forEach(fn => fn.mockReset());
  });

  it('renders rows from hook', () => {
    mockHook.mockReturnValue({ data: seedRows, isLoading: false, isError: false });
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={vi.fn()} />);
    expect(screen.getByText('Gaji')).toBeInTheDocument();
    expect(screen.getByText('Utilitas')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={vi.fn()} />);
    expect(screen.getByText(/Memuat/i)).toBeInTheDocument();
  });

  it('shows error state with retry', () => {
    const refetch = vi.fn();
    mockHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={vi.fn()} />);
    expect(screen.getByText(/Gagal memuat/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('click "Tambah kategori" opens inline input, Enter creates', async () => {
    mockHook.mockReturnValue({ data: seedRows, isLoading: false, isError: false, refetch: vi.fn() });
    mockSvc.create.mockResolvedValue({ ...seedRows[0], id: 'r3', label: 'Sewa' });
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Tambah kategori/i }));
    const input = screen.getByPlaceholderText(/Nama kategori/i);
    fireEvent.change(input, { target: { value: 'Sewa' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockSvc.create).toHaveBeenCalledWith('Sewa', undefined));
  });

  it('duplicate error surfaces inline toast', async () => {
    const toast = vi.fn();
    mockHook.mockReturnValue({ data: seedRows, isLoading: false, isError: false, refetch: vi.fn() });
    mockSvc.create.mockRejectedValue(new Error('KECT_LABEL_DUPLICATE'));
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={toast} />);
    fireEvent.click(screen.getByRole('button', { name: /Tambah kategori/i }));
    const input = screen.getByPlaceholderText(/Nama kategori/i);
    fireEvent.change(input, { target: { value: 'Gaji' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/sudah ada/i), 'warning'));
  });

  it('delete triggers softDelete + undo toast', async () => {
    const toast = vi.fn();
    mockHook.mockReturnValue({ data: seedRows, isLoading: false, isError: false, refetch: vi.fn() });
    mockSvc.softDelete.mockResolvedValue(seedRows[0]);
    wrap(<KasirExpenseCategoriesPanel isEditable showToast={toast} />);
    fireEvent.click(screen.getByLabelText('Hapus kategori Gaji'));
    await waitFor(() => expect(mockSvc.softDelete).toHaveBeenCalledWith('r1'));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/dihapus/i), 'info');
  });

  it('read-only mode disables interactive elements', () => {
    mockHook.mockReturnValue({ data: seedRows, isLoading: false, isError: false });
    wrap(<KasirExpenseCategoriesPanel isEditable={false} showToast={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Tambah kategori/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hapus kategori/)).not.toBeInTheDocument();
  });
});
