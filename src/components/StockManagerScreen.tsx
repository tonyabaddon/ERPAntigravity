/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Download, Search, ChevronDown, CheckCircle, AlertTriangle,
  PlusCircle, Save, Trash2, FileCheck, ChevronUp
} from 'lucide-react';
import { StockItem } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface StockManagerScreenProps {
  stockList: StockItem[];
  onStockUpdate: (updated: StockItem[]) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
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

const CSV_SPEC_COLS = [
  'material', 'tipe_pasang', 'tinggi_cm', 'lebar_cm', 'tebal_cm',
  'ketebalan_mm', 'finishing', 'kelengkapan',
  'mcb_merek', 'mcb_ampere', 'mcb_phase',
  'kabel_tipe', 'kabel_mm2', 'kabel_panjang',
  'deskripsi',
];
const CSV_HEADER = ['kategori', 'harga', 'stok', ...CSV_SPEC_COLS].join(',');

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

export default function StockManagerScreen({ stockList, onStockUpdate, showToast }: StockManagerScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua Produk');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState('Panel');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('');
  const [newSpecs, setNewSpecs] = useState<Record<string, string>>({});

  const [editingSkus, setEditingSkus] = useState<Set<string>>(new Set());
  const [editValues, setEditValues] = useState<Record<string, { price: string; stock: string; specs: Record<string, string> }>>({});

  const uniqueCategories = ['Semua Produk', 'Panel', 'MCB', 'Kabel', 'Aksesori'];

  const handleCellEdit = (sku: string, field: 'price' | 'stock', value: string) => {
    const numericValue = parseInt(value.replace(/\D/g, '')) || 0;
    const updated = stockList.map(item => {
      if (item.sku !== sku) return item;
      const next = { ...item, [field]: numericValue };
      next.status = next.stock < 10 ? 'Stok Tipis' : 'Sinkron';
      return next;
    });
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

  const startEdit = (item: StockItem) => {
    setEditingSkus(prev => new Set([...prev, item.sku]));
    setEditValues(prev => ({
      ...prev,
      [item.sku]: {
        price: String(item.price),
        stock: String(item.stock),
        specs: Object.fromEntries(
          Object.entries(item.specs ?? {}).map(([k, v]) => [k, String(v)])
        ),
      },
    }));
  };

  const cancelEdit = (sku: string) => {
    setEditingSkus(prev => { const s = new Set(prev); s.delete(sku); return s; });
  };

  const saveEdit = (sku: string) => {
    const vals = editValues[sku];
    if (!vals) return;
    const item = stockList.find(i => i.sku === sku);
    if (!item) return;
    const price = parseInt(vals.price.replace(/\D/g, '')) || 0;
    const stock = parseInt(vals.stock) || 0;
    const name = generateName(item.category, vals.specs);
    if (!name) {
      showToast('⚠️ Mohon lengkapi spesifikasi produk!', 'warning');
      return;
    }
    const updated = stockList.map(i =>
      i.sku === sku
        ? { ...i, price, stock, specs: vals.specs, name, status: (stock < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron' }
        : i
    );
    onStockUpdate(updated);
    cancelEdit(sku);
    showToast('✅ Produk berhasil diperbarui.');
  };

  const handleDownloadTemplate = () => {
    const rows = [
      CSV_HEADER,
      'Panel,850000,24,Besi,Indoor,60,40,20,1.5,RAL7032,Kosong,,,,,,,',
      'MCB,45000,200,,,,,,,,,Schneider,16,1P,,,,',
      'Kabel,380000,50,,,,,,,,,,,,NYM,2.5,100m/Rol,',
      'Aksesori,25000,10,,,,,,,,,,,,,,,Klem Kabel 16mm',
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Template_Stok_Sinar_Elektrik.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('📥 Template CSV berhasil diunduh.');
  };

  const parseAndUploadCSV = (text: string) => {
    const lines = text.trim().split('\n');
    const header = lines[0].split(',').map(h => h.trim());
    const newItems: StockItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ''; });
      const category = row['kategori'] || 'Aksesori';
      const price = parseInt(row['harga']) || 0;
      const stock = parseInt(row['stok']) || 0;
      const specs: Record<string, string> = {};
      CSV_SPEC_COLS.forEach(col => {
        if (row[col] && row[col] !== '—' && row[col] !== '-') {
          specs[col] = row[col];
        }
      });
      const sku = generateSkuId();
      const name = generateName(category, specs);
      newItems.push({ sku, name, category, price, stock, status: stock < 10 ? 'Stok Tipis' : 'Sinkron', specs });
    }
    onStockUpdate([...newItems, ...stockList]);
    showToast(`✅ ${newItems.length} produk berhasil diimport dari CSV.`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadProgress(0);
    showToast('📑 Memulai proses validasi dokumen...');
    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result as string;
      let progress = 0;
      const timer = setInterval(() => {
        progress += 25;
        setUploadProgress(progress);
        if (progress >= 100) {
          clearInterval(timer);
          setIsUploading(false);
          parseAndUploadCSV(text);
        }
      }, 150);
    };
    reader.onerror = () => {
      setIsUploading(false);
      setUploadProgress(null);
      e.target.value = '';
      showToast('❌ Gagal membaca file. Coba lagi.', 'warning');
    };
    reader.readAsText(file);
  };

  const filteredStock = stockList.filter(item => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua Produk' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const previewName = generateName(newCategory, newSpecs);

  return (
    <div className="space-y-8 animate-fadeIn pb-24">

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
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#1e3d60] flex items-center justify-center shrink-0">
              <Download className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#012749] leading-tight flex items-center gap-2">
                Pembaruan Stok &amp; Harga Massal (Bulk Upload Excel)
                <span className="text-[8px] font-black tracking-widest text-blue-700 uppercase bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full">Template Diperbarui</span>
              </h3>
              <p className="text-xs text-[#43474e] mt-1">
                Template hanya berisi kolom spesifikasi — SKU dan nama produk dibuat otomatis oleh sistem saat upload.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          <div
            onClick={handleDownloadTemplate}
            className="bg-[#eff4ff] rounded-3xl p-8 border border-transparent hover:border-[#1e3d60]/20 hover:bg-blue-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
          >
            <div className="w-16 h-16 rounded-full bg-[#1e3d60] text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
              <Download className="w-6 h-6" />
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">UNDUH TEMPLATE EXCEL (*.CSV)</h4>
            <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Kolom spek Panel, MCB, Kabel &amp; Aksesori. SKU &amp; nama auto.</p>
          </div>

          <label
            className="rounded-3xl p-8 flex flex-col items-center justify-center text-center group cursor-pointer transition-all hover:bg-emerald-500/5 select-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='32' ry='32' stroke='%232d8a4e4d' stroke-width='2' stroke-dasharray='10%2c 10' stroke-dashoffset='0' stroke-linecap='square'/%3e%3c/svg%3e")` }}
          >
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-[#2d8a4e] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-4xl">upload_file</span>
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">Tarik &amp; lepas file CSV di sini...</h4>
            <p className="text-[11px] text-[#2d8a4e] font-bold mt-1">Atau Tekan Disini untuk Unggah Otomatis (Max 25MB)</p>
          </label>
        </div>

        {uploadProgress !== null && (
          <div className="mt-8 space-y-2 animate-fadeIn bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
            <div className="flex justify-between items-center select-none">
              <span className="text-xs font-bold text-[#1e3d60] flex items-center gap-1.5">
                {uploadProgress < 100 ? (
                  <><span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />Mengunggah &amp; Memvalidasi...</>
                ) : (
                  <><FileCheck className="w-4 h-4 text-[#2d8a4e]" />Validasi Selesai!</>
                )}
              </span>
              <span className="text-sm font-extrabold text-[#2d8a4e]">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="bg-[#2d8a4e] h-full rounded-full transition-all duration-300 relative" style={{ width: `${uploadProgress}%` }}>
                <div className="absolute inset-0 bg-white/30 animate-pulse" />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Stock Table */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-3xl">edit_note</span>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#012749] leading-tight">Modifikasi Cepat / Edit Satu per Satu</h3>
              <p className="text-xs text-[#43474e] mt-1">Klik Edit untuk mengubah spesifikasi. Harga &amp; stok bisa langsung diedit di tabel.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative min-w-[260px]">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari SKU atau nama barang..."
                className="w-full pl-12 pr-4 py-3 bg-[#eff4ff] rounded-full border-none focus:ring-2 focus:ring-[#012749]/15 text-xs font-bold text-slate-800 outline-none"
              />
              <Search className="w-4 h-4 text-[#43474e]/60 absolute left-4 top-1/2 -translate-y-1/2" />
            </div>
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="pl-6 pr-12 py-3 bg-[#eff4ff] rounded-full border-none focus:ring-2 focus:ring-[#012749]/10 text-xs font-black text-[#1e3d60] appearance-none cursor-pointer outline-none w-full"
              >
                {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="bg-slate-50 border border-[#abc9f3] p-6 rounded-3xl mb-6 shadow-inner animate-slideUp">
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
          </div>
        )}

        {/* Stock rows */}
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredStock.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-semibold text-sm">
              Tidak ada produk yang cocok dengan filter pencarian.
            </div>
          ) : filteredStock.map((item, index) => {
            const isEditing = editingSkus.has(item.sku);
            const vals = editValues[item.sku];
            const isWarning = item.stock < 10;
            const pillColor = PILL_COLORS[item.category] ?? PILL_COLORS.Aksesori;
            const specEntries = Object.entries(item.specs ?? {});

            return (
              <div key={`${item.sku}-${index}`}>
                <div className={`flex flex-col md:flex-row items-stretch md:items-center gap-4 p-5 rounded-2xl transition-all duration-300 border ${isEditing ? 'bg-blue-50 border-blue-200 rounded-b-none' : 'bg-[#eff4ff]/60 hover:bg-white hover:shadow-xl border-transparent hover:border-slate-100'} group`}>
                  <div className="w-28 shrink-0">
                    <div className="text-[10px] font-mono font-bold text-slate-500">{item.category}</div>
                    <div className="text-[9px] font-mono text-slate-400">#{item.sku.slice(0, 8)}</div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#012749] truncate">{item.name}</p>
                    {specEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {specEntries.slice(0, 6).map(([k, v]) => (
                          <span key={k} className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${pillColor}`}>{String(v)}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="w-full md:w-44 shrink-0">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#43474e]">Rp</span>
                      <input
                        type="text"
                        value={new Intl.NumberFormat('id-ID').format(item.price)}
                        onChange={e => handleCellEdit(item.sku, 'price', e.target.value)}
                        disabled={isEditing}
                        className="w-full pl-9 pr-3 py-2.5 bg-white rounded-xl border border-slate-200 focus:ring-1 focus:ring-[#2d8a4e] text-xs font-extrabold text-[#012749] shadow-sm outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div className="w-full md:w-28 shrink-0 flex items-center gap-2">
                    <input
                      type="text"
                      value={item.stock}
                      onChange={e => handleCellEdit(item.sku, 'stock', e.target.value)}
                      disabled={isEditing}
                      className={`w-full px-3 py-2.5 bg-white rounded-xl focus:ring-1 text-center text-xs font-extrabold shadow-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isWarning ? 'border-rose-400 focus:ring-rose-500 text-rose-600 border-2' : 'border-slate-200 focus:ring-[#2d8a4e] text-slate-800'}`}
                    />
                    <span className="text-xs font-extrabold text-slate-400 shrink-0">Pcs</span>
                  </div>

                  <div className="w-full md:w-28 shrink-0">
                    {isWarning ? (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-tighter gap-1 border border-rose-200">
                        <AlertTriangle className="w-3 h-3" /> Stok Tipis
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-emerald-50 text-[#2d8a4e] text-[10px] font-black uppercase tracking-tighter gap-1 border border-emerald-200">
                        <CheckCircle className="w-3 h-3" /> Sinkron
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => isEditing ? cancelEdit(item.sku) : startEdit(item)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black border cursor-pointer transition-all ${isEditing ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-[#c7d7f5] bg-[#eff4ff] text-[#1e3d60] hover:bg-blue-100'}`}
                    >
                      {isEditing
                        ? <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" />Tutup</span>
                        : '✏ Edit'
                      }
                    </button>
                    <button onClick={() => handleDeleteItem(item.sku)} className="p-1.5 text-rose-400 hover:text-rose-600 rounded-full hover:bg-rose-50 cursor-pointer transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isEditing && vals && (
                  <div className="bg-blue-50 border border-blue-200 border-t-0 rounded-b-2xl p-5">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">Harga (Rp)</label>
                        <input
                          type="text"
                          value={vals.price}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], price: e.target.value } }))}
                          className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">Stok (Pcs)</label>
                        <input
                          type="number"
                          value={vals.stock}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.sku]: { ...prev[item.sku], stock: e.target.value } }))}
                          className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 h-px bg-blue-200" />
                      <span className="text-[8.5px] font-black uppercase tracking-widest px-3 py-1 bg-blue-100 text-blue-800 rounded-full">⚙ Spesifikasi {item.category}</span>
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
                      <button type="button" onClick={() => saveEdit(item.sku)} className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 cursor-pointer">Simpan Perubahan</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
            className="mt-6 w-full py-5 border-2 border-dashed border-slate-200 hover:border-[#1e3d60]/40 rounded-2xl text-xs font-black text-[#1e3d60] hover:bg-slate-50 transition-all flex items-center justify-center gap-2 group cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300 text-[#2d8a4e]" />
            Tambah Baris Barang Baru
          </button>
        )}
      </section>

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
    </div>
  );
}
