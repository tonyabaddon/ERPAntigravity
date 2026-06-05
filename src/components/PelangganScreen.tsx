import React, { useState, useEffect } from 'react';
import { Users, Search, Pencil, Check, X } from 'lucide-react';
import { ActivePage, DbCustomerWithStats, DbCustomerProfile } from '../types';
import { customersService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PelangganScreenProps {
  openCustomerId?: string | null;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING_ADMIN_CONFIRMATION: { label: '🔔 Perlu Konfirmasi', className: 'bg-purple-100 text-purple-800' },
  APPROVED:         { label: '✓ Disetujui',       className: 'bg-teal-100 text-teal-800' },
  WAITING_PAYMENT:  { label: '⏳ Menunggu Bayar',  className: 'bg-yellow-100 text-yellow-800' },
  WAITING_DP:       { label: '⏳ Menunggu DP',     className: 'bg-yellow-100 text-yellow-800' },
  DP_UPLOADED:      { label: '📎 Bukti DP Dikirim',className: 'bg-indigo-100 text-indigo-800' },
  DP_VERIFIED:      { label: '✓ DP Lunas',         className: 'bg-teal-100 text-teal-800' },
  DP_PROOF_REJECTED:{ label: '✕ DP Ditolak',       className: 'bg-red-100 text-red-800' },
  PAYMENT_UPLOADED: { label: '📎 Bukti Dikirim',   className: 'bg-blue-100 text-blue-800' },
  PAYMENT_VERIFIED: { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  COMPLETED:        { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  PAYMENT_REJECTED: { label: '✕ Bayar Ditolak',    className: 'bg-rose-100 text-rose-800' },
  CANCELLED:        { label: '✕ Dibatalkan',        className: 'bg-red-100 text-red-800' },
};

const TOTAL_COLOR: Record<string, string> = {
  PAYMENT_VERIFIED:  'text-green-700',
  COMPLETED:         'text-green-700',
  WAITING_PAYMENT:   'text-yellow-700',
  WAITING_DP:        'text-yellow-700',
  DP_UPLOADED:       'text-indigo-700',
  DP_VERIFIED:       'text-teal-700',
  DP_PROOF_REJECTED: 'text-red-700',
  PAYMENT_UPLOADED:  'text-blue-700',
  PAYMENT_REJECTED:  'text-gray-400',
  CANCELLED:         'text-gray-400',
};

const LEAD_BADGE: Record<string, { label: string; className: string }> = {
  NEW:         { label: 'Baru',     className: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: 'Proses',   className: 'bg-blue-100 text-blue-700' },
  ESCALATED:   { label: 'Eskalasi', className: 'bg-amber-100 text-amber-700' },
  ORDERED:     { label: 'Selesai',  className: 'bg-emerald-100 text-emerald-700' },
  DROPPED:     { label: 'Gugur',    className: 'bg-red-100 text-red-500' },
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function PelangganScreen({ openCustomerId, onNavigate, showToast }: PelangganScreenProps) {
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(openCustomerId ?? null);
  const [profile, setProfile] = useState<DbCustomerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    customersService.fetchAll()
      .then(setCustomers)
      .catch(() => showToast('Gagal memuat data pelanggan.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (openCustomerId) setSelectedId(openCustomerId);
  }, [openCustomerId]);

  useEffect(() => {
    if (!selectedId || !isSupabaseConfigured) { setProfile(null); return; }
    setEditing(false);
    setLoadingProfile(true);
    customersService.fetchProfile(selectedId)
      .then(setProfile)
      .catch(() => showToast('Gagal memuat profil pelanggan.', 'warning'))
      .finally(() => setLoadingProfile(false));
  }, [selectedId]);

  async function handleSaveCustomer() {
    if (!profile) return;
    setSaving(true);
    try {
      await customersService.updateNameCompany(profile.id, editName.trim(), editCompany.trim());
      const updated = { ...profile, name: editName.trim(), company: editCompany.trim() };
      setProfile(updated);
      setCustomers(prev => prev.map(c => c.id === profile.id ? { ...c, name: editName.trim(), company: editCompany.trim() } : c));
      setEditing(false);
      showToast('Profil pelanggan diperbarui.', 'success');
    } catch {
      showToast('Gagal menyimpan perubahan.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  const filtered = customers.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.wa_number.includes(q) ||
      c.company.toLowerCase().includes(q)
    );
  });

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
      </div>

      <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ minHeight: '520px' }}>

        {/* Left panel */}
        <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col">
          <div className="p-3 border-b border-gray-200">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400 text-xs"
                placeholder="Cari nama, WA, perusahaan..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <div className="p-6 text-center text-sm text-gray-400">Memuat...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                {customers.length === 0
                  ? 'Belum ada data pelanggan.'
                  : 'Tidak ada pelanggan yang cocok dengan pencarian.'}
              </div>
            ) : (
              filtered.map(c => {
                const isSelected = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 border-l-[3px] border-l-[#012749]'
                        : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                      isSelected ? 'bg-[#012749] text-white' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold text-sm truncate ${isSelected ? 'text-[#012749]' : 'text-gray-800'}`}>
                        {c.name}
                      </div>
                      {c.company && (
                        <div className={`text-[10px] font-semibold truncate ${isSelected ? 'text-[#012749]/70' : 'text-gray-500'}`}>
                          {c.company}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-gray-400 truncate">{c.wa_number}</div>
                    </div>
                    <div className={`text-xs font-bold shrink-0 ${isSelected ? 'text-[#012749]' : 'text-gray-500'}`}>
                      {c.order_count}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-gray-300">
              <div className="text-center">
                <Users className="w-10 h-10 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-400">Pilih pelanggan untuk melihat profilnya.</p>
              </div>
            </div>
          ) : loadingProfile ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Memuat profil...</div>
          ) : profile ? (
            <>
              {/* Profile header */}
              <div className="bg-[#012749] text-white p-4 flex items-center gap-3 shrink-0">
                <div className="w-11 h-11 rounded-xl bg-[#2d8a4e] flex items-center justify-center text-lg font-extrabold shrink-0">
                  {initials(editing ? editName : profile.name)}
                </div>
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <div className="space-y-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Nama pelanggan"
                        className="w-full bg-white/10 border border-white/30 rounded px-2 py-1 text-sm font-bold text-white placeholder:text-white/40 outline-none focus:border-white/60"
                      />
                      <input
                        value={editCompany}
                        onChange={e => setEditCompany(e.target.value)}
                        placeholder="Nama perusahaan (opsional)"
                        className="w-full bg-white/10 border border-white/30 rounded px-2 py-1 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/60"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="font-extrabold text-[15px] truncate">{profile.name || <span className="opacity-40 italic">Nama belum diisi</span>}</div>
                      <div className="text-[11px] opacity-60 mt-0.5">
                        {profile.wa_number}
                        {profile.company && ` · ${profile.company}`}
                      </div>
                      <div className="text-[11px] opacity-60">Pelanggan sejak {formatDate(profile.created_at)}</div>
                    </>
                  )}
                </div>
                {editing ? (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={handleSaveCustomer}
                      disabled={saving}
                      className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />{saving ? '...' : 'Simpan'}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-extrabold text-emerald-300">
                        {formatRupiah(profile.orders.reduce((s, o) => s + o.total, 0))}
                      </div>
                      <div className="text-[9px] opacity-55">total belanja</div>
                    </div>
                    <button
                      onClick={() => { setEditName(profile.name); setEditCompany(profile.company); setEditing(true); }}
                      className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-[10px] px-2 py-1 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </div>
                )}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 border-b border-gray-200 shrink-0">
                {[
                  { label: 'Pesanan', value: profile.orders.length.toString() },
                  { label: 'Leads',   value: profile.leads.length.toString() },
                  {
                    label: 'Konversi',
                    value: profile.leads.length === 0 ? '—' :
                      Math.round(profile.leads.filter(l => l.status === 'ORDERED').length / profile.leads.length * 100) + '%',
                    color: profile.leads.length === 0 ? 'text-gray-400' :
                      profile.leads.filter(l => l.status === 'ORDERED').length === profile.leads.length
                        ? 'text-[#2d8a4e]' : 'text-amber-600',
                  },
                ].map((stat, i) => (
                  <div key={i} className={`py-3 text-center ${i < 2 ? 'border-r border-gray-200' : ''}`}>
                    <div className={`text-base font-extrabold ${(stat as any).color ?? 'text-[#012749]'}`}>{stat.value}</div>
                    <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Orders section */}
              <div className="px-5 py-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Riwayat Pesanan ({profile.orders.length})
                </div>
                {profile.orders.length === 0 ? (
                  <p className="text-sm text-gray-400">Belum ada pesanan.</p>
                ) : (
                  profile.orders.map(order => {
                    const badge = STATUS_BADGE[order.status] ?? { label: order.status, className: 'bg-gray-100 text-gray-600' };
                    const totalColor = TOTAL_COLOR[order.status] ?? 'text-gray-700';
                    return (
                      <div key={order.id} className="border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold font-mono text-gray-700">{order.gjp_order_id ?? order.id.slice(0, 8)}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                        </div>
                        <div className="text-gray-500 text-[11px]">
                          {order.items[0]?.name ?? '—'}
                          {order.items.length > 1 && ` +${order.items.length - 1}`}
                          {order.delivery_type === 'PICKUP' ? ' · 🏪 Pickup' : ' · 🚚 Delivery'}
                          {' · '}{formatDate(order.created_at)}
                        </div>
                        <div className={`font-extrabold text-sm mt-1 ${totalColor}`}>{formatRupiah(order.total)}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Leads section */}
              <div className="px-5 py-4 border-t border-gray-100">
                <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Leads ({profile.leads.length})
                </div>
                {profile.leads.length === 0 ? (
                  <p className="text-sm text-gray-400">Belum ada lead.</p>
                ) : (
                  profile.leads.map(lead => {
                    const badge = LEAD_BADGE[lead.status] ?? LEAD_BADGE.NEW;
                    return (
                      <div key={lead.id} className="border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 flex justify-between items-center">
                        <div>
                          <div className="font-mono text-[11px] font-semibold text-gray-700">{lead.id}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Dibuat {formatDate(lead.created_at)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                          <button
                            onClick={() => onNavigate('pipeline')}
                            className="text-[10px] text-gray-400 underline underline-offset-2 cursor-pointer"
                          >
                            Kelola di Pipeline →
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : null}
        </div>

      </div>
    </div>
  );
}
