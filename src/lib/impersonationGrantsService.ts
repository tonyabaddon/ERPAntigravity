// src/lib/impersonationGrantsService.ts
// Client wrappers around the F-10 Phase 2a RPCs. Read/write from tenant
// owner's PengaturanScreen → Support Access panel. The RPCs themselves are
// SECDEF and enforce owner-only + tenant scoping via _resolve_tenant_id.

import { supabase, isSupabaseConfigured } from './supabaseClient';

export interface ImpersonationGrant {
  id: string;
  admin_email: string;
  granted_by_email: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_email: string | null;
  reason: string;
  is_active: boolean;
}

export const impersonationGrantsService = {
  async list(): Promise<ImpersonationGrant[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase.rpc('list_impersonation_grants');
    if (error) throw error;
    return (data ?? []) as ImpersonationGrant[];
  },

  async grant(args: {
    admin_email: string;
    expires_in_hours: number;
    reason: string;
  }): Promise<string> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('grant_impersonation', {
      p_admin_email: args.admin_email,
      p_expires_in_hours: args.expires_in_hours,
      p_reason: args.reason,
    });
    if (error) throw error;
    return data as string;
  },

  async revoke(args: { grant_id: string; reason: string }): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('revoke_impersonation', {
      p_grant_id: args.grant_id,
      p_reason: args.reason,
    });
    if (error) throw error;
  },
};
