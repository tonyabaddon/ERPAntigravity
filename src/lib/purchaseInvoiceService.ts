// src/lib/purchaseInvoiceService.ts
// BNL Phase 1 — service layer for purchase_invoices CRUD + COGS view fetch.
// Backend RPCs handle Kasir expense bookkeeping atomically; this layer is a
// thin wrapper.
// Also hosts fetchOpeningAPLines: reads opening_ap_lines from posted
// saldo_awal_snapshots for AP aging integration (Item #5).

import { supabase } from './supabaseClient';
import { decodeJwt } from './jwt';
import { getSignedStorageUrl } from './chatMediaSignedUrl';
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
    // Get tenant_id from JWT for tenant-prefixed path (RLS policy purchase_docs_insert_own_tenant)
    const { data: { session } } = await supabase.auth.getSession();
    const tenantId: string = (session ? (decodeJwt(session.access_token).tenant_id as string | undefined) : undefined) ?? '';
    if (!tenantId) throw new Error('Missing tenant_id in JWT — cannot upload attachment');
    // Path: tenants/{tenant_id}/purchase-invoices/{subPath}/{ts}-{filename}
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = `tenants/${tenantId}/purchase-invoices/${subPath}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('purchase-documents').upload(fullPath, file);
    if (error) throw error;
    // Return storage path — callers display via getSignedStorageUrl('purchase-documents', path)
    return fullPath;
  },

  /**
   * Resolve a purchase-documents storage reference to a signed URL.
   * Accepts both legacy full public URLs and new storage paths.
   */
  async getAttachmentUrl(pathOrUrl: string): Promise<string | null> {
    return getSignedStorageUrl('purchase-documents', pathOrUrl);
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

/**
 * BR7 — on-read payment due reminder.
 * Returns true if PI is BELUM_LUNAS and due_date is within [today, today+3] (inclusive).
 * Excludes Terlambat (already overdue) — those flow through isTerlambat instead.
 */
export function isDueSoon(pi: DbPurchaseInvoice, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (pi.status !== 'BELUM_LUNAS' || !pi.payment_due_at || pi.voided_at) return false;
  if (pi.payment_due_at < today) return false; // already terlambat
  const due = new Date(pi.payment_due_at + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffDays = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= 3;
}

export function shortOrderRef(orderId: string | null | undefined): string {
  if (!orderId) return '—';
  return 'ORD-' + orderId.slice(0, 8).toUpperCase();
}

// ── Opening AP lines (Item #5) ────────────────────────────────────────────────
// AP payables entered via the Saldo Awal wizard (detail mode).
// Only from snapshots that are posted and not reversed.
// amount = full outstanding balance (no paid_amount column on opening lines).
// original_due_date used for aging; NULL = no due date, excluded from overdue.
export interface OpeningAPLine {
  id: string;
  snapshot_id: string;
  supplier_id: string | null;
  supplier_name: string;
  amount: number;
  original_due_date: string | null;  // ISO date or null
  invoice_ref: string | null;
  notes: string | null;
}

export async function fetchOpeningAPLines(): Promise<OpeningAPLine[]> {
  if (!supabase) return [];
  // RLS p_select_own on opening_ap_lines gates to tenant automatically.
  // Join to saldo_awal_snapshots to filter posted+not-reversed.
  const { data, error } = await supabase
    .from('opening_ap_lines')
    .select(`
      id,
      snapshot_id,
      supplier_id,
      supplier_name,
      amount,
      original_due_date,
      invoice_ref,
      notes,
      saldo_awal_snapshots!inner(status, reversed_at)
    `)
    .eq('saldo_awal_snapshots.status', 'posted')
    .is('saldo_awal_snapshots.reversed_at', null);
  if (error) return [];
  return (data ?? []).map((row: any) => ({
    id: row.id,
    snapshot_id: row.snapshot_id,
    supplier_id: row.supplier_id ?? null,
    supplier_name: row.supplier_name,
    amount: Number(row.amount),
    original_due_date: row.original_due_date ?? null,
    invoice_ref: row.invoice_ref ?? null,
    notes: row.notes ?? null,
  }));
}
