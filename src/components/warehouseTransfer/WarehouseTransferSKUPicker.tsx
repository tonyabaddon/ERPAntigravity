import { useState } from 'react';
import { flushSync } from 'react-dom';
import { X, Search } from 'lucide-react';

export interface TransferLine { sku: string; name: string; qty: number; stockAvailable: number; }
interface Props {
  fromWarehouseId: string | null;
  lines: TransferLine[];
  onChange: (next: TransferLine[]) => void;
  searchSKU: (term: string, fromWarehouseId: string) => Promise<Array<{ sku: string; name: string; qty: number }>>;
}

export default function WarehouseTransferSKUPicker({ fromWarehouseId, lines, onChange, searchSKU }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ sku: string; name: string; qty: number }>>([]);
  // Per-SKU draft string so user can freely edit (backspace, retype) without
  // per-keystroke clamp resetting the value. Committed to parent on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function handleSearch(term: string) {
    setQuery(term);
    if (term.length < 2 || !fromWarehouseId) { setResults([]); return; }
    setResults((await searchSKU(term, fromWarehouseId)).filter(r => !lines.some(l => l.sku === r.sku)));
  }
  function addLine(r: { sku: string; name: string; qty: number }) {
    onChange([...lines, { sku: r.sku, name: r.name, qty: 1, stockAvailable: r.qty }]);
    setQuery(''); setResults([]);
  }
  function editQty(sku: string, raw: string) {
    setDrafts(d => ({ ...d, [sku]: raw }));
  }
  // Look up target row by SKU (not index) — if a sibling row is removed between
  // edit and blur, the index would shift and we'd clamp against the wrong row.
  function commitQty(sku: string) {
    const raw = drafts[sku];
    setDrafts(d => { const next = { ...d }; delete next[sku]; return next; });
    if (raw === undefined) return;
    const target = lines.find(l => l.sku === sku);
    if (!target) return;
    const n = parseInt(raw, 10);
    const clamped = Number.isFinite(n) ? Math.max(1, Math.min(n, target.stockAvailable)) : 1;
    onChange(lines.map(l => l.sku === sku ? { ...l, qty: clamped } : l));
  }
  function removeLine(i: number) {
    // Clear any orphaned draft so re-adding the same SKU doesn't resurface a stale typed value.
    const removedSku = lines[i]?.sku;
    if (removedSku) setDrafts(d => { const next = { ...d }; delete next[removedSku]; return next; });
    onChange(lines.filter((_, idx) => idx !== i));
  }

  const total = lines.reduce((a, b) => a + b.qty, 0);

  return (
    <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={query} onChange={e => handleSearch(e.target.value)} placeholder="Cari SKU / scan barcode…"
          disabled={!fromWarehouseId}
          className="w-full rounded border border-slate-300 pl-9 pr-3 py-2 text-sm disabled:bg-slate-50" />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded border border-slate-200 bg-white shadow-lg max-h-64 overflow-auto">
            {results.map(r => (
              <button key={r.sku} onClick={() => addLine(r)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span><span className="font-mono text-xs text-slate-500">{r.sku}</span> · {r.name}</span>
                <span className="text-xs text-slate-500">{r.qty} pcs</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="text-left py-1">SKU / Nama</th><th className="text-right py-1">Stok</th><th className="text-right py-1">Qty Kirim</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.sku} className="border-t border-slate-100">
                <td className="py-2"><span className="font-mono text-xs text-slate-500">{l.sku}</span> · {l.name}</td>
                <td className="py-2 text-right">{l.stockAvailable}</td>
                <td className="py-2 text-right">
                  <input type="number" min={1} max={l.stockAvailable}
                    value={drafts[l.sku] ?? String(l.qty)}
                    onChange={e => editQty(l.sku, e.target.value)}
                    // flushSync: without it, blur→commitQty schedules setLines but React 18
                    // batches through the immediately-following click on "Kirim Transfer",
                    // and submit() reads a stale lines closure → transfer ships with qty=1
                    // even though user typed a different value.
                    onBlur={() => flushSync(() => commitQty(l.sku))}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
                </td>
                <td className="py-2 pl-2"><button onClick={() => removeLine(i)}><X className="h-4 w-4 text-slate-400 hover:text-caleo-danger" /></button></td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-semibold">
              <td colSpan={2} className="py-2 text-right text-slate-500">Total:</td>
              <td className="py-2 text-right">{lines.length} SKU · {total} pcs</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
