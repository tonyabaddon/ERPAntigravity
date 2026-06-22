/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as reportQueries from './reportQueries';

// ---------------------------------------------------------------------------
// Mock supabaseClient
// ---------------------------------------------------------------------------

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../supabaseClient';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a thenable Supabase chain that resolves at any terminal call.
 * All filter methods (select, eq, in, gte, lte, not, order, single) return
 * the SAME thenable so any termination point returns the mock data.
 */
function makeChain(data: unknown, error: unknown = null) {
  const thenable = Object.assign(Promise.resolve({ data, error }), {
    select: vi.fn(),
    from: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
  });

  // All chainable methods return themselves
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thenableAny = thenable as any;
  Object.keys(thenableAny).forEach(k => {
    if (typeof thenableAny[k] === 'function') {
      thenableAny[k].mockReturnValue(thenable);
    }
  });

  return thenable;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeKasLine(overrides: Partial<{
  id: string;
  entry_id: string;
  account_id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
  description: string | null;
  entry_date: string;
  entry_number: string;
  source_type: string;
  entry_description: string | null;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  normal_balance: string;
}> = {}) {
  return {
    id: overrides.id ?? 'line-1',
    entry_id: overrides.entry_id ?? 'entry-1',
    account_id: overrides.account_id ?? 'coa-kas',
    side: overrides.side ?? 'DEBIT',
    amount: overrides.amount ?? 1000000,
    description: overrides.description ?? null,
    journal_entries: [{
      entry_date: overrides.entry_date ?? '2026-06-01',
      entry_number: overrides.entry_number ?? 'JE-001',
      source_type: overrides.source_type ?? 'KASIR_SALE',
      description: overrides.entry_description ?? 'Penjualan tunai',
    }],
    chart_of_accounts: [{
      id: overrides.account_id ?? 'coa-kas',
      account_code: overrides.account_code ?? '1-1100',
      account_name: overrides.account_name ?? 'Kas',
      account_type: overrides.account_type ?? 'ASET',
      account_subtype: overrides.account_subtype ?? 'KAS',
      normal_balance: overrides.normal_balance ?? 'DEBIT',
    }],
  };
}

// ---------------------------------------------------------------------------
// fetchMutasi
// ---------------------------------------------------------------------------

describe('fetchMutasi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path — returns sorted MutasiRow array', async () => {
    const line = makeKasLine({ amount: 500000, side: 'DEBIT' });

    // Three sequential from() calls:
    // 1. chart_of_accounts (resolve cash IDs)
    // 2. cash_accounts (label map)
    // 3. journal_entry_lines (actual lines)
    const coaChain = makeChain([{ id: 'coa-kas' }]);
    const caChain = makeChain([{ coa_account_id: 'coa-kas', internal_label: 'Kas Toko' }]);
    const linesChain = makeChain([line]);

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(coaChain)
      .mockReturnValueOnce(caChain)
      .mockReturnValueOnce(linesChain);

    const result = await reportQueries.fetchMutasi({
      accountIds: [],
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      entry_id: 'entry-1',
      entry_date: '2026-06-01',
      entry_number: 'JE-001',
      account_id: 'coa-kas',
      account_code: '1-1100',
      account_label: 'Kas Toko',
      source_type: 'KASIR_SALE',
      category: 'Penjualan',
      in_amount: 500000,
      out_amount: 0,
    });
  });

  it('direction filter OUT — excludes IN lines', async () => {
    const inLine = makeKasLine({ side: 'DEBIT', amount: 1000000 });
    const outLine = makeKasLine({
      id: 'line-2',
      entry_id: 'entry-2',
      side: 'CREDIT',
      amount: 200000,
      source_type: 'PEMBAYARAN',
      entry_number: 'JE-002',
    });

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([inLine, outLine]));

    const result = await reportQueries.fetchMutasi({
      accountIds: [],
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
      direction: 'OUT',
    });

    expect(result).toHaveLength(1);
    expect(result[0].out_amount).toBe(200000);
    expect(result[0].in_amount).toBe(0);
    expect(result[0].category).toBe('Bayar Pembelian');
  });

  it('explicit accountIds — skips COA prefetch', async () => {
    const line = makeKasLine({ account_id: 'explicit-id' });

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([]))               // cash_accounts label map
      .mockReturnValueOnce(makeChain([line]));           // journal_entry_lines

    const result = await reportQueries.fetchMutasi({
      accountIds: ['explicit-id'],
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
    });

    // from() should only be called twice (no COA prefetch)
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it('empty result — returns []', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const result = await reportQueries.fetchMutasi({
      accountIds: [],
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
    });

    expect(result).toEqual([]);
  });

  it('supabase error — throws', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain(null, { message: 'Mutasi query failed' }));

    await expect(
      reportQueries.fetchMutasi({
        accountIds: [],
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      }),
    ).rejects.toThrow('Mutasi query failed');
  });

  it('no cash COA accounts — returns [] without hitting journal lines', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([])); // empty COA result

    const result = await reportQueries.fetchMutasi({
      accountIds: [],
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
    });

    expect(result).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1); // only COA call
  });
});

// ---------------------------------------------------------------------------
// fetchLabaRugi
// ---------------------------------------------------------------------------

describe('fetchLabaRugi', () => {
  beforeEach(() => vi.clearAllMocks());

  function makePendLine(amount: number, side: 'DEBIT' | 'CREDIT' = 'CREDIT', subtype = 'PENJUALAN') {
    return {
      id: `line-pend-${amount}`,
      entry_id: 'entry-pend',
      account_id: 'coa-pend',
      side,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-P1', source_type: 'KASIR_SALE', description: null }],
      chart_of_accounts: [{ id: 'coa-pend', account_code: '4-1100', account_name: 'Penjualan', account_type: 'PENDAPATAN', account_subtype: subtype, normal_balance: 'CREDIT' }],
    };
  }

  function makeHppLine(amount: number) {
    return {
      id: 'line-hpp',
      entry_id: 'entry-hpp',
      account_id: 'coa-hpp',
      side: 'DEBIT' as const,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-H1', source_type: 'KASIR_SALE', description: null }],
      chart_of_accounts: [{ id: 'coa-hpp', account_code: '5-1100', account_name: 'HPP Penjualan', account_type: 'BEBAN', account_subtype: 'HPP', normal_balance: 'DEBIT' }],
    };
  }

  function makeBebanLine(amount: number, subtype = 'BEBAN_OPERASIONAL', code = '5-2100', name = 'Beban Gaji') {
    return {
      id: `line-beban-${code}`,
      entry_id: `entry-beban-${code}`,
      account_id: `coa-beban-${code}`,
      side: 'DEBIT' as const,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-20', entry_number: 'JE-B1', source_type: 'KASIR_EXPENSE', description: null }],
      chart_of_accounts: [{ id: `coa-beban-${code}`, account_code: code, account_name: name, account_type: 'BEBAN', account_subtype: subtype, normal_balance: 'DEBIT' }],
    };
  }

  it('happy path — computes P&L correctly', async () => {
    const mockData = [
      makePendLine(5000000),       // Pendapatan 5jt
      makeHppLine(2000000),        // HPP 2jt  → laba kotor 3jt
      makeBebanLine(500000),       // Beban op 500k → laba op 2.5jt
    ];

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain(mockData));

    const result = await reportQueries.fetchLabaRugi('2026-06-01', '2026-06-30');

    expect(result.pendapatanBersih).toBe(5000000);
    expect(result.totalHpp).toBe(2000000);
    expect(result.labaKotor).toBe(3000000);
    expect(result.totalBebanOp).toBe(500000);
    expect(result.labaOperasional).toBe(2500000);
    expect(result.bebanPajak).toBe(0);
    expect(result.labaNeto).toBe(2500000);
    expect(result.pendapatan).toHaveLength(1);
    expect(result.hpp).toHaveLength(1);
    expect(result.bebanOperasional).toHaveLength(1);
  });

  it('KONTRA pendapatan — subtracted from pendapatanBersih', async () => {
    // Use DISTINCT account_ids so they aggregate as separate accounts.
    // Real accounting: CREDIT on a CREDIT-normal contra = recording the balance.
    // netBalance(kontra) = credit(300000) - debit(0) = 300000 (positive)
    // pendapatanBersih = bruto(5000000) - kontraTotal(300000) = 4700000
    const pendLine = {
      id: 'line-penjualan',
      entry_id: 'entry-pend',
      account_id: 'coa-penjualan',
      side: 'CREDIT' as const,
      amount: 5000000,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-P1', source_type: 'KASIR_SALE', description: null }],
      chart_of_accounts: [{ id: 'coa-penjualan', account_code: '4-1100', account_name: 'Penjualan', account_type: 'PENDAPATAN', account_subtype: 'PENJUALAN', normal_balance: 'CREDIT' }],
    };
    const kontraLine = {
      id: 'line-retur',
      entry_id: 'entry-retur',
      account_id: 'coa-retur',
      side: 'CREDIT' as const,
      amount: 300000,
      description: null,
      journal_entries: [{ entry_date: '2026-06-16', entry_number: 'JE-K1', source_type: 'ADJUSTMENT', description: null }],
      chart_of_accounts: [{ id: 'coa-retur', account_code: '4-1900', account_name: 'Retur Penjualan', account_type: 'PENDAPATAN', account_subtype: 'KONTRA', normal_balance: 'CREDIT' }],
    };

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain([pendLine, kontraLine]));

    const result = await reportQueries.fetchLabaRugi('2026-06-01', '2026-06-30');

    expect(result.pendapatanBersih).toBe(4700000);
    expect(result.pendapatan).toHaveLength(1);
  });

  it('beban pajak (5-3300) extracted separately', async () => {
    const pajakLine = makeBebanLine(150000, 'BEBAN_NON_OPERASIONAL', '5-3300', 'Beban Pajak');

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain([pajakLine]));

    const result = await reportQueries.fetchLabaRugi('2026-06-01', '2026-06-30');

    expect(result.bebanPajak).toBe(150000);
    expect(result.bebanLainLain).toHaveLength(0); // 5-3300 should NOT be in bebanLainLain
    expect(result.labaNeto).toBe(-150000); // 0 revenue - 150k tax
  });

  it('empty data — returns zeroed result', async () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain([]));

    const result = await reportQueries.fetchLabaRugi('2026-06-01', '2026-06-30');

    expect(result.pendapatan).toEqual([]);
    expect(result.pendapatanBersih).toBe(0);
    expect(result.labaNeto).toBe(0);
  });

  it('supabase error — throws', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValue(makeChain(null, { message: 'P&L query failed' }));

    await expect(reportQueries.fetchLabaRugi('2026-06-01', '2026-06-30'))
      .rejects.toThrow('P&L query failed');
  });
});

// ---------------------------------------------------------------------------
// fetchNeraca
// ---------------------------------------------------------------------------

describe('fetchNeraca', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeAsetLine(amount: number, subtype: string, code: string, side: 'DEBIT' | 'CREDIT' = 'DEBIT') {
    return {
      id: `line-aset-${code}`,
      entry_id: `entry-aset-${code}`,
      account_id: `coa-${code}`,
      side,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-A1', source_type: 'OPENING_BALANCE', description: null }],
      chart_of_accounts: [{
        id: `coa-${code}`,
        account_code: code,
        account_name: `Account ${code}`,
        account_type: 'ASET',
        account_subtype: subtype,
        normal_balance: subtype === 'KONTRA' ? 'CREDIT' : 'DEBIT',
      }],
    };
  }

  function makeLiabLine(amount: number, subtype: string, code: string) {
    return {
      id: `line-liab-${code}`,
      entry_id: `entry-liab-${code}`,
      account_id: `coa-${code}`,
      side: 'CREDIT' as const,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-L1', source_type: 'OPENING_BALANCE', description: null }],
      chart_of_accounts: [{
        id: `coa-${code}`,
        account_code: code,
        account_name: `Account ${code}`,
        account_type: 'LIABILITAS',
        account_subtype: subtype,
        normal_balance: 'CREDIT',
      }],
    };
  }

  function makeModalLine(amount: number, subtype: string, code: string, side: 'DEBIT' | 'CREDIT' = 'CREDIT', normalBalance = 'CREDIT') {
    return {
      id: `line-modal-${code}`,
      entry_id: `entry-modal-${code}`,
      account_id: `coa-${code}`,
      side,
      amount,
      description: null,
      journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-M1', source_type: 'OPENING_BALANCE', description: null }],
      chart_of_accounts: [{
        id: `coa-${code}`,
        account_code: code,
        account_name: `Account ${code}`,
        account_type: 'MODAL',
        account_subtype: subtype,
        normal_balance: normalBalance,
      }],
    };
  }

  it('happy path — balanced balance sheet', async () => {
    const mockData = [
      // Aset Lancar: Kas 5jt (DEBIT, DEBIT-normal → net = 5jt)
      makeAsetLine(5000000, 'KAS', '1-1100'),
      // Aset Tetap: Peralatan 3jt
      makeAsetLine(3000000, 'ASET_TETAP', '1-2100'),
      // Contra (Akumulasi Penyusutan): 1jt CREDIT on CREDIT-normal → net = 1jt
      makeAsetLine(1000000, 'KONTRA', '1-2900', 'CREDIT'),
      // Liab Lancar (2-1xxx): Hutang Usaha 2jt
      makeLiabLine(2000000, 'HUTANG_USAHA', '2-1100'),
      // Modal: 5jt
      makeModalLine(5000000, 'MODAL_DISETOR', '3-1100'),
    ];

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain(mockData));

    const result = await reportQueries.fetchNeraca('2026-06-30');

    expect(result.totalAsetLancar).toBe(5000000);
    expect(result.asetTetap).toHaveLength(1);
    expect(result.akumulasiPenyusutan).toBe(1000000);
    expect(result.totalAsetTetap).toBe(2000000); // 3jt - 1jt
    expect(result.totalAset).toBe(7000000);       // 5jt + 2jt

    expect(result.totalLiabLancar).toBe(2000000);
    expect(result.totalLiabJkPanjang).toBe(0);
    expect(result.totalLiabilitas).toBe(2000000);

    expect(result.totalEkuitas).toBe(5000000);

    // A+L+E: 7000 = 2000 + 5000 ✓
    expect(result.balanceCheck.isBalanced).toBe(true);
    expect(result.balanceCheck.diff).toBeCloseTo(0);
  });

  it('balance check — imbalanced shows diff', async () => {
    const mockData = [
      makeAsetLine(10000000, 'KAS', '1-1100'),      // Aset 10jt
      makeLiabLine(3000000, 'HUTANG_USAHA', '2-1100'), // Liab 3jt
      makeModalLine(5000000, 'MODAL_DISETOR', '3-1100'), // Modal 5jt
      // Total liab+modal = 8jt ≠ 10jt → diff = 2jt
    ];

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain(mockData));

    const result = await reportQueries.fetchNeraca('2026-06-30');

    expect(result.balanceCheck.isBalanced).toBe(false);
    expect(result.balanceCheck.diff).toBeCloseTo(2000000);
  });

  it('empty data — returns zeroed result', async () => {
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain([]));

    const result = await reportQueries.fetchNeraca('2026-06-30');

    expect(result.asetLancar).toEqual([]);
    expect(result.totalAset).toBe(0);
    expect(result.totalLiabilitas).toBe(0);
    expect(result.totalEkuitas).toBe(0);
    expect(result.balanceCheck.isBalanced).toBe(true);
  });

  it('liabilitas jangka panjang (2-2xxx) classified separately', async () => {
    const mockData = [
      makeLiabLine(5000000, 'HUTANG_BANK', '2-2100'), // 2-2xxx → jk panjang
      makeLiabLine(1000000, 'HUTANG_BANK', '2-1300'), // 2-1xxx → lancar
    ];

    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeChain(mockData));

    const result = await reportQueries.fetchNeraca('2026-06-30');

    expect(result.totalLiabLancar).toBe(1000000);
    expect(result.totalLiabJkPanjang).toBe(5000000);
    expect(result.totalLiabilitas).toBe(6000000);
  });

  it('supabase error — throws', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValue(makeChain(null, { message: 'Neraca query failed' }));

    await expect(reportQueries.fetchNeraca('2026-06-30'))
      .rejects.toThrow('Neraca query failed');
  });

  it('YTD Laba Tahun Berjalan — injected into ekuitas, balance holds', async () => {
    // Balance sheet: Kas 10jt, Modal 7jt, Hutang 3jt → aset=10jt, liab+modal=10jt
    // But without YTD net income the equation only balances if we include it.
    // Scenario: revenue 5jt, expense 3jt → labaTahunBerjalan = 2jt
    // Aset: 10jt (DEBIT-normal, DEBIT side)
    // Liab: 3jt (CREDIT-normal, CREDIT side)
    // Modal: 5jt (CREDIT-normal, CREDIT side)  → totalEkuitas = 5jt + 2jt YTD = 7jt
    // Balance: 10jt = 3jt + 7jt ✓
    const mainData = [
      {
        id: 'line-kas',
        entry_id: 'entry-kas',
        account_id: 'coa-kas',
        side: 'DEBIT' as const,
        amount: 10000000,
        description: null,
        journal_entries: [{ entry_date: '2026-01-01', entry_number: 'JE-1', source_type: 'OPENING_BALANCE', description: null }],
        chart_of_accounts: [{ id: 'coa-kas', account_code: '1-1100', account_name: 'Kas', account_type: 'ASET', account_subtype: 'KAS', normal_balance: 'DEBIT' }],
      },
      {
        id: 'line-liab',
        entry_id: 'entry-liab',
        account_id: 'coa-liab',
        side: 'CREDIT' as const,
        amount: 3000000,
        description: null,
        journal_entries: [{ entry_date: '2026-01-01', entry_number: 'JE-2', source_type: 'OPENING_BALANCE', description: null }],
        chart_of_accounts: [{ id: 'coa-liab', account_code: '2-1100', account_name: 'Hutang Usaha', account_type: 'LIABILITAS', account_subtype: 'HUTANG_USAHA', normal_balance: 'CREDIT' }],
      },
      {
        id: 'line-modal',
        entry_id: 'entry-modal',
        account_id: 'coa-modal',
        side: 'CREDIT' as const,
        amount: 5000000,
        description: null,
        journal_entries: [{ entry_date: '2026-01-01', entry_number: 'JE-3', source_type: 'OPENING_BALANCE', description: null }],
        chart_of_accounts: [{ id: 'coa-modal', account_code: '3-1100', account_name: 'Modal Disetor', account_type: 'MODAL', account_subtype: 'MODAL_DISETOR', normal_balance: 'CREDIT' }],
      },
    ];

    const ytdData = [
      // Pendapatan 5jt (CREDIT on CREDIT-normal)
      {
        id: 'line-pend',
        entry_id: 'entry-pend',
        account_id: 'coa-pend',
        side: 'CREDIT' as const,
        amount: 5000000,
        description: null,
        journal_entries: [{ entry_date: '2026-06-15', entry_number: 'JE-P1', source_type: 'KASIR_SALE', description: null }],
        chart_of_accounts: [{ id: 'coa-pend', account_code: '4-1100', account_name: 'Penjualan', account_type: 'PENDAPATAN', account_subtype: 'PENJUALAN', normal_balance: 'CREDIT' }],
      },
      // Beban 3jt (DEBIT on DEBIT-normal)
      {
        id: 'line-beban',
        entry_id: 'entry-beban',
        account_id: 'coa-beban',
        side: 'DEBIT' as const,
        amount: 3000000,
        description: null,
        journal_entries: [{ entry_date: '2026-06-20', entry_number: 'JE-B1', source_type: 'KASIR_EXPENSE', description: null }],
        chart_of_accounts: [{ id: 'coa-beban', account_code: '5-2100', account_name: 'Beban Gaji', account_type: 'BEBAN', account_subtype: 'BEBAN_OPERASIONAL', normal_balance: 'DEBIT' }],
      },
    ];

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain(mainData))  // main ASET/LIAB/MODAL query
      .mockReturnValueOnce(makeChain(ytdData));   // YTD PENDAPATAN/BEBAN query

    const result = await reportQueries.fetchNeraca('2026-06-30');

    // Aset: 10jt
    expect(result.totalAset).toBe(10000000);
    // Liab: 3jt
    expect(result.totalLiabilitas).toBe(3000000);
    // Ekuitas: 5jt modal + 2jt YTD = 7jt
    expect(result.totalEkuitas).toBe(7000000);

    // Laba Tahun Berjalan line injected
    const ytdLine = result.ekuitas.find(e => e.code === 'YTD');
    expect(ytdLine).toBeDefined();
    expect(ytdLine!.name).toBe('Laba Tahun Berjalan (YTD)');
    expect(ytdLine!.amount).toBe(2000000); // 5jt revenue - 3jt expense

    // Balance: 10jt = 3jt + 7jt → balanced
    expect(result.balanceCheck.isBalanced).toBe(true);
    expect(result.balanceCheck.diff).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// fetchCashFlow
// ---------------------------------------------------------------------------

describe('fetchCashFlow', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeCashLine(overrides: {
    entry_date: string;
    source_type: string;
    amount: number;
    side: 'DEBIT' | 'CREDIT';
  }) {
    return {
      id: `line-cf-${overrides.entry_date}-${overrides.amount}`,
      entry_id: `entry-cf-${overrides.entry_date}`,
      account_id: 'coa-kas',
      side: overrides.side,
      amount: overrides.amount,
      description: null,
      journal_entries: [{
        entry_date: overrides.entry_date,
        entry_number: 'JE-CF',
        source_type: overrides.source_type,
        description: null,
      }],
      chart_of_accounts: [{
        id: 'coa-kas',
        account_code: '1-1100',
        account_name: 'Kas',
        account_type: 'ASET',
        account_subtype: 'KAS',
        normal_balance: 'DEBIT',
      }],
    };
  }

  it('happy path — 2 months pivot', async () => {
    // endYear=2026, endMonth=6, trailing=2 → May + Jun
    const mockData = [
      makeCashLine({ entry_date: '2026-05-10', source_type: 'KASIR_SALE', amount: 1000000, side: 'DEBIT' }),
      makeCashLine({ entry_date: '2026-05-20', source_type: 'PEMBAYARAN', amount: 400000, side: 'CREDIT' }),
      makeCashLine({ entry_date: '2026-06-05', source_type: 'KASIR_SALE', amount: 2000000, side: 'DEBIT' }),
    ];

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))  // COA resolve
      .mockReturnValueOnce(makeChain(mockData));              // journal lines

    const result = await reportQueries.fetchCashFlow(2026, 6, 2);

    expect(result.months).toEqual(['Mei', 'Jun']);
    expect(result.monthDates).toHaveLength(2);
    expect(result.monthDates[0]).toMatchObject({ year: 2026, month: 5, label: 'Mei' });
    expect(result.monthDates[1]).toMatchObject({ year: 2026, month: 6, label: 'Jun' });

    // Penjualan IN category
    const penjualanIn = result.uangMasuk.find(c => c.category === 'Penjualan');
    expect(penjualanIn).toBeDefined();
    expect(penjualanIn!.cells[0].grossIn).toBe(1000000); // May
    expect(penjualanIn!.cells[1].grossIn).toBe(2000000); // Jun

    // Bayar Pembelian OUT category
    const bayarOut = result.uangKeluar.find(c => c.category === 'Bayar Pembelian');
    expect(bayarOut).toBeDefined();
    expect(bayarOut!.cells[0].grossOut).toBe(400000);
    expect(bayarOut!.cells[1].grossOut).toBe(0);

    // Net: May = 1000000 - 400000 = 600000, Jun = 2000000 - 0 = 2000000
    expect(result.netPerMonth[0]).toBe(600000);
    expect(result.netPerMonth[1]).toBe(2000000);
    expect(result.totalNet).toBe(2600000);
  });

  it('year boundary — Dec 2025 to Jan 2026 trailing=2', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain([]));

    const result = await reportQueries.fetchCashFlow(2026, 1, 2);

    expect(result.months).toEqual(['Des', 'Jan']);
    expect(result.monthDates[0]).toMatchObject({ year: 2025, month: 12 });
    expect(result.monthDates[1]).toMatchObject({ year: 2026, month: 1 });
  });

  it('no cash accounts — returns empty result', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([]));  // no cash COA

    const result = await reportQueries.fetchCashFlow(2026, 6, 3);

    expect(result.uangMasuk).toEqual([]);
    expect(result.uangKeluar).toEqual([]);
    expect(result.totalNet).toBe(0);
    expect(result.months).toHaveLength(3);
  });

  it('empty lines — returns zeroed matrix', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain([]));

    const result = await reportQueries.fetchCashFlow(2026, 6, 3);

    expect(result.uangMasuk).toEqual([]);
    expect(result.uangKeluar).toEqual([]);
    expect(result.netPerMonth).toEqual([0, 0, 0]);
    expect(result.totalNet).toBe(0);
  });

  it('supabase error on COA fetch — throws', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain(null, { message: 'CF coa query failed' }));

    await expect(reportQueries.fetchCashFlow(2026, 6, 3))
      .rejects.toThrow('CF coa query failed');
  });

  it('supabase error on lines fetch — throws', async () => {
    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain(null, { message: 'CF lines query failed' }));

    await expect(reportQueries.fetchCashFlow(2026, 6, 3))
      .rejects.toThrow('CF lines query failed');
  });

  it('OWNER_DRAWING classified as Tarik Pribadi (OUT)', async () => {
    const mockData = [
      makeCashLine({ entry_date: '2026-06-10', source_type: 'OWNER_DRAWING', amount: 500000, side: 'CREDIT' }),
    ];

    (supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeChain([{ id: 'coa-kas' }]))
      .mockReturnValueOnce(makeChain(mockData));

    const result = await reportQueries.fetchCashFlow(2026, 6, 1);

    const tarikOut = result.uangKeluar.find(c => c.category === 'Tarik Pribadi');
    expect(tarikOut).toBeDefined();
    expect(tarikOut!.cells[0].grossOut).toBe(500000);
    expect(result.uangMasuk).toHaveLength(0);
  });
});
