import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import type {
  ServiceCatalogEntry,
  ServiceCatalogSavePayload,
  ServiceCatalogBOMItem,
} from '../../../lib/serviceCatalog/types';
import { saveServiceCatalog } from '../../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { NumberInput } from '../../ui/NumberInput';
import BOMEditor from './BOMEditor';

interface Props {
  initial: ServiceCatalogEntry | null;
  onDone: () => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface COAOption {
  account_code: string;
  account_name: string;
  account_type: string;
}

export default function ServiceCatalogEditModal({
  initial,
  onDone,
  onCancel,
  showToast,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'Wiring');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [defaultLabor, setDefaultLabor] = useState(
    initial?.default_labor_amount ?? 0,
  );
  const [defaultIncludeMaterial, setDefaultIncludeMaterial] = useState(
    initial?.default_include_material ?? true,
  );
  const [invoiceDisplay, setInvoiceDisplay] = useState<'lump_sum' | 'itemized'>(
    initial?.invoice_display ?? 'lump_sum',
  );
  const [revenueCoa, setRevenueCoa] = useState(
    initial?.revenue_coa_code ?? '4-1300',
  );
  const [laborCoa, setLaborCoa] = useState(
    initial?.labor_cost_coa_code ?? '5-2110',
  );
  const [bom, setBom] = useState<ServiceCatalogBOMItem[]>(initial?.bom ?? []);
  const [saving, setSaving] = useState(false);

  const [revenueCoaOptions, setRevenueCoaOptions] = useState<COAOption[]>([]);
  const [laborCoaOptions, setLaborCoaOptions] = useState<COAOption[]>([]);

  useEffect(() => {
    void (async () => {
      const { data: rev } = await supabase
        .from('chart_of_accounts')
        .select('account_code, account_name, account_type')
        .eq('account_type', 'PENDAPATAN')
        .eq('is_active', true)
        .eq('is_control_account', false)
        .order('account_code');
      setRevenueCoaOptions((rev ?? []) as COAOption[]);

      const { data: exp } = await supabase
        .from('chart_of_accounts')
        .select('account_code, account_name, account_type')
        .eq('account_type', 'BEBAN')
        .eq('is_active', true)
        .eq('is_control_account', false)
        .order('account_code');
      setLaborCoaOptions((exp ?? []) as COAOption[]);
    })();
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      showToast('Nama layanan wajib diisi', 'warning');
      return;
    }
    if (!revenueCoa || !laborCoa) {
      showToast('Akun Pendapatan dan Beban Labor wajib dipilih', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload: ServiceCatalogSavePayload = {
        id: initial?.id ?? null,
        name: name.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        default_labor_amount: defaultLabor,
        default_include_material: defaultIncludeMaterial,
        invoice_display: invoiceDisplay,
        revenue_coa_code: revenueCoa,
        labor_cost_coa_code: laborCoa,
        is_active: true,
        bom: bom.map((b, i) => ({ ...b, sort_order: i })),
      };
      await saveServiceCatalog(payload);
      showToast(`Layanan "${name}" berhasil disimpan`, 'success');
      onDone();
    } catch (err) {
      showToast(`Gagal simpan: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-sm shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-[var(--color-caleo-primary)]">
            {initial ? 'Edit Layanan' : 'Tambah Layanan Baru'}
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Nama Layanan *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Wiring Panel MDB 3-fase 100A"
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Kategori
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Wiring"
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">
              Deskripsi (opsional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Labor Default (Rp)
              </label>
              <NumberInput
                value={defaultLabor}
                onChange={setDefaultLabor}
                allowDecimal={false}
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Include Material Default
              </label>
              <div className="flex gap-4 items-center pt-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    checked={defaultIncludeMaterial}
                    onChange={() => setDefaultIncludeMaterial(true)}
                  />
                  Ya
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    checked={!defaultIncludeMaterial}
                    onChange={() => setDefaultIncludeMaterial(false)}
                  />
                  Tidak (labor-only)
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">
              Invoice Display
            </label>
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  checked={invoiceDisplay === 'lump_sum'}
                  onChange={() => setInvoiceDisplay('lump_sum')}
                />
                Lump Sum (satu baris)
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  checked={invoiceDisplay === 'itemized'}
                  onChange={() => setInvoiceDisplay('itemized')}
                />
                Itemized (show BOM)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Akun Pendapatan *
              </label>
              <select
                value={revenueCoa}
                onChange={(e) => setRevenueCoa(e.target.value)}
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              >
                {revenueCoaOptions.map((opt) => (
                  <option key={opt.account_code} value={opt.account_code}>
                    {opt.account_code} — {opt.account_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1">
                Akun Beban Labor *
              </label>
              <select
                value={laborCoa}
                onChange={(e) => setLaborCoa(e.target.value)}
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              >
                {laborCoaOptions.map((opt) => (
                  <option key={opt.account_code} value={opt.account_code}>
                    {opt.account_code} — {opt.account_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-2">
              BOM Komponen
            </label>
            <BOMEditor value={bom} onChange={setBom} qtyLabel="Qty default" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded-sm hover:bg-slate-200"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-[13px] font-bold bg-[var(--color-caleo-primary)] text-white rounded-sm hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
