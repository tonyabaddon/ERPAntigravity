import { supabase } from './supabaseClient';

export interface KasirExpenseCategoryRow {
  id: string;
  tenant_id: string;
  label: string;
  sort_order: number;
  active: boolean;
  is_system: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('unexpected null RPC result');
  return res.data;
}

export const kasirExpenseCategoryService = {
  async create(label: string, insertAfterId?: string): Promise<KasirExpenseCategoryRow> {
    if (!supabase) throw new Error('supabase not configured');
    const res = await supabase.rpc('kasir_expense_category_create', {
      p_label: label.trim(),
      p_insert_after_id: insertAfterId ?? null,
    });
    return unwrap(res);
  },

  async update(
    id: string,
    patch: { label?: string; active?: boolean }
  ): Promise<KasirExpenseCategoryRow> {
    if (!supabase) throw new Error('supabase not configured');
    const res = await supabase.rpc('kasir_expense_category_update', {
      p_id: id,
      p_label: patch.label ?? null,
      p_active: patch.active ?? null,
    });
    return unwrap(res);
  },

  async softDelete(id: string): Promise<KasirExpenseCategoryRow> {
    if (!supabase) throw new Error('supabase not configured');
    const res = await supabase.rpc('kasir_expense_category_soft_delete', { p_id: id });
    return unwrap(res);
  },

  async restore(id: string): Promise<KasirExpenseCategoryRow> {
    if (!supabase) throw new Error('supabase not configured');
    const res = await supabase.rpc('kasir_expense_category_restore', { p_id: id });
    return unwrap(res);
  },

  async reorder(orderedIds: string[]): Promise<KasirExpenseCategoryRow[]> {
    if (!supabase) throw new Error('supabase not configured');
    const res = await supabase.rpc('kasir_expense_categories_reorder', {
      p_ordered_ids: orderedIds,
    });
    return unwrap(res);
  },
};
