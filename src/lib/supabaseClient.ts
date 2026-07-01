/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import { wibDateString } from './format';
import type { DbConversation, DbMessage, DbOrder, DbWaRecipient, DbCustomer, DbCustomerWithStats, DbCustomerProfile, DbLead, DbNotificationConfig, DbCompanySettings, DbAdminUser, KasirTransaction, DailySummary, RecordKasirSaleInput, NewExpense, KasirChannel, KasirPaymentMethod, KasirPaymentSubtype, BankAccount, BankStatementLine, PayableSlot, CashDepositBatch, BankLineKind, SalesChannel, ConversationState } from '../types';
import type {
  ApprovalRequest,
  StockAdjustmentReason,
  OpnameSession,
  OpnameCount,
  RakitJobLine,
  RakitLockRequest,
  RakitServiceType,
  Warehouse,
  WarehouseAuditLogRow,
  ProductCategory,
  ProductBrand,
  ProductUnit,
  ProductPhoto,
  StockItem,
} from '../types';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Create a singleton client if keys are present
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Bucket kasir income rows by date and channel.
 * Replaces 2 nearly-identical hardcoded bucket functions used by
 * `fetchWeeklyRevenueByChannel` and `fetchDailyRevenueByChannel`.
 *
 * Input rows must already carry a normalized `date` (YYYY-MM-DD WIB) — callers
 * are responsible for converting `created_at` timestamps via `wibDateString`.
 *
 * Returns `Record<dateString, Partial<Record<SalesChannel, number>>>`. Channels
 * with zero revenue on a date are omitted; the consumer pre-seeds zero-day
 * buckets for chart axes and fills missing channels at the output mapping step.
 */
function bucketByChannel(
  rows: Array<{ subtotal: number; channel?: string | null; date: string }>,
): Record<string, Partial<Record<SalesChannel, number>>> {
  const out: Record<string, Partial<Record<SalesChannel, number>>> = {};
  for (const row of rows) {
    const date = row.date;
    const ch = (row.channel ?? 'walkin') as SalesChannel;
    if (!out[date]) out[date] = {};
    out[date][ch] = (out[date][ch] ?? 0) + (row.subtotal ?? 0);
  }
  return out;
}

export interface SupabaseStockItem {
  sku: string;
  name: string;
  category: string;
  subcategory?: string | null;
  unit?: string;
  unit_alt?: string | null;
  unit_alt_factor?: number | null;
  price: number;
  price_grosir?: number | null;
  stock: number;
  stock_atas?: number;
  stock_bawah?: number;
  status: string;
  specs: Record<string, string | number>;
  updated_at?: string;
  harga_modal?: number | null;
  photo_urls?: ProductPhoto[];
  description?: string | null;
  min_stock_per_product?: number | null;
  initial_stock_approved?: boolean;
}

// Resilient API services with local fallback
export const supabaseService = {
  async fetchStocks() {
    if (!supabase) {
      throw new Error('Supabase is not configured. Falling back to local/localStorage state.');
    }
    const { data, error } = await supabase
      .from('stocks')
      .select('*')
      .order('sku', { ascending: true });

    if (error) {
      throw error;
    }
    return data as SupabaseStockItem[];
  },

  async upsertStock(item: SupabaseStockItem) {
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }
    // Phase 2 Task 11: direct UPDATE on stocks.{price,harga_modal,stock_atas,
    // stock_bawah} is REVOKEd for anon + authenticated. Split this call:
    //   - new SKU       → seed_stock_row RPC (SECURITY DEFINER, Owner-gated)
    //   - existing SKU  → UPDATE only the unrestricted columns (name, category,
    //                     status, specs). Mutating price / qty on an existing
    //                     row must go through the approval flow (T9/T10 for
    //                     price, T1-T4 for qty); UI for that lands in T26+.
    const { data: existing, error: lookupErr } = await supabase
      .from('stocks')
      .select('sku, price, harga_modal')
      .eq('sku', item.sku)
      .maybeSingle();
    if (lookupErr) {
      throw lookupErr;
    }

    if (!existing) {
      const { data: seedSku, error: seedErr } = await supabase.rpc('seed_stock_row', {
        p_sku: item.sku,
        p_name: item.name,
        p_category: item.category,
        p_price: item.price,
        p_harga_modal: item.harga_modal ?? 0,
        p_initial_levels: {},
      });
      if (seedErr) {
        throw seedErr;
      }
      return [{ sku: seedSku as string }];
    }

    // Existing SKU: refuse mutations to value-bearing columns. Compare against
    // the snapshot we just read. Changing price / harga_modal requires the
    // approval flow (Phase 2 T9/T10 for price); qty changes go through the
    // warehouse adjustment flow, not upsertStock. Metadata edits (name,
    // category, status, specs) flow through directly via the GRANT preserved
    // in migration …017.
    const restrictedDiffs: string[] = [];
    if (item.price !== existing.price) restrictedDiffs.push('price');
    if (
      item.harga_modal !== undefined &&
      item.harga_modal !== existing.harga_modal
    ) {
      restrictedDiffs.push('harga_modal');
    }
    if (restrictedDiffs.length > 0) {
      throw new Error(
        `Cannot modify ${restrictedDiffs.join(', ')} directly on existing SKU ${item.sku} — use the approval flow.`
      );
    }

    const { data, error } = await supabase
      .from('stocks')
      .update({
        name: item.name,
        category: item.category,
        status: item.status,
        specs: item.specs,
        updated_at: new Date().toISOString(),
      })
      .eq('sku', item.sku)
      .select();

    if (error) {
      throw error;
    }
    return data;
  },

  async deleteStock(sku: string) {
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }
    const { error } = await supabase
      .from('stocks')
      .delete()
      .eq('sku', sku);

    if (error) {
      throw error;
    }
    return true;
  }
};

export const conversationService = {
  async fetchConversations(): Promise<DbConversation[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async fetchMessages(conversationId: string): Promise<DbMessage[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async insertAdminMessage(conversationId: string, text: string): Promise<DbMessage> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender: 'admin', text })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async toggleAiControl(conversationId: string, makeActive: boolean, newState?: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const update: Record<string, unknown> = { ai_active: makeActive };
    if (newState) update.state = newState;
    const { error } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', conversationId);
    if (error) throw error;
  },

  async manuallyOverrideConversationState(
    convId: string,
    newState: ConversationState,
    lockMinutes: number = 15
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('manually_override_conversation_state', {
      p_conv_id: convId,
      p_new_state: newState,
      p_lock_minutes: lockMinutes,
    });
    if (error) throw error;
  },

  async clearConversationLock(convId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('clear_conversation_lock', {
      p_conv_id: convId,
    });
    if (error) throw error;
  },

  async uploadChatMedia(file: File): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const path = `${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('chat-media').upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl;
  },

  async insertAdminMediaMessage(conversationId: string, mediaUrl: string, mediaType: string): Promise<DbMessage> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender: 'admin', text: '', media_url: mediaUrl, media_type: mediaType })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const orderService = {
  async fetchPendingOrders(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PENDING_ADMIN_CONFIRMATION')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async approveOrder(
    orderId: string,
    shippingFee: number,
    paymentType: 'FULL' | 'DP' = 'FULL',
    dpInputType?: 'AMOUNT' | 'PERCENTAGE',
    dpValue?: number,
    dpAmount?: number,
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        shipping_fee: shippingFee,
        status: 'APPROVED',
        payment_type: paymentType,
        dp_input_type: paymentType === 'DP' ? dpInputType : null,
        dp_value: paymentType === 'DP' ? (dpValue ?? 0) : 0,
        dp_amount: paymentType === 'DP' ? (dpAmount ?? 0) : 0,
      })
      .eq('id', orderId);
    if (error) throw error;
  },

  async fetchPaymentUploadedOrders(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PAYMENT_UPLOADED')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async verifyPayment(orderId: string, adminName = ''): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'PAYMENT_VERIFIED',
        payment_verified_at: new Date().toISOString(),
        verified_by: adminName,
      })
      .eq('id', orderId);
    if (error) throw error;
  },

  async rejectPayment(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'PAYMENT_REJECTED' })
      .eq('id', orderId);
    if (error) throw error;
  },

  async verifyDPPayment(orderId: string, adminName = ''): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'DP_VERIFIED',
        payment_verified_at: new Date().toISOString(),
        verified_by: adminName,
      })
      .eq('id', orderId);
    if (error) throw error;
  },

  async rejectDPProof(orderId: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'DP_PROOF_REJECTED', rejection_reason: reason || null, dp_proof_url: null })
      .eq('id', orderId);
    if (error) throw error;
  },

  async rejectFullProof(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'PAYMENT_REJECTED', full_proof_url: null, rejection_reason: null })
      .eq('id', orderId);
    if (error) throw error;
  },

  async fetchAll(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createWalkinDraft(input: {
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_company: string;
    warehouse: 'atas' | 'bawah';
    items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number }>;
    subtotal: number;
    hpp_total: number;
    total: number;
    // Optional fields preserved on draft → paid transition.
    // Defaults reproduce the legacy behavior (FULL, no ongkir, PICKUP, no notes,
    // empty address) so existing callers don't have to change.
    shipping_fee?: number;
    notes?: string;
    delivery_address?: string;
    payment_type?: 'FULL' | 'DP';
    dp_amount?: number;
    dp_input_type?: 'AMOUNT' | 'PERCENT';
    delivery_type?: 'PICKUP' | 'DELIVERY';
  }): Promise<DbOrder> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .insert({
        sales_channel:     'walkin',
        status:            'WAITING_PAYMENT',
        warehouse:         input.warehouse,
        customer_id:       input.customer_id,
        customer_name:     input.customer_name,
        customer_phone:    input.customer_phone,
        customer_company:  input.customer_company,
        customer_address:  input.delivery_address ?? '',
        items:             input.items,
        subtotal:          input.subtotal,
        shipping_fee:      input.shipping_fee ?? 0,
        total:             input.total,
        hpp_total:         input.hpp_total,
        payment_type:      input.payment_type ?? 'FULL',
        dp_amount:         input.dp_amount ?? 0,
        dp_input_type:     input.dp_input_type ?? null,
        notes:             input.notes ?? null,
        delivery_type:     input.delivery_type ?? 'PICKUP',
      })
      .select()
      .single();
    if (error) throw error;
    return data as DbOrder;
  },

  async rejectOrder(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'CANCELLED' })
      .eq('id', orderId);
    if (error) throw error;
  },
};

type Period = '7d' | '30d' | '90d';

function periodStart(p: Period): string {
  const d = new Date();
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return wibDateString(d) + 'T00:00:00+07:00';
}

function groupByDay<T extends { created_at: string }>(
  rows: T[],
  days: number
): Array<{ label: string; rows: T[] }> {
  const buckets: Record<string, T[]> = {};
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = wibDateString(d);
    buckets[key] = [];
  }
  for (const row of rows) {
    const key = wibDateString(new Date(row.created_at));
    if (key in buckets) buckets[key].push(row);
  }
  return Object.entries(buckets).map(([key, rowsInDay]) => ({
    label: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    rows: rowsInDay,
  }));
}

export const statsService = {
  async fetchTodayStats(): Promise<{
    verifiedOrdersTotal: number;
    verifiedOrdersCount: number;
    totalConversationsToday: number;
    aiConversationsToday: number;
  }> {
    if (!supabase) throw new Error('Supabase not configured');
    const todayDate = wibDateString();
    const todayISO = todayDate + 'T00:00:00+07:00';
    const [ordersRes, convsRes, aiConvsRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', todayISO),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('ai_active', true).gte('created_at', todayISO),
      supabase.from('kasir_transactions').select('subtotal').eq('type', 'income').eq('date', todayDate),
    ]);

    const waTotal = (ordersRes.data ?? []).reduce((sum, o) => sum + Number((o as any).total ?? 0), 0);
    const kasirTotal = (kasirRes.data ?? []).reduce((sum, t) => sum + Number((t as any).subtotal ?? 0), 0);
    return {
      verifiedOrdersTotal: waTotal + kasirTotal,
      verifiedOrdersCount: (ordersRes.data?.length ?? 0) + (kasirRes.data?.length ?? 0),
      totalConversationsToday: convsRes.count ?? 0,
      aiConversationsToday: aiConvsRes.count ?? 0,
    };
  },

  async fetchRecentActivity(): Promise<Array<{ text: string; sender: string; created_at: string }>> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data } = await supabase
      .from('messages')
      .select('text, sender, created_at')
      .in('sender', ['system', 'ai'])
      .order('created_at', { ascending: false })
      .limit(5);
    return data ?? [];
  },

  async fetchWeeklyRevenue(): Promise<Array<{ Day: string; Revenue: number; Orders: number }>> {
    if (!supabase) return [];
    const since = periodStart('7d');
    const { data } = await supabase
      .from('orders')
      .select('total, created_at')
      .eq('status', 'PAYMENT_VERIFIED')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    return groupByDay(data ?? [], 7).map(({ label, rows }) => ({
      Day: label,
      Revenue: rows.reduce((s, r) => s + Number((r as any).total ?? 0), 0),
      Orders: rows.length,
    }));
  },

  async fetchWeeklyConversations(): Promise<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>> {
    if (!supabase) return [];
    const since = periodStart('7d');
    const { data } = await supabase
      .from('conversations')
      .select('ai_active, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    return groupByDay(data ?? [], 7).map(({ label, rows }) => ({
      Day: label,
      'Dijawab AI': rows.filter(r => (r as any).ai_active).length,
      'Respon Manual': rows.filter(r => !(r as any).ai_active).length,
    }));
  },

  async fetchWeeklyRevenueByChannel(): Promise<Array<{
    Day: string; 'Walk-in': number; Tokopedia: number; Grosir: number; 'WA AI': number;
  }>> {
    if (!supabase) return [];
    const since = periodStart('7d');
    const sinceDate = since.slice(0, 10);
    const [kasirRes, ordersRes] = await Promise.all([
      supabase.from('kasir_transactions').select('subtotal, channel, date').eq('type', 'income').gte('date', sinceDate),
      supabase.from('orders').select('total, created_at').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
    ]);
    const buckets = bucketByChannel((kasirRes.data ?? []).map(tx => ({
      subtotal: Number((tx as any).subtotal ?? 0),
      channel: (tx as any).channel,
      date: (tx as any).date as string,
    })));
    // Pre-seed zero-day buckets so the chart x-axis is contiguous
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = wibDateString(d);
      if (!buckets[key]) buckets[key] = {};
    }
    // Orders-table revenue is the synthetic "WA AI" lane (not a SalesChannel value)
    const waaiByDate: Record<string, number> = {};
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      waaiByDate[key] = (waaiByDate[key] ?? 0) + Number((o as any).total ?? 0);
    }
    return Object.keys(buckets).sort().map(key => ({
      Day: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      'Walk-in': buckets[key].walkin ?? 0,
      'Tokopedia': buckets[key].tokopedia ?? 0,
      'Grosir': buckets[key].grosir ?? 0,
      'WA AI': waaiByDate[key] ?? 0,
    }));
  },
};

export const reportsService = {
  async fetchSummary(since: string): Promise<{
    revenue: number; orderCount: number; avgOrderValue: number;
    convCount: number; aiConvCount: number;
  }> {
    if (!supabase) return { revenue: 0, orderCount: 0, avgOrderValue: 0, convCount: 0, aiConvCount: 0 };
    const sinceDate = since.slice(0, 10);
    const [ordersRes, convsRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
      supabase.from('conversations').select('ai_active').gte('created_at', since),
      supabase.from('kasir_transactions').select('subtotal').eq('type', 'income').gte('date', sinceDate),
    ]);
    const orders = ordersRes.data ?? [];
    const kasirTxs = kasirRes.data ?? [];
    const convs = convsRes.data ?? [];
    const waRevenue = orders.reduce((s, o) => s + Number((o as any).total ?? 0), 0);
    const kasirRevenue = kasirTxs.reduce((s, t) => s + Number((t as any).subtotal ?? 0), 0);
    const revenue = waRevenue + kasirRevenue;
    const totalCount = orders.length + kasirTxs.length;
    return {
      revenue,
      orderCount: totalCount,
      avgOrderValue: totalCount > 0 ? Math.round(revenue / totalCount) : 0,
      convCount: convs.length,
      aiConvCount: convs.filter(c => (c as any).ai_active).length,
    };
  },

  async fetchDailyRevenue(since: string, days: number): Promise<Array<{ Day: string; Revenue: number; Orders: number }>> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('orders')
      .select('total, created_at')
      .eq('status', 'PAYMENT_VERIFIED')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    return groupByDay(data ?? [], days).map(({ label, rows }) => ({
      Day: label,
      Revenue: rows.reduce((s, r) => s + Number((r as any).total ?? 0), 0),
      Orders: rows.length,
    }));
  },

  async fetchDailyConversations(since: string, days: number): Promise<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('conversations')
      .select('ai_active, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    return groupByDay(data ?? [], days).map(({ label, rows }) => ({
      Day: label,
      'Dijawab AI': rows.filter(r => (r as any).ai_active).length,
      'Respon Manual': rows.filter(r => !(r as any).ai_active).length,
    }));
  },

  async fetchTopProducts(since: string): Promise<Array<{ name: string; qty: number; revenue: number }>> {
    if (!supabase) return [];
    const sinceDate = since.slice(0, 10);
    const [ordersRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('items').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
      supabase.from('kasir_transactions').select('items').eq('type', 'income').gte('date', sinceDate),
    ]);
    const tally: Record<string, { qty: number; revenue: number }> = {};
    const tallyItems = (items: any[]) => {
      for (const item of items) {
        if (!item.name) continue;
        if (!tally[item.name]) tally[item.name] = { qty: 0, revenue: 0 };
        tally[item.name].qty += item.qty ?? 0;
        tally[item.name].revenue += Number(item.subtotal ?? 0);
      }
    };
    for (const order of (ordersRes.data ?? [])) tallyItems((order as any).items ?? []);
    for (const tx of (kasirRes.data ?? [])) tallyItems((tx as any).items ?? []);
    return Object.entries(tally)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  },

  async fetchDailyRevenueByChannel(since: string, days: number): Promise<Array<{
    Day: string; 'Walk-in': number; Tokopedia: number; Grosir: number; 'WA AI': number;
  }>> {
    if (!supabase) return [];
    const sinceDate = since.slice(0, 10);
    const [kasirRes, ordersRes] = await Promise.all([
      supabase.from('kasir_transactions').select('subtotal, channel, date').eq('type', 'income').gte('date', sinceDate),
      supabase.from('orders').select('total, created_at').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
    ]);
    const buckets = bucketByChannel((kasirRes.data ?? []).map(tx => ({
      subtotal: Number((tx as any).subtotal ?? 0),
      channel: (tx as any).channel,
      date: (tx as any).date as string,
    })));
    // Pre-seed zero-day buckets so the chart x-axis is contiguous
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = wibDateString(d);
      if (!buckets[key]) buckets[key] = {};
    }
    // Orders-table revenue is the synthetic "WA AI" lane (not a SalesChannel value)
    const waaiByDate: Record<string, number> = {};
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      waaiByDate[key] = (waaiByDate[key] ?? 0) + Number((o as any).total ?? 0);
    }
    return Object.keys(buckets).sort().map(key => ({
      Day: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      'Walk-in': buckets[key].walkin ?? 0,
      'Tokopedia': buckets[key].tokopedia ?? 0,
      'Grosir': buckets[key].grosir ?? 0,
      'WA AI': waaiByDate[key] ?? 0,
    }));
  },

  async fetchChannelTotals(since: string): Promise<Array<{ name: string; value: number }>> {
    if (!supabase) return [];
    const sinceDate = since.slice(0, 10);
    const [kasirRes, ordersRes] = await Promise.all([
      supabase.from('kasir_transactions').select('subtotal, channel').eq('type', 'income').gte('date', sinceDate),
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
    ]);
    const totals = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    for (const tx of (kasirRes.data ?? [])) {
      const ch = (tx as any).channel as string;
      const amt = Number((tx as any).subtotal ?? 0);
      if (ch === 'walkin') totals.walkin += amt;
      else if (ch === 'tokopedia') totals.tokopedia += amt;
      else if (ch === 'grosir') totals.grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) totals.waai += Number((o as any).total ?? 0);
    return [
      { name: 'Walk-in', value: totals.walkin },
      { name: 'Tokopedia', value: totals.tokopedia },
      { name: 'Grosir', value: totals.grosir },
      { name: 'WA AI', value: totals.waai },
    ].filter(c => c.value > 0);
  },
};

// bankConfigService was removed in the legacy Pengaturan cleanup.
// Bank account display now sources from store_bank_accounts via
// fetchBankAccounts() in src/lib/pengaturan/queries.ts.

export const waRecipientsService = {
  async fetchAll(): Promise<DbWaRecipient[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('wa_recipients')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async add(values: { role: 'admin' | 'owner'; name: string; wa_number: string }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .insert({ ...values, is_active: true });
    if (error) throw error;
  },

  async toggleActive(id: number, isActive: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

export const leadsService = {
  async fetchAll(): Promise<DbLead[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('leads')
      .select('*, customers(*), orders!orders_leads_id_fkey(id, gjp_order_id, items, subtotal, shipping_fee, total, status, created_at, delivery_type)')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbLead[];
  },
};

export const customersService = {
  async fetchAll(): Promise<DbCustomerWithStats[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('customers')
      .select('*, orders!orders_customer_id_fkey(id, total)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(({ orders, ...customer }: any) => ({
      ...customer,
      order_count: orders?.length ?? 0,
      total_spend: (orders ?? []).reduce((s: number, o: any) => s + Number(o.total ?? 0), 0),
    }));
  },

  async createCustomer(waNumber: string, name: string, company: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('customers')
      .upsert(
        { id: crypto.randomUUID(), wa_number: waNumber, name, company },
        { onConflict: 'wa_number', ignoreDuplicates: true }
      );
    if (error) throw error;
  },

  async updateNameCompany(id: string, name: string, company: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('customers')
      .update({ name, company })
      .eq('id', id);
    if (error) throw error;
  },

  async updateTier(id: string, tier: 'eceran' | 'grosir'): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('customers')
      .update({ default_pricing_tier: tier })
      .eq('id', id);
    if (error) throw error;
  },

  async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
    if (!supabase) throw new Error('Supabase not configured');
    const [customerRes, kasirRes] = await Promise.all([
      supabase
        .from('customers')
        .select('*, orders!orders_customer_id_fkey(*), leads!leads_customer_id_fkey(*)')
        .eq('id', customerId)
        .single(),
      supabase
        .from('kasir_transactions')
        .select('*')
        .eq('customer_id', customerId)
        .eq('type', 'income')
        .order('created_at', { ascending: false }),
    ]);
    if (customerRes.error) throw customerRes.error;
    if (kasirRes.error)    throw kasirRes.error;

    const profile = customerRes.data as any;
    profile.orders = (profile.orders ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.leads = (profile.leads ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.kasir_transactions = (kasirRes.data ?? []) as any[];
    return profile as DbCustomerProfile;
  },
};

export const customerCreditService = {
  async requestActivate(customerId: string, termDays: number, creditLimit: number, reason: string | null) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('request_customer_credit_activate', {
      p_customer_id: customerId,
      p_term_days: termDays,
      p_credit_limit: creditLimit,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveActivate(requestId: number, ownerPin: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('approve_customer_credit_activate', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
  async requestLimitChange(customerId: string, newLimit: number, reason: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('request_customer_credit_limit_change', {
      p_customer_id: customerId,
      p_new_limit: newLimit,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveLimitChange(requestId: number, ownerPin: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('approve_customer_credit_limit_change', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
  async requestDeactivate(customerId: string, reason: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('request_customer_credit_deactivate', {
      p_customer_id: customerId,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveDeactivate(requestId: number, ownerPin: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('approve_customer_credit_deactivate', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
};

export const notificationConfigService = {
  async fetch(): Promise<DbNotificationConfig | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('notification_config')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async save(
    values: Omit<DbNotificationConfig, 'id' | 'updated_at'>,
    existingId?: number
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (existingId !== undefined) {
      const { error } = await supabase
        .from('notification_config')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('notification_config')
        .insert(values);
      if (error) throw error;
    }
  },
};

export const companySettingsService = {
  async fetch(): Promise<DbCompanySettings | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('company_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async uploadLogo(file: File): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `logo_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('branding')
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from('branding').getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase
      .from('company_settings')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (updErr) throw updErr;
    return url;
  },

  async updateOpnameRequireWitness(required: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('company_settings')
      .update({ opname_require_witness: required, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw error;
  },

  async clearLogo(): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data: settings, error: fetchErr } = await supabase
      .from('company_settings')
      .select('id, logo_url')
      .eq('id', 1)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!settings?.logo_url) return;
    const filename = settings.logo_url.split('/').pop();
    if (filename) {
      await supabase.storage.from('branding').remove([filename]);
    }
    await supabase
      .from('company_settings')
      .update({ logo_url: null })
      .eq('id', 1);
  },

  // Costing method is stored as a column on the single-row company_settings table
  // (added by migration 20260615000020). The original M4 spec used a key/value row
  // model that didn't match this codebase — see fix migration header for context.
  async getCostingMethod(): Promise<'FIFO' | 'Average'> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('company_settings').select('costing_method').eq('id', 1).maybeSingle();
    if (error) throw error;
    const v = (data as { costing_method?: string } | null)?.costing_method ?? 'FIFO';
    return (v === 'Average' ? 'Average' : 'FIFO');
  },

  async setCostingMethod(m: 'FIFO' | 'Average'): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('company_settings')
      .update({ costing_method: m, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw error;
  },
};

// ─── stockLotsService ───────────────────────────────────────────────────────
// Cheap reads against the stock_lots ledger (per migration 20260604000014).
// Used by ProductForm to decide whether Harga Modal is "Awal" (editable) or
// "Aktual" (locked from PO ledger).

export const stockLotsService = {
  async countForSku(sku: string): Promise<number> {
    if (!supabase) throw new Error('Supabase not configured');
    const { count, error } = await supabase
      .from('stock_lots').select('id', { count: 'exact', head: true }).eq('sku', sku);
    if (error) throw error;
    return count ?? 0;
  },
};

// ─── warehousesService ──────────────────────────────────────────────────────
// CRUD + admin helpers for the configurable N-warehouse model.
// 2026-06-13 spec.

export const warehousesService = {
  async fetchAll(): Promise<Warehouse[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      // Default warehouse always first; sort_order is the tiebreaker for the rest.
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Warehouse[];
  },

  async fetchActive(): Promise<Warehouse[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Warehouse[];
  },

  async create(input: { code: string; name: string; address?: string; sort_order?: number }): Promise<Warehouse> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('create_warehouse', {
      p_code: input.code, p_name: input.name,
      p_address: input.address ?? null, p_sort_order: input.sort_order ?? 100,
    });
    if (error) throw error;
    return data as Warehouse;
  },

  async update(id: string, patch: { name?: string; address?: string | null; sort_order?: number }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('update_warehouse', {
      p_id: id,
      p_name: patch.name ?? null,
      p_address: patch.address ?? null,
      p_sort_order: patch.sort_order ?? null,
    });
    if (error) throw error;
  },

  async setDefault(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('set_default_warehouse', { p_id: id });
    if (error) throw error;
  },

  async deactivate(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('deactivate_warehouse', { p_id: id });
    if (error) throw error;
  },

  async forceDeactivate(id: string, pin: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('force_deactivate_warehouse', {
      p_id: id, p_pin: pin, p_reason: reason,
    });
    if (error) throw error;
  },

  async reactivate(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('reactivate_warehouse', { p_id: id });
    if (error) throw error;
  },

  async fetchAuditLog(limit = 50): Promise<WarehouseAuditLogRow[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouse_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as WarehouseAuditLogRow[];
  },
};

export const adminUsersService = {
  async fetchAll(): Promise<DbAdminUser[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbAdminUser[];
  },

  async upsert(user: Omit<DbAdminUser, 'created_at'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('admin_users')
      .upsert({
        id: user.id,
        name: user.name,
        email: user.email,
        whatsapp: user.whatsapp,
        role: user.role,
        permissions: user.permissions,
        status: user.status,
      });
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async fetchByEmail(email: string): Promise<DbAdminUser | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async fetchById(id: string): Promise<DbAdminUser | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async currentOwnerHasPin(): Promise<boolean> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('current_owner_has_pin');
    if (error) throw error;
    return Boolean(data);
  },

  async changeOwnerPin(oldPin: string, newPin: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('change_owner_pin', {
      p_old_pin: oldPin,
      p_new_pin: newPin,
    });
    if (error) throw error;
  },
};

export const stockService = {
  async updateHargaModal(sku: string, hargaModal: number | null): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    // Route through admin_upsert_product SD RPC (migration 20260910000009):
    // direct .update({ harga_modal }) no longer permitted — the column-level
    // UPDATE grant on stocks.harga_modal was revoked. The RPC's ON CONFLICT
    // DO UPDATE path handles the by-sku update, gated on Owner/Admin role.
    const { error } = await supabase.rpc('admin_upsert_product', {
      p_input: { sku, harga_modal: hargaModal },
    });
    if (error) throw error;
  },

  async fetchAll(): Promise<SupabaseStockItem[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('stocks')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SupabaseStockItem[];
  },

  async bulkUpsert(items: SupabaseStockItem[]): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    // Route through admin_upsert_product SD RPC (migration 20260910000009).
    // Called sequentially so per-row RPC errors surface at the item that
    // failed. Volume is bounded (CSV bulk uploads are <500 rows per spec);
    // if this becomes a hot path, a batched RPC variant is a follow-up.
    for (const item of items) {
      const { error } = await supabase.rpc('admin_upsert_product', {
        p_input: {
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: item.price,
          stock: item.stock,
          status: item.status,
          specs: item.specs,
          harga_modal: item.harga_modal ?? null,
        },
      });
      if (error) throw error;
    }
  },

  async upsertProduct(input: {
    sku: string;
    name: string;
    category: string;
    subcategory: string | null;
    unit: string;
    unit_alt: string | null;
    unit_alt_factor: number | null;
    price: number;
    harga_modal: number | null;
    price_grosir?: number | null;
    description: string | null;
    min_stock_per_product: number | null;
    photo_urls: ProductPhoto[];
    specs: Record<string, string | number>;
    initial_stock_approved: boolean;
  }): Promise<StockItem> {
    if (!supabase) throw new Error('Supabase not configured');
    // Route through admin_upsert_product SD RPC (migration 20260910000009).
    // Value-bearing columns (price, harga_modal, price_grosir, stock_atas,
    // stock_bawah) can no longer be written via direct .upsert() from the
    // anon+authenticated client roles.
    const { data, error } = await supabase.rpc('admin_upsert_product', {
      p_input: {
        ...input,
        status: 'Sinkron',
        stock: 0,           // M5 search RPC reads stock_levels; stocks.stock is derived
      },
    });
    if (error) throw error;
    return data as StockItem;
  },
};

export const registryService = {
  async listCategories(): Promise<ProductCategory[]> {
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductCategory[];
  },
  async addCategory(name: string, parentId: string | null = null): Promise<ProductCategory> {
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ name: name.trim(), parent_id: parentId })
      .select()
      .single();
    if (error) throw error;
    return data as ProductCategory;
  },
  async listBrands(): Promise<ProductBrand[]> {
    const { data, error } = await supabase
      .from('product_brands')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductBrand[];
  },
  async addBrand(name: string): Promise<ProductBrand> {
    const { data, error } = await supabase
      .from('product_brands')
      .insert({ name: name.trim() })
      .select()
      .single();
    if (error) throw error;
    return data as ProductBrand;
  },
  async listUnits(): Promise<ProductUnit[]> {
    const { data, error } = await supabase
      .from('product_units')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductUnit[];
  },
  async addUnit(name: string): Promise<ProductUnit> {
    const { data, error } = await supabase
      .from('product_units')
      .insert({ name: name.trim(), is_default: false })
      .select()
      .single();
    if (error) throw error;
    return data as ProductUnit;
  },
};

export const kasirService = {
  async fetchTransactions(date: string): Promise<KasirTransaction[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .select('*')
      .eq('date', date)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as KasirTransaction[];
  },

  async fetchWaOrdersForDate(date: string): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const start = `${date}T00:00:00.000Z`;
    const end   = `${date}T23:59:59.999Z`;
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PAYMENT_VERIFIED')
      .gte('updated_at', start)
      .lte('updated_at', end)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbOrder[];
  },

  computeDailySummary(
    transactions: KasirTransaction[],
    waOrders: DbOrder[],
    stockMap: Record<string, number | null>
  ): DailySummary {
    let totalIncome = 0;
    let totalExpense = 0;
    let totalHpp = 0;
    let itemsSold = 0;
    const byChannel: Record<string, number> = { walkin: 0, tokopedia: 0, grosir: 0, wa_order: 0 };
    const byPaymentMethod: Record<string, number> = { cash: 0, transfer: 0, qris: 0 };

    for (const tx of transactions) {
      if (tx.type === 'income') {
        totalIncome += tx.subtotal;
        totalHpp += tx.hpp_total;
        itemsSold += tx.items.reduce((s, i) => s + i.qty, 0);
        if (tx.channel) byChannel[tx.channel] = (byChannel[tx.channel] ?? 0) + tx.subtotal;
        if (tx.payment_method) byPaymentMethod[tx.payment_method] = (byPaymentMethod[tx.payment_method] ?? 0) + tx.subtotal;
      } else {
        totalExpense += tx.subtotal;
      }
    }

    for (const order of waOrders) {
      totalIncome += order.total;
      byChannel.wa_order = (byChannel.wa_order ?? 0) + order.total;
      byPaymentMethod.transfer = (byPaymentMethod.transfer ?? 0) + order.total;
      itemsSold += (order.items ?? []).reduce((s: number, i: { qty: number }) => s + i.qty, 0);
      for (const item of (order.items ?? [])) {
        const hpp = stockMap[item.sku] ?? 0;
        totalHpp += hpp * item.qty;
      }
    }

    const labaKotor = totalIncome - totalHpp;
    const labaBersih = labaKotor - totalExpense;
    return { totalIncome, totalExpense, totalHpp, labaKotor, labaBersih, itemsSold, byChannel, byPaymentMethod };
  },

  // Atomically record a kasir sale via the record_kasir_sale RPC. Bundles
  // FIFO stock deduction, warehouse-column decrement, invoice counter, and
  // kasir_transactions insert in ONE transaction. Customer find-or-create
  // also happens inside the RPC.
  //
  // Use this for all new kasir sales. The previous flow
  //   nextInvoiceNumber → deductFifo (per item) → insertSaleTransaction → decrementStock
  // was non-atomic and could strand stock_lots or burn invoice numbers on
  // partial failure.
  async recordSale(input: RecordKasirSaleInput): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('record_kasir_sale', {
      p_date:              input.date,
      p_channel:           input.channel,
      p_items:             input.items,
      p_subtotal:          input.subtotal,
      p_payment_method:    input.payment_method,
      p_payment_subtype:   input.payment_subtype ?? null,
      p_payment_type:      input.payment_type,
      p_dp_amount:         input.dp_amount,
      p_dp_input_type:     input.dp_input_type ?? null,
      p_ongkir_amount:     input.ongkir_amount,
      p_notes:             input.notes ?? null,
      p_total_amount:      input.total_amount,
      p_customer_name:     input.customer_name ?? null,
      p_customer_phone:    input.customer_phone ?? null,
      p_customer_company:  input.customer_company ?? null,
      p_delivery_address:  input.delivery_address ?? null,
      p_marketplace_order_no: input.marketplace_order_no ?? null,
      p_wa_phone:          input.wa_phone ?? null,
      p_wa_chat_url:       input.wa_chat_url ?? null,
      p_customer_id:       input.customer_id ?? null,
      // Diskon fitur (Task 10): order-level discount triple. Defaults to null/null/0.
      // Per-line discounts are in items[].discount_amount_rp.
      p_discount_type:     input.discount?.discount_type ?? null,
      p_discount_value:    input.discount?.discount_value ?? null,
      p_discount_amount_rp: input.discount?.discount_amount_rp ?? 0,
      // Phase 0b dual-write: cash_account_id where the sale lands. Null = RPC
      // falls back to accounting_config defaults by payment_method.
      p_cash_account_id: input.cash_account_id ?? null,
      // T2 migration added p_allow_negative_stock (default false). Forward the
      // wizard's opt-in pre-order flag so the DB can semantically distinguish
      // an intentional pre-order from an underflow accident. Always pass
      // explicit false when omitted to match the DB default + keep call sites
      // that don't set the flag (legacy KasirScreen) on conservative behavior.
      p_allow_negative_stock: input.p_allow_negative_stock ?? false,
    });
    if (error) throw error;
    if (!data) throw new Error('record_kasir_sale returned no row');
    return data as KasirTransaction;
  },

  async markLunas(
    id: string,
    lunasPayment: { method: KasirPaymentMethod; subtype?: KasirPaymentSubtype; ongkirAdjust?: number }
  ): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const updates: Record<string, unknown> = {
      status: 'COMPLETED',
      lunas_at: new Date().toISOString(),
      lunas_payment_method: lunasPayment.method,
      lunas_payment_subtype: lunasPayment.subtype ?? null,
    };
    if (typeof lunasPayment.ongkirAdjust === 'number') {
      // Fetch current row to recompute total_amount
      const { data: cur, error: e1 } = await supabase
        .from('kasir_transactions').select('subtotal,ongkir_amount').eq('id', id).single();
      if (e1) throw e1;
      const newOngkir = ((cur?.ongkir_amount as number) ?? 0) + lunasPayment.ongkirAdjust;
      updates.ongkir_amount = newOngkir;
      updates.total_amount = ((cur?.subtotal as number) ?? 0) + newOngkir;
    }
    const { data, error } = await supabase
      .from('kasir_transactions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
  },

  async cancelTransaction(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('kasir_transactions')
      .update({ status: 'CANCELLED' })
      .eq('id', id);
    if (error) throw error;
  },

  async insertExpense(tx: NewExpense): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({ ...tx, type: 'expense', hpp_total: 0 })
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
  },

  async insertWipWithRakit(input: {
    tx: {
      date: string;
      customer_id?: string | null;
      customer_name?: string | null;
      customer_phone?: string | null;
      customer_company?: string | null;
      delivery_address?: string | null;
      channel: KasirChannel;
      subtotal: number;
      total_amount: number;
      dp_amount: number;
      ongkir_amount: number;
      payment_method: KasirPaymentMethod;
      payment_subtype?: KasirPaymentSubtype;
      payment_type?: 'FULL' | 'DP';
      dp_input_type?: 'AMOUNT' | 'PERCENT' | null;
      notes?: string | null;
      marketplace_order_no?: string | null;
      wa_phone?: string | null;
      wa_chat_url?: string | null;
    };
    rakitLines: Array<{
      serviceType: RakitServiceType;
      description: string;
      estimatedPrice: number;
    }>;
  }): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');

    // 1. Build service_summary
    const rCount = input.rakitLines.filter(l => l.serviceType === 'jasa_rakit').length;
    const cCount = input.rakitLines.filter(l => l.serviceType === 'jasa_custom_panel').length;
    const summary = [
      rCount ? `⚡ ${rCount} Rakit` : null,
      cCount ? `📦 ${cCount} Custom Panel` : null,
    ].filter(Boolean).join(' + ');

    // DIAGNOSTIC: identify any field that contains a non-primitive (e.g. Window) that would
    // cause JSON.stringify to throw in supabase-js's body serialization.
    const __dbg = (obj: Record<string, any>, label: string) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) {
          out[k] = String(v);
        } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          out[k] = `${typeof v}: ${String(v).slice(0, 60)}`;
        } else if (Array.isArray(v)) {
          out[k] = `array(${v.length})`;
        } else {
          // Try to detect if this is a DOM/Window-tainted object
          const ctor = Object.prototype.toString.call(v);
          const isWindowy = (typeof window !== 'undefined' && v === window) || ctor.includes('Window');
          out[k] = isWindowy ? `**WINDOW REF** (${ctor})` : `object:${ctor}`;
        }
      }
      console.log(`[insertWipWithRakit] ${label}:`, out);
    };
    __dbg({ ...input.tx, type: 'income', status: 'WIP', hpp_total: 0, items: [], service_summary: summary }, 'tx payload');
    console.log('[insertWipWithRakit] rakitLines:', input.rakitLines);

    // 2. Insert kasir_transactions with status='WIP' (no stock deduction yet)
    const { data: txRow, error: txErr } = await supabase
      .from('kasir_transactions')
      .insert({
        ...input.tx,
        type: 'income',
        status: 'WIP',
        hpp_total: 0,
        items: [],
        service_summary: summary,
      })
      .select('id')
      .single();
    if (txErr) throw txErr;
    const transactionId = (txRow as { id: string }).id;

    // 3. Insert rakit_job_lines
    const lineRows = input.rakitLines.map((l, idx) => ({
      transaction_id: transactionId,
      line_number: idx + 1,
      service_type: l.serviceType,
      description: l.description,
      estimated_price: l.estimatedPrice,
      tracking_mode: 'detail',
      labor_cost: 0,
      lump_sum_hpp: 0,
    }));
    const { error: linesErr } = await supabase.from('rakit_job_lines').insert(lineRows);
    if (linesErr) throw linesErr;

    return transactionId;
  },

};

export const salesEntriesService = {
  // Hard caps each table at `limit` rows (default 5000) so the previously
  // unbounded query doesn't grow linearly with toko lifetime. Callers can
  // narrow to a date window via {from, to} to skip the cap entirely.
  async fetchAll(opts?: {
    from?: string;   // ISO timestamp (inclusive)
    to?:   string;   // ISO timestamp (inclusive)
    limit?: number;  // hard cap per table; default = 5000
  }): Promise<{ orders: DbOrder[]; kasir: KasirTransaction[] }> {
    if (!supabase) throw new Error('Supabase not configured');
    const limit = opts?.limit ?? 5000;

    let ordersQuery = supabase.from('orders').select('*')
      .order('created_at', { ascending: false })
      .range(0, limit - 1);
    let kasirQuery  = supabase.from('kasir_transactions').select('*')
      .eq('type', 'income')
      .order('created_at', { ascending: false })
      .range(0, limit - 1);
    if (opts?.from) {
      ordersQuery = ordersQuery.gte('created_at', opts.from);
      kasirQuery  = kasirQuery.gte('created_at', opts.from);
    }
    if (opts?.to) {
      ordersQuery = ordersQuery.lte('created_at', opts.to);
      kasirQuery  = kasirQuery.lte('created_at', opts.to);
    }

    const [ordersRes, kasirRes] = await Promise.all([ordersQuery, kasirQuery]);
    if (ordersRes.error) throw ordersRes.error;
    if (kasirRes.error)  throw kasirRes.error;
    return {
      orders: (ordersRes.data ?? []) as DbOrder[],
      kasir:  (kasirRes.data  ?? []) as KasirTransaction[],
    };
  },

};

// ============================================================================
// Phase 2 — approvalService (direct-insert namespace)
// ============================================================================
// Convention note: most Phase 2 approval requests go through SECURITY DEFINER
// RPCs (see `requestAdjustment`, `requestPriceChange` below). Initial-stock
// approval has no dedicated RPC — the row is inserted directly via PostgREST
// because the `approval_request_type` enum already includes 'initial_stock'
// (migration 20260614000024) and RLS lets authenticated users insert their
// own pending requests. Column names mirror the DB (`request_type`,
// `requested_by`, `payload`) — same casing used by `toApprovalRequest`.
export const approvalService = {
  async requestInitialStock(
    payload: {
      sku: string;
      sku_name: string;
      qty: number;
      unit: string;
      warehouse_id: string;
      requested_cost_per_unit?: number;
    },
    requestedBy: string,
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('approval_requests').insert({
      request_type: 'initial_stock',
      payload,
      requested_by: requestedBy,
    });
    if (error) throw error;
  },
};

// ============================================================================
// Phase 2 — Approval / adjustment / opname / price-change / seed RPC wrappers
// ============================================================================
// These standalone exports wrap the SECURITY DEFINER RPCs introduced in
// Phase 2 (T1–T20). They are consumed by the approval inbox, stock adjustment
// modal, opname workflow, and CSV-upsert paths in subsequent tasks (T23+).

// --- Approvals ---

/**
 * Maps a raw `approval_requests` row (snake_case) into the camelCase
 * `ApprovalRequest` shape consumed by Phase 2 UI components. The DB column
 * names come straight from PostgREST/Supabase; the TS type adopted camelCase
 * to match the rest of the front-end. Exported so any consumer that issues
 * a raw `.from('approval_requests')` query can reuse the same mapper.
 */
export function toApprovalRequest(row: any): ApprovalRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    payload: row.payload ?? {},
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    status: row.status,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    decisionChannel: row.decision_channel ?? null,
  };
}

export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toApprovalRequest);
}

export async function getApprovalRequest(approvalId: number): Promise<ApprovalRequest | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle();
  if (error) throw error;
  return data ? toApprovalRequest(data) : null;
}

export async function verifyOwnerPin(approvalId: number, pin: string): Promise<boolean> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('verify_owner_pin', {
    p_approval_id: approvalId,
    p_pin: pin,
  });
  if (error) throw error;
  return Boolean(data);
}

// --- Adjustments ---

export async function requestAdjustment(args: {
  sku: string;
  warehouse: 'atas' | 'bawah';
  qty_delta: number;
  reason_code: StockAdjustmentReason;
  reason_note?: string;
  evidence_urls?: string[];
  actor_user_id: string;
}): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_adjustment', {
    p_sku: args.sku,
    p_warehouse: args.warehouse,
    p_qty_delta: args.qty_delta,
    p_reason_code: args.reason_code,
    p_reason_note: args.reason_note ?? null,
    p_evidence_urls: args.evidence_urls ?? [],
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function commitApprovedAdjustment(approvalId: number): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('commit_approved_adjustment', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as number;
}

// --- Initial stock (new SKU initial qty approval) ---
// Migration: 20260620000050_commit_initial_stock_rpc.sql.
// Counterpart to approvalService.requestInitialStock (created earlier in this
// file). commit returns the stock_movements.id of the seed ledger row so
// callers can deep-link to the audit drawer; reject takes the same shape as
// reject_adjustment for symmetry with the inbox handler.
export async function commitInitialStock(approvalId: number): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('commit_initial_stock', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as number;
}

export async function rejectInitialStock(approvalId: number, reasonNote?: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_initial_stock', {
    p_approval_id: approvalId,
    p_reason_note: reasonNote ?? null,
  });
  if (error) throw error;
}

// --- Opname ---

export async function startOpnameSession(args: {
  opname_type: OpnameSession['opnameType'];
  scope_payload: Record<string, unknown>;
  counted_by: string;
  witnessed_by: string | null;
}): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('start_opname_session', {
    p_opname_type: args.opname_type,
    p_scope_payload: args.scope_payload,
    p_counted_by: args.counted_by,
    p_witnessed_by: args.witnessed_by,
  });
  if (error) throw error;
  return data as number;
}

export async function recordOpnameCount(args: {
  session_id: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  counted_qty: number;
  actor_user_id: string;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('record_opname_count', {
    p_session_id: args.session_id,
    p_sku: args.sku,
    p_warehouse: args.warehouse,
    p_counted_qty: args.counted_qty,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
}

export async function acknowledgeOpnameWitness(
  sessionId: number,
  actorUserId: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('witness_acknowledge_opname', {
    p_session_id: sessionId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
}

export interface SubmitOpnameResult {
  status: 'committed' | 'pending_owner';
  auto: boolean;
  approvalId: number | null;
}

export async function submitOpnameForOwner(
  sessionId: number,
  actorUserId: string,
): Promise<SubmitOpnameResult> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('submit_opname_for_owner', {
    p_session_id: sessionId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  const row = (data as any[])[0];
  return {
    status: row.status,
    auto: row.auto,
    approvalId: row.approval_id ?? null,
  };
}

export interface OpnameAuditEntry {
  id: number;
  eventType: 'opname_auto_commit' | 'opname_owner_commit' | 'opname_owner_reject';
  createdAt: string;
  sessionId: number;
  counterName: string | null;
  witnessName: string | null;
  approvedByName?: string | null;
  rejectedByName?: string | null;
  totalVarianceValue: number;
  rowCount: number;
}

export async function fetchOpnameAuditLog(daysBack: number = 7): Promise<OpnameAuditEntry[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, event_type, created_at, payload')
    .in('event_type', ['opname_auto_commit', 'opname_owner_commit', 'opname_owner_reject'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(row => {
    const p = (row as { payload: Record<string, unknown> }).payload;
    return {
      id: (row as { id: number }).id,
      eventType: (row as { event_type: 'opname_auto_commit' | 'opname_owner_commit' | 'opname_owner_reject' }).event_type,
      createdAt: (row as { created_at: string }).created_at,
      sessionId: Number(p.session_id),
      counterName: (p.counter_name as string | null) ?? null,
      witnessName: (p.witness_name as string | null) ?? null,
      approvedByName: (p.approved_by_name as string | null) ?? null,
      rejectedByName: (p.rejected_by_name as string | null) ?? null,
      totalVarianceValue: Number(p.total_variance_value ?? 0),
      rowCount: Number(p.row_count ?? 0),
    };
  });
}

export async function commitOpname(approvalId: number): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('commit_opname', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Maps a raw `stock_opname_sessions` row (snake_case) into the camelCase
 * `OpnameSession` shape consumed by Phase 2 UI components.
 */
export function toOpnameSession(row: any): OpnameSession {
  return {
    id: row.id,
    opnameType: row.opname_type,
    scopePayload: row.scope_payload ?? {},
    countedByUserId: row.counted_by_user_id,
    witnessedByUserId: row.witnessed_by_user_id,
    witnessAcknowledgedAt: row.witness_acknowledged_at ?? null,
    status: row.status,
    varianceTotalValue: Number(row.variance_total_value ?? 0),
    approvalRequestId: row.approval_request_id ?? null,
    startedAt: row.started_at,
    submittedAt: row.submitted_at ?? null,
    committedAt: row.committed_at ?? null,
  };
}

/**
 * Maps a raw `stock_opname_counts` row (snake_case) into the camelCase
 * `OpnameCount` shape.
 */
export function toOpnameCount(row: any): OpnameCount {
  return {
    sessionId: row.session_id,
    sku: row.sku,
    warehouse: row.warehouse,
    systemQtySnapshot: row.system_qty_snapshot ?? null,
    countedQty: row.counted_qty ?? null,
    variance: row.variance ?? null,
    varianceValue: Number(row.variance_value ?? 0),
  };
}

export async function fetchOpnameCounts(sessionId: number): Promise<OpnameCount[]> {
  if (!supabase) throw new Error('Supabase not configured');
  // Use SECURITY DEFINER RPC fetch_opname_counts (migration
  // 20260614000001) so server-side blind-count masking applies: when
  // caller is NOT 'Owner' AND session.status='in_progress', the RPC
  // returns NULL for system_qty_snapshot + variance + variance_value.
  // Direct table read would bypass the mask — admin could read system
  // values via DevTools network tab.
  const { data, error } = await supabase.rpc('fetch_opname_counts', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // Server returns alphabetical-by-column unordered; sort by SKU client-side
  // to preserve previous ordering contract.
  rows.sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  return rows.map(toOpnameCount);
}

export async function listOpnameSessions(limit = 20): Promise<OpnameSession[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('stock_opname_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toOpnameSession);
}

export async function getOpnameSession(sessionId: number): Promise<OpnameSession | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('stock_opname_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? toOpnameSession(data) : null;
}

// --- Price change ---

export async function requestPriceChange(args: {
  sku: string;
  field: 'price' | 'harga_modal';
  new_value: number;
  reason_note: string;
  actor_user_id: string;
}): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_price_change', {
    p_sku: args.sku,
    p_field: args.field,
    p_new_value: args.new_value,
    p_reason_note: args.reason_note,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function commitApprovedPriceChange(approvalId: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('commit_approved_price_change', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
}

// --- Realtime subscription for approval inbox ---

export function subscribeApprovalRequests(
  onChange: (row: ApprovalRequest) => void,
): () => void {
  if (!supabase) {
    // Realtime is a no-op when Supabase isn't configured; return an inert
    // unsubscriber so callers don't need to special-case configuration.
    return () => { /* no-op */ };
  }
  const client = supabase;
  // Channel topic must be unique per subscriber: supabase-js reuses a channel
  // by topic name across calls, and adding `.on()` after another caller has
  // already invoked `.subscribe()` throws ("cannot add postgres_changes
  // callbacks ... after subscribe()"). Sidebar mounts a subscription for the
  // badge count; ApprovalInboxScreen mounts another for the list, so they
  // would collide on a shared name.
  const channel = client
    .channel(`approval_requests_inbox:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'approval_requests' },
      (payload: { new: unknown }) => onChange(toApprovalRequest(payload.new)),
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

// --- Seed (for CSV upsert + new SKU creation) ---

export async function seedStockRow(args: {
  sku: string;
  name: string;
  category: string;
  price: number;
  harga_modal: number;
  initial_levels?: Record<string, number>;  // warehouse_id → starting qty
  actor_user_id: string;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  // Phase 2a (2026-06-13 spec) replaced the legacy 8-arg seed_stock_row
  // (text, text, text, numeric, numeric, int, int, uuid) — which Migration
  // 3 cutover drops — with the new jsonb form taking p_initial_levels.
  // Callers without a specific per-warehouse starting qty pass {} and the
  // SKU starts with 0 in every active warehouse.
  const { error } = await supabase.rpc('seed_stock_row', {
    p_sku: args.sku,
    p_name: args.name,
    p_category: args.category,
    p_price: args.price,
    p_harga_modal: args.harga_modal,
    p_initial_levels: args.initial_levels ?? {},
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
}

// --- Rakit Workflow (Sub-project B) ---

export async function requestRakitLock(args: {
  transaction_id: string;
  lines: Array<{
    id: string;
    final_price: number;
    tracking_mode: 'detail' | 'lumpsum';
    labor_cost: number;
    lump_sum_hpp: number;
    components?: Array<{
      sku: string;
      name: string;
      qty: number;
      warehouse: 'atas' | 'bawah';
      fifo_cost: number;
    }>;
  }>;
  actor_user_id: string;
}): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_rakit_lock', {
    p_transaction_id: args.transaction_id,
    p_lines: args.lines,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function approveRakitLock(
  approvalId: number,
  hppOverrides: Record<string, number> = {},
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  // Wraps _transition_approval('approved') + commit_approved_rakit_lock in one txn.
  // Required because UPDATE on approval_requests is REVOKEd from authenticated.
  const { error } = await supabase.rpc('approve_rakit_lock', {
    p_approval_id: approvalId,
    p_hpp_overrides: hppOverrides,
  });
  if (error) throw error;
}

// approveAndAmendRakitLock lives in ./sales/rakitLockOwnerEdit so it can be
// unit-tested via the standard vi.mock('../supabaseClient') idiom (functions
// defined IN supabaseClient.ts close over the actual `supabase` const, which
// vi.mock cannot intercept). Re-exported here for path consistency with the
// other rakit wrappers.
export { approveAndAmendRakitLock } from './sales/rakitLockOwnerEdit';

export async function rejectRakitLock(
  approvalId: number,
  reason: string,
  actorUserId: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_rakit_lock', {
    p_approval_id: approvalId,
    p_reason: reason,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
}

// Admin self-withdraw of a pending rakit_lock approval. RPC flips the
// approval back to 'withdrawn' and resets the order's funnel_sub_stage
// from '3g' to '3f' atomically (migration 20260626000001).
export async function withdrawRakitLock(
  approvalId: number,
  actorUserId?: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('withdraw_rakit_lock', {
    p_approval_id: approvalId,
    p_actor_user_id: actorUserId ?? null,
  });
  if (error) throw error;
}

// Returns the approval_request_id of the single pending_approval rakit_lock
// for this order, or null if none is currently pending. Used by the 3g
// 'Tarik Pengajuan' handler to locate the row to withdraw.
export async function findPendingRakitLockApprovalForOrder(
  orderId: string,
): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('rakit_lock_requests')
    .select('approval_request_id, status')
    .eq('transaction_id', orderId)
    .eq('status', 'pending_approval')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { approval_request_id: number }).approval_request_id;
}

// Fetches the rakit_job_lines for one order in camelCase shape so the
// 3f Selesai handler can pass them straight into LockSubmissionModal.
// Mirrors the snake→camel mapping used by fetchWipList.
export async function fetchRakitJobLinesForOrder(
  transactionId: string,
): Promise<RakitJobLine[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('rakit_job_lines')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('line_number');
  if (error) throw error;
  return (data ?? []).map((l: any) => ({
    id: l.id,
    transactionId: l.transaction_id,
    lineNumber: l.line_number,
    serviceType: l.service_type,
    description: l.description,
    estimatedPrice: Number(l.estimated_price ?? 0),
    finalPrice: l.final_price == null ? null : Number(l.final_price),
    trackingMode: l.tracking_mode,
    laborCost: Number(l.labor_cost ?? 0),
    lumpSumHpp: Number(l.lump_sum_hpp ?? 0),
    hppOwnerOverride: l.hpp_owner_override == null ? null : Number(l.hpp_owner_override),
    hppFinal: l.hpp_final == null ? null : Number(l.hpp_final),
  }));
}

export async function fetchWipList(): Promise<Array<{
  id: string;
  total_amount: number;
  dp_amount: number;
  customer_name: string | null;
  customer_phone: string | null;
  service_summary: string | null;
  created_at: string;
  rakit_lines: RakitJobLine[];
}>> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('id, total_amount, dp_amount, customer_name, customer_phone, service_summary, created_at, rakit_job_lines(*)')
    .eq('status', 'WIP')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    total_amount: Number(row.total_amount ?? 0),
    dp_amount: Number(row.dp_amount ?? 0),
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    service_summary: row.service_summary ?? null,
    created_at: row.created_at,
    rakit_lines: (row.rakit_job_lines ?? []).map((l: any) => ({
      id: l.id,
      transactionId: l.transaction_id,
      lineNumber: l.line_number,
      serviceType: l.service_type,
      description: l.description,
      estimatedPrice: Number(l.estimated_price ?? 0),
      finalPrice: l.final_price == null ? null : Number(l.final_price),
      trackingMode: l.tracking_mode,
      laborCost: Number(l.labor_cost ?? 0),
      lumpSumHpp: Number(l.lump_sum_hpp ?? 0),
      hppOwnerOverride: l.hpp_owner_override == null ? null : Number(l.hpp_owner_override),
      hppFinal: l.hpp_final == null ? null : Number(l.hpp_final),
    })),
  }));
}

export async function fetchRakitLockRequestByApprovalId(
  approvalId: number,
): Promise<RakitLockRequest | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('rakit_lock_requests')
    .select('*')
    .eq('approval_request_id', approvalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    transactionId: data.transaction_id,
    approvalRequestId: data.approval_request_id,
    linesSnapshot: data.lines_snapshot,
    requestedBy: data.requested_by,
    requestedAt: data.requested_at,
    status: data.status,
    committedAt: data.committed_at,
    isMaterialEdit: data.is_material_edit,
    priorLockRequestId: data.prior_lock_request_id,
  };
}

export const reconciliationService = {
  async listBankAccounts(): Promise<BankAccount[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('bank_accounts').select('*').eq('is_active', true)
      .order('account_label');
    if (error) throw error;
    return data ?? [];
  },

  async createBankAccount(payload: Omit<BankAccount, 'id'>): Promise<BankAccount> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('bank_accounts').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async listOrdersForPeriod(year: number, month: number) {
    if (!supabase) throw new Error('Supabase not configured');
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = wibDateString(new Date(year, month, 1));
    const { data, error } = await supabase
      .from('orders')
      .select('id, customer_name, customer_phone, total, payment_type, dp_amount, channel, status, created_at, booking_expires_at')
      .gte('created_at', start).lt('created_at', end)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listPayableSlotsForOrders(orderIds: string[]): Promise<PayableSlot[]> {
    if (!supabase) throw new Error('Supabase not configured');
    if (orderIds.length === 0) return [];
    const { data, error } = await supabase
      .from('payable_slots').select('*').in('order_id', orderIds);
    if (error) throw error;
    return data ?? [];
  },

  async listBankLinesForPeriod(year: number, month: number): Promise<BankStatementLine[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = wibDateString(new Date(year, month, 1));
    const { data, error } = await supabase
      .from('bank_statement_lines').select('*')
      .gte('txn_date', start).lt('txn_date', end)
      .order('txn_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listCashBatches(year?: number, month?: number): Promise<CashDepositBatch[]> {
    if (!supabase) throw new Error('Supabase not configured');
    let q = supabase.from('cash_deposit_batches').select('*').order('deposit_date', { ascending: false });
    if (year && month) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = wibDateString(new Date(year, month, 1));
      // Match rows EITHER (a) deposit_date in [start, end), OR (b) pending batches with null deposit_date.
      // Postgres NULL semantics: `.lt()` on null returns null → would be filtered out, so we use a nested
      // and() inside or() to bracket the range correctly.
      q = q.or(`and(deposit_date.gte.${start},deposit_date.lt.${end}),deposit_date.is.null`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  async uploadPDF(file: File, bankAccountId: string, bankCode: string, periodStart: string, periodEnd: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('bank_account_id', bankAccountId);
    fd.append('bank_code', bankCode);
    fd.append('period_start', periodStart);
    fd.append('period_end', periodEnd);
    const url = ((import.meta as any).env?.VITE_BACKEND_URL || '') + '/api/recon/upload';
    const resp = await fetch(url, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ import_id: string; line_count: number; matched_count: number }>;
  },

  async closeMonth(year: number, month: number) {
    const url = ((import.meta as any).env?.VITE_BACKEND_URL || '') + '/api/recon/close';
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ ok: boolean; reason?: string }>;
  },

  async createAllocation(bankLineId: string, slotId: string, amount: number) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('bank_line_allocations').insert({ bank_line_id: bankLineId, slot_id: slotId, amount });
    if (error) throw error;
  },

  async unmatchLine(bankLineId: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('bank_line_allocations').delete().eq('bank_line_id', bankLineId);
    if (error) throw error;
    await supabase.from('bank_statement_lines')
      .update({ lane: 'RED', match_reason: 'manually unmatched', match_confidence: 0 })
      .eq('id', bankLineId);
  },

  async classifyLine(bankLineId: string, kind: BankLineKind, notes?: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('bank_statement_lines')
      .update({ line_kind: kind, lane: 'GRAY', match_reason: kind, notes: notes ?? null })
      .eq('id', bankLineId);
    if (error) throw error;
  },
};

// ─── productService (Multi-Tier Pricing) ────────────────────────────────────
// Task 10: bulk CSV grosir price update RPC wrapper.

export interface BulkGrosirRow {
  sku: string;
  price_grosir: number;
}

export const productService = {
  async bulkUpdateGrosirPrice(
    rows: BulkGrosirRow[]
  ): Promise<{ applied: number; skipped: Array<{ sku: string; reason: string }> }> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase!.rpc('bulk_update_grosir_price', { p_rows: { rows } });
    if (error) throw error;
    return data as { applied: number; skipped: Array<{ sku: string; reason: string }> };
  },
};

// ─── Pengaturan MSME Configurability (Phase 1) Services ────────────────
// Implemented in ./pengaturan/pengaturanServices.ts
// (Not re-exported here to avoid circular dep: supabaseClient → pengaturanServices → supabaseClient)
