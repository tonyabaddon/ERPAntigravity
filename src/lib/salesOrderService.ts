import type { DbSalesOrder, KasirItem } from '../types';
import { supabase } from './supabaseClient';

export interface CreateSalesOrderInput {
  channel: string;
  date?: string;
  items: KasirItem[];
  subtotal: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  notes: string | null;
}

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<DbSalesOrder> {
  const { data, error } = await supabase.rpc('create_sales_order', {
    p_payload: {
      channel: input.channel,
      date: input.date,
      items: input.items,
      subtotal: input.subtotal,
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      customer_company: input.customer_company,
      notes: input.notes,
    },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('create_sales_order returned no row');
  return data as DbSalesOrder;
}

export async function fetchSalesOrderById(soId: string): Promise<DbSalesOrder | null> {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('id', soId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbSalesOrder | null) ?? null;
}

export async function fetchSalesOrders(
  filter?: { status?: DbSalesOrder['status'] },
): Promise<DbSalesOrder[]> {
  let query = supabase.from('sales_orders').select('*');
  if (filter?.status) {
    query = query.eq('status', filter.status);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DbSalesOrder[];
}

export async function markSalesOrderConverted(
  soId: string,
  target: { kasirTxId?: string; orderId?: string },
): Promise<DbSalesOrder> {
  const hasKt = typeof target.kasirTxId === 'string' && target.kasirTxId.length > 0;
  const hasOrder = typeof target.orderId === 'string' && target.orderId.length > 0;
  if (hasKt === hasOrder) {
    throw new Error('Exactly one of kasirTxId or orderId must be provided');
  }
  const { data, error } = await supabase.rpc('mark_sales_order_converted', {
    p_so_id: soId,
    p_target_kasir_tx_id: hasKt ? target.kasirTxId! : null,
    p_target_order_id: hasOrder ? target.orderId! : null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('mark_sales_order_converted returned no row');
  return data as DbSalesOrder;
}

export async function closeSalesOrder(soId: string, reason: string): Promise<DbSalesOrder> {
  if (!reason || reason.trim().length === 0) {
    throw new Error('Close reason is required');
  }
  const { data, error } = await supabase.rpc('close_sales_order', {
    p_so_id: soId,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('close_sales_order returned no row');
  return data as DbSalesOrder;
}
