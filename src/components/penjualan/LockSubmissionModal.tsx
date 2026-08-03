// src/components/penjualan/LockSubmissionModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { requestRakitLock, approveAndAmendRakitLock, supabaseService } from '../../lib/supabaseClient';
import type { RakitJobLine, RakitTrackingMode, RakitComponent } from '../../types';
import { useWarehouses } from '../../hooks/useWarehouses';
import WarehousePicker from '../warehouse/WarehousePicker';
import { formatIDR } from '../../lib/formatIDR';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import EmptyState from '../ui/EmptyState';

interface LockSubmissionModalProps {
  transactionId: string;
  rakitLines: RakitJobLine[];
  currentUser: { id: string; name: string };
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /**
   * 'admin-submit' (default): Submit calls requestRakitLock (creates approval).
   * 'owner-amend': Submit calls approveAndAmendRakitLock (Owner edits + approves
   * in one tx). When set, `approvalId` is required and `rakitLines` is expected
   * to be seeded from the approval snapshot (components already populated).
   */
  mode?: 'admin-submit' | 'owner-amend';
  /** Required when mode === 'owner-amend' — the approval row to amend + approve. */
  approvalId?: number;
}

type ComponentDraft = {
  key: string;  // local key for React
  sku: string;
  name: string;
  qty: number;
  warehouse_id: string;
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
  mode = 'admin-submit',
  approvalId,
}: LockSubmissionModalProps) {
  const [drafts, setDrafts] = useState<LineDraft[]>(() =>
    rakitLines.map(l => ({
      id: l.id,
      description: l.description,
      finalPrice: l.finalPrice ?? l.estimatedPrice,
      trackingMode: l.trackingMode ?? 'detail',
      laborCost: l.laborCost ?? 0,
      lumpSumHpp: l.lumpSumHpp ?? 0,
      // In owner-amend mode the parent seeds `l.components` from the approval
      // snapshot (which already stores warehouse_id + fifo_cost). In
      // admin-submit mode the parent doesn't seed components — Admin picks
      // them via the SKU search. Empty array on absent for both paths.
      components: (l.components ?? []).map(c => ({
        key: newKey(),
        sku: c.sku,
        name: c.name,
        qty: c.qty,
        warehouse_id: (c as RakitComponent & { warehouse_id?: string }).warehouse_id ?? '',
        fifo_cost: (c as RakitComponent & { fifo_cost?: number }).fifo_cost ?? c.fifoCostSnapshot ?? 0,
      })),
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [stockOptions, setStockOptions] = useState<StockOption[]>([]);
  const [skuQuery, setSkuQuery] = useState<Record<string, string>>({});
  const { warehouses } = useWarehouses();

  useEffect(() => {
    void supabaseService.fetchStocks()
      .then((rows) => {
        setStockOptions(
          (rows ?? []).map((r) => ({
            sku: r.sku,
            name: r.name,
            stock_atas: Number(r.stock_atas ?? 0),
            stock_bawah: Number(r.stock_bawah ?? 0),
            harga_modal: r.harga_modal == null ? null : Number(r.harga_modal),
          })),
        );
      })
      .catch((e) => {
        showToast(`Gagal load stok: ${extractErrorMessage(e)}`, 'warning');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = (id: string, patch: Partial<LineDraft>) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const addComponent = (lineId: string, opt: StockOption) => {
    const defaultWh = warehouses.find(w => w.is_default) ?? warehouses[0];
    setDrafts(prev => prev.map(d => d.id === lineId ? {
      ...d,
      components: [
        ...d.components,
        {
          key: newKey(),
          sku: opt.sku,
          name: opt.name,
          qty: 1,
          warehouse_id: defaultWh?.id ?? '',
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

  // Description is metadata set when the rakit_job_line was originally created
  // (e.g. by admin during CP/RP order creation); it isn't part of the snapshot
  // payload that owner-amend mode hydrates from, so requiring it would
  // permanently disable Submit in the inbox edit flow. Drop the description
  // gate — admin-submit drafts inherit description from props anyway.
  const canSubmit = useMemo(() => drafts.every(d =>
    d.finalPrice > 0 &&
    (d.trackingMode === 'detail'
      ? d.components.length > 0 && d.components.every(c => c.sku && c.qty > 0)
      : d.lumpSumHpp > 0)
  ), [drafts]);

  const submit = async () => {
    if (!canSubmit || submitting) return;

    // Guard: validate all components have a warehouse and it's atas/bawah-compatible
    // (the submit_rakit_lock RPC still reads legacy warehouse text; non-atas/bawah
    // warehouses are blocked until the rakit RPC is migrated in Phase 3).
    for (const line of drafts) {
      if (line.trackingMode !== 'detail') continue;
      for (const c of line.components) {
        const wh = warehouses.find(w => w.id === c.warehouse_id);
        if (!wh) {
          showToast('Pilih gudang untuk setiap komponen', 'warning');
          return;
        }
        const code = wh.code.toLowerCase();
        if (code !== 'atas' && code !== 'bawah') {
          showToast(
            `Komponen di gudang ${wh.name} belum bisa di-lock — pakai ATAS atau BAWAH dulu (sementara, sampai migrasi Rakit Lock selesai)`,
            'warning',
          );
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const linesPayload = drafts.map(d => ({
        id: d.id,
        final_price: d.finalPrice,
        tracking_mode: d.trackingMode,
        labor_cost: d.trackingMode === 'detail' ? d.laborCost : 0,
        lump_sum_hpp: d.trackingMode === 'lumpsum' ? d.lumpSumHpp : 0,
        components: d.trackingMode === 'detail' ? d.components.map(c => {
          const wh = warehouses.find(w => w.id === c.warehouse_id);
          return {
            sku: c.sku,
            name: c.name,
            qty: c.qty,
            warehouse: (wh?.code.toLowerCase() ?? 'atas') as 'atas' | 'bawah',  // legacy text — current RPC reads this
            warehouse_id: c.warehouse_id,                  // future: when RPC migrates
            fifo_cost: c.fifo_cost,
          };
        }) : [],
      }));

      if (mode === 'owner-amend') {
        if (!approvalId) {
          throw new Error('approvalId required in owner-amend mode');
        }
        await approveAndAmendRakitLock(approvalId, linesPayload);
        showToast('Biaya final di-approve dengan edit.', 'success');
      } else {
        await requestRakitLock({
          transaction_id: transactionId,
          lines: linesPayload,
          actor_user_id: currentUser.id,
        });
      }
      onSubmitted();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal submit lock', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded shadow-2xl max-w-3xl w-full p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-extrabold text-lg text-[var(--color-caleo-primary)]">
              {mode === 'owner-amend' ? '✏️ Edit Biaya Final (Owner)' : '🔒 Submit Lock untuk Approval'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {mode === 'owner-amend'
                ? 'Edit nilai jika perlu, lalu Submit untuk approve sekaligus.'
                : 'Isi komponen + harga final. Owner akan review & approve / reject.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-caleo-danger text-2xl leading-none">✕</button>
        </div>

        <div className="space-y-4">
          {drafts.map(d => (
            <div key={d.id} className="border border-slate-200 rounded p-4 bg-slate-50/40">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-start mb-3">
                <div>
                  <div className="text-caleo-10 font-extrabold text-slate-500 uppercase tracking-widest mb-1">Deskripsi</div>
                  <input
                    type="text"
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-caleo-13"
                    value={d.description}
                    onChange={e => updateDraft(d.id, { description: e.target.value })}
                  />
                </div>
                <div>
                  <div className="text-caleo-10 font-extrabold text-slate-500 uppercase tracking-widest mb-1">Harga Final</div>
                  <input
                    type="number"
                    min={0}
                    className="w-32 bg-white border border-slate-200 rounded px-3 py-2 text-caleo-13"
                    value={d.finalPrice || ''}
                    onChange={e => updateDraft(d.id, { finalPrice: Number(e.target.value || 0) })}
                  />
                </div>
                <div>
                  <div className="text-caleo-10 font-extrabold text-slate-500 uppercase tracking-widest mb-1">Mode</div>
                  <div className="inline-flex rounded bg-white border border-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => updateDraft(d.id, { trackingMode: 'detail' })}
                      className={`px-3 py-1.5 rounded text-xs font-bold ${d.trackingMode === 'detail' ? 'bg-emerald-500 text-white' : 'text-slate-600'}`}
                    >
                      Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft(d.id, { trackingMode: 'lumpsum' })}
                      className={`px-3 py-1.5 rounded text-xs font-bold ${d.trackingMode === 'lumpsum' ? 'bg-emerald-500 text-white' : 'text-slate-600'}`}
                    >
                      Lumpsum
                    </button>
                  </div>
                </div>
              </div>

              {d.trackingMode === 'detail' ? (
                <div className="bg-white border border-slate-200 rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-caleo-11 font-extrabold text-slate-600 uppercase tracking-widest">Komponen</span>
                    <div className="flex items-center gap-2">
                      <span className="text-caleo-10 text-slate-500">Labor Cost</span>
                      <input
                        type="number"
                        min={0}
                        className="w-28 bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                        value={d.laborCost || ''}
                        onChange={e => updateDraft(d.id, { laborCost: Number(e.target.value || 0) })}
                      />
                    </div>
                  </div>

                  {d.components.length === 0 && (
                    <EmptyState inline message="Belum ada komponen. Cari SKU di bawah." />
                  )}

                  {d.components.map(c => (
                    <div key={c.key} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-xs bg-slate-50 rounded px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="font-bold truncate">{c.sku} — {c.name}</div>
                        <div className="text-caleo-10 text-slate-500">FIFO {formatIDR(c.fifo_cost)}</div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        className="w-16 bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                        value={c.qty}
                        onChange={e => updateComponent(d.id, c.key, { qty: Number(e.target.value || 1) })}
                      />
                      <WarehousePicker
                        mode="single"
                        warehouses={warehouses}
                        value={c.warehouse_id || null}
                        onChange={(id) => updateComponent(d.id, c.key, { warehouse_id: id })}
                      />
                      <div className="font-bold text-amber-700">{formatIDR(c.qty * c.fifo_cost)}</div>
                      <button
                        type="button"
                        onClick={() => removeComponent(d.id, c.key)}
                        className="text-slate-300 hover:text-caleo-danger text-base"
                      >✕</button>
                    </div>
                  ))}

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cari SKU / nama komponen..."
                      className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs"
                      value={skuQuery[d.id] ?? ''}
                      onChange={e => setSkuQuery(prev => ({ ...prev, [d.id]: e.target.value }))}
                    />
                    {(skuQuery[d.id]?.length ?? 0) > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-48 overflow-y-auto">
                        {filteredOptions(d.id).length === 0 ? (
                          <EmptyState inline message="Tidak ada SKU cocok." className="px-3" />
                        ) : (
                          filteredOptions(d.id).map(opt => (
                            <button
                              key={opt.sku}
                              type="button"
                              onClick={() => addComponent(d.id, opt)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b last:border-b-0 border-slate-100"
                            >
                              <div className="font-bold">{opt.sku} — {opt.name}</div>
                              <div className="text-caleo-10 text-slate-500">Atas: {opt.stock_atas} · Bawah: {opt.stock_bawah} · HPP {formatIDR(opt.harga_modal ?? 0)}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded p-3">
                  <div className="text-caleo-10 font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Lump Sum HPP</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-caleo-13"
                    value={d.lumpSumHpp || ''}
                    onChange={e => updateDraft(d.id, { lumpSumHpp: Number(e.target.value || 0) })}
                  />
                  <div className="text-caleo-11 text-slate-500 mt-1.5">
                    ℹ Total HPP fixed untuk line ini, tanpa per-komponen tracking.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded text-caleo-13 font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
            Batal
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 rounded text-caleo-13 font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? 'Mengirim…'
              : mode === 'owner-amend'
              ? '✅ Approve dengan Edit'
              : '🔒 Submit untuk Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
