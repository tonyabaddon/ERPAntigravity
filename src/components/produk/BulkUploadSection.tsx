/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Download, FileCheck } from 'lucide-react';
import { StockItem } from '../../types';
import { isSupabaseConfigured, stockService } from '../../lib/supabaseClient';
import type { SupabaseStockItem } from '../../lib/supabaseClient';

const CSV_SPEC_COLS = [
  'material', 'tipe_pasang', 'tinggi_cm', 'lebar_cm', 'tebal_cm',
  'ketebalan_mm', 'finishing', 'kelengkapan',
  'mcb_merek', 'mcb_ampere', 'mcb_phase',
  'kabel_tipe', 'kabel_mm2', 'kabel_panjang',
  'deskripsi',
];
const CSV_HEADER = ['sku', 'nama', 'kategori', 'harga', 'harga_modal', 'stok', ...CSV_SPEC_COLS].join(',');

function generateSkuId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

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

interface BulkUploadSectionProps {
  stockList: StockItem[];
  companyName: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockUpdate: (updated: StockItem[]) => void;
  onUploaded: () => void;
}

export default function BulkUploadSection({
  stockList,
  companyName,
  showToast,
  onStockUpdate,
  onUploaded,
}: BulkUploadSectionProps) {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Snake-case + strip non-filename chars so weird company names (slashes,
  // quotes, emoji) don't break the download attribute.
  const filenameSafeCompany = companyName.replace(/[^\p{Letter}\p{Number}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Stok';

  const handleDownloadTemplate = () => {
    const rows = [
      CSV_HEADER,
      ',,Panel,850000,,24,Besi,Indoor,60,40,20,1.5,RAL7032,Kosong,,,,,,,',
      ',,MCB,45000,,200,,,,,,,,,,Schneider,16,1P,,,',
      ',,Kabel,380000,,50,,,,,,,,,,,,NYM,2.5,100m/Rol,',
      ',,Aksesori,25000,,10,,,,,,,,,,,,,,,Klem Kabel 16mm',
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Template_Stok_${filenameSafeCompany}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('📥 Template CSV berhasil diunduh.');
  };

  const handleExportStock = () => {
    if (stockList.length === 0) {
      showToast('Belum ada produk untuk diekspor.', 'warning');
      return;
    }
    const rows = [
      CSV_HEADER,
      ...stockList.map(item => {
        const specVals = CSV_SPEC_COLS.map(col => item.specs?.[col] ?? '');
        return [
          item.sku,
          item.name,
          item.category,
          item.price,
          item.harga_modal ?? '',
          item.stock,
          ...specVals,
        ].join(',');
      }),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Stok_${filenameSafeCompany}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('📤 Data stok berhasil diekspor.');
  };

  const parseAndUploadCSV = async (text: string) => {
    const lines = text.trim().split('\n');
    const header = lines[0].split(',').map(h => h.trim());
    const updatedStock = [...stockList];
    let addCount = 0;
    let updateCount = 0;
    const changedItems: SupabaseStockItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const skuFromCsv = row['sku']?.trim() ?? '';
      const namaFromCsv = row['nama']?.trim() ?? '';
      const category = row['kategori'] || 'Aksesori';
      const price = parseInt(row['harga']) || 0;
      const harga_modal = row['harga_modal'] ? parseFloat(row['harga_modal']) : null;
      const stock = parseInt(row['stok']) || 0;
      const specs: Record<string, string> = {};
      CSV_SPEC_COLS.forEach(col => {
        if (row[col] && row[col] !== '—' && row[col] !== '-') specs[col] = row[col];
      });

      // Level 1: match by SKU
      let existingIdx = skuFromCsv
        ? updatedStock.findIndex(s => s.sku === skuFromCsv)
        : -1;

      // Level 2: fallback match by name (case-insensitive)
      if (existingIdx === -1 && namaFromCsv) {
        existingIdx = updatedStock.findIndex(
          s => s.name.toLowerCase() === namaFromCsv.toLowerCase()
        );
      }

      if (existingIdx >= 0) {
        const existing = updatedStock[existingIdx];
        const mergedSpecs = { ...existing.specs };
        CSV_SPEC_COLS.forEach(col => {
          if (row[col] && row[col] !== '—' && row[col] !== '-') mergedSpecs[col] = row[col];
        });
        const updatedItem = {
          ...existing,
          price: row['harga'] ? price : existing.price,
          stock: row['stok'] ? stock : existing.stock,
          harga_modal: row['harga_modal'] ? harga_modal : existing.harga_modal,
          name: namaFromCsv || existing.name,
          specs: mergedSpecs,
          status: ((row['stok'] ? stock : existing.stock) < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron',
        };
        updatedStock[existingIdx] = updatedItem;
        changedItems.push(updatedItem as SupabaseStockItem);
        updateCount++;
      } else {
        const sku = skuFromCsv || generateSkuId();
        const name = namaFromCsv || generateName(category, specs);
        const newItem = {
          sku, name, category, price, harga_modal, stock,
          status: (stock < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron',
          specs,
        };
        updatedStock.push(newItem);
        changedItems.push(newItem as SupabaseStockItem);
        addCount++;
      }
    }

    onStockUpdate(updatedStock);
    showToast(`✅ ${addCount} produk ditambah, ${updateCount} produk diperbarui.`);

    if (isSupabaseConfigured && changedItems.length > 0) {
      try {
        await stockService.bulkUpsert(changedItems);
      } catch {
        showToast('Data diimport tapi gagal disimpan ke server. Coba refresh.', 'warning');
      }
    }

    onUploaded();
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
          void parseAndUploadCSV(text);
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

  return (
    <section className="bg-white rounded-[2.5rem] p-8 border border-[var(--color-caleo-mist)] shadow-xl hover:shadow-2xl transition-all duration-300">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-sm bg-blue-50 text-[#1e3d60] flex items-center justify-center shrink-0">
            <Download className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-[var(--color-caleo-primary)] leading-tight flex items-center gap-2">
              Pembaruan Stok &amp; Harga Massal (Bulk Upload Excel)
              <span className="text-[8px] font-black tracking-widest text-blue-700 uppercase bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full">Template Diperbarui</span>
            </h3>
            <p className="text-xs text-[#43474e] mt-1">
              Template hanya berisi kolom spesifikasi — SKU dan nama produk dibuat otomatis oleh sistem saat upload.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        <div
          onClick={handleDownloadTemplate}
          className="bg-[var(--color-caleo-cloud)] rounded-sm p-8 border border-transparent hover:border-[#1e3d60]/20 hover:bg-blue-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
        >
          <div className="w-16 h-16 rounded-full bg-[#1e3d60] text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
            <Download className="w-6 h-6" />
          </div>
          <h4 className="font-extrabold text-[var(--color-caleo-primary)] text-xs uppercase tracking-wider">DOWNLOAD TEMPLATE</h4>
          <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Template kosong untuk input produk baru. SKU &amp; nama auto.</p>
        </div>

        <div
          onClick={handleExportStock}
          className="bg-violet-50 rounded-sm p-8 border border-transparent hover:border-violet-300 hover:bg-violet-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
        >
          <div className="w-16 h-16 rounded-full bg-violet-700 text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
            <Download className="w-6 h-6" />
          </div>
          <h4 className="font-extrabold text-[var(--color-caleo-primary)] text-xs uppercase tracking-wider">EXPORT STOK</h4>
          <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Export semua produk aktif dengan SKU. Edit lalu re-import untuk update.</p>
        </div>

        <label
          className="rounded-sm p-8 flex flex-col items-center justify-center text-center group cursor-pointer transition-all hover:bg-emerald-500/5 select-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='32' ry='32' stroke='%232d8a4e4d' stroke-width='2' stroke-dasharray='10%2c 10' stroke-dashoffset='0' stroke-linecap='square'/%3e%3c/svg%3e")` }}
        >
          <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-[#2d8a4e] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
            <span className="material-symbols-outlined text-4xl">upload_file</span>
          </div>
          <h4 className="font-extrabold text-[var(--color-caleo-primary)] text-xs uppercase tracking-wider">Tarik &amp; lepas file CSV di sini...</h4>
          <p className="text-[11px] text-[#2d8a4e] font-bold mt-1">Atau Tekan Disini untuk Unggah Otomatis (Max 25MB)</p>
        </label>
      </div>

      {uploadProgress !== null && (
        <div className="mt-8 space-y-2 animate-fadeIn bg-slate-50/50 p-4 rounded-sm border border-slate-100">
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
  );
}
