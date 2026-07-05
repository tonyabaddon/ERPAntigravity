/**
 * Types for the platform-admin payment API layer (Phase B Wave 5).
 * All shapes are derived from the actual RPC RETURNS TABLE definitions
 * in migration 20261115000023 and 20261115000024.
 */

// ─── Scalar unions ────────────────────────────────────────────────────────────

export type PaymentMethod =
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'E_WALLET'
  | 'QRIS'
  | 'VIRTUAL_ACCOUNT'
  | 'OTHER';

export type BankName =
  | 'BCA'
  | 'MANDIRI'
  | 'BRI'
  | 'BNI'
  | 'PERMATA'
  | 'CIMB'
  | 'BSI'
  | 'DANAMON'
  | 'BTN'
  | 'MEGA'
  | 'MAYBANK'
  | 'PANIN'
  | 'OCBC'
  | 'JAGO'
  | 'SEA_BANK'
  | 'OTHER';

export type EwalletProvider =
  | 'OVO'
  | 'GOPAY'
  | 'DANA'
  | 'LINKAJA'
  | 'SHOPEEPAY'
  | 'JENIUS_PAY'
  | 'OTHER';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RecordPaymentInput {
  tenant_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;           // ISO YYYY-MM-DD
  period_from: string;
  period_to: string;
  bank_name?: BankName | null;
  ewallet_provider?: EwalletProvider | null;
  proof_object_key?: string | null;
  bank_reference?: string | null;
  notes?: string | null;
}

export type UpdatePaymentInput = Omit<Partial<RecordPaymentInput>, 'tenant_id'>;

// ─── Output types ─────────────────────────────────────────────────────────────

export interface RecordPaymentResult {
  ok: true;
  payment_id: string;
  amount_paid_ytd: number;
  coverage_ok: boolean;
  coverage_status: import('./adminTypes').CoverageStatus;
}

/**
 * One row returned by list_payments().
 * Note: backend RPC also returns tenant_slug, tenant_name, total_count
 * for pagination — those are used by paymentsApi.listPayments but not
 * included in this verbatim type per brief. Task 8 consumers will need
 * to extend or wrap this shape.
 */
export interface PaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  currency: 'IDR';
  payment_method: PaymentMethod;
  bank_name: BankName | null;
  ewallet_provider: EwalletProvider | null;
  payment_date: string;
  period_from: string;
  period_to: string;
  proof_url: string | null;       // storage path, not signed URL
  bank_reference: string | null;
  notes: string | null;
  recorded_by_admin: string;
  created_at: string;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface PaymentsListFilters {
  tenant_id?: string;
  payment_method?: PaymentMethod;
  from_date?: string;
  to_date?: string;
  min_amount?: number;
  page?: number;
  page_size?: number;
  sort_by?: 'payment_date' | 'amount';
  sort_dir?: 'asc' | 'desc';
}

export interface RevenueStatsFilters {
  from_date?: string;
  to_date?: string;
  group_by?: 'plan' | 'month' | 'tenant';
}

// ─── Revenue stats shape ──────────────────────────────────────────────────────

export interface RevenueStats {
  total: number;
  breakdown: { key: string; amount: number; count: number }[];
  monthly_trend: { month: string; total: number }[]; // always 12 rows
}
