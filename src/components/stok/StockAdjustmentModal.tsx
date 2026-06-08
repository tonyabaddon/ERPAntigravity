import { useState } from 'react';
import { X } from 'lucide-react';
import { requestAdjustment, supabase } from '../../lib/supabaseClient';
import type { StockItem, StockAdjustmentReason } from '../../types';

interface Props {
  item: StockItem;
  warehouse: 'atas' | 'bawah';
  currentUser: { id: string; name: string; role: string } | null;
  onClose: () => void;
  onSubmitted: () => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const REASONS: { code: StockAdjustmentReason; label: string }[] = [
  { code: 'rusak',          label: 'Barang Rusak' },
  { code: 'hilang',         label: 'Barang Hilang' },
  { code: 'sampel',         label: 'Dipakai Sampel' },
  { code: 'koreksi_input',  label: 'Koreksi Salah Input' },
  { code: 'korjual_admin',  label: 'Koreksi Jual Admin' },
];

export default function StockAdjustmentModal({
  item, warehouse, currentUser, onClose, onSubmitted, showToast,
}: Props) {
  const [qtyDelta, setQtyDelta] = useState<number>(-1);
  const [reasonCode, setReasonCode] = useState<StockAdjustmentReason>('rusak');
  const [reasonNote, setReasonNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const needsEvidence = reasonCode === 'rusak' || reasonCode === 'hilang';

  const uploadFiles = async (): Promise<string[]> => {
    if (!supabase) throw new Error('Supabase belum dikonfigurasi');
    const urls: string[] = [];
    for (const f of files) {
      const path = `adjustments/pending/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('stock-evidence').upload(path, f);
      if (error) throw error;
      urls.push(path);
    }
    return urls;
  };

  const onSubmit = async () => {
    if (!currentUser) { showToast?.('Tidak ada user aktif', 'warning'); return; }
    if (qtyDelta === 0) { showToast?.('Selisih tidak boleh 0', 'warning'); return; }
    if (needsEvidence && files.length === 0) {
      showToast?.('Bukti foto wajib untuk rusak/hilang', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const evidence_urls = await uploadFiles();
      await requestAdjustment({
        sku: item.sku,
        warehouse,
        qty_delta: qtyDelta,
        reason_code: reasonCode,
        reason_note: reasonNote || undefined,
        evidence_urls,
        actor_user_id: currentUser.id,
      });
      showToast?.('Permintaan dikirim ke Owner', 'success');
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
          <h2 className="font-bold text-slate-900">Permintaan Penyesuaian Stok</h2>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">
          {item.sku} · {item.name} · Gudang {warehouse === 'atas' ? 'Atas' : 'Bawah'}
        </p>
        <label className="block text-xs text-slate-600">Selisih (negatif untuk kurang)</label>
        <input
          type="number"
          value={qtyDelta}
          onChange={(e) => setQtyDelta(parseInt(e.target.value) || 0)}
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
        />
        <label className="block text-xs text-slate-600">Alasan</label>
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as StockAdjustmentReason)}
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
        >
          {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        <label className="block text-xs text-slate-600">Catatan tambahan</label>
        <textarea
          value={reasonNote}
          onChange={(e) => setReasonNote(e.target.value)}
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          rows={2}
        />
        {needsEvidence && (
          <>
            <label className="block text-xs text-slate-600">Bukti foto (wajib)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </>
        )}
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
            {submitting ? 'Mengirim…' : 'Kirim ke Owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
