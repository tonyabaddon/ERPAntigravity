/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Printer, AlertTriangle } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import {
  warehouseTransferService,
  WarehouseTransferDetail,
  WarehouseTransferStatus,
} from '../../lib/warehouseTransferService';
import { useWarehouses } from '../../hooks/useWarehouses';
import { formatIDR } from '../../lib/formatIDR';

// ─── Status badge ────────────────────────────────────────────────────────────

function statusBadge(s: WarehouseTransferStatus) {
  switch (s) {
    case 'IN_TRANSIT': return { label: 'In-Transit', className: 'bg-amber-50 text-amber-800',    dotClassName: 'bg-amber-500' };
    case 'RECEIVED':   return { label: 'Diterima',   className: 'bg-emerald-50 text-emerald-800', dotClassName: 'bg-emerald-500' };
    case 'PARTIAL':    return { label: 'Selisih',    className: 'bg-orange-50 text-orange-800',   dotClassName: 'bg-orange-500' };
    case 'CANCELLED':  return { label: 'Dibatal',    className: 'bg-slate-100 text-slate-600',    dotClassName: 'bg-slate-400' };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WarehouseTransferDetailScreen({
  id,
  currentUserId,
  onBack,
}: {
  id: number;
  currentUserId: string;
  onBack: () => void;
}) {
  const { warehouses } = useWarehouses();

  const [detail, setDetail]       = useState<WarehouseTransferDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Mutable qty_received per line (keyed by sku). Null means "not yet set"
  // — will fall back to qty_sent (Semua Sesuai default after shortcut).
  const [receivedQty, setReceivedQty] = useState<Record<string, number>>({});

  // ── fetch ──────────────────────────────────────────────────────────────────

  async function fetchDetail() {
    setLoading(true);
    setError(null);
    try {
      const d = await warehouseTransferService.getTransferDetail(id);
      if (!d) { setError('Not found'); return; }
      setDetail(d);
      // Initialise receivedQty map from existing qty_received on each line
      const initial: Record<string, number> = {};
      for (const item of d.items) {
        initial[item.sku] = item.qty_received ?? item.qty_sent;
      }
      setReceivedQty(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchDetail(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Kembali
        </button>
        <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? 'Not found'}
        </p>
      </div>
    );
  }

  const { header, items } = detail;
  const badge = statusBadge(header.status);
  const fromName = warehouses.find(w => w.id === header.from_warehouse_id)?.name ?? header.from_warehouse_id;
  const toName   = warehouses.find(w => w.id === header.to_warehouse_id)?.name   ?? header.to_warehouse_id;

  const isReceiver = header.status === 'IN_TRANSIT' && currentUserId === header.receiver_user_id;
  const isSenderOnly = header.status === 'IN_TRANSIT' && currentUserId === header.sender_user_id && currentUserId !== header.receiver_user_id;

  // PARTIAL warning: any line where the entered qty_received < qty_sent
  const lossLines = items.filter(item => (receivedQty[item.sku] ?? item.qty_sent) < item.qty_sent);
  const totalLoss = lossLines.reduce((acc, item) => acc + (item.qty_sent - (receivedQty[item.sku] ?? item.qty_sent)), 0);
  // Live-computed loss value in Rp using per-line harga_modal snapshot from the RPC.
  // Falls back to 0 if the row is legacy (pre-slot-229 initiate) and harga_modal is null.
  const totalLossValueLive = lossLines.reduce((acc, item) => {
    const loss = item.qty_sent - (receivedQty[item.sku] ?? item.qty_sent);
    return acc + loss * (item.harga_modal ?? 0);
  }, 0);
  const showPartialWarning = isReceiver && totalLoss > 0;
  // Persisted loss value shown for closed PARTIAL transfers (from RPC).
  const persistedLossValue = header.status === 'PARTIAL' ? header.total_loss_value_rp ?? null : null;
  // ── actions ────────────────────────────────────────────────────────────────

  function handleSemaSesuai() {
    const all: Record<string, number> = {};
    for (const item of items) all[item.sku] = item.qty_sent;
    setReceivedQty(all);
  }

  async function handleKonfirmasi() {
    setActionError(null);
    setSubmitting(true);
    try {
      await warehouseTransferService.receiveTransfer(
        id,
        items.map(item => ({ sku: item.sku, qty_received: receivedQty[item.sku] ?? item.qty_sent })),
      );
      await fetchDetail();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBatalKirim() {
    const reason = window.confirm('Yakin batalkan pengiriman ini?')
      ? 'Dibatalkan oleh pengirim'
      : null;
    if (!reason) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await warehouseTransferService.cancelTransfer(id, reason);
      await fetchDetail();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCetakPDF() {
    try {
      const { renderTransferSuratJalan } = await import('../../lib/pdf/warehouseTransferPDF');
      const blob = await renderTransferSuratJalan(detail, {
        tenantName: '',
        tenantAddress: null,
        fromWarehouseName: fromName,
        toWarehouseName: toName,
        senderName: header.sender_user_id,
        receiverName: header.receiver_user_id,
        skuNames: Object.fromEntries(items.map(i => [i.sku, i.sku])),
        logoUrl: null,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      // non-fatal
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
            aria-label="Kembali">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="font-mono text-xs text-slate-500">{header.doc_no}</div>
            <h1 className="text-xl font-semibold text-slate-800">{fromName} → {toName}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClassName}`} />{badge.label}
          </span>
          <button
            onClick={handleCetakPDF}
            className="flex items-center gap-1 rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Printer className="h-3.5 w-3.5" /> Cetak Surat Jalan
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="rounded border border-slate-200 bg-white px-4 py-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-xs text-slate-400 uppercase tracking-wide">Tanggal Kirim</span>
          <div className="mt-0.5 font-semibold text-slate-800">
            {new Date(header.initiated_at).toLocaleString('id-ID')}
          </div>
        </div>
        {header.received_at && (
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wide">Tanggal Terima</span>
            <div className="mt-0.5 font-semibold text-slate-800">
              {new Date(header.received_at).toLocaleString('id-ID')}
            </div>
          </div>
        )}
        {header.cancelled_at && (
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wide">Tanggal Batal</span>
            <div className="mt-0.5 font-semibold text-slate-800">
              {new Date(header.cancelled_at).toLocaleString('id-ID')}
            </div>
          </div>
        )}
        {header.status === 'PARTIAL' && (
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wide">Nilai Kerugian</span>
            <div className="mt-0.5 font-semibold tabular-nums text-red-700">
              {persistedLossValue !== null && persistedLossValue > 0
                ? `${formatIDR(persistedLossValue)} (${header.total_loss_qty ?? 0} pcs)`
                : `— (${header.total_loss_qty ?? 0} pcs)`}
            </div>
            {persistedLossValue === null && (
              <div className="mt-0.5 text-xs text-slate-500">Nilai belum tercatat (transaksi lama)</div>
            )}
          </div>
        )}
        {header.notes && (
          <div className="col-span-2">
            <span className="text-xs text-slate-400 uppercase tracking-wide">Catatan</span>
            <div className="mt-0.5 text-slate-700">{header.notes}</div>
          </div>
        )}
      </div>

      {/* PARTIAL warning banner (live during input) */}
      {showPartialWarning && (
        <div className="flex gap-2 rounded border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ada <strong>Selisih -{totalLoss} pcs</strong>
            {totalLossValueLive > 0 && (
              <>
                {' '}
                (≈ <strong className="tabular-nums">{formatIDR(totalLossValueLive)}</strong>)
              </>
            )}
            . Setelah &ldquo;Konfirmasi&rdquo;, sistem otomatis:{' '}
            Tambah {header.total_qty_sent - totalLoss} pcs ke Gudang <strong>{toName}</strong>,{' '}
            Catat kerugian ke pembukuan (Kerugian Selisih Transfer Gudang),{' '}
            Notifikasi Owner via Keputusan Owner inbox.
          </span>
        </div>
      )}

      {/* Item table */}
      <div className="rounded border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 text-left">SKU / Nama</th>
              <th className="px-4 py-2 text-right">Qty Kirim</th>
              <th className="px-4 py-2 text-right">Qty Diterima</th>
              <th className="px-4 py-2 text-right">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const sentQty     = item.qty_sent;
              const recvQty     = isReceiver
                ? (receivedQty[item.sku] ?? sentQty)
                : (item.qty_received ?? sentQty);
              const selisih     = recvQty - sentQty;

              return (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{item.sku}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{sentQty}</td>
                  <td className="px-4 py-2 text-right">
                    {isReceiver ? (
                      <NumberInput
                        min={0}
                        max={sentQty}
                        allowDecimal={false}
                        value={receivedQty[item.sku] ?? sentQty}
                        aria-label={`Qty Diterima ${item.sku}`}
                        onChange={n => setReceivedQty(prev => ({
                          ...prev,
                          [item.sku]: Math.max(0, Math.min(n, sentQty)),
                        }))}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    ) : (
                      <span className="tabular-nums">{item.qty_received ?? '—'}</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${selisih < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                    {selisih === 0 ? '—' : selisih > 0 ? `+${selisih}` : selisih}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Action error */}
      {actionError && (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </p>
      )}

      {/* Conditional action buttons */}
      {isReceiver && (
        <div className="flex items-center gap-3 justify-end pt-1">
          <button
            onClick={handleSemaSesuai}
            disabled={submitting}
            className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Semua Sesuai — Klik Satu
          </button>
          <button
            onClick={handleKonfirmasi}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Konfirmasi Terima
          </button>
        </div>
      )}

      {isSenderOnly && (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleBatalKirim}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Batal Kirim
          </button>
        </div>
      )}
    </div>
  );
}
