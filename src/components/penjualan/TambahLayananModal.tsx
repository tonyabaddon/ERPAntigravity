import React, { useEffect, useState } from 'react';
import type {
  ServiceCatalogEntry,
  ServiceCatalogBOMItem,
} from '../../lib/serviceCatalog/types';
import {
  listServiceCatalog,
  attachServiceToOrder,
} from '../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { formatIDR } from '../../lib/formatIDR';
import { NumberInput } from '../ui/NumberInput';
import BOMEditor from '../pengaturan/layanan/BOMEditor';

interface Props {
  orderId: string;
  onDone: () => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function TambahLayananModal({
  orderId,
  onDone,
  onCancel,
  showToast,
}: Props) {
  const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [labor, setLabor] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);
  const [bom, setBom] = useState<ServiceCatalogBOMItem[]>([]);
  const [includeMaterial, setIncludeMaterial] = useState(true);
  const [invoiceDisplayOverride, setInvoiceDisplayOverride] = useState<
    'lump_sum' | 'itemized' | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const items = await listServiceCatalog();
        setCatalog(items.filter((i) => i.is_active));
      } catch (err) {
        showToast(`Gagal memuat: ${extractErrorMessage(err)}`, 'warning');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = catalog.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setLabor(selected.default_labor_amount * qty);
    setIncludeMaterial(selected.default_include_material);
    setInvoiceDisplayOverride(null); // fall back to catalog default
    setBom(
      selected.default_include_material
        ? selected.bom.map((b) => ({
            ...b,
            default_qty: b.default_qty * qty,
          }))
        : [],
    );
    if (finalPrice === 0) {
      setFinalPrice(selected.default_labor_amount * qty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    setLabor(selected.default_labor_amount * qty);
    setBom(
      selected.bom.map((b) => ({
        ...b,
        default_qty: b.default_qty * qty,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  async function handleSubmit() {
    if (!selectedId) {
      showToast('Pilih layanan dulu', 'warning');
      return;
    }
    if (finalPrice <= 0) {
      showToast('Harga jual harus > 0', 'warning');
      return;
    }
    setSaving(true);
    try {
      await attachServiceToOrder({
        orderId,
        serviceCatalogId: selectedId,
        qty,
        overrideBom: includeMaterial
          ? bom.map((b) => ({
              component_sku: b.component_sku,
              qty: b.default_qty,
              service_catalog_bom_id: b.id ?? null,
            }))
          : [],
        overrideLabor: labor,
        finalPrice,
        invoiceDisplayOverride,
      });
      showToast('Layanan ditambahkan ke pesanan', 'success');
      onDone();
    } catch (err) {
      showToast(`Gagal: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-[var(--color-caleo-primary)]">
            + Tambah Layanan ke Pesanan
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-[13px] text-slate-500">
              Memuat katalog layanan…
            </div>
          ) : catalog.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-slate-500 border border-dashed border-slate-300 rounded">
              Belum ada layanan aktif. Setup di Pengaturan → 🛠 Layanan dulu.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                  Pilih Layanan *
                </label>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
                >
                  <option value="">— pilih —</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.category ? `[${c.category}] ` : ''}
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {selected && (
                <>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                      Qty
                    </label>
                    <NumberInput
                      value={qty}
                      onChange={(n) => setQty(Math.max(1, n))}
                      allowDecimal={false}
                      className="w-32 border border-slate-200 rounded px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                      Labor (Rp)
                    </label>
                    <NumberInput
                      value={labor}
                      onChange={setLabor}
                      allowDecimal={false}
                      className="w-full border border-slate-200 rounded px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
                    />
                    <div className="text-[11px] text-slate-400 mt-1">
                      Default catalog:{' '}
                      {formatIDR(selected.default_labor_amount * qty)} — edit
                      kalau perlu
                    </div>
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                      Harga Jual (Rp) *
                    </label>
                    <NumberInput
                      value={finalPrice}
                      onChange={setFinalPrice}
                      allowDecimal={false}
                      className="w-full border border-slate-200 rounded px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                      Mode
                    </label>
                    <div className="flex gap-4 items-center mb-2">
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="radio"
                          checked={includeMaterial}
                          onChange={() => {
                            setIncludeMaterial(true);
                            if (selected) {
                              setBom(
                                selected.bom.map((b) => ({
                                  ...b,
                                  default_qty: b.default_qty * qty,
                                })),
                              );
                            }
                          }}
                        />
                        Paket (dengan material)
                      </label>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="radio"
                          checked={!includeMaterial}
                          onChange={() => {
                            setIncludeMaterial(false);
                            setBom([]);
                          }}
                        />
                        Labor only (customer bawa material)
                      </label>
                    </div>
                  </div>

                  {includeMaterial && (
                    <div>
                      <label className="block text-[12px] font-semibold text-slate-700 mb-2">
                        BOM Snapshot{' '}
                        {bom.length === 0 && '(kosong — labor only)'}
                      </label>
                      <BOMEditor value={bom} onChange={setBom} qtyLabel="Qty" />
                    </div>
                  )}

                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                      Invoice Display (override)
                    </label>
                    <div className="flex gap-4 items-center">
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="radio"
                          checked={invoiceDisplayOverride === null}
                          onChange={() => setInvoiceDisplayOverride(null)}
                        />
                        Default catalog ({selected.invoice_display === 'lump_sum' ? 'Lump Sum' : 'Itemized'})
                      </label>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="radio"
                          checked={invoiceDisplayOverride === 'lump_sum'}
                          onChange={() => setInvoiceDisplayOverride('lump_sum')}
                        />
                        Lump Sum
                      </label>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="radio"
                          checked={invoiceDisplayOverride === 'itemized'}
                          onChange={() => setInvoiceDisplayOverride('itemized')}
                        />
                        Itemized
                      </label>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded bg-slate-50 p-3 text-[12px]">
                    <div className="text-slate-500 mb-1">
                      Estimasi (approx — HPP sebenarnya dari FIFO saat
                      pengiriman):
                    </div>
                    <div className="font-semibold">
                      Labor: {formatIDR(labor)} · BOM: {bom.length} komponen ·
                      Total price: {formatIDR(finalPrice)}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedId}
            className="px-4 py-2 text-[13px] font-bold bg-[var(--color-caleo-primary)] text-white rounded hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Tambah ke Pesanan'}
          </button>
        </div>
      </div>
    </div>
  );
}
