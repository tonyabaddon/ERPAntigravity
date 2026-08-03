// src/components/ManajemenGudangScreen.tsx
// Three sections: Daftar Gudang (table), Tambah Gudang (inline form), Riwayat Perubahan (audit feed).
// Permission-gated via can_manage_warehouses.

import React, { useEffect, useState } from 'react';
import { Plus, Crown, Trash2, Edit3, RotateCcw, X } from 'lucide-react';
import type { PermissionSet, Warehouse, WarehouseAuditLogRow } from '../types';
import { warehousesService, adminUsersService } from '../lib/supabaseClient';
import { useWarehouses } from '../hooks/useWarehouses';
import { captureError } from '../lib/captureError';
import EmptyState from './ui/EmptyState';
import LoadingState from './ui/LoadingState';
import ErrorState from './ui/ErrorState';

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
  const { warehouses, loading, error: warehouseError, refresh } = useWarehouses({ activeOnly: false });
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [audit, setAudit] = useState<WarehouseAuditLogRow[]>([]);
  // actor_user_id → display name. Resolved once on mount + on user list change
  // so the audit feed shows "Tony Wei" instead of the raw UUID prefix.
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  // Edit modal state — null when closed; otherwise the warehouse being edited
  // plus draft input values.
  const [editing, setEditing] = useState<{ w: Warehouse; name: string; address: string; sortOrder: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (canManage) {
      warehousesService.fetchAuditLog(50).then(setAudit).catch((err) => {
        captureError(err, { feature: 'manajemen_gudang', action: 'fetch_audit_log' });
      });
    }
  }, [canManage, warehouses]);

  useEffect(() => {
    if (!canManage) return;
    adminUsersService
      .fetchAll()
      .then((rows) => {
        const map: Record<string, string> = {};
        for (const a of rows) map[a.id] = a.name;
        setActorNames(map);
      })
      .catch(() => {});
  }, [canManage]);

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

  const handleReactivate = async (id: string) => {
    try { await warehousesService.reactivate(id); showToast('✅ Gudang diaktifkan kembali', 'success'); await refresh(); }
    catch (e: unknown) { showToast((e as Error).message ?? 'Gagal aktifkan ulang', 'warning'); }
  };

  const openEdit = (w: Warehouse) => {
    setEditing({
      w,
      name: w.name,
      address: w.address ?? '',
      sortOrder: String(w.sort_order),
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    const { w, name, address, sortOrder } = editing;
    if (!name.trim()) { showToast('Nama wajib diisi', 'warning'); return; }
    const sortNum = parseInt(sortOrder, 10);
    if (Number.isNaN(sortNum)) { showToast('Sort order harus angka', 'warning'); return; }
    setSaving(true);
    try {
      // Only send fields that actually changed — update_warehouse RPC uses
      // COALESCE for unchanged values, so passing nulls is the cleanest signal.
      const patch: { name?: string; address?: string | null; sort_order?: number } = {};
      if (name.trim() !== w.name) patch.name = name.trim();
      if ((address.trim() || null) !== (w.address ?? null)) patch.address = address.trim() || null;
      if (sortNum !== w.sort_order) patch.sort_order = sortNum;
      if (Object.keys(patch).length === 0) {
        showToast('Tidak ada perubahan', 'info');
        setEditing(null);
        return;
      }
      await warehousesService.update(w.id, patch);
      showToast('✅ Gudang diperbarui', 'success');
      setEditing(null);
      await refresh();
    } catch (e: unknown) {
      showToast((e as Error).message ?? 'Gagal memperbarui gudang', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const actorName = (uid: string): string => actorNames[uid] ?? uid.slice(0, 8);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-extrabold text-lg text-[var(--color-caleo-primary)]">Manajemen Gudang</h1>
        <p className="text-xs text-slate-500">Atur daftar gudang yang dipakai oleh kasir, opname, transfer, dan PO.</p>
      </div>

      {/* Daftar Gudang */}
      <section className="bg-white border border-[var(--color-caleo-mist)] rounded p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-sm text-[var(--color-caleo-primary)]">Daftar Gudang</h2>
          <button
            onClick={() => setShowAdd(s => !s)}
            className="bg-[var(--color-caleo-primary)] text-white px-3 py-1.5 rounded-full text-caleo-11 font-extrabold flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Tambah Gudang
          </button>
        </div>
        {loading ? <LoadingState label="Memuat…" inline /> : warehouseError ? (
          <ErrorState
            message={`Gagal memuat daftar gudang: ${warehouseError}`}
            onRetry={() => void refresh()}
            retryLabel="Coba Lagi"
            inline
          />
        ) : warehouses.length === 0 ? (
          <EmptyState message="Belum ada gudang terdaftar. Tambahkan gudang baru di atas." inline />
        ) : (
          <div className="space-y-2">
            {warehouses.map((w: Warehouse) => (
              <div key={w.id}
                className={`flex items-center gap-3 px-4 py-3 rounded border ${
                  w.is_active ? 'bg-[#f8f9ff] border-[#abc9f3]/40' : 'bg-gray-50 border-gray-200 opacity-60'}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[var(--color-caleo-primary)] font-black text-caleo-10">
                  {w.code.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[var(--color-caleo-primary)]">{w.name}</span>
                    {w.is_default && <Crown className="w-3 h-3 text-amber-500" />}
                    {!w.is_active && <span className="text-caleo-9 font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Nonaktif</span>}
                  </div>
                  <p className="text-caleo-10 text-gray-400 font-mono">{w.code}{w.address && ` · ${w.address}`}</p>
                </div>

                {/* Edit is allowed for any warehouse, active or inactive */}
                <button onClick={() => openEdit(w)}
                  title="Edit gudang"
                  className="text-slate-400 hover:text-[var(--color-caleo-primary)] p-1 rounded hover:bg-slate-100">
                  <Edit3 className="w-4 h-4" />
                </button>

                {w.is_active && !w.is_default && (
                  <button onClick={() => handleSetDefault(w.id)}
                    className="text-caleo-10 font-extrabold text-blue-600 hover:text-blue-800">
                    Set Default
                  </button>
                )}
                {w.is_active && !w.is_default && (
                  <button onClick={() => handleDeactivate(w.id)}
                    title="Nonaktifkan gudang"
                    className="text-rose-400 hover:text-caleo-danger p-1 rounded hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {!w.is_active && (
                  <button onClick={() => handleReactivate(w.id)}
                    title="Aktifkan kembali"
                    className="text-caleo-10 font-extrabold text-caleo-success hover:text-caleo-success flex items-center gap-1 px-2 py-1 rounded hover:bg-emerald-50">
                    <RotateCcw className="w-3 h-3" /> Aktifkan
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tambah Gudang */}
      {showAdd && (
        <section className="bg-white border border-[var(--color-caleo-mist)] rounded p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-[var(--color-caleo-primary)] mb-3">Tambah Gudang Baru</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value.toUpperCase())}
              placeholder="Kode (cth: JKT)"
              maxLength={16}
              className="bg-white border border-slate-200 rounded px-4 py-2.5 font-mono font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
            />
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Nama Gudang"
              className="bg-white border border-slate-200 rounded px-4 py-2.5 font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
            />
            <input
              value={newAddress} onChange={e => setNewAddress(e.target.value)}
              placeholder="Alamat (opsional)"
              className="bg-white border border-slate-200 rounded px-4 py-2.5 font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate}
              className="bg-[#2d8a4e] text-white px-4 py-2.5 rounded-full text-xs font-extrabold shadow-md flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Simpan
            </button>
            <button onClick={() => setShowAdd(false)}
              className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-full text-xs font-extrabold hover:bg-slate-50">
              Batal
            </button>
          </div>
        </section>
      )}

      {/* Riwayat Perubahan */}
      <section className="bg-white border border-[var(--color-caleo-mist)] rounded p-6 shadow-sm">
        <h2 className="font-extrabold text-sm text-[var(--color-caleo-primary)] mb-3">Riwayat Perubahan</h2>
        {audit.length === 0 ? <EmptyState message="Belum ada perubahan." inline /> : (
          <ul className="space-y-2">
            {audit.map(row => {
              // Resolve the affected warehouse name from the cached list so
              // operators see "Gudang Jakarta" instead of an opaque UUID prefix.
              const wh = warehouses.find(x => x.id === row.warehouse_id);
              return (
                <li key={row.id} className="flex items-center gap-3 text-caleo-11 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-extrabold uppercase">{row.action}</span>
                  <span className="font-extrabold text-[var(--color-caleo-primary)]">{wh?.name ?? row.warehouse_id.slice(0, 8)}</span>
                  <span className="text-slate-500">oleh</span>
                  <span className="font-extrabold text-slate-700">{actorName(row.actor_user_id)}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{relativeId(row.created_at)}</span>
                  {row.reason_note && (
                    <span className="text-slate-500 italic">— {row.reason_note}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
             onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-md overflow-hidden"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)]">Edit Gudang — {editing.w.code}</h3>
              <button onClick={() => !saving && setEditing(null)}
                      className="text-slate-400 hover:text-slate-600"
                      disabled={saving}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest block mb-1">Nama Gudang</label>
                <input
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded px-4 py-2.5 font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                />
              </div>
              <div>
                <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest block mb-1">Alamat (opsional)</label>
                <input
                  value={editing.address}
                  onChange={e => setEditing({ ...editing, address: e.target.value })}
                  placeholder="Kosongkan jika tidak ada"
                  className="w-full bg-white border border-slate-200 rounded px-4 py-2.5 font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                />
              </div>
              <div>
                <label className="text-caleo-10 font-extrabold text-gray-500 uppercase tracking-widest block mb-1">Sort Order</label>
                <input
                  type="number"
                  value={editing.sortOrder}
                  onChange={e => setEditing({ ...editing, sortOrder: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded px-4 py-2.5 font-bold text-xs outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                />
                <p className="text-caleo-10 text-slate-400 mt-1">Urutan kecil = tampil duluan di daftar.</p>
              </div>
              <p className="text-caleo-10 text-slate-500 italic">
                Kode gudang ({editing.w.code}) tidak bisa diubah — kode dipakai oleh data historis.
              </p>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setEditing(null)} disabled={saving}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
                Batal
              </button>
              <button onClick={submitEdit} disabled={saving}
                      className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
