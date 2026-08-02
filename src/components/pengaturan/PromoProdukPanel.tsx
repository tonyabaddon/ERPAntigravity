// PromoProdukPanel.tsx
// Full CRUD admin panel for per-SKU promo management.
// Consumes bulkUpsertStockPromo, listActivePromos from lib/promoProduk/api.ts.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  bulkUpsertStockPromo,
  listActivePromos,
  upsertStockPromo,
} from '../../lib/promoProduk/api';
import type {
  BulkUpsertResultRow,
  PromoDiscountType,
  PromoFilter,
  PromoRow,
} from '../../lib/promoProduk/types';
import { computeLinePromoDiscount } from '../../lib/promoProduk/types';
import { formatIDR } from '../../lib/formatIDR';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { wibDateString } from '../../lib/format';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface SkuOption {
  sku: string;
  name: string;
  category: string;
  price: number;
}

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PromoRow['status'] }) {
  if (status === 'active')
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
        Aktif
      </span>
    );
  if (status === 'expiring_7d')
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
        Kadaluwarsa 7 hari
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
      Kadaluwarsa
    </span>
  );
}

// ─── Promo display string ──────────────────────────────────────────────────────
function promoLabel(row: Pick<PromoRow, 'promo_discount_type' | 'promo_discount_value'>): string {
  if (row.promo_discount_type === 'PERCENT') return `${row.promo_discount_value}%`;
  return `${formatIDR(row.promo_discount_value)}/unit`;
}

// ─── Expiry display ────────────────────────────────────────────────────────────
function expiryLabel(row: PromoRow): string {
  if (!row.promo_expires_at) return '∞ permanen';
  const d = new Date(row.promo_expires_at);
  if (d < new Date()) return 'Kadaluwarsa';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── SKU autocomplete picker ───────────────────────────────────────────────────
interface SkuPickerProps {
  selected: SkuOption[];
  onAdd: (opt: SkuOption) => void;
  onRemove: (sku: string) => void;
}

function SkuPicker({ selected, onAdd, onRemove }: SkuPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkuOption[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const { data } = await supabase
        .from('stocks')
        .select('sku, name, category, price')
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(20);
      setResults((data ?? []) as SkuOption[]);
    } catch {
      // silent
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 250);
  };

  const selectedSkus = new Set(selected.map((s) => s.sku));

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">Pilih SKU</label>
      <input
        type="text"
        value={query}
        onChange={handleInput}
        placeholder="Ketik nama atau SKU…"
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {searching && <p className="text-xs text-slate-400 mt-1">Mencari…</p>}
      {results.length > 0 && (
        <div className="border border-slate-200 rounded mt-1 max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white shadow-sm">
          {results.map((opt) => (
            <div
              key={opt.sku}
              className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer"
              onClick={() => {
                if (!selectedSkus.has(opt.sku)) { onAdd(opt); setQuery(''); setResults([]); }
              }}
            >
              <div>
                <span className="text-xs font-mono text-slate-500">{opt.sku}</span>
                <span className="text-sm ml-2 text-slate-800">{opt.name}</span>
              </div>
              <div className="text-xs text-slate-500 shrink-0 ml-2">
                {formatIDR(opt.price)}
                {selectedSkus.has(opt.sku) && (
                  <span className="ml-2 text-emerald-600 font-semibold">✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s.sku}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full"
            >
              <span className="font-mono">{s.sku}</span>
              <button
                type="button"
                onClick={() => onRemove(s.sku)}
                className="text-blue-400 hover:text-blue-700 ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Add/Edit Modal ────────────────────────────────────────────────────────────
interface ModalProps {
  initialRow?: PromoRow | null; // null = add mode
  onClose: () => void;
  onSuccess: () => void;
  showToast: Props['showToast'];
}

function PromoModal({ initialRow, onClose, onSuccess, showToast }: ModalProps) {
  const isEditMode = !!initialRow;

  // SKU picker state (multi-select in add mode, single in edit)
  const [selectedSkus, setSelectedSkus] = useState<SkuOption[]>(
    initialRow
      ? [{ sku: initialRow.sku, name: initialRow.name, category: initialRow.category, price: initialRow.price }]
      : [],
  );

  const [discountType, setDiscountType] = useState<PromoDiscountType>(
    initialRow?.promo_discount_type ?? 'PERCENT',
  );
  const [discountValue, setDiscountValue] = useState<string>(
    initialRow ? String(initialRow.promo_discount_value) : '',
  );
  const [expiryMode, setExpiryMode] = useState<'forever' | 'date'>(
    initialRow?.promo_expires_at ? 'date' : 'forever',
  );
  const [expiryDate, setExpiryDate] = useState<string>(
    initialRow?.promo_expires_at
      ? initialRow.promo_expires_at.slice(0, 10)
      : '',
  );
  const [saving, setSaving] = useState(false);

  const numValue = parseFloat(discountValue);

  // Validation
  const validationError = (() => {
    if (selectedSkus.length === 0) return 'Pilih minimal 1 SKU.';
    if (!discountValue || isNaN(numValue) || numValue <= 0) return 'Nilai diskon harus > 0.';
    if (discountType === 'PERCENT' && (numValue < 0.01 || numValue > 100))
      return 'Persen harus 0.01 – 100.';
    if (discountType === 'AMOUNT') {
      const minPrice = Math.min(...selectedSkus.map((s) => s.price));
      if (numValue > minPrice)
        return `Diskon nominal (${formatIDR(numValue)}) melebihi harga terendah SKU yang dipilih (${formatIDR(minPrice)}).`;
    }
    if (expiryMode === 'date') {
      if (!expiryDate) return 'Pilih tanggal kadaluwarsa.';
      if (new Date(expiryDate) <= new Date()) return 'Tanggal kadaluwarsa harus di masa depan.';
    }
    return null;
  })();

  const handleSubmit = async () => {
    if (validationError) { showToast(validationError, 'warning'); return; }
    setSaving(true);
    try {
      const expiresAt = expiryMode === 'date' ? new Date(expiryDate).toISOString() : null;

      if (isEditMode) {
        await upsertStockPromo({
          sku: initialRow!.sku,
          promoDiscountType: discountType,
          promoDiscountValue: numValue,
          promoExpiresAt: expiresAt,
        });
        showToast('Promo berhasil diperbarui', 'success');
        onSuccess();
      } else {
        const results: BulkUpsertResultRow[] = await bulkUpsertStockPromo({
          skus: selectedSkus.map((s) => s.sku),
          promoDiscountType: discountType,
          promoDiscountValue: numValue,
          promoExpiresAt: expiresAt,
        });
        const ok = results.filter((r) => r.ok).length;
        const fail = results.filter((r) => !r.ok).length;
        if (fail === 0) {
          showToast(`${ok} SKU berhasil disetel promo`, 'success');
          onSuccess();
        } else {
          showToast(`${ok} berhasil, ${fail} gagal`, 'warning');
          if (ok > 0) onSuccess();
        }
      }
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal simpan: ${msg}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-sm shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-100 px-5 py-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">
            {isEditMode ? `Edit Promo — ${initialRow!.sku}` : 'Tambah Promo Baru'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* SKU picker */}
          {!isEditMode ? (
            <SkuPicker
              selected={selectedSkus}
              onAdd={(opt) => setSelectedSkus((prev) => [...prev, opt])}
              onRemove={(sku) => setSelectedSkus((prev) => prev.filter((s) => s.sku !== sku))}
            />
          ) : (
            <div>
              <span className="text-xs font-semibold text-slate-500">SKU</span>
              <div className="mt-1 text-sm font-mono text-slate-800">
                {initialRow!.sku} — {initialRow!.name}
              </div>
            </div>
          )}

          {/* Discount type toggle */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Jenis Diskon</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDiscountType('PERCENT')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  discountType === 'PERCENT'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Persentase (%)
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('AMOUNT')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  discountType === 'AMOUNT'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Nominal (Rp/unit)
              </button>
            </div>
          </div>

          {/* Discount value input */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Nilai Diskon {discountType === 'PERCENT' ? '(%)' : '(Rp per unit)'}
            </label>
            <div className="flex items-center gap-2">
              {discountType === 'AMOUNT' && (
                <span className="text-sm text-slate-500 shrink-0">Rp</span>
              )}
              <input
                type="number"
                min={0.01}
                step={discountType === 'PERCENT' ? 0.01 : 100}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'PERCENT' ? 'Misal: 10' : 'Misal: 5000'}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {discountType === 'PERCENT' && (
                <span className="text-sm text-slate-500 shrink-0">%</span>
              )}
            </div>
          </div>

          {/* Expiry mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Berlaku hingga
            </label>
            <div className="flex gap-3 mb-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={expiryMode === 'forever'}
                  onChange={() => { setExpiryMode('forever'); setExpiryDate(''); }}
                />
                Selamanya (tidak ada batas)
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={expiryMode === 'date'}
                  onChange={() => setExpiryMode('date')}
                />
                Tentukan tanggal
              </label>
            </div>
            {expiryMode === 'date' && (
              <input
                type="date"
                value={expiryDate}
                min={wibDateString()}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            )}
          </div>

          {/* Preview */}
          {selectedSkus.length > 0 && !isNaN(numValue) && numValue > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">Preview diskon per SKU</div>
              <div className="border border-slate-200 rounded divide-y divide-slate-100 bg-slate-50/50">
                {selectedSkus.map((s) => {
                  const { discount } = computeLinePromoDiscount(s.price, 1, {
                    promo_discount_type: discountType,
                    promo_discount_value: numValue,
                  });
                  return (
                    <div key={s.sku} className="px-3 py-2 flex items-center justify-between">
                      <div className="text-xs">
                        <span className="font-mono text-slate-500">{s.sku}</span>
                        <span className="ml-1 text-slate-700">{s.name}</span>
                        <span className="ml-1 text-slate-400">({formatIDR(s.price)})</span>
                      </div>
                      <div className="text-xs font-semibold text-emerald-700 shrink-0 ml-2">
                        hemat {formatIDR(discount)}/unit
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {validationError && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {validationError}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-600 bg-slate-100 rounded-sm hover:bg-slate-200"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={saving || !!validationError}
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : isEditMode ? 'Simpan perubahan' : 'Tambah promo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────────
export default function PromoProdukPanel({ showToast }: Props) {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PromoFilter>('active');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<PromoRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (f: PromoFilter) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await listActivePromos(f);
      setRows(data);
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal memuat promo: ${msg}`, 'warning');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(filter); }, [filter, load]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  const toggleSelect = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.sku)));
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Hapus promo untuk ${selected.size} SKU?`)) return;
    setDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const sku of selected) {
      try {
        await upsertStockPromo({ sku, promoDiscountType: null, promoDiscountValue: null, promoExpiresAt: null });
        ok++;
      } catch {
        fail++;
      }
    }
    setDeleting(false);
    showToast(
      fail === 0 ? `${ok} promo berhasil dihapus` : `${ok} berhasil, ${fail} gagal`,
      fail === 0 ? 'success' : 'warning',
    );
    void load(filter);
  };

  const handleDelete = async (sku: string) => {
    if (!window.confirm(`Hapus promo untuk SKU ${sku}?`)) return;
    try {
      await upsertStockPromo({ sku, promoDiscountType: null, promoDiscountValue: null, promoExpiresAt: null });
      showToast('Promo berhasil dihapus', 'success');
      void load(filter);
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal hapus: ${msg}`, 'warning');
    }
  };

  return (
    <div className="space-y-4" id="promo-produk">
      {/* Header row */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => { setEditRow(null); setShowModal(true); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-sm hover:bg-blue-700 shrink-0"
        >
          + Tambah Promo
        </button>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari SKU atau nama…"
          className="flex-1 min-w-40 border border-slate-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as PromoFilter)}
          className="border border-slate-300 rounded-sm px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="active">Aktif</option>
          <option value="expiring_7d">Kadaluwarsa 7 hari</option>
          <option value="expired">Sudah kadaluwarsa</option>
          <option value="all">Semua</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">SKU</th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">Nama</th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">Kategori</th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">Promo</th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">Berlaku hingga</th>
              <th className="px-3 py-2 text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                  Memuat…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  {rows.length === 0
                    ? 'Belum ada SKU dengan promo. Klik + Tambah Promo untuk mulai.'
                    : 'Tidak ada hasil untuk pencarian ini.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.sku} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.sku)}
                      onChange={() => toggleSelect(row.sku)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.sku}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{row.category}</td>
                  <td className="px-3 py-2 font-semibold text-blue-700">{promoLabel(row)}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{expiryLabel(row)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2">
                    <RowMenu
                      onEdit={() => { setEditRow(row); setShowModal(true); }}
                      onDelete={() => handleDelete(row.sku)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-sm text-sm">
          <span className="font-semibold text-blue-800">{selected.size} dipilih</span>
          <button
            type="button"
            disabled={deleting}
            onClick={handleBulkDelete}
            className="px-3 py-1.5 bg-rose-600 text-white rounded-sm text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {deleting ? 'Menghapus…' : 'Hapus'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 bg-white text-slate-600 border border-slate-300 rounded-sm text-xs font-semibold hover:bg-slate-50"
          >
            Batal
          </button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <PromoModal
          initialRow={editRow}
          onClose={() => { setShowModal(false); setEditRow(null); }}
          onSuccess={() => { setShowModal(false); setEditRow(null); void load(filter); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Row ⋯ menu ────────────────────────────────────────────────────────────────
function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-slate-400 hover:text-slate-700 px-1 py-0.5 rounded text-base leading-none"
        title="Aksi"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-10 bg-white border border-slate-200 rounded-sm shadow-lg min-w-[110px] overflow-hidden">
          <button
            type="button"
            onClick={() => { onEdit(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-600"
          >
            Hapus
          </button>
        </div>
      )}
    </div>
  );
}
