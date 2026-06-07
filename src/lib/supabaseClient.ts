/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbCustomerWithStats, DbCustomerProfile, DbLead, DbNotificationConfig, DbCompanySettings, DbAdminUser, KasirTransaction, DailySummary, NewSaleTransaction, NewExpense, KasirChannel, KasirPaymentMethod, KasirPaymentSubtype } from '../types';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Create a singleton client if keys are present
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

export interface SupabaseStockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  stock_atas: number;
  stock_bawah: number;
  status: string;
  specs: Record<string, string | number>;
  updated_at?: string;
  harga_modal?: number | null;
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
    const { data, error } = await supabase
      .from('stocks')
      .upsert({
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: item.price,
        stock_atas: item.stock_atas ?? item.stock,
        stock_bawah: item.stock_bawah ?? 0,
        status: item.status,
        specs: item.specs,
        harga_modal: item.harga_modal ?? null,
        updated_at: new Date().toISOString()
      })
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

function wibDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

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
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[wibDateString(d)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = Number((tx as any).subtotal ?? 0);
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      buckets[key].waai += Number((o as any).total ?? 0);
    }
    return Object.entries(buckets).map(([key, v]) => ({
      Day: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      'Walk-in': v.walkin,
      'Tokopedia': v.tokopedia,
      'Grosir': v.grosir,
      'WA AI': v.waai,
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
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[wibDateString(d)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = Number((tx as any).subtotal ?? 0);
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      buckets[key].waai += Number((o as any).total ?? 0);
    }
    return Object.entries(buckets).map(([key, v]) => ({
      Day: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      'Walk-in': v.walkin,
      'Tokopedia': v.tokopedia,
      'Grosir': v.grosir,
      'WA AI': v.waai,
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

export const bankConfigService = {
  async fetch(): Promise<DbBankConfig | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('bank_config')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async save(values: { bank_name: string; account_number: string; account_name: string }, existingId?: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (existingId !== undefined) {
      const { error } = await supabase
        .from('bank_config')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('bank_config')
        .insert({ ...values, is_active: true });
      if (error) throw error;
    }
  },
};

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

  async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('customers')
      .select('*, orders!orders_customer_id_fkey(*), leads!leads_customer_id_fkey(*)')
      .eq('id', customerId)
      .single();
    if (error) throw error;
    const profile = data as any;
    profile.orders = (profile.orders ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.leads = (profile.leads ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return profile as DbCustomerProfile;
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

  async save(values: Omit<DbCompanySettings, 'id' | 'updated_at'>): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('company_settings')
      .upsert({ id: 1, ...values, updated_at: new Date().toISOString() });
    if (error) throw error;
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
};

export const stockService = {
  async updateHargaModal(sku: string, hargaModal: number | null): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('stocks')
      .update({ harga_modal: hargaModal, updated_at: new Date().toISOString() })
      .eq('sku', sku);
    if (error) throw error;
  },

  async decrementStock(sku: string, qty: number, warehouse: 'atas' | 'bawah' = 'atas'): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty, p_warehouse: warehouse });
    if (error) {
      const col = warehouse === 'atas' ? 'stock_atas' : 'stock_bawah';
      const { data, error: fetchErr } = await supabase.from('stocks').select(col).eq('sku', sku).single();
      if (fetchErr) throw fetchErr;
      const current = (data as Record<string, number>)[col] ?? 0;
      const { error: updateErr } = await supabase.from('stocks').update({
        [col]: Math.max(0, current - qty),
        updated_at: new Date().toISOString(),
      }).eq('sku', sku);
      if (updateErr) throw updateErr;
    }
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
    const { error } = await supabase
      .from('stocks')
      .upsert(
        items.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: item.price,
          stock: item.stock,
          status: item.status,
          specs: item.specs,
          harga_modal: item.harga_modal ?? null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'sku' }
      );
    if (error) throw error;
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

  async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({
        date: tx.date,
        type: 'income',
        channel: tx.channel,
        items: tx.items,
        subtotal: tx.subtotal,
        hpp_total: tx.hpp_total,
        payment_method: tx.payment_method,
        payment_subtype: tx.payment_subtype ?? null,
        payment_type: tx.payment_type,
        dp_amount: tx.dp_amount,
        dp_input_type: tx.dp_input_type ?? null,
        ongkir_amount: tx.ongkir_amount,
        notes: tx.notes ?? null,
        total_amount: tx.total_amount,
        tokped_order_no: tx.tokped_order_no ?? null,
        wa_phone: tx.wa_phone ?? null,
        wa_chat_url: tx.wa_chat_url ?? null,
        status: tx.payment_type === 'DP' ? 'AWAITING_LUNAS' : 'PAID',
        customer_name: tx.customer_name ?? null,
        customer_phone: tx.customer_phone ?? null,
        customer_company: tx.customer_company ?? null,
        delivery_address: tx.delivery_address ?? null,
        invoice_number: tx.invoice_number,
      })
      .select()
      .single();
    if (error) throw error;
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

  async nextInvoiceNumber(channel: KasirChannel, date: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const prefix = channel === 'walkin' ? 'WLK'
      : channel === 'tokopedia' ? 'TPD'
      : channel === 'whatsapp' ? 'WAM'
      : 'GRS';
    const dateCompact = date.replace(/-/g, '');
    const { data, error } = await supabase.rpc('next_kasir_number', {
      p_channel: channel,
      p_date: date,
    });
    if (error) throw error;
    if (data == null) throw new Error('next_kasir_number returned null');
    const counter = String(data).padStart(3, '0');
    return `${prefix}-${dateCompact}-${counter}`;
  },
};
