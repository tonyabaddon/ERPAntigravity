// src/lib/platformSettingsApi.ts
// Typed wrapper for platform_settings singleton table (Wave 6 Task 8).
//
// Direct table read/write — no RPC needed.
// RLS enforces the super_admin write gate; SELECT is open to all authenticated users.
//
// Error mapping uses the same normalizeRpcError pattern as salesRepsApi.ts.

import { supabase } from './supabaseClient';
import {
  SuperAdminRequiredError,
  PlatformAdminRequiredError,
} from './adminTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlatformSettings {
  id: number;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  admin_wa_number: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normalizeRpcError(error: { message?: string; code?: string }): never {
  if (error.code === 'P0403') {
    if (error.message === 'SUPER_ADMIN_REQUIRED') {
      throw new SuperAdminRequiredError(error.message);
    }
    throw new PlatformAdminRequiredError(error.message);
  }
  // PGRST116 = "no rows returned" from PostgREST .single(). Sales_reps get
  // this when their UPDATE is silently filtered by RLS; surface as a
  // super-admin-required error instead of the cryptic PostgREST message.
  if (error.code === 'PGRST116') {
    throw new SuperAdminRequiredError('SUPER_ADMIN_REQUIRED');
  }
  throw new Error(error.message ?? 'Database error');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const platformSettingsApi = {
  /**
   * Fetch the singleton platform_settings row (id=1).
   * All authenticated platform admins can read.
   */
  async get(): Promise<PlatformSettings> {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) normalizeRpcError(error);
    return data as PlatformSettings;
  },

  /**
   * Update fields on the singleton platform_settings row (id=1).
   * RLS: super_admin only — sales_rep gets silently filtered (UPDATE returns 0 rows,
   * which Supabase returns as PGRST116 "no rows returned" when .single() is used).
   */
  async update(patch: Partial<Omit<PlatformSettings, 'id' | 'updated_at' | 'updated_by'>>): Promise<PlatformSettings> {
    const { data, error } = await supabase
      .from('platform_settings')
      .update(patch)
      .eq('id', 1)
      .select()
      .single();
    if (error) normalizeRpcError(error);
    return data as PlatformSettings;
  },
};
