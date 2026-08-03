// Pesanan Detail — full-page view with status badge, info cards, items table
// with qty_received_total progress, and action buttons depending on status.
// DRAFT: Mark Ordered / Edit / Void
// ORDERED: Buat Tagihan / Void
// CLOSED: read-only (Print only)
import React, { useEffect, useState } from 'react';
import {
  ChevronRight, Printer, Send, XOctagon, ArrowLeft, Store,
  CalendarClock, Package, FileText, AlertTriangle, X,
} from 'lucide-react';
import { pesananService } from '../../../lib/pesananService';
import type { DbPesanan, PesananStatus } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  pesananNumber: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onEdit: (p: DbPesanan) => void;
  onCreateTagihan: (p: DbPesanan) => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE: Record<PesananStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ORDERED: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-caleo-success',
};

export default function PesananDetailPage({
  pesananNumber, showToast, onBack, onEdit, onCreateTagihan,
}: Props) {
  const [pesanan, setPesanan] = useState<DbPesanan | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVoid, setShowVoid] = useState(false);
  const [marking, setMarking] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPesanan(await pesananService.fetchByNumber(pesananNumber)); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal load Pesanan', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [pesananNumber]);

  async function handleMarkOrdered() {
    if (!pesanan) return;
    setMarking(true);
    try {
      await pesananService.markOrdered(pesanan.id);
      showToast(`${pesanan.pesanan_number} ditandai ORDERED.`, 'success');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mark ordered', 'warning');
    } finally {
      setMarking(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  if (!pesanan) return <div className="p-8 text-center text-sm text-gray-500">Pesanan tidak ditemukan.</div>;

  const isVoided = !!pesanan.voided_at;
  const isDraft = pesanan.status === 'DRAFT' && !isVoided;
  const isOrdered = pesanan.status === 'ORDERED' && !isVoided;
  const isClosed = pesanan.status === 'CLOSED';

  const totalQty = (pesanan.items ?? []).reduce((a, i) => a + i.qty, 0);
  const totalReceived = (pesanan.items ?? []).reduce((a, i) => a + i.qty_received_total, 0);
  const fulfilmentPct = totalQty > 0 ? Math.min(100, (totalReceived / totalQty) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Pesanan</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">{pesanan.pesanan_number}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>{pesanan.pesanan_number}</h1>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isVoided ? 'bg-gray-200 text-gray-600' : STATUS_BADGE[pesanan.status]}`}>
              {isVoided ? 'VOID' : pesanan.status}
            </span>
          </div>
          <div className="text-xs text-gray-500">Dibuat {fmtDate(pesanan.created_at)} • {pesanan.supplier?.name ?? '—'}</div>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <>
              <button onClick={handleMarkOrdered} disabled={marking}
                className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 px-3 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
                <Send className="w-4 h-4" /> {marking ? 'Memproses...' : 'Mark Ordered'}
              </button>
              <button onClick={() => onEdit(pesanan)} className="text-sm font-semibold text-gray-700 px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
              <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-caleo-danger px-3 py-2 rounded border border-red-200 hover:bg-red-50">
                <XOctagon className="w-4 h-4" /> Void
              </button>
            </>
          )}
          {isOrdered && (
            <>
              <button onClick={() => onCreateTagihan(pesanan)}
                className="inline-flex items-center gap-2 text-sm font-bold text-white px-3 py-2 rounded"
                style={{ background: 'var(--color-caleo-primary)' }}>
                <Package className="w-4 h-4" /> Buat Tagihan
              </button>
              <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-caleo-danger px-3 py-2 rounded border border-red-200 hover:bg-red-50">
                <XOctagon className="w-4 h-4" /> Void
              </button>
            </>
          )}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {isVoided && (
        <div className="bg-red-50 border border-red-200 rounded p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-caleo-danger mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-caleo-danger">Pesanan ini sudah di-void</div>
            <div className="text-xs text-caleo-danger mt-1">{pesanan.void_reason ?? '—'}</div>
            <div className="text-caleo-11 text-caleo-danger mt-1">Void {fmtDate(pesanan.voided_at)}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{pesanan.supplier?.name ?? '—'}</div>
          <div className="text-xs text-gray-500 mt-1">Net {pesanan.supplier?.payment_term_days ?? 0} hari</div>
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500">Tanggal</div>
          </div>
          <div className="text-xs text-gray-600">Tgl Pesan: <strong>{fmtDate(pesanan.created_at)}</strong></div>
          <div className="text-xs text-gray-600 mt-1">Ordered: <strong>{fmtDate(pesanan.ordered_at)}</strong></div>
          <div className="text-xs text-gray-600 mt-1">Estimasi Datang: <strong>{fmtDate(pesanan.expected_receive_at)}</strong></div>
          {pesanan.closed_at && <div className="text-xs text-gray-600 mt-1">Closed: <strong>{fmtDate(pesanan.closed_at)}</strong></div>}
        </div>
        <div className="bg-indigo-50 rounded border border-indigo-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-caleo-11 font-bold uppercase tracking-wide text-indigo-700">Total</div>
          </div>
          <div className="text-xl font-extrabold text-indigo-700">{formatIDR(pesanan.total)}</div>
          <div className="text-caleo-11 text-gray-500 mt-1">Subtotal {formatIDR(pesanan.subtotal)} + Pajak {formatIDR(pesanan.tax_amount)}</div>
        </div>
      </div>

      {pesanan.notes && (
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500 mb-1">Catatan</div>
          <div className="text-sm text-gray-700">{pesanan.notes}</div>
        </div>
      )}

      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Barang yang Dipesan</div>
          {(isOrdered || isClosed) && totalQty > 0 && (
            <div className="text-caleo-11 text-gray-600">
              <span className="font-bold text-indigo-700">{totalReceived}</span> / {totalQty} diterima ({fulfilmentPct.toFixed(0)}%)
            </div>
          )}
        </div>
        <table className="w-full">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="text-left py-2 text-caleo-11 font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 w-24 text-caleo-11 font-semibold text-gray-500 uppercase">Dipesan</th>
              <th className="text-center py-2 w-32 text-caleo-11 font-semibold text-gray-500 uppercase">Diterima</th>
              <th className="text-right py-2 w-32 text-caleo-11 font-semibold text-gray-500 uppercase">Harga Beli</th>
              <th className="text-right py-2 w-32 text-caleo-11 font-semibold text-gray-500 uppercase">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(pesanan.items ?? []).map(it => {
              const pct = it.qty > 0 ? Math.min(100, (it.qty_received_total / it.qty) * 100) : 0;
              const done = it.qty_received_total >= it.qty;
              return (
                <tr key={it.id} className="border-b border-gray-100">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                      <span className="text-sm">{it.product_name}</span>
                    </div>
                  </td>
                  <td className="py-3 text-center font-semibold">{it.qty}</td>
                  <td className="py-3 px-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className={`text-xs font-bold ${done ? 'text-caleo-success' : 'text-gray-700'}`}>
                        {it.qty_received_total} / {it.qty}
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${done ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-right">{formatIDR(it.unit_cost)}</td>
                  <td className="py-3 text-right font-bold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(it.subtotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right text-xs font-semibold text-gray-500">TOTAL</td>
              <td className="py-3 text-right text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(pesanan.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="bg-gray-50 rounded border border-gray-200 p-4">
        <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500 mb-2">Riwayat</div>
        <div className="space-y-1 text-xs text-gray-600">
          <div>• Dibuat {fmtDate(pesanan.created_at)}</div>
          {pesanan.ordered_at && <div>• Dikirim ke supplier {fmtDate(pesanan.ordered_at)}</div>}
          {pesanan.closed_at && <div>• Pesanan selesai (CLOSED) {fmtDate(pesanan.closed_at)}</div>}
          {pesanan.voided_at && <div className="text-caleo-danger">• Void {fmtDate(pesanan.voided_at)} — {pesanan.void_reason}</div>}
        </div>
      </div>

      {showVoid && <VoidPesananModal pesanan={pesanan} onClose={() => setShowVoid(false)} onVoided={reload} showToast={showToast} />}
    </div>
  );
}

interface VoidProps {
  pesanan: DbPesanan;
  onClose: () => void;
  onVoided: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function VoidPesananModal({ pesanan, onClose, onVoided, showToast }: VoidProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await pesananService.void(pesanan.id, reason.trim());
      showToast(`${pesanan.pesanan_number} di-void.`, 'success');
      onVoided();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal void.', 'warning');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded border border-red-200 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-sm font-bold text-caleo-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Void {pesanan.pesanan_number}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Void akan menandai Pesanan ini sebagai dibatalkan. Pesanan tetap visible di history dengan flag VOID. Tidak bisa di-undo.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Alasan void (min. 10 karakter) *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Contoh: Supplier kehabisan stok, customer batal"
              className="w-full text-sm px-3 py-2 rounded border border-gray-300 focus:border-red-400 focus-visible:outline-none" />
            <div className="text-caleo-11 text-gray-400 mt-1">{reason.length} / 10 minimum</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={!valid || saving} className="text-sm font-semibold text-white bg-red-600 px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Void'}
          </button>
        </div>
      </div>
    </div>
  );
}
