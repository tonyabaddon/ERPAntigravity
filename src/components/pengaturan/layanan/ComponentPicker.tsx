import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

interface StockOption {
  sku: string;
  name: string;
  category: string | null;
  total_qty: number;
}

interface Props {
  onPick: (sku: string, name: string) => void;
  onClose: () => void;
}

export default function ComponentPicker({ onPick, onClose }: Props) {
  const [items, setItems] = useState<StockOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('stocks')
        .select('sku, name, category, total_qty')
        .order('name');
      setItems((data ?? []) as StockOption[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--color-caleo-primary)]">
            Pilih Komponen dari Stok
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau SKU…"
            className="w-full border border-slate-200 rounded px-3 py-2 text-caleo-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <div className="text-center py-8 text-caleo-13 text-slate-500">
              Memuat…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-caleo-13 text-slate-500">
              Tidak ada komponen match.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.sku}
                type="button"
                onClick={() => {
                  onPick(item.sku, item.name);
                  onClose();
                }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded border-b border-slate-100 last:border-0"
              >
                <div className="text-caleo-13 font-semibold text-[var(--color-caleo-primary)]">
                  {item.name}
                </div>
                <div className="text-caleo-11 text-slate-500">
                  SKU: {item.sku} · Stok: {item.total_qty}
                  {item.category ? ` · ${item.category}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-caleo-13 font-semibold text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
