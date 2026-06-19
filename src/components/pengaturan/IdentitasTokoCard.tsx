import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { fetchStoreSettings } from '../../lib/pengaturan/queries';
import { updateStoreSettings } from '../../lib/pengaturan/mutations';
import type { StoreSettings } from '../../lib/pengaturan/types';

type StoreFormState = {
  nama_toko: string;
  nama_legal: string;
  tagline: string;
  alamat_lengkap: string;
  kota: string;
  telp_wa: string;
  email: string;
  google_maps_url: string;
  npwp: string;
  logo_url: string;
};

const EMPTY_FORM: StoreFormState = {
  nama_toko: '',
  nama_legal: '',
  tagline: '',
  alamat_lengkap: '',
  kota: '',
  telp_wa: '',
  email: '',
  google_maps_url: '',
  npwp: '',
  logo_url: '',
};

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function isRlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('42501');
}

export default function IdentitasTokoCard({ showToast }: Props) {
  const [form, setForm] = useState<StoreFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchStoreSettings()
      .then(data => {
        if (cancelled) return;
        setForm({
          nama_toko: data.nama_toko ?? '',
          nama_legal: data.nama_legal ?? '',
          tagline: data.tagline ?? '',
          alamat_lengkap: data.alamat_lengkap ?? '',
          kota: data.kota ?? '',
          telp_wa: data.telp_wa ?? '',
          email: data.email ?? '',
          google_maps_url: data.google_maps_url ?? '',
          npwp: data.npwp ?? '',
          logo_url: data.logo_url ?? '',
        });
      })
      .catch(err => {
        console.error('fetchStoreSettings error:', err);
        if (!cancelled) showToast('Gagal memuat identitas toko.', 'warning');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [showToast]);

  const updateField = <K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.nama_toko.trim()) {
      showToast('Nama toko wajib diisi.', 'warning');
      return;
    }
    if (!form.alamat_lengkap.trim()) {
      showToast('Alamat lengkap wajib diisi.', 'warning');
      return;
    }
    if (!form.kota.trim()) {
      showToast('Kota wajib diisi.', 'warning');
      return;
    }
    if (!form.telp_wa.trim()) {
      showToast('Telp/WA wajib diisi.', 'warning');
      return;
    }
    setSaving(true);
    try {
      // Send empty optional fields as undefined so Postgres keeps NULL where appropriate.
      const patch: Partial<Omit<StoreSettings, 'id' | 'updated_at' | 'updated_by'>> = {
        nama_toko: form.nama_toko.trim(),
        nama_legal: form.nama_legal.trim() || undefined,
        tagline: form.tagline.trim() || undefined,
        alamat_lengkap: form.alamat_lengkap.trim(),
        kota: form.kota.trim(),
        telp_wa: form.telp_wa.trim(),
        email: form.email.trim() || undefined,
        logo_url: form.logo_url.trim() || undefined,
        google_maps_url: form.google_maps_url.trim() || undefined,
        npwp: form.npwp.trim() || undefined,
      };
      await updateStoreSettings(patch);
      showToast('Identitas toko diperbarui.', 'success');
    } catch (err) {
      console.error('updateStoreSettings error:', err);
      if (isRlsError(err)) {
        showToast('Anda harus Owner untuk mengubah identitas toko.', 'warning');
      } else {
        showToast(`Gagal menyimpan: ${(err as Error).message}`, 'warning');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#012749] flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-[#012749]">Identitas Toko</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Informasi toko yang muncul di semua dokumen PDF & WhatsApp.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Memuat…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">
                Nama Toko <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="Contoh: Sinar Elektrik"
                value={form.nama_toko}
                onChange={e => updateField('nama_toko', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Nama Legal</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="Contoh: PT Sinar Elektrik Jaya"
                value={form.nama_legal}
                onChange={e => updateField('nama_legal', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Tagline</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="Contoh: Listrik Terang, Hidup Tenang"
                value={form.tagline}
                onChange={e => updateField('tagline', e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">
                Alamat Lengkap <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 resize-none"
                placeholder="Jl. Contoh No. 1, Kelurahan, Kecamatan, Kode Pos"
                value={form.alamat_lengkap}
                onChange={e => updateField('alamat_lengkap', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                Kota <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="Contoh: Surabaya"
                value={form.kota}
                onChange={e => updateField('kota', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                Telp / WhatsApp <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="628xxxx"
                value={form.telp_wa}
                onChange={e => updateField('telp_wa', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
              <input
                type="email"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="toko@email.com"
                value={form.email}
                onChange={e => updateField('email', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Google Maps URL</label>
              <input
                type="url"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="https://maps.app.goo.gl/..."
                value={form.google_maps_url}
                onChange={e => updateField('google_maps_url', e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">NPWP</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="00.000.000.0-000.000"
                value={form.npwp}
                onChange={e => updateField('npwp', e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">Logo URL</label>
              <input
                type="url"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
                placeholder="https://..."
                value={form.logo_url}
                onChange={e => updateField('logo_url', e.target.value)}
                disabled={saving}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Isi URL manual, atau upload file via card &quot;Logo Toko&quot; di bawah.
              </p>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-[#012749] text-white rounded-full text-xs font-bold disabled:opacity-50 hover:bg-[#01365e]"
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
