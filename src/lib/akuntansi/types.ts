/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AccountType = 'ASET' | 'LIABILITAS' | 'MODAL' | 'PENDAPATAN' | 'BEBAN';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type Side = 'DEBIT' | 'CREDIT';
export type PeriodStatus = 'OPEN' | 'CLOSED' | 'REOPENED';
export type PpnMode = 'NON_PKP' | 'PKP';
export type PphMode = 'UMKM_FINAL_0_5' | 'BADAN_NORMAL_25' | 'BADAN_NORMAL_22' | 'MANUAL';

/**
 * Journal sources enumeration — 26 distinct source types.
 * Maps to enum values in database schema.
 */
export type JournalSource =
  | 'KASIR_SALE'
  | 'PEMBAYARAN'
  | 'PIUTANG_PAYMENT'
  | 'KASIR_EXPENSE'
  | 'PI_TAGIHAN'
  | 'PI_RECEIVE_GOODS'
  | 'WALKIN_PAYMENT'
  | 'TEMPO_WRITEOFF'
  | 'CASH_DEPOSIT_BATCH'
  | 'MANUAL_TRANSFER'
  | 'OWNER_DRAWING'
  | 'OWNER_TOPUP'
  | 'WALLET_TOPUP'
  | 'WALLET_SPEND'
  | 'ADJUSTMENT'
  | 'OPENING_BALANCE'
  | 'BACKFILL'
  | 'PERIOD_CLOSE'
  | 'YEAR_END_CLOSE'
  | 'HPP_RECOGNITION'
  | 'TAX_ACCRUAL_PPH'
  | 'TAX_ACCRUAL_PPN'
  | 'STOCK_OPNAME_ADJ'
  | 'DP_RECEIVE'
  | 'DP_RECOGNIZE'
  | 'DP_REFUND';

/**
 * Chart of Accounts (COA) entry.
 * Represents a single account in the chart of accounts.
 */
export interface CoaAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string | null;
  parent_id: string | null;
  normal_balance: NormalBalance;
  is_active: boolean;
  is_system: boolean;
  is_control_account: boolean;
  description: string | null;
  tenant_id: string | null;
}

/**
 * Accounting configuration for a tenant.
 * Stores tax modes, fiscal year settings, and feature flags.
 */
export interface AccountingConfig {
  id: string;
  tenant_id: string | null;
  ppn_mode: PpnMode;
  ppn_rate_pct: number;
  pph_mode: PphMode;
  pph_rate_pct: number | null;
  fiscal_year_start_month: number;
  enable_dual_write_to_gl: boolean;
  enable_strict_period_close: boolean;
  opening_balance_set: boolean;
  opening_balance_date: string | null;
  auto_accrue_pph_monthly: boolean;
  auto_accrue_ppn_monthly: boolean;
}

/**
 * Accounting period (monthly).
 * Tracks period status and closure information.
 */
export interface AccountingPeriod {
  id: string;
  tenant_id: string | null;
  period_year: number;
  period_month: number;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
}

/**
 * Opening balance line item.
 * Used to set initial balances for accounts.
 */
export interface OpeningBalanceLine {
  account_code: string;
  side: Side;
  amount: number;
  description?: string;
}

/**
 * Trial balance row.
 * Shows totals and balance for each account.
 */
export interface TrialBalanceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string | null;
  normal_balance: NormalBalance;
  total_debit: number;
  total_credit: number;
  balance: number;
}

/**
 * General ledger row.
 * Represents a single debit or credit line in the ledger.
 */
export interface GeneralLedgerRow {
  account_id: string;
  account_code: string;
  account_name: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_description: string;
  line_description: string | null;
  side: Side;
  amount: number;
  debit: number;
  credit: number;
  running_balance: number;
  source_type: JournalSource;
  source_ref_table: string | null;
  source_ref_id: string | null;
}
