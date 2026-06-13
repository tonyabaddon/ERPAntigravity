// src/components/RekonsiliasiScreen.tsx
import React, { useState, useMemo } from 'react';
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
import POSellThrough from './rekonsiliasi/POSellThrough';
import CompletionSummary from './rekonsiliasi/CompletionSummary';
import MappingDrawer, { type DrawerCandidate, type DrawerSource } from './rekonsiliasi/MappingDrawer';
import ClassificationModal from './rekonsiliasi/ClassificationModal';
import AddBankAccountModal from './rekonsiliasi/AddBankAccountModal';
import UploadPDFModal from './rekonsiliasi/UploadPDFModal';

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

export default function RekonsiliasiScreen({ currentUser, showToast }: Props) {
  const allowed = currentUser?.role?.toLowerCase() === 'owner' || !!currentUser?.permissions?.reconciliation;
  const [period, setPeriod] = useState(defaultPeriod());
  const { loading, accounts, orders, bankLines, cashBatches, refresh } = useRekonsiliasi(period.year, period.month);

  const [showAdd, setShowAdd] = useState(false);
  const [uploadFor, setUploadFor] = useState<BankAccount | null>(null);
  const [drawer, setDrawer] = useState<{ source: DrawerSource | null; cands: DrawerCandidate[]; open: boolean }>({ source: null, cands: [], open: false });
  const [classifyFor, setClassifyFor] = useState<BankStatementLine | null>(null);

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

  const handleCloseBook = async () => {
    const r = await reconciliationService.closeMonth(period.year, period.month);
    if (r.ok) showToast('✓ Buku ditutup', 'success'); else showToast(`❌ ${r.reason ?? 'gagal'}`, 'warning');
    refresh();
  };

  const openFindPairForMutasi = (line: BankStatementLine) => {
    const tol = 0.05;
    const lo = line.amount * (1 - tol);
    const hi = line.amount * (1 + tol);
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
  };

  const handlePick = async (candidateId: string) => {
    if (!drawer.source) return;
    if (drawer.source.type === 'mutasi') {
      const line = bankLines.find(l => l.id === drawer.source!.id);
      if (!line || !supabase) return;
      await reconciliationService.createAllocation(line.id, candidateId, line.amount);
      await supabase.from('bank_statement_lines')
        .update({ lane: 'GREEN', match_reason: 'manual', match_confidence: 1.0 })
        .eq('id', line.id);
      showToast('✓ Cocok', 'success');
      setDrawer({ open: false, source: null, cands: [] });
      refresh();
    }
  };

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
        <div className="flex items-center gap-2">
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
          <button onClick={handleCloseBook} className="bg-[#012749] text-white px-4 py-2 rounded-full text-xs font-extrabold">🔒 Tutup Buku</button>
        </div>
      </div>

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
      <div className="grid grid-cols-3 gap-4">
        <OrdersColumn
          orders={orders}
          onFindPayment={() => showToast('Drawer: order side (coming soon)', 'info')}
          onExtend={() => showToast('Geser tempo (coming soon)', 'info')}
          onWriteOff={() => showToast('Write-off (coming soon)', 'info')}
        />
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
            setDrawer({ open: false, source: null, cands: [] });
          }
        }}
        onSkip={() => setDrawer({ open: false, source: null, cands: [] })}
        onClose={() => setDrawer({ open: false, source: null, cands: [] })}
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
