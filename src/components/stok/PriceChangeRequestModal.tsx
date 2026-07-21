import { useState } from 'react';
import { X } from 'lucide-react';
import { requestPriceChange } from '../../lib/supabaseClient';
import type { StockItem } from '../../types';
import { formatIDR } from '../../lib/formatIDR';

interface Props {
  item: StockItem;
  field: 'price' | 'harga_modal';
  currentUser: { id: string; name: string; role: string } | null;
  onClose: () => void;
  onSubmitted: () => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PriceChangeRequestModal({
  item, field, currentUser, onClose, onSubmitted, showToast,
}: Props) {
  const currentValue = field === 'price' ? item.price : item.harga_modal ?? 0;
  const [newValue, setNewValue] = useState<number>(currentValue);
  const [reasonNote, setReasonNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const marginPreview = (() => {
    const price = field === 'price' ? newValue : item.price;
    const hargaModal = field === 'harga_modal' ? newValue : (item.harga_modal ?? 0);
    if (price <= 0) return 0;
    return ((price - hargaModal) / price) * 100;
  })();

  const onSubmit = async () => {
    if (!currentUser) { showToast?.('Tidak ada user aktif', 'warning'); return; }
    if (!reasonNote.trim()) { showToast?.('Alasan wajib diisi', 'warning'); return; }
    if (newValue === currentValue) { showToast?.('Nilai baru sama dengan saat ini', 'warning'); return; }
    if (newValue < 0) { showToast?.('Nilai tidak boleh negatif', 'warning'); return; }
    setSubmitting(true);
    try {
      await requestPriceChange({
        sku: item.sku,
        field,
        new_value: newValue,
        reason_note: reasonNote,
        actor_user_id: currentUser.id,
      });
      showToast?.('Permintaan perubahan harga dikirim ke Owner', 'success');
      onSubmitted();
      onClose();
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'warning');
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
        className="bg-white rounded-lg max-w-md w-full p-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">
            Ubah {field === 'price' ? 'Harga Jual' : 'HPP'}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">{item.sku} · {item.name}</p>

        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          ⚠ Semua perubahan harga butuh approval Owner (tidak ada threshold).
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-600">Nilai saat ini</label>
            <p className="text-sm font-semibold">{formatIDR(currentValue)}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-600">Nilai baru</label>
            <input
              type="number"
              value={newValue}
              onChange={(e) => setNewValue(parseInt(e.target.value) || 0)}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">Margin baru: {marginPreview.toFixed(1)}%</p>

        <label className="block text-xs text-slate-600">Alasan (wajib)</label>
        <textarea
          value={reasonNote}
          onChange={(e) => setReasonNote(e.target.value)}
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          rows={3}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-slate-200 rounded-full text-sm"
          >
            Batal
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50"
          >
            {submitting ? 'Mengirim…' : '📨 Kirim ke Owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
