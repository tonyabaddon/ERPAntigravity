/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserCheck
} from 'lucide-react';
import { AdminUser, PermissionSet, DbAdminUser } from '../types';
import { adminUsersService, isSupabaseConfigured } from '../lib/supabaseClient';
import { INITIAL_ADMINS } from '../initialData';

interface UserManagementScreenProps {
  showToast: (msg: string) => void;
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

export default function UserManagementScreen({ showToast }: UserManagementScreenProps) {
  const [admins, setAdmins] = useState<AdminUser[]>(INITIAL_ADMINS);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newWhatsapp, setNewWhatsapp] = useState('');
  const [newRole, setNewRole] = useState('Pilih Peran...');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    adminUsersService.fetchAll()
      .then(rows => {
        if (rows.length > 0) {
          setAdmins(rows.map(dbToAdminUser));
        }
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
    if (!newWhatsapp.trim() || newRole === 'Pilih Peran...') {
      showToast('⚠️ Mohon tentukan nomor WhatsApp aktif serta peran tugas admin!');
      return;
    }

    const prefix = newName.toLowerCase().replace(/\s+/g, '');
    const newAdmin: AdminUser = {
      id: crypto.randomUUID(),
      name: newName,
      email: `${prefix}@sinarelektrik.com`,
      whatsapp: newWhatsapp,
      role: newRole,
      permissions: {
        dashboard: true,
        sales: newRole === 'Staff Admin Toko',
        stokAi: newRole === 'Supervisor Gudang',
        konfig: false,
      },
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

    setNewName('');
    setNewWhatsapp('');
    setNewRole('Pilih Peran...');
    showToast(`🎉 Akun baru created! ${newAdmin.name} terdaftar.`);
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
                <option value="Supervisor Gudang">Supervisor Gudang</option>
                <option value="Staff Admin Toko">Staff Admin Toko</option>
                <option value="Finance Manager">Finance Manager</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full bg-[#012749] text-white py-4 px-6 rounded-full text-xs font-extrabold shadow-lg hover:opacity-95 active:scale-[0.98] flex items-center justify-center gap-2.5 transition-all group cursor-pointer mt-6"
            >
              <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">magic_button</span>
              BUAT AKUN &amp; PILIH AKSES
            </button>
          </form>
        </section>

        {/* RIGHT COLUMN: Permissions Table */}
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

          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[750px]">
              <thead>
                <tr className="text-gray-400 text-[10px] font-extrabold uppercase tracking-widest border-b border-[#eff4ff] pb-4 select-none">
                  <th className="pb-4 font-extrabold px-3">Profil Admin</th>
                  <th className="pb-4 font-extrabold px-3">Peran</th>
                  <th className="pb-4 font-extrabold text-center px-2">Dashboard</th>
                  <th className="pb-4 font-extrabold text-center px-2">Sales</th>
                  <th className="pb-4 font-extrabold text-center px-2">Stok AI</th>
                  <th className="pb-4 font-extrabold text-center px-2">Konfig</th>
                  <th className="pb-4 font-extrabold text-center px-3">Status</th>
                  <th className="pb-4 font-extrabold text-right px-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eff4ff]">
                {filteredAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-xs font-semibold text-slate-400">
                      Tidak ditemukan record admin.
                    </td>
                  </tr>
                ) : (
                  filteredAdmins.map((adm) => (
                    <tr key={adm.id} className="group hover:bg-[#eff4ff]/30 transition-colors duration-200">
                      <td className="py-5 px-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[#012749] font-black text-sm select-none">
                            {adm.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-extrabold text-[#012749] text-sm leading-none">{adm.name}</p>
                            <p className="text-[10px] font-semibold text-gray-400 mt-1">{adm.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-5 px-3 text-xs font-bold text-[#43474e]">{adm.role}</td>

                      {(['dashboard', 'sales', 'stokAi', 'konfig'] as (keyof PermissionSet)[]).map(key => (
                        <td key={key} className="py-5 px-2 text-center text-slate-400">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={adm.permissions[key]}
                              onChange={() => handleTogglePermission(adm.id, key)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2d8a4e]" />
                          </label>
                        </td>
                      ))}

                      <td className="py-5 px-3 text-center">
                        <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full bg-emerald-50 text-[#0b743b] border border-emerald-150">
                          {adm.status}
                        </span>
                      </td>

                      <td className="py-5 px-1 text-right">
                        <button
                          onClick={() => handleRemoveAdmin(adm.id)}
                          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer text-rose-400 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 pt-6 border-t border-[#eff4ff] flex flex-col sm:flex-row justify-between items-center gap-4 select-none">
            <p className="text-xs text-gray-500 font-semibold">
              Menampilkan {filteredAdmins.length} dari total {admins.length} Admin pengurus.
            </p>
            <div className="flex gap-1.5">
              <button disabled className="w-8 h-8 rounded-full bg-[#eff4ff] flex items-center justify-center opacity-50 cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled className="w-8 h-8 rounded-full bg-[#eff4ff] flex items-center justify-center opacity-50 cursor-not-allowed">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </div>

    </div>
  );
}
