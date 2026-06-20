// Tukar Faktur (Phase 2b) — CRUD + RPC wrappers.
// Status derived client-side from paid_amount vs total_amount per spec §6.
import { supabase } from './supabaseClient';
import type {
  DbTukarFaktur,
  RecordTukarFakturPayload,
  UpdateTukarFakturPayload,
  TukarFakturStatus,
} from '../types';

function deriveStatus(tf: {
  paid_amount: number;
  total_amount: number;
  voided_at: string | null;
}): TukarFakturStatus {
  if (tf.voided_at) return 'VOIDED';
  if (Number(tf.paid_amount) === 0) return 'BELUM_LUNAS';
  if (Number(tf.paid_amount) < Number(tf.total_amount)) return 'DIBAYAR_SEBAGIAN';
  return 'LUNAS';
}

export const tukarFakturService = {
  async fetchAll(): Promise<DbTukarFaktur[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('tukar_faktur')
      .select(`
        id, tf_number, supplier_id, tukar_date, payment_due_at,
        total_amount, paid_amount, photo_urls, tanda_terima_printed_at,
        notes, created_at, updated_at, voided_at,
        supplier:suppliers(id, name, payment_term_days),
        tagihans:purchase_invoices(id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, paid_amount, is_tf_quick_add)
      `)
      .order('tukar_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row,
      supplier: Array.isArray(row.supplier) ? row.supplier[0] : row.supplier,
      tagihans: row.tagihans ?? [],
      status: deriveStatus(row),
    }));
  },

  async fetchByNumber(tf_number: string): Promise<DbTukarFaktur | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('tukar_faktur')
      .select(`
        id, tf_number, supplier_id, tukar_date, payment_due_at,
        total_amount, paid_amount, photo_urls, tanda_terima_printed_at,
        notes, created_at, updated_at, voided_at,
        supplier:suppliers(id, name, payment_term_days)
      `)
      .eq('tf_number', tf_number)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row: any = data;

    // Fetch bundled Tagihans separately for clean shape
    const { data: tagihans, error: tagErr } = await supabase
      .from('purchase_invoices')
      .select('id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, paid_amount, is_tf_quick_add')
      .eq('tukar_faktur_id', row.id)
      .is('voided_at', null);
    if (tagErr) throw tagErr;

    return {
      ...row,
      supplier: Array.isArray(row.supplier) ? row.supplier[0] : row.supplier,
      tagihans: tagihans ?? [],
      status: deriveStatus(row),
    } as DbTukarFaktur;
  },

  async record(payload: RecordTukarFakturPayload): Promise<{ tf_number: string; tf_id: string }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_tukar_faktur', { payload });
    if (error) throw error;
    return data as { tf_number: string; tf_id: string };
  },

  async update(p_tf_id: string, payload: UpdateTukarFakturPayload) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('update_tukar_faktur', { p_tf_id, payload });
    if (error) throw error;
    return data;
  },

  async addTagihan(p_tf_id: string, p_tagihan_id: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('add_tagihan_to_tf', { p_tf_id, p_tagihan_id });
    if (error) throw error;
    return data;
  },

  async removeTagihan(p_tf_id: string, p_tagihan_id: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('remove_tagihan_from_tf', { p_tf_id, p_tagihan_id });
    if (error) throw error;
    return data;
  },

  async delete(p_tf_id: string, p_reason: string = 'manual') {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('delete_tukar_faktur', { p_tf_id, p_reason });
    if (error) throw error;
    return data;
  },

  async markPrinted(p_tf_id: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('tukar_faktur')
      .update({ tanda_terima_printed_at: new Date().toISOString() })
      .eq('id', p_tf_id);
    if (error) throw error;
  },

  /** Lookup outstanding Tagihans for a supplier, excluding those already in `excludeIds`. */
  async fetchOutstandingTagihansForTf(supplier_id: string, excludeIds: string[] = []) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, paid_amount')
      .eq('supplier_id', supplier_id)
      .eq('type', 'STOCK')
      .in('status', ['BELUM_LUNAS', 'DIBAYAR_SEBAGIAN'])
      .is('voided_at', null)
      .is('tukar_faktur_id', null);
    if (error) throw error;
    return (data ?? []).filter((t: { id: string }) => !excludeIds.includes(t.id));
  },
};
