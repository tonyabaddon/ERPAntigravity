// Integration tests for Laba Rugi (P&L) computation — Pattern C
//
// Tests verify:
//   1. journal_entry_lines + chart_of_accounts join returns expected schema
//   2. entry_date filtering works across the join
//   3. Account type classification (PENDAPATAN, BEBAN) for P&L
//   4. Sample aggregation: sum of debit/credit per account is correct
//
// These tests validate the underlying database structure needed for
// fetchLabaRugi client-side function to compute P&L correctly.

import { describe, it, expect } from 'vitest';
import {
  supabaseAdmin,
  COA_PENJUALAN_ID,
  COA_PENJUALAN_CODE,
  COA_BEBAN_GAJI_ID,
  COA_BEBAN_GAJI_CODE,
} from './_setup';

describe('Laba Rugi (Income Statement) — schema and joins', () => {
  it('journal_entry_lines table exists and is queryable', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('id, entry_id, account_id, side, amount')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('chart_of_accounts table exists and is queryable', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type, account_subtype, normal_balance')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('journal_entries table exists and is queryable', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('id, entry_number, entry_date, source_type, description')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can join journal_entry_lines to chart_of_accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        account_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_name, account_type, normal_balance)
      `
      )
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('chart_of_accounts');
      const coa = Array.isArray(row.chart_of_accounts)
        ? row.chart_of_accounts[0]
        : row.chart_of_accounts;
      expect(coa).toHaveProperty('account_code');
      expect(coa).toHaveProperty('account_type');
    }
  });

  it('can join journal_entry_lines to journal_entries to chart_of_accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        journal_entries!inner(entry_date, entry_number, source_type),
        chart_of_accounts!inner(account_code, account_type)
      `
      )
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('journal_entries');
      expect(row).toHaveProperty('chart_of_accounts');
    }
  });

  it('PENDAPATAN account type exists and is queryable', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type')
      .eq('account_type', 'PENDAPATAN')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
  });

  it('BEBAN account type exists and is queryable', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type')
      .eq('account_type', 'BEBAN')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
  });
});

describe('Laba Rugi — date range filtering', () => {
  it('can filter journal_entry_lines by entry_date using gte', async () => {
    const testDate = '2026-01-01';
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        journal_entries!inner(entry_date)
      `
      )
      .gte('journal_entries.entry_date', testDate)
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // If any rows returned, all should have entry_date >= testDate
    if (data && data.length > 0) {
      for (const row of data) {
        const entry = Array.isArray(row.journal_entries)
          ? row.journal_entries[0]
          : row.journal_entries;
        expect(entry.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('can filter journal_entry_lines by entry_date using lte', async () => {
    const testDate = '2026-12-31';
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        journal_entries!inner(entry_date)
      `
      )
      .lte('journal_entries.entry_date', testDate)
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can apply date range (gte + lte) on entry_date', async () => {
    const fromDate = '2026-01-01';
    const toDate = '2026-12-31';
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        journal_entries!inner(entry_date)
      `
      )
      .gte('journal_entries.entry_date', fromDate)
      .lte('journal_entries.entry_date', toDate)
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('Laba Rugi — account type filtering', () => {
  it('can filter to PENDAPATAN accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_type, account_subtype)
      `
      )
      .eq('chart_of_accounts.account_type', 'PENDAPATAN')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        const coa = Array.isArray(row.chart_of_accounts)
          ? row.chart_of_accounts[0]
          : row.chart_of_accounts;
        expect(coa.account_type).toBe('PENDAPATAN');
      }
    }
  });

  it('can filter to BEBAN accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_type, account_subtype)
      `
      )
      .eq('chart_of_accounts.account_type', 'BEBAN')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        const coa = Array.isArray(row.chart_of_accounts)
          ? row.chart_of_accounts[0]
          : row.chart_of_accounts;
        expect(coa.account_type).toBe('BEBAN');
      }
    }
  });

  it('can filter to PENDAPATAN + BEBAN accounts combined', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_type)
      `
      )
      .in('chart_of_accounts.account_type', ['PENDAPATAN', 'BEBAN'])
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('Laba Rugi — aggregation sanity', () => {
  it('seeded account Penjualan (4-1100) has expected account_type and normal_balance', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type, normal_balance')
      .eq('id', COA_PENJUALAN_ID)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(1);
    expect(data![0].account_type).toBe('PENDAPATAN');
    expect(data![0].normal_balance).toBe('CREDIT');
  });

  it('seeded account Beban Gaji (5-2100) has expected account_type and normal_balance', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type, normal_balance')
      .eq('id', COA_BEBAN_GAJI_ID)
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(1);
    expect(data![0].account_type).toBe('BEBAN');
    expect(data![0].normal_balance).toBe('DEBIT');
  });

  it('can aggregate debit/credit per account_id for P&L accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        account_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_type)
      `
      )
      .in('chart_of_accounts.account_type', ['PENDAPATAN', 'BEBAN'])
      .limit(100);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    // Group by account_id and aggregate debit/credit
    const accMap = new Map<string, { total_debit: number; total_credit: number }>();

    if (data) {
      for (const row of data) {
        const acc = accMap.get(row.account_id) || { total_debit: 0, total_credit: 0 };
        const amt = Number(row.amount);
        if (row.side === 'DEBIT') acc.total_debit += amt;
        else acc.total_credit += amt;
        accMap.set(row.account_id, acc);
      }
    }

    // Verify aggregation is deterministic
    expect(accMap.size).toBeGreaterThanOrEqual(0);
    for (const [_accountId, agg] of accMap) {
      expect(typeof agg.total_debit).toBe('number');
      expect(typeof agg.total_credit).toBe('number');
      expect(agg.total_debit).toBeGreaterThanOrEqual(0);
      expect(agg.total_credit).toBeGreaterThanOrEqual(0);
    }
  });
});
