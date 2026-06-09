// src/components/penjualan/LockSubmissionModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { requestRakitLock, supabaseService } from '../../lib/supabaseClient';
import type { RakitJobLine, RakitTrackingMode } from '../../types';

interface LockSubmissionModalProps {
  transactionId: string;
  rakitLines: RakitJobLine[];
  currentUser: { id: string; name: string };
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type ComponentDraft = {
  key: string;  // local key for React
  sku: string;
  name: string;
  qty: number;
  warehouse: 'atas' | 'bawah';
  fifo_cost: number;
};

type LineDraft = {
  id: string;
  description: string;
  finalPrice: number;
  trackingMode: RakitTrackingMode;
  laborCost: number;
  lumpSumHpp: number;
  components: ComponentDraft[];
};

type StockOption = {
  sku: string;
  name: string;
  stock_atas: number;
  stock_bawah: number;
  harga_modal: number | null;
};

function formatRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function LockSubmissionModal({
  transactionId,
  rakitLines,
  currentUser,
  onClose,
  onSubmitted,
  showToast,
}: LockSubmissionModalProps) {
  const [drafts, setDrafts] = useState<LineDraft[]>(() =>
    rakitLines.map(l => ({
      id: l.id,
      description: l.description,
      finalPrice: l.finalPrice ?? l.estimatedPrice,
      trackingMode: l.trackingMode ?? 'detail',
      laborCost: l.laborCost ?? 0,
      lumpSumHpp: l.lumpSumHpp ?? 0,
      components: [],
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [stockOptions, setStockOptions] = useState<StockOption[]>([]);
  const [skuQuery, setSkuQuery] = useState<Record<string, string>>({});

  useEffect(() => {
    void supabaseService.fetchStocks()
      .then((rows) => {
        setStockOptions(
          (rows ?? []).map((r: any) => ({
            sku: r.sku,
            name: r.name,
            stock_atas: Number(r.stock_atas ?? 0),
            stock_bawah: Number(r.stock_bawah ?? 0),
            harga_modal: r.harga_modal == null ? null : Number(r.harga_modal),
          })),
        );
      })
      .catch((e) => {
        showToast(`Gagal load stok: ${e instanceof Error ? e.message : String(e)}`, 'warning');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = (id: string, patch: Partial<LineDraft>) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const addComponent = (lineId: string, opt: StockOption) => {
    setDrafts(prev => prev.map(d => d.id === lineId ? {
      ...d,
      components: [
        ...d.components,
        {
          key: newKey(),
          sku: opt.sku,
          name: opt.name,
          qty: 1,
          warehouse: opt.stock_atas > 0 ? 'atas' : 'bawah',
          fifo_cost: opt.harga_modal ?? 0,
        },
      ],
    } : d));
    setSkuQuery(prev => ({ ...prev, [lineId]: '' }));
  };

  const updateComponent = (lineId: string, key: string, patch: Partial<ComponentDraft>) => {
    setDrafts(prev => prev.map(d => d.id === lineId ? {
      ...d,
      components: d.components.map(c => c.key === key ? { ...c, ...patch } : c),
    } : d));
  };

  const removeComponent = (lineId: string, key: string) => {
    setDrafts(prev => prev.map(d => d.id === lineId ? {
      ...d,
      components: d.components.filter(c => c.key !== key),
    } : d));
  };

  const filteredOptions = (lineId: string): StockOption[] => {
    const q = (skuQuery[lineId] ?? '').trim().toLowerCase();
    if (!q) return [];
    return stockOptions
      .filter(o => o.sku.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      .slice(0, 8);
  };

  const canSubmit = useMemo(() => drafts.every(d =>
    d.description.trim().length > 0 &&
    d.finalPrice > 0 &&
    (d.trackingMode === 'detail'
      ? d.components.length > 0 && d.components.every(c => c.sku && c.qty > 0)
      : d.lumpSumHpp > 0)
  ), [drafts]);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await requestRakitLock({
        transaction_id: transactionId,
        lines: drafts.map(d => ({
          id: d.id,
          final_price: d.finalPrice,
          tracking_mode: d.trackingMode,
          labor_cost: d.trackingMode === 'detail' ? d.laborCost : 0,
          lump_sum_hpp: d.trackingMode === 'lumpsum' ? d.lumpSumHpp : 0,
          components: d.trackingMode === 'detail' ? d.components.map(c => ({
            sku: c.sku,
            name: c.name,
            qty: c.qty,
            warehouse: c.warehouse,
            fifo_cost: c.fifo_cost,
          })) : [],
        })),
        actor_user_id: currentUser.id,
      });
      onSubmitted();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal submit lock', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-extrabold text-lg text-[#012749]">🔒 Submit Lock untuk Approval</h2>
            <p className="text-xs text-slate-500 mt-1">
              Isi komponen + harga final. Owner akan review &amp; approve / reject.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-rose-500 text-2xl leading-none">✕</button>
        </div>

        <div className="space-y-4">
          {drafts.map(d => (
            <div key={d.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-start mb-3">
                <div>
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Deskripsi</div>
                  <input
                    type="text"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
                    value={d.description}
                    onChange={e => updateDraft(d.id, { description: e.target.value })}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Harga Final</div>
                  <input
                    type="number"
                    min={0}
                    className="w-32 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
                    value={d.finalPrice || ''}
                    onChange={e => updateDraft(d.id, { finalPrice: Number(e.target.value || 0) })}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Mode</div>
                  <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => updateDraft(d.id, { trackingMode: 'detail' })}
                      className={`px-3 py-1.5 rounded text-[12px] font-bold ${d.trackingMode === 'detail' ? 'bg-emerald-500 text-white' : 'text-slate-600'}`}
                    >
                      Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft(d.id, { trackingMode: 'lumpsum' })}
                      className={`px-3 py-1.5 rounded text-[12px] font-bold ${d.trackingMode === 'lumpsum' ? 'bg-emerald-500 text-white' : 'text-slate-600'}`}
                    >
                      Lumpsum
                    </button>
                  </div>
                </div>
              </div>

              {d.trackingMode === 'detail' ? (
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-widest">Komponen</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">Labor Cost</span>
                      <input
                        type="number"
                        min={0}
                        className="w-28 bg-white border border-slate-200 rounded px-2 py-1 text-[12px]"
                        value={d.laborCost || ''}
                        onChange={e => updateDraft(d.id, { laborCost: Number(e.target.value || 0) })}
                      />
                    </div>
                  </div>

                  {d.components.length === 0 && (
                    <div className="text-[11px] text-slate-400 italic">Belum ada komponen. Cari SKU di bawah.</div>
                  )}

                  {d.components.map(c => (
                    <div key={c.key} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-[12px] bg-slate-50 rounded-lg px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="font-bold truncate">{c.sku} — {c.name}</div>
                        <div className="text-[10px] text-slate-500">FIFO {formatRp(c.fifo_cost)}</div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        className="w-16 bg-white border border-slate-200 rounded px-2 py-1 text-[12px]"
                        value={c.qty}
                        onChange={e => updateComponent(d.id, c.key, { qty: Number(e.target.value || 1) })}
                      />
                      <div className="inline-flex rounded bg-white border border-slate-200 p-0.5">
                        <button
                          type="button"
                          onClick={() => updateComponent(d.id, c.key, { warehouse: 'atas' })}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${c.warehouse === 'atas' ? 'bg-blue-500 text-white' : 'text-slate-600'}`}
                        >Atas</button>
                        <button
                          type="button"
                          onClick={() => updateComponent(d.id, c.key, { warehouse: 'bawah' })}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${c.warehouse === 'bawah' ? 'bg-amber-500 text-white' : 'text-slate-600'}`}
                        >Bawah</button>
                      </div>
                      <div className="font-bold text-amber-700">{formatRp(c.qty * c.fifo_cost)}</div>
                      <button
                        type="button"
                        onClick={() => removeComponent(d.id, c.key)}
                        className="text-slate-300 hover:text-rose-500 text-base"
                      >✕</button>
                    </div>
                  ))}

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cari SKU / nama komponen..."
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px]"
                      value={skuQuery[d.id] ?? ''}
                      onChange={e => setSkuQuery(prev => ({ ...prev, [d.id]: e.target.value }))}
                    />
                    {(skuQuery[d.id]?.length ?? 0) > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredOptions(d.id).length === 0 ? (
                          <div className="px-3 py-2 text-[12px] text-slate-400 italic">Tidak ada SKU cocok.</div>
                        ) : (
                          filteredOptions(d.id).map(opt => (
                            <button
                              key={opt.sku}
                              type="button"
                              onClick={() => addComponent(d.id, opt)}
                              className="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 border-b last:border-b-0 border-slate-100"
                            >
                              <div className="font-bold">{opt.sku} — {opt.name}</div>
                              <div className="text-[10px] text-slate-500">Atas: {opt.stock_atas} · Bawah: {opt.stock_bawah} · HPP {formatRp(opt.harga_modal ?? 0)}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Lump Sum HPP</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
                    value={d.lumpSumHpp || ''}
                    onChange={e => updateDraft(d.id, { lumpSumHpp: Number(e.target.value || 0) })}
                  />
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    ℹ Total HPP fixed untuk line ini, tanpa per-komponen tracking.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
            Batal
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 rounded-lg text-[13px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Mengirim…' : '🔒 Submit untuk Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
