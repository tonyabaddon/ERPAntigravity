import { useState } from 'react';
import type { PiutangRow } from '../../types';
import { requestTempoWriteOff } from '../../lib/piutang/writeOff';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { formatIDR } from '../../lib/formatIDR';

interface WriteOffRequestModalProps {
  row: PiutangRow;
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const MIN_REASON_LEN = 10;


function mapErrorToToast(msg: string): string {
  if (msg.startsWith('ORDER_NOT_TEMPO:')) return 'Invoice tidak bisa di-tulis-off (sudah lunas / sudah ditulis-off)';
  if (msg.startsWith('WRITE_OFF_ALREADY_PENDING:')) return 'Tulis-off untuk invoice ini sudah diajukan';
  if (msg.startsWith('REASON_REQUIRED')) return 'Alasan wajib diisi (min 10 karakter)';
  if (msg.startsWith('ORDER_NOT_FOUND:')) return 'Invoice tidak ditemukan';
  if (msg.startsWith('OWNER_ONLY:')) return 'Sesi habis, login ulang';
  return msg || 'Gagal mengajukan tulis-off';
}

export default function WriteOffRequestModal({ row, onClose, onSubmitted, showToast }: WriteOffRequestModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= MIN_REASON_LEN;
  const canSubmit = reasonOk && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await requestTempoWriteOff(row.order.id, trimmed);
      showToast('Tulis-off diajukan ke Owner', 'success');
      onSubmitted();
    } catch (e) {
      const msg = extractErrorMessage(e);
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
        className="w-full max-w-md bg-white rounded shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-4 border-b border-gray-200">
          <h2 className="font-extrabold text-base text-[var(--color-caleo-primary)]">Ajukan Tulis-off</h2>
          <p className="text-xs text-gray-500 mt-0.5">Perlu persetujuan Owner.</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="text-xs space-y-1">
            <div><span className="text-gray-500">Customer:</span> <span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div><span className="text-gray-500">Invoice:</span> <span className="font-mono">{row.order.id.slice(0, 8)}</span></div>
            <div><span className="text-gray-500">Total:</span> <span className="font-bold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(row.order.total)}</span></div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Alasan <span className="text-red-600">*</span>
            </label>
            <textarea
              autoFocus
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan kenapa invoice ini tidak bisa ditagih lagi (min 10 karakter)..."
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
            />
            <div className={`text-[11px] mt-1 ${reasonOk ? 'text-gray-500' : 'text-red-600'}`}>
              {trimmed.length} / {MIN_REASON_LEN} karakter minimum
            </div>
          </div>
        </div>

        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold rounded bg-[var(--color-caleo-primary)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Mengajukan...' : 'Ajukan Tulis-off'}
          </button>
        </div>
      </div>
    </div>
  );
}
