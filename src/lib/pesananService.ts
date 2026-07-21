import { supabase } from './supabaseClient';
import type { DbPesanan, RecordPesananPayload } from '../types';

export const pesananService = {
  async fetchAll(filter: { from?: string; to?: string; status?: string } = {}): Promise<DbPesanan[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase.from('pesanan')
      .select('*, suppliers(*), pesanan_items(*)')
      .order('created_at', { ascending: false });
    if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
    if (filter.from) q = q.gte('created_at', filter.from);
    if (filter.to) q = q.lte('created_at', filter.to);
    const { data, error } = await q;
    if (error) throw error;
    type PesananRow = Record<string, unknown> & { suppliers?: unknown; pesanan_items?: unknown[] | null };
    return (data ?? []).map((r: PesananRow) => ({ ...r, supplier: r.suppliers, items: r.pesanan_items ?? [] })) as unknown as DbPesanan[];
  },
  async fetchByNumber(num: string): Promise<DbPesanan | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('pesanan')
      .select('*, suppliers(*), pesanan_items(*)')
      .eq('pesanan_number', num).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown> & { suppliers?: unknown; pesanan_items?: unknown[] | null };
    return { ...row, supplier: row.suppliers, items: row.pesanan_items ?? [] } as unknown as DbPesanan;
  },
  async record(payload: RecordPesananPayload): Promise<{ pesanan_number: string; pesanan_id: string }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pesanan', { payload });
    if (error) throw error;
    return data as { pesanan_number: string; pesanan_id: string };
  },
  async markOrdered(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('mark_pesanan_ordered', { p_pesanan_id: id });
    if (error) throw error;
  },
  async update(id: string, payload: Omit<RecordPesananPayload,'initial_status'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_pesanan', { p_pesanan_id: id, payload });
    if (error) throw error;
  },
  async void(id: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pesanan', { p_pesanan_id: id, p_reason: reason });
    if (error) throw error;
  },
};
