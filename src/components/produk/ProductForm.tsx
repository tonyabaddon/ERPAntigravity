// src/components/produk/ProductForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { StockItem, ProductCategory, ProductBrand, ProductUnit, Warehouse, ProductPhoto } from '../../types';
import { registryService, companySettingsService, stockLotsService, approvalService } from '../../lib/supabaseClient';
import { compressImage, uploadProductPhoto, deleteProductPhoto, MAX_PHOTOS } from '../../lib/productPhotoService';
import { specFieldsFor, generateName } from './categorySpecs';
import PreviewCard, { type ProductPreviewState } from './PreviewCard';

interface Props {
  initial?: Partial<StockItem>;
  warehouses: Warehouse[];
  currentUserId: string;
  onCancel: () => void;
  onSubmit: (item: Partial<StockItem>) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function generateSkuId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ValidationError { field: string; message: string; }

function validate(input: {
  category: string; unit: string; price: number; photos: number;
  unitAlt: string | null; unitAltFactor: number | null;
}): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!input.category) errs.push({ field: 'category', message: 'Kategori wajib dipilih' });
  if (!input.unit) errs.push({ field: 'unit', message: 'Satuan wajib dipilih' });
  if (!input.price || input.price <= 0) errs.push({ field: 'price', message: 'Harga Jual harus > 0' });
  if (input.photos < 1) errs.push({ field: 'photos', message: 'Minimal 1 foto produk wajib' });
  // Multi-satuan
  if ((input.unitAlt && !input.unitAltFactor) || (!input.unitAlt && input.unitAltFactor)) {
    errs.push({ field: 'multi_satuan', message: 'Multi-satuan: keduanya harus diisi atau dikosongkan' });
  }
  if (input.unitAlt && input.unitAlt === input.unit) {
    errs.push({ field: 'unit_alt', message: 'Satuan Kedua tidak boleh sama dengan Satuan Utama' });
  }
  if (input.unitAltFactor !== null && input.unitAltFactor <= 1) {
    errs.push({ field: 'unit_alt_factor', message: 'Faktor konversi harus > 1' });
  }
  return errs;
}

export default function ProductForm({ initial, warehouses, currentUserId, onCancel, onSubmit, showToast }: Props) {
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

  // IMPORTANT: Generate a stable SKU at mount so photo uploads land in the right
  // folder BEFORE the user fills in (or auto-generates) the SKU at submit time.
  // User's manually-typed SKU (if any) is used at submit; otherwise this autoSku.
  const [autoSku] = useState(() => generateSkuId());
  const skuForUpload = (sku.trim() || autoSku);

  const [photos, setPhotos] = useState<Array<ProductPhoto & { localUrl?: string; status: 'uploaded' | 'uploading' | 'failed'; progress?: number }>>(
    (initial?.photo_urls ?? []).map(p => ({ ...p, status: 'uploaded' as const }))
  );
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverFiles, setDragOverFiles] = useState(false);

  // ─── Harga & Stok state (Task 2.7) ───
  const [price, setPrice] = useState<number>(initial?.price ?? 0);
  const [hargaModal, setHargaModal] = useState<number | null>(initial?.harga_modal ?? null);
  const [stokAwal, setStokAwal] = useState<number>(0);
  const [gudangTujuanId, setGudangTujuanId] = useState<string | null>(
    warehouses.find(w => w.is_default)?.id ?? null
  );
  const [costingMethod, setCostingMethod] = useState<'FIFO' | 'Average'>('FIFO');
  const [lotsCount, setLotsCount] = useState<number>(0);

  useEffect(() => { void companySettingsService.getCostingMethod().then(setCostingMethod).catch(() => {}); }, []);
  useEffect(() => {
    if (initial?.sku) void stockLotsService.countForSku(initial.sku).then(setLotsCount).catch(() => {});
  }, [initial?.sku]);

  // ─── Pengaturan Lanjutan state (Task 2.8) ───
  const [unitAlt, setUnitAlt] = useState<string | null>(initial?.unit_alt ?? null);
  const [unitAltFactor, setUnitAltFactor] = useState<number | null>(initial?.unit_alt_factor ?? null);
  const [description, setDescription] = useState<string>(initial?.description ?? '');
  const [multiSatuanOn, setMultiSatuanOn] = useState<boolean>(!!initial?.unit_alt);
  const [minStockPerProduct, setMinStockPerProduct] = useState<number | null>(initial?.min_stock_per_product ?? null);

  const hargaModalIsAktual = lotsCount > 0;
  const marginPct = hargaModal && price ? ((price - hargaModal) / price) * 100 : null;

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const uploadedCount = photos.filter(p => p.status === 'uploaded').length;
    const errs = validate({
      category, unit, price, photos: uploadedCount,
      unitAlt, unitAltFactor,
    });
    if (errs.length) {
      showToast(errs[0].message, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const finalSku = sku.trim() || autoSku;
      await onSubmit({
        sku: finalSku,
        name: generateName(category, specs),
        category,
        subcategory: subcategory || null,
        unit,
        unit_alt: unitAlt,
        unit_alt_factor: unitAltFactor,
        price,
        harga_modal: hargaModal,
        description: description || null,
        min_stock_per_product: minStockPerProduct,
        photo_urls: photos.filter(p => p.status === 'uploaded').map(({ url, path, order, uploaded_at }) => ({ url, path, order, uploaded_at })),
        specs,
        initial_stock_approved: stokAwal === 0,
      } as Partial<StockItem>);
      if (stokAwal > 0 && gudangTujuanId) {
        try {
          await approvalService.requestInitialStock({
            sku: finalSku,
            sku_name: generateName(category, specs),
            qty: stokAwal,
            unit,
            warehouse_id: gudangTujuanId,
            requested_cost_per_unit: hargaModal ?? undefined,
          }, currentUserId);
          showToast(`Stok ${stokAwal} ${unit} dikirim ke owner untuk approval`, 'info');
        } catch (e) {
          showToast('Approval gagal: ' + (e as Error).message, 'warning');
        }
      }
      showToast('✅ Produk berhasil ditambahkan');
    } catch (e) {
      showToast('Gagal menyimpan: ' + (e as Error).message, 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFilesPicked(files: FileList | null, targetSku: string) {
    if (!files || files.length === 0) return;
    const slotsAvail = MAX_PHOTOS - photos.length;
    const taken = Array.from(files).slice(0, slotsAvail);
    for (let i = 0; i < taken.length; i++) {
      const file = taken[i];
      const order = photos.length + i;
      const localUrl = URL.createObjectURL(file);
      setPhotos(curr => [...curr, {
        url: '', path: '', order, uploaded_at: '',
        localUrl, status: 'uploading', progress: 0,
      }]);
      try {
        const { blob } = await compressImage(file);
        const { url, path } = await uploadProductPhoto(targetSku, order, blob);
        setPhotos(curr => curr.map(p => p.order === order
          ? { ...p, url, path, uploaded_at: new Date().toISOString(), status: 'uploaded', localUrl: undefined }
          : p));
      } catch (e) {
        showToast('Gagal upload foto: ' + (e as Error).message, 'warning');
        setPhotos(curr => curr.map(p => p.order === order ? { ...p, status: 'failed' } : p));
      }
    }
  }

  async function handleDeletePhoto(order: number) {
    const target = photos.find(p => p.order === order);
    if (target?.path) await deleteProductPhoto(target.path).catch(() => {});
    setPhotos(curr => curr.filter(p => p.order !== order).map((p, i) => ({ ...p, order: i })));
  }

  function reorderPhotos(from: number, to: number) {
    setPhotos(curr => {
      const arr = [...curr];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr.map((p, i) => ({ ...p, order: i }));
    });
  }

  const previewName = useMemo(() => generateName(category, specs), [category, specs]);

  // Preview state — fields wired in Tasks 2.5-2.7; submit handled in 2.9.
  const previewState: ProductPreviewState = {
    name: previewName,
    sku: sku || 'auto',
    category,
    unit,
    price,
    hargaModal,
    stokAwal,
    gudangTujuanId,
    hasPhoto: photos.length > 0,
    thumbnailDataUrl: photos[0]?.url || photos[0]?.localUrl || null,
    isPendingApproval: stokAwal > 0,
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

        {/* Card: Foto Produk */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h5 className="text-sm font-extrabold text-[#012749]">📷 Foto Produk <span className="w-1.5 h-1.5 bg-rose-500 rounded-full inline-block ml-1" /></h5>
              <p className="text-[10.5px] text-slate-500">Min 1 wajib · max 5 · drop dari folder atau drag slot untuk urutan</p>
            </div>
            <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-1">
              {photos.length} / {MAX_PHOTOS} terisi
            </span>
          </div>
          <div
            className={`relative grid grid-cols-12 gap-3 rounded-2xl transition-colors ${dragOverFiles ? 'ring-2 ring-emerald-500 ring-offset-2 bg-emerald-50/60' : ''}`}
            onDragEnter={e => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setDragOverFiles(true);
              }
            }}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
              }
            }}
            onDragLeave={e => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverFiles(false);
            }}
            onDrop={e => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setDragOverFiles(false);
              const allFiles = e.dataTransfer.files;
              const images: File[] = [];
              for (let i = 0; i < allFiles.length; i++) {
                const f = allFiles.item(i);
                if (f && f.type.startsWith('image/')) images.push(f);
              }
              if (images.length === 0) {
                showToast('Hanya file gambar yang didukung', 'warning');
                return;
              }
              const dt = new DataTransfer();
              images.forEach(f => dt.items.add(f));
              handleFilesPicked(dt.files, skuForUpload);
            }}
          >
            {dragOverFiles && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/10 rounded-2xl z-10">
                <div className="bg-white px-4 py-2 rounded-full border-2 border-dashed border-emerald-500 text-[12px] font-extrabold text-emerald-700 uppercase tracking-widest">
                  Lepas untuk upload {photos.length < MAX_PHOTOS ? `(sisa ${MAX_PHOTOS - photos.length} slot)` : '(slot penuh)'}
                </div>
              </div>
            )}
            {/* HERO slot 1 */}
            <div className="col-span-12 sm:col-span-7">
              <PhotoSlot
                photo={photos[0]}
                isThumbnail={true}
                onDelete={() => handleDeletePhoto(0)}
                onPick={files => handleFilesPicked(files, skuForUpload)}
                onDragStart={() => setDraggingIdx(0)}
                onDragOver={() => {}}
                onDrop={() => { if (draggingIdx !== null) reorderPhotos(draggingIdx, 0); setDraggingIdx(null); }}
              />
            </div>
            {/* Small slots 2-5 in 2×2 */}
            <div className="col-span-12 sm:col-span-5 grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <PhotoSlot
                  key={i}
                  photo={photos[i]}
                  isThumbnail={false}
                  onDelete={() => handleDeletePhoto(i)}
                  onPick={files => handleFilesPicked(files, skuForUpload)}
                  onDragStart={() => setDraggingIdx(i)}
                  onDragOver={() => {}}
                  onDrop={() => { if (draggingIdx !== null) reorderPhotos(draggingIdx, i); setDraggingIdx(null); }}
                />
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-500 italic mt-3">
            Min 1 foto wajib — foto pertama jadi thumbnail. Foto akan di-index AI ~5 detik setelah simpan.
          </p>
        </div>

        {/* Card: Harga & Stok */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <h5 className="text-sm font-extrabold text-[#012749] mb-3">💰 Harga & Stok</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Harga Jual (Rp) *</label>
              <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))}
                     className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
              <p className="text-[10px] text-slate-400 pl-1">per {unit}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">
                  {hargaModalIsAktual ? `Harga Modal Aktual (${costingMethod})` : 'Harga Modal Awal'}
                </label>
                <span className={`text-[8.5px] font-black uppercase tracking-widest border rounded-full px-1.5 py-0.5 ${
                  hargaModalIsAktual ? 'text-emerald-700 bg-emerald-100 border-emerald-200' : 'text-amber-700 bg-amber-100 border-amber-200'
                }`}>
                  {hargaModalIsAktual ? '🔒 Dari Pembelian' : 'Estimasi'}
                </span>
              </div>
              <input type="number" value={hargaModal ?? ''} readOnly={hargaModalIsAktual}
                     onChange={e => setHargaModal(e.target.value === '' ? null : Number(e.target.value))}
                     className={`w-full rounded-xl px-3 py-2.5 border text-[13px] font-semibold ${
                       hargaModalIsAktual ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-white border-slate-200'
                     }`} />
              <p className="text-[10px] text-emerald-700 font-bold pl-1">
                {marginPct !== null ? `Margin: ${marginPct.toFixed(1)}%` : 'Margin: —'}
                {!hargaModalIsAktual && ' · akan di-update otomatis dari PO'}
              </p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest mb-2 pl-1">Stok Awal & Penempatan</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Jumlah Stok (opsional)</label>
                <input type="number" value={stokAwal} onChange={e => setStokAwal(Number(e.target.value))}
                       className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Gudang Tujuan</label>
                <select value={gudangTujuanId ?? ''} onChange={e => setGudangTujuanId(e.target.value || null)}
                        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
                  {warehouses.filter(w => w.is_active).map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code}){w.is_default ? ' · Default' : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            {stokAwal > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-600 text-base shrink-0">verified_user</span>
                <div className="flex-1">
                  <p className="text-[11px] font-bold text-amber-900 leading-tight">
                    Stok {stokAwal} {unit} akan dikirim ke owner untuk approval
                  </p>
                  <p className="text-[10px] text-amber-800 mt-0.5 leading-snug">
                    Produk dibuat sekarang & bisa di-edit, tapi stok belum aktif sampai owner approve via WhatsApp/inbox.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card: Pengaturan Lanjutan (collapsible) */}
        <details className="bg-white rounded-3xl border border-[#e5eeff] shadow-sm group">
          <summary className="cursor-pointer p-6 flex items-center gap-3 list-none">
            <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">tune</span>
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-extrabold text-[#012749]">Pengaturan Lanjutan</h5>
              <p className="text-[10.5px] text-slate-500">Multi-satuan, batas stok min, deskripsi — opsional</p>
            </div>
            <span className="material-symbols-outlined text-slate-400 transition group-open:rotate-180">expand_more</span>
          </summary>
          <div className="px-6 pb-6 space-y-4 border-t border-slate-100 pt-4">
            {/* Multi-satuan */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={multiSatuanOn}
                       onChange={e => {
                         const on = e.target.checked;
                         setMultiSatuanOn(on);
                         if (!on) { setUnitAlt(null); setUnitAltFactor(null); }
                       }}
                       className="accent-emerald-600 w-3.5 h-3.5" />
                <span className="text-[11px] font-extrabold text-[#012749]">Aktifkan multi-satuan konversi</span>
              </label>
              {multiSatuanOn && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">1 Paket (Sekunder)</label>
                    <select value={unitAlt ?? ''} onChange={e => setUnitAlt(e.target.value || null)}
                            className="w-full bg-white rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold">
                      <option value="">—</option>
                      {units.filter(u => u.name !== unit).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center justify-center pb-1.5"><span className="text-base font-black text-slate-400">=</span></div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Berapa</label>
                    <input type="number" min={2} value={unitAltFactor ?? ''} onChange={e => setUnitAltFactor(Number(e.target.value) || null)}
                           className="w-full bg-white rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Satuan Utama</label>
                    <input readOnly value={unit} className="w-full bg-slate-100 rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold" />
                  </div>
                  <p className="text-[9.5px] text-blue-800 italic pb-1.5">Stok dilacak per Satuan Utama.</p>
                </div>
              )}
            </div>

            {/* Batas Stok Min */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Batas Stok Min</label>
                <input type="number" value={minStockPerProduct ?? ''}
                       onChange={e => setMinStockPerProduct(e.target.value === '' ? null : Number(e.target.value))}
                       placeholder="kosong = global"
                       className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
                <p className="text-[10px] text-slate-400">Alert kalau stok ≤ angka ini</p>
              </div>
            </div>

            {/* Deskripsi */}
            <div className="space-y-1">
              <div className="flex items-end justify-between">
                <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Deskripsi Produk</label>
                <button type="button" disabled={photos.length === 0}
                        onClick={() => {
                          // Wired in Phase 3 (Task 3.6): backend /describe-product
                          showToast('✨ Generate dari Foto akan tersedia setelah Phase 3', 'info');
                        }}
                        className="text-[10px] font-extrabold text-purple-700 hover:text-purple-900 bg-purple-50 border border-purple-200 rounded-full px-3 py-1 disabled:opacity-50">
                  ✨ Generate dari Foto
                </button>
              </div>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
                        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] resize-none" />
              <p className="text-[10px] text-slate-400 text-right">{description.length} / 500</p>
            </div>
          </div>
        </details>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-full text-xs font-bold">
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold cursor-pointer hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Menyimpan…' : 'Tambahkan Produk'}
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

type PhotoState = ProductPhoto & { localUrl?: string; status: 'uploaded' | 'uploading' | 'failed'; progress?: number };

interface PhotoSlotProps {
  photo?: PhotoState;
  isThumbnail: boolean;
  onDelete: () => void;
  onPick: (files: FileList | null) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

const PhotoSlot: React.FC<PhotoSlotProps> = (p) => {
  if (!p.photo) {
    return (
      <label className="aspect-square rounded-2xl border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center text-emerald-700 cursor-pointer hover:bg-emerald-50/40">
        <span className="material-symbols-outlined text-3xl mb-1">add_a_photo</span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest">Tambah</span>
        <input type="file" accept="image/*" multiple className="hidden"
               onChange={e => p.onPick(e.target.files)} />
      </label>
    );
  }
  const thumb = p.photo.url || p.photo.localUrl;
  return (
    <div
      draggable={p.photo.status === 'uploaded'}
      onDragStart={p.onDragStart}
      onDragOver={e => { e.preventDefault(); p.onDragOver(); }}
      onDrop={e => { e.preventDefault(); p.onDrop(); }}
      className={`relative aspect-square rounded-2xl overflow-hidden border ${p.isThumbnail ? 'border-2 border-emerald-300' : 'border-slate-200'} group`}
    >
      {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-200" />}
      {p.isThumbnail && (
        <div className="absolute top-1.5 left-1.5 bg-emerald-600 text-white text-[8.5px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full">★ Thumbnail</div>
      )}
      {p.photo.status === 'uploading' && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      )}
      {p.photo.status === 'failed' && (
        <div className="absolute inset-x-0 bottom-0 bg-rose-600 text-white text-[8.5px] font-black uppercase tracking-widest px-1 py-0.5 text-center">Upload gagal</div>
      )}
      {p.photo.status === 'uploaded' && (
        <button onClick={p.onDelete}
                className="absolute bottom-1.5 right-1.5 bg-white/95 hover:bg-rose-50 text-rose-600 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      )}
    </div>
  );
};
