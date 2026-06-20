import { useState } from 'react';
import type { PiutangRow } from '../../types';
import { revertTempoWriteOff } from '../../lib/piutang/writeOff';

interface RevertWriteOffConfirmModalProps {
  row: PiutangRow;
  onClose: () => void;
  onReverted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function fmtRp(n: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

function mapErrorToToast(msg: string): string {
  if (msg.startsWith('NOT_WRITTEN_OFF:')) return 'Invoice tidak dalam status tulis-off';
  if (msg.startsWith('OWNER_ONLY:')) return 'Hanya Owner aktif yang bisa batalkan tulis-off';
  if (msg.startsWith('ORDER_NOT_FOUND:')) return 'Invoice tidak ditemukan';
  return msg || 'Gagal batalkan tulis-off';
}

export default function RevertWriteOffConfirmModal({
  row, onClose, onReverted, showToast,
}: RevertWriteOffConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      await revertTempoWriteOff(row.order.id);
      showToast('Tulis-off dibatalkan', 'success');
      onReverted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(mapErrorToToast(msg), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-red-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-red-100 bg-red-50">
          <h2 className="font-extrabold text-base text-red-800">Batalkan Tulis-off?</h2>
          <p className="text-xs text-red-700 mt-0.5">Invoice akan kembali ke status piutang aktif.</p>
        </div>

        <div className="px-5 py-4 space-y-2">
          <div className="text-xs space-y-1">
            <div><span className="text-gray-500">Customer:</span> <span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div><span className="text-gray-500">Invoice:</span> <span className="font-mono">{row.order.id.slice(0, 8)}</span></div>
            <div><span className="text-gray-500">Total:</span> <span className="font-bold" style={{ color: '#012749' }}>{fmtRp(row.order.total)}</span></div>
            {row.order.write_off_reason && (
              <div><span className="text-gray-500">Alasan tulis-off:</span> <span className="italic">{row.order.write_off_reason}</span></div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Tidak
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Membatalkan...' : 'Ya, Batalkan'}
          </button>
        </div>
      </div>
    </div>
  );
}
