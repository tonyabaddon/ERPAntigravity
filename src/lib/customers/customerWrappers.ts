import { supabase } from '../supabaseClient';
import type { DbCustomer } from '../../types';

/**
 * Phase Catat Penjualan wizard: new-customer + TEMPO request wrappers.
 * Sibling-module pattern so vi.mock('../supabaseClient') can intercept.
 */

export async function insertNewCustomer(args: {
  name: string;
  wa_number: string;
  company?: string;
  address?: string;
  default_pricing_tier?: 'eceran' | 'grosir';
  salutation?: 'Bapak' | 'Ibu' | null;
  contact_person_name?: string | null;
}): Promise<DbCustomer> {
  if (!supabase) throw new Error('Supabase not configured');
  // customers.id is TEXT NOT NULL with no default; matches existing
  // customersService.createCustomer pattern (crypto.randomUUID).
  // customers.company is NOT NULL with default '' — passing null violates
  // the constraint, so coerce to ''.
  // default_pricing_tier is only included when caller supplies it; when
  // omitted the DB default 'eceran' fires (CHECK IN 'eceran'|'grosir').
  const row: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name: args.name,
    wa_number: args.wa_number,
    company: args.company ?? '',
    address: args.address ?? null,
    allows_tempo: false,
    salutation: args.salutation ?? null,
    contact_person_name: args.contact_person_name ?? null,
  };
  if (args.default_pricing_tier !== undefined) {
    row.default_pricing_tier = args.default_pricing_tier;
  }
  const { data, error } = await supabase.from('customers').insert(row).select().single();
  if (error) throw error;
  return data as DbCustomer;
}

export async function requestCustomerCreditActivate(
  customerId: string,
  termDays: number,
  creditLimit: number,
  reason?: string,
): Promise<{ request_id: number }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_customer_credit_activate', {
    p_customer_id: customerId,
    p_term_days: termDays,
    p_credit_limit: creditLimit,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return { request_id: data as number };
}

export async function rejectCustomerCreditActivate(
  requestId: number,
  reason: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_customer_credit_activate', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw error;
}
