/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import type { DbConversation, DbMessage, DbOrder } from '../types';

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
  updated_at?: string;
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

  async verifyPayment(orderId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ status: 'PAYMENT_VERIFIED', payment_verified_at: new Date().toISOString() })
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
};

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
};
