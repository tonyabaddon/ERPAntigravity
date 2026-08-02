import { useState } from 'react';
import type { SupabaseStockItem } from '../../../lib/supabaseClient';
import { insertNewProduct } from '../../../lib/products/productWrappers';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import {
  validateNewProductForm,
  parsePriceLike,
  type NewProductFormState,
} from '../../../lib/wizard/newProductValidation';

interface Props {
  onSaved: (product: SupabaseStockItem) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  existingCategories: string[];
}

const COMMON_UNITS = ['pcs', 'm', 'rol', 'box', 'set', 'kg'];

export default function NewProductInlineForm(props: Props) {
  const [state, setState] = useState<NewProductFormState>({
    name: '', category: '', price: '', hppText: '', unit: 'pcs',
  });
  const [subcategory, setSubcategory] = useState('');
  const [brand, setBrand] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Build category options from existing + always show "+ Kategori baru..."
  const categoryOptions = Array.from(new Set([...props.existingCategories])).sort();

  const validation = validateNewProductForm(state);

  const onSubmit = async () => {
    if (!validation.ok) {
      props.showToast(validation.errors[0], 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const price = parsePriceLike(state.price);
      const hpp = state.hppText.trim().length > 0 ? parsePriceLike(state.hppText) : undefined;
      const product = await insertNewProduct({
        name: state.name,
        category: state.category,
        price,
        harga_modal: hpp,
        unit: state.unit,
        subcategory: subcategory.trim() || undefined,
        brand: brand.trim() || undefined,
      });
      props.showToast(`Produk baru tersimpan: ${product.name}`, 'success');
      props.onSaved(product);
    } catch (e) {
      const msg = extractErrorMessage(e);
      props.showToast(`Gagal simpan produk: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-2 border-[var(--color-caleo-primary)]/30 rounded p-4 bg-[var(--color-caleo-primary)]/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-extrabold text-[var(--color-caleo-primary)]">Produk Baru</div>
          <div className="text-[11px] text-slate-600">Akan tersimpan ke daftar Produk &amp; Stok dengan stok awal 0.</div>
        </div>
        <button type="button" onClick={props.onCancel} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-2">
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama Produk <span className="text-red-500">*</span></label>
          <input value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            placeholder="Mis: MCB Schneider 25A 1P"
            className="w-full px-3 py-2 border border-slate-300 rounded" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Kategori <span className="text-red-500">*</span></label>
          <input list="np-cat-options" value={state.category}
            onChange={(e) => setState((s) => ({ ...s, category: e.target.value }))}
            placeholder="Mis: MCB"
            className="w-full px-3 py-2 border border-slate-300 rounded" />
          <datalist id="np-cat-options">
            {categoryOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Unit</label>
          <select value={state.unit}
            onChange={(e) => setState((s) => ({ ...s, unit: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded">
            {COMMON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Harga Jual (Rp) <span className="text-red-500">*</span></label>
          <input value={state.price}
            onChange={(e) => setState((s) => ({ ...s, price: e.target.value }))}
            placeholder="Mis: 45.000"
            className="w-full px-3 py-2 border border-slate-300 rounded" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Harga Modal / HPP (Rp)</label>
          <input value={state.hppText}
            onChange={(e) => setState((s) => ({ ...s, hppText: e.target.value }))}
            placeholder="Optional · recommend isi"
            className="w-full px-3 py-2 border border-slate-300 rounded" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Sub-kategori / Brand (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)}
              placeholder="Sub-kategori" className="w-full px-3 py-2 border border-slate-300 rounded" />
            <input value={brand} onChange={(e) => setBrand(e.target.value)}
              placeholder="Brand" className="w-full px-3 py-2 border border-slate-300 rounded" />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-amber-700 mt-3 italic">
        ⚠️ Ini lite-create — foto, specs lengkap, min stock, dll. bisa di-set nanti via menu <strong>Produk &amp; Stok</strong>. Stok awal 0 (semua gudang) — pesanan ini otomatis pre-order sampai pembelian masuk.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={props.onCancel} disabled={submitting}
          className="px-3 py-1.5 text-xs font-semibold rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
        <button type="button" onClick={onSubmit} disabled={!validation.ok || submitting}
          className="px-4 py-1.5 text-xs font-bold rounded bg-[var(--color-caleo-primary)] text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Menyimpan…' : '✓ Simpan & Tambah ke Cart'}
        </button>
      </div>
    </div>
  );
}
