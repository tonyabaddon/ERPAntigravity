import { useState } from 'react';
import { X, Search } from 'lucide-react';

export interface TransferLine { sku: string; name: string; qty: number; stockAvailable: number; }
interface Props {
  fromWarehouseId: string | null;
  lines: TransferLine[];
  onChange: (next: TransferLine[]) => void;
  searchSKU: (term: string) => Promise<Array<{ sku: string; name: string; qty: number }>>;
}

export default function WarehouseTransferSKUPicker({ fromWarehouseId, lines, onChange, searchSKU }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ sku: string; name: string; qty: number }>>([]);

  async function handleSearch(term: string) {
    setQuery(term);
    if (term.length < 2 || !fromWarehouseId) { setResults([]); return; }
    setResults((await searchSKU(term)).filter(r => !lines.some(l => l.sku === r.sku)));
  }
  function addLine(r: { sku: string; name: string; qty: number }) {
    onChange([...lines, { sku: r.sku, name: r.name, qty: 1, stockAvailable: r.qty }]);
    setQuery(''); setResults([]);
  }
  function updateQty(i: number, qty: number) {
    onChange(lines.map((l, idx) => idx === i ? { ...l, qty: Math.max(1, Math.min(qty, l.stockAvailable)) } : l));
  }
  function removeLine(i: number) { onChange(lines.filter((_, idx) => idx !== i)); }

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
                  <input type="number" min={1} max={l.stockAvailable} value={l.qty}
                    onChange={e => updateQty(i, parseInt(e.target.value || '1', 10))}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
                </td>
                <td className="py-2 pl-2"><button onClick={() => removeLine(i)}><X className="h-4 w-4 text-slate-400 hover:text-red-500" /></button></td>
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
