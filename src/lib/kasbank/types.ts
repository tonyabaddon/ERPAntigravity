/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cash account type.
 */
export type CashAccountType = 'BANK' | 'KAS' | 'E_WALLET';

/**
 * Cash account purpose.
 */
export type CashAccountPurpose = 'OPERATIONAL' | 'OWNER_PERSONAL' | 'SAVINGS' | 'PETTY_CASH' | 'OTHER';

/**
 * Bank code enumeration for bank accounts.
 */
export type BankCode = 'BCA' | 'MANDIRI' | 'BRI' | 'BNI' | 'PERMATA' | 'CIMB' | 'OTHER';

/**
 * Cash account entry.
 * Represents a single cash/bank account tracked in the system.
 */
export interface CashAccount {
  id: string;
  account_type: CashAccountType;
  bank_code: BankCode | null;
  account_number: string | null;
  account_holder: string | null;
  internal_label: string;
  provider: string | null;
  purpose: CashAccountPurpose;
  show_in_invoice: boolean;
  sort_order: number;
  is_active: boolean;
  opening_balance: number;
  opening_balance_date: string | null;
  coa_account_id: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cash account balance row from cash_account_balances view.
 * Aggregates balance information with journal entries.
 * coa_account_id and account_code are merged in by the service layer
 * (not in the DB view) so the UI can show COA codes on account cards.
 */
export interface CashAccountBalance {
  cash_account_id: string;
  internal_label: string;
  account_type: CashAccountType;
  purpose: CashAccountPurpose;
  bank_code: BankCode | null;
  account_number: string | null;
  account_holder: string | null;
  provider: string | null;
  sort_order: number;
  is_active: boolean;
  tenant_id: string | null;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  pending_in: number;
  current_balance: number;
  last_movement_date: string | null;
  movements_this_month: number;
  /** COA account ID — merged from cash_accounts table by service layer */
  coa_account_id: string | null;
  /** COA account_code (e.g. "1-1210") — merged from chart_of_accounts by service layer */
  account_code: string | null;
}

/**
 * Input for creating/updating a cash account.
 * Omits id, created_at, updated_at. tenant_id is server-derived from JWT via
 * the column DEFAULT _resolve_tenant_id() — do NOT pass it from the client.
 */
export interface CashAccountInput {
  account_type: CashAccountType;
  bank_code?: BankCode | null;
  account_number?: string | null;
  account_holder?: string | null;
  internal_label: string;
  provider?: string | null;
  purpose?: CashAccountPurpose;
  show_in_invoice?: boolean;
  sort_order?: number;
  is_active?: boolean;
  opening_balance?: number;
  opening_balance_date?: string | null;
  coa_account_id?: string | null;
}
