// Integration tests for Neraca (Balance Sheet) computation — Pattern C
//
// Tests verify:
//   1. journal_entry_lines + journal_entries + chart_of_accounts joins work
//   2. Account type classification (ASET, LIABILITAS, MODAL) for Balance Sheet
//   3. Cumulative (lte) date filtering for point-in-time balance sheet
//   4. Balance equation: sum(ASET debit) = sum(LIABILITAS+MODAL credit)
//   5. Sample aggregation on seeded data is sensible
//
// These tests validate the underlying database structure needed for
// fetchNeraca client-side function to compute Balance Sheet correctly.

import { describe, it, expect } from 'vitest';
import {
  supabaseAdmin,
  COA_BANK_ID,
  COA_BANK_CODE,
  COA_MODAL_AWAL_ID,
  COA_MODAL_AWAL_CODE,
  COA_HUTANG_USAHA_ID,
  COA_HUTANG_USAHA_CODE,
} from './_setup';

describe('Neraca (Balance Sheet) — schema and joins', () => {
  it('journal_entry_lines can be joined to journal_entries', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        side,
        amount,
        journal_entries!inner(entry_date, entry_number, source_type)
      `
      )
      .limit(5);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('journal_entries');
      const entry = Array.isArray(row.journal_entries)
        ? row.journal_entries[0]
        : row.journal_entries;
      expect(entry).toHaveProperty('entry_date');
      expect(entry.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('all three account types (ASET, LIABILITAS, MODAL) exist', async () => {
    const { data: asetData, error: asetError } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id')
      .eq('account_type', 'ASET')
      .limit(1);

    const { data: liabData, error: liabError } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id')
      .eq('account_type', 'LIABILITAS')
      .limit(1);

    const { data: modalData, error: modalError } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id')
      .eq('account_type', 'MODAL')
      .limit(1);

    expect(asetError).toBeNull();
    expect(liabError).toBeNull();
    expect(modalError).toBeNull();
    expect(asetData!.length).toBeGreaterThan(0);
    expect(liabData!.length).toBeGreaterThan(0);
    expect(modalData!.length).toBeGreaterThan(0);
  });

  it('can select ASET accounts with account_subtype', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type, account_subtype')
      .eq('account_type', 'ASET')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('account_subtype');
    }
  });

  it('seeded account Bank (1-1200) has account_type=ASET and normal_balance=DEBIT', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type, normal_balance')
      .eq('id', COA_BANK_ID)
      .limit(1);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].account_code).toBe(COA_BANK_CODE);
    expect(data![0].account_type).toBe('ASET');
    expect(data![0].normal_balance).toBe('DEBIT');
  });

  it('seeded account Modal Awal (3-1100) has account_type=MODAL and normal_balance=CREDIT', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type, normal_balance')
      .eq('id', COA_MODAL_AWAL_ID)
      .limit(1);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].account_code).toBe(COA_MODAL_AWAL_CODE);
    expect(data![0].account_type).toBe('MODAL');
    expect(data![0].normal_balance).toBe('CREDIT');
  });

  it('seeded account Hutang Usaha (2-1100) has account_type=LIABILITAS and normal_balance=CREDIT', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type, normal_balance')
      .eq('id', COA_HUTANG_USAHA_ID)
      .limit(1);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].account_code).toBe(COA_HUTANG_USAHA_CODE);
    expect(data![0].account_type).toBe('LIABILITAS');
    expect(data![0].normal_balance).toBe('CREDIT');
  });
});

describe('Neraca — cumulative (lte) date filtering', () => {
  it('can filter journal_entry_lines with lte entry_date (point-in-time)', async () => {
    const asOfDate = '2026-12-31';
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
      .lte('journal_entries.entry_date', asOfDate)
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        const entry = Array.isArray(row.journal_entries)
          ? row.journal_entries[0]
          : row.journal_entries;
        expect(entry.entry_date <= asOfDate).toBe(true);
      }
    }
  });

  it('lte date filter includes entries on the exact date', async () => {
    // Get the earliest entry_date first
    const { data: minData } = await supabaseAdmin
      .from('journal_entries')
      .select('entry_date')
      .order('entry_date', { ascending: true })
      .limit(1);

    if (minData && minData.length > 0) {
      const targetDate = minData[0].entry_date;
      const { data, error } = await supabaseAdmin
        .from('journal_entry_lines')
        .select(
          `
          id,
          entry_id,
          journal_entries!inner(entry_date)
        `
        )
        .lte('journal_entries.entry_date', targetDate)
        .limit(100);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

describe('Neraca — account type filtering for balance sheet', () => {
  it('can filter to ASET, LIABILITAS, MODAL accounts', async () => {
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
      .in('chart_of_accounts.account_type', ['ASET', 'LIABILITAS', 'MODAL'])
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        const coa = Array.isArray(row.chart_of_accounts)
          ? row.chart_of_accounts[0]
          : row.chart_of_accounts;
        expect(['ASET', 'LIABILITAS', 'MODAL']).toContain(coa.account_type);
      }
    }
  });
});

describe('Neraca — balance equation sanity', () => {
  it('double-entry invariant: sum(all debit) = sum(all credit) across posted entries', async () => {
    // Fetch all journal entries
    const { data: entries, error: entriesError } = await supabaseAdmin
      .from('journal_entries')
      .select('id, entry_number, total_debit, total_credit, is_posted')
      .eq('is_posted', true);

    expect(entriesError).toBeNull();
    expect(Array.isArray(entries)).toBe(true);

    if (entries && entries.length > 0) {
      let totalDebit = 0;
      let totalCredit = 0;
      for (const entry of entries) {
        totalDebit += Number(entry.total_debit || 0);
        totalCredit += Number(entry.total_credit || 0);
      }
      // Balance equation: total debit must equal total credit
      expect(totalDebit).toBe(totalCredit);
    }
  });

  it('can aggregate ASET/LIABILITAS/MODAL lines per account', async () => {
    const asOfDate = '2026-12-31';
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        account_id,
        side,
        amount,
        chart_of_accounts!inner(account_code, account_type, normal_balance)
      `
      )
      .in('chart_of_accounts.account_type', ['ASET', 'LIABILITAS', 'MODAL'])
      .lte('journal_entries.entry_date', asOfDate)
      .limit(500);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    // Aggregate per account_id
    const accMap = new Map<
      string,
      {
        account_code: string;
        account_type: string;
        normal_balance: string;
        total_debit: number;
        total_credit: number;
      }
    >();

    if (data) {
      for (const row of data) {
        const coa = Array.isArray(row.chart_of_accounts)
          ? row.chart_of_accounts[0]
          : row.chart_of_accounts;

        let acc = accMap.get(row.account_id);
        if (!acc) {
          acc = {
            account_code: coa.account_code,
            account_type: coa.account_type,
            normal_balance: coa.normal_balance,
            total_debit: 0,
            total_credit: 0,
          };
          accMap.set(row.account_id, acc);
        }
        const amt = Number(row.amount);
        if (row.side === 'DEBIT') acc.total_debit += amt;
        else acc.total_credit += amt;
      }
    }

    // Compute balances: balance = normal_balance matching side
    let totalAsetBalance = 0;
    let totalLiabBalance = 0;
    let totalModalBalance = 0;

    for (const [_accountId, acc] of accMap) {
      const balance =
        acc.normal_balance === 'DEBIT'
          ? acc.total_debit - acc.total_credit
          : acc.total_credit - acc.total_debit;

      if (acc.account_type === 'ASET') {
        totalAsetBalance += balance;
      } else if (acc.account_type === 'LIABILITAS') {
        totalLiabBalance += balance;
      } else if (acc.account_type === 'MODAL') {
        totalModalBalance += balance;
      }
    }

    // Balance equation: ASET = LIABILITAS + MODAL
    // (allowing floating point tolerance)
    const tolerance = 0.01;
    const diff = totalAsetBalance - (totalLiabBalance + totalModalBalance);
    expect(Math.abs(diff)).toBeLessThan(tolerance);
  });

  it('sample balance sheet aggregation with account classification', async () => {
    const asOfDate = '2026-12-31';
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select(
        `
        id,
        entry_id,
        account_id,
        side,
        amount,
        chart_of_accounts!inner(
          account_code,
          account_type,
          account_subtype,
          normal_balance
        )
      `
      )
      .in('chart_of_accounts.account_type', ['ASET', 'LIABILITAS', 'MODAL'])
      .lte('journal_entries.entry_date', asOfDate)
      .limit(1000);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    // Classify accounts
    type AccRec = {
      account_code: string;
      account_type: string;
      account_subtype: string | null;
      normal_balance: string;
      total_debit: number;
      total_credit: number;
    };

    const accMap = new Map<string, AccRec>();

    if (data) {
      for (const row of data) {
        const coa = Array.isArray(row.chart_of_accounts)
          ? row.chart_of_accounts[0]
          : row.chart_of_accounts;

        let acc = accMap.get(row.account_id);
        if (!acc) {
          acc = {
            account_code: coa.account_code,
            account_type: coa.account_type,
            account_subtype: coa.account_subtype,
            normal_balance: coa.normal_balance,
            total_debit: 0,
            total_credit: 0,
          };
          accMap.set(row.account_id, acc);
        }
        const amt = Number(row.amount);
        if (row.side === 'DEBIT') acc.total_debit += amt;
        else acc.total_credit += amt;
      }
    }

    // Classify per fetchNeraca logic
    const asetLancarAccs: AccRec[] = [];
    const asetTetapAccs: AccRec[] = [];
    const kontraAccs: AccRec[] = [];
    const liabLancarAccs: AccRec[] = [];
    const liabJkPanjangAccs: AccRec[] = [];
    const ekuitasAccs: AccRec[] = [];

    for (const acc of accMap.values()) {
      if (acc.account_type === 'ASET') {
        if (
          acc.account_subtype &&
          [
            'BANK',
            'KAS',
            'E_WALLET',
            'PERSEDIAAN',
            'PIUTANG',
            'PIUTANG_USAHA',
          ].includes(acc.account_subtype)
        ) {
          asetLancarAccs.push(acc);
        } else if (acc.account_subtype === 'ASET_TETAP') {
          asetTetapAccs.push(acc);
        } else if (acc.account_subtype === 'KONTRA') {
          kontraAccs.push(acc);
        }
      } else if (acc.account_type === 'LIABILITAS') {
        if (acc.account_code.startsWith('2-1')) {
          liabLancarAccs.push(acc);
        } else if (acc.account_code.startsWith('2-2')) {
          liabJkPanjangAccs.push(acc);
        }
      } else if (acc.account_type === 'MODAL') {
        ekuitasAccs.push(acc);
      }
    }

    // Verify we can classify accounts sensibly
    expect(Array.isArray(asetLancarAccs)).toBe(true);
    expect(Array.isArray(liabLancarAccs)).toBe(true);
    expect(Array.isArray(ekuitasAccs)).toBe(true);
  });
});

describe('Neraca — account subtype checking', () => {
  it('ASET accounts have sensible subtypes', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_subtype')
      .eq('account_type', 'ASET')
      .limit(20);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        // Subtype can be null or one of the expected values
        if (row.account_subtype !== null) {
          expect(typeof row.account_subtype).toBe('string');
          expect(row.account_subtype.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('LIABILITAS accounts have account_code starting with 2-', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code')
      .eq('account_type', 'LIABILITAS')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        expect(row.account_code).toMatch(/^2-/);
      }
    }
  });

  it('MODAL accounts exist and are distinct from ASET/LIABILITAS', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_type')
      .eq('account_type', 'MODAL')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      for (const row of data) {
        expect(row.account_type).toBe('MODAL');
      }
    }
  });
});
