// Pembayaran Detail — read-only view of a Pembayaran row + items covered.
// Void action available when status='LUNAS'. Reverses paid_amount on
// linked Tagihan rows (handled atomically by void_pembayaran RPC).
import React, { useEffect, useState } from 'react';
import {
  ChevronRight, ArrowLeft, Store, CalendarClock, XOctagon, AlertTriangle,
  X, Printer, Wallet,
} from 'lucide-react';
import { pembayaranService } from '../../../lib/pembayaranService';
import type { DbPembayaran } from '../../../types';
import { StorageLink } from '../../ui/StorageLink';
import { StorageImage } from '../../ui/StorageImage';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  pembayaranNumber: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onOpenTagihan?: (tagihanId: string) => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function PembayaranDetailPage({ pembayaranNumber, showToast, onBack, onOpenTagihan }: Props) {
  const [pmb, setPmb] = useState<DbPembayaran | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVoid, setShowVoid] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPmb(await pembayaranService.fetchByNumber(pembayaranNumber)); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal load Pembayaran', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [pembayaranNumber]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  if (!pmb) return <div className="p-8 text-center text-sm text-gray-500">Pembayaran tidak ditemukan.</div>;

  const isVoided = pmb.status === 'VOIDED';
  const netTotal = Math.max(0, pmb.amount_total - (pmb.discount_amount ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Pembayaran</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">{pmb.pembayaran_number}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>{pmb.pembayaran_number}</h1>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isVoided ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-800'}`}>
              {isVoided ? 'VOIDED' : '● Lunas'}
            </span>
          </div>
          <div className="text-xs text-gray-500">Dibayar {fmtDate(pmb.paid_at)} • {pmb.supplier?.name ?? '—'}</div>
        </div>
        <div className="flex gap-2">
          {!isVoided && (
            <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 px-3 py-2 rounded border border-red-200 hover:bg-red-50">
              <XOctagon className="w-4 h-4" /> Void
            </button>
          )}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {isVoided && (
        <div className="bg-red-50 border border-red-200 rounded p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-red-800">Pembayaran ini sudah di-void</div>
            <div className="text-xs text-red-700 mt-1">{pmb.void_reason ?? '—'}</div>
            <div className="text-[11px] text-red-600 mt-1">Void {fmtDate(pmb.voided_at)} — Tagihan yang ter-cover sudah di-rollback.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{pmb.supplier?.name ?? '—'}</div>
          <div className="text-xs text-gray-500 mt-1">Net {pmb.supplier?.payment_term_days ?? 0} hari</div>
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-3.5 h-3.5 text-sky-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Metode Bayar</div>
          </div>
          <div className="font-bold text-gray-800">{pmb.payment_method}</div>
          {pmb.account_label && <div className="text-xs text-gray-500 mt-1">{pmb.account_label}</div>}
        </div>
        <div className="bg-indigo-50 rounded border border-indigo-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Net Dibayar</div>
          </div>
          <div className="text-xl font-extrabold text-indigo-700">{formatIDR(netTotal)}</div>
          {pmb.discount_amount > 0 && (
            <div className="text-[11px] text-gray-500 mt-1">Subtotal {formatIDR(pmb.amount_total)} − Diskon {formatIDR(pmb.discount_amount)}</div>
          )}
        </div>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
          Tagihan yang Dibayar ({pmb.items?.length ?? 0})
        </div>
        <table className="w-full">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">Tagihan / Tukar Faktur</th>
              <th className="text-right py-2 w-40 text-[11px] font-semibold text-gray-500 uppercase">Dibayar</th>
              <th className="text-right py-2 w-24 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {(pmb.items ?? []).map(it => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-3 text-sm">
                  {it.tagihan_id ? (
                    <span className="font-semibold text-indigo-700">TGH-{it.tagihan_id.slice(0, 8).toUpperCase()}</span>
                  ) : it.tukar_faktur_id ? (
                    <span className="font-semibold text-fuchsia-700">TF-{it.tukar_faktur_id.slice(0, 8).toUpperCase()}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-3 text-right font-bold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(it.amount)}</td>
                <td className="py-3 text-right">
                  {it.tagihan_id && onOpenTagihan && (
                    <button onClick={() => onOpenTagihan(it.tagihan_id!)}
                      className="text-[11px] text-indigo-600 font-semibold hover:underline">
                      Lihat →
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-3 text-right text-xs font-semibold text-gray-500">SUBTOTAL</td>
              <td className="py-3 text-right text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(pmb.amount_total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {pmb.proof_url && (
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Bukti Bayar</div>
          <StorageImage
            bucket="purchase-documents"
            path={pmb.proof_url}
            alt="Bukti Bayar"
            className="w-full max-w-xs"
            aspectRatio="4/3"
          />
          <StorageLink bucket="purchase-documents" storageRef={pmb.proof_url} className="block mt-2">
            <span className="text-xs text-indigo-600 hover:underline">Lihat Ukuran Penuh ↗</span>
          </StorageLink>
        </div>
      )}

      {pmb.notes && (
        <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">Catatan</div>
          <div className="text-sm text-gray-700">{pmb.notes}</div>
        </div>
      )}

      {showVoid && (
        <VoidPembayaranModal pembayaran={pmb} onClose={() => setShowVoid(false)} onVoided={reload} showToast={showToast} />
      )}
    </div>
  );
}

interface VoidProps {
  pembayaran: DbPembayaran;
  onClose: () => void;
  onVoided: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function VoidPembayaranModal({ pembayaran, onClose, onVoided, showToast }: VoidProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await pembayaranService.void(pembayaran.id, reason.trim());
      showToast(`${pembayaran.pembayaran_number} di-void. Tagihan ter-cover ter-rollback.`, 'success');
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
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Void {pembayaran.pembayaran_number}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Void akan mengembalikan paid_amount semua Tagihan yang ter-cover ke nilai sebelumnya.
            Pembayaran tetap visible di history dengan flag VOIDED. Tidak bisa di-undo.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Alasan void (min. 10 karakter) *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Contoh: Transfer salah supplier, retry ke akun yg benar"
              className="w-full text-sm px-3 py-2 rounded border border-gray-300 focus:border-red-400 focus:outline-none" />
            <div className="text-[11px] text-gray-400 mt-1">{reason.length} / 10 minimum</div>
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
