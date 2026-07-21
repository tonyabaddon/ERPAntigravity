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
// - fetchOpeningARLines: reads opening_ar_lines from posted saldo_awal_snapshots
//   for AR aging + KPI integration (Item #5).

import { supabase } from './supabaseClient';
import { decodeJwt } from './jwt';
import type {
  CreateTempoInvoicePayload,
  CreateTempoInvoiceResult,
  DbCustomer,
  DbOrder,
  DiscountTriple,
  PiutangRow,
  PiutangTier,
} from '../types';
import { wibDateString } from './format';

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
  return wibDateString(now);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

// ── RPC: create_tempo_invoice ──
// Parses the credit_limit_exceeded error message ("outstanding=X, new=Y, limit=Z")
// into a typed result the over-limit modal can render directly.
//
// `discount` is an optional order-level DiscountTriple (Task 11). When provided,
// its fields are merged into the payload before the RPC call. Per-item discount
// fields (master_price_at_sale, discount_*) are expected to already be present
// in each payload.items entry (shaped by the wizard caller, Task 15).
// Defaults to all-null / 0 when omitted for backward-compat.
export async function createTempoInvoice(
  payload: CreateTempoInvoicePayload,
  discount?: DiscountTriple,
): Promise<CreateTempoInvoiceResult> {
  if (!supabase) return { kind: 'invalid', message: 'Supabase not configured' };
  const enriched: CreateTempoInvoicePayload = discount
    ? {
        ...payload,
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        discount_amount_rp: discount.discount_amount_rp,
      }
    : payload;
  const { data, error } = await supabase.rpc('create_tempo_invoice', { p_payload: enriched });

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
  // Get tenant_id from JWT for tenant-prefixed path (RLS policy payment_proofs_insert_own_tenant)
  const { data: { session } } = await supabase.auth.getSession();
  const tenantId: string = (session ? (decodeJwt(session.access_token).tenant_id as string | undefined) : undefined) ?? '';
  if (!tenantId) throw new Error('Missing tenant_id in JWT — cannot upload proof');
  // Sanitize filename: keep ext, replace any non-[A-Za-z0-9._-] with _
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  // Path: tenants/{tenant_id}/tempo-payments/{orderId}/{ts}-{filename}
  const path = `tenants/${tenantId}/tempo-payments/${orderId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('payment-proofs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  // Return storage path — callers display via getSignedStorageUrl('payment-proofs', path)
  return path;
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
export async function fetchPiutangRows(
  opts?: { includeWrittenOff?: boolean; includeLunas?: boolean },
): Promise<PiutangRow[]> {
  if (!supabase) return [];
  // Fetch tempo orders. Default to open-only (INVOICE_TEMPO). When opts.includeWrittenOff
  // is set, also pull INVOICE_WRITTEN_OFF for the Tulis-off filter pill. When
  // opts.includeLunas is set, also pull PAYMENT_VERIFIED for the closed-history
  // filter (Enh 6a) — mark_tempo_invoice_paid flips a fully-paid tempo order
  // to PAYMENT_VERIFIED, so the AR history lives in that status.
  const baseSelect = supabase
    .from('orders')
    .select('*')
    .eq('payment_type', 'TEMPO');
  const statusFilters: string[] = ['INVOICE_TEMPO'];
  if (opts?.includeWrittenOff) statusFilters.push('INVOICE_WRITTEN_OFF');
  if (opts?.includeLunas) statusFilters.push('PAYMENT_VERIFIED');
  const filtered = statusFilters.length === 1
    ? baseSelect.eq('status', statusFilters[0])
    : baseSelect.in('status', statusFilters);
  const { data: orders, error: oErr } = await filtered.order('due_date', { ascending: true });
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

// F-11: outstanding = total minus any partial payments already collected.
// Falls back to full total when piutang_paid_amount is absent (pre-migration
// data, or non-tempo orders never touched by the RPC).
export function outstandingOf(row: PiutangRow): number {
  const paid = row.order.piutang_paid_amount ?? 0;
  return Math.max(0, row.order.total - paid);
}

// ── Opening AR lines (Item #5) ────────────────────────────────────────────────
// AR receivables entered via the Saldo Awal wizard (detail mode).
// Only from snapshots that are posted and not reversed.
// amount = full outstanding balance (no paid_amount column on opening lines).
// original_due_date used for aging; NULL = no due date, excluded from overdue aging.
// Fallback: if original_due_date IS NULL, treat as 'no-bucket' (not overdue).
export interface OpeningARLine {
  id: string;
  snapshot_id: string;
  customer_id: string | null;
  customer_name: string;
  amount: number;
  original_due_date: string | null;  // ISO date or null
  invoice_ref: string | null;
  notes: string | null;
}

export async function fetchOpeningARLines(): Promise<OpeningARLine[]> {
  if (!supabase) return [];
  // RLS p_select_own on opening_ar_lines gates to tenant automatically.
  // Join to saldo_awal_snapshots to filter posted+not-reversed.
  const { data, error } = await supabase
    .from('opening_ar_lines')
    .select(`
      id,
      snapshot_id,
      customer_id,
      customer_name,
      amount,
      original_due_date,
      invoice_ref,
      notes,
      saldo_awal_snapshots!inner(status, reversed_at)
    `)
    .eq('saldo_awal_snapshots.status', 'posted')
    .is('saldo_awal_snapshots.reversed_at', null);
  if (error) return [];
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    snapshot_id: row.snapshot_id as string,
    customer_id: (row.customer_id ?? null) as string | null,
    customer_name: row.customer_name as string,
    amount: Number(row.amount),
    original_due_date: (row.original_due_date ?? null) as string | null,
    invoice_ref: (row.invoice_ref ?? null) as string | null,
    notes: (row.notes ?? null) as string | null,
  }));
}

// ── AR Aging bucket computation ──
// Reads aging_buckets array from piutang_settings (default [30, 60, 90]).
// Produces segments [0-30, 31-60, 61-90, >90] (4 segments for 3 boundaries).
// Optional openingLines: opening_ar_lines from Saldo Awal wizard (Item #5).
// Opening lines use original_due_date for aging; NULL due date = excluded.
export interface AgingSegment {
  label: string;      // e.g., "0–30 hari"
  count: number;
  amount: number;
  color: string;      // hex
}

const SEGMENT_COLORS = ['#10b981', '#f59e0b', '#fb923c', '#ef4444']; // green, yellow, orange, red

export function computeAging(
  rows: PiutangRow[],
  buckets: number[] = [30, 60, 90],
  openingLines: OpeningARLine[] = [],
): AgingSegment[] {
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

  // Transaction rows
  for (const r of rows) {
    const overdueDays = -r.daysToDue; // overdueDays > 0 means past due
    if (overdueDays < 0) continue;     // not yet overdue — exclude from aging
    let idx = sorted.findIndex(b => overdueDays <= b);
    if (idx === -1) idx = sorted.length;
    segments[idx].count += 1;
    segments[idx].amount += outstandingOf(r);
  }

  // Opening AR lines — use original_due_date; NULL = no bucket (skip)
  const todayStr = todayWIB();
  for (const line of openingLines) {
    if (!line.original_due_date) continue; // no due date — excluded from aging
    const overdueDays = Math.round(
      (new Date(todayStr + 'T00:00:00Z').getTime() -
       new Date(line.original_due_date + 'T00:00:00Z').getTime()) / 86_400_000,
    );
    if (overdueDays < 0) continue; // not yet overdue
    let idx = sorted.findIndex(b => overdueDays <= b);
    if (idx === -1) idx = sorted.length;
    segments[idx].count += 1;
    segments[idx].amount += line.amount;
  }

  return segments;
}

// ── KPI: extend computeKpi to include opening AR lines ───────────────────────
// Opening lines have no tier; they contribute to totalPiutang + overdueAmount
// when original_due_date < today. Lines with NULL due date count toward total
// but NOT overdue.
export function computeKpi(rows: PiutangRow[], openingLines: OpeningARLine[] = []): PiutangKpi {
  const acc = {
    totalPiutang: 0, totalCount: 0,
    overdueAmount: 0, overdueCount: 0,
    todayAmount: 0, todayCount: 0,
    h3Amount: 0, h3Count: 0,
  };
  for (const r of rows) {
    const outstanding = outstandingOf(r);
    acc.totalPiutang += outstanding;
    acc.totalCount += 1;
    if (r.tier === 'overdue') { acc.overdueAmount += outstanding; acc.overdueCount += 1; }
    if (r.tier === 'today')   { acc.todayAmount   += outstanding; acc.todayCount   += 1; }
    if (r.tier === 'h3')      { acc.h3Amount      += outstanding; acc.h3Count      += 1; }
  }
  // Opening lines
  const todayStr = todayWIB();
  for (const line of openingLines) {
    acc.totalPiutang += line.amount;
    acc.totalCount   += 1;
    if (line.original_due_date && line.original_due_date < todayStr) {
      acc.overdueAmount += line.amount;
      acc.overdueCount  += 1;
    }
  }
  return acc;
}

// ── Sidebar badge: count of overdue (kasir TEMPO + opening AR lines) ─────────
// Includes opening_ar_lines from posted saldo_awal_snapshots where due date < today.
export async function fetchOverdueCount(): Promise<number> {
  if (!supabase) return 0;
  const today = todayWIB();

  // Kasir TEMPO overdue
  const { count: kasirCount, error: kasirErr } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('payment_type', 'TEMPO')
    .eq('status', 'INVOICE_TEMPO')
    .lt('due_date', today);
  if (kasirErr) return 0;

  // Opening AR overdue (via join filter using fetchOpeningARLines)
  // Use a lightweight count query rather than fetching all rows.
  const lines = await fetchOpeningARLines();
  const openingOverdue = lines.filter(l => l.original_due_date && l.original_due_date < today).length;

  return (kasirCount ?? 0) + openingOverdue;
}
