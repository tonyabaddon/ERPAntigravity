import type { DbCustomer, DbSalesOrder, KasirItem } from '../types';
import { extractErrorMessage } from './extractErrorMessage';
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
  // Penawaran customer snapshot (from selected customer record)
  selectedCustomer?: DbCustomer | null;
  // Per-SO override fields (null = use StoreSettings default at PDF render)
  opening_greeting_override?: string | null;
  payment_terms_override?: string | null;
  lead_time_override?: string | null;
  so_notes_override?: string | null;
  valid_until_override?: string | null; // ISO date YYYY-MM-DD
}

/**
 * Look up the current user's admin_users.name for the Penawaran signatory snapshot.
 * Returns null if the current user has no matching admin_users row (edge case:
 * super-admin, provisioning race). Consumer falls back to
 * store_settings.default_signatory_name at PDF render time.
 *
 * Uses admin_users' open-access RLS (POLICY "anon full access admin_users",
 * migration 20260603000003). Runs entirely client-side to avoid extending
 * create_sales_order's SECDEF body to read auth.* (miss-log Entry #4 class trap).
 */
async function resolveCreatedByName(): Promise<string | null> {
  try {
    const { data: userResp } = await supabase.auth.getUser();
    const email = userResp?.user?.email;
    if (!email) return null;

    const { data, error } = await supabase
      .from('admin_users')
      .select('name')
      .eq('email', email) // exact match — matches existing convention in supabaseClient.ts fetchByEmail
      .maybeSingle();

    if (error) {
      console.warn('resolveCreatedByName lookup failed:', extractErrorMessage(error));
      return null;
    }
    return data?.name ?? null;
  } catch (e) {
    console.warn('resolveCreatedByName unexpected error:', extractErrorMessage(e));
    return null;
  }
}

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<DbSalesOrder> {
  const createdByName = await resolveCreatedByName();

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
      // Penawaran snapshot fields from selected customer
      customer_salutation: input.selectedCustomer?.salutation ?? null,
      customer_contact_person: input.selectedCustomer?.contact_person_name ?? null,
      // Signatory snapshot (client-side lookup)
      created_by_name: createdByName,
      // Per-SO override fields
      opening_greeting_override: input.opening_greeting_override ?? null,
      payment_terms_override: input.payment_terms_override ?? null,
      lead_time_override: input.lead_time_override ?? null,
      so_notes_override: input.so_notes_override ?? null,
      valid_until_override: input.valid_until_override ?? null,
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
