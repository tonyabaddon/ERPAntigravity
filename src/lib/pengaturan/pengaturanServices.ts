import { supabase } from '../supabaseClient';
import type {
  DbApprovalSettings,
  DbTenantSettings,
  DbServiceType,
  ApprovalRequestType,
  ModulSwitchKey,
} from '../../types';

// ─── approval_settings ──────────────────────────────────────────────────
//
// Mutations go through SECURITY DEFINER RPCs (migration 20260622000007).
// Direct PostgREST .update() would 403 because INSERT/UPDATE/DELETE are
// REVOKE'd from authenticated. RPCs role-gate to Owner / Staff Admin Toko.
export const approvalSettingsService = {
  async fetch(): Promise<DbApprovalSettings[]> {
    const { data, error } = await supabase
      .from('approval_settings')
      .select('*')
      .order('request_type', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbApprovalSettings[];
  },

  async updateOne(
    requestType: ApprovalRequestType,
    patch: Partial<Pick<DbApprovalSettings,
      'approval_required' | 'verification_method' | 'threshold_amount' | 'threshold_qty' |
      'threshold_percent' | 'approver_role' | 'requestor_bypass_self' | 'reason_required'>>,
  ): Promise<void> {
    const { error } = await supabase.rpc('set_approval_setting', {
      p_request_type: requestType,
      p_patch: patch,
    });
    if (error) throw error;
  },
};

// ─── tenant_settings ────────────────────────────────────────────────────
export const tenantSettingsService = {
  async fetch(): Promise<DbTenantSettings | null> {
    const { data, error } = await supabase
      .from('tenant_settings')
      .select('*')
      .is('tenant_id', null)
      .maybeSingle();
    if (error) throw error;
    return data as DbTenantSettings | null;
  },

  async updateModul(key: ModulSwitchKey, value: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_tenant_modul', {
      p_key: key,
      p_value: value,
    });
    if (error) throw error;
  },

  async updatePajak(patch: Partial<Pick<DbTenantSettings,
    'pajak_mode' | 'pajak_ppn_rate_umum' | 'pajak_ppn_rate_mewah' | 'pajak_final_rate' |
    'pajak_umkm_jenis_badan' | 'pajak_umkm_terdaftar_at' | 'pajak_umkm_expires_at' |
    'pajak_npwp' | 'pajak_nik_as_npwp' | 'pajak_efaktur_enabled' |
    'pajak_pkp_registered_at' | 'pajak_coretax_id'>>,
  ): Promise<void> {
    const { error } = await supabase.rpc('set_tenant_pajak', {
      p_patch: patch,
    });
    if (error) throw error;
  },
};

// ─── service_types ──────────────────────────────────────────────────────
export const serviceTypesService = {
  async fetchActive(): Promise<DbServiceType[]> {
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbServiceType[];
  },

  async fetchAll(): Promise<DbServiceType[]> {
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbServiceType[];
  },

  async create(input: Omit<DbServiceType, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<DbServiceType> {
    const { data: newId, error } = await supabase.rpc('upsert_service_type', {
      p_id: null,
      p_input: input,
    });
    if (error) throw error;
    // RPC returns BIGINT id only — fetch the full row to keep the public signature.
    const { data: row, error: fetchErr } = await supabase
      .from('service_types')
      .select('*')
      .eq('id', newId as number)
      .single();
    if (fetchErr) throw fetchErr;
    return row as DbServiceType;
  },

  async update(id: number, patch: Partial<DbServiceType>): Promise<void> {
    const { error } = await supabase.rpc('upsert_service_type', {
      p_id: id,
      p_input: patch,
    });
    if (error) throw error;
  },

  async deactivate(id: number): Promise<void> {
    const { error } = await supabase.rpc('deactivate_service_type', {
      p_id: id,
    });
    if (error) throw error;
  },
};
