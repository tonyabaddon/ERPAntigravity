import React, { useRef, useState } from 'react';
import { Download, Upload, Check, X } from 'lucide-react';
import { StockItem } from '../../types';
import { productService } from '../../lib/supabaseClient';

interface Props {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onApplied: () => void;
}

type RowStatus = 'OK' | 'WARNING_ABOVE_ECERAN' | 'SKIP_SKU_NOT_FOUND' | 'SKIP_INVALID_FORMAT' | 'NO_CHANGE';
interface ParsedRow {
  sku: string;
  nama: string;
  price_eceran: number | null;
  price_grosir_lama: number | null;
  price_grosir_baru: number | null;
  status: RowStatus;
}

export default function BulkUpdateGrosirSection({ stockList, showToast, onApplied }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [confirmAbove, setConfirmAbove] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleDownloadTemplate = () => {
    const header = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru';
    const csv = [header, ...stockList.map(s =>
      `${s.sku},"${s.name.replace(/"/g,'""')}",${s.price ?? ''},${s.price_grosir ?? ''},`
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'template-harga-grosir.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text: string): ParsedRow[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const [, ...dataLines] = lines;  // skip header
    const skuMap = new Map(stockList.map(s => [s.sku, s]));
    return dataLines.map(line => {
      const cols = parseCsvLine(line);
      const [sku, , , , baruRaw] = cols;
      const product = skuMap.get(sku);
      const lama = product?.price_grosir ?? null;
      const eceran = product?.price ?? null;
      const baruStr = (baruRaw ?? '').trim();
      if (!product) {
        return { sku, nama: cols[1] ?? '', price_eceran: null, price_grosir_lama: null, price_grosir_baru: null, status: 'SKIP_SKU_NOT_FOUND' };
      }
      if (baruStr === '') {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: null, status: 'NO_CHANGE' };
      }
      const baru = Number(baruStr);
      if (!isFinite(baru) || baru <= 0) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: null, status: 'SKIP_INVALID_FORMAT' };
      }
      if (baru === lama) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'NO_CHANGE' };
      }
      if (eceran != null && baru > eceran) {
        return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'WARNING_ABOVE_ECERAN' };
      }
      return { sku, nama: product.name, price_eceran: eceran, price_grosir_lama: lama, price_grosir_baru: baru, status: 'OK' };
    });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // I-3 (review 2026-06-24): cap file size to avoid OOM on large/hostile uploads.
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      showToast(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maks 10 MB.`, 'warning');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const text = await file.text();
    setRows(parseCsv(text));
    setConfirmAbove(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const summary = rows ? {
    toApply: rows.filter(r => r.status === 'OK' || r.status === 'WARNING_ABOVE_ECERAN').length,
    skipped: rows.filter(r => r.status.startsWith('SKIP')).length,
    warning: rows.filter(r => r.status === 'WARNING_ABOVE_ECERAN').length,
  } : null;

  const canApply = !!summary && summary.toApply > 0 && (summary.warning === 0 || confirmAbove);

  const handleApply = async () => {
    if (!rows || !canApply) return;
    setApplying(true);
    try {
      const payload = rows
        .filter(r => r.status === 'OK' || r.status === 'WARNING_ABOVE_ECERAN')
        .map(r => ({ sku: r.sku, price_grosir: r.price_grosir_baru as number }));
      const result = await productService.bulkUpdateGrosirPrice(payload);
      showToast(`✅ ${result.applied} produk diupdate, ${result.skipped.length} skipped`, 'success');
      setRows(null);
      onApplied();
    } catch (err) {
      showToast(`Gagal: ${err.message ?? 'unknown'}`, 'warning');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-bold text-[#012749] mb-2">Update Harga Grosir (CSV)</h3>
      <p className="text-xs text-slate-500 mb-4">Download template, isi kolom <code>price_grosir_baru</code>, lalu upload kembali. Preview sebelum apply.</p>
      <div className="flex gap-2">
        <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200">
          <Download className="w-3.5 h-3.5" /> Download Template
        </button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 bg-[#012749] text-white text-xs font-bold rounded-lg hover:bg-[#01365e]">
          <Upload className="w-3.5 h-3.5" /> Upload CSV
        </button>
      </div>

      {rows && summary && (
        <div className="mt-4 border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between p-3 bg-slate-50 border-b">
            <div className="text-xs font-bold text-slate-700">
              {summary.toApply} akan diupdate · {summary.skipped} skipped · {summary.warning} warning
            </div>
            <button onClick={() => setRows(null)} className="text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b">
                <tr><th className="text-left p-2">SKU</th><th className="text-left p-2">Nama</th><th className="text-right p-2">Eceran</th><th className="text-right p-2">Grosir Lama</th><th className="text-right p-2">Grosir Baru</th><th className="text-left p-2">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2 font-mono">{r.sku}</td>
                    <td className="p-2">{r.nama}</td>
                    <td className="p-2 text-right">{r.price_eceran ?? '—'}</td>
                    <td className="p-2 text-right">{r.price_grosir_lama ?? '—'}</td>
                    <td className="p-2 text-right">{r.price_grosir_baru ?? '—'}</td>
                    <td className="p-2">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t flex items-center justify-between gap-3">
            {summary.warning > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={confirmAbove} onChange={e => setConfirmAbove(e.target.checked)} />
                Saya konfirmasi update harga grosir di atas eceran ({summary.warning} produk)
              </label>
            )}
            <button onClick={handleApply} disabled={!canApply || applying}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> {applying ? 'Menerapkan…' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusBadge(s: RowStatus) {
  const map: Record<RowStatus, {label: string; cls: string}> = {
    OK: { label: '✅ OK', cls: 'text-emerald-700 bg-emerald-50' },
    WARNING_ABOVE_ECERAN: { label: '⚠ Di atas eceran', cls: 'text-amber-700 bg-amber-50' },
    SKIP_SKU_NOT_FOUND: { label: '⚠ SKU tidak ada', cls: 'text-rose-700 bg-rose-50' },
    SKIP_INVALID_FORMAT: { label: '⚠ Bukan numeric', cls: 'text-rose-700 bg-rose-50' },
    NO_CHANGE: { label: '🔵 Tidak berubah', cls: 'text-slate-600 bg-slate-50' },
  };
  const { label, cls } = map[s];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{label}</span>;
}

// Minimal CSV line parser handling quoted strings.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuote = true; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
