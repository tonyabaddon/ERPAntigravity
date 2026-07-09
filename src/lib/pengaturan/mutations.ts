import { supabase } from '../supabaseClient';
import type { StoreSettings, OperatingHour, BankAccount } from './types';

// RLS on store_settings / operating_hours / store_bank_accounts restricts writes to
// admin_users with role='Owner' (migration 010). These helpers do not pre-check;
// non-Owner callers will receive a PostgREST permission error which the caller
// surfaces via the standard error toast.

export async function updateStoreSettings(
  patch: Partial<Omit<StoreSettings, 'id' | 'updated_at' | 'updated_by'>>,
): Promise<void> {
  // RLS restricts UPDATE to the caller's tenant + Owner role. No filter
  // needed here — an unfiltered UPDATE affects only the row(s) RLS lets
  // through, which is the caller's single store_settings row (PK tenant_id).
  const { error } = await supabase
    .from('store_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .not('tenant_id', 'is', null); // no-op filter to satisfy PostgREST safety
  if (error) throw error;
}

export async function updateOperatingHour(
  day: number,
  patch: Partial<Omit<OperatingHour, 'day_of_week'>>,
): Promise<void> {
  const { error } = await supabase
    .from('operating_hours')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('day_of_week', day);
  if (error) throw error;
}

export async function createBankAccount(account: Omit<BankAccount, 'id'>): Promise<BankAccount> {
  const { data, error } = await supabase
    .from('store_bank_accounts')
    .insert(account)
    .select()
    .single();
  if (error) throw error;
  return data as BankAccount;
}

export async function updateBankAccount(
  id: string,
  patch: Partial<Omit<BankAccount, 'id'>>,
): Promise<BankAccount> {
  const { data, error } = await supabase
    .from('store_bank_accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as BankAccount;
}

export async function deleteBankAccount(id: string): Promise<void> {
  const { error } = await supabase.from('store_bank_accounts').delete().eq('id', id);
  if (error) throw error;
}
