import React, { useEffect, useState } from 'react';
import { companySettingsService } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';

interface Props {
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
}

type CostingMethod = 'FIFO' | 'Average';

export default function CostingMethodPanel({ showToast }: Props) {
  const tenant = useTenant();
  const [method, setMethod] = useState<CostingMethod>('FIFO');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void companySettingsService
      .getCostingMethod()
      .then(setMethod)
      .catch(() => undefined);
  }, []);

  const handleSave = async () => {
    if (!tenant) { showToast('Tenant belum dimuat.', 'warning'); return; }
    setSaving(true);
    try {
      await companySettingsService.setCostingMethod(tenant.tenant_id, method);
      showToast('Metode costing tersimpan.', 'success');
    } catch (e) {
      showToast(`Gagal simpan: ${(e as Error).message}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-sm border border-[var(--color-caleo-mist)] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)] mb-3">Metode Costing Toko</h3>
      <div className="space-y-2 mb-4">
        <label className="flex items-start gap-3 p-3 rounded-sm border border-slate-200 hover:bg-slate-50 cursor-pointer">
          <input
            type="radio"
            name="costing"
            value="FIFO"
            checked={method === 'FIFO'}
            onChange={() => setMethod('FIFO')}
            className="mt-0.5"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-[var(--color-caleo-primary)]">FIFO</span>
              <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">
                Default
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              First-In-First-Out. Setiap penjualan ambil HPP dari lot pembelian paling lama. Akurat tapi butuh
              tracking per-lot.
            </p>
          </div>
        </label>
        <label className="flex items-start gap-3 p-3 rounded-sm border border-slate-200 hover:bg-slate-50 cursor-pointer">
          <input
            type="radio"
            name="costing"
            value="Average"
            checked={method === 'Average'}
            onChange={() => setMethod('Average')}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-extrabold text-[var(--color-caleo-primary)]">Average</span>
            <p className="text-[11px] text-slate-600 mt-1">
              Rata-rata tertimbang dari semua lot. Lebih sederhana, tapi HPP &quot;blurry&quot; — gak
              mencerminkan harga lot tertentu.
            </p>
          </div>
        </label>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 mb-4 text-[11px] text-amber-900">
        Mengubah metode akan menghitung ulang HPP semua transaksi setelah tanggal perubahan. Laporan profit
        historis sebelum tanggal ini tidak berubah.
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold disabled:opacity-50"
      >
        {saving ? 'Menyimpan…' : 'Simpan'}
      </button>
    </div>
  );
}
