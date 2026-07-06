/**
 * Types for the platform-admin API layer (Phase B Wave 1).
 * All shapes are derived from the actual RPC RETURNS TABLE definitions —
 * see task-2-report.md and task-3-report.md for schema verification notes.
 */

// ─── Scalar unions ────────────────────────────────────────────────────────────

export type EmployeeRange =
  | '1-3 orang (Mikro)'
  | '4-19 orang (Kecil)'
  | '20-99 orang (Menengah)'
  | '100+ orang (Besar)';

export type PlanCode = 'STARTER' | 'PRO' | 'PREMIUM';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/** Sourced from v_tenant_effective_features.expiry_state aliased as expiry_mode */
export type ExpiryMode = 'ACTIVE' | 'GRACE' | 'READONLY';

export type UsageStatus = 'SANGAT_AKTIF' | 'AKTIF' | 'IDLE' | 'VAKUM';

// ─── Row types ────────────────────────────────────────────────────────────────

/**
 * One row returned by list_tenants_admin().
 * total_count is BIGINT (window count for pagination) — modelled as number.
 */
export interface AdminTenantRow {
  tenant_id: string;
  slug: string;
  name: string;
  plan_code: PlanCode | null;
  status: TenantStatus;
  expiry_mode: ExpiryMode | null;
  activated_at: string | null;       // DATE → string (ISO)
  expires_at: string | null;         // DATE → string (ISO)
  days_until_expiry: number | null;  // INT, null when no subscription
  user_count: number;
  sku_count: number;
  industry: string | null;
  employee_range: EmployeeRange | null;
  onboarded_at: string;              // TIMESTAMPTZ aliased from t.created_at
  last_login_at: string | null;      // TIMESTAMPTZ from v_tenant_usage_summary
  txn_7d: number;                    // INT
  avg_daily_txn: number;             // NUMERIC
  usage_status: UsageStatus;
  total_count: number;               // BIGINT window COUNT(*) OVER ()
  /** Merged client-side from v_tenant_payment_coverage (Task 10). */
  coverage_status?: CoverageStatus | null;
}

/**
 * One row returned by list_audit_events().
 * id is BIGINT (platform_admin_audit.id) — use number, NOT string/uuid.
 * action is returned as action_code in the RPC RETURNS TABLE.
 */
export interface AuditEventRow {
  id: number;                        // BIGINT — not UUID
  ts: string;                        // TIMESTAMPTZ aliased from created_at
  admin_email: string;
  tenant_slug: string | null;        // nullable: LEFT JOIN on tenants
  action_code: string;               // aliased from a.action
  detail: Record<string, unknown> | null;
}

/**
 * Shape of the jsonb returned by _get_platform_dashboard_stats().
 * Key names verified against task-3-report prod values.
 */
export interface DashboardStats {
  tenants_total: number;
  active_count: number;
  suspended_count: number;
  expiring_45d: number;
  plans_count: number;
  pending_imports: number;
}

// ─── Filter shapes ────────────────────────────────────────────────────────────

/** p_filters for list_tenants_admin — whitelist: search, plan_code, status,
 *  expiry_within_days, page, page_size, sort_by, sort_dir */
export interface TenantsListFilters {
  search?: string;
  plan_code?: PlanCode | '';
  status?: TenantStatus | '';
  expiry_within_days?: number;
  page?: number;
  page_size?: number;
  sort_by?: 'name' | 'created_at' | 'plan_code' | 'expires_at' | 'last_login_at';
  sort_dir?: 'asc' | 'desc';
}

/** p_filters for list_audit_events — whitelist: tenant_id, action_code,
 *  actor, from_ts, to_ts, search, page, page_size, limit, offset */
export interface AuditListFilters {
  tenant_id?: string;
  action_code?: string;
  actor?: string;
  from_ts?: string;
  to_ts?: string;
  search?: string;
  page?: number;
  page_size?: number;
  /** @deprecated prefer page/page_size; kept for backward compat */
  limit?: number;
  /** @deprecated prefer page/page_size; kept for backward compat */
  offset?: number;
}

// ─── Task 12: tenant staff row ────────────────────────────────────────────────

/**
 * One row returned by list_tenant_users_admin(p_tenant_id uuid).
 * role values match tenant_users CHECK constraint in 20261001000001_phase_a_schema.sql.
 * status values match tenant_users CHECK constraint.
 * full_name falls back to email when raw_user_meta_data->>'full_name' is absent.
 */
export interface TenantUserRow {
  user_id:         string;
  email:           string;
  full_name:       string;
  role:            'owner' | 'admin' | 'staff' | 'kasir';
  status:          'ACTIVE' | 'DISABLED';
  last_sign_in_at: string | null;   // TIMESTAMPTZ → ISO string or null
  created_at:      string;          // TIMESTAMPTZ → ISO string
}

// ─── Overview extras (Task 11) ────────────────────────────────────────────────

/**
 * Extra fields fetched for the OverviewTab that are not on AdminTenantRow.
 * Combines: company_settings.annual_revenue_range
 *         + v_tenant_effective_features.effective_features
 */
export interface TenantOverviewExtras {
  annual_revenue_range: string | null;
  /** Map of modul_* → true/false from v_tenant_effective_features */
  effective_features: Record<string, boolean> | null;
}

// ─── Typed error classes ──────────────────────────────────────────────────────

/**
 * Abstract base for all typed admin-API errors.
 * Every subclass provides a Bahasa Indonesia `userMessage` suitable for toasts.
 */
export abstract class AdminApiError extends Error {
  abstract readonly userMessage: string;
  constructor(message?: string) {
    super(message);
    // Ensure correct prototype chain for instanceof checks in transpiled JS.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when the caller is not a platform admin (SQLSTATE P0403). */
export class PlatformAdminRequiredError extends AdminApiError {
  readonly code = 'P0403' as const;
  /** Bahasa Indonesia message suitable for toast display */
  readonly userMessage =
    'Akses ditolak: hanya admin platform yang dapat mengakses halaman ini.';

  constructor(cause?: string) {
    super(cause ?? 'PLATFORM_ADMIN_REQUIRED');
    this.name = 'PlatformAdminRequiredError';
  }
}

/** Raised when an unknown or invalid filter key is passed (SQLSTATE 22023). */
export class InvalidFilterError extends AdminApiError {
  readonly code = '22023' as const;
  /** Bahasa Indonesia message suitable for toast display */
  readonly userMessage = 'Filter tidak valid. Periksa kembali parameter pencarian.';

  constructor(cause?: string) {
    super(cause ?? 'invalid_parameter_value');
    this.name = 'InvalidFilterError';
  }
}

// ─── Wave 4a error classes ────────────────────────────────────────────────────

/** Raised when the requested tenant does not exist (SQLSTATE P0404). */
export class TenantNotFoundError extends AdminApiError {
  readonly userMessage = 'Tenant tidak ditemukan.';
  constructor(cause?: string) {
    super(cause ?? 'TENANT_NOT_FOUND');
    this.name = 'TenantNotFoundError';
  }
}

/** Raised when the new subscription date is not in the future (SQLSTATE 22023 INVALID_EXPIRES_AT). */
export class InvalidRenewalDateError extends AdminApiError {
  readonly userMessage = 'Tanggal perpanjangan harus lebih dari hari ini.';
  constructor(cause?: string) {
    super(cause ?? 'INVALID_EXPIRES_AT');
    this.name = 'InvalidRenewalDateError';
  }
}

/** Raised when an invalid plan code is supplied (SQLSTATE 22023 INVALID_PLAN_CODE). */
export class InvalidPlanCodeError extends AdminApiError {
  readonly userMessage = 'Kode paket tidak valid.';
  constructor(cause?: string) {
    super(cause ?? 'INVALID_PLAN_CODE');
    this.name = 'InvalidPlanCodeError';
  }
}

/** Raised when the action requires super-admin role (SQLSTATE P0403 SUPER_ADMIN_REQUIRED). */
export class SuperAdminRequiredError extends AdminApiError {
  readonly userMessage = 'Aksi ini butuh peran super admin.';
  constructor(cause?: string) {
    super(cause ?? 'SUPER_ADMIN_REQUIRED');
    this.name = 'SuperAdminRequiredError';
  }
}

/** Raised when trying to re-activate an ARCHIVED tenant (SQLSTATE 22023 CANNOT_ACTIVATE_ARCHIVED). */
export class CannotActivateArchivedError extends AdminApiError {
  readonly userMessage = 'Tenant yang sudah diarsipkan tidak bisa diaktifkan lagi.';
  constructor(cause?: string) {
    super(cause ?? 'CANNOT_ACTIVATE_ARCHIVED');
    this.name = 'CannotActivateArchivedError';
  }
}

// ─── Wave 5 error classes ─────────────────────────────────────────────────────

/** Coverage status for a tenant's subscription payment. */
export type CoverageStatus = 'LUNAS' | 'DP_60' | 'DP_30' | 'OVERDUE' | 'UNPAID';

/** Raised when amount ≤ 0 (SQLSTATE 22023 message=INVALID_AMOUNT). */
export class InvalidAmountError extends AdminApiError {
  readonly userMessage = 'Nominal pembayaran harus lebih dari 0.';
  constructor(cause?: string) {
    super(cause ?? 'INVALID_AMOUNT');
    this.name = 'InvalidAmountError';
  }
}

/** Raised when period_to is not after period_from (SQLSTATE 22023 message=INVALID_PERIOD). */
export class InvalidPeriodError extends AdminApiError {
  readonly userMessage = 'Periode akhir harus setelah periode mulai.';
  constructor(cause?: string) {
    super(cause ?? 'INVALID_PERIOD');
    this.name = 'InvalidPeriodError';
  }
}

/** Raised when payment_method requires bank/ewallet but none supplied (SQLSTATE 23514). */
export class MethodMismatchError extends AdminApiError {
  readonly userMessage = 'Metode pembayaran butuh informasi bank atau e-wallet.';
  constructor(cause?: string) {
    super(cause ?? 'METHOD_MISMATCH');
    this.name = 'MethodMismatchError';
  }
}

/** Raised when the requested payment does not exist (SQLSTATE P0404 message=PAYMENT_NOT_FOUND). */
export class PaymentNotFoundError extends AdminApiError {
  readonly userMessage = 'Data pembayaran tidak ditemukan.';
  constructor(cause?: string) {
    super(cause ?? 'PAYMENT_NOT_FOUND');
    this.name = 'PaymentNotFoundError';
  }
}

/** Raised when Storage RLS rejects the signed-URL request. */
export class StorageAccessDeniedError extends AdminApiError {
  readonly userMessage = 'Anda tidak berhak mengakses bukti ini.';
  constructor(cause?: string) {
    super(cause ?? 'STORAGE_ACCESS_DENIED');
    this.name = 'StorageAccessDeniedError';
  }
}

/** Raised when delete_payment is called without a reason (SQLSTATE 22023 message=REASON_REQUIRED). */
export class ReasonRequiredError extends AdminApiError {
  readonly userMessage = 'Alasan penghapusan wajib diisi.';
  constructor(cause?: string) {
    super(cause ?? 'REASON_REQUIRED');
    this.name = 'ReasonRequiredError';
  }
}

/** Raised when get_revenue_stats receives an invalid group_by value (SQLSTATE 22023 message=INVALID_GROUP_BY). */
export class InvalidGroupByError extends AdminApiError {
  readonly userMessage = 'Kelompok data tidak valid.';
  constructor(cause?: string) {
    super(cause ?? 'INVALID_GROUP_BY');
    this.name = 'InvalidGroupByError';
  }
}

/** Raised client-side when an uploaded proof file exceeds 5MB. */
export class PaymentFileTooLargeError extends AdminApiError {
  readonly userMessage = 'Bukti pembayaran maksimal 5 MB.';
  constructor(cause?: string) {
    super(cause ?? 'FILE_TOO_LARGE');
    this.name = 'PaymentFileTooLargeError';
  }
}

/** Raised client-side when an uploaded proof file is not JPG, PNG, or PDF. */
export class PaymentFileWrongTypeError extends AdminApiError {
  readonly userMessage = 'Bukti pembayaran harus JPG, PNG, atau PDF.';
  constructor(cause?: string) {
    super(cause ?? 'FILE_WRONG_TYPE');
    this.name = 'PaymentFileWrongTypeError';
  }
}

// ─── Wave 4a input/output types ───────────────────────────────────────────────

export interface RenewSubscriptionInput {
  tenant_id: string;
  new_expires_at: string;      // ISO date "YYYY-MM-DD"
  new_plan_code?: 'STARTER' | 'PRO' | 'PREMIUM' | null;
  notes?: string | null;
}

export interface RenewSubscriptionResult {
  ok: true;
  tenant_id: string;
  new_expires_at: string;
  new_grace_expires_at: string;
  plan_code: 'STARTER' | 'PRO' | 'PREMIUM';
}

export type AttentionReason = 'EXPIRING' | 'SUSPENDED' | 'EXPIRED_AND_SUSPENDED' | 'OVERDUE';

export interface AttentionTenantRow {
  tenant_id: string;
  slug: string;
  name: string;
  plan_code: 'STARTER' | 'PRO' | 'PREMIUM';
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  expires_at: string;
  days_until_expiry: number;   // may be negative
  attention_reason: AttentionReason;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  target_segment?: string;
  price_reference?: number | null;
  /** Annual price in IDR — Wave 5 addition. RPC whitelist extended via
   * migration 20261115000025e to accept this field. */
  price_annual?: number | null;
  feature_bundle?: Record<string, unknown>;
  is_recommended?: boolean;
  is_active?: boolean;
  sort_order?: number;
}
