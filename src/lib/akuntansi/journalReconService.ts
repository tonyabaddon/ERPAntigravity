/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Unmatched bank statement line from bank_statement_lines table.
 * Represents a single transaction from a bank statement that hasn't been reconciled to a journal entry yet.
 */
export interface UnreconciledBankLine {
  id: string;
  bank_account_id: string;
  date: string; // txn_date from DB, ISO date string
  description: string | null;
  amount: number;
  direction: 'IN' | 'OUT';
  lane: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';
}

/**
 * Unmatched journal entry line on a bank-type account.
 * Represents a single debit or credit that hasn't been matched to a bank statement line yet.
 */
export interface UnreconciledJournalLine {
  id: string;
  entry_id: string;
  entry_number: string;
  entry_date: string; // ISO date string
  description: string | null;
  account_code: string;
  account_id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
}

/**
 * Result from matching one or more journal lines to a bank line.
 */
export interface MatchResult {
  ok: true;
  matched_count: number;
  total_amount_matched: number;
}

/**
 * Result from auto-matching journal lines to bank statements for a period.
 */
export interface AutoMatchResult {
  auto_matched: number;
  candidates_pending_manual: number;
}

/**
 * Ensures Supabase client is configured.
 * @throws Error if Supabase is not configured
 */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

/**
 * Fetch unmatched bank statement lines for a given bank account and date range.
 * Returns lines that are not yet matched to journal entries (bank_line_id IS NULL on JE side).
 *
 * @param bankAccountId - Bank account UUID
 * @param fromDate - Start date (ISO format: YYYY-MM-DD)
 * @param toDate - End date (ISO format: YYYY-MM-DD)
 * @returns Array of unmatched bank statement lines
 * @throws Error if query fails or Supabase is not configured
 */
export async function fetchUnreconciledBankLines(
  bankAccountId: string,
  fromDate: string,
  toDate: string,
): Promise<UnreconciledBankLine[]> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('bank_statement_lines')
    .select('id, bank_account_id, txn_date, description, amount, direction, lane')
    .eq('bank_account_id', bankAccountId)
    .gte('txn_date', fromDate)
    .lte('txn_date', toDate)
    .is('matched_at', null); // Only unmatched (matched_at IS NULL)

  if (error) throw new Error(error.message);

  return (
    data?.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      bank_account_id: row.bank_account_id as string,
      date: row.txn_date as string, // Map txn_date to date
      description: (row.description ?? null) as string | null,
      amount: row.amount as number,
      direction: row.direction as UnreconciledBankLine['direction'],
      lane: row.lane as UnreconciledBankLine['lane'],
    })) ?? []
  );
}

/**
 * Fetch unmatched journal entry lines on a bank-type account for a given date range.
 * Returns lines where bank_line_id IS NULL (not yet matched to any bank statement line).
 *
 * @param coaAccountId - Chart of Accounts account UUID (should be BANK-subtype account)
 * @param fromDate - Start date (ISO format: YYYY-MM-DD)
 * @param toDate - End date (ISO format: YYYY-MM-DD)
 * @returns Array of unmatched journal entry lines
 * @throws Error if query fails or Supabase is not configured
 */
export async function fetchUnreconciledJournalLines(
  coaAccountId: string,
  fromDate: string,
  toDate: string,
): Promise<UnreconciledJournalLine[]> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(
      `
      id,
      entry_id,
      account_id,
      side,
      amount,
      description,
      journal_entries!inner (
        id,
        entry_number,
        entry_date
      ),
      chart_of_accounts!inner (
        account_code
      )
    `
    )
    .eq('account_id', coaAccountId)
    .is('bank_line_id', null) // Only unmatched lines
    .gte('journal_entries.entry_date', fromDate)
    .lte('journal_entries.entry_date', toDate);

  if (error) throw new Error(error.message);

  type JelRow = {
    id: string;
    entry_id: string;
    account_id: string;
    side: string;
    amount: number;
    description: string | null;
    journal_entries: { entry_number: string; entry_date: string };
    chart_of_accounts: { account_code: string };
  };
  return (
    (data as unknown as JelRow[] | null)?.map((row) => ({
      id: row.id,
      entry_id: row.entry_id,
      entry_number: row.journal_entries.entry_number,
      entry_date: row.journal_entries.entry_date,
      description: row.description,
      account_code: row.chart_of_accounts.account_code,
      account_id: row.account_id,
      side: row.side as UnreconciledJournalLine['side'],
      amount: row.amount,
    })) ?? []
  );
}

/**
 * Manually match one or more journal entry lines to a bank statement line.
 * Updates journal_entry_lines with bank_line_id and marks the bank line as GREEN (matched).
 *
 * @param input - Object containing bankLineId, journalEntryLineIds, and optional matchReason
 * @returns MatchResult with ok flag, matched count, and total amount matched
 * @throws Error if bank line not found, validation fails, or RPC fails
 */
export async function matchJournalToBankLine(input: {
  bankLineId: string;
  journalEntryLineIds: string[];
  matchReason?: string | null;
}): Promise<MatchResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('match_journal_to_bank_line', {
    p_bank_line_id: input.bankLineId,
    p_journal_entry_line_ids: input.journalEntryLineIds,
    p_match_reason: input.matchReason,
  });

  if (error) throw new Error(error.message);

  return (data as MatchResult);
}

/**
 * Auto-match journal entry lines to bank statement lines for a given period.
 * For each unmatched bank line, finds the best-scoring candidate journal line.
 * Auto-links if confidence score >= 0.95; otherwise leaves for manual review.
 *
 * @param input - Object containing bankAccountId, periodYear, periodMonth
 * @returns AutoMatchResult with count of auto-matched and pending manual review
 * @throws Error if bank account not found or RPC fails
 */
export async function autoMatchJournalLinesToBank(input: {
  bankAccountId: string;
  periodYear: number;
  periodMonth: number;
}): Promise<AutoMatchResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('auto_match_journal_lines_to_bank', {
    p_bank_account_id: input.bankAccountId,
    p_period_year: input.periodYear,
    p_period_month: input.periodMonth,
  });

  if (error) throw new Error(error.message);

  return (data as AutoMatchResult);
}
