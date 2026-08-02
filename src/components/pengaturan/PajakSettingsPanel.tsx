import React, { useState, useEffect } from 'react';
import { tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { captureError } from '../../lib/captureError';
import { NumberInput } from '../ui/NumberInput';
import type { DbTenantSettings, PajakMode, JenisBadan } from '../../types';
import { wibDateString } from '../../lib/format';

interface Props { showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void; }

const UMKM_DURATION: Record<JenisBadan, number> = {
  PT: 3, CV: 4, OP: 7, KOPERASI: 3, FIRMA: 4,
};

function computeExpiresAt(jenis: JenisBadan, terdaftar: string): string {
  const start = new Date(terdaftar);
  const years = UMKM_DURATION[jenis];
  const expiry = new Date(start);
  expiry.setFullYear(start.getFullYear() + years);
  return wibDateString(expiry);
}

function timeUntil(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((target - now) / (1000 * 60 * 60 * 24)));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  if (years > 0) return `${years} tahun ${months} bulan`;
  return `${diffDays} hari`;
}

export default function PajakSettingsPanel({ showToast }: Props) {
  const [settings, setSettings] = useState<DbTenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantSettingsService.fetch()
      .then(setSettings)
      .catch(err => { captureError(err, { feature: 'pengaturan_pajak', action: 'load_pajak_settings' }); showToast('Gagal memuat pengaturan pajak', 'warning'); })
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<DbTenantSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    // Auto-recompute expires_at if jenis_badan or terdaftar_at changed.
    // C2 fix: the computed value MUST be forwarded to the DB call below, otherwise
    // local state and persisted row diverge (UMKM expiry tracking would be NULL/stale).
    if (next.pajak_umkm_jenis_badan && next.pajak_umkm_terdaftar_at) {
      next.pajak_umkm_expires_at = computeExpiresAt(next.pajak_umkm_jenis_badan, next.pajak_umkm_terdaftar_at);
    }
    setSettings(next);
    try {
      const finalPatch: Partial<DbTenantSettings> = { ...patch };
      if (next.pajak_umkm_expires_at !== settings.pajak_umkm_expires_at) {
        finalPatch.pajak_umkm_expires_at = next.pajak_umkm_expires_at;
      }
      await tenantSettingsService.updatePajak(finalPatch);
      showToast('Pengaturan pajak disimpan', 'success');
    } catch (err) {
      captureError(err, { feature: 'pengaturan_pajak', action: 'save_pajak_settings' });
      setSettings(settings);
      showToast('Gagal simpan', 'warning');
    }
  };

  if (loading || !settings) return <p className="text-sm text-slate-500 p-6">Memuat…</p>;

  return (
    <div className="space-y-6">
      {/* Mode picker */}
      <section>
        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Status Pajak Toko (regulasi 2026)</label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { v: 'FINAL_UMKM' as PajakMode, label: '🌱 UMKM',   desc: 'PPh Final 0.5% (PP 55/2022)',    color: 'emerald' },
            { v: 'PKP' as PajakMode,         label: '📊 PKP',    desc: 'PPN 11% umum (PMK 131/2024)',    color: 'blue' },
            { v: 'NON_PKP' as PajakMode,     label: '📋 Non-PKP',desc: 'PPh OP progresif',               color: 'slate' },
          ]).map(opt => (
            <button key={opt.v} onClick={() => save({ pajak_mode: opt.v })}
                    className={`border-2 rounded-sm p-4 text-left transition ${
                      settings.pajak_mode === opt.v
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}>
              <div className="font-bold text-sm">{opt.label}</div>
              <div className="text-[11px] text-slate-500 mt-1">{opt.desc}</div>
              {settings.pajak_mode === opt.v && <div className="text-[10px] text-emerald-700 mt-1 font-bold">✓ DIPILIH</div>}
            </button>
          ))}
        </div>
      </section>

      {/* Detail UMKM */}
      {settings.pajak_mode === 'FINAL_UMKM' && (
        <section className="border border-slate-200 rounded-sm p-5">
          <h3 className="font-bold text-sm text-[#012749] mb-3">🌱 Detail UMKM (PP 55/2022)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Jenis Badan Usaha</label>
              <select value={settings.pajak_umkm_jenis_badan ?? ''}
                      onChange={e => save({ pajak_umkm_jenis_badan: e.target.value as JenisBadan })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm bg-white">
                <option value="OP">OP (Orang Pribadi) — 7 tahun</option>
                <option value="PT">PT (Perseroan Terbatas) — 3 tahun</option>
                <option value="CV">CV (Persekutuan Komanditer) — 4 tahun</option>
                <option value="KOPERASI">Koperasi — 3 tahun</option>
                <option value="FIRMA">Firma — 4 tahun</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Terdaftar UMKM Sejak</label>
              <input type="date" value={settings.pajak_umkm_terdaftar_at ?? ''}
                     onChange={e => save({ pajak_umkm_terdaftar_at: e.target.value })}
                     className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm" />
            </div>
          </div>
          {settings.pajak_umkm_expires_at && (
            <div className="bg-blue-50 border border-blue-200 rounded-sm px-4 py-3 mt-4 flex items-start gap-3">
              <div className="text-2xl">⏰</div>
              <div className="text-xs text-slate-700">
                <div className="font-bold text-[#012749]">Otomatis expires: {new Date(settings.pajak_umkm_expires_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                <div className="mt-1">Kamu masih punya <strong className="text-emerald-700">{timeUntil(settings.pajak_umkm_expires_at)}</strong> sebelum harus pindah ke skema umum.</div>
                <div className="mt-2 text-[11px] text-slate-500">⚠️ 90 hari sebelum expiry, kamu akan diingatkan untuk siap-siap pindah skema.</div>
              </div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tarif PPh Final</label>
              <div className="flex items-center gap-2">
                <NumberInput value={settings.pajak_final_rate}
                       onChange={n => save({ pajak_final_rate: n })}
                       className="w-24 px-3 py-2 text-sm border border-slate-300 rounded-sm text-right" />
                <span className="text-sm font-semibold text-slate-600">% dari omzet bulanan</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* NPWP / NIK */}
      <section className="border border-slate-200 rounded-sm p-5">
        <h3 className="font-bold text-sm text-[#012749] mb-3">🆔 NPWP / NIK <span className="text-[10px] text-slate-500 italic">(Regulasi DJP Juli 2024)</span></h3>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-sm cursor-pointer hover:bg-slate-50">
            <input type="radio" checked={settings.pajak_nik_as_npwp} onChange={() => save({ pajak_nik_as_npwp: true })} className="w-4 h-4" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-800">Pakai NIK sebagai NPWP (Orang Pribadi)</div>
              <div className="text-[11px] text-slate-500">Format 16 digit.</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-sm cursor-pointer hover:bg-slate-50">
            <input type="radio" checked={!settings.pajak_nik_as_npwp} onChange={() => save({ pajak_nik_as_npwp: false })} className="w-4 h-4" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-800">NPWP legacy (15 digit)</div>
              <div className="text-[11px] text-slate-500">Untuk PT/CV/Koperasi.</div>
            </div>
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
            Nomor {settings.pajak_nik_as_npwp ? 'NIK (16 digit)' : 'NPWP (15 digit)'}
          </label>
          <input type="text" value={settings.pajak_npwp ?? ''}
                 onChange={e => save({ pajak_npwp: e.target.value.replace(/[^\d]/g, '') })}
                 maxLength={settings.pajak_nik_as_npwp ? 16 : 15}
                 className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm font-mono" />
        </div>
      </section>

      {/* Detail PKP (collapsed when not selected) */}
      {settings.pajak_mode === 'PKP' && (
        <section className="border border-slate-200 rounded-sm p-5">
          <h3 className="font-bold text-sm text-[#012749] mb-3">📊 Detail PKP (PMK 131/2024)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Terdaftar PKP Sejak</label>
              <input type="date" value={settings.pajak_pkp_registered_at ?? ''}
                     onChange={e => save({ pajak_pkp_registered_at: e.target.value })}
                     className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm" />
            </div>
            <div></div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tarif PPN Umum</label>
              <div className="flex items-center gap-2">
                <NumberInput value={settings.pajak_ppn_rate_umum}
                       onChange={n => save({ pajak_ppn_rate_umum: n })}
                       className="w-24 px-3 py-2 text-sm border border-slate-300 rounded-sm text-right" />
                <span className="text-sm text-slate-500">% (PMK 131/2024)</span>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tarif PPN Barang Mewah</label>
              <div className="flex items-center gap-2">
                <NumberInput value={settings.pajak_ppn_rate_mewah}
                       onChange={n => save({ pajak_ppn_rate_mewah: n })}
                       className="w-24 px-3 py-2 text-sm border border-slate-300 rounded-sm text-right" />
                <span className="text-sm text-slate-500">% (LBO)</span>
              </div>
            </div>
          </div>
          <div className="border border-amber-200 bg-amber-50 rounded-sm px-4 py-3 text-xs text-amber-800 mt-4">
            <strong>📅 Catatan 2026:</strong> Per PMK 131/2024 (Des 2024), PPN umum tetap 11%. 12% hanya untuk barang/jasa mewah.
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700 mt-4">
            <input type="checkbox" checked={settings.pajak_efaktur_enabled}
                   onChange={e => save({ pajak_efaktur_enabled: e.target.checked })}
                   className="mt-0.5" />
            <span><strong>Aktifkan e-Faktur 3.0</strong><br />
              <span className="text-[11px] text-slate-500">Generate XML e-Faktur. <em>Phase 1 placeholder; integrasi DJP defer V2.</em></span></span>
          </label>
          <div className="mt-3">
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Coretax ID</label>
            <input type="text" value={settings.pajak_coretax_id ?? ''}
                   onChange={e => save({ pajak_coretax_id: e.target.value })}
                   className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm" />
            <div className="text-[11px] text-slate-400 mt-1"><em>Phase 1 storage saja; real-time push defer V2.</em></div>
          </div>
        </section>
      )}

      {/* Regulation footer */}
      <section className="bg-slate-50 rounded-sm p-4 text-[11px] text-slate-500">
        <div className="font-bold text-slate-600 mb-1">📚 Regulasi yang berlaku (2026)</div>
        <ul className="space-y-0.5 list-disc list-inside">
          <li><strong>UU HPP No. 7/2021</strong> + <strong>PMK 131/2024</strong> — PPN umum 11%, mewah 12%</li>
          <li><strong>PP 55/2022</strong> — PPh Final UMKM 0.5%, batas waktu PT 3 / CV 4 / OP 7 tahun</li>
          <li><strong>DJP Juli 2024</strong> — NIK = NPWP Orang Pribadi</li>
          <li><strong>e-Faktur 3.0</strong> mandatory PKP</li>
          <li><strong>Coretax DJP 2025</strong> — integrasi V2</li>
        </ul>
      </section>
    </div>
  );
}
