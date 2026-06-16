// src/lib/piutangService.ts
// Piutang Phase 1B — frontend service layer for tempo invoices.
//
// Wraps:
// - create_tempo_invoice RPC (atomic check + create; surfaces credit_limit_exceeded
//   into a typed discriminated result for the over-limit modal)
// - mark_tempo_invoice_paid (UPDATE orders SET status='PAYMENT_VERIFIED'; no RPC
//   needed — DB grant already allows authenticated UPDATE per existing RLS)
// - fetchPiutangRows: joined query of INVOICE_TEMPO orders + their customer for
//   the Piutang screen; tiers them by daysToDue.

import { supabase } from './supabaseClient';
import type {
  CreateTempoInvoicePayload,
  CreateTempoInvoiceResult,
  DbCustomer,
  DbOrder,
  PiutangRow,
  PiutangTier,
} from '../types';

// ── Tier classification ──
export const PIUTANG_TIERS: Record<PiutangTier['key'], PiutangTier> = {
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    rowBg: 'bg-red-50/70',
    badgeClass: 'bg-red-100 text-red-800',
  },
  today: {
    key: 'today',
    label: 'Due Hari Ini',
    rowBg: 'bg-orange-50/70',
    badgeClass: 'bg-orange-100 text-orange-800',
  },
  h3: {
    key: 'h3',
    label: 'H-3',
    rowBg: 'bg-yellow-50/70',
    badgeClass: 'bg-yellow-100 text-yellow-800',
  },
  future: {
    key: 'future',
    label: 'Akan Datang',
    rowBg: 'bg-white',
    badgeClass: 'bg-gray-100 text-gray-700',
  },
};

export function classifyTier(daysToDue: number): PiutangTier['key'] {
  if (daysToDue < 0) return 'overdue';
  if (daysToDue === 0) return 'today';
  if (daysToDue <= 3) return 'h3';
  return 'future';
}

function todayWIB(): string {
  // Jakarta = UTC+7
  const now = new Date(Date.now() + 7 * 3600_000);
  return now.toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

// ── RPC: create_tempo_invoice ──
// Parses the credit_limit_exceeded error message ("outstanding=X, new=Y, limit=Z")
// into a typed result the over-limit modal can render directly.
export async function createTempoInvoice(payload: CreateTempoInvoicePayload): Promise<CreateTempoInvoiceResult> {
  if (!supabase) return { kind: 'invalid', message: 'Supabase not configured' };
  const { data, error } = await supabase.rpc('create_tempo_invoice', { p_payload: payload });

  if (!error) {
    return { kind: 'ok', order_id: String(data) };
  }

  const msg = error.message ?? '';
  if (msg.startsWith('credit_limit_exceeded')) {
    // Server format: "credit_limit_exceeded: outstanding=X, new=Y, limit=Z"
    const m = msg.match(/outstanding=([\d.]+),\s*new=([\d.]+),\s*limit=([\d.]+)/);
    if (m) {
      const outstanding = parseFloat(m[1]);
      const newAmount = parseFloat(m[2]);
      const limit = parseFloat(m[3]);
      return {
        kind: 'credit_limit_exceeded',
        outstanding,
        new_amount: newAmount,
        limit,
        shortage: outstanding + newAmount - limit,
      };
    }
    return { kind: 'credit_limit_exceeded', outstanding: 0, new_amount: payload.total, limit: 0, shortage: payload.total };
  }
  if (msg.startsWith('tempo_not_enabled')) return { kind: 'tempo_not_enabled' };
  return { kind: 'invalid', message: msg };
}

// ── Upload payment proof to storage ──
// Pattern matches purchaseInvoiceService.uploadAttachment but writes to the
// `payment-proofs` bucket (existing — see 20260604000012_storage_authenticated_policies.sql),
// path prefix tempo-payments/{orderId}/ so audit is trivial.
export const TEMPO_PROOF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const TEMPO_PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png';
const TEMPO_PROOF_MIME = /^(image\/(jpe?g|png)|application\/pdf)$/i;

export function validateTempoProofFile(file: File): string | null {
  if (file.size > TEMPO_PROOF_MAX_BYTES) {
    return `File terlalu besar (max 5 MB, file ini ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  if (!TEMPO_PROOF_MIME.test(file.type) && !/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    return 'Tipe file tidak didukung. Gunakan PDF, JPG, atau PNG.';
  }
  return null;
}

export async function uploadTempoPaymentProof(file: File, orderId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const err = validateTempoProofFile(file);
  if (err) throw new Error(err);
  // Sanitize filename: keep ext, replace any non-[A-Za-z0-9._-] with _
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `tempo-payments/${orderId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('payment-proofs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('payment-proofs').getPublicUrl(path);
  return data.publicUrl;
}

// ── Mark tempo invoice paid ──
// No new RPC needed; reuse existing payment-verify path via direct UPDATE.
// (RLS allows authenticated UPDATE on orders for verifiers; matches existing
// mark_walkin_order_paid pattern.)
export async function markTempoInvoicePaid(orderId: string, proofUrl: string | null, verifiedByUserId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'PAYMENT_VERIFIED',
      payment_verified_at: new Date().toISOString(),
      verified_by: verifiedByUserId,
      full_proof_url: proofUrl ?? undefined,
    })
    .eq('id', orderId)
    .eq('status', 'INVOICE_TEMPO'); // guard: only flip when still open tempo
  if (error) throw error;
}

// ── Query: outstanding tempo orders + their customers ──
export async function fetchPiutangRows(): Promise<PiutangRow[]> {
  if (!supabase) return [];
  // Fetch open tempo orders. Customer joined via a 2nd query keyed by id (since
  // orders.customer_id is text, not always uuid-clean; we fetch all referenced
  // customers in a single IN query).
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('payment_type', 'TEMPO')
    .eq('status', 'INVOICE_TEMPO')
    .order('due_date', { ascending: true });
  if (oErr) throw oErr;

  const orderRows = (orders ?? []) as DbOrder[];
  if (orderRows.length === 0) return [];

  // Try to load customers — IDs may be UUIDs or legacy string IDs; cast both.
  const ids = Array.from(new Set(orderRows.map(o => o.customer_id).filter(Boolean))) as string[];
  let customerMap = new Map<string, DbCustomer>();
  if (ids.length > 0) {
    const { data: customers } = await supabase.from('customers').select('*').in('id', ids);
    customerMap = new Map(((customers ?? []) as DbCustomer[]).map(c => [c.id, c]));
  }

  const today = todayWIB();
  return orderRows.map(o => {
    const due = o.due_date ?? today;
    const daysToDue = daysBetween(today, due);
    return {
      order: o,
      customer: o.customer_id ? customerMap.get(o.customer_id) : undefined,
      daysToDue,
      tier: classifyTier(daysToDue),
    };
  });
}

// ── KPI computation ──
export interface PiutangKpi {
  totalPiutang: number;
  totalCount: number;
  overdueAmount: number;
  overdueCount: number;
  todayAmount: number;
  todayCount: number;
  h3Amount: number;
  h3Count: number;
}

export function computeKpi(rows: PiutangRow[]): PiutangKpi {
  const acc = {
    totalPiutang: 0, totalCount: 0,
    overdueAmount: 0, overdueCount: 0,
    todayAmount: 0, todayCount: 0,
    h3Amount: 0, h3Count: 0,
  };
  for (const r of rows) {
    acc.totalPiutang += r.order.total;
    acc.totalCount += 1;
    if (r.tier === 'overdue') { acc.overdueAmount += r.order.total; acc.overdueCount += 1; }
    if (r.tier === 'today')   { acc.todayAmount   += r.order.total; acc.todayCount   += 1; }
    if (r.tier === 'h3')      { acc.h3Amount      += r.order.total; acc.h3Count      += 1; }
  }
  return acc;
}

// ── AR Aging bucket computation ──
// Reads aging_buckets array from piutang_settings (default [30, 60, 90]).
// Produces segments [0-30, 31-60, 61-90, >90] (4 segments for 3 boundaries).
export interface AgingSegment {
  label: string;      // e.g., "0–30 hari"
  count: number;
  amount: number;
  color: string;      // hex
}

const SEGMENT_COLORS = ['#10b981', '#f59e0b', '#fb923c', '#ef4444']; // green, yellow, orange, red

export function computeAging(rows: PiutangRow[], buckets: number[] = [30, 60, 90]): AgingSegment[] {
  const sorted = [...buckets].sort((a, b) => a - b);
  const segments: AgingSegment[] = [];
  let prev = 0;
  for (let i = 0; i < sorted.length; i++) {
    segments.push({
      label: i === 0 ? `0–${sorted[i]} hari` : `${prev + 1}–${sorted[i]} hari`,
      count: 0, amount: 0,
      color: SEGMENT_COLORS[i] ?? '#6b7280',
    });
    prev = sorted[i];
  }
  segments.push({
    label: `>${sorted[sorted.length - 1]} hari`,
    count: 0, amount: 0,
    color: SEGMENT_COLORS[sorted.length] ?? '#7f1d1d',
  });

  for (const r of rows) {
    const overdueDays = -r.daysToDue; // overdueDays > 0 means past due
    if (overdueDays < 0) continue;     // not yet overdue — exclude from aging
    let idx = sorted.findIndex(b => overdueDays <= b);
    if (idx === -1) idx = sorted.length;
    segments[idx].count += 1;
    segments[idx].amount += r.order.total;
  }
  return segments;
}

// ── Sidebar badge: count of overdue ──
export async function fetchOverdueCount(): Promise<number> {
  if (!supabase) return 0;
  const today = todayWIB();
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('payment_type', 'TEMPO')
    .eq('status', 'INVOICE_TEMPO')
    .lt('due_date', today);
  if (error) return 0;
  return count ?? 0;
}
