// src/lib/salesRepsApi.ts
// Typed wrappers for sales_rep management RPCs (Wave 6 Task 5).
//
// RPC signatures (deployed Task 4):
//   create_sales_rep(p_user_id uuid, p_email text, p_name text)
//   deactivate_sales_rep(p_user_id uuid, p_reason text)
//
// Error mapping:
//   P0403 SUPER_ADMIN_REQUIRED → SuperAdminRequiredError
//   P0403 (other)              → PlatformAdminRequiredError
//   P0002                      → TenantNotFoundError (user not found)
//   22023                      → InvalidFilterError

import { supabase } from './supabaseClient';
import {
  PlatformAdminRequiredError,
  SuperAdminRequiredError,
  TenantNotFoundError,
  InvalidFilterError,
} from './adminTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalesRep {
  user_id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'sales_rep';
  status: 'active' | 'disabled';
  created_at: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a raw Supabase/Postgres error into a typed admin error.
 * Mirrors adminApi.normalizeRpcError (which is not exported) but scoped
 * to codes relevant to sales rep RPCs.
 */
function normalizeRpcError(error: { message?: string; code?: string }): never {
  // P0002 — no_data_found (user not found / not in platform_admins)
  if (error.code === 'P0002') {
    throw new TenantNotFoundError(error.message);
  }
  // P0403 — check specific message before generic fallthrough
  if (error.code === 'P0403') {
    if (error.message === 'SUPER_ADMIN_REQUIRED') {
      throw new SuperAdminRequiredError(error.message);
    }
    throw new PlatformAdminRequiredError(error.message);
  }
  // 22023 — invalid parameter
  if (error.code === '22023') {
    throw new InvalidFilterError(error.message);
  }
  throw new Error(error.message ?? 'RPC error');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const salesRepsApi = {
  /**
   * List all platform_admins with role = 'sales_rep', newest first.
   */
  async list(): Promise<SalesRep[]> {
    const { data, error } = await supabase
      .from('platform_admins')
      .select('user_id, email, name, role, status, created_at')
      .eq('role', 'sales_rep')
      .order('created_at', { ascending: false });
    if (error) normalizeRpcError(error);
    return (data ?? []) as SalesRep[];
  },

  /**
   * Create a new sales rep (super_admin only).
   * p_user_id must refer to an existing auth.users record (created manually via Supabase Dashboard).
   */
  async create(userId: string, email: string, name: string): Promise<SalesRep> {
    const { error } = await supabase.rpc('create_sales_rep', {
      p_user_id: userId,
      p_email: email,
      p_name: name,
    });
    if (error) normalizeRpcError(error);
    return {
      user_id: userId,
      email,
      name,
      role: 'sales_rep',
      status: 'active',
      created_at: new Date().toISOString(),
    };
  },

  /**
   * Deactivate a sales rep (super_admin only). Sets status = 'disabled'.
   */
  async deactivate(userId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('deactivate_sales_rep', {
      p_user_id: userId,
      p_reason: reason,
    });
    if (error) normalizeRpcError(error);
  },
};
