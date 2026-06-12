/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Search,
  ChevronDown,
  Trash2,
  UserCheck,
  Crown,
} from 'lucide-react';
import { AdminUser, PermissionSet, DbAdminUser, ALL_PERMISSIONS } from '../types';
import { adminUsersService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { INITIAL_ADMINS } from '../initialData';

interface UserManagementScreenProps {
  showToast: (msg: string) => void;
  currentUser: { name: string } | null;
}

function dbToAdminUser(db: DbAdminUser): AdminUser {
  return {
    id: db.id,
    name: db.name,
    email: db.email ?? '',
    whatsapp: db.whatsapp ?? '',
    role: db.role,
    permissions: db.permissions as PermissionSet,
    status: (db.status === 'Aktif' ? 'Aktif' : 'Nonaktif') as AdminUser['status'],
  };
}

function adminUserToDb(u: AdminUser): Omit<DbAdminUser, 'created_at'> {
  return {
    id: u.id,
    name: u.name,
    email: u.email || null,
    whatsapp: u.whatsapp || null,
    role: u.role,
    permissions: u.permissions,
    status: u.status,
  };
}

function defaultPermissions(role: string): PermissionSet {
  if (role === 'Owner') return { ...ALL_PERMISSIONS };
  if (role === 'Supervisor Gudang') return {
    dashboard: true, salesInbox: false, laporan: true, aiStock: true,
    pipeline: false, pelanggan: false, orderHistory: false,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
    pembelian: false, kasir: false,
  };
  if (role === 'Staff Admin Toko') return {
    dashboard: true, salesInbox: true, laporan: true, aiStock: false,
    pipeline: true, pelanggan: true, orderHistory: true,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
    pembelian: false, kasir: false,
  };
  // Finance Manager
  return {
    dashboard: true, salesInbox: true, laporan: true, aiStock: false,
    pipeline: true, pelanggan: true, orderHistory: true,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
    pembelian: false, kasir: false,
  };
}

export default function UserManagementScreen({ showToast, currentUser }: UserManagementScreenProps) {
  const [admins, setAdmins] = useState<AdminUser[]>(INITIAL_ADMINS);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newWhatsapp, setNewWhatsapp] = useState('');
  const [newRole, setNewRole] = useState('Pilih Peran...');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const PERM_LABELS: { key: keyof PermissionSet; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'salesInbox', label: 'Sales Inbox' },
    { key: 'laporan', label: 'Laporan' },
    { key: 'aiStock', label: 'AI Stock' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'pelanggan', label: 'Pelanggan' },
    { key: 'orderHistory', label: 'Riwayat Pesanan' },
    { key: 'userManagement', label: 'User Management' },
    { key: 'whatsappAi', label: 'WhatsApp AI' },
    { key: 'notifications', label: 'Notifikasi' },
    { key: 'settings', label: 'Pengaturan' },
    { key: 'pembelian', label: 'Pembelian' },
    { key: 'kasir', label: 'Kasir' },
  ];

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    adminUsersService.fetchAll()
      .then(rows => {
        setAdmins(rows.map(dbToAdminUser));
      })
      .catch(err => {
        console.error('Failed to load admin users:', err);
        showToast('⚠️ Gagal memuat data admin dari Supabase.');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleTogglePermission = async (adminId: string, permissionKey: keyof PermissionSet) => {
    const prev = admins;
    const updated = admins.map(adm => {
      if (adm.id === adminId) {
        return { ...adm, permissions: { ...adm.permissions, [permissionKey]: !adm.permissions[permissionKey] } };
      }
      return adm;
    });
    setAdmins(updated);
    if (isSupabaseConfigured) {
      const changed = updated.find(a => a.id === adminId)!;
      try {
        await adminUsersService.upsert(adminUserToDb(changed));
        showToast('🛡️ Keamanan Diperbarui! Hak akses berhasil disesuaikan.');
      } catch (err) {
        console.error('upsert permission failed:', err);
        setAdmins(prev);
        showToast('⚠️ Gagal menyimpan perubahan hak akses.');
      }
    } else {
      showToast('🛡️ Keamanan Diperbarui! Hak akses berhasil disesuaikan.');
    }
  };

  const handleCreateAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      showToast('⚠️ Mohon isi nama lengkap staf!');
      return;
    }
    if (!newEmail.trim()) {
      showToast('⚠️ Mohon isi alamat email aktif untuk login OTP!');
      return;
    }
    if (!newWhatsapp.trim() || newRole === 'Pilih Peran...') {
      showToast('⚠️ Mohon tentukan nomor WhatsApp aktif serta peran tugas admin!');
      return;
    }

    const newAdmin: AdminUser = {
      id: crypto.randomUUID(),
      name: newName,
      email: newEmail,
      whatsapp: newWhatsapp,
      role: newRole,
      permissions: defaultPermissions(newRole),
      status: 'Aktif',
    };

    setAdmins(prev => [...prev, newAdmin]);

    if (isSupabaseConfigured) {
      try {
        await adminUsersService.upsert(adminUserToDb(newAdmin));
      } catch (err) {
        console.error('upsert new admin failed:', err);
        // Revert optimistic add on failure
        setAdmins(prev => prev.filter(a => a.id !== newAdmin.id));
        showToast('⚠️ Gagal menyimpan admin baru ke Supabase.');
        return;
      }
    }

    // Send invitation email (best-effort — failure does not block user creation)
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.functions.invoke('send-admin-invite', {
          body: {
            email: newAdmin.email,
            name: newAdmin.name,
            role: newAdmin.role,
            addedByName: currentUser?.name ?? 'Admin',
            appUrl: window.location.origin,
          },
        });
      } catch {
        showToast('⚠️ Admin dibuat tapi gagal kirim email undangan.');
      }
    }

    setNewName('');
    setNewEmail('');
    setNewWhatsapp('');
    setNewRole('Pilih Peran...');
    showToast(`🎉 Akun baru created! ${newAdmin.name} terdaftar. Email undangan terkirim.`);
  };

  const handleRemoveAdmin = async (id: string) => {
    const removedAdmin = admins.find(a => a.id === id);
    setAdmins(prev => prev.filter(a => a.id !== id));
    if (isSupabaseConfigured) {
      try {
        await adminUsersService.remove(id);
      } catch (err) {
        console.error('delete admin failed:', err);
        if (removedAdmin) setAdmins(prev => [...prev, removedAdmin]);
        showToast('⚠️ Gagal menghapus admin dari Supabase.');
        return;
      }
    }
    showToast('🗑️ Akun pengurus berhasil dihapus dari database.');
  };

  const filteredAdmins = admins.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400 font-semibold">
        Memuat data admin...
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      <div className="bg-emerald-50/50 border border-emerald-100 p-6 rounded-3xl flex items-center gap-3">
        <UserCheck className="w-6 h-6 text-[#2d8a4e] shrink-0" />
        <p className="text-xs text-[#0b743b] font-bold leading-relaxed">
          {isSupabaseConfigured
            ? 'Data admin disimpan ke Supabase. Perubahan tersinkronisasi secara real-time.'
            : '⚠️ Supabase belum dikonfigurasi. Data admin tersimpan lokal sementara.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* LEFT COLUMN: Add New Admin Form */}
        <section className="lg:col-span-4 bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#012749] flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <h3 className="text-[#012749] font-extrabold text-lg leading-tight">Tambah Admin Baru</h3>
          </div>

          <form onSubmit={handleCreateAdminSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#43474e] block px-3">Nama Lengkap Staf</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Contoh: Budi Santoso"
                className="w-full bg-[#eff4ff] border-none rounded-full px-6 py-3.5 focus:ring-2 focus:ring-[#012749]/15 text-xs font-semibold text-[#0b1c30]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#43474e] block px-3">Email (untuk OTP Login)</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="staff@email.com"
                className="w-full bg-[#eff4ff] border-none rounded-full px-6 py-3.5 focus:ring-2 focus:ring-[#012749]/15 text-xs font-semibold text-[#0b1c30]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#43474e] block px-3">No. WhatsApp Aktif</label>
              <input
                type="tel"
                required
                value={newWhatsapp}
                onChange={(e) => setNewWhatsapp(e.target.value)}
                placeholder="+62 812..."
                className="w-full bg-[#eff4ff] border-none rounded-full px-6 py-3.5 focus:ring-2 focus:ring-[#012749]/15 text-xs font-semibold text-[#0b1c30]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#43474e] block px-3">Peran/Role Default</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full bg-[#eff4ff] border-none rounded-full px-6 py-3.5 focus:ring-2 focus:ring-[#012749]/15 text-xs font-semibold text-[#0b1c30] cursor-pointer"
              >
                <option value="Pilih Peran...">Pilih Peran...</option>
                <option value="Owner">Owner</option>
                <option value="Supervisor Gudang">Supervisor Gudang</option>
                <option value="Staff Admin Toko">Staff Admin Toko</option>
                <option value="Finance Manager">Finance Manager</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full bg-[#012749] text-white py-4 px-6 rounded-full text-xs font-extrabold shadow-lg hover:opacity-95 active:scale-[0.98] flex items-center justify-center gap-2.5 transition-all group cursor-pointer mt-6"
            >
              <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">auto_awesome</span>
              BUAT AKUN &amp; PILIH AKSES
            </button>
          </form>
        </section>

        {/* RIGHT COLUMN: Admin List with Expandable Permission Rows */}
        <section className="lg:col-span-8 bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0 border border-emerald-100">
                <span className="material-symbols-outlined font-black">verified</span>
              </div>
              <h3 className="text-[#012749] font-extrabold text-lg leading-tight">Hak Akses Menu Aplikasi</h3>
            </div>
            <div className="bg-[#eff4ff] px-5 py-2.5 rounded-full border border-blue-50 flex items-center gap-2.5 w-full sm:w-auto">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari admin..."
                className="bg-transparent border-none text-xs font-bold text-slate-700 focus:ring-0 p-0 w-full sm:w-44 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredAdmins.length === 0 ? (
              <p className="text-center py-10 text-xs font-semibold text-slate-400">
                Tidak ditemukan record admin.
              </p>
            ) : (
              filteredAdmins.map((adm) => {
                const isOwner = adm.role === 'Owner';
                // Count + denominator MUST come from the same key set or the
                // ratio is incoherent. Previously we counted ALL truthy keys
                // (including legacy keys from old DB records that aren't in
                // the current catalog) but divided by the older 13-key UI
                // subset — Eva landed at "21/13 aktif" on the 2026-06-12
                // e2e audit. Constrain both sides to ALL_PERMISSIONS so a
                // legacy `whatsappAi:true` that was renamed away doesn't
                // inflate the numerator.
                const permKeys = Object.keys(ALL_PERMISSIONS) as (keyof PermissionSet)[];
                const totalCount = permKeys.length;
                const activeCount = permKeys.reduce(
                  (n, k) => n + (adm.permissions[k] ? 1 : 0),
                  0,
                );
                const isExpanded = expandedId === adm.id;
                return (
                  <div key={adm.id} className="border border-[#e5eeff] rounded-2xl overflow-hidden">
                    {/* Collapsed row */}
                    <div
                      className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[#eff4ff]/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : adm.id)}
                    >
                      <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[#012749] font-black text-sm select-none shrink-0">
                        {adm.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-extrabold text-[#012749] text-sm leading-none truncate">{adm.name}</p>
                          {isOwner && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        </div>
                        <p className="text-[10px] font-semibold text-gray-400 mt-0.5 truncate">{adm.email}</p>
                      </div>
                      <span className="text-[10px] font-bold text-[#43474e] hidden sm:block shrink-0">{adm.role}</span>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full shrink-0 ${
                        isOwner ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {isOwner ? 'Semua akses' : `${activeCount}/${totalCount} aktif`}
                      </span>
                      <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full bg-emerald-50 text-[#0b743b] border border-emerald-100 shrink-0">
                        {adm.status}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveAdmin(adm.id); }}
                          className="w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer text-rose-400 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded permission grid */}
                    {isExpanded && (
                      <div className="border-t border-[#eff4ff] bg-[#fafbff] px-5 py-5">
                        {isOwner && (
                          <p className="text-[10px] font-bold text-amber-600 mb-3 flex items-center gap-1.5">
                            <Crown className="w-3 h-3" /> Owner memiliki akses penuh — hak akses tidak dapat diubah.
                          </p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {PERM_LABELS.map(({ key, label }) => (
                            <label
                              key={key}
                              className={`flex items-center justify-between bg-white border border-[#e5eeff] rounded-xl px-4 py-2.5 gap-3 ${
                                isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-[#abc9f3]'
                              }`}
                            >
                              <span className="text-[11px] font-bold text-[#43474e] truncate">{label}</span>
                              <div className="relative inline-flex items-center shrink-0">
                                <input
                                  type="checkbox"
                                  checked={adm.permissions[key] ?? false}
                                  onChange={() => !isOwner && handleTogglePermission(adm.id, key)}
                                  disabled={isOwner}
                                  className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#2d8a4e]" />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-[#eff4ff] flex justify-between items-center select-none">
            <p className="text-xs text-gray-500 font-semibold">
              Menampilkan {filteredAdmins.length} dari total {admins.length} Admin pengurus.
            </p>
          </div>
        </section>
      </div>

    </div>
  );
}
