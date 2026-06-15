/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Save } from 'lucide-react';
import { StockItem, ApprovalRequest } from '../types';
import { isSupabaseConfigured, listPendingApprovals, companySettingsService } from '../lib/supabaseClient';
import { useWarehouses } from '../hooks/useWarehouses';
import WarehouseTransferModal from './WarehouseTransferModal';
import StockAdjustmentModal from './stok/StockAdjustmentModal';
import PriceChangeRequestModal from './stok/PriceChangeRequestModal';
import PendingApprovalBadge from './approval/PendingApprovalBadge';
import BulkUploadSection from './produk/BulkUploadSection';
import StockTableView from './produk/StockTableView';

interface StockManagerScreenProps {
  stockList: StockItem[];
  onStockUpdate: (updated: StockItem[]) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  currentUser?: { id: string; name: string; role: string } | null;
  onNavigateToOpname?: () => void;
}

type SpecFieldDef = {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text';
  options?: string[];
  required?: boolean;
};

const CATEGORY_SPECS: Record<string, SpecFieldDef[]> = {
  Panel: [
    { key: 'material', label: 'Material', type: 'select', options: ['Besi', 'Stainless SS304', 'Stainless SS316', 'Aluminium', 'PVC'], required: true },
    { key: 'tipe_pasang', label: 'Tipe Pemasangan', type: 'select', options: ['Indoor', 'Outdoor'], required: true },
    { key: 'ketebalan_mm', label: 'Ketebalan Plat', type: 'select', options: ['1', '1.2', '1.5', '1.8', '2', '3'] },
    { key: 'finishing', label: 'Finishing', type: 'select', options: ['RAL7032', 'Warna Khusus'] },
    { key: 'tinggi_cm', label: 'Tinggi (cm)', type: 'number', required: true },
    { key: 'lebar_cm', label: 'Lebar (cm)', type: 'number', required: true },
    { key: 'tebal_cm', label: 'Tebal (cm)', type: 'number', required: true },
    { key: 'kelengkapan', label: 'Kelengkapan', type: 'select', options: ['Kosong', 'Dengan Komponen + Rakit'] },
  ],
  MCB: [
    { key: 'mcb_merek', label: 'Merek', type: 'select', options: ['Schneider', 'ABB', 'Chint', 'Hager', 'LS'], required: true },
    { key: 'mcb_ampere', label: 'Ampere (A)', type: 'number', required: true },
    { key: 'mcb_phase', label: 'Phase', type: 'select', options: ['1P', '2P', '3P'], required: true },
  ],
  Kabel: [
    { key: 'kabel_tipe', label: 'Tipe Kabel', type: 'select', options: ['NYM', 'NYA', 'NYY', 'NYFGBY', 'AAAC'], required: true },
    { key: 'kabel_mm2', label: 'mm²', type: 'number', required: true },
    { key: 'kabel_panjang', label: 'Panjang', type: 'text', required: true },
  ],
  Aksesori: [
    { key: 'deskripsi', label: 'Deskripsi Produk', type: 'text', required: true },
  ],
};

function generateName(category: string, specs: Record<string, string>): string {
  switch (category) {
    case 'Panel': {
      const { material = '', tipe_pasang = '', tinggi_cm = '', lebar_cm = '', tebal_cm = '', ketebalan_mm = '', finishing = '', kelengkapan = '' } = specs;
      const dims = (tinggi_cm && lebar_cm && tebal_cm) ? `${tinggi_cm}×${lebar_cm}×${tebal_cm}cm` : '';
      const thickness = ketebalan_mm ? `${ketebalan_mm}mm` : '';
      return ['Panel', material, tipe_pasang, dims, thickness, finishing, kelengkapan].filter(Boolean).join(' ');
    }
    case 'MCB': {
      const { mcb_merek = '', mcb_ampere = '', mcb_phase = '' } = specs;
      const ampere = mcb_ampere ? `${mcb_ampere}A` : '';
      return ['MCB', mcb_merek, ampere, mcb_phase].filter(Boolean).join(' ');
    }
    case 'Kabel': {
      const { kabel_tipe = '', kabel_mm2 = '', kabel_panjang = '' } = specs;
      const mm2 = kabel_mm2 ? `${kabel_mm2}mm²` : '';
      return ['Kabel', kabel_tipe, mm2, kabel_panjang].filter(Boolean).join(' ');
    }
    case 'Aksesori':
      return specs.deskripsi || '';
    default:
      return '';
  }
}

const PILL_COLORS: Record<string, string> = {
  Panel: 'bg-blue-100 text-blue-900',
  MCB: 'bg-amber-100 text-amber-900',
  Kabel: 'bg-emerald-100 text-emerald-900',
  Aksesori: 'bg-slate-100 text-slate-700',
};

function generateSkuId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function renderSpecForm(
  category: string,
  specs: Record<string, string>,
  onChange: (key: string, val: string) => void
): React.ReactNode {
  const fields = CATEGORY_SPECS[category] || [];
  const gridClass = fields.length >= 6
    ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4'
    : fields.length >= 2
      ? 'grid-cols-1 sm:grid-cols-3'
      : 'grid-cols-1';
  return (
    <div className={`grid ${gridClass} gap-4`}>
      {fields.map(field => (
        <div key={field.key} className="space-y-1">
          <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          {field.type === 'select' ? (
            <select
              value={specs[field.key] ?? field.options?.[0] ?? ''}
              onChange={e => onChange(field.key, e.target.value)}
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            >
              {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={field.type}
              value={specs[field.key] ?? ''}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.label}
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function StockManagerScreen({ stockList, onStockUpdate, showToast, currentUser, onNavigateToOpname }: StockManagerScreenProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState('Panel');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('');
  const [newSpecs, setNewSpecs] = useState<Record<string, string>>({});

  const [transferItem, setTransferItem] = useState<StockItem | null>(null);

  const { warehouses } = useWarehouses();

  // Phase 2: approval-gated cell editing
  const [adjustmentTarget, setAdjustmentTarget] = useState<{ item: StockItem; warehouseId: string } | null>(null);
  const [priceTarget, setPriceTarget] = useState<{ item: StockItem; field: 'price' | 'harga_modal' } | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingRefreshTick, setPendingRefreshTick] = useState(0);
  // Company name is loaded from company_settings so the CSV filename
  // matches Pengaturan instead of the hardcoded "Sinar_Elektrik" that
  // shipped originally (2026-06-12 e2e audit). Falls back to a generic
  // label if the row isn't reachable.
  const [companyName, setCompanyName] = useState<string>('Stok');

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPendingApprovals();
        if (!cancelled) setPendingApprovals(rows);
      } catch {
        // silent: pending badges are non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [pendingRefreshTick]);

  // One-shot company-name fetch for the CSV filename. Done separately from
  // the pending-approvals effect so the latter's tick doesn't refetch.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await companySettingsService.fetch();
        if (cancelled) return;
        if (row?.company_name && row.company_name.trim()) setCompanyName(row.company_name.trim());
      } catch {
        // silent: hardcoded fallback used
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshPending = () => setPendingRefreshTick((n) => n + 1);

  const myPendingCount = useMemo(() => {
    if (!currentUser) return 0;
    return pendingApprovals.filter((r) => r.requestedBy === currentUser.id).length;
  }, [pendingApprovals, currentUser]);

  /**
   * Index pending approvals so cell renderers can ask in O(1) whether a
   * specific (sku, warehouse) or (sku, field) tuple has a pending request.
   */
  const pendingIndex = useMemo(() => {
    const adjMap = new Map<string, number>(); // key: `${sku}|${warehouse}`
    const priceMap = new Map<string, number>(); // key: `${sku}|${field}`
    for (const r of pendingApprovals) {
      const payload = r.payload ?? {};
      const sku = typeof payload.sku === 'string' ? payload.sku : null;
      if (!sku) continue;
      if (r.requestType === 'adjustment') {
        const wh = payload.warehouse;
        if (wh === 'atas' || wh === 'bawah') {
          const k = `${sku}|${wh}`;
          adjMap.set(k, (adjMap.get(k) ?? 0) + 1);
        }
      } else if (r.requestType === 'price_change') {
        const f = payload.field;
        if (f === 'price' || f === 'harga_modal') {
          const k = `${sku}|${f}`;
          priceMap.set(k, (priceMap.get(k) ?? 0) + 1);
        }
      }
    }
    return { adjMap, priceMap };
  }, [pendingApprovals]);

  const handleInlineSave = async (updatedItem: StockItem) => {
    const next: StockItem = {
      ...updatedItem,
      status: updatedItem.stock < 10 ? 'Stok Tipis' : 'Sinkron',
    };
    const updated = stockList.map(i => (i.sku === next.sku ? next : i));
    onStockUpdate(updated);
  };

  const handleDeleteItem = (sku: string) => {
    onStockUpdate(stockList.filter(item => item.sku !== sku));
    showToast('🗑️ Produk berhasil dihapus.');
  };

  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrice || !newStock) {
      showToast('⚠️ Mohon isi harga dan stok!', 'warning');
      return;
    }
    const sku = generateSkuId();
    const name = generateName(newCategory, newSpecs);
    if (!name) {
      showToast('⚠️ Mohon lengkapi spesifikasi produk!', 'warning');
      return;
    }
    const price = parseInt(newPrice.replace(/\D/g, '')) || 0;
    const stock = parseInt(newStock) || 0;
    const newItem: StockItem = {
      sku,
      name,
      category: newCategory,
      price,
      stock,
      status: stock < 10 ? 'Stok Tipis' : 'Sinkron',
      specs: newSpecs,
    };
    onStockUpdate([newItem, ...stockList]);
    setShowAddForm(false);
    setNewPrice('');
    setNewStock('');
    setNewSpecs({});
    setNewCategory('Panel');
    showToast(`🎉 Produk "${name}" berhasil ditambahkan.`);
  };

  const previewName = generateName(newCategory, newSpecs);

  return (
    <div className="space-y-8 animate-fadeIn pb-24">

      {/* Phase 2 banner: my pending requests */}
      {myPendingCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 text-sm text-yellow-900 flex items-center gap-3">
          <PendingApprovalBadge count={myPendingCount} size="md" tooltip="Permintaan Anda yang menunggu Owner" />
          <span className="font-semibold">
            Permintaan Anda yang menunggu: {myPendingCount} sedang menunggu persetujuan Owner.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-6 rounded-[2.5rem] border border-[#e5eeff] shadow-lg">
        <div>
          <span className="text-[10px] font-black tracking-widest text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3.5 py-1 rounded-full">
            Infrastruktur Backend
          </span>
          <h2 className="text-xl font-black text-[#012749] tracking-tight mt-2.5">
            Manajemen Inventaris Stok &amp; Harga
          </h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            Ubah harga atau modifikasi volume stok produk kelistrikan secara instan.
          </p>
        </div>
        {isSupabaseConfigured ? (
          <div className="bg-emerald-50/80 border border-emerald-200/60 px-5 py-3 rounded-2xl flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <div>
              <span className="text-[9px] font-black text-emerald-600 block uppercase tracking-wider">STATUS KONEKSI</span>
              <span className="text-xs font-black text-emerald-950">Terhubung ke Supabase Cloud DB</span>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50/80 border border-amber-200/60 px-5 py-3 rounded-2xl flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </span>
            <div>
              <span className="text-[9px] font-black text-amber-600 block uppercase tracking-wider">DATABASE SINKRONISASI</span>
              <span className="text-xs font-bold text-amber-950">Mode Demo (Penyimpanan Lokal Aktif)</span>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Upload */}
      <BulkUploadSection
        stockList={stockList}
        companyName={companyName}
        showToast={showToast}
        onStockUpdate={onStockUpdate}
        onUploaded={refreshPending}
      />

      {/* Add Form (kept in parent for now — Task 2.11 will replace with ProductForm) */}
      {showAddForm && (
        <section className="bg-slate-50 border border-[#abc9f3] p-6 rounded-3xl shadow-inner animate-slideUp">
          <h4 className="font-extrabold text-[#012749] text-sm flex items-center gap-1.5 mb-4">
            <PlusCircle className="w-4 h-4 text-[#2d8a4e]" /> Tambah Barang Baru
          </h4>
          <form onSubmit={handleAddNewItem}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest pl-1">
                  SKU <span className="text-purple-400 text-[8px] font-black">auto</span>
                </label>
                <input
                  readOnly
                  value="Akan dibuat otomatis oleh sistem"
                  className="w-full bg-slate-100 rounded-xl px-3 py-2 border border-dashed border-slate-300 text-[10px] font-semibold text-slate-400 italic outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                  Kategori <span className="text-rose-500">*</span>
                </label>
                <select
                  value={newCategory}
                  onChange={e => {
                  const cat = e.target.value;
                  setNewCategory(cat);
                  const defaultSpecs: Record<string, string> = {};
                  (CATEGORY_SPECS[cat] || []).forEach(f => {
                    if (f.type === 'select' && f.options?.[0]) defaultSpecs[f.key] = f.options[0];
                  });
                  setNewSpecs(defaultSpecs);
                }}
                  className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                >
                  <option value="Panel">Panel</option>
                  <option value="MCB">MCB</option>
                  <option value="Kabel">Kabel</option>
                  <option value="Aksesori">Aksesori</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                  Harga (Rp) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  placeholder="850000"
                  className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                  Stok (Pcs) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={newStock}
                  onChange={e => setNewStock(e.target.value)}
                  placeholder="24"
                  className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                />
              </div>
            </div>

            <div className="mb-4 space-y-1">
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest pl-1">
                Nama Produk <span className="text-purple-400 text-[8px] font-black">auto dari spek</span>
              </label>
              <input
                readOnly
                value={previewName || 'Otomatis dari spesifikasi di bawah...'}
                className="w-full bg-purple-50 rounded-xl px-3 py-2 border border-purple-200 text-xs font-bold text-purple-700 outline-none"
              />
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[8.5px] font-black uppercase tracking-widest px-3 py-1 bg-blue-100 text-blue-800 rounded-full">
                ⚙ Spesifikasi {newCategory}
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {renderSpecForm(newCategory, newSpecs, (key, val) => setNewSpecs(prev => ({ ...prev, [key]: val })))}

            <div className="flex justify-end gap-2 pt-4">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 border border-rose-200 text-rose-600 rounded-full text-xs font-bold hover:bg-rose-50 cursor-pointer">Batal</button>
              <button type="submit" className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 cursor-pointer">+ Tambahkan Produk</button>
            </div>
          </form>
        </section>
      )}

      {/* Stock Table */}
      <StockTableView
        stockList={stockList}
        warehouses={warehouses}
        currentUser={currentUser}
        pendingIndex={pendingIndex}
        onDelete={handleDeleteItem}
        onTransfer={(item) => setTransferItem(item)}
        onInlineUpdate={handleInlineSave}
        onRequestPriceChange={(item, field) => setPriceTarget({ item, field })}
        onRequestAdjustment={(item, warehouseId) => setAdjustmentTarget({ item, warehouseId })}
        onOpname={onNavigateToOpname}
        showToast={showToast}
      />

      {!showAddForm && (
        <button
          onClick={() => {
            const defaultSpecs: Record<string, string> = {};
            (CATEGORY_SPECS[newCategory] || []).forEach(f => {
              if (f.type === 'select' && f.options?.[0]) defaultSpecs[f.key] = f.options[0];
            });
            setNewSpecs(defaultSpecs);
            setShowAddForm(true);
          }}
          className="w-full py-5 border-2 border-dashed border-slate-200 hover:border-[#1e3d60]/40 rounded-2xl text-xs font-black text-[#1e3d60] hover:bg-slate-50 transition-all flex items-center justify-center gap-2 group cursor-pointer bg-white"
        >
          <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300 text-[#2d8a4e]" />
          Tambah Baris Barang Baru
        </button>
      )}

      <button
        onClick={() => {
          localStorage.setItem('sinar_elektrik_stocks', JSON.stringify(stockList));
          showToast('💾 Berhasil Menyimpan Semua Perubahan Inventaris!');
        }}
        className="fixed bottom-10 right-10 bg-[#2d8a4e] text-white px-10 py-5 rounded-full shadow-[0_20px_50px_rgba(45,138,78,0.3)] hover:shadow-[0_25px_60px_rgba(45,138,78,0.4)] transition-all duration-300 hover:-translate-y-1.5 flex items-center gap-2.5 z-50 cursor-pointer text-sm font-extrabold uppercase tracking-wide"
      >
        <Save className="w-5 h-5 text-emerald-200" />
        Simpan Semua Perubahan
      </button>

      {transferItem && (
        <WarehouseTransferModal
          item={transferItem}
          onClose={() => setTransferItem(null)}
          onTransferred={() => {
            setTransferItem(null);
            showToast('✅ Transfer stok berhasil.');
          }}
          showToast={showToast}
        />
      )}

      {adjustmentTarget && (
        <StockAdjustmentModal
          item={adjustmentTarget.item}
          warehouseId={adjustmentTarget.warehouseId}
          currentUser={currentUser ?? null}
          onClose={() => setAdjustmentTarget(null)}
          onSubmitted={refreshPending}
          showToast={showToast}
        />
      )}

      {priceTarget && (
        <PriceChangeRequestModal
          item={priceTarget.item}
          field={priceTarget.field}
          currentUser={currentUser ?? null}
          onClose={() => setPriceTarget(null)}
          onSubmitted={refreshPending}
          showToast={showToast}
        />
      )}
    </div>
  );
}
