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
  RenewSubscriptionInput,
  RenewSubscriptionResult,
  UpdatePlanInput,
  AttentionTenantRow,
  CoverageStatus,
} from './adminTypes';
import {
  PlatformAdminRequiredError,
  InvalidFilterError,
  TenantNotFoundError,
  InvalidRenewalDateError,
  InvalidPlanCodeError,
  SuperAdminRequiredError,
  CannotActivateArchivedError,
  InvalidAmountError,
  InvalidPeriodError,
  MethodMismatchError,
  PaymentNotFoundError,
  ReasonRequiredError,
  InvalidGroupByError,
} from './adminTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalise a raw Supabase/Postgres error into a typed error.
 * Supabase surfaces SQLSTATE on `error.code` (string).
 */
function normalizeRpcError(error: { message?: string; code?: string }): never {
  // P0002 — no_data_found (deprovision_tenant: tenant not found)
  if (error.code === 'P0002') {
    throw new TenantNotFoundError(error.message);
  }
  // P0404 — check specific message before generic tenant fallthrough
  if (error.code === 'P0404') {
    if (error.message === 'PAYMENT_NOT_FOUND') {
      throw new PaymentNotFoundError(error.message);
    }
    throw new TenantNotFoundError(error.message);
  }
  // P0403 — check specific message before generic fallthrough
  if (error.code === 'P0403') {
    if (error.message === 'SUPER_ADMIN_REQUIRED') {
      throw new SuperAdminRequiredError(error.message);
    }
    throw new PlatformAdminRequiredError(error.message);
  }
  // 23514 — CHECK constraint violation (payment method / bank / ewallet mismatch)
  if (error.code === '23514') {
    throw new MethodMismatchError(error.message);
  }
  // 22023 — check specific message before generic fallthrough
  if (error.code === '22023') {
    if (error.message === 'INVALID_EXPIRES_AT') {
      throw new InvalidRenewalDateError(error.message);
    }
    if (error.message === 'INVALID_PLAN_CODE') {
      throw new InvalidPlanCodeError(error.message);
    }
    if (error.message === 'CANNOT_ACTIVATE_ARCHIVED') {
      throw new CannotActivateArchivedError(error.message);
    }
    if (error.message === 'INVALID_AMOUNT') {
      throw new InvalidAmountError(error.message);
    }
    if (error.message === 'INVALID_PERIOD') {
      throw new InvalidPeriodError(error.message);
    }
    if (error.message === 'REASON_REQUIRED') {
      throw new ReasonRequiredError(error.message);
    }
    if (error.message === 'INVALID_GROUP_BY') {
      throw new InvalidGroupByError(error.message);
    }
    throw new InvalidFilterError(error.message);
  }
  // Generic pass-through
  throw new Error(error.message ?? 'RPC error');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Row shape from v_tenant_payment_coverage used for client-side merge. */
interface CoverageRow {
  tenant_id: string;
  coverage_status: CoverageStatus;
}

/**
 * Call list_tenants_admin(p_filters jsonb).
 * Returns a paginated list of tenant rows. `total_count` on each row carries
 * the window-count for pagination.
 *
 * After fetching tenants, also fetches v_tenant_payment_coverage in parallel
 * and merges `coverage_status` onto each row by `tenant_id`. The coverage
 * fetch is best-effort: on error, rows are returned without coverage_status.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidFilterError          when an unknown filter key is supplied
 */
export async function listTenantsAdmin(
  filters: TenantsListFilters = {},
): Promise<AdminTenantRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');

  // Run tenant RPC + coverage view in parallel.
  const [tenantsResult, coverageResult] = await Promise.all([
    supabase.rpc('list_tenants_admin', { p_filters: filters }),
    supabase
      .from('v_tenant_payment_coverage')
      .select('tenant_id, coverage_status'),
  ]);

  if (tenantsResult.error) normalizeRpcError(tenantsResult.error);

  const rows = (tenantsResult.data ?? []) as AdminTenantRow[];

  // Best-effort coverage merge — silently skip if view is unavailable.
  if (!coverageResult.error && coverageResult.data) {
    const coverageMap = new Map<string, CoverageStatus>(
      (coverageResult.data as CoverageRow[]).map((r) => [r.tenant_id, r.coverage_status]),
    );
    for (const row of rows) {
      row.coverage_status = coverageMap.get(row.tenant_id) ?? null;
    }
  }

  return rows;
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

// ─── Wave 4a wrappers ─────────────────────────────────────────────────────────

/**
 * Call renew_subscription(p_tenant_id, p_new_expires_at, p_new_plan_code, p_notes).
 * Extends a tenant subscription. Does NOT auto-reactivate suspended tenants.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws TenantNotFoundError         when tenant_id does not exist
 * @throws InvalidRenewalDateError     when new_expires_at <= today
 * @throws InvalidPlanCodeError        when new_plan_code is not in the plans table
 */
export async function renewSubscription(
  input: RenewSubscriptionInput,
): Promise<RenewSubscriptionResult> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('renew_subscription', {
    p_tenant_id:      input.tenant_id,
    p_new_expires_at: input.new_expires_at,
    p_new_plan_code:  input.new_plan_code ?? null,
    p_notes:          input.notes ?? null,
  });
  if (error) normalizeRpcError(error);
  return data as RenewSubscriptionResult;
}

/**
 * Call suspend_tenant(p_tenant_id, p_reason).
 * Suspends a tenant. Idempotent — second call on already-suspended tenant
 * returns {ok, noop, reason} without a new audit row.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws TenantNotFoundError         when tenant_id does not exist
 * @throws InvalidFilterError          when reason is empty (22023 INVALID_REASON)
 */
export async function suspendTenant(
  tenantId: string,
  reason: string,
): Promise<{ ok: true; suspended_at: string; reason: string }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('suspend_tenant', {
    p_tenant_id: tenantId,
    p_reason:    reason,
  });
  if (error) normalizeRpcError(error);
  return data as { ok: true; suspended_at: string; reason: string };
}

/**
 * Call activate_tenant(p_tenant_id).
 * Re-activates a suspended tenant. Idempotent — already-ACTIVE returns {ok, noop}.
 *
 * @throws PlatformAdminRequiredError    when caller is not a platform admin
 * @throws TenantNotFoundError           when tenant_id does not exist
 * @throws CannotActivateArchivedError   when tenant is ARCHIVED
 */
export async function activateTenant(
  tenantId: string,
): Promise<{ ok: true; status: 'ACTIVE' }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('activate_tenant', {
    p_tenant_id: tenantId,
  });
  if (error) normalizeRpcError(error);
  return data as { ok: true; status: 'ACTIVE' };
}

/**
 * Call update_plan_admin(p_plan_code, p_updates).
 * Updates a plan row. Double-gated: platform admin + super admin.
 * Per-key CASE-WHEN UPDATE — no dynamic SQL.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws SuperAdminRequiredError     when caller is not a super admin
 * @throws InvalidPlanCodeError        when plan_code is not STARTER/PRO/PREMIUM
 * @throws InvalidFilterError          when an unknown key is supplied in updates
 */
export async function updatePlan(
  planCode: 'STARTER' | 'PRO' | 'PREMIUM',
  updates: UpdatePlanInput,
): Promise<{ ok: true; updated_keys: string[] }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('update_plan_admin', {
    p_plan_code: planCode,
    p_updates:   updates,
  });
  if (error) normalizeRpcError(error);
  return data as { ok: true; updated_keys: string[] };
}

/**
 * Call list_attention_tenants(p_expiry_within_days).
 * Returns tenants requiring attention: expiring within N days OR suspended.
 * Excludes ARCHIVED. Sorted by days_until_expiry ASC, then name.
 *
 * @param withinDays  Number of days to look ahead (1-365; default 45)
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidFilterError          when withinDays is out of range (22023 INVALID_RANGE)
 */
export async function listAttentionTenants(
  withinDays = 45,
): Promise<AttentionTenantRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_attention_tenants', {
    p_expiry_within_days: withinDays,
  });
  if (error) normalizeRpcError(error);
  return (data ?? []) as AttentionTenantRow[];
}

/**
 * Call deprovision_tenant(p_tenant_id, p_reason).
 * Hard-deletes a tenant and all its data atomically. Preserves auth.users.
 * Super admin only.
 *
 * @throws SuperAdminRequiredError  when caller is not super admin (P0403)
 * @throws TenantNotFoundError      when tenant UUID does not exist (P0002)
 */
export async function deprovisionTenant(
  tenantId: string,
  reason: string,
): Promise<{ deleted_slug: string; deleted_at: string; actor: string }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('deprovision_tenant', {
    p_tenant_id: tenantId,
    p_reason:    reason,
  });
  if (error) normalizeRpcError(error);
  return data as { deleted_slug: string; deleted_at: string; actor: string };
}
