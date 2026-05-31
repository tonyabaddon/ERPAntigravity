/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';

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
