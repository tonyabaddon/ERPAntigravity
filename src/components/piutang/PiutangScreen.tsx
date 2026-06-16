// PiutangScreen — main Piutang page (Phase 1B).
// Layout: header + 4 KPI cards + AR aging chart + filter pills + invoice table.
// Per spec §6.2.
//
// Actions per row (Phase 1B):
//   - "✓ Catat Bayar" → opens existing-style payment proof upload modal,
//     calls markTempoInvoicePaid
//   - "💬 WA" → Phase 1C will turn this into the preview-and-send modal; for
//     1B it disabled with tooltip "Phase 1C — coming soon"

import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Search, Upload, X, MessageSquare, AlertTriangle, Clock, CalendarClock, ChartPie } from 'lucide-react';
import {
  fetchPiutangRows,
  markTempoInvoicePaid,
  computeKpi,
  computeAging,
  PIUTANG_TIERS,
  uploadTempoPaymentProof,
  validateTempoProofFile,
  TEMPO_PROOF_ACCEPT,
} from '../../lib/piutangService';
import type { PiutangRow, PiutangTier } from '../../types';

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtRpShort = (n: number) =>
  n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')}jt` :
  n >= 1_000     ? `Rp ${Math.round(n / 1_000)}rb` : `Rp ${n}`;
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

interface Props {
  currentUserId: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterKey = 'all' | PiutangTier['key'];

export default function PiutangScreen({ currentUserId, showToast }: Props) {
  const [rows, setRows] = useState<PiutangRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [payTarget, setPayTarget] = useState<PiutangRow | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setRows(await fetchPiutangRows());
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal load piutang', 'warning');
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const kpi = useMemo(() => computeKpi(rows), [rows]);
  const aging = useMemo(() => computeAging(rows), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== 'all' && r.tier !== filter) return false;
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
          <div className="rounded-xl p-2.5" style={{ background: '#012749' }}>
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>Piutang</h1>
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
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <ChartPie className="w-4 h-4 text-gray-500" />
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">AR Aging — overdue saja</div>
        </div>
        <AgingBar segments={aging} onSelect={() => setFilter('overdue')} />
      </div>

      {/* Filter pills + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          {(['all', 'overdue', 'today', 'h3', 'future'] as FilterKey[]).map(k => {
            const active = filter === k;
            const tier = k === 'all' ? null : PIUTANG_TIERS[k];
            const label = k === 'all' ? 'Semua' : tier!.label;
            const count = k === 'all' ? rows.length :
              k === 'overdue' ? kpi.overdueCount :
              k === 'today' ? kpi.todayCount :
              k === 'h3' ? kpi.h3Count :
              rows.filter(r => r.tier === 'future').length;
            return (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${active ? 'text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                style={active ? { background: '#012749' } : {}}>
                {label} <span className="ml-1 text-[10px] opacity-80">({count})</span>
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
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {rows.length === 0 ? 'Belum ada piutang tempo.' : 'Tidak ada invoice yang cocok dengan filter.'}
          </div>
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
                const tier = PIUTANG_TIERS[r.tier];
                const daysLabel =
                  r.daysToDue < 0 ? `${Math.abs(r.daysToDue)} hari telat` :
                  r.daysToDue === 0 ? 'hari ini' :
                  `H-${r.daysToDue}`;
                return (
                  <tr key={r.order.id} className={`${tier.rowBg} border-b border-gray-100 hover:brightness-95`}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-sm">{r.customer?.name ?? r.order.customer_name}</div>
                      <div className="text-[11px] text-gray-500">{r.customer?.wa_number ?? r.order.customer_phone ?? '—'}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-mono text-[11px] text-gray-700">{r.order.id.slice(0, 8)}</div>
                      <div className="text-[11px] text-gray-500">Dibuat {fmtDate(r.order.created_at)}</div>
                    </td>
                    <td className="px-5 py-3 text-right font-bold" style={{ color: '#012749' }}>{fmtRp(r.order.total)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="text-sm font-semibold">{fmtDate(r.order.due_date)}</div>
                      <div className="text-[11px] text-gray-500">{daysLabel}</div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tier.badgeClass}`}>
                        {tier.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          disabled
                          title="Phase 1C — WA reminder otomatis"
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-gray-50 text-gray-400 border border-gray-200 inline-flex items-center gap-1 cursor-not-allowed">
                          <MessageSquare className="w-3 h-3" /> WA
                        </button>
                        <button
                          onClick={() => setPayTarget(r)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                          ✓ Catat Bayar
                        </button>
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
    </div>
  );
}

// ── KpiCard (local to PiutangScreen — matches existing pembelian KpiCard shape) ──
function KpiCard(props: { icon: React.ReactNode; iconBg: string; iconColor: string; label: string; value: string; sub: string; alarming?: boolean }) {
  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${props.alarming ? 'bg-rose-50/50 border-rose-100' : 'bg-white border-gray-200'}`}>
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${props.iconBg} ${props.iconColor} mb-3`}>
        {props.icon}
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{props.label}</div>
      <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{props.value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{props.sub}</div>
    </div>
  );
}

// ── AgingBar (horizontal stacked bar) ──
function AgingBar({ segments, onSelect }: { segments: ReturnType<typeof computeAging>; onSelect: () => void }) {
  const total = segments.reduce((a, s) => a + s.amount, 0);
  if (total === 0) {
    return <div className="text-xs text-gray-500">Tidak ada invoice overdue.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="flex h-6 rounded-lg overflow-hidden cursor-pointer" onClick={onSelect}>
        {segments.map(s => {
          const pct = total > 0 ? (s.amount / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={s.label} title={`${s.label}: ${fmtRpShort(s.amount)} (${s.count} invoice)`}
              style={{ width: `${pct}%`, background: s.color }} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px]">
        {segments.map(s => (
          <div key={s.label} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="font-semibold">{s.label}</span>
            <span className="text-gray-500">{fmtRpShort(s.amount)} ({s.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CatatBayarModal ──
function CatatBayarModal({ row, onClose, onPaid, showToast, currentUserId }: {
  row: PiutangRow; onClose: () => void; onPaid: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  currentUserId: string;
}) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'verifying'>('idle');

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) { setProofFile(null); return; }
    const err = validateTempoProofFile(f);
    if (err) { showToast(err, 'warning'); return; }
    setProofFile(f);
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      let proofUrl: string | null = null;
      if (proofFile) {
        setPhase('uploading');
        proofUrl = await uploadTempoPaymentProof(proofFile, row.order.id);
      }
      setPhase('verifying');
      await markTempoInvoicePaid(row.order.id, proofUrl, currentUserId);
      showToast(`Invoice ${row.order.id.slice(0, 8)} ditandai Lunas${proofUrl ? ' (bukti tersimpan)' : ''}.`, 'success');
      onPaid();
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal mark lunas', 'warning');
    } finally {
      setSaving(false);
      setPhase('idle');
    }
  }

  const isImage = proofFile?.type.startsWith('image/');
  const previewUrl = isImage && proofFile ? URL.createObjectURL(proofFile) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Catat Bayar — Invoice {row.order.id.slice(0, 8)}</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold">{fmtRp(row.order.total)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Jatuh Tempo</span><span className="font-semibold">{fmtDate(row.order.due_date)}</span></div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Bayar (opsional, max 5 MB)</label>
            {proofFile ? (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                {previewUrl ? (
                  <img src={previewUrl} alt={proofFile.name} className="max-h-32 w-full object-contain rounded" />
                ) : (
                  <div className="text-xs text-gray-600 flex items-center gap-1">📄 {proofFile.name}</div>
                )}
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>{(proofFile.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => setProofFile(null)} className="text-rose-600 hover:underline">Ganti</button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
                <Upload className="w-6 h-6 mb-1 text-gray-300" />
                Klik untuk upload bukti
                <span className="text-[10px] mt-0.5">PDF / JPG / PNG</span>
                <input type="file" accept={TEMPO_PROOF_ACCEPT} className="hidden" onChange={handleFileSelect} />
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} disabled={saving} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving}
            className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {phase === 'uploading' ? 'Mengupload bukti...' : phase === 'verifying' ? 'Menyimpan...' : 'Konfirmasi Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={`px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-${align ?? 'left'}`}>
      {children}
    </th>
  );
}
