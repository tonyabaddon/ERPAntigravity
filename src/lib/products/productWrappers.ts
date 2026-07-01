import type { SupabaseStockItem } from '../supabaseClient';
import { supabase } from '../supabaseClient';

export interface InsertNewProductInput {
  name: string;
  category: string;
  price: number;
  harga_modal?: number;
  unit?: string;
  subcategory?: string;
  brand?: string;
}

/**
 * Lite-create a new product from the wizard's Step 2 inline form.
 * Routes through admin_upsert_product SD RPC (migration 20260910000009):
 * the value-bearing columns (price, harga_modal) can no longer be written
 * via direct .insert() from the anon/authenticated roles; the RPC gates
 * the write on Owner + Staff Admin Toko role.
 *
 * stocks defaults: stock_atas=0, stock_bawah=0, status='Sinkron',
 * initial_stock_approved=true. Photos/specs/min_stock left at column
 * defaults — set later via Produk & Stok screen.
 */
export async function insertNewProduct(args: InsertNewProductInput): Promise<SupabaseStockItem> {
  if (!args.name || args.name.trim().length === 0) {
    throw new Error('Product name is required');
  }
  if (!args.category || args.category.trim().length === 0) {
    throw new Error('Product category is required');
  }
  if (!Number.isFinite(args.price) || args.price <= 0) {
    throw new Error('Product price must be a positive number');
  }

  const payload: Record<string, unknown> = {
    name: args.name.trim(),
    category: args.category.trim(),
    price: args.price,
    stock: 0,
    stock_atas: 0,
    stock_bawah: 0,
    status: 'Sinkron',
    unit: args.unit?.trim() || 'pcs',
  };
  if (typeof args.harga_modal === 'number') payload.harga_modal = args.harga_modal;
  if (args.subcategory && args.subcategory.trim()) payload.subcategory = args.subcategory.trim();
  if (args.brand && args.brand.trim()) payload.brand = args.brand.trim();

  const { data, error } = await supabase.rpc('admin_upsert_product', { p_input: payload });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('insertNewProduct returned no row');
  return data as SupabaseStockItem;
}
