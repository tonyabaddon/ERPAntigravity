import { supabase } from '../supabaseClient';
import type { StoreSettings, OperatingHour, BankAccount } from './types';

export async function fetchStoreSettings(): Promise<StoreSettings> {
  // PK is now tenant_id (see migration 20261115000031). Legacy code hardcoded
  // .eq('id', 1) — that only worked for Garindo because it was the only row.
  // RLS scopes SELECT to the caller's tenant; one row returned.
  const { data, error } = await supabase
    .from('store_settings')
    .select('*')
    .single();
  if (error) throw error;
  return data as StoreSettings;
}

export async function fetchOperatingHours(): Promise<OperatingHour[]> {
  const { data, error } = await supabase
    .from('operating_hours')
    .select('*')
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OperatingHour[];
}

export async function fetchBankAccounts(activeOnly: boolean = false): Promise<BankAccount[]> {
  let q = supabase.from('store_bank_accounts').select('*').order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BankAccount[];
}
