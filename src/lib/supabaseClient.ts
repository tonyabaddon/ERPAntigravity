/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbCustomerWithStats, DbCustomerProfile, DbLead, DbNotificationConfig, DbCompanySettings, DbAdminUser, KasirTransaction, DailySummary, NewSaleTransaction, NewExpense } from '../types';

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
        stock: item.stock,
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

  async toggleAiControl(conversationId: string, makeActive: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('conversations')
      .update({ ai_active: makeActive })
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

  async approveOrder(orderId: string, shippingFee: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ shipping_fee: shippingFee, status: 'APPROVED' })
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

function periodStart(p: Period): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toISOString();
}

function groupByDay<T extends { created_at: string }>(
  rows: T[],
  days: number
): Array<{ label: string; rows: T[] }> {
  const buckets: Record<string, T[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = [];
  }
  for (const row of rows) {
    const key = row.created_at.slice(0, 10);
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const iso = todayStart.toISOString();

    const [ordersRes, convsRes, aiConvsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total')
        .eq('status', 'PAYMENT_VERIFIED')
        .gte('created_at', iso),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', iso),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('ai_active', true)
        .gte('created_at', iso),
    ]);

    const verifiedTotal = (ordersRes.data ?? []).reduce((sum, o) => sum + (o.total ?? 0), 0);
    return {
      verifiedOrdersTotal: verifiedTotal,
      verifiedOrdersCount: ordersRes.data?.length ?? 0,
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
      Revenue: rows.reduce((s, r) => s + ((r as any).total ?? 0), 0),
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
};

export const reportsService = {
  async fetchSummary(since: string): Promise<{
    revenue: number; orderCount: number; avgOrderValue: number;
    convCount: number; aiConvCount: number;
  }> {
    if (!supabase) return { revenue: 0, orderCount: 0, avgOrderValue: 0, convCount: 0, aiConvCount: 0 };
    const [ordersRes, convsRes] = await Promise.all([
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', since),
      supabase.from('conversations').select('ai_active').gte('created_at', since),
    ]);
    const orders = ordersRes.data ?? [];
    const convs = convsRes.data ?? [];
    const revenue = orders.reduce((s, o) => s + ((o as any).total ?? 0), 0);
    return {
      revenue,
      orderCount: orders.length,
      avgOrderValue: orders.length > 0 ? Math.round(revenue / orders.length) : 0,
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
      Revenue: rows.reduce((s, r) => s + ((r as any).total ?? 0), 0),
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
    const { data } = await supabase
      .from('orders')
      .select('items')
      .eq('status', 'PAYMENT_VERIFIED')
      .gte('created_at', since);
    const tally: Record<string, { qty: number; revenue: number }> = {};
    for (const order of (data ?? [])) {
      for (const item of ((order as any).items ?? [])) {
        if (!item.name) continue;
        if (!tally[item.name]) tally[item.name] = { qty: 0, revenue: 0 };
        tally[item.name].qty += item.qty ?? 0;
        tally[item.name].revenue += item.subtotal ?? 0;
      }
    }
    return Object.entries(tally)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
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

  async decrementStock(sku: string, qty: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty });
    if (error) {
      // Fallback: fetch current stock, then update
      const { data, error: fetchErr } = await supabase
        .from('stocks')
        .select('stock')
        .eq('sku', sku)
        .single();
      if (fetchErr) throw fetchErr;
      const newStock = Math.max(0, (data.stock as number) - qty);
      const { error: updateErr } = await supabase
        .from('stocks')
        .update({ stock: newStock, updated_at: new Date().toISOString() })
        .eq('sku', sku);
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

    for (const tx of transactions) {
      if (tx.type === 'income') {
        totalIncome += tx.subtotal;
        totalHpp += tx.hpp_total;
        itemsSold += tx.items.reduce((s, i) => s + i.qty, 0);
        if (tx.channel) byChannel[tx.channel] = (byChannel[tx.channel] ?? 0) + tx.subtotal;
      } else {
        totalExpense += tx.subtotal;
      }
    }

    for (const order of waOrders) {
      totalIncome += order.total;
      byChannel.wa_order = (byChannel.wa_order ?? 0) + order.total;
      itemsSold += (order.items ?? []).reduce((s: number, i: { qty: number }) => s + i.qty, 0);
      for (const item of (order.items ?? [])) {
        const hpp = stockMap[item.sku] ?? 0;
        totalHpp += hpp * item.qty;
      }
    }

    const labaKotor = totalIncome - totalHpp;
    const labaBersih = labaKotor - totalExpense;
    return { totalIncome, totalExpense, totalHpp, labaKotor, labaBersih, itemsSold, byChannel };
  },

  async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({ ...tx, type: 'income' })
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
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

  generateInvoiceNumber(channel: 'walkin' | 'tokopedia' | 'grosir', counter: number): string {
    const prefix = { walkin: 'WLK', tokopedia: 'TPD', grosir: 'GRS' }[channel];
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${String(counter).padStart(3, '0')}`;
  },
};
