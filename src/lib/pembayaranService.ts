import { supabase } from './supabaseClient';
import type { DbPembayaran, RecordPembayaranPayload, SuggestOutstandingTagihanRow, ApDashboardLite } from '../types';

export const pembayaranService = {
  async fetchAll(filter: { supplierId?: string; status?: string } = {}): Promise<DbPembayaran[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase.from('pembayaran')
      .select('*, suppliers(*), pembayaran_items(*)')
      .order('paid_at', { ascending: false });
    if (filter.supplierId) q = q.eq('supplier_id', filter.supplierId);
    if (filter.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ ...r, supplier: r.suppliers, items: r.pembayaran_items ?? [] }));
  },
  async fetchByNumber(num: string): Promise<DbPembayaran | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('pembayaran')
      .select('*, suppliers(*), pembayaran_items(*)')
      .eq('pembayaran_number', num).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...(data as any), supplier: (data as any).suppliers, items: (data as any).pembayaran_items ?? [] };
  },
  async record(payload: RecordPembayaranPayload): Promise<{ pembayaran_number: string; pembayaran_id: string }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pembayaran', { payload });
    if (error) throw error;
    return data as any;
  },
  async void(id: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pembayaran', { p_pembayaran_id: id, p_reason: reason });
    if (error) throw error;
  },
  async suggestOutstanding(supplierId: string): Promise<SuggestOutstandingTagihanRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('pembayaran_suggest_outstanding', { p_supplier_id: supplierId });
    if (error) throw error;
    return (data as any)?.tagihan ?? [];
  },
  async fetchDashboardLite(): Promise<ApDashboardLite> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('ap_dashboard_lite');
    if (error) throw error;
    return data as ApDashboardLite;
  },
};
