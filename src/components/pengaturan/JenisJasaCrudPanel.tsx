import React, { useState, useEffect } from 'react';
import { serviceTypesService } from '../../lib/pengaturan/pengaturanServices';
import type { DbServiceType, PricingModel } from '../../types';
import { captureError } from '../../lib/captureError';

interface Props { showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void; }

const COLOR_OPTIONS = [
  { hex: '#9333EA', label: 'Ungu' },
  { hex: '#0EA5E9', label: 'Biru' },
  { hex: '#10B981', label: 'Hijau' },
  { hex: '#F59E0B', label: 'Amber' },
  { hex: '#EF4444', label: 'Merah' },
];

export default function JenisJasaCrudPanel({ showToast }: Props) {
  const [items, setItems] = useState<DbServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DbServiceType | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    serviceTypesService.fetchAll()
      .then(setItems)
      .catch(err => { captureError(err, { feature: 'pengaturan_jenis_jasa', action: 'load_service_types' }); showToast('Gagal memuat jenis jasa', 'warning'); })
      .finally(() => setLoading(false));
  }, []);

  const reload = async () => {
    try { setItems(await serviceTypesService.fetchAll()); } catch (err) { captureError(err, { feature: 'pengaturan_jenis_jasa', action: 'reload_service_types' }); }
  };

  const handleSave = async (input: Partial<DbServiceType>) => {
    try {
      if (input.id) {
        await serviceTypesService.update(input.id, input);
        showToast('Jenis jasa diupdate', 'success');
      } else {
        await serviceTypesService.create({
          code: input.code!, name: input.name!,
          description: input.description ?? null,
          pricing_model: input.pricing_model ?? 'LUMP_SUM',
          requires_material_lock: input.requires_material_lock ?? false,
          default_account_revenue: null, default_account_cogs: null,
          color_hex: input.color_hex ?? '#9333EA',
          is_active: true, display_order: items.length + 1,
        });
        showToast('Jenis jasa ditambahkan', 'success');
      }
      await reload();
      setEditing(null);
      setShowAdd(false);
    } catch (err) {
      captureError(err, { feature: 'pengaturan_jenis_jasa', action: 'save_service_type' });
      showToast('Gagal simpan', 'warning');
    }
  };

  if (loading) return <p className="text-sm text-slate-500 p-6">Memuat…</p>;

  return (
    <div className="space-y-3">
      {items.map(s => (
        <div key={s.id} className="border rounded p-4 flex items-center justify-between gap-4"
             style={{ borderColor: s.color_hex ?? '#cbd5e1' }}>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded flex items-center justify-center text-white font-bold"
                 style={{ backgroundColor: s.color_hex ?? 'var(--color-caleo-primary)' }}>
              {s.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div>
              <div className="font-bold text-sm text-[var(--color-caleo-primary)]">{s.name}</div>
              <div className="text-caleo-11 text-slate-600 mt-0.5">
                {s.pricing_model.replace('_', ' ')} · {s.requires_material_lock ? '🔒 Lock material Owner approval' : 'Tanpa lock'} · <code className="bg-slate-100 px-1 rounded">{s.code}</code>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-caleo-11 font-bold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
              {s.is_active ? 'AKTIF' : 'NON-AKTIF'}
            </span>
            <button onClick={() => setEditing(s)} className="text-xs font-semibold text-slate-500 hover:text-[var(--color-caleo-primary)] px-2 py-1">Edit</button>
            <button
              onClick={async () => {
                if (confirm(`Nonaktifkan ${s.name}?`)) {
                  await serviceTypesService.deactivate(s.id);
                  await reload();
                  showToast('Jenis jasa dinonaktifkan', 'success');
                }
              }}
              className="text-xs font-semibold text-rose-500 hover:text-rose-700 px-2 py-1">
              Hapus
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => setShowAdd(true)}
        className="w-full border-2 border-dashed border-slate-300 rounded py-4 text-sm font-bold text-slate-500 hover:border-[var(--color-caleo-primary)] hover:text-[var(--color-caleo-primary)] hover:bg-slate-50">
        + Tambah Jenis Jasa Baru
      </button>

      {(editing || showAdd) && (
        <JasaEditModal
          item={editing}
          onClose={() => { setEditing(null); setShowAdd(false); }}
          onSave={handleSave}
          colorOptions={COLOR_OPTIONS}
        />
      )}
    </div>
  );
}

interface ModalProps {
  item: DbServiceType | null;
  onClose: () => void;
  onSave: (input: Partial<DbServiceType>) => Promise<void>;
  colorOptions: Array<{ hex: string; label: string }>;
}
function JasaEditModal({ item, onClose, onSave, colorOptions }: ModalProps) {
  const [form, setForm] = useState({
    id: item?.id,
    name: item?.name ?? '',
    code: item?.code ?? '',
    description: item?.description ?? '',
    pricing_model: (item?.pricing_model ?? 'LUMP_SUM') as PricingModel,
    requires_material_lock: item?.requires_material_lock ?? false,
    color_hex: item?.color_hex ?? '#9333EA',
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded p-6 max-w-xl w-full" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-base text-[var(--color-caleo-primary)] mb-4">{item ? 'Edit' : 'Tambah'} Jenis Jasa</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-caleo-11 font-bold text-slate-500 uppercase mb-1">Nama Jasa</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                   className="w-full px-3 py-2 text-sm border border-slate-300 rounded" />
          </div>
          <div>
            <label className="block text-caleo-11 font-bold text-slate-500 uppercase mb-1">Kode Internal</label>
            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                   className="w-full px-3 py-2 text-sm border border-slate-300 rounded font-mono bg-slate-50"
                   placeholder="custom_panel" />
          </div>
          <div>
            <label className="block text-caleo-11 font-bold text-slate-500 uppercase mb-1">Penjelasan</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                      rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded" />
          </div>
          <div>
            <label className="block text-caleo-11 font-bold text-slate-500 uppercase mb-1">Model Harga</label>
            <div className="grid grid-cols-4 gap-2">
              {(['LUMP_SUM', 'PER_HOUR', 'PER_METER', 'PER_UNIT'] as const).map(m => (
                <button key={m} onClick={() => setForm({ ...form, pricing_model: m })}
                        className={`px-3 py-2 text-xs font-bold rounded ${
                          form.pricing_model === m
                            ? 'border-2 border-[var(--color-caleo-primary)] bg-[var(--color-caleo-primary)]/5 text-[var(--color-caleo-primary)]'
                            : 'border border-slate-300 text-slate-500 hover:border-slate-400'
                        }`}>
                  {m.replace('_', '-')}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={form.requires_material_lock}
                   onChange={e => setForm({ ...form, requires_material_lock: e.target.checked })}
                   className="mt-0.5" />
            <span><strong>Butuh lock material?</strong><br />
              <span className="text-caleo-11 text-slate-500">Saat dipakai, Owner approve dulu untuk lock material di gudang.</span></span>
          </label>
          <div>
            <label className="block text-caleo-11 font-bold text-slate-500 uppercase mb-1">Warna Tombol di Wizard</label>
            <div className="flex gap-2">
              {colorOptions.map(c => (
                <button key={c.hex} onClick={() => setForm({ ...form, color_hex: c.hex })} title={c.label}
                        className={`w-8 h-8 rounded-full ${form.color_hex === c.hex ? 'ring-2 ring-offset-2' : ''}`}
                        style={{ backgroundColor: c.hex, '--tw-ring-color': c.hex } as React.CSSProperties} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700">Batal</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 text-xs font-bold text-white bg-[var(--color-caleo-primary)] rounded">Simpan</button>
        </div>
      </div>
    </div>
  );
}
