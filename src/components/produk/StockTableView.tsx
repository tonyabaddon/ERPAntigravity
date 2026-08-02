/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  Search, ChevronDown, ChevronUp, AlertTriangle, CheckCircle,
  Trash2, ClipboardCheck,
} from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { StockItem, Warehouse, DbTenantSettings } from '../../types';
import PendingApprovalBadge from '../approval/PendingApprovalBadge';
import { NumberInput } from '../ui/NumberInput';
import { InTransitChip } from '../warehouseTransfer/InTransitChip';
import { formatIDR } from '../../lib/formatIDR';
import { getActiveTiers, type TierKey } from '../../lib/pricing/getActiveTiers';
import QtyTiersEditor from './QtyTiersEditor';

// TODO(Task 2.11): consolidate CATEGORY_SPECS / generateName / renderSpecForm
// with ProductForm + StockManagerScreen. Duplicated here during Phase 2 split
// because the add form in the parent still uses the same helpers.
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
          <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest pl-1">
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          {field.type === 'select' ? (
            <select
              value={specs[field.key] ?? field.options?.[0] ?? ''}
              onChange={e => onChange(field.key, e.target.value)}
              className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
            >
              {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={field.type}
              value={specs[field.key] ?? ''}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.label}
              className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export interface StockTableViewPendingIndex {
  adjMap: Map<string, number>;
  priceMap: Map<string, number>;
}

interface Props {
  stockList: StockItem[];
  warehouses: Warehouse[];
  currentUser?: { id: string; name: string; role: string } | null;
  pendingIndex: StockTableViewPendingIndex;
  onDelete: (sku: string) => void;
  onTransfer: (item: StockItem) => void;
  /** Persist inline edit (price/harga_modal/specs/name) for one item. */
  onInlineUpdate: (item: StockItem) => Promise<void> | void;
  onRequestPriceChange: (item: StockItem, field: 'price' | 'harga_modal') => void;
  onRequestAdjustment: (item: StockItem, warehouseId: string) => void;
  onOpname?: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /** Show only items with stock <= threshold (for Stok Tipis tab). */
  thinOnly?: boolean;
  thinThreshold?: number;
  /** Show Harga Grosir column + inline edit field (driven by modul_multi_tier_price). */
  showGrosir?: boolean;
  /** Full tenant settings — used to render tier_3/tier_4 columns when tiers are active. */
  tenantSettings?: DbTenantSettings | null;
  /** Called after a qty-tier edit is saved so the parent can refetch stock data. */
  onDataChanged?: () => void;
}

export default function StockTableView({
  stockList,
  warehouses,
  currentUser,
  pendingIndex,
  onDelete,
  onTransfer,
  onInlineUpdate,
  onRequestPriceChange,
  onRequestAdjustment,
  onOpname,
  showToast,
  thinOnly = false,
  thinThreshold = 5,
  showGrosir = false,
  tenantSettings,
  onDataChanged,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua Produk');
  // Phase 2: qty-tier modal state — null = closed; string = SKU being edited
  const [editingVolSku, setEditingVolSku] = useState<string | null>(null);

  // extraTiers: tier_3 and tier_4 when active (slot >= 3)
  const extraTiers = tenantSettings ? getActiveTiers(tenantSettings).filter(t => t.slot >= 3) : [];

  const [editingSkus, setEditingSkus] = useState<Set<string>>(new Set());
  const [editValues, setEditValues] = useState<Record<string, { price: string; harga_modal: number | null; price_grosir: number | null; tier_prices: Partial<Record<TierKey, number | null>>; specs: Record<string, string> }>>({});

  const uniqueCategories = useMemo(
    () => ['Semua Produk', 'Panel', 'MCB', 'Kabel', 'Aksesori'],
    []
  );

  const filtered = useMemo(() => stockList.filter(item => {
    if (thinOnly && item.stock > (item.min_stock_per_product ?? thinThreshold)) return false;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua Produk' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }), [stockList, searchQuery, selectedCategory, thinOnly, thinThreshold]);

  const startEdit = (item: StockItem) => {
    setEditingSkus(prev => new Set([...prev, item.sku]));
    const tier_prices: Partial<Record<TierKey, number | null>> = {};
    extraTiers.forEach(t => {
      if (t.slot === 3) tier_prices['tier_3'] = item.price_tier_3 ?? null;
      if (t.slot === 4) tier_prices['tier_4'] = item.price_tier_4 ?? null;
    });
    setEditValues(prev => ({
      ...prev,
      [item.sku]: {
        price: String(item.price),
        harga_modal: item.harga_modal ?? null,
        price_grosir: item.price_grosir ?? null,
        tier_prices,
        specs: Object.fromEntries(
          Object.entries(item.specs ?? {}).map(([k, v]) => [k, String(v)])
        ),
      },
    }));
  };

  const cancelEdit = (sku: string) => {
    setEditingSkus(prev => { const s = new Set(prev); s.delete(sku); return s; });
  };

  const saveEdit = async (sku: string) => {
    const vals = editValues[sku];
    if (!vals) return;
    const item = stockList.find(i => i.sku === sku);
    if (!item) return;
    const price = parseInt(vals.price.replace(/\D/g, '')) || 0;
    const name = generateName(item.category, vals.specs);
    if (!name) {
      showToast('⚠️ Mohon lengkapi spesifikasi produk!', 'warning');
      return;
    }
    const updated: StockItem = {
      ...item,
      price,
      harga_modal: vals.harga_modal ?? null,
      price_grosir: vals.price_grosir ?? null,
      price_tier_3: vals.tier_prices['tier_3'] ?? null,
      price_tier_4: vals.tier_prices['tier_4'] ?? null,
      specs: vals.specs,
      name,
    };
    await onInlineUpdate(updated);
    cancelEdit(sku);
    showToast('✅ Produk berhasil diperbarui.');
  };

  return (
    <>
    <section className="bg-white rounded-[2.5rem] p-8 border border-[var(--color-caleo-mist)] shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-3xl">edit_note</span>
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-[var(--color-caleo-primary)] leading-tight">Modifikasi Cepat / Edit Satu per Satu</h3>
            <p className="text-xs text-[#43474e] mt-1">Klik Edit untuk mengubah spesifikasi. Harga &amp; stok bisa langsung diedit di tabel.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {onOpname && (
            <button
              type="button"
              onClick={onOpname}
              className="px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full text-xs font-extrabold uppercase tracking-wider hover:bg-emerald-100 cursor-pointer inline-flex items-center gap-2"
            >
              <ClipboardCheck className="w-4 h-4" />
              Stok Opname
            </button>
          )}
          <div className="relative min-w-[260px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari SKU atau nama barang..."
              className="w-full pl-12 pr-4 py-3 bg-[var(--color-caleo-cloud)] rounded-full border-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-bold text-slate-800 outline-none"
            />
            <Search className="w-4 h-4 text-[#43474e]/60 absolute left-4 top-1/2 -translate-y-1/2" />
          </div>
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="pl-6 pr-12 py-3 bg-[var(--color-caleo-cloud)] rounded-full border-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-black text-[#1e3d60] appearance-none cursor-pointer outline-none w-full"
            >
              {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Stock rows */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {filtered.length === 0 ? (
          <EmptyState message="Tidak ada produk yang cocok dengan filter pencarian." />
        ) : filtered.map((item, index) => {
          const isEditing = editingSkus.has(item.sku);
          const vals = editValues[item.sku];
          const isWarning = item.stock < 10;
          const pillColor = PILL_COLORS[item.category] ?? PILL_COLORS.Aksesori;
          const specEntries = Object.entries(item.specs ?? {});

          return (
            <div key={`${item.sku}-${index}`}>
              <div className={`flex flex-col md:flex-row items-stretch md:items-center gap-4 p-5 rounded transition-all duration-300 border ${isEditing ? 'bg-blue-50 border-blue-200 rounded-b-none' : 'bg-[var(--color-caleo-cloud)]/60 hover:bg-white hover:shadow-xl border-transparent hover:border-slate-100'} group`}>
                <div className="w-28 shrink-0">
                  <div className="text-caleo-10 font-mono font-bold text-slate-500">{item.category}</div>
                  <div className="text-caleo-9 font-mono text-slate-400">#{item.sku.slice(0, 8)}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[var(--color-caleo-primary)] truncate">{item.name}</p>
                  {specEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {specEntries.slice(0, 6).map(([k, v]) => (
                        <span key={k} className={`text-caleo-9 font-black uppercase px-2 py-0.5 rounded-full ${pillColor}`}>{String(v)}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="w-full md:w-44 shrink-0">
                  <div className="text-caleo-9 font-black uppercase tracking-widest text-slate-400 text-right pr-1 mb-0.5">
                    {showGrosir ? 'Harga Eceran' : 'Harga'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRequestPriceChange(item, 'price')}
                    disabled={isEditing || !currentUser}
                    title={currentUser ? 'Klik untuk ajukan perubahan harga jual' : 'Login diperlukan untuk ubah harga'}
                    className="w-full pl-9 pr-3 py-2.5 bg-white rounded border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 text-xs font-extrabold text-[var(--color-caleo-primary)] shadow-sm outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed relative cursor-pointer transition-colors"
                  >
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#43474e]">Rp</span>
                    {new Intl.NumberFormat('id-ID').format(item.price)}
                    {pendingIndex.priceMap.has(`${item.sku}|price`) && (
                      <span className="absolute -top-1.5 -right-1.5">
                        <PendingApprovalBadge
                          count={pendingIndex.priceMap.get(`${item.sku}|price`)}
                          tooltip="Permintaan ubah harga jual menunggu"
                        />
                      </span>
                    )}
                  </button>
                  <div className="mt-1 text-caleo-10 font-semibold text-gray-400 text-right pr-1 flex items-center justify-end gap-1.5">
                    <span>Modal:</span>
                    <button
                      type="button"
                      onClick={() => onRequestPriceChange(item, 'harga_modal')}
                      disabled={isEditing || !currentUser}
                      title={currentUser ? 'Klik untuk ajukan perubahan HPP' : 'Login diperlukan untuk ubah HPP'}
                      className="relative inline-flex items-center gap-1 hover:underline disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {item.harga_modal != null
                        ? <span className="text-gray-600">{formatIDR(item.harga_modal)}</span>
                        : <span className="text-amber-500 font-bold" title="Belum diisi — P&L tidak akurat">—</span>
                      }
                      {pendingIndex.priceMap.has(`${item.sku}|harga_modal`) && (
                        <PendingApprovalBadge
                          count={pendingIndex.priceMap.get(`${item.sku}|harga_modal`)}
                          tooltip="Permintaan ubah HPP menunggu"
                        />
                      )}
                    </button>
                  </div>
                  {showGrosir && (
                    <div className="mt-1 text-caleo-10 font-semibold text-right pr-1 flex items-center justify-end gap-1.5">
                      <span className="text-gray-400">Grosir:</span>
                      {item.price_grosir == null
                        ? <span className="text-amber-600 font-bold">Belum di-set</span>
                        : <span className="text-emerald-700 font-bold">{formatIDR(item.price_grosir)}</span>
                      }
                    </div>
                  )}
                  {extraTiers.map(t => (
                    <div key={t.key} className="mt-1 text-caleo-10 font-semibold text-right pr-1 flex items-center justify-end gap-1.5">
                      <span className="text-gray-400">{t.label}:</span>
                      {(t.slot === 3 ? item.price_tier_3 : item.price_tier_4) == null
                        ? <span className="text-slate-400 font-bold">Sama dgn base</span>
                        : <span className="text-emerald-700 font-bold">{formatIDR((t.slot === 3 ? item.price_tier_3 : item.price_tier_4) as number)}</span>
                      }
                    </div>
                  ))}
                </div>

                <div className="w-full md:w-36 shrink-0">
                  <div className="flex flex-wrap gap-1 text-caleo-10 font-bold">
                    <span className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => onRequestAdjustment(item, warehouses.find(w => w.code === 'ATAS')?.id ?? '')}
                        disabled={isEditing || !currentUser}
                        title={currentUser ? 'Klik untuk ajukan penyesuaian Gudang Atas' : 'Login diperlukan'}
                        className="relative bg-blue-50 border border-blue-200 px-2 py-1 rounded text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1"
                      >
                        Atas: {item.stock_atas ?? item.stock}
                        {pendingIndex.adjMap.has(`${item.sku}|atas`) && (
                          <PendingApprovalBadge
                            count={pendingIndex.adjMap.get(`${item.sku}|atas`)}
                            tooltip="Penyesuaian Gudang Atas menunggu"
                          />
                        )}
                      </button>
                      <InTransitChip warehouseId={warehouses.find(w => w.code === 'ATAS')?.id ?? ''} sku={item.sku} />
                    </span>
                    <span className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => onRequestAdjustment(item, warehouses.find(w => w.code === 'BAWAH')?.id ?? '')}
                        disabled={isEditing || !currentUser}
                        title={currentUser ? 'Klik untuk ajukan penyesuaian Gudang Bawah' : 'Login diperlukan'}
                        className="relative bg-amber-50 border border-amber-200 px-2 py-1 rounded text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1"
                      >
                        Bawah: {item.stock_bawah ?? 0}
                        {pendingIndex.adjMap.has(`${item.sku}|bawah`) && (
                          <PendingApprovalBadge
                            count={pendingIndex.adjMap.get(`${item.sku}|bawah`)}
                            tooltip="Penyesuaian Gudang Bawah menunggu"
                          />
                        )}
                      </button>
                      <InTransitChip warehouseId={warehouses.find(w => w.code === 'BAWAH')?.id ?? ''} sku={item.sku} />
                    </span>
                  </div>
                  <div className="text-caleo-9 text-slate-400 mt-0.5 font-semibold">
                    Total: {item.stock} pcs
                  </div>
                </div>

                <div className="w-full md:w-28 shrink-0">
                  {isWarning ? (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 text-caleo-10 font-black uppercase tracking-tighter gap-1 border border-rose-200">
                      <AlertTriangle className="w-3 h-3" /> Stok Tipis
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-emerald-50 text-[#2d8a4e] text-caleo-10 font-black uppercase tracking-tighter gap-1 border border-emerald-200">
                      <CheckCircle className="w-3 h-3" /> Sinkron
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => isEditing ? cancelEdit(item.sku) : startEdit(item)}
                    className={`px-3 py-1.5 rounded-full text-caleo-10 font-black border cursor-pointer transition-all ${isEditing ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-[var(--color-caleo-mist-dark)] bg-[var(--color-caleo-cloud)] text-[#1e3d60] hover:bg-blue-100'}`}
                  >
                    {isEditing
                      ? <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" />Tutup</span>
                      : '✏ Edit'
                    }
                  </button>
                  {/* Phase 2: Vol button — only when modul_multi_tier_price enabled (same gate as showGrosir) */}
                  {showGrosir && (
                  <button
                    type="button"
                    onClick={() => setEditingVolSku(item.sku)}
                    className="px-3 py-1.5 rounded-full text-caleo-10 font-black border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 cursor-pointer transition-all"
                    title="Edit harga volume (qty tier)"
                  >
                    Vol
                    {(item.qty_tiers?.length ?? 0) > 0 && (
                      <span className="ml-1 text-caleo-9 font-black text-purple-600">
                        ({item.qty_tiers!.length})
                      </span>
                    )}
                  </button>
                  )}
                  <button
                    onClick={() => onTransfer(item)}
                    className="px-3 py-1.5 rounded-full text-caleo-10 font-black border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-all"
                  >
                    ⇄ Transfer
                  </button>
                  <button
                    onClick={() => onRequestAdjustment(item, warehouses.find(w => w.is_default)?.id ?? warehouses.find(w => w.code === 'ATAS')?.id ?? '')}
                    disabled={isEditing || !currentUser}
                    title={currentUser ? 'Ajukan penyesuaian stok (rusak / hilang / koreksi)' : 'Login diperlukan'}
                    className="px-3 py-1.5 rounded-full text-caleo-10 font-black border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
                  >
                    ⚖ Penyesuaian
                  </button>
                  <button onClick={() => onDelete(item.sku)} className="p-1.5 text-rose-400 hover:text-rose-600 rounded-full hover:bg-rose-50 cursor-pointer transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isEditing && vals && (
                <div className="bg-blue-50 border border-blue-200 border-t-0 rounded-b-2xl p-5">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    <div className="space-y-1">
                      <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                        {showGrosir ? 'Harga Eceran (Rp)' : 'Harga (Rp)'}
                      </label>
                      <input
                        type="text"
                        value={vals.price}
                        onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], price: e.target.value } }))}
                        className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                        Harga Modal (HPP)
                      </label>
                      <NumberInput
                        nullable
                        value={vals.harga_modal ?? null}
                        onChange={n => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], harga_modal: n } }))}
                        placeholder="Harga beli / modal"
                        className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                      />
                    </div>
                    {showGrosir ? (
                      <div className="space-y-1">
                        <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest pl-1">Harga Grosir (Rp)</label>
                        <NumberInput
                          nullable
                          value={vals.price_grosir ?? null}
                          onChange={n => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], price_grosir: n } }))}
                          placeholder="Harga untuk pembeli grosir"
                          className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                        />
                        {vals.price_grosir != null && vals.price_grosir > (parseInt(vals.price.replace(/\D/g, '')) || 0) && (
                          <p className="text-xs text-amber-600 mt-1 pl-1">⚠ Harga grosir di atas eceran — tidak biasa. Pastikan benar.</p>
                        )}
                      </div>
                    ) : (
                      <div className="md:col-span-1 flex items-end">
                        <div className="w-full bg-violet-50 border border-violet-200 rounded px-3 py-2 text-caleo-10 text-slate-500 italic leading-snug">
                          💡 Untuk ubah jumlah stok per gudang, klik tombol <span className="font-bold text-violet-700 not-italic">⚖ Penyesuaian</span> di kanan baris (perlu approval Owner).
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Extra tier inputs (tier_3, tier_4) — only when active in tenant config */}
                  {extraTiers.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                      {extraTiers.map(t => (
                        <div key={t.key} className="space-y-1">
                          <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest pl-1">
                            Harga {t.label} (Rp)
                          </label>
                          <NumberInput
                            nullable
                            value={vals.tier_prices[t.key as TierKey] ?? null}
                            onChange={n => setEditValues(prev => ({
                              ...prev,
                              [item.sku]: {
                                ...prev[item.sku],
                                tier_prices: { ...prev[item.sku].tier_prices, [t.key]: n },
                              },
                            }))}
                            placeholder="Kosongkan untuk pakai harga base"
                            className="w-full bg-white rounded px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {showGrosir && (
                    <div className="mb-4 bg-violet-50 border border-violet-200 rounded px-3 py-2 text-caleo-10 text-slate-500 italic leading-snug">
                      💡 Untuk ubah jumlah stok per gudang, klik tombol <span className="font-bold text-violet-700 not-italic">⚖ Penyesuaian</span> di kanan baris (perlu approval Owner).
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-blue-200" />
                    <span className="text-caleo-9 font-black uppercase tracking-widest px-3 py-1 bg-blue-100 text-blue-800 rounded-full">⚙ Spesifikasi {item.category}</span>
                    <div className="flex-1 h-px bg-blue-200" />
                  </div>
                  {renderSpecForm(
                    item.category,
                    vals.specs,
                    (key, val) => setEditValues(prev => ({
                      ...prev,
                      [item.sku]: { ...prev[item.sku], specs: { ...prev[item.sku].specs, [key]: val } },
                    }))
                  )}
                  <div className="flex justify-end gap-2 pt-4">
                    <button type="button" onClick={() => cancelEdit(item.sku)} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-100 cursor-pointer">Batal</button>
                    <button type="button" onClick={() => void saveEdit(item.sku)} className="px-4 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 cursor-pointer">Simpan Perubahan</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>

    {/* Phase 2: Qty-tier modal — rendered outside <section> to escape overflow:hidden.
        Gate matches Vol button: only when modul_multi_tier_price enabled (showGrosir). */}
    {showGrosir && editingVolSku && stockList.find(i => i.sku === editingVolSku) != null && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={e => { if (e.target === e.currentTarget) setEditingVolSku(null); }}
      >
        <div className="bg-white rounded max-w-md w-full mx-4 p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[var(--color-caleo-primary)]">Harga Volume — {editingVolSku}</h3>
            <button
              type="button"
              onClick={() => setEditingVolSku(null)}
              className="text-slate-400 hover:text-slate-600 text-lg font-bold leading-none"
              aria-label="Tutup"
            >
              ×
            </button>
          </div>
          <QtyTiersEditor
            stockSku={editingVolSku}
            basePrice={stockList.find(i => i.sku === editingVolSku)?.price ?? 0}
            initialTiers={stockList.find(i => i.sku === editingVolSku)?.qty_tiers ?? []}
            onSaved={() => {
              setEditingVolSku(null);
              onDataChanged?.();
            }}
            showToast={showToast}
          />
        </div>
      </div>
    )}
    </>
  );
}
