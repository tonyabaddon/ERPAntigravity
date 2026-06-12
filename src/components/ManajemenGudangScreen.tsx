// src/components/ManajemenGudangScreen.tsx
// Three sections: Daftar Gudang (table), Tambah Gudang (inline form), Riwayat Perubahan (audit feed).
// Permission-gated via can_manage_warehouses.

import React, { useEffect, useState } from 'react';
import { Plus, Crown, Trash2 } from 'lucide-react';
import type { PermissionSet, Warehouse, WarehouseAuditLogRow } from '../types';
import { warehousesService } from '../lib/supabaseClient';
import { useWarehouses } from '../hooks/useWarehouses';

interface Props {
  currentUser: {
    id: string; name: string; role: string;
    permissions: PermissionSet;
  } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function relativeId(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} detik lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID');
}

export default function ManajemenGudangScreen({ currentUser, showToast }: Props) {
  const canManage = !!currentUser?.permissions.can_manage_warehouses;
  const { warehouses, loading, refresh } = useWarehouses({ activeOnly: false });
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [audit, setAudit] = useState<WarehouseAuditLogRow[]>([]);

  useEffect(() => {
    if (canManage) {
      warehousesService.fetchAuditLog(50).then(setAudit).catch(() => {});
    }
  }, [canManage, warehouses]);

  if (!canManage) {
    return <p className="p-6 text-sm text-slate-500">Akses ditolak — hanya Owner.</p>;
  }

  const handleCreate = async () => {
    if (!/^[A-Z0-9_-]{2,16}$/.test(newCode)) {
      showToast('Kode harus 2-16 karakter A-Z 0-9 _ -', 'warning'); return;
    }
    if (!newName.trim()) { showToast('Nama wajib diisi', 'warning'); return; }
    try {
      await warehousesService.create({ code: newCode, name: newName.trim(), address: newAddress.trim() || undefined });
      showToast('✅ Gudang berhasil ditambahkan', 'success');
      setNewCode(''); setNewName(''); setNewAddress(''); setShowAdd(false);
      await refresh();
    } catch (e: unknown) {
      showToast((e as Error).message ?? 'Gagal menambahkan gudang', 'warning');
    }
  };

  const handleSetDefault = async (id: string) => {
    try { await warehousesService.setDefault(id); showToast('✅ Default diubah', 'success'); await refresh(); }
    catch (e: unknown) { showToast((e as Error).message ?? 'Gagal set default', 'warning'); }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Yakin nonaktifkan gudang ini?')) return;
    try { await warehousesService.deactivate(id); showToast('✅ Gudang dinonaktifkan', 'success'); await refresh(); }
    catch (e: unknown) { showToast((e as Error).message ?? 'Gagal nonaktifkan', 'warning'); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-extrabold text-lg text-[#012749]">Manajemen Gudang</h1>
        <p className="text-xs text-slate-500">Atur daftar gudang yang dipakai oleh kasir, opname, transfer, dan PO.</p>
      </div>

      {/* Daftar Gudang */}
      <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-sm text-[#012749]">Daftar Gudang</h2>
          <button
            onClick={() => setShowAdd(s => !s)}
            className="bg-[#012749] text-white px-3 py-1.5 rounded-full text-[11px] font-extrabold flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Tambah Gudang
          </button>
        </div>
        {loading ? <p className="text-xs text-slate-400">Memuat…</p> : (
          <div className="space-y-2">
            {warehouses.map((w: Warehouse) => (
              <div key={w.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                  w.is_active ? 'bg-[#f8f9ff] border-[#abc9f3]/40' : 'bg-gray-50 border-gray-200 opacity-60'}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[#012749] font-black text-[10px]">
                  {w.code.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[#012749]">{w.name}</span>
                    {w.is_default && <Crown className="w-3 h-3 text-amber-500" />}
                    {!w.is_active && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Nonaktif</span>}
                  </div>
                  <p className="text-[10px] text-gray-400 font-mono">{w.code}{w.address && ` · ${w.address}`}</p>
                </div>
                {w.is_active && !w.is_default && (
                  <button onClick={() => handleSetDefault(w.id)}
                    className="text-[10px] font-extrabold text-blue-600 hover:text-blue-800">
                    Set Default
                  </button>
                )}
                {w.is_active && !w.is_default && (
                  <button onClick={() => handleDeactivate(w.id)}
                    className="text-rose-400 hover:text-rose-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tambah Gudang */}
      {showAdd && (
        <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-[#012749] mb-3">Tambah Gudang Baru</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value.toUpperCase())}
              placeholder="Kode (cth: JKT)"
              maxLength={16}
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-mono font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Nama Gudang"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
            <input
              value={newAddress} onChange={e => setNewAddress(e.target.value)}
              placeholder="Alamat (opsional)"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-bold text-xs outline-none focus:ring-1 focus:ring-[#012749]"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate}
              className="bg-[#2d8a4e] text-white px-5 py-2.5 rounded-full text-xs font-extrabold shadow-md flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Simpan
            </button>
            <button onClick={() => setShowAdd(false)}
              className="border border-slate-200 text-slate-600 px-5 py-2.5 rounded-full text-xs font-extrabold hover:bg-slate-50">
              Batal
            </button>
          </div>
        </section>
      )}

      {/* Riwayat Perubahan */}
      <section className="bg-white border border-[#e5eeff] rounded-3xl p-6 shadow-sm">
        <h2 className="font-extrabold text-sm text-[#012749] mb-3">Riwayat Perubahan</h2>
        {audit.length === 0 ? <p className="text-xs text-slate-400">Belum ada perubahan.</p> : (
          <ul className="space-y-2">
            {audit.map(row => (
              <li key={row.id} className="flex items-center gap-3 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-extrabold uppercase">{row.action}</span>
                <span className="text-slate-500">{relativeId(row.created_at)}</span>
                <span className="text-slate-700 font-mono text-[10px]">{row.warehouse_id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
