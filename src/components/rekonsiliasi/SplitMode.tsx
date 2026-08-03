// src/components/rekonsiliasi/SplitMode.tsx
import React, { useState } from 'react';
import { NumberInput } from '../ui/NumberInput';

interface SplitRow { slotId: string; slotLabel: string; amount: number }
interface Props {
  open: boolean;
  totalAmount: number;
  candidates: { id: string; label: string; expected: number }[];
  onApply: (rows: SplitRow[]) => void;
  onClose: () => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(2).replace('.', ',') + 'jt'; }

export default function SplitMode({ open, totalAmount, candidates, onApply, onClose }: Props) {
  const [rows, setRows] = useState<SplitRow[]>([]);

  if (!open) return null;
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const remaining = totalAmount - sum;

  const addRow = () => setRows([...rows, { slotId: '', slotLabel: '', amount: remaining > 0 ? remaining : 0 }]);
  const updateRow = (i: number, patch: Partial<SplitRow>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const deleteRow = (i: number) => setRows(rows.filter((_, j) => j !== i));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded p-6 w-full max-w-lg">
        <h3 className="text-base font-black text-[var(--color-caleo-primary)] mb-1">Pecah {fmt(totalAmount)} ke beberapa target</h3>
        <p className="text-caleo-11 text-slate-500 font-semibold mb-4">Total alokasi harus sama dengan jumlah bank line.</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <select
              value={r.slotId}
              onChange={e => {
                const opt = candidates.find(c => c.id === e.target.value);
                updateRow(i, { slotId: e.target.value, slotLabel: opt?.label ?? '' });
              }}
              className="flex-1 px-3 py-2 border border-[var(--color-caleo-mist)] rounded text-xs"
            >
              <option value="">— pilih target —</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.label} ({fmt(c.expected)})</option>)}
            </select>
            <NumberInput
              value={r.amount}
              onChange={n => updateRow(i, { amount: n })}
              className="w-32 px-3 py-2 border border-[var(--color-caleo-mist)] rounded text-xs"
            />
            <button onClick={() => deleteRow(i)} className="text-caleo-danger px-2">×</button>
          </div>
        ))}
        <button onClick={addRow} className="text-caleo-10 font-extrabold text-[var(--color-caleo-primary)] mb-3">+ Tambah target</button>
        <div className={`text-caleo-11 font-extrabold mb-4 ${Math.abs(remaining) < 50 ? 'text-emerald-700' : 'text-caleo-danger'}`}>
          Sisa: {fmt(remaining)} {Math.abs(remaining) < 50 ? '✓' : '— harus 0 sebelum Apply'}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button
            onClick={() => onApply(rows)}
            disabled={Math.abs(remaining) >= 50 || rows.length === 0}
            className="px-4 py-2 rounded-full text-xs font-bold bg-[var(--color-caleo-primary)] text-white disabled:opacity-50"
          >
            Terapkan
          </button>
        </div>
      </div>
    </div>
  );
}
