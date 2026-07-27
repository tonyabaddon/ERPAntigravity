import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import type { KasirExpenseCategoryRow } from '../kasirExpenseCategoryService';

export function kasirExpenseCategoriesQueryKey(tenantId: string): unknown[] {
  return ['kasir-expense-categories', tenantId];
}

export function useKasirExpenseCategories() {
  // useTenant() returns TenantContextValue | null; property is tenant_id (not tenantId)
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  return useQuery<KasirExpenseCategoryRow[]>({
    queryKey: kasirExpenseCategoriesQueryKey(tenantId ?? 'unknown'),
    enabled: Boolean(tenantId && supabase),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!supabase) throw new Error('supabase not configured');
      const { data, error } = await supabase
        .from('kasir_expense_categories')
        .select('*')
        .is('deleted_at', null)
        .eq('is_system', false)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return (data ?? []) as KasirExpenseCategoryRow[];
    },
  });
}
