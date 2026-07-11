// src/components/RekonsiliasiScreen.tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRekonsiliasi } from '../hooks/useRekonsiliasi';
import { reconciliationService, supabase } from '../lib/supabaseClient';
import type { BankAccount, BankStatementLine, SalesChannel } from '../types';
import WizardSteps from './rekonsiliasi/WizardSteps';
import NextActionBanner from './rekonsiliasi/NextActionBanner';
import MultiAccountStatus from './rekonsiliasi/MultiAccountStatus';
import TallyBar from './rekonsiliasi/TallyBar';
import OrdersColumn from './rekonsiliasi/OrdersColumn';
import MutasiColumn from './rekonsiliasi/MutasiColumn';
import CashColumn from './rekonsiliasi/CashColumn';
import JournalColumn from './rekonsiliasi/JournalColumn';
import POSellThrough from './rekonsiliasi/POSellThrough';
import CompletionSummary from './rekonsiliasi/CompletionSummary';
import MappingDrawer, { type DrawerCandidate, type DrawerSource } from './rekonsiliasi/MappingDrawer';
import ClassificationModal from './rekonsiliasi/ClassificationModal';
import AddBankAccountModal from './rekonsiliasi/AddBankAccountModal';
import UploadPDFModal from './rekonsiliasi/UploadPDFModal';
import { fetchAccountingConfig, fetchCoa } from '../lib/akuntansi/service';
import type { AccountingConfig, CoaAccount } from '../lib/akuntansi/types';
import {
  fetchUnreconciledJournalLines,
  matchJournalToBankLine,
  autoMatchJournalLinesToBank,
  type UnreconciledJournalLine,
} from '../lib/akuntansi/journalReconService';

interface Props {
  currentUser: { name: string; role: string; permissions: { reconciliation?: boolean } } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function defaultPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

/** ISO YYYY-MM-DD for start of month */
function periodFromDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** ISO YYYY-MM-DD for end of month (last day inclusive) */
function periodToDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export default function RekonsiliasiScreen({ currentUser, showToast }: Props) {
  const allowed = currentUser?.role?.toLowerCase() === 'owner' || !!currentUser?.permissions?.reconciliation;
  const [period, setPeriod] = useState(defaultPeriod());
  const { loading, accounts, orders, bankLines, cashBatches, refresh } = useRekonsiliasi(period.year, period.month);

  const [showAdd, setShowAdd] = useState(false);
  const [uploadFor, setUploadFor] = useState<BankAccount | null>(null);
  const [drawer, setDrawer] = useState<{ source: DrawerSource | null; cands: DrawerCandidate[]; open: boolean; glMode: boolean }>({
    source: null, cands: [], open: false, glMode: false,
  });
  const [classifyFor, setClassifyFor] = useState<BankStatementLine | null>(null);

  // ─── GL mode state ───────────────────────────────────
  const [glMode, setGlMode] = useState(false);
  const [glConfig, setGlConfig] = useState<AccountingConfig | null>(null);
  const [glBankCoaAccounts, setGlBankCoaAccounts] = useState<CoaAccount[]>([]);
  const [glCoaAccountId, setGlCoaAccountId] = useState<string | null>(null);
  const [glJournalLines, setGlJournalLines] = useState<UnreconciledJournalLine[]>([]);
  const [glRefreshKey, setGlRefreshKey] = useState(0);

  // Fetch accounting config on mount
  useEffect(() => {
    fetchAccountingConfig()
      .then(setGlConfig)
      .catch((err: unknown) => {
        console.warn('[RekonsiliasiScreen] fetchAccountingConfig error', err);
      });
  }, []);

  // Fetch BANK-subtype COA accounts when GL mode is turned on
  useEffect(() => {
    if (!glMode) return;
    fetchCoa()
      .then((all) => {
        const bankAccounts = all.filter(a => a.account_subtype === 'BANK' && a.is_active);
        setGlBankCoaAccounts(bankAccounts);
        if (bankAccounts.length > 0 && !glCoaAccountId) {
          setGlCoaAccountId(bankAccounts[0].id);
        }
      })
      .catch((err: unknown) => {
        console.warn('[RekonsiliasiScreen] fetchCoa error', err);
        showToast('Gagal memuat akun COA', 'warning');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glMode]);

  // Sync journal lines into local state whenever coaAccountId / period / refreshKey changes
  useEffect(() => {
    if (!glCoaAccountId) {
      setGlJournalLines([]);
      return;
    }
    const fromDate = periodFromDate(period.year, period.month);
    const toDate = periodToDate(period.year, period.month);
    fetchUnreconciledJournalLines(glCoaAccountId, fromDate, toDate)
      .then(setGlJournalLines)
      .catch((err: unknown) => {
        console.warn('[RekonsiliasiScreen] fetchUnreconciledJournalLines error', err);
      });
  }, [glCoaAccountId, period.year, period.month, glRefreshKey]);

  // Derived: GL mode available when dual-write is on AND bank accounts exist
  const glModeAvailable = glConfig?.enable_dual_write_to_gl === true && accounts.length > 0;

  // ─── Derived state ─────────────────────────────────
  const totalSales = useMemo(() => orders.reduce((a, o) => a + o.total, 0), [orders]);
  const channelTally = useMemo(() => {
    const acc = new Map<SalesChannel, { amount: number; count: number }>();
    for (const o of orders) {
      const cur = acc.get(o.channel) ?? { amount: 0, count: 0 };
      acc.set(o.channel, { amount: cur.amount + o.total, count: cur.count + 1 });
    }
    return acc;
  }, [orders]);
  const totalOrderCount = orders.length;

  const reviewCount = bankLines.filter(l => l.lane === 'YELLOW' || l.lane === 'ORANGE' || l.lane === 'RED').length;
  const cashPending = cashBatches.filter(b => b.status === 'PENDING').length;
  const piutangCount = orders.filter(o => o.slots.some(s => s.status === 'OPEN')).length;

  const uploadedAccountIds = useMemo(() => new Set(bankLines.map(l => l.bank_account_id)), [bankLines]);

  const currentStep: 1 | 2 | 3 | 4 | 5 | 6 =
    accounts.length === 0 ? 1 :
    bankLines.length === 0 ? 2 :
    reviewCount > 0 ? 3 :
    cashPending > 0 ? 4 :
    piutangCount > 0 ? 5 : 6;

  const orderPct = orders.length === 0 ? 0 : Math.round(
    orders.filter(o => o.slots.length > 0 && o.slots.every(s => s.status !== 'OPEN')).length / orders.length * 100,
  );
  const mutasiPct = bankLines.length === 0 ? 0 : Math.round(
    bankLines.filter(l => l.lane === 'GREEN' || l.line_kind === 'INTERNAL_TRANSFER' || l.line_kind === 'LEGACY_PERIOD').length / bankLines.length * 100,
  );
  const cashPct = cashBatches.length === 0 ? 0 : Math.round(
    cashBatches.filter(b => b.status === 'DEPOSITED' || b.status === 'CARRY_OVER').length / cashBatches.length * 100,
  );

  const [closingBook, setClosingBook] = useState(false);
  const handleCloseBook = async () => {
    if (closingBook) return;
    setClosingBook(true);
    try {
      const r = await reconciliationService.closeMonth(period.year, period.month);
      if (r.ok) showToast('✓ Buku ditutup', 'success');
      else showToast(`❌ ${r.reason ?? 'gagal'}`, 'warning');
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`❌ Gagal tutup buku: ${msg}`, 'warning');
    } finally {
      setClosingBook(false);
    }
  };

  /**
   * Build drawer candidates from unreconciled journal lines for GL mode.
   * Scores by amount proximity to the bank line.
   */
  function buildGlCandidates(line: BankStatementLine): DrawerCandidate[] {
    // Tolerance: 0.5% relative with a Rp 500 absolute floor. Was 5%
    // percentage-only which over-matched small-ticket flows (Rp 1k fee on
    // Rp 20k invoice = 5%, absurd) and under-matched large-ticket flows
    // where a Rp 5k bank fee on Rp 5jt was scored 0.4 as "tidak cocok".
    const tol = Math.max(500, line.amount * 0.005);
    const lo = line.amount - tol;
    const hi = line.amount + tol;

    const cands: DrawerCandidate[] = glJournalLines.map(jl => {
      const inRange = jl.amount >= lo && jl.amount <= hi;
      const score = inRange ? 0.97 : 0.4;
      return {
        id: jl.id,
        name: jl.entry_number,
        meta: `${fmtDate(jl.entry_date)} · ${jl.side} · ${jl.description ?? ''}`.trim(),
        amount: jl.amount,
        score,
        scoreBreakdown: inRange ? 'amount cocok' : 'amount tidak cocok',
        accountCode: jl.account_code,
      };
    });

    cands.sort((a, b) => b.score - a.score);
    if (cands.length > 0) cands[0].best = true;
    return cands;
  }

  const openFindPairForMutasi = (line: BankStatementLine) => {
    if (glMode) {
      // GL mode: show journal entry lines as candidates (multi-allocation)
      const cands = buildGlCandidates(line);
      setDrawer({
        open: true,
        glMode: true,
        source: {
          type: 'mutasi',
          id: line.id,
          title: `${line.counterparty || line.description.slice(0, 24)} · ${fmt(line.amount)}`,
          meta: line.description,
          headerBg: '#eef2ff',
          headerColor: '#3730a3',
          amount: line.amount,
        },
        cands,
      });
    } else {
      // Standard mode: show order payable slots as candidates
      const tol = Math.max(500, line.amount * 0.005);
      const lo = line.amount - tol;
      const hi = line.amount + tol;
      const cands: DrawerCandidate[] = [];
      for (const o of orders) {
        for (const s of o.slots) {
          if (s.status !== 'OPEN') continue;
          if (s.expected_amount < lo || s.expected_amount > hi) continue;
          const diff = Math.abs(s.expected_amount - line.amount);
          const score = diff < 100 ? 0.95 : 0.7;
          cands.push({
            id: s.id,
            name: o.customer_name,
            meta: `${s.slot_type} · ${fmtDate(o.created_at)}`,
            amount: s.expected_amount,
            score,
            scoreBreakdown: 'amount/date heuristic',
          });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      if (cands.length > 0) cands[0].best = true;
      setDrawer({
        open: true,
        glMode: false,
        source: {
          type: 'mutasi',
          id: line.id,
          title: `${line.counterparty || line.description.slice(0, 24)} · ${fmt(line.amount)}`,
          meta: line.description,
          headerBg: '#fee2e2',
          headerColor: '#991b1b',
        },
        cands,
      });
    }
  };

  /** Standard single-pick handler (non-GL mode). Both the allocation insert
   *  and the lane update can silently no-op if RLS blocks the write; check
   *  the error and surface it rather than firing a false-positive success. */
  const handlePick = async (candidateId: string) => {
    if (!drawer.source) return;
    if (drawer.source.type !== 'mutasi') return;
    const line = bankLines.find(l => l.id === drawer.source!.id);
    if (!line || !supabase) return;
    try {
      await reconciliationService.createAllocation(line.id, candidateId, line.amount);
      const { error: updErr } = await supabase.from('bank_statement_lines')
        .update({ lane: 'GREEN', match_reason: 'manual', match_confidence: 1.0 })
        .eq('id', line.id);
      if (updErr) throw updErr;
      showToast('✓ Cocok', 'success');
      setDrawer({ open: false, source: null, cands: [], glMode: false });
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Gagal cocokkan: ${msg}`, 'warning');
    }
  };

  /** GL multi-allocation: match selected journal lines to bank line */
  const handlePickMultiGl = useCallback(async (candidateIds: string[], _totalAmount: number) => {
    if (!drawer.source) return;
    const bankLineId = drawer.source.id;
    try {
      const result = await matchJournalToBankLine({
        bankLineId,
        journalEntryLineIds: candidateIds,
        matchReason: 'manual_gl',
      });
      showToast(
        `✓ GL Match: ${result.matched_count} line · ${fmt(result.total_amount_matched)}`,
        'success',
      );
      setDrawer({ open: false, source: null, cands: [], glMode: false });
      setGlRefreshKey(k => k + 1);
      refresh();
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : 'Gagal match'}`, 'warning');
    }
  }, [drawer.source, showToast, refresh]);

  /** Auto-match handler for JournalColumn button */
  const handleAutoMatch = useCallback(async () => {
    // Use the first bank account ID for auto-match (single-tenant assumption)
    const bankAccount = accounts[0];
    if (!bankAccount) {
      showToast('Tidak ada akun bank', 'warning');
      return;
    }
    try {
      const result = await autoMatchJournalLinesToBank({
        bankAccountId: bankAccount.id,
        periodYear: period.year,
        periodMonth: period.month,
      });
      showToast(
        `Auto-match selesai: ${result.auto_matched} cocok, ${result.candidates_pending_manual} perlu review manual`,
        result.auto_matched > 0 ? 'success' : 'info',
      );
      setGlRefreshKey(k => k + 1);
      refresh();
    } catch (err: unknown) {
      showToast(`❌ Auto-match gagal: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
  }, [accounts, period.year, period.month, showToast, refresh]);

  // GL mode toggle: reset selection when turning off
  const handleToggleGlMode = () => {
    if (glMode) {
      setGlMode(false);
    } else {
      setGlMode(true);
    }
  };

  // ─── GL bank account label for JournalColumn ────────
  const glBankAccountLabel = useMemo(() => {
    const coa = glBankCoaAccounts.find(a => a.id === glCoaAccountId);
    return coa ? `${coa.account_code} · ${coa.account_name}` : (accounts[0] ? `${accounts[0].bank_code} ${accounts[0].account_number.slice(-4)}` : 'Bank');
  }, [glBankCoaAccounts, glCoaAccountId, accounts]);

  if (!allowed) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Akses Rekonsiliasi terbatas untuk Owner.</div>;
  }

  return (
    <div className="space-y-5 animate-fadeIn max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center gap-4 bg-white/78 backdrop-blur-xl p-5 rounded-[2rem] border border-[#e5eeff] shadow-sm">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#2d8a4e] bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-1.5 align-middle" />
            Rekonsiliasi Aktif
          </span>
          <h2 className="text-xl font-black text-[#012749] mt-2">Rekonsiliasi Buku</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {loading ? 'Memuat data…' : `${orders.length} order · ${bankLines.length} mutasi · ${cashBatches.length} batch kas`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* GL mode toggle — only shown when feature flag is on */}
          {glModeAvailable && (
            <button
              onClick={handleToggleGlMode}
              className={`px-4 py-2 rounded-full text-xs font-extrabold border transition-colors ${
                glMode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'
              }`}
            >
              {glMode ? '✓ GL Mode Aktif' : 'Match dengan GL (Phase 5)'}
            </button>
          )}
          <select
            value={`${period.year}-${period.month}`}
            onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setPeriod({ year: y, month: m }); }}
            className="bg-white border border-[#e5eeff] rounded-xl px-3 py-2 text-xs font-bold text-[#012749]"
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              return <option key={i} value={`${d.getFullYear()}-${d.getMonth() + 1}`}>{d.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}</option>;
            })}
          </select>
          <button onClick={handleCloseBook} className="bg-[#012749] text-white px-4 py-2 rounded-full text-xs font-extrabold">Tutup Buku</button>
        </div>
      </div>

      {/* GL mode: COA account selector (shown when multiple BANK COA accounts exist) */}
      {glMode && glBankCoaAccounts.length > 1 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-3 flex items-center gap-3">
          <span className="text-xs font-bold text-indigo-700">Akun COA Bank:</span>
          <select
            value={glCoaAccountId ?? ''}
            onChange={(e) => setGlCoaAccountId(e.target.value || null)}
            className="text-xs border border-indigo-300 rounded-lg px-2 py-1 bg-white text-[#012749] font-bold"
          >
            {glBankCoaAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
            ))}
          </select>
        </div>
      )}

      <WizardSteps
        currentStep={currentStep}
        counts={{ setup: { done: uploadedAccountIds.size, total: accounts.length }, review: reviewCount, piutang: piutangCount }}
        onJump={(n) => showToast(`Step ${n}`)}
      />
      <NextActionBanner
        reviewCount={reviewCount}
        cashPending={cashPending}
        piutangCount={piutangCount}
        onStart={() => showToast('Scroll ke item berikutnya', 'info')}
        onClose={handleCloseBook}
      />
      <MultiAccountStatus
        accounts={accounts}
        uploadedAccountIds={uploadedAccountIds}
        onAddAccount={() => setShowAdd(true)}
        onUpload={(a) => setUploadFor(a)}
      />
      <TallyBar
        tally={channelTally}
        totalAmount={totalSales}
        totalCount={totalOrderCount}
      />

      {/* 3-column layout: swaps OrdersColumn ↔ JournalColumn when GL mode on */}
      <div className="grid grid-cols-3 gap-4">
        {glMode ? (
          <JournalColumn
            coaAccountId={glCoaAccountId}
            bankAccountId={accounts[0]?.id ?? null}
            bankAccountLabel={glBankAccountLabel}
            fromDate={periodFromDate(period.year, period.month)}
            toDate={periodToDate(period.year, period.month)}
            onPickJournalLine={(line) => {
              // JournalColumn click: in the future this could open a bank-line picker
              // For now, surface as toast (Option A flow: bank line is anchor)
              showToast(`JE ${line.entry_number} dipilih — klik mutasi bank untuk cocokkan`, 'info');
            }}
            onAutoMatch={handleAutoMatch}
            refreshKey={glRefreshKey}
          />
        ) : (
          <OrdersColumn
            orders={orders}
            onFindPayment={() => showToast('Drawer: order side (coming soon)', 'info')}
            onExtend={() => showToast('Geser tempo (coming soon)', 'info')}
            onWriteOff={() => showToast('Write-off (coming soon)', 'info')}
          />
        )}
        <MutasiColumn
          lines={bankLines}
          accounts={accounts}
          onFindPair={openFindPairForMutasi}
          onClassify={(l) => setClassifyFor(l)}
          onSplit={() => showToast('Split (coming soon)', 'info')}
        />
        <CashColumn
          batches={cashBatches}
          onFindDeposit={() => showToast('Find deposit (coming soon)', 'info')}
          onExplain={() => showToast('Explain variance (coming soon)', 'info')}
        />
      </div>
      <POSellThrough year={period.year} month={period.month} />
      <CompletionSummary orderPct={orderPct} mutasiPct={mutasiPct} cashPct={cashPct} />

      <MappingDrawer
        open={drawer.open}
        source={drawer.source}
        candidates={drawer.cands}
        onPick={handlePick}
        onSplit={() => showToast('Split flow', 'info')}
        onClassify={() => {
          if (drawer.source) {
            const l = bankLines.find(x => x.id === drawer.source!.id);
            if (l) setClassifyFor(l);
            setDrawer({ open: false, source: null, cands: [], glMode: false });
          }
        }}
        onSkip={() => setDrawer({ open: false, source: null, cands: [], glMode: false })}
        onClose={() => setDrawer({ open: false, source: null, cands: [], glMode: false })}
        multiAllocation={drawer.glMode}
        onPickMulti={drawer.glMode ? handlePickMultiGl : undefined}
      />
      <ClassificationModal
        open={!!classifyFor}
        bankLineSummary={classifyFor ? `${classifyFor.counterparty || classifyFor.description} · ${fmt(classifyFor.amount)}` : ''}
        onApply={async (kind, notes) => {
          if (classifyFor) {
            await reconciliationService.classifyLine(classifyFor.id, kind, notes);
            setClassifyFor(null);
            refresh();
          }
        }}
        onClose={() => setClassifyFor(null)}
      />
      {showAdd && (
        <AddBankAccountModal
          onSave={async (p) => { await reconciliationService.createBankAccount(p); setShowAdd(false); refresh(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}
      {uploadFor && (
        <UploadPDFModal
          account={uploadFor}
          year={period.year}
          month={period.month}
          onDone={() => { setUploadFor(null); refresh(); showToast('PDF diproses', 'success'); }}
          onCancel={() => setUploadFor(null)}
        />
      )}
    </div>
  );
}
