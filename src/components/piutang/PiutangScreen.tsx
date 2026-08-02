// PiutangScreen — main Piutang page (Phase 1B / Sprint 2).
// Layout: header + 4 KPI cards + AR aging chart + filter pills + invoice table.
// Per spec §6.2.
//
// Actions per row (Sprint 2):
//   - "💬 WA" → calls send_piutang_reminder_manual RPC; Premium-gated
//   - "✓ Catat Bayar" → opens existing-style payment proof upload modal,
//     calls markTempoInvoicePaid

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Search, Upload, X, MessageSquare, AlertTriangle, Clock, CalendarClock, ChartPie } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchPiutangRows,
  computeKpi,
  computeAging,
  outstandingOf,
  PIUTANG_TIERS,
  uploadTempoPaymentProof,
  validateTempoProofFile,
  TEMPO_PROOF_ACCEPT,
} from '../../lib/piutangService';
import { recordPiutangPayment } from '../../lib/akuntansi/dualWrite';
import type { PiutangRow, PiutangTier } from '../../types';
import WriteOffRequestModal from './WriteOffRequestModal';
import RevertWriteOffConfirmModal from './RevertWriteOffConfirmModal';
import CashAccountPicker from '../akuntansi/CashAccountPicker';
import { formatIDR } from '../../lib/formatIDR';
import EmptyState from '../ui/EmptyState';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';

const fmtRpShort = (n: number) =>
  n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')}jt` :
  n >= 1_000     ? `Rp ${Math.round(n / 1_000)}rb` : `Rp ${n}`;
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

interface Props {
  currentUserId: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  isOwner?: boolean;
}

type FilterKey = 'all' | PiutangTier['key'] | 'written_off' | 'lunas';

// Latest reminder record per invoice (keyed by invoice_id)
interface ReminderInfo {
  sent_at: string;
  rule_type: string;
  status: string;
}

export default function PiutangScreen({ currentUserId, showToast, isOwner = false }: Props) {
  const tenant = useTenant();
  const isPremium = tenant?.plan_code === 'PREMIUM' && tenant?.expiry_mode !== 'READONLY';

  const [rows, setRows] = useState<PiutangRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [payTarget, setPayTarget] = useState<PiutangRow | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PiutangRow | null>(null);
  const [revertTarget, setRevertTarget] = useState<PiutangRow | null>(null);
  const [reminderMap, setReminderMap] = useState<Record<string, ReminderInfo>>({});
  const [sendingWa, setSendingWa] = useState<string | null>(null); // invoice_id being sent

  const loadReminderMap = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('piutang_reminder_sent')
      .select('invoice_id, sent_at, rule_type, status')
      .order('sent_at', { ascending: false });
    if (!data) return;
    // Keep latest per invoice_id
    const map: Record<string, ReminderInfo> = {};
    for (const r of data) {
      if (!map[r.invoice_id]) {
        map[r.invoice_id] = { sent_at: r.sent_at, rule_type: r.rule_type, status: r.status };
      }
    }
    setReminderMap(map);
  }, []);

  async function reload() {
    setLoading(true);
    setFetchError(null);
    try {
      setRows(await fetchPiutangRows({
        includeWrittenOff: filter === 'written_off',
        includeLunas: filter === 'lunas',
      }));
      void loadReminderMap();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Gagal memuat data piutang.');
      showToast(e instanceof Error ? e.message : 'Gagal load piutang', 'warning');
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  async function handleSendWa(invoiceId: string) {
    if (!supabase) return;
    setSendingWa(invoiceId);
    try {
      const { data, error } = await supabase.rpc('send_piutang_reminder_manual', {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.status === 'OK') {
        showToast(result.message ?? 'Reminder akan dikirim dalam beberapa detik', 'success');
        // Refresh reminder map after a short delay to catch the new row
        setTimeout(() => void loadReminderMap(), 2000);
      } else {
        showToast(result?.message ?? 'Gagal mengirim reminder', 'warning');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim reminder', 'warning');
    } finally {
      setSendingWa(null);
    }
  }

  const kpi = useMemo(() => computeKpi(rows), [rows]);
  const aging = useMemo(() => computeAging(rows), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'all') {
        if (r.order.status !== 'INVOICE_TEMPO') return false;
      } else if (filter === 'written_off') {
        if (r.order.status !== 'INVOICE_WRITTEN_OFF') return false;
      } else if (filter === 'lunas') {
        if (r.order.status !== 'PAYMENT_VERIFIED') return false;
      } else {
        if (r.order.status !== 'INVOICE_TEMPO') return false;
        if (r.tier !== filter) return false;
      }
      if (q) {
        const name = (r.customer?.name ?? r.order.customer_name ?? '').toLowerCase();
        const phone = (r.customer?.wa_number ?? r.order.customer_phone ?? '').toLowerCase();
        const id = r.order.id.toLowerCase();
        if (!name.includes(q) && !phone.includes(q) && !id.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded p-2.5" style={{ background: 'var(--color-caleo-primary)' }}>
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>Piutang</h1>
            <div className="text-xs text-gray-500">Lacak invoice tempo customer + AR aging</div>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          icon={<Wallet className="w-5 h-5" />} iconBg="bg-indigo-50" iconColor="text-indigo-700"
          label="Total Piutang" value={fmtRpShort(kpi.totalPiutang)} sub={`${kpi.totalCount} invoice`}
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-rose-50" iconColor="text-rose-700"
          label="Overdue" value={fmtRpShort(kpi.overdueAmount)} sub={`${kpi.overdueCount} invoice`}
          alarming={kpi.overdueCount > 0}
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />} iconBg="bg-orange-50" iconColor="text-orange-700"
          label="Due Hari Ini" value={fmtRpShort(kpi.todayAmount)} sub={`${kpi.todayCount} invoice`}
        />
        <KpiCard
          icon={<CalendarClock className="w-5 h-5" />} iconBg="bg-yellow-50" iconColor="text-yellow-700"
          label="Dalam 3 Hari" value={fmtRpShort(kpi.h3Amount)} sub={`${kpi.h3Count} invoice`}
        />
      </div>

      {/* AR Aging chart */}
      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <ChartPie className="w-4 h-4 text-gray-500" />
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">AR Aging — overdue saja</div>
        </div>
        <AgingBar segments={aging} onSelect={() => setFilter('overdue')} />
      </div>

      {/* Filter pills + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          {(['all', 'overdue', 'today', 'h3', 'future', 'written_off', 'lunas'] as FilterKey[]).map(k => {
            const active = filter === k;
            const tier = (k === 'all' || k === 'written_off' || k === 'lunas') ? null : PIUTANG_TIERS[k];
            const label = k === 'all' ? 'Semua'
              : k === 'written_off' ? 'Tulis-off'
              : k === 'lunas' ? 'Lunas (Histori)'
              : tier!.label;
            const count = k === 'all' ? rows.filter(r => r.order.status === 'INVOICE_TEMPO').length :
              k === 'overdue' ? kpi.overdueCount :
              k === 'today' ? kpi.todayCount :
              k === 'h3' ? kpi.h3Count :
              k === 'written_off' ? rows.filter(r => r.order.status === 'INVOICE_WRITTEN_OFF').length :
              k === 'lunas' ? rows.filter(r => r.order.status === 'PAYMENT_VERIFIED').length :
              rows.filter(r => r.tier === 'future' && r.order.status === 'INVOICE_TEMPO').length;
            return (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${active ? 'text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                style={active ? { background: 'var(--color-caleo-primary)' } : {}}>
                {label} <span className="ml-1 text-caleo-10 opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-56" placeholder="Cari nama / HP / invoice ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Invoice table */}
      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <LoadingState label="Memuat piutang…" />
        ) : fetchError ? (
          <ErrorState message={fetchError} onRetry={() => void reload()} />
        ) : filtered.length === 0 ? (
          <EmptyState message={rows.length === 0 ? 'Belum ada piutang tempo.' : 'Tidak ada invoice yang cocok dengan filter.'} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <Th>Customer</Th>
                <Th>Invoice</Th>
                <Th align="right">Total</Th>
                <Th align="right">Jatuh Tempo</Th>
                <Th align="center">Status</Th>
                <Th align="right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                // Tier chip is a due-date bucket ("Overdue" / "Akan Datang").
                // When the invoice is already Lunas (PAYMENT_VERIFIED) or
                // Written-off, that due-date bucket is meaningless — the row
                // isn't waiting anymore. Override the chip + row tint so
                // the historical rows stop screaming "Overdue" (2026-07-12
                // QA — flagged during V3 validation of Bug 6a Lunas tab).
                const isLunas = r.order.status === 'PAYMENT_VERIFIED';
                const isWrittenOff = r.order.status === 'INVOICE_WRITTEN_OFF';
                const dueTier = PIUTANG_TIERS[r.tier];
                const badgeLabel = isLunas ? 'Selesai'
                  : isWrittenOff ? 'Tulis-off'
                  : dueTier.label;
                const badgeClass = isLunas ? 'bg-emerald-100 text-emerald-800'
                  : isWrittenOff ? 'bg-gray-200 text-gray-600'
                  : dueTier.badgeClass;
                const rowBg = isLunas || isWrittenOff ? 'bg-white' : dueTier.rowBg;
                const daysLabel = isLunas || isWrittenOff ? ''
                  : r.daysToDue < 0 ? `${Math.abs(r.daysToDue)} hari telat`
                  : r.daysToDue === 0 ? 'hari ini'
                  : `H-${r.daysToDue}`;
                return (
                  <tr key={r.order.id} className={`${rowBg} border-b border-gray-100 hover:brightness-95`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-sm">{r.customer?.name ?? r.order.customer_name}</div>
                      <div className="text-caleo-11 text-gray-500">{r.customer?.wa_number ?? r.order.customer_phone ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-caleo-11 text-gray-700">{r.order.id.slice(0, 8)}</div>
                      <div className="text-caleo-11 text-gray-500">Dibuat {fmtDate(r.order.created_at)}</div>
                      {r.order.status === 'INVOICE_WRITTEN_OFF' && (
                        <div className="text-caleo-11 text-red-700 italic mt-0.5" title={r.order.write_off_reason ?? undefined}>
                          Tulis-off {r.order.written_off_at ? fmtDate(r.order.written_off_at) : ''} · {r.order.write_off_reason ?? '—'}
                        </div>
                      )}
                    </td>
                    {/* F-11: show sisa outstanding (post-partial). Fall back to total when nothing paid yet. */}
                    <td className="px-4 py-3 text-right font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
                      {formatIDR(outstandingOf(r))}
                      {(r.order.piutang_paid_amount ?? 0) > 0 && (
                        <div className="text-caleo-10 font-medium text-gray-500 mt-0.5">
                          dari {formatIDR(r.order.total)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold">{fmtDate(r.order.due_date)}</div>
                      <div className="text-caleo-11 text-gray-500">{daysLabel}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-caleo-11 font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {/* Per-row reminder badge */}
                        {reminderMap[r.order.id] && (
                          <ReminderBadge info={reminderMap[r.order.id]} />
                        )}
                      <div className="inline-flex gap-1">
                        {r.order.status === 'INVOICE_TEMPO' ? (
                          <>
                            {isPremium ? (
                              <button
                                onClick={() => void handleSendWa(r.order.id)}
                                disabled={sendingWa === r.order.id}
                                title="Kirim WA reminder manual"
                                className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                                <MessageSquare className="w-3 h-3" />
                                {sendingWa === r.order.id ? '...' : 'WA'}
                              </button>
                            ) : (
                              <button
                                disabled
                                title="WA reminder tersedia di paket Premium"
                                className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-gray-50 text-gray-400 border border-gray-200 inline-flex items-center gap-1 cursor-not-allowed">
                                <MessageSquare className="w-3 h-3" /> WA
                              </button>
                            )}
                            <button
                              onClick={() => setPayTarget(r)}
                              className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                              ✓ Catat Bayar
                            </button>
                            <button
                              onClick={() => setWriteOffTarget(r)}
                              className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
                              Tulis-off
                            </button>
                          </>
                        ) : r.order.status === 'INVOICE_WRITTEN_OFF' && isOwner ? (
                          <button
                            onClick={() => setRevertTarget(r)}
                            className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                            Batal Tulis-off
                          </button>
                        ) : null}
                      </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {payTarget && (
        <CatatBayarModal
          row={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={() => { setPayTarget(null); reload(); }}
          showToast={showToast}
          currentUserId={currentUserId}
        />
      )}
      {writeOffTarget && (
        <WriteOffRequestModal
          row={writeOffTarget}
          onClose={() => setWriteOffTarget(null)}
          onSubmitted={() => { setWriteOffTarget(null); reload(); }}
          showToast={showToast}
        />
      )}
      {revertTarget && (
        <RevertWriteOffConfirmModal
          row={revertTarget}
          onClose={() => setRevertTarget(null)}
          onReverted={() => { setRevertTarget(null); reload(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── ReminderBadge — shows last reminder sent_at + status ──
function ReminderBadge({ info }: { info: ReminderInfo }) {
  const sentAgo = (() => {
    const diff = Date.now() - new Date(info.sent_at).getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}j lalu`;
    if (m > 0) return `${m}m lalu`;
    return 'baru saja';
  })();
  const isSent = info.status === 'SENT';
  return (
    <span className={`text-caleo-10 font-semibold px-1.5 py-0.5 rounded-full ${isSent ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
      title={`${info.rule_type} · ${new Date(info.sent_at).toLocaleString('id-ID')}`}>
      {isSent ? '✓' : '!'} {info.rule_type} · {sentAgo}
    </span>
  );
}

// ── KpiCard (local to PiutangScreen — matches existing pembelian KpiCard shape) ──
function KpiCard(props: { icon: React.ReactNode; iconBg: string; iconColor: string; label: string; value: string; sub: string; alarming?: boolean }) {
  return (
    <div className={`rounded border p-4 shadow-sm ${props.alarming ? 'bg-rose-50/50 border-rose-100' : 'bg-white border-gray-200'}`}>
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded ${props.iconBg} ${props.iconColor} mb-3`}>
        {props.icon}
      </div>
      <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500">{props.label}</div>
      <div className="text-xl font-extrabold mt-1" style={{ color: 'var(--color-caleo-primary)' }}>{props.value}</div>
      <div className="text-caleo-11 text-gray-500 mt-0.5">{props.sub}</div>
    </div>
  );
}

// ── AgingBar (horizontal stacked bar) ──
function AgingBar({ segments, onSelect }: { segments: ReturnType<typeof computeAging>; onSelect: () => void }) {
  const total = segments.reduce((a, s) => a + s.amount, 0);
  if (total === 0) {
    return <EmptyState message="Tidak ada invoice overdue." inline />;
  }
  return (
    <div className="space-y-2">
      <div className="flex h-6 rounded overflow-hidden cursor-pointer" onClick={onSelect}>
        {segments.map(s => {
          const pct = total > 0 ? (s.amount / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={s.label} title={`${s.label}: ${fmtRpShort(s.amount)} (${s.count} invoice)`}
              style={{ width: `${pct}%`, background: s.color }} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-caleo-11">
        {segments.map(s => (
          <div key={s.label} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded" style={{ background: s.color }} />
            <span className="font-semibold">{s.label}</span>
            <span className="text-gray-500">{fmtRpShort(s.amount)} ({s.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CatatBayarModal ──
// F-11: supports partial payment. Amount input defaults to full outstanding
// (sisa), and users can enter any amount 1 ≤ x ≤ sisa. Backend RPC
// record_piutang_payment(..., p_amount) accepts the value; NULL falls back to
// full-close for pre-fix callers.
function CatatBayarModal({ row, onClose, onPaid, showToast, currentUserId }: {
  row: PiutangRow; onClose: () => void; onPaid: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  currentUserId: string;
}) {
  const outstandingSisa = outstandingOf(row);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'verifying'>('idle');
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  // F-11: amount input. Defaults to full sisa so "just tap Confirm" behaves
  // like the pre-fix full-close flow.
  const [amountStr, setAmountStr] = useState<string>(String(outstandingSisa));

  const amount = Math.max(0, Math.floor(Number(amountStr) || 0));
  const isFullClose = amount >= outstandingSisa;
  const sisaAfter = Math.max(0, outstandingSisa - amount);
  const amountValid = amount > 0 && amount <= outstandingSisa;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) { setProofFile(null); return; }
    const err = validateTempoProofFile(f);
    if (err) { showToast(err, 'warning'); return; }
    setProofFile(f);
  }

  async function handleConfirm() {
    if (!cashAccountId) {
      showToast('Pilih akun penerima pembayaran', 'warning');
      return;
    }
    if (!amountValid) {
      showToast(`Jumlah bayar harus antara Rp 1 dan ${formatIDR(outstandingSisa)}`, 'warning');
      return;
    }
    setSaving(true);
    try {
      let proofUrl: string | null = null;
      if (proofFile) {
        setPhase('uploading');
        proofUrl = await uploadTempoPaymentProof(proofFile, row.order.id);
      }
      setPhase('verifying');
      await recordPiutangPayment({
        orderId: row.order.id,
        cashAccountId,
        proofUrl,
        verifiedByUserId: currentUserId,
        amount,
      });
      const shortId = row.order.id.slice(0, 8);
      if (isFullClose) {
        showToast(`Invoice ${shortId} ditandai Lunas${proofUrl ? ' (bukti tersimpan)' : ''}.`, 'success');
      } else {
        showToast(
          `Pembayaran parsial ${formatIDR(amount)} tercatat untuk invoice ${shortId}. Sisa ${formatIDR(sisaAfter)}.`,
          'success'
        );
      }
      onPaid();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal catat bayar', 'warning');
    } finally {
      setSaving(false);
      setPhase('idle');
    }
  }

  const isImage = proofFile?.type.startsWith('image/');
  const previewUrl = isImage && proofFile ? URL.createObjectURL(proofFile) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded border border-gray-200 shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Catat Bayar — Invoice {row.order.id.slice(0, 8)}</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="bg-gray-50 rounded px-3 py-3 text-caleo-13 space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total Invoice</span><span className="font-semibold">{formatIDR(row.order.total)}</span></div>
            {(row.order.piutang_paid_amount ?? 0) > 0 && (
              <div className="flex justify-between"><span className="text-gray-500">Sudah Dibayar</span><span className="font-semibold">{formatIDR(row.order.piutang_paid_amount ?? 0)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Sisa Outstanding</span><span className="font-bold text-[var(--color-caleo-primary)]">{formatIDR(outstandingSisa)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Jatuh Tempo</span><span className="font-semibold">{fmtDate(row.order.due_date)}</span></div>
          </div>
          {/* F-11: partial-payment amount input + sisa-setelah-bayar preview. */}
          <div>
            <label className="text-caleo-13 font-semibold text-slate-700 block mb-1">
              Jumlah Bayar <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-caleo-13 text-slate-500">Rp</span>
              <input
                type="number"
                min={1}
                max={outstandingSisa}
                step={1}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className={`w-full pl-9 pr-3 py-2 rounded border text-caleo-13 font-mono focus-visible:outline-none focus-visible:ring-2 ${
                  amountValid
                    ? 'border-slate-300 focus-visible:ring-caleo-gold'
                    : 'border-rose-300 focus-visible:ring-caleo-gold bg-rose-50/40'
                }`}
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs">
              <button
                type="button"
                onClick={() => setAmountStr(String(outstandingSisa))}
                className="text-caleo-11 font-semibold text-emerald-700 hover:underline"
              >
                Isi penuh (lunasi)
              </button>
              {amountValid ? (
                <span className="text-slate-600">
                  Sisa setelah bayar: <b>{formatIDR(sisaAfter)}</b>
                  {isFullClose ? ' — invoice akan Lunas' : ' — invoice tetap tempo'}
                </span>
              ) : (
                <span className="text-rose-600">Isi antara Rp 1 dan {formatIDR(outstandingSisa)}</span>
              )}
            </div>
          </div>
          <CashAccountPicker
            value={cashAccountId}
            onChange={setCashAccountId}
            purposeFilter="business-only"
            required
            label="Masuk ke akun *"
          />
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Bayar (opsional, max 5 MB)</label>
            {proofFile ? (
              <div className="border border-gray-200 rounded p-3 space-y-2">
                {previewUrl ? (
                  <img src={previewUrl} alt={proofFile.name} className="max-h-32 w-full object-contain rounded" />
                ) : (
                  <div className="text-xs text-gray-600 flex items-center gap-1">📄 {proofFile.name}</div>
                )}
                <div className="flex items-center justify-between text-caleo-11 text-gray-500">
                  <span>{(proofFile.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => setProofFile(null)} className="text-rose-600 hover:underline">Ganti</button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
                <Upload className="w-6 h-6 mb-1 text-gray-300" />
                Klik untuk upload bukti
                <span className="text-caleo-10 mt-0.5">PDF / JPG / PNG</span>
                <input type="file" accept={TEMPO_PROOF_ACCEPT} className="hidden" onChange={handleFileSelect} />
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose} disabled={saving} className="text-sm font-medium text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving || !amountValid}
            className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
            {phase === 'uploading'
              ? 'Mengupload bukti...'
              : phase === 'verifying'
              ? 'Menyimpan...'
              : isFullClose
              ? 'Konfirmasi Lunas'
              : `Catat Bayar ${formatIDR(amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={`px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase tracking-wide text-${align ?? 'left'}`}>
      {children}
    </th>
  );
}
