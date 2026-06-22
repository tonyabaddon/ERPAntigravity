/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * reportQueries.ts — Phase 4 Task 2
 *
 * Four client-side aggregation functions that fetch raw journal_entry_lines
 * (joined to journal_entries + chart_of_accounts + optionally cash_accounts)
 * and produce structured report objects.
 *
 * NOTE: Queries do NOT filter on journal_entries.is_posted, matching the
 * behaviour of fetchTrialBalanceAsOf in glQueries.ts (conscious parity).
 */

import { supabase } from '../supabaseClient';

// ---------------------------------------------------------------------------
// Internal guard
// ---------------------------------------------------------------------------

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

// ---------------------------------------------------------------------------
// Source-type → category mapping
// ---------------------------------------------------------------------------

export const CATEGORY_MAP: Record<string, string> = {
  KASIR_SALE: 'Penjualan',
  PEMBAYARAN: 'Bayar Pembelian',
  PIUTANG_PAYMENT: 'Pelunasan Piutang',
  WALKIN_PAYMENT: 'Pelunasan Piutang',
  KASIR_EXPENSE: 'Beban Operasional',
  MANUAL_TRANSFER: 'Transfer Internal',
  OWNER_DRAWING: 'Tarik Pribadi',
  OWNER_TOPUP: 'Topup Owner',
  WALLET_TOPUP: 'Wallet',
  WALLET_SPEND: 'Wallet',
  ADJUSTMENT: 'Penyesuaian',
  OPENING_BALANCE: 'Saldo Awal',
  TAX_ACCRUAL_PPH: 'Pajak',
  TAX_ACCRUAL_PPN: 'Pajak',
};

function deriveCategory(sourceType: string): string {
  return CATEGORY_MAP[sourceType] ?? 'Lainnya';
}

// ---------------------------------------------------------------------------
// Shared raw-line type (used by all four queries)
// ---------------------------------------------------------------------------

interface RawLine {
  id: string;
  entry_id: string;
  account_id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
  description: string | null;
  journal_entries:
    | Array<{
        entry_date: string;
        entry_number: string;
        source_type: string;
        description: string | null;
      }>
    | {
        entry_date: string;
        entry_number: string;
        source_type: string;
        description: string | null;
      }
    | null;
  chart_of_accounts:
    | Array<{
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        account_subtype: string | null;
        normal_balance: string;
      }>
    | {
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        account_subtype: string | null;
        normal_balance: string;
      }
    | null;
}

/** Safely unwrap supabase-js relational field (may be array or object). */
function unwrapEntry(line: RawLine): {
  entry_date: string;
  entry_number: string;
  source_type: string;
  description: string | null;
} | null {
  if (!line.journal_entries) return null;
  return Array.isArray(line.journal_entries)
    ? (line.journal_entries[0] ?? null)
    : line.journal_entries;
}

function unwrapCoa(line: RawLine): {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  normal_balance: string;
} | null {
  if (!line.chart_of_accounts) return null;
  return Array.isArray(line.chart_of_accounts)
    ? (line.chart_of_accounts[0] ?? null)
    : line.chart_of_accounts;
}

// ---------------------------------------------------------------------------
// Shared select fragment
// ---------------------------------------------------------------------------

const LINE_SELECT = `
  id,
  entry_id,
  account_id,
  side,
  amount,
  description,
  journal_entries!inner(entry_date, entry_number, source_type, description),
  chart_of_accounts!inner(id, account_code, account_name, account_type, account_subtype, normal_balance)
`;

// ===========================================================================
// 1. fetchMutasi
// ===========================================================================

export interface MutasiFilters {
  accountIds: string[];      // empty = all cash accounts (subtype BANK/KAS/E_WALLET)
  fromDate: string;
  toDate: string;
  direction?: 'IN' | 'OUT' | 'ALL';
  category?: string;         // 'ALL' or specific category label
  includePersonal?: boolean; // reserved — no OWNER_PERSONAL purpose exists yet
}

export interface MutasiRow {
  entry_id: string;
  entry_date: string;
  entry_number: string;
  account_id: string;
  account_code: string;
  account_label: string;  // cash_accounts.internal_label or coa.account_name
  source_type: string;
  category: string;
  description: string;
  in_amount: number;
  out_amount: number;
}

/**
 * Fetch mutation log for cash accounts in [fromDate, toDate].
 *
 * When filters.accountIds is empty, resolves to all cash-type COA account IDs
 * (account_subtype IN BANK | KAS | E_WALLET).  Each line is classified as
 * IN/OUT based on normal_balance vs side (DEBIT-normal → DEBIT = IN).
 */
export async function fetchMutasi(filters: MutasiFilters): Promise<MutasiRow[]> {
  const sb = requireSupabase();

  // Resolve account IDs — may be an explicit list or "all cash accounts"
  let targetIds: string[] = filters.accountIds;
  if (targetIds.length === 0) {
    const { data: cashCoa, error: coaErr } = await sb
      .from('chart_of_accounts')
      .select('id')
      .in('account_subtype', ['BANK', 'KAS', 'E_WALLET'])
      .eq('is_active', true);
    if (coaErr) throw new Error(coaErr.message);
    targetIds = (cashCoa ?? []).map((r: { id: string }) => r.id);
  }

  if (targetIds.length === 0) return [];

  // Fetch cash_accounts for internal_label lookup (LEFT join equivalent)
  const { data: caRows, error: caErr } = await sb
    .from('cash_accounts')
    .select('coa_account_id, internal_label');
  if (caErr) throw new Error(caErr.message);
  const labelMap = new Map<string, string>();
  for (const ca of (caRows ?? []) as Array<{ coa_account_id: string | null; internal_label: string }>) {
    if (ca.coa_account_id) {
      labelMap.set(ca.coa_account_id, ca.internal_label);
    }
  }

  // Fetch lines
  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(LINE_SELECT)
    .in('account_id', targetIds)
    .gte('journal_entries.entry_date', filters.fromDate)
    .lte('journal_entries.entry_date', filters.toDate);

  if (error) throw new Error(error.message);

  const rows: MutasiRow[] = [];

  for (const raw of (data ?? []) as RawLine[]) {
    const entry = unwrapEntry(raw);
    const coa = unwrapCoa(raw);
    if (!entry || !coa) continue;

    const amount = Number(raw.amount);
    const isDebitNormal = coa.normal_balance === 'DEBIT';
    // IN = side matches normal balance (asset: DEBIT side = inflow)
    const isIn = isDebitNormal ? raw.side === 'DEBIT' : raw.side === 'CREDIT';

    const category = deriveCategory(entry.source_type);

    // Apply direction filter
    if (filters.direction === 'IN' && !isIn) continue;
    if (filters.direction === 'OUT' && isIn) continue;

    // Apply category filter
    if (filters.category && filters.category !== 'ALL' && category !== filters.category) continue;

    rows.push({
      entry_id: raw.entry_id,
      entry_date: entry.entry_date,
      entry_number: entry.entry_number,
      account_id: raw.account_id,
      account_code: coa.account_code,
      account_label: labelMap.get(raw.account_id) ?? coa.account_name,
      source_type: entry.source_type,
      category,
      description: raw.description ?? entry.description ?? '',
      in_amount: isIn ? amount : 0,
      out_amount: isIn ? 0 : amount,
    });
  }

  // Sort by entry_date asc, then entry_number asc
  rows.sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date) || a.entry_number.localeCompare(b.entry_number),
  );

  return rows;
}

// ===========================================================================
// 2. fetchLabaRugi (Income Statement)
// ===========================================================================

export interface LineItem {
  code: string;
  name: string;
  amount: number;
}

export interface LabaRugiResult {
  pendapatan: LineItem[];
  pendapatanBersih: number;
  hpp: LineItem[];
  totalHpp: number;
  labaKotor: number;
  bebanOperasional: LineItem[];
  totalBebanOp: number;
  labaOperasional: number;
  pendapatanLainLain: LineItem[];
  bebanLainLain: LineItem[];
  labaSebelumPajak: number;
  bebanPajak: number;
  labaNeto: number;
}

/**
 * Compute Profit & Loss for [fromDate, toDate].
 *
 * Account classification by account_type / account_subtype:
 *   Pendapatan      → account_type=PENDAPATAN, subtype=PENJUALAN
 *   Kontra Pend.    → account_type=PENDAPATAN, subtype=KONTRA  (subtracted)
 *   Pend. Lain-lain → account_type=PENDAPATAN, subtype=PENDAPATAN_LAIN
 *   HPP             → account_type=BEBAN, subtype=HPP
 *   Beban Op        → account_type=BEBAN, subtype=BEBAN_OPERASIONAL
 *   Beban Non-Op    → account_type=BEBAN, subtype=BEBAN_NON_OPERASIONAL, code≠5-3300
 *   Beban Pajak     → account_code=5-3300
 */
export async function fetchLabaRugi(fromDate: string, toDate: string): Promise<LabaRugiResult> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(LINE_SELECT)
    .in('chart_of_accounts.account_type', ['PENDAPATAN', 'BEBAN'])
    .gte('journal_entries.entry_date', fromDate)
    .lte('journal_entries.entry_date', toDate);

  if (error) throw new Error(error.message);

  // Aggregate net per account_id
  type AccRec = {
    account_id: string;
    account_code: string;
    account_name: string;
    account_type: string;
    account_subtype: string | null;
    normal_balance: string;
    total_debit: number;
    total_credit: number;
  };

  const accMap = new Map<string, AccRec>();

  for (const raw of (data ?? []) as RawLine[]) {
    const entry = unwrapEntry(raw);
    const coa = unwrapCoa(raw);
    if (!entry || !coa) continue;
    if (coa.account_type !== 'PENDAPATAN' && coa.account_type !== 'BEBAN') continue;

    let acc = accMap.get(raw.account_id);
    if (!acc) {
      acc = {
        account_id: raw.account_id,
        account_code: coa.account_code,
        account_name: coa.account_name,
        account_type: coa.account_type,
        account_subtype: coa.account_subtype,
        normal_balance: coa.normal_balance,
        total_debit: 0,
        total_credit: 0,
      };
      accMap.set(raw.account_id, acc);
    }
    const amt = Number(raw.amount);
    if (raw.side === 'DEBIT') acc.total_debit += amt;
    else acc.total_credit += amt;
  }

  // Helper: balance = credit – debit for CREDIT-normal, debit – credit for DEBIT-normal
  function netBalance(acc: AccRec): number {
    return acc.normal_balance === 'CREDIT'
      ? acc.total_credit - acc.total_debit
      : acc.total_debit - acc.total_credit;
  }

  function toLineItem(acc: AccRec): LineItem {
    return { code: acc.account_code, name: acc.account_name, amount: netBalance(acc) };
  }

  const accs = Array.from(accMap.values()).sort((a, b) =>
    a.account_code.localeCompare(b.account_code),
  );

  // Classify
  const pendapatanAccs = accs.filter(
    a => a.account_type === 'PENDAPATAN' && a.account_subtype === 'PENJUALAN',
  );
  const kontraPendAccs = accs.filter(
    a => a.account_type === 'PENDAPATAN' && a.account_subtype === 'KONTRA',
  );
  const pendapatanLainAccs = accs.filter(
    a => a.account_type === 'PENDAPATAN' && a.account_subtype === 'PENDAPATAN_LAIN',
  );
  const hppAccs = accs.filter(a => a.account_type === 'BEBAN' && a.account_subtype === 'HPP');
  const bebanOpAccs = accs.filter(
    a => a.account_type === 'BEBAN' && a.account_subtype === 'BEBAN_OPERASIONAL',
  );
  // Non-op beban: exclude tax account 5-3300
  const bebanNonOpAccs = accs.filter(
    a =>
      a.account_type === 'BEBAN' &&
      a.account_subtype === 'BEBAN_NON_OPERASIONAL' &&
      a.account_code !== '5-3300',
  );
  const pajakAcc = accs.find(
    a => a.account_type === 'BEBAN' && a.account_code === '5-3300',
  );

  const sum = (list: AccRec[]) => list.reduce((s, a) => s + netBalance(a), 0);

  const pendapatanBruto = sum(pendapatanAccs);
  const kontraTotal = sum(kontraPendAccs);         // positive = reduces revenue
  const pendapatanBersih = pendapatanBruto - kontraTotal;
  const totalHpp = sum(hppAccs);
  const labaKotor = pendapatanBersih - totalHpp;
  const totalBebanOp = sum(bebanOpAccs);
  const labaOperasional = labaKotor - totalBebanOp;

  const totalPendapatanLain = sum(pendapatanLainAccs);
  const totalBebanNonOp = sum(bebanNonOpAccs);
  const bebanPajak = pajakAcc ? netBalance(pajakAcc) : 0;

  const labaSebelumPajak = labaOperasional + totalPendapatanLain - totalBebanNonOp;
  const labaNeto = labaSebelumPajak - bebanPajak;

  return {
    pendapatan: pendapatanAccs.map(toLineItem),
    pendapatanBersih,
    hpp: hppAccs.map(toLineItem),
    totalHpp,
    labaKotor,
    bebanOperasional: bebanOpAccs.map(toLineItem),
    totalBebanOp,
    labaOperasional,
    pendapatanLainLain: pendapatanLainAccs.map(toLineItem),
    bebanLainLain: bebanNonOpAccs.map(toLineItem),
    labaSebelumPajak,
    bebanPajak,
    labaNeto,
  };
}

// ===========================================================================
// 3. fetchNeraca (Balance Sheet)
// ===========================================================================

export interface NeracaResult {
  asetLancar: LineItem[];
  totalAsetLancar: number;
  asetTetap: LineItem[];
  akumulasiPenyusutan: number;
  totalAsetTetap: number;
  totalAset: number;
  liabilitasLancar: LineItem[];
  totalLiabLancar: number;
  liabilitasJkPanjang: LineItem[];
  totalLiabJkPanjang: number;
  totalLiabilitas: number;
  ekuitas: LineItem[];
  totalEkuitas: number;
  balanceCheck: { isBalanced: boolean; diff: number };
}

/**
 * Compute Balance Sheet as of asOfDate (cumulative, all entries ≤ date).
 *
 * Classification:
 *   Aset Lancar    → account_type=ASET, subtype IN (BANK,KAS,E_WALLET,PERSEDIAAN,PIUTANG,PIUTANG_USAHA)
 *   Aset Tetap     → account_type=ASET, subtype=ASET_TETAP
 *   Akum. Penyust. → account_type=ASET, subtype=KONTRA         (credit-normal, shown as negative)
 *   Liab. Lancar   → account_type=LIABILITAS, account_code starts '2-1'
 *   Liab. JkPjg    → account_type=LIABILITAS, account_code starts '2-2'
 *   Ekuitas        → account_type=MODAL
 */
export async function fetchNeraca(asOfDate: string): Promise<NeracaResult> {
  const sb = requireSupabase();

  // Cumulative — all entries up to asOfDate
  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(LINE_SELECT)
    .in('chart_of_accounts.account_type', ['ASET', 'LIABILITAS', 'MODAL'])
    .lte('journal_entries.entry_date', asOfDate);

  if (error) throw new Error(error.message);

  type AccRec = {
    account_code: string;
    account_name: string;
    account_type: string;
    account_subtype: string | null;
    normal_balance: string;
    total_debit: number;
    total_credit: number;
  };

  const accMap = new Map<string, AccRec>();

  for (const raw of (data ?? []) as RawLine[]) {
    const coa = unwrapCoa(raw);
    if (!coa) continue;
    if (!['ASET', 'LIABILITAS', 'MODAL'].includes(coa.account_type)) continue;

    let acc = accMap.get(raw.account_id);
    if (!acc) {
      acc = {
        account_code: coa.account_code,
        account_name: coa.account_name,
        account_type: coa.account_type,
        account_subtype: coa.account_subtype,
        normal_balance: coa.normal_balance,
        total_debit: 0,
        total_credit: 0,
      };
      accMap.set(raw.account_id, acc);
    }
    const amt = Number(raw.amount);
    if (raw.side === 'DEBIT') acc.total_debit += amt;
    else acc.total_credit += amt;
  }

  function netBalance(acc: AccRec): number {
    return acc.normal_balance === 'CREDIT'
      ? acc.total_credit - acc.total_debit
      : acc.total_debit - acc.total_credit;
  }

  function toLineItem(acc: AccRec): LineItem {
    return { code: acc.account_code, name: acc.account_name, amount: netBalance(acc) };
  }

  // Exclude parent/group accounts (null subtype = header rows)
  const accs = Array.from(accMap.values())
    .filter(a => a.account_subtype !== null)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

  const ASET_LANCAR_SUBTYPES = ['BANK', 'KAS', 'E_WALLET', 'PERSEDIAAN', 'PIUTANG', 'PIUTANG_USAHA'];

  const asetLancarAccs = accs.filter(
    a => a.account_type === 'ASET' && ASET_LANCAR_SUBTYPES.includes(a.account_subtype ?? ''),
  );
  const asetTetapAccs = accs.filter(
    a => a.account_type === 'ASET' && a.account_subtype === 'ASET_TETAP',
  );
  const kontraAsetAccs = accs.filter(
    a => a.account_type === 'ASET' && a.account_subtype === 'KONTRA',
  );

  // Liabilitas split by account_code prefix (2-1xxx = lancar, 2-2xxx = jk panjang)
  const liabLancarAccs = accs.filter(
    a => a.account_type === 'LIABILITAS' && a.account_code.startsWith('2-1'),
  );
  const liabJkPjgAccs = accs.filter(
    a => a.account_type === 'LIABILITAS' && a.account_code.startsWith('2-2'),
  );

  // Ekuitas: all MODAL with subtype (exclude header rows already filtered)
  // PRIVE is DEBIT-normal, so netBalance already accounts for the negative sign
  const ekuitasAccs = accs.filter(a => a.account_type === 'MODAL');

  const sum = (list: AccRec[]) => list.reduce((s, a) => s + netBalance(a), 0);

  const totalAsetLancar = sum(asetLancarAccs);
  const totalAsetTetapGross = sum(asetTetapAccs);
  // akumulasiPenyusutan expressed as positive = amount accumulated
  const akumulasiPenyusutan = sum(kontraAsetAccs); // CREDIT-normal → positive = reduction
  const totalAsetTetap = totalAsetTetapGross - akumulasiPenyusutan;
  const totalAset = totalAsetLancar + totalAsetTetap;

  const totalLiabLancar = sum(liabLancarAccs);
  const totalLiabJkPanjang = sum(liabJkPjgAccs);
  const totalLiabilitas = totalLiabLancar + totalLiabJkPanjang;

  const totalEkuitas = sum(ekuitasAccs);

  const diff = totalAset - (totalLiabilitas + totalEkuitas);
  const isBalanced = Math.abs(diff) < 0.01;

  return {
    asetLancar: asetLancarAccs.map(toLineItem),
    totalAsetLancar,
    asetTetap: asetTetapAccs.map(toLineItem),
    akumulasiPenyusutan,
    totalAsetTetap,
    totalAset,
    liabilitasLancar: liabLancarAccs.map(toLineItem),
    totalLiabLancar,
    liabilitasJkPanjang: liabJkPjgAccs.map(toLineItem),
    totalLiabJkPanjang,
    totalLiabilitas,
    ekuitas: ekuitasAccs.map(toLineItem),
    totalEkuitas,
    balanceCheck: { isBalanced, diff },
  };
}

// ===========================================================================
// 4. fetchCashFlow
// ===========================================================================

export interface CashFlowCell {
  month: string;
  net: number;
  grossIn: number;
  grossOut: number;
}

export interface CashFlowCategory {
  category: string;
  cells: CashFlowCell[];
  totalNet: number;
  totalIn: number;
  totalOut: number;
}

export interface CashFlowResult {
  months: string[];                                              // ['Jan', 'Feb', ..., 'Jun']
  monthDates: Array<{ year: number; month: number; label: string }>;
  uangMasuk: CashFlowCategory[];
  uangKeluar: CashFlowCategory[];
  netPerMonth: number[];
  totalNet: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Inflow categories (source_type → derived category → treated as IN) */
const IN_CATEGORIES = new Set([
  'Penjualan',
  'Pelunasan Piutang',
  'Topup Owner',
  'Saldo Awal',
]);

/**
 * Build trailing-month date windows for cash flow pivot.
 * endMonth is 1-based (January = 1).
 */
function buildMonthDates(
  endYear: number,
  endMonth: number,
  trailingMonths: number,
): Array<{ year: number; month: number; label: string }> {
  const result: Array<{ year: number; month: number; label: string }> = [];
  for (let i = trailingMonths - 1; i >= 0; i--) {
    let m = endMonth - i;
    let y = endYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    result.push({ year: y, month: m, label: MONTH_LABELS[m - 1] });
  }
  return result;
}

/**
 * Fetch Cash Flow pivot matrix: trailing months × category.
 *
 * Considers only cash-type COA accounts (subtype IN BANK/KAS/E_WALLET).
 * Each entry line is classified as IN or OUT based on normal_balance vs side.
 * Categories are derived from source_type via CATEGORY_MAP.
 */
export async function fetchCashFlow(
  endYear: number,
  endMonth: number,
  trailingMonths: number,
): Promise<CashFlowResult> {
  const sb = requireSupabase();

  const monthDates = buildMonthDates(endYear, endMonth, trailingMonths);
  if (monthDates.length === 0) {
    return {
      months: [],
      monthDates: [],
      uangMasuk: [],
      uangKeluar: [],
      netPerMonth: [],
      totalNet: 0,
    };
  }

  const fromDate = `${monthDates[0].year}-${String(monthDates[0].month).padStart(2, '0')}-01`;
  // Last day of endMonth
  const lastDay = new Date(endYear, endMonth, 0).getDate();
  const toDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Resolve cash COA IDs
  const { data: cashCoa, error: coaErr } = await sb
    .from('chart_of_accounts')
    .select('id')
    .in('account_subtype', ['BANK', 'KAS', 'E_WALLET'])
    .eq('is_active', true);
  if (coaErr) throw new Error(coaErr.message);
  const cashIds = (cashCoa ?? []).map((r: { id: string }) => r.id);
  if (cashIds.length === 0) {
    return {
      months: monthDates.map(m => m.label),
      monthDates,
      uangMasuk: [],
      uangKeluar: [],
      netPerMonth: new Array(trailingMonths).fill(0) as number[],
      totalNet: 0,
    };
  }

  // Fetch lines for date range, cash accounts only
  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(LINE_SELECT)
    .in('account_id', cashIds)
    .gte('journal_entries.entry_date', fromDate)
    .lte('journal_entries.entry_date', toDate);

  if (error) throw new Error(error.message);

  // Build month index map: 'YYYY-MM' → index in monthDates
  const monthIndexMap = new Map<string, number>();
  monthDates.forEach((m, idx) => {
    const key = `${m.year}-${String(m.month).padStart(2, '0')}`;
    monthIndexMap.set(key, idx);
  });

  // category → month-index → { grossIn, grossOut }
  type CellAcc = { grossIn: number; grossOut: number };
  const inMap = new Map<string, CellAcc[]>();   // IN categories
  const outMap = new Map<string, CellAcc[]>();  // OUT categories

  function ensureCategory(map: Map<string, CellAcc[]>, cat: string): CellAcc[] {
    if (!map.has(cat)) {
      map.set(cat, Array.from({ length: trailingMonths }, () => ({ grossIn: 0, grossOut: 0 })));
    }
    return map.get(cat)!;
  }

  for (const raw of (data ?? []) as RawLine[]) {
    const entry = unwrapEntry(raw);
    const coa = unwrapCoa(raw);
    if (!entry || !coa) continue;

    const entryYearMonth = entry.entry_date.slice(0, 7); // 'YYYY-MM'
    const mIdx = monthIndexMap.get(entryYearMonth);
    if (mIdx === undefined) continue;

    const amt = Number(raw.amount);
    const isDebitNormal = coa.normal_balance === 'DEBIT';
    const isIn = isDebitNormal ? raw.side === 'DEBIT' : raw.side === 'CREDIT';

    const category = deriveCategory(entry.source_type);
    const targetMap = isIn ? inMap : outMap;
    const cells = ensureCategory(targetMap, category);
    if (isIn) cells[mIdx].grossIn += amt;
    else cells[mIdx].grossOut += amt;
  }

  // Convert maps to sorted CashFlowCategory arrays
  function buildCategories(map: Map<string, CellAcc[]>, isInMap: boolean): CashFlowCategory[] {
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, cells]) => {
        const cfCells: CashFlowCell[] = cells.map((c, i) => ({
          month: monthDates[i].label,
          net: c.grossIn - c.grossOut,
          grossIn: c.grossIn,
          grossOut: c.grossOut,
        }));
        const totalIn = cells.reduce((s, c) => s + c.grossIn, 0);
        const totalOut = cells.reduce((s, c) => s + c.grossOut, 0);
        return {
          category: cat,
          cells: cfCells,
          totalNet: isInMap ? totalIn : totalOut,
          totalIn,
          totalOut,
        };
      });
  }

  const uangMasuk = buildCategories(inMap, true);
  const uangKeluar = buildCategories(outMap, false);

  // Net per month: sum all IN minus sum all OUT for that month index
  const netPerMonth: number[] = new Array(trailingMonths).fill(0);
  for (const cells of inMap.values()) {
    cells.forEach((c, i) => { netPerMonth[i] += c.grossIn; });
  }
  for (const cells of outMap.values()) {
    cells.forEach((c, i) => { netPerMonth[i] -= c.grossOut; });
  }

  const totalNet = netPerMonth.reduce((s, n) => s + n, 0);

  return {
    months: monthDates.map(m => m.label),
    monthDates,
    uangMasuk,
    uangKeluar,
    netPerMonth,
    totalNet,
  };
}
