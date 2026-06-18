import { supabase } from '../supabaseClient';
import type { StoreSettings, OperatingHour, BankAccount } from './types';

export async function fetchStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await supabase
    .from('store_settings')
    .select('*')
    .eq('id', 1)
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
  let q = supabase.from('bank_accounts').select('*').order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BankAccount[];
}
