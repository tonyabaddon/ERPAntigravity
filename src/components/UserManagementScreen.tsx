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
  Info,
} from 'lucide-react';
import { AdminUser, PermissionSet, DbAdminUser } from '../types';
import {
  PERMISSION_REGISTRY,
  PERM_CATEGORIES,
  PERMISSION_ROLES,
  defaultPermissions,
  normalizePermissions,
  type PermissionRole,
} from '../lib/permissions';
import { adminUsersService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { INITIAL_ADMINS } from '../initialData';
import { useTenant } from '../contexts/TenantContext';
import { captureError } from '../lib/captureError';

interface UserManagementScreenProps {
  showToast: (msg: string) => void;
  currentUser: { name: string } | null;
}

function dbToAdminUser(db: DbAdminUser): AdminUser {
  // Role safeguard: DB stores role as text; if it's not a valid PermissionRole,
  // log via captureError and fall back to safe default to prevent silent
  // fall-through in defaultPermissions().
  const isValidRole = (PERMISSION_ROLES as readonly string[]).includes(db.role);
  const validRole = isValidRole
    ? (db.role as PermissionRole)
    : (captureError(new Error(`Invalid admin role from DB: '${db.role}'`), {
        feature: 'user_management',
        action: 'db_role_validation',
      }),
      'Staff Admin Toko' as PermissionRole);

  // Gender safeguard — legacy rows before migration 000517 might not have field.
  const validGender: 'M' | 'F' | 'N' =
    db.gender === 'M' || db.gender === 'F' || db.gender === 'N' ? db.gender : 'N';

  return {
    id: db.id,
    name: db.name,
    email: db.email ?? '',
    whatsapp: db.whatsapp ?? '',
    role: validRole,
    permissions: db.permissions as PermissionSet,
    status: (db.status === 'Aktif' ? 'Aktif' : 'Nonaktif') as AdminUser['status'],
    gender: validGender,
  };
}

function adminUserToDb(u: AdminUser, tenantId: string): Omit<DbAdminUser, 'created_at'> {
  return {
    id: u.id,
    name: u.name,
    email: u.email || null,
    whatsapp: u.whatsapp || null,
    role: u.role,
    permissions: u.permissions,
    status: u.status,
    tenant_id: tenantId,
    gender: u.gender ?? 'N',
  };
}


export default function UserManagementScreen({ showToast, currentUser }: UserManagementScreenProps) {
  const tenant = useTenant();
  const [admins, setAdmins] = useState<AdminUser[]>(INITIAL_ADMINS);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newWhatsapp, setNewWhatsapp] = useState('');
  const [newRole, setNewRole] = useState('Pilih Peran...');
  const [newGender, setNewGender] = useState<'M' | 'F' | 'N'>('N');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function loadAdmins() {
    setFetchError(null);
    setLoading(true);
    adminUsersService.fetchAll()
      .then(rows => {
        setAdmins(rows.map(dbToAdminUser));
      })
      .catch(err => {
        captureError(err, { feature: 'user_management', action: 'load_admin_users' });
        setFetchError('Gagal memuat data admin dari Supabase.');
        showToast('⚠️ Gagal memuat data admin dari Supabase.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    loadAdmins();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTogglePermission = async (adminId: string, permissionKey: keyof PermissionSet) => {
    const prev = admins;
    const target = admins.find(a => a.id === adminId);
    if (!target) return;

    // Toggle value in a partial, then normalize to full 43-key shape so the
    // RPC's REPLACE semantics (permissions = EXCLUDED.permissions) don't drop
    // any keys that weren't in the input.
    const nextPartial = { ...target.permissions, [permissionKey]: !target.permissions[permissionKey] };
    const nextPerms = normalizePermissions(nextPartial, target.role);

    const updated = admins.map(adm =>
      adm.id === adminId ? { ...adm, permissions: nextPerms } : adm,
    );
    setAdmins(updated);
    if (isSupabaseConfigured) {
      if (!tenant) {
        setAdmins(prev);
        showToast('⚠️ Konteks tenant belum siap. Muat ulang halaman.');
        return;
      }
      const changed = updated.find(a => a.id === adminId)!;
      try {
        await adminUsersService.upsert(adminUserToDb(changed, tenant.tenant_id));
        showToast('🛡️ Keamanan Diperbarui! Hak akses berhasil disesuaikan.');
      } catch (err) {
        captureError(err, { feature: 'user_management', action: 'upsert_permission' });
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

    // 2026-07-24 fix: order changed to invite-FIRST (get real auth.users.id)
    // then admin_upsert_user (with real id). Previous flow used
    // crypto.randomUUID() → admin_users.id never matched auth.users.id → new
    // admin JWT had no tenant_id → blank dashboard / RLS block.
    // Edge Function now also inserts tenant_users row atomically.

    if (isSupabaseConfigured && supabase) {
      if (!tenant) {
        showToast('⚠️ Konteks tenant belum siap. Muat ulang halaman.');
        return;
      }

      // Step 1: invite via Edge Function (creates auth.users + tenant_users, sends email)
      let inviteeUserId: string;
      let inviteEmailSent = true;
      try {
        const { data, error: inviteErr } = await supabase.functions.invoke<{
          user_id: string;
          email: string;
          success: boolean;
        }>('send-admin-invite', {
          body: {
            email: newEmail,
            name: newName,
            role: newRole,
            addedByName: currentUser?.name ?? 'Admin',
            appUrl: window.location.origin,
          },
        });
        if (inviteErr || !data?.user_id) {
          captureError(inviteErr ?? new Error('Edge Function returned no user_id'), {
            feature: 'user_management',
            action: 'send_admin_invite_failed',
          });
          showToast(`⚠️ Gagal invite admin: ${inviteErr?.message ?? 'Edge Function error'}`);
          return;
        }
        inviteeUserId = data.user_id;
      } catch (err) {
        captureError(err, { feature: 'user_management', action: 'send_admin_invite_threw' });
        showToast('⚠️ Gagal invite admin — network/Edge Function error.');
        return;
      }

      // Step 2: upsert admin_users with the REAL auth.users.id
      const validatedRole = newRole as PermissionRole;
      const newAdmin: AdminUser = {
        id: inviteeUserId,
        name: newName,
        email: newEmail,
        whatsapp: newWhatsapp,
        role: validatedRole,
        permissions: normalizePermissions(defaultPermissions(validatedRole), validatedRole),
        status: 'Aktif',
        gender: newGender,
      };

      try {
        await adminUsersService.upsert(adminUserToDb(newAdmin, tenant.tenant_id));
        setAdmins(prev => [...prev, newAdmin]);
      } catch (err) {
        captureError(err, { feature: 'user_management', action: 'upsert_new_admin' });
        showToast('⚠️ Gagal menyimpan admin baru ke Supabase.');
        return;
      }

      setNewName('');
      setNewEmail('');
      setNewWhatsapp('');
      setNewRole('Pilih Peran...');
      setNewGender('N');
      showToast(
        inviteEmailSent
          ? `🎉 Akun baru created! ${newAdmin.name} terdaftar. Email undangan terkirim.`
          : `✓ Akun baru dibuat untuk ${newAdmin.name}. Undangan email GAGAL — kirim manual.`,
      );
      return;
    }

    // Dev-mode fallback (no Supabase)
    const validatedRoleDev = newRole as PermissionRole;
    const newAdmin: AdminUser = {
      id: crypto.randomUUID(),
      name: newName,
      email: newEmail,
      whatsapp: newWhatsapp,
      role: validatedRoleDev,
      permissions: normalizePermissions(defaultPermissions(validatedRoleDev), validatedRoleDev),
      status: 'Aktif',
      gender: newGender,
    };
    setAdmins(prev => [...prev, newAdmin]);
    setNewName('');
    setNewEmail('');
    setNewWhatsapp('');
    setNewRole('Pilih Peran...');
    setNewGender('N');
    showToast(`✓ Akun baru dibuat untuk ${newAdmin.name} (dev mode).`);
  };

  const handleRemoveAdmin = async (id: string) => {
    const removedAdmin = admins.find(a => a.id === id);
    setAdmins(prev => prev.filter(a => a.id !== id));
    if (isSupabaseConfigured) {
      try {
        await adminUsersService.remove(id);
      } catch (err) {
        captureError(err, { feature: 'user_management', action: 'delete_admin' });
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

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm font-semibold text-red-600">{fetchError}</p>
        <button
          onClick={loadAdmins}
          className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white text-xs font-bold rounded hover:opacity-90"
        >
          Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      <div className="bg-emerald-50/50 border border-emerald-100 p-6 rounded flex items-center gap-3">
        <UserCheck className="w-6 h-6 text-[#2d8a4e] shrink-0" />
        <p className="text-xs text-[#0b743b] font-bold leading-relaxed">
          {isSupabaseConfigured
            ? 'Data admin disimpan ke Supabase. Perubahan tersinkronisasi secara real-time.'
            : '⚠️ Supabase belum dikonfigurasi. Data admin tersimpan lokal sementara.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* LEFT COLUMN: Add New Admin Form */}
        <section className="lg:col-span-4 bg-white rounded-[2.5rem] p-8 border border-[var(--color-caleo-mist)] shadow-xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded bg-blue-50 text-[var(--color-caleo-primary)] flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <h3 className="text-[var(--color-caleo-primary)] font-extrabold text-lg leading-tight">Tambah Admin Baru</h3>
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
                className="w-full bg-[var(--color-caleo-cloud)] border-none rounded-full px-6 py-3.5 focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-semibold text-[#0b1c30]"
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
                className="w-full bg-[var(--color-caleo-cloud)] border-none rounded-full px-6 py-3.5 focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-semibold text-[#0b1c30]"
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
                className="w-full bg-[var(--color-caleo-cloud)] border-none rounded-full px-6 py-3.5 focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-semibold text-[#0b1c30]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Jenis Kelamin
              </label>
              <div className="flex gap-2">
                {[
                  { value: 'M' as const, label: 'Cowok' },
                  { value: 'F' as const, label: 'Cewek' },
                  { value: 'N' as const, label: 'Netral' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNewGender(value)}
                    className={`flex-1 py-2.5 px-3 rounded text-xs font-bold transition-colors border ${
                      newGender === value
                        ? 'bg-[var(--color-caleo-primary)] text-white border-[var(--color-caleo-primary)]'
                        : 'bg-white text-[#43474e] border-[var(--color-caleo-mist)] hover:border-[#abc9f3]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#43474e] block px-3">Peran/Role Default</label>
              <div className="flex items-center gap-2">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="flex-1 bg-[var(--color-caleo-cloud)] border-none rounded-full px-6 py-3.5 focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 text-xs font-semibold text-[#0b1c30] cursor-pointer"
                >
                  <option value="Pilih Peran...">Pilih Peran...</option>
                  {PERMISSION_ROLES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (newRole === 'Pilih Peran...') return;
                    // Preview only — full apply happens on form submit via handleAddAdmin.
                    // For now this button is a hint that preset will be applied.
                    // Future: could pre-fill checkbox preview UI in the form.
                  }}
                  className="text-[10px] font-bold text-[var(--color-caleo-primary)] underline shrink-0"
                  disabled={newRole === 'Pilih Peran...'}
                  title="Preset akan diterapkan otomatis saat 'BUAT AKUN'"
                >
                  Isi Preset
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[var(--color-caleo-primary)] text-white py-4 px-6 rounded-full text-xs font-extrabold shadow-lg hover:opacity-95 active:scale-[0.98] flex items-center justify-center gap-2.5 transition-all group cursor-pointer mt-6"
            >
              <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">auto_awesome</span>
              BUAT AKUN &amp; PILIH AKSES
            </button>
          </form>
        </section>

        {/* RIGHT COLUMN: Admin List with Expandable Permission Rows */}
        <section className="lg:col-span-8 bg-white rounded-[2.5rem] p-8 border border-[var(--color-caleo-mist)] shadow-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0 border border-emerald-100">
                <span className="material-symbols-outlined font-black">verified</span>
              </div>
              <h3 className="text-[var(--color-caleo-primary)] font-extrabold text-lg leading-tight">Hak Akses Menu Aplikasi</h3>
            </div>
            <div className="bg-[var(--color-caleo-cloud)] px-4 py-2.5 rounded-full border border-blue-50 flex items-center gap-2.5 w-full sm:w-auto">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari admin..."
                className="bg-transparent border-none text-xs font-bold text-slate-700 focus-visible:ring-0 p-0 w-full sm:w-44 focus-visible:outline-none"
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
                // Count ONLY registry keys — legacy DB keys ignored (were bloating count).
                // Both sides of the ratio use the same 43-key source so "N/43 aktif"
                // is always coherent.
                const permKeys = PERMISSION_REGISTRY.map(p => p.key);
                const totalCount = permKeys.length;
                const activeCount = permKeys.reduce(
                  (n, k) => n + (adm.permissions[k] ? 1 : 0),
                  0,
                );
                const isExpanded = expandedId === adm.id;
                return (
                  <div key={adm.id} className="border border-[var(--color-caleo-mist)] rounded overflow-hidden">
                    {/* Collapsed row */}
                    <div
                      className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-[var(--color-caleo-cloud)]/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : adm.id)}
                    >
                      <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[var(--color-caleo-primary)] font-black text-sm select-none shrink-0">
                        {adm.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-extrabold text-[var(--color-caleo-primary)] text-sm leading-none truncate">{adm.name}</p>
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

                    {/* Expanded permission grid — grouped by category */}
                    {isExpanded && (
                      <div className="border-t border-[var(--color-caleo-cloud)] bg-[#fafbff] px-4 py-5 space-y-5">
                        {isOwner && (
                          <p className="text-[10px] font-bold text-amber-600 mb-3 flex items-center gap-1.5">
                            <Crown className="w-3 h-3" /> Owner memiliki akses penuh — hak akses tidak dapat diubah.
                          </p>
                        )}
                        {PERM_CATEGORIES.map(category => {
                          const entries = PERMISSION_REGISTRY.filter(p => p.category === category);
                          if (entries.length === 0) return null;
                          return (
                            <div key={category}>
                              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                {category}
                              </h4>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {entries.map(({ key, label, description }) => (
                                  <label
                                    key={key}
                                    className={`flex items-center justify-between bg-white border border-[var(--color-caleo-mist)] rounded px-4 py-2.5 gap-3 ${
                                      isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-[#abc9f3]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <Info
                                        className="w-3 h-3 text-slate-400 shrink-0"
                                        aria-label={description}
                                      />
                                      <span className="text-[11px] font-bold text-[#43474e] truncate" title={description}>
                                        {label}
                                      </span>
                                    </div>
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
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-[var(--color-caleo-cloud)] flex justify-between items-center select-none">
            <p className="text-xs text-gray-500 font-semibold">
              Menampilkan {filteredAdmins.length} dari total {admins.length} Admin pengurus.
            </p>
          </div>
        </section>
      </div>

    </div>
  );
}
