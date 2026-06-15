// src/lib/purchaseInvoiceService.ts
// BNL Phase 1 — service layer for purchase_invoices CRUD + COGS view fetch.
// Backend RPCs handle Kasir expense bookkeeping atomically; this layer is a
// thin wrapper.

import { supabase } from './supabaseClient';
import type {
  DbPurchaseInvoice, RecordPiPayload, OrderCogsBreakdownRow,
} from '../types';

type RecordPiResult =
  | { kind: 'ok'; pi_number: string; pi_id: string }
  | { kind: 'duplicate_warning'; existing_pi: string };

export const purchaseInvoiceService = {
  async fetchAll(filter: { from?: string; to?: string; status?: string; type?: 'PASSTHROUGH' | 'STOCK' } = {}): Promise<DbPurchaseInvoice[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), orders(id, customer_name), purchase_invoice_items(*)')
      .order('created_at', { ascending: false });
    if (filter.type) q = q.eq('type', filter.type);
    if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
    if (filter.from) q = q.gte('purchase_date', filter.from);
    if (filter.to) q = q.lte('purchase_date', filter.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row,
      supplier: row.suppliers,
      order: row.orders ?? undefined,
      items: row.purchase_invoice_items ?? [],
    })) as DbPurchaseInvoice[];
  },

  async fetchByNumber(piNumber: string): Promise<DbPurchaseInvoice | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), orders(id, customer_name), purchase_invoice_items(*)')
      .eq('pi_number', piNumber).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...(data as any),
      supplier: (data as any).suppliers,
      order: (data as any).orders ?? undefined,
      items: (data as any).purchase_invoice_items ?? [],
    } as DbPurchaseInvoice;
  },

  async fetchByOrderId(orderId: string): Promise<DbPurchaseInvoice[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), purchase_invoice_items(*)')
      .eq('order_id', orderId)
      .is('voided_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row, supplier: row.suppliers, items: row.purchase_invoice_items ?? [],
    })) as DbPurchaseInvoice[];
  },

  async record(payload: RecordPiPayload): Promise<RecordPiResult> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_pi', { payload });
    if (error) throw error;
    if (data && (data as any).warning === 'duplicate_supplier_invoice') {
      return { kind: 'duplicate_warning', existing_pi: (data as any).existing_pi };
    }
    return { kind: 'ok', pi_number: (data as any).pi_number, pi_id: (data as any).pi_id };
  },

  async markPaid(piId: string, proofUrl?: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('mark_pi_paid', { p_pi_id: piId, p_proof_url: proofUrl ?? null });
    if (error) throw error;
  },

  async void(piId: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('void_pi', { p_pi_id: piId, p_reason: reason });
    if (error) throw error;
  },

  async update(piId: string, payload: Omit<RecordPiPayload, 'initial_status' | 'ignore_duplicate_warning'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_pi', { p_pi_id: piId, payload });
    if (error) throw error;
  },

  async uploadAttachment(file: File, subPath: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const fullPath = `purchase-invoices/${subPath}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('purchase-documents').upload(fullPath, file);
    if (error) throw error;
    const { data } = supabase.storage.from('purchase-documents').getPublicUrl(fullPath);
    return data.publicUrl;
  },

  async fetchCogsForOrder(orderId: string): Promise<OrderCogsBreakdownRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('order_cogs_breakdown').select('*').eq('order_id', orderId);
    if (error) throw error;
    return (data ?? []) as OrderCogsBreakdownRow[];
  },
};

export function isTerlambat(pi: DbPurchaseInvoice, today: string = new Date().toISOString().slice(0, 10)): boolean {
  return pi.status === 'BELUM_LUNAS' && !!pi.payment_due_at && pi.payment_due_at < today;
}

export function shortOrderRef(orderId: string | null | undefined): string {
  if (!orderId) return '—';
  return 'ORD-' + orderId.slice(0, 8).toUpperCase();
}
