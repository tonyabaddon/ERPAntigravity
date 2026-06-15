// src/components/produk/ProductForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { StockItem, ProductCategory, ProductBrand, ProductUnit, Warehouse } from '../../types';
import { registryService } from '../../lib/supabaseClient';
import { specFieldsFor, generateName } from './categorySpecs';
import PreviewCard, { type ProductPreviewState } from './PreviewCard';

interface Props {
  initial?: Partial<StockItem>;
  warehouses: Warehouse[];
  onCancel: () => void;
  onSubmit: (item: Partial<StockItem>) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ProductForm({ initial, warehouses, onCancel, onSubmit, showToast }: Props) {
  void onSubmit; // wired in Task 2.9

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);

  useEffect(() => {
    void Promise.all([
      registryService.listCategories(),
      registryService.listBrands(),
      registryService.listUnits(),
    ]).then(([c, b, u]) => { setCategories(c); setBrands(b); setUnits(u); }).catch(e => {
      showToast('Gagal muat registry: ' + (e as Error).message, 'warning');
    });
  }, [showToast]);

  const topCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subCategoriesOf = (parentName: string) => {
    const parent = topCategories.find(c => c.name === parentName);
    return parent ? categories.filter(c => c.parent_id === parent.id) : [];
  };

  const [sku, setSku] = useState(initial?.sku ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'MCB');
  const [subcategory, setSubcategory] = useState(initial?.subcategory ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? 'pcs');
  const [specs, setSpecs] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial?.specs ?? {}).map(([k, v]) => [k, String(v)]))
  );

  const previewName = useMemo(() => generateName(category, specs), [category, specs]);

  // Placeholder for fields filled in later tasks (2.6-2.9)
  const previewState: ProductPreviewState = {
    name: previewName,
    sku: sku || 'auto',
    category,
    unit,
    price: 0,
    hargaModal: null,
    stokAwal: 0,
    gudangTujuanId: warehouses.find(w => w.is_default)?.id ?? null,
    hasPhoto: false,
    thumbnailDataUrl: null,
    isPendingApproval: false,
  };

  const fields = specFieldsFor(category);

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 lg:col-span-7 space-y-4">
        {/* Card: Identitas */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <h5 className="text-sm font-extrabold text-[#012749] mb-3">📋 Identitas Produk</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CategoryDropdown
              value={category}
              options={topCategories.map(c => c.name)}
              onChange={setCategory}
              onCreateNew={async name => {
                const c = await registryService.addCategory(name);
                setCategories([...categories, c]);
                setCategory(c.name);
                showToast('Kategori "' + name + '" ditambahkan');
              }}
            />
            <SubCategoryDropdown
              value={subcategory ?? ''}
              options={subCategoriesOf(category).map(c => c.name)}
              parentName={category}
              onChange={setSubcategory}
              onCreateNew={async name => {
                const parent = topCategories.find(c => c.name === category);
                const c = await registryService.addCategory(name, parent?.id ?? null);
                setCategories([...categories, c]);
                setSubcategory(c.name);
              }}
            />
            <UnitDropdown
              value={unit}
              options={units.map(u => u.name)}
              onChange={setUnit}
              onCreateNew={async name => {
                const u = await registryService.addUnit(name);
                setUnits([...units, u]);
                setUnit(u.name);
              }}
            />
            <SkuInput value={sku} onChange={setSku} />
          </div>
        </div>

        {/* Card: Spesifikasi (dynamic per category, fallback Aksesori) */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <h5 className="text-sm font-extrabold text-[#012749] mb-3">
            ⚙ Spesifikasi <span className="text-amber-700">{category}</span>
          </h5>
          <SpecForm
            fields={fields}
            specs={specs}
            brands={brands}
            onChange={(k, v) => setSpecs({ ...specs, [k]: v })}
            onAddBrand={async name => {
              const b = await registryService.addBrand(name);
              setBrands([...brands, b]);
            }}
          />
          {/* Auto-name preview pill */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 mt-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-purple-700">Nama Produk</div>
            <div className="text-sm font-extrabold text-purple-900">{previewName || '—'}</div>
          </div>
        </div>

        {/* Tasks 2.6 (Foto), 2.7 (Harga & Stok), 2.8 (Pengaturan Lanjutan) will be added here */}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-full text-xs font-bold">
            Batal
          </button>
          <button
            disabled
            className="px-5 py-2 bg-slate-300 text-white rounded-full text-xs font-bold cursor-not-allowed"
            title="Submit wires up in Task 2.9"
          >
            Tambahkan Produk
          </button>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-5">
        <PreviewCard state={previewState} warehouses={warehouses} />
      </div>
    </div>
  );
}

// --- Inline sub-components ---

function CategoryDropdown(p: { value: string; options: string[]; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Kategori *</label>
      <select
        value={p.value}
        onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold"
      >
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat kategori baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nama kategori"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
          <button onClick={() => { setCreating(false); setNewName(''); }} className="px-3 py-2 text-emerald-700 text-xs">Batal</button>
        </div>
      )}
    </div>
  );
}

function SubCategoryDropdown(p: { value: string; options: string[]; parentName: string; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  void p.parentName;
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Sub-Kategori (opsional)</label>
      <select
        value={p.value}
        onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold"
      >
        <option value="">— Tidak ada —</option>
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat sub-kategori baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nama sub-kategori"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
        </div>
      )}
    </div>
  );
}

function UnitDropdown(p: { value: string; options: string[]; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Satuan *</label>
      <select value={p.value} onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat satuan baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Mis: kg, lembar"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
        </div>
      )}
    </div>
  );
}

function SkuInput(p: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Kode / SKU</label>
      <input value={p.value} onChange={e => p.onChange(e.target.value)}
             placeholder="Kosongkan untuk auto"
             className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
    </div>
  );
}

function SpecForm(p: {
  fields: import('./categorySpecs').SpecFieldDef[];
  specs: Record<string, string>;
  brands: ProductBrand[];
  onChange: (k: string, v: string) => void;
  onAddBrand: (name: string) => Promise<void>;
}) {
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {p.fields.map(f => {
        const isMcbMerek = f.key === 'mcb_merek';
        const options = isMcbMerek ? p.brands.map(b => b.name) : (f.options ?? []);
        if (f.type === 'select') {
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">
                {f.label}{f.required && ' *'}
              </label>
              <select value={p.specs[f.key] ?? ''}
                      onChange={e => { if (e.target.value === '__new_brand__') setAddingBrand(true); else p.onChange(f.key, e.target.value); }}
                      className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
                <option value="">—</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
                {isMcbMerek && <option value="__new_brand__">+ Tambah merek baru…</option>}
              </select>
              {isMcbMerek && addingBrand && (
                <div className="flex gap-2 mt-1">
                  <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Merek baru"
                         className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
                  <button onClick={async () => { await p.onAddBrand(newBrand); setAddingBrand(false); setNewBrand(''); }}
                          className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
                </div>
              )}
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">{f.label}{f.required && ' *'}</label>
              <input type="number" value={p.specs[f.key] ?? ''} onChange={e => p.onChange(f.key, e.target.value)}
                     className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
            </div>
          );
        }
        // text
        return (
          <div key={f.key} className="space-y-1 sm:col-span-3">
            <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">{f.label}{f.required && ' *'}</label>
            <input type="text" value={p.specs[f.key] ?? ''} onChange={e => p.onChange(f.key, e.target.value)}
                   className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
          </div>
        );
      })}
    </div>
  );
}
