import { useEffect, useState } from 'react';

interface SubPart { name: string; qty?: number; unit?: string; }

interface Props {
  open: boolean;
  initialSubParts: SubPart[];
  onSave: (subParts: SubPart[]) => void;
  onClose: () => void;
}

export function SubPartsModal({ open, initialSubParts, onSave, onClose }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) {
      setText(initialSubParts.map((sp) => sp.name).join('\n'));
    }
  }, [open, initialSubParts]);

  if (!open) return null;

  function handleSave() {
    const subParts: SubPart[] = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((name) => ({ name }));
    onSave(subParts);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Sub-komponen</h3>
        <p className="text-sm text-slate-600 mb-2">Satu bullet per baris:</p>
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Box Panel Indoor Plat 1.2 mm\nMCCB 3P 300A\nTerminal, Busbar, Rail & Duct\nPemasangan'}
          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-[var(--color-caleo-primary)] font-mono text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 rounded-md hover:bg-slate-100"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white rounded-md hover:opacity-90"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
