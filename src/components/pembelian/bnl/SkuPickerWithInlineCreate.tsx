// SkuPickerWithInlineCreate — search SKU master + quick-create new SKU
// (category='Pass-through', stock=0, harga_modal=unit_cost hint).
import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import type { StockItem } from '../../../types';
import { NumberInput } from '../../ui/NumberInput';

interface Props {
  value: { sku: string; name: string; sell_price?: number } | null;
  unitCostHint?: number;
  onChange: (v: { sku: string; name: string; sell_price?: number } | null) => void;
}

export default function SkuPickerWithInlineCreate({ value, unitCostHint, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockItem[]>([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSellPrice, setDraftSellPrice] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2 || !supabase) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase!.from('stocks')
        .select('*').or(`sku.ilike.%${query}%,name.ilike.%${query}%`)
        .order('name', { ascending: true }).limit(20);
      setResults((data ?? []) as StockItem[]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function handleCreate() {
    if (!supabase || !draftName.trim()) return;
    setSaving(true);
    try {
      const skuCode = draftName.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || `BNL-${Date.now()}`;
      // Route through admin_upsert_product SD RPC (migration 20260910000009):
      // direct .insert() no longer writes value-bearing columns like price /
      // harga_modal from the anon+authenticated client roles.
      const { error } = await supabase.rpc('admin_upsert_product', {
        p_input: {
          sku: skuCode,
          name: draftName.trim(),
          category: 'Pass-through',
          price: draftSellPrice,
          stock: 0,
          status: 'active',
          harga_modal: unitCostHint ?? null,
        },
      });
      if (error) throw error;
      onChange({ sku: skuCode, name: draftName.trim(), sell_price: draftSellPrice });
      setShowCreate(false);
      setDraftName('');
      setDraftSellPrice(0);
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{value.sku}</span>
        <span className="text-sm flex-1">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-red-500">×</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Cari SKU atau nama barang..."
          className="w-full text-sm py-2 pl-9 pr-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500" />
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      </div>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto bg-white rounded-sm border border-gray-200 shadow-lg">
          {results.map(s => (
            <button key={s.sku} type="button" onMouseDown={() => { onChange({ sku: s.sku, name: s.name, sell_price: s.price }); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-2">
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{s.sku}</span>
                <span className="text-sm">{s.name}</span>
              </div>
            </button>
          ))}
          <button type="button" onMouseDown={(e) => { e.preventDefault(); setDraftName(query); setShowCreate(true); }}
            className="w-full text-left px-3 py-2 text-indigo-700 font-semibold text-sm hover:bg-indigo-50 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Buat SKU baru cepat: <span className="font-bold">"{query || '...'}"</span>
          </button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-sm border border-gray-200 shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm mb-3" style={{ color: '#012749' }}>Buat SKU baru cepat</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Nama barang</label>
                <input value={draftName} onChange={e => setDraftName(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Harga jual (Rp)</label>
                <NumberInput value={draftSellPrice} onChange={setDraftSellPrice}
                  className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300" />
              </div>
              <div className="text-[11px] text-gray-500">
                Kategori = "Pass-through" • Stok = 0 • HPP = harga beli grosir yang diketik di form.
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm px-3 py-2 rounded-sm border border-gray-200 text-gray-600">Batal</button>
              <button type="button" onClick={handleCreate} disabled={saving || !draftName.trim()}
                className="text-sm px-3 py-2 rounded-sm text-white font-semibold disabled:opacity-50"
                style={{ background: '#012749' }}>
                {saving ? 'Membuat...' : 'Buat & Pilih'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
