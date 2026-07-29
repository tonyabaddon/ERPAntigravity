import React, { useRef, useState } from 'react';
import { Download, Upload, Check, X } from 'lucide-react';
import { StockItem, DbTenantSettings } from '../../types';
import { productService } from '../../lib/supabaseClient';
import { getActiveTiers, type Tier, type TierKey } from '../../lib/pricing/getActiveTiers';

interface Props {
  stockList: StockItem[];
  tenantSettings: DbTenantSettings | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onApplied: () => void;
}

type RowStatus = 'OK' | 'WARNING_ABOVE_ECERAN' | 'SKIP_SKU_NOT_FOUND' | 'SKIP_INVALID_FORMAT' | 'NO_CHANGE';

interface ParsedRow {
  sku: string;
  nama: string;
  price_eceran: number | null;
  /** Current values per non-base tier (from stockList). */
  tier_lama: Partial<Record<TierKey, number | null>>;
  /** New values per non-base tier (from CSV). null = "no update for this tier". */
  tier_baru: Partial<Record<TierKey, number | null>>;
  status: RowStatus;
}

/** Returns the non-base tiers (slot >= 2) that are active for this tenant. */
function getNonBaseTiers(tenantSettings: DbTenantSettings | null): Tier[] {
  if (!tenantSettings) return [{ key: 'grosir', label: 'Grosir', slot: 2 }];
  return getActiveTiers(tenantSettings).filter(t => t.slot >= 2);
}

function buildHeader(nonBaseTiers: Tier[]): string {
  return [
    'sku', 'nama', 'price_eceran',
    ...nonBaseTiers.flatMap(t => [`price_${t.key}_lama`, `price_${t.key}_baru`]),
  ].join(',');
}

function getTierPrice(item: StockItem, tier: TierKey): number | null {
  switch (tier) {
    case 'grosir': return item.price_grosir ?? null;
    case 'tier_3': return item.price_tier_3 ?? null;
    case 'tier_4': return item.price_tier_4 ?? null;
    default:       return null;
  }
}

export default function BulkUpdateTierPricesSection({ stockList, tenantSettings, showToast, onApplied }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [confirmAbove, setConfirmAbove] = useState(false);
  const [applying, setApplying] = useState(false);

  const nonBaseTiers = getNonBaseTiers(tenantSettings);

  const handleDownloadTemplate = () => {
    const header = buildHeader(nonBaseTiers);
    const csv = [header, ...stockList.map(s => {
      const base = `${s.sku},"${s.name.replace(/"/g, '""')}",${s.price ?? ''}`;
      const tierCols = nonBaseTiers.flatMap(t => {
        const cur = getTierPrice(s, t.key);
        return [cur ?? '', ''];
      });
      return [base, ...tierCols].join(',');
    })].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-harga-tier.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text: string): ParsedRow[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const [headerLine, ...dataLines] = lines;
    const headers = parseCsvLine(headerLine).map(h => h.trim());
    const skuMap = new Map(stockList.map(s => [s.sku, s]));

    return dataLines.map(line => {
      const cols = parseCsvLine(line);
      const colMap: Record<string, string> = {};
      headers.forEach((h, i) => { colMap[h] = cols[i] ?? ''; });

      const sku = colMap['sku']?.trim() ?? '';
      const nama = colMap['nama'] ?? '';
      const product = skuMap.get(sku);

      if (!product) {
        return {
          sku, nama,
          price_eceran: null,
          tier_lama: {}, tier_baru: {},
          status: 'SKIP_SKU_NOT_FOUND' as RowStatus,
        };
      }

      const price_eceran = product.price ?? null;
      const tier_lama: Partial<Record<TierKey, number | null>> = {};
      const tier_baru: Partial<Record<TierKey, number | null>> = {};

      let parseError = false;
      let anyChange = false;
      let aboveEceran = false;

      for (const tier of nonBaseTiers) {
        const baruKey = `price_${tier.key}_baru`;

        // lama from DB (CSV lama column is display-only; ignore it)
        tier_lama[tier.key] = getTierPrice(product, tier.key);

        // baru from CSV: if the column doesn't exist in this file, skip (backward compat)
        if (!(baruKey in colMap)) continue;
        const baruStr = (colMap[baruKey] ?? '').trim();
        if (baruStr === '') {
          // Empty = "no update for this tier this row"
          tier_baru[tier.key] = null;
          continue;
        }
        const baru = Number(baruStr);
        if (!isFinite(baru) || baru <= 0) {
          parseError = true;
          break;
        }
        tier_baru[tier.key] = baru;
        if (baru !== tier_lama[tier.key]) anyChange = true;
        if (price_eceran != null && baru > price_eceran) aboveEceran = true;
      }

      if (parseError) {
        return { sku, nama: product.name, price_eceran, tier_lama, tier_baru: {}, status: 'SKIP_INVALID_FORMAT' };
      }
      if (!anyChange) {
        return { sku, nama: product.name, price_eceran, tier_lama, tier_baru, status: 'NO_CHANGE' };
      }
      if (aboveEceran) {
        return { sku, nama: product.name, price_eceran, tier_lama, tier_baru, status: 'WARNING_ABOVE_ECERAN' };
      }
      return { sku, nama: product.name, price_eceran, tier_lama, tier_baru, status: 'OK' };
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
        .map(r => ({
          sku: r.sku,
          ...(r.tier_baru['grosir'] != null  ? { price_grosir:  r.tier_baru['grosir']  } : {}),
          ...(r.tier_baru['tier_3'] != null   ? { price_tier_3:  r.tier_baru['tier_3']  } : {}),
          ...(r.tier_baru['tier_4'] != null   ? { price_tier_4:  r.tier_baru['tier_4']  } : {}),
        }));
      const result = await productService.bulkUpdateTierPrices(payload);
      showToast(`${result.applied} produk diupdate, ${result.skipped.length} skipped`, 'success');
      setRows(null);
      onApplied();
    } catch (err) {
      showToast(`Gagal: ${(err as Error).message ?? 'unknown'}`, 'warning');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-bold text-[#012749] mb-2">Update Harga Tier (CSV)</h3>
      <p className="text-xs text-slate-500 mb-4">
        Download template, isi kolom <code>price_[tier]_baru</code> untuk setiap tier yang ingin diupdate, lalu upload kembali. Preview sebelum apply.
      </p>
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
                <tr>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">Nama</th>
                  <th className="text-right p-2">Eceran</th>
                  {nonBaseTiers.map(t => (
                    <React.Fragment key={t.key}>
                      <th className="text-right p-2">Harga {t.label} Lama</th>
                      <th className="text-right p-2">Harga {t.label} Baru</th>
                    </React.Fragment>
                  ))}
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2 font-mono">{r.sku}</td>
                    <td className="p-2">{r.nama}</td>
                    <td className="p-2 text-right">{r.price_eceran ?? '—'}</td>
                    {nonBaseTiers.map(t => (
                      <React.Fragment key={t.key}>
                        <td className="p-2 text-right">{r.tier_lama[t.key] ?? '—'}</td>
                        <td className="p-2 text-right">{r.tier_baru[t.key] ?? '—'}</td>
                      </React.Fragment>
                    ))}
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
                Saya konfirmasi update harga tier di atas eceran ({summary.warning} produk)
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
  const map: Record<RowStatus, { label: string; cls: string }> = {
    OK:                   { label: 'OK',             cls: 'text-emerald-700 bg-emerald-50' },
    WARNING_ABOVE_ECERAN: { label: 'Di atas eceran', cls: 'text-amber-700 bg-amber-50' },
    SKIP_SKU_NOT_FOUND:   { label: 'SKU tidak ada',  cls: 'text-rose-700 bg-rose-50' },
    SKIP_INVALID_FORMAT:  { label: 'Bukan numeric',  cls: 'text-rose-700 bg-rose-50' },
    NO_CHANGE:            { label: 'Tidak berubah',  cls: 'text-slate-600 bg-slate-50' },
  };
  const { label, cls } = map[s];
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{label}</span>;
}

// Minimal CSV line parser handling quoted strings.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
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
