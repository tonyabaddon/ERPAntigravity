/**
 * Typed wrappers for the three platform-admin RPCs (Phase B Wave 1).
 *
 * Pattern follows existing services in supabaseClient.ts:
 *   - Guard with `if (!supabase) throw new Error(...)` before every call
 *   - Call supabase.rpc(name, params)
 *   - On error: inspect error.code for known SQLSTATE codes; throw typed errors
 *   - Return typed data cast on the happy path
 *
 * Error mapping:
 *   P0403 → PlatformAdminRequiredError  (non-platform-admin caller)
 *   22023 → InvalidFilterError           (unknown filter key)
 */

import { supabase } from './supabaseClient';
import type {
  AdminTenantRow,
  AuditEventRow,
  DashboardStats,
  TenantsListFilters,
  AuditListFilters,
  TenantOverviewExtras,
  TenantUserRow,
} from './adminTypes';
import { PlatformAdminRequiredError, InvalidFilterError } from './adminTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalise a raw Supabase/Postgres error into a typed error.
 * Supabase surfaces SQLSTATE on `error.code` (string).
 */
function normalizeRpcError(error: { message?: string; code?: string }): never {
  if (error.code === 'P0403') {
    throw new PlatformAdminRequiredError(error.message);
  }
  if (error.code === '22023') {
    throw new InvalidFilterError(error.message);
  }
  // Generic pass-through
  throw new Error(error.message ?? 'RPC error');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call list_tenants_admin(p_filters jsonb).
 * Returns a paginated list of tenant rows. `total_count` on each row carries
 * the window-count for pagination.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidFilterError          when an unknown filter key is supplied
 */
export async function listTenantsAdmin(
  filters: TenantsListFilters = {},
): Promise<AdminTenantRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_tenants_admin', {
    p_filters: filters,
  });
  if (error) normalizeRpcError(error);
  return (data ?? []) as AdminTenantRow[];
}

/**
 * Call list_audit_events(p_filters jsonb).
 * Returns paginated audit event rows. `id` is number (BIGINT in Postgres).
 * Return column `action_code` corresponds to platform_admin_audit.action.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidFilterError          when an unknown filter key is supplied
 */
export async function listAuditEvents(
  filters: AuditListFilters = {},
): Promise<AuditEventRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_audit_events', {
    p_filters: filters,
  });
  if (error) normalizeRpcError(error);
  return (data ?? []) as AuditEventRow[];
}

/**
 * Fetch extra fields for OverviewTab that are not on AdminTenantRow.
 * Reads company_settings (annual_revenue_range) and v_tenant_effective_features
 * (effective_features) in parallel. Both tables have p_platform_admin_readall RLS.
 *
 * Returns { annual_revenue_range, effective_features } — both nullable so callers
 * can render em-dash placeholders for tenants that haven't filled these in.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 */
export async function getTenantOverviewExtras(
  tenantId: string,
): Promise<TenantOverviewExtras> {
  if (!supabase) throw new Error('Supabase client not configured');

  const [settingsResult, featuresResult] = await Promise.all([
    supabase
      .from('company_settings')
      .select('annual_revenue_range')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('v_tenant_effective_features')
      .select('effective_features')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (settingsResult.error) normalizeRpcError(settingsResult.error);
  if (featuresResult.error) normalizeRpcError(featuresResult.error);

  return {
    annual_revenue_range:
      (settingsResult.data?.annual_revenue_range as string | null) ?? null,
    effective_features:
      (featuresResult.data?.effective_features as Record<string, boolean> | null) ??
      null,
  };
}

/**
 * Call list_tenant_users_admin(p_tenant_id uuid).
 * Returns staff rows for the given tenant (user_id, email, full_name, role,
 * status, last_sign_in_at, created_at). Ordered: owner first, then by created_at.
 *
 * Note: function is owned by postgres (not vosi_rpc_owner) because vosi_rpc_owner
 * lacks USAGE on schema auth (supabase_admin owns auth; postgres cannot re-grant).
 * The P0403 gate inside the SQL body provides the required access control.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 */
export async function listTenantUsersAdmin(tenantId: string): Promise<TenantUserRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_tenant_users_admin', {
    p_tenant_id: tenantId,
  });
  if (error) normalizeRpcError(error);
  return (data ?? []) as TenantUserRow[];
}

/**
 * Call _get_platform_dashboard_stats().
 * Returns a single jsonb object with aggregate counts for the admin dashboard.
 * Key names: tenants_total, active_count, suspended_count, expiring_45d,
 * plans_count, pending_imports.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 */
export async function getPlatformDashboardStats(): Promise<DashboardStats> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('_get_platform_dashboard_stats');
  if (error) normalizeRpcError(error);
  return data as DashboardStats;
}
