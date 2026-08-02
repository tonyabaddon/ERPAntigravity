/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  FileDown,
  Grid,
  Settings2,
  AlertTriangle,
  List,
  Hourglass,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { fetchCashAccountBalances, fetchAccountLedger } from '../../lib/kasbank/service';
import { fetchUnreconciledJournalLines } from '../../lib/akuntansi/journalReconService';
import type { UnreconciledJournalLine } from '../../lib/akuntansi/journalReconService';
import { supabase } from '../../lib/supabaseClient';
import type { CashAccountBalance } from '../../lib/kasbank/types';
import type { GeneralLedgerRow, JournalSource } from '../../lib/akuntansi/types';
import { formatRp, wibDateString } from '../../lib/format';
import { captureError } from '../../lib/captureError';
import AksiDropdown from '../akuntansi/manual/AksiDropdown';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';
import type { AksiAction } from '../akuntansi/manual/AksiDropdown';
import ManualTransferModal from '../akuntansi/manual/ManualTransferModal';
import OwnerDrawingModal from '../akuntansi/manual/OwnerDrawingModal';
import BalanceAdjustmentModal from '../akuntansi/manual/BalanceAdjustmentModal';
import ManualExpenseModal from '../akuntansi/manual/ManualExpenseModal';
import WalletSpendModal from '../akuntansi/manual/WalletSpendModal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AccountDetailScreenProps {
  cashAccountId: string;
  currentUser: { name: string; role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

type PeriodPreset = 'bulan-ini' | '30-hari' | 'tahun-ini';

function getMonthBounds(date: Date): { fromDate: string; toDate: string } {
  // First day of current month in WIB
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const firstDay = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1);
  const lastDay = new Date(wibNow.getFullYear(), wibNow.getMonth() + 1, 0);
  return {
    fromDate: wibDateString(firstDay),
    toDate: wibDateString(lastDay),
  };
}

function getLast30DaysBounds(date: Date): { fromDate: string; toDate: string } {
  const toDate = wibDateString(date);
  const from = new Date(date.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { fromDate: wibDateString(from), toDate };
}

function getYearBounds(date: Date): { fromDate: string; toDate: string } {
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return {
    fromDate: `${wibNow.getFullYear()}-01-01`,
    toDate: `${wibNow.getFullYear()}-12-31`,
  };
}

function periodsFromPreset(preset: PeriodPreset): { fromDate: string; toDate: string } {
  const now = new Date();
  switch (preset) {
    case 'bulan-ini':
      return getMonthBounds(now);
    case '30-hari':
      return getLast30DaysBounds(now);
    case 'tahun-ini':
      return getYearBounds(now);
  }
}

// ---------------------------------------------------------------------------
// Indonesian month abbreviations
// ---------------------------------------------------------------------------

const ID_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGT', 'SEP', 'OKT', 'NOV', 'DES'];

function idMonthYear(isoDate: string): string {
  // isoDate = YYYY-MM-DD
  const parts = isoDate.split('-');
  const year = parts[0];
  const month = parseInt(parts[1] ?? '1', 10);
  return `${ID_MONTHS[month - 1] ?? ''} ${year}`;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Format date from ISO to "DD/MM HH:mm" (only date part from entry_date) */
function formatEntryDate(isoDate: string): string {
  // entry_date is YYYY-MM-DD, no time component in GeneralLedgerRow
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

function formatAmount(n: number): string {
  if (n === 0) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

// ---------------------------------------------------------------------------
// Status chip logic — derived from source_type (no status field in GL view)
// ---------------------------------------------------------------------------

type StatusVariant = 'cleared' | 'recon';

const ADJUSTMENT_SOURCES: JournalSource[] = ['ADJUSTMENT', 'STOCK_OPNAME_ADJ'];

function getStatusVariant(sourceType: JournalSource): StatusVariant {
  if (ADJUSTMENT_SOURCES.includes(sourceType)) return 'recon';
  return 'cleared';
}

// ---------------------------------------------------------------------------
// Days unmatched calculation
// ---------------------------------------------------------------------------

function daysUnmatched(entryDate: string): string {
  const today = new Date();
  const entryDateObj = new Date(entryDate);
  const diffMs = today.getTime() - entryDateObj.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'hari ini';
  if (days === 1) return '1 hari';
  return `${days} hari`;
}

interface StatusChipProps {
  variant: StatusVariant;
}

function StatusChip({ variant }: StatusChipProps) {
  if (variant === 'recon') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold uppercase tracking-wide bg-violet-100 text-violet-800">
        Recon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold uppercase tracking-wide bg-emerald-100 text-emerald-800">
      Cleared
    </span>
  );
}

// ---------------------------------------------------------------------------
// COA metadata (fetched once after we know coa_account_id)
// ---------------------------------------------------------------------------

interface CoaMeta {
  account_type: string;
  account_subtype: string | null;
  normal_balance: string;
}

async function fetchCoaMeta(coaAccountId: string): Promise<CoaMeta | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('account_type, account_subtype, normal_balance')
    .eq('id', coaAccountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CoaMeta;
}

// ---------------------------------------------------------------------------
// Page size for client-side pagination
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AccountDetailScreen({
  cashAccountId,
  showToast,
  onBack,
}: AccountDetailScreenProps) {
  // Account balance meta
  const [balance, setBalance] = useState<CashAccountBalance | null>(null);
  const [coaMeta, setCoaMeta] = useState<CoaMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Ledger rows
  const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  // Period filter
  const [activePreset, setActivePreset] = useState<PeriodPreset>('bulan-ini');
  const [period, setPeriod] = useState(() => periodsFromPreset('bulan-ini'));

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Active tab
  const [activeTab, setActiveTab] = useState<'riwayat' | 'belum-cair' | 'belum-cocok' | 'info'>('riwayat');

  // Unreconciled journal lines for Belum Cocok tab
  const [unmatchedLines, setUnmatchedLines] = useState<UnreconciledJournalLine[]>([]);
  const [loadingUnmatched, setLoadingUnmatched] = useState(false);

  // Active aksi (drives modal visibility)
  const [aksi, setAksi] = useState<AksiAction | null>(null);

  // ---------------------------------------------------------------------------
  // Load balance meta on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoadingMeta(true);
    fetchCashAccountBalances()
      .then(async (balances) => {
        const found = balances.find(b => b.cash_account_id === cashAccountId) ?? null;
        setBalance(found);
        if (found?.coa_account_id) {
          const meta = await fetchCoaMeta(found.coa_account_id);
          setCoaMeta(meta);
        }
      })
      .catch(err => {
        captureError(err, { feature: 'kasbank', action: 'fetch_cash_account_balances' });
        showToast('Gagal memuat data akun', 'warning');
      })
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAccountId]);

  // ---------------------------------------------------------------------------
  // Load ledger rows whenever period or coaAccountId changes
  // ---------------------------------------------------------------------------

  // Sequence counter drops out-of-order responses. Without it, switching
  // period mid-fetch could let the older response resolve last and paint
  // rows for the wrong period. Rare on fast networks, reproducible on 3G.
  const ledgerSeqRef = React.useRef(0);
  const loadLedger = useCallback(
    (coaAccountId: string, fromDate: string, toDate: string) => {
      const mySeq = ++ledgerSeqRef.current;
      setLoadingRows(true);
      setVisibleCount(PAGE_SIZE);
      fetchAccountLedger(coaAccountId, fromDate, toDate)
        .then(data => { if (mySeq === ledgerSeqRef.current) setRows(data); })
        .catch(err => {
          if (mySeq !== ledgerSeqRef.current) return;
          captureError(err, { feature: 'kasbank', action: 'fetch_account_ledger' });
          showToast('Gagal memuat riwayat', 'warning');
        })
        .finally(() => { if (mySeq === ledgerSeqRef.current) setLoadingRows(false); });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (balance?.coa_account_id) {
      loadLedger(balance.coa_account_id, period.fromDate, period.toDate);
    }
  }, [balance, period, loadLedger]);

  // ---------------------------------------------------------------------------
  // Load unreconciled journal lines when Belum Cocok tab is active
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (activeTab !== 'belum-cocok' || !balance?.coa_account_id) {
      return;
    }
    setLoadingUnmatched(true);
    fetchUnreconciledJournalLines(balance.coa_account_id, period.fromDate, period.toDate)
      .then(setUnmatchedLines)
      .catch(err => {
        captureError(err, { feature: 'kasbank', action: 'fetch_unreconciled_journal_lines' });
        showToast('Gagal memuat jurnal belum cocok', 'warning');
        setUnmatchedLines([]);
      })
      .finally(() => setLoadingUnmatched(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, balance?.coa_account_id, period]);

  // ---------------------------------------------------------------------------
  // Aksi action handler
  // ---------------------------------------------------------------------------

  const handleAksi = useCallback(
    (action: AksiAction) => {
      if (action === 'edit_akun') {
        showToast('Tutup detail → klik tombol edit di kartu akun', 'info');
        return;
      }
      setAksi(action);
    },
    [showToast],
  );

  // ---------------------------------------------------------------------------
  // After posting: refresh ledger + balance, close modal
  // ---------------------------------------------------------------------------

  const handlePosted = useCallback(() => {
    setAksi(null);
    // Refresh ledger rows for current period
    if (balance?.coa_account_id) {
      loadLedger(balance.coa_account_id, period.fromDate, period.toDate);
    }
    // Also refresh the balance hero stats
    fetchCashAccountBalances()
      .then((balances) => {
        const found = balances.find(b => b.cash_account_id === cashAccountId) ?? null;
        setBalance(found);
      })
      .catch(err => {
        captureError(err, { feature: 'kasbank', action: 'refresh_balance' });
      });
  }, [balance, period, loadLedger, cashAccountId]);

  // ---------------------------------------------------------------------------
  // Period filter handlers
  // ---------------------------------------------------------------------------

  function handlePreset(preset: PeriodPreset) {
    setActivePreset(preset);
    setPeriod(periodsFromPreset(preset));
  }

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  // Footer totals (all loaded rows, not just visible page)
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const finalBalance = rows.length > 0 ? (rows[rows.length - 1]?.running_balance ?? 0) : 0;

  // Footer label: "TOTAL JUN 2026 (cleared only)"
  const footerLabel = `TOTAL ${idMonthYear(period.fromDate)} (cleared only)`;

  // Subtitle parts
  const typeLabel = coaMeta?.account_type
    ? coaMeta.account_type.charAt(0).toUpperCase() + coaMeta.account_type.slice(1).toLowerCase()
    : '';
  const subtypeLabel = coaMeta?.account_subtype ?? '';
  const normalBalanceLabel = coaMeta?.normal_balance
    ? coaMeta.normal_balance.charAt(0).toUpperCase() + coaMeta.normal_balance.slice(1).toLowerCase()
    : 'Debit';

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loadingMeta) {
    return <LoadingState label="Memuat data akun…" />;
  }

  if (!balance) {
    return (
      <div className="p-8">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-caleo-13 text-[var(--color-caleo-primary)] font-bold hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Kas &amp; Bank
        </button>
        <EmptyState message="Akun tidak ditemukan." />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl">
      {/* Hero header */}
      <div
        className="p-6 text-white"
        style={{ background: 'linear-gradient(135deg, #1e40af, #1e3a8a)' }}
      >
        {/* Back link row + Aksi dropdown */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <button
            onClick={onBack}
            className="text-caleo-11 text-blue-100 hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Kas &amp; Bank
          </button>

          {/* Context-aware action dropdown */}
          <div className="w-36 flex-shrink-0">
            <AksiDropdown account={balance} onAction={handleAksi} />
          </div>
        </div>

        {/* Account title */}
        <h3 className="text-2xl font-extrabold mt-1">
          {balance.internal_label}{' '}
          {balance.account_code && (
            <span className="text-sm font-bold text-blue-200 font-mono ml-2">
              {balance.account_code}
            </span>
          )}
        </h3>

        {/* Subtitle */}
        <p className="text-xs text-blue-100 mt-1">
          {[
            typeLabel && subtypeLabel ? `${typeLabel} / ${subtypeLabel}` : typeLabel || subtypeLabel,
            balance.bank_code,
            balance.account_number,
            balance.account_holder,
            normalBalanceLabel ? `normal balance: ${normalBalanceLabel}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* 4-card stat row */}
        <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
          <div className="bg-white/10 rounded p-3">
            <div className="text-caleo-10 uppercase text-blue-100 mb-0.5">Saldo Awal</div>
            <div className="font-extrabold text-base">{formatRp(balance.opening_balance)}</div>
          </div>
          <div className="bg-white/10 rounded p-3">
            <div className="text-caleo-10 uppercase text-blue-100 mb-0.5">Total Debit (in)</div>
            <div className="font-extrabold text-base text-emerald-200">
              + {formatRp(balance.total_debit)}
            </div>
          </div>
          <div className="bg-white/10 rounded p-3">
            <div className="text-caleo-10 uppercase text-blue-100 mb-0.5">Total Kredit (out)</div>
            <div className="font-extrabold text-base text-rose-200">
              − {formatRp(balance.total_credit)}
            </div>
          </div>
          <div className="bg-white/15 rounded p-3 ring-2 ring-emerald-300">
            <div className="text-caleo-10 uppercase text-emerald-100 mb-0.5">Saldo Akhir</div>
            <div className="font-extrabold text-base text-emerald-200">
              {formatRp(balance.current_balance)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 px-6 flex gap-1 overflow-x-auto bg-white">
        <button
          onClick={() => setActiveTab('riwayat')}
          className={`px-4 py-3 text-caleo-13 font-extrabold whitespace-nowrap transition-colors ${
            activeTab === 'riwayat'
              ? 'border-b-2 border-emerald-600 text-[var(--color-caleo-primary)]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <List className="inline w-3.5 h-3.5 mr-1" />
          Riwayat
          {rows.length > 0 && (
            <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold bg-emerald-100 text-emerald-700">
              {rows.length}
            </span>
          )}
        </button>
        {coaMeta?.account_type === 'BANK' && (
          <button
            onClick={() => setActiveTab('belum-cocok')}
            className={`px-4 py-3 text-caleo-13 font-extrabold whitespace-nowrap transition-colors ${
              activeTab === 'belum-cocok'
                ? 'border-b-2 border-emerald-600 text-[var(--color-caleo-primary)]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" />
            Belum Cocok
            {unmatchedLines.length > 0 && (
              <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold bg-amber-100 text-amber-800">
                {unmatchedLines.length}
              </span>
            )}
          </button>
        )}
        <button
          disabled
          className="px-4 py-3 text-caleo-13 font-bold text-gray-300 cursor-not-allowed whitespace-nowrap"
        >
          <Hourglass className="inline w-3.5 h-3.5 mr-1" />
          Belum Cair
          {balance.pending_in > 0 && (
            <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold bg-amber-100 text-amber-800">
              Phase 2
            </span>
          )}
        </button>
        <button
          disabled
          className="px-4 py-3 text-caleo-13 font-bold text-gray-300 cursor-not-allowed whitespace-nowrap"
        >
          <Info className="inline w-3.5 h-3.5 mr-1" />
          Info Akun
        </button>
      </div>

      {/* -----------------------------------------------------------------------
        Manual entry modals — rendered outside tab content so they can overlay
        the full screen regardless of scroll position.
      ----------------------------------------------------------------------- */}

      {/* Transfer Internal (BANK ↔ BANK or any) */}
      {aksi === 'transfer' && (
        <ManualTransferModal
          open
          variant="transfer"
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Setor ke Bank (from KAS view) — source = current KAS account */}
      {aksi === 'setor_bank' && (
        <ManualTransferModal
          open
          variant="cash_deposit"
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Setor dari Kas (from BANK view) — use transfer variant for full flexibility */}
      {aksi === 'setor_dari_kas' && (
        <ManualTransferModal
          open
          variant="transfer"
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Top-Up Wallet (E_WALLET only) */}
      {aksi === 'wallet_topup' && (
        <ManualTransferModal
          open
          variant="wallet_topup"
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Tarik Pribadi / Owner Drawing */}
      {aksi === 'tarik_pribadi' && (
        <OwnerDrawingModal
          open
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Catat Pengeluaran */}
      {aksi === 'manual_expense' && (
        <ManualExpenseModal
          open
          sourceAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Penyesuaian Saldo (PIN protected) */}
      {aksi === 'penyesuaian' && (
        <BalanceAdjustmentModal
          open
          cashAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Catat Spending (E_WALLET only) */}
      {aksi === 'wallet_spend' && (
        <WalletSpendModal
          open
          walletAccount={balance}
          onClose={() => setAksi(null)}
          onPosted={handlePosted}
          showToast={showToast}
        />
      )}

      {/* Tab content */}
      {activeTab === 'riwayat' && (
        <div className="bg-white">
          {/* Pending banner */}
          {balance.pending_in > 0 && (
            <div
              className="mx-6 mt-6 rounded p-3 flex items-center gap-3 border"
              style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
            >
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-xs text-amber-900">
                <strong>Saldo termasuk {formatRp(balance.pending_in)} marketplace PENDING.</strong>{' '}
                Transaksi PENDING belum dihitung di saldo cleared.
              </p>
            </div>
          )}

          {/* Filter bar */}
          <div className="px-6 py-4 flex items-center gap-3 text-xs flex-wrap">
            <span className="font-bold text-gray-600 text-xs">Periode:</span>

            {(
              [
                { key: 'bulan-ini', label: 'Bulan ini' },
                { key: '30-hari', label: '30 hari' },
                { key: 'tahun-ini', label: 'Tahun ini' },
              ] as { key: PeriodPreset; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handlePreset(key)}
                className={`text-caleo-11 font-bold px-3.5 py-1.5 rounded-full transition-colors ${
                  activePreset === key
                    ? 'bg-[var(--color-caleo-primary)] text-white'
                    : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
                }`}
              >
                {label}
              </button>
            ))}

            <button
              onClick={() => showToast('Custom date picker hadir di Phase 2', 'info')}
              className="text-caleo-11 font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors"
            >
              Custom...
            </button>

            {/* Export buttons */}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => showToast('Export PDF hadir di Phase 2', 'info')}
                className="text-caleo-11 font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors inline-flex items-center gap-1.5"
              >
                <FileDown className="w-3 h-3" />
                PDF
              </button>
              <button
                onClick={() => showToast('Export Excel hadir di Phase 2', 'info')}
                className="text-caleo-11 font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors inline-flex items-center gap-1.5"
              >
                <Grid className="w-3 h-3" />
                Excel
              </button>
            </div>
          </div>

          {/* Ledger table */}
          <div className="border-t border-gray-200">
            {loadingRows ? (
              <LoadingState label="Memuat riwayat…" />
            ) : rows.length === 0 ? (
              <EmptyState message="Belum ada transaksi dalam periode ini." />
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead style={{ background: 'var(--color-caleo-cloud)' }}>
                    <tr className="text-caleo-10 uppercase font-extrabold text-gray-600">
                      <th className="text-left py-2 px-3">Tanggal</th>
                      <th className="text-left py-2 px-3">No. Entry</th>
                      <th className="text-left py-2 px-3">Keterangan</th>
                      <th className="text-right py-2 px-3">Debit</th>
                      <th className="text-right py-2 px-3">Kredit</th>
                      <th className="text-right py-2 px-3">Saldo</th>
                      <th className="text-center py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, idx) => {
                      const isAdjustment = ADJUSTMENT_SOURCES.includes(row.source_type);
                      const status = getStatusVariant(row.source_type);
                      const rowBg = isAdjustment
                        ? 'bg-amber-50/50 hover:bg-amber-50'
                        : 'hover:bg-blue-50/30';

                      return (
                        <tr
                          key={`${row.entry_id}-${row.side}-${idx}`}
                          className={`${rowBg} border-t border-gray-100`}
                        >
                          <td className="py-2 px-3 font-mono text-gray-600">
                            {formatEntryDate(row.entry_date)}
                          </td>
                          <td className="py-2 px-3 font-mono text-blue-700">
                            {row.entry_number}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {isAdjustment && (
                              <Settings2 className="inline w-3 h-3 mr-1 text-amber-600" />
                            )}
                            {row.line_description ?? row.entry_description}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-700">
                            {formatAmount(row.debit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-rose-700">
                            {formatAmount(row.credit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-blue-700">
                            {new Intl.NumberFormat('id-ID').format(row.running_balance)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <StatusChip variant={status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot
                    className="border-t-2"
                    style={{ background: 'var(--color-caleo-cloud)', borderColor: '#1e40af' }}
                  >
                    <tr className="font-extrabold" style={{ color: 'var(--color-primary)' }}>
                      <td colSpan={3} className="py-3 px-3 text-right text-caleo-11 uppercase tracking-wide">
                        {footerLabel}
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-700">
                        {new Intl.NumberFormat('id-ID').format(totalDebit)}
                      </td>
                      <td className="py-3 px-3 text-right text-rose-700">
                        {new Intl.NumberFormat('id-ID').format(totalCredit)}
                      </td>
                      <td className="py-3 px-3 text-right text-blue-700">
                        {formatRp(finalBalance)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>

                {/* Pagination */}
                <div className="px-6 py-3 text-caleo-11 text-center text-gray-500">
                  Menampilkan {Math.min(visibleCount, rows.length)} dari {rows.length}{' '}
                  {hasMore && (
                    <>
                      ·{' '}
                      <button
                        onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                        className="text-blue-700 font-bold hover:underline"
                      >
                        Muat lebih banyak ↓
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Belum Cocok tab - Unreconciled journal entries (BANK accounts only) */}
      {activeTab === 'belum-cocok' && coaMeta?.account_type === 'BANK' && (
        <div className="bg-white">
          {/* Filter bar */}
          <div className="px-6 py-4 flex items-center gap-3 text-xs flex-wrap">
            <span className="font-bold text-gray-600 text-xs">Periode:</span>

            {(
              [
                { key: 'bulan-ini', label: 'Bulan ini' },
                { key: '30-hari', label: '30 hari' },
                { key: 'tahun-ini', label: 'Tahun ini' },
              ] as { key: PeriodPreset; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handlePreset(key)}
                className={`text-caleo-11 font-bold px-3.5 py-1.5 rounded-full transition-colors ${
                  activePreset === key
                    ? 'bg-[var(--color-caleo-primary)] text-white'
                    : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="border-t border-gray-200">
            {loadingUnmatched ? (
              <LoadingState label="Memuat jurnal belum cocok…" />
            ) : unmatchedLines.length === 0 ? (
              <div className="p-12 text-center text-caleo-13 text-gray-500">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
                <p className="font-bold text-emerald-700">Semua sudah cocok ✓</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                  <p className="text-caleo-13 font-bold text-gray-900">
                    Journal Entries Belum Cocok dengan Bank Statement
                  </p>
                  <p className="text-caleo-11 text-gray-600 mt-1">
                    Buka Modul Rekonsiliasi untuk match
                  </p>
                </div>

                {/* Table */}
                <table className="w-full text-xs">
                  <thead style={{ background: 'var(--color-caleo-cloud)' }}>
                    <tr className="text-caleo-10 uppercase font-extrabold text-gray-600">
                      <th className="text-left py-2 px-3">Tanggal</th>
                      <th className="text-left py-2 px-3">No. Entry</th>
                      <th className="text-left py-2 px-3">Keterangan</th>
                      <th className="text-right py-2 px-3">Jumlah</th>
                      <th className="text-center py-2 px-3">Sisi</th>
                      <th className="text-center py-2 px-3">Belum Cocok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedLines.map((line, idx) => (
                      <tr
                        key={`${line.id}-${idx}`}
                        className="border-t border-gray-100 hover:bg-blue-50/30"
                      >
                        <td className="py-2 px-3 font-mono text-gray-600">
                          {formatEntryDate(line.entry_date)}
                        </td>
                        <td className="py-2 px-3 font-mono text-blue-700">
                          {line.entry_number}
                        </td>
                        <td className="py-2 px-3 text-gray-700">
                          {line.description ?? '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-gray-900">
                          {new Intl.NumberFormat('id-ID').format(line.amount)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold uppercase tracking-wide ${
                              line.side === 'DEBIT'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {line.side === 'DEBIT' ? 'Debit' : 'Kredit'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center text-caleo-11 text-gray-600">
                          {daysUnmatched(line.entry_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Action button */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                  <button
                    onClick={() => {
                      showToast('Modul Rekonsiliasi hadir di Phase 2', 'info');
                    }}
                    className="text-xs font-bold px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    Buka Modul Rekonsiliasi
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
