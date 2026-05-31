/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Download, 
  Search, 
  ChevronDown, 
  CheckCircle, 
  AlertTriangle, 
  PlusCircle, 
  Save, 
  Trash2,
  FileCheck,
  PackagePlus
} from 'lucide-react';
import { StockItem } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';


interface StockManagerScreenProps {
  stockList: StockItem[];
  onStockUpdate: (updated: StockItem[]) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function StockManagerScreen({ stockList, onStockUpdate, showToast }: StockManagerScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua Komoditas');
  
  // Simulated Excel upload progress
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // New stock item dialog state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Kabel');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('');

  // Filtering category list based on stock items
  const uniqueCategories = ['Semua Komoditas', 'Kabel', 'Panel', 'Aksesori'];

  // Handle cell value updates instantly
  const handleCellEdit = (sku: string, field: 'price' | 'stock', value: string) => {
    let numericValue = parseInt(value.replace(/\D/g, '')) || 0;
    
    const updated = stockList.map(item => {
      if (item.sku === sku) {
        const nextItem = { ...item, [field]: numericValue };
        // Reactively assess status based on stock volume
        nextItem.status = nextItem.stock < 10 ? 'Stok Tipis' : 'Sinkron';
        return nextItem;
      }
      return item;
    });
    
    onStockUpdate(updated);
  };

  // Delete inventory row
  const handleDeleteItem = (sku: string) => {
    const updated = stockList.filter(item => item.sku !== sku);
    onStockUpdate(updated);
    showToast(`🗑️ SKU ${sku} berhasil dihapus dari sistem Sinar Elektrik.`);
  };

  // Add Item Submit
  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSku || !newName || !newPrice || !newStock) {
      showToast('⚠️ Mohon isi semua kolom untuk menambahkan SKU baru!');
      return;
    }

    const skuUpper = newSku.toUpperCase();
    if (stockList.some(item => item.sku === skuUpper)) {
      showToast('⚠️ SKU tersebut sudah terdaftar di sistem Sinar Elektrik!', 'warning');
      return;
    }

    const priceNum = parseInt(newPrice) || 0;
    const stockNum = parseInt(newStock) || 0;

    const newItem: StockItem = {
      sku: skuUpper,
      name: newName,
      category: newCategory,
      price: priceNum,
      stock: stockNum,
      status: stockNum < 10 ? 'Stok Tipis' : 'Sinkron'
    };

    onStockUpdate([newItem, ...stockList]);
    setShowAddForm(false);
    
    // Reset forms
    setNewSku('');
    setNewName('');
    setNewPrice('');
    setNewStock('');
    
    showToast(`🎉 SKU ${newItem.sku} ("${newItem.name}") berhasil ditambahkan.`);
  };

  // Simulate downloading Excel template
  const handleDownloadTemplate = () => {
    showToast('📥 Mengunduh template resmi Excel Sinar Elektrik...');
    setTimeout(() => {
      // Create a virtual file download
      const content = "SKU,Nama Barang,Kategori,Harga,Stok\nSKU-TEST-01,Kabel Tembaga Premium,Kabel,150000,200\n";
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", "Template_Stok_Sinar_Elektrik.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 800);
  };

  // Simulate Excel Drag & Drop Dragover and Upload action
  const handleExcelUpload = () => {
    if (isUploading) return;
    setIsUploading(true);
    setUploadProgress(0);
    showToast('📑 Memulai proses validasi dokumen Excel...');

    const timer = setInterval(() => {
      setUploadProgress(prev => {
        if (prev === null) return 0;
        if (prev >= 100) {
          clearInterval(timer);
          setIsUploading(false);
          
          // Inject a newly synthesized bulk uploaded items to show immediate action effect!
          const uploadedItem: StockItem = {
            sku: 'SKU-PL-88',
            name: 'Pipa Conduit PVC Maspion',
            category: 'Aksesori',
            price: 18500,
            stock: 350,
            status: 'Sinkron'
          };
          
          const exists = stockList.some(item => item.sku === 'SKU-PL-88');
          if (exists) {
            const updated = stockList.map(item => {
              if (item.sku === 'SKU-PL-88') {
                return { ...item, stock: item.stock + 350, price: 18500 };
              }
              return item;
            });
            onStockUpdate(updated);
            showToast('✅ Dokumen terverifikasi! SKU-PL-88 Pipa Conduit sudah ada, stok ditambahkan.');
          } else {
            onStockUpdate([uploadedItem, ...stockList]);
            showToast('✅ Dokumen terverifikasi! SKU-PL-88 Pipa Conduit ditambahkan.');
          }
          return 100;
        }
        return prev + 20;
      });
    }, 150);
  };

  // Filter based on Category and Search queries
  const filteredStock = stockList.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'Semua Komoditas' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      
      {/* Database Integration Status Header */}
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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <div>
              <span className="text-[9px] font-black text-emerald-600 block uppercase tracking-wider">STATUS KONEKSI</span>
              <span className="text-xs font-black text-emerald-950">Terhubung ke Supabase Cloud DB</span>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50/80 border border-amber-200/60 px-5 py-3 rounded-2xl flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <div>
              <span className="text-[9px] font-black text-amber-600 block uppercase tracking-wider">DATABASE SINKRONISASI</span>
              <span className="text-xs font-bold text-amber-950">Mode Demo (Penyimpanan Lokal Aktif)</span>
            </div>
          </div>
        )}
      </div>

      {/* PANEL 1: Bulk Upload Simulator */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#1e3d60] flex items-center justify-center shrink-0">
              <Download className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#012749] leading-tight">
                Pembaruan Stok &amp; Harga Massal (Bulk Upload Excel)
              </h3>
              <p className="text-xs text-[#43474e] mt-1">
                Unduh template resmi kami, isi data stok/harga toko Anda di Excel, lalu unggah kembali ke sini.
              </p>
            </div>
          </div>
        </div>

        {/* Action Blocks Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Download Box */}
          <div 
            onClick={handleDownloadTemplate}
            className="bg-[#eff4ff] rounded-3xl p-8 border border-transparent hover:border-[#1e3d60]/20 hover:bg-blue-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
          >
            <div className="w-16 h-16 rounded-full bg-[#1e3d60] text-white flex items-center justify-center mb-4 shadow-lg shadow-[#1e3d60]/20 group-hover:scale-105 transition-transform duration-300">
              <Download className="w-6 h-6" />
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">
              UNDUH TEMPLATE EXCEL (*.CSV)
            </h4>
            <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">
              Struktur data disesuaikan untuk MSME Sinar Elektrik
            </p>
          </div>

          {/* Upload Drop Zone Box */}
          <div 
            onClick={handleExcelUpload}
            className="rounded-3xl p-8 flex flex-col items-center justify-center text-center group cursor-pointer transition-all hover:bg-emerald-500/5 select-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='32' ry='32' stroke='%232d8a4e4d' stroke-width='2' stroke-dasharray='10%2c 10' stroke-dashoffset='0' stroke-linecap='square'/%3e%3c/svg%3e")` }}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-[#2d8a4e] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-4xl">upload_file</span>
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">
              Tarik &amp; lepas file Excel Anda di sini...
            </h4>
            <p className="text-[11px] text-[#2d8a4e] font-bold mt-1">
              Atau Tekan Disini untuk Unggah Otomatis (Max size 25MB)
            </p>
          </div>
        </div>

        {/* Simulated progress slider bar */}
        {uploadProgress !== null && (
          <div className="mt-8 space-y-2 animate-fadeIn bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
            <div className="flex justify-between items-center select-none">
              <span className="text-xs font-bold text-[#1e3d60] flex items-center gap-1.5">
                {uploadProgress < 100 ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                    Mengunggah &amp; Memvalidasi Dokumen...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4 text-[#2d8a4e]" />
                    Validasi Integrasi Data Selesai!
                  </>
                )}
              </span>
              <span className="text-sm font-extrabold text-[#2d8a4e]">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-[#2d8a4e] h-full rounded-full transition-all duration-300 relative"
                style={{ width: `${uploadProgress}%` }}
              >
                <div className="absolute inset-0 bg-white/30 animate-pulse" />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* PANEL 2: Interactive Pricing & Stock Table */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-3xl">edit_note</span>
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#012749] leading-tight">
                Modifikasi Cepat / Edit Satu per Satu
              </h3>
              <p className="text-xs text-[#43474e] mt-1">
                Gunakan editor langsung di tabel untuk perubahan cepat tanpa dokumen Excel. Status disinkronkan seketika.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search Input Filter */}
            <div className="relative min-w-[260px]">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari SKU atau nama barang..."
                className="w-full pl-12 pr-4 py-3 bg-[#eff4ff] rounded-full border-none focus:ring-2 focus:ring-[#012749]/15 text-xs font-bold text-slate-800"
              />
              <Search className="w-4 h-4 text-[#43474e]/60 absolute left-4.5 top-1/2 -translate-y-1/2" />
            </div>

            {/* Dropdown Category Filter */}
            <div className="relative">
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="pl-6 pr-12 py-3 bg-[#eff4ff] rounded-full border-none focus:ring-2 focus:ring-[#012749]/10 text-xs font-black text-[#1e3d60] appearance-none cursor-pointer outline-none w-full"
              >
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Dynamic add form popup dialog */}
        {showAddForm && (
          <div className="bg-slate-50 border border-[#abc9f3] p-6 rounded-3xl mb-6 shadow-inner animate-slideUp">
            <h4 className="font-extrabold text-[#012749] text-sm flex items-center gap-1.5 mb-4">
              <PackagePlus className="w-4 h-4 text-[#2d8a4e]" /> Tambah Baris Barang / SKU Baru
            </h4>
            <form onSubmit={handleAddNewItem} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-2">SKU</label>
                <input 
                  type="text" 
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="SKU-KBM-09"
                  className="w-full bg-white rounded-xl px-4 py-2 border border-slate-200 text-xs font-semibold uppercase text-slate-800"
                />
              </div>

              <div className="space-y-1 sm:col-span-1 md:col-span-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-2">Nama Barang</label>
                <input 
                  type="text" 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Kabel NYM Supreme"
                  className="w-full bg-white rounded-xl px-4 py-2 border border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-2">Kategori</label>
                <select 
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800"
                >
                  <option value="Kabel">Kabel</option>
                  <option value="Panel">Panel</option>
                  <option value="Aksesori">Aksesori</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-2 font-mono">Harga (Rp)</label>
                <input 
                  type="number" 
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="e.g. 55000"
                  className="w-full bg-white rounded-xl px-4 py-2 border border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-2 font-mono">Stok (Pcs)</label>
                <input 
                  type="number" 
                  value={newStock}
                  onChange={(e) => setNewStock(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full bg-white rounded-xl px-4 py-2 border border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="sm:col-span-2 md:col-span-5 flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-rose-200 text-rose-600 rounded-full text-xs font-bold hover:bg-rose-50 cursor-pointer"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 cursor-pointer"
                >
                  Tambahkan Produk
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SKU Row Cards stack */}
        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredStock.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-semibold text-sm">
              Tidak ada data SKU stok kelistrikan yang cocok dengan filter pencarian.
            </div>
          ) : (
            filteredStock.map((item, index) => {
              const isWarning = item.stock < 10;
              return (
                <div 
                  key={`${item.sku}-${index}`}
                  className="flex flex-col md:flex-row items-stretch md:items-center gap-6 p-6 rounded-2xl bg-[#eff4ff]/60 hover:bg-white hover:shadow-xl transition-all duration-300 border border-transparent hover:border-slate-100 group"
                >
                  {/* SKU key */}
                  <div className="w-28 text-xs font-mono font-bold text-[#1e3d60] select-none shrink-0 flex items-center md:block">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans font-bold md:hidden mr-2">SKU:</span>
                    {item.sku}
                  </div>

                  {/* Name representation */}
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[#012749]">{item.name}</p>
                    <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-blue-100/50 text-[#1e3d60] text-[9px] font-black uppercase tracking-wider">
                      {item.category}
                    </span>
                  </div>

                  {/* Cell 1: Price Edit Input */}
                  <div className="w-full md:w-48 shrink-0">
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#43474e]">Rp</span>
                      <input 
                        type="text"
                        value={new Intl.NumberFormat('id-ID').format(item.price)}
                        onChange={(e) => handleCellEdit(item.sku, 'price', e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-slate-200 focus:ring-1 focus:ring-[#2d8a4e] focus:border-[#2d8a4e] text-xs font-extrabold text-[#012749] shadow-sm outline-none text-right"
                      />
                    </div>
                  </div>

                  {/* Cell 2: Stock Edit Input */}
                  <div className="w-full md:w-36 shrink-0 flex items-center gap-3">
                    <div className="relative flex-1">
                      <input 
                        type="text"
                        value={item.stock}
                        onChange={(e) => handleCellEdit(item.sku, 'stock', e.target.value)}
                        className={`w-full px-4 py-2.5 bg-white rounded-xl focus:ring-1 text-center text-xs font-extrabold shadow-sm outline-none ${
                          isWarning 
                            ? 'border-rose-400 focus:ring-rose-500 text-rose-600 font-bold border-2' 
                            : 'border-slate-200 focus:ring-[#2d8a4e] text-slate-800'
                        }`}
                      />
                    </div>
                    <span className="text-xs font-extrabold text-slate-400 shrink-0 select-none">Pcs</span>
                  </div>

                  {/* Indicator badging */}
                  <div className="w-full md:w-32 shrink-0 flex items-center justify-between md:justify-end gap-2">
                    <span className="text-[10px] text-slate-400 font-bold block md:hidden">STATUS:</span>
                    {isWarning ? (
                      <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-tighter gap-1 border border-rose-200">
                        <AlertTriangle className="w-3.5 h-3.5" /> Stok Tipis
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-50 text-[#2d8a4e] text-[10px] font-black uppercase tracking-tighter gap-1 border border-emerald-150">
                        <CheckCircle className="w-3.5 h-3.5" /> Sinkron
                      </span>
                    )}
                  </div>

                  {/* Delete product action */}
                  <button 
                    onClick={() => handleDeleteItem(item.sku)}
                    className="p-2 text-rose-400 hover:text-rose-600 rounded-full hover:bg-rose-50 cursor-pointer hidden md:flex shrink-0 transition-all active:scale-95"
                    title="Hapus SKU"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Add Row dashed Button */}
        {!showAddForm && (
          <button 
            onClick={() => setShowAddForm(true)}
            className="mt-6 w-full py-5 border-2 border-dashed border-slate-200 hover:border-[#1e3d60]/40 rounded-2xl text-xs font-black text-[#1e3d60] hover:bg-slate-50 transition-all flex items-center justify-center gap-2 group cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300 text-[#2d8a4e]" />
            Tambah Baris Barang Baru
          </button>
        )}
      </section>

      {/* Floating Save button Trigger */}
      <button 
        onClick={() => {
          localStorage.setItem('sinar_elektrik_stocks', JSON.stringify(stockList));
          showToast('💾 Berhasil Menyimpan Semua Perubahan Inventaris Sinar Elektrik!');
        }}
        className="fixed bottom-10 right-10 bg-[#2d8a4e] text-white px-10 py-5 rounded-full shadow-[0_20px_50px_rgba(45,138,78,0.3)] hover:shadow-[0_25px_60px_rgba(45,138,78,0.4)] transition-all duration-300 hover:-translate-y-1.5 flex items-center gap-2.5 z-50 cursor-pointer text-sm font-extrabold uppercase tracking-wide"
      >
        <Save className="w-5 h-5 text-emerald-200" />
        Simpan Semua Perubahan
      </button>

    </div>
  );
}
