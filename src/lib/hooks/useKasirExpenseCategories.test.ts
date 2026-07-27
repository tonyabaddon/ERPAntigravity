import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useKasirExpenseCategories, kasirExpenseCategoriesQueryKey } from './useKasirExpenseCategories';

vi.mock('../supabaseClient', () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockResolvedValue({
      data: [
        { id: 'a', label: 'Gaji', sort_order: 10, active: true,  is_system: false, deleted_at: null },
        { id: 'b', label: 'Sewa', sort_order: 20, active: false, is_system: false, deleted_at: null },
      ],
      error: null,
    }),
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

// Mock returns actual TenantContextValue shape: tenant_id (not tenantId)
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ tenant_id: 't1' }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe('useKasirExpenseCategories', () => {
  it('fetches active + inactive user-facing categories, sorted', async () => {
    const { result } = renderHook(() => useKasirExpenseCategories(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].label).toBe('Gaji');
  });

  it('kasirExpenseCategoriesQueryKey is stable per tenant', () => {
    const k1 = kasirExpenseCategoriesQueryKey('t1');
    const k2 = kasirExpenseCategoriesQueryKey('t1');
    expect(k1).toEqual(k2);
    expect(kasirExpenseCategoriesQueryKey('t2')).not.toEqual(k1);
  });
});
