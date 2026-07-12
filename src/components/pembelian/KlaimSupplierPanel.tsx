/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// KlaimSupplierPanel — Pembelian tab showing PENDING + resolved claims.
// Owner monitors klaims after decideSupplierClaim(KLAIM) sends them here,
// then records supplier response via inline resolve panel per row.

import { useEffect, useMemo, useState } from 'react';
import {
  Building2, CheckCircle2, XCircle, RefreshCcw, Package2, Coins, ArrowRight,
} from 'lucide-react';
import { listSupplierClaims, resolveSupplierClaim } from '../../lib/supplierClaims/api';
import type {
  SupplierClaimRow, ClaimStatus, ClaimOutcome,
} from '../../lib/supplierClaims/types';

interface KlaimSupplierPanelProps {
  showToast: (msg: string, tone?: 'success' | 'info' | 'warning') => void;
}

function formatIDR(n: number): string {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `Rp ${n.toLocaleString('id-ID')}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATUS_META: Record<ClaimStatus, { label: string; className: string }> = {
  AWAITING_OWNER_DECISION: { label: 'Menunggu Owner', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  DISPOSED: { label: 'Kerugian', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  PENDING: { label: 'Menunggu Supplier', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  RESOLVED_REPLACED: { label: 'Diganti', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  RESOLVED_CREDITED: { label: 'Credit Note', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  RESOLVED_CASHED: { label: 'Cash Refund', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  REJECTED: { label: 'Ditolak', className: 'bg-rose-100 text-rose-800 border-rose-200' },
};

const OUTCOME_OPTIONS: { value: ClaimOutcome; label: string; description: string }[] = [
  { value: 'REPLACED', label: 'Diganti barang', description: 'Supplier kirim barang pengganti — stok bertambah kembali' },
  { value: 'CREDITED', label: 'Potongan tagihan', description: 'Kurangi utang ke supplier ini' },
  { value: 'CASHED', label: 'Refund cash', description: 'Supplier transfer uang ke Kas/Bank' },
  { value: 'REJECTED', label: 'Ditolak supplier', description: 'Klaim tidak berhasil — dicatat sebagai loss' },
];

// Which status buckets show in the panel (excludes AWAITING which lives in
// the Owner Decision Inbox).
const VISIBLE_STATUSES: ClaimStatus[] = [
  'PENDING',
  'RESOLVED_REPLACED',
  'RESOLVED_CREDITED',
  'RESOLVED_CASHED',
  'REJECTED',
  'DISPOSED',
];

export default function KlaimSupplierPanel({ showToast }: KlaimSupplierPanelProps) {
  const [claims, setClaims] = useState<SupplierClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('pending');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [chosenOutcome, setChosenOutcome] = useState<ClaimOutcome>('REPLACED');
  const [resolutionAmount, setResolutionAmount] = useState<string>('');
  const [resolutionTarget, setResolutionTarget] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    try {
      const rows = await listSupplierClaims({ status: VISIBLE_STATUSES });
      setClaims(rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return claims;
    if (filter === 'pending') return claims.filter((c) => c.status === 'PENDING');
    return claims.filter((c) => c.status !== 'PENDING');
  }, [claims, filter]);

  const summary = useMemo(() => {
    const pending = claims.filter((c) => c.status === 'PENDING');
    return {
      pendingCount: pending.length,
      pendingValue: pending.reduce((s, c) => s + c.bookValue, 0),
      resolvedThisMonth: claims.filter((c) => {
        if (!c.resolvedAt) return false;
        const d = new Date(c.resolvedAt);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
    };
  }, [claims]);

  const openResolve = (claim: SupplierClaimRow) => {
    setResolvingId(claim.id);
    setChosenOutcome('REPLACED');
    setResolutionAmount(String(claim.bookValue));
    setResolutionTarget('');
    setNotes('');
  };

  const closeResolve = () => {
    setResolvingId(null);
    setNotes('');
  };

  const submitResolve = async (claim: SupplierClaimRow) => {
    if (chosenOutcome === 'CREDITED' || chosenOutcome === 'CASHED') {
      const amt = parseFloat(resolutionAmount);
      if (!isFinite(amt) || amt <= 0) {
        showToast('Nominal refund harus diisi', 'warning');
        return;
      }
    }
    if (chosenOutcome === 'CASHED' && !resolutionTarget) {
      showToast('Pilih Kas/Bank tujuan refund', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const amt =
        chosenOutcome === 'CREDITED' || chosenOutcome === 'CASHED'
          ? parseFloat(resolutionAmount)
          : undefined;
      const result = await resolveSupplierClaim({
        claimId: claim.id,
        outcome: chosenOutcome,
        resolutionAmount: amt,
        resolutionTargetId: chosenOutcome === 'CASHED' ? resolutionTarget : undefined,
        notes: notes || undefined,
      });
      showToast(
        `Klaim ${chosenOutcome} — book ${formatIDR(result.book_value)}${
          result.variance ? `, selisih ${formatIDR(Math.abs(result.variance))}` : ''
        }`,
        'success',
      );
      closeResolve();
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Memuat...</div>;

  return (
    <div className="px-4 py-3" style={{ fontSize: '14px' }}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Building2 className="h-5 w-5 text-blue-600" />
            Klaim Supplier
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Klaim barang rusak yang sedang di supplier atau sudah selesai.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCcw className="h-4 w-4" /> Refresh
        </button>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Menunggu Supplier</div>
          <div className="mt-1 text-xl font-semibold text-blue-700">{summary.pendingCount}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Total Nilai Pending</div>
          <div className="mt-1 text-xl font-semibold text-blue-700">{formatIDR(summary.pendingValue)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Selesai Bulan Ini</div>
          <div className="mt-1 text-xl font-semibold text-emerald-700">{summary.resolvedThisMonth}</div>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {[
          { k: 'pending', l: 'Menunggu' },
          { k: 'resolved', l: 'Selesai' },
          { k: 'all', l: 'Semua' },
        ].map(({ k, l }) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k as 'all' | 'pending' | 'resolved')}
            className={`rounded px-3 py-1 text-sm ${
              filter === k
                ? 'bg-blue-600 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          Tidak ada klaim.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((claim) => {
            const meta = STATUS_META[claim.status];
            const isResolving = resolvingId === claim.id;
            return (
              <div key={claim.id} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Package2 className="h-3.5 w-3.5" />
                      <span className="uppercase tracking-wide">{claim.sku}</span>
                      <span className="text-slate-300">·</span>
                      <span>{claim.qty} unit</span>
                      <span className="text-slate-300">·</span>
                      <span>{formatIDR(claim.bookValue)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-700">
                      {claim.supplierName ?? 'Supplier belum ditentukan'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Gudang {claim.warehouse.toUpperCase()} · Dibuat {formatDate(claim.createdAt)}
                      {claim.resolvedAt && (
                        <> · <span className="text-emerald-700">Selesai {formatDate(claim.resolvedAt)}</span></>
                      )}
                    </div>
                    {claim.damageNotes && (
                      <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        {claim.damageNotes}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                    {claim.status === 'PENDING' && !isResolving && (
                      <button
                        type="button"
                        onClick={() => openResolve(claim)}
                        className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Catat Response <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {isResolving && (
                  <div className="mt-3 space-y-3 rounded border border-blue-200 bg-blue-50/50 p-3">
                    <div className="text-sm font-medium text-blue-800">
                      Response supplier untuk klaim ini
                    </div>
                    <fieldset className="space-y-1">
                      {OUTCOME_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                            chosenOutcome === opt.value ? 'border-blue-500 bg-white' : 'border-slate-200 bg-white/60'
                          }`}
                        >
                          <input
                            type="radio"
                            className="mt-1"
                            checked={chosenOutcome === opt.value}
                            onChange={() => setChosenOutcome(opt.value)}
                          />
                          <div>
                            <div className="font-medium text-slate-800">{opt.label}</div>
                            <div className="text-xs text-slate-500">{opt.description}</div>
                          </div>
                        </label>
                      ))}
                    </fieldset>

                    {(chosenOutcome === 'CREDITED' || chosenOutcome === 'CASHED') && (
                      <label className="block text-sm">
                        <span className="text-slate-700">Nominal ({formatIDR(claim.bookValue)} book value)</span>
                        <input
                          type="number"
                          min={0}
                          value={resolutionAmount}
                          onChange={(e) => setResolutionAmount(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          Jika berbeda dari book, selisih akan dicatat sebagai loss/gain.
                        </div>
                      </label>
                    )}

                    {chosenOutcome === 'CASHED' && (
                      <label className="block text-sm">
                        <span className="text-slate-700">Kas/Bank tujuan (kode akun)</span>
                        <input
                          type="text"
                          value={resolutionTarget}
                          onChange={(e) => setResolutionTarget(e.target.value)}
                          placeholder="misalnya: 1-1200 (Bank BCA)"
                          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                        />
                      </label>
                    )}

                    <label className="block text-sm">
                      <span className="text-slate-700">Catatan (opsional)</span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeResolve}
                        className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submitResolve(claim)}
                        className="flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Coins className="h-4 w-4" />
                        {submitting ? 'Menyimpan...' : 'Simpan response'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
