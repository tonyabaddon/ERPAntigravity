import React, { useState, useEffect } from 'react';
import { TrendingUp, Search, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { ActivePage, DbLead } from '../types';
import { leadsService, customersService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PipelineScreenProps {
  onOpenCustomer: (customerId: string) => void;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterTab = 'all' | 'active' | 'escalated' | 'ordered' | 'dropped';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  NEW:         { label: 'Baru',      className: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: 'Proses',    className: 'bg-blue-100 text-blue-700' },
  ESCALATED:   { label: 'Eskalasi',  className: 'bg-amber-100 text-amber-700' },
  ORDERED:     { label: 'Selesai',   className: 'bg-emerald-100 text-emerald-700' },
  DROPPED:     { label: 'Gugur',     className: 'bg-red-100 text-red-500' },
};

function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  if (abs < 60)    return rtf.format(Math.round(diff), 'second');
  if (abs < 3600)  return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function filterLeads(leads: DbLead[], tab: FilterTab, search: string): DbLead[] {
  let result = leads;
  switch (tab) {
    case 'active':    result = leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS'); break;
    case 'escalated': result = leads.filter(l => l.status === 'ESCALATED'); break;
    case 'ordered':   result = leads.filter(l => l.status === 'ORDERED'); break;
    case 'dropped':   result = leads.filter(l => l.status === 'DROPPED'); break;
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(l =>
      (l.customers?.name ?? '').toLowerCase().includes(q) ||
      l.wa_number.includes(q) ||
      (l.customers?.company ?? '').toLowerCase().includes(q)
    );
  }
  return result;
}

function PipelineItemsTable({ order }: { order: NonNullable<DbLead['orders']>[0] }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-xs mb-3">
      <div className="grid grid-cols-4 px-3 py-2 font-bold uppercase tracking-wide text-[10px] bg-green-100 text-green-700">
        <span>Produk</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Harga</span>
        <span className="text-right">Subtotal</span>
      </div>
      {order.items.map((item, i) => (
        <div key={i} className="grid grid-cols-4 px-3 py-2 border-t border-gray-100 bg-white">
          <div>
            <div className="font-semibold text-gray-800">{item.name}</div>
            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
          </div>
          <div className="text-center font-semibold">{item.qty}</div>
          <div className="text-right text-gray-500">Rp {item.unit_price.toLocaleString('id-ID')}</div>
          <div className="text-right font-bold text-gray-800">Rp {item.subtotal.toLocaleString('id-ID')}</div>
        </div>
      ))}
      <div className="flex justify-end gap-6 px-3 py-2 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
        <div className="text-right text-gray-400 leading-relaxed">
          Subtotal<br />Ongkir<br /><strong className="text-gray-700">Total</strong>
        </div>
        <div className="text-right text-gray-600 leading-relaxed min-w-[100px]">
          Rp {order.subtotal.toLocaleString('id-ID')}<br />
          Rp {(order.shipping_fee ?? 0).toLocaleString('id-ID')}<br />
          <strong className="text-gray-800">Rp {order.total.toLocaleString('id-ID')}</strong>
        </div>
      </div>
    </div>
  );
}

export default function PipelineScreen({ onOpenCustomer, onNavigate, showToast }: PipelineScreenProps) {
  const [leads, setLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    leadsService.fetchAll()
      .then(setLeads)
      .catch(() => showToast('Gagal memuat data pipeline.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveCustomer(customerId: string) {
    setSaving(true);
    try {
      await customersService.updateNameCompany(customerId, editName.trim(), editCompany.trim());
      setLeads(prev => prev.map(l =>
        l.customers?.id === customerId
          ? { ...l, customers: { ...l.customers!, name: editName.trim(), company: editCompany.trim() } }
          : l
      ));
      setEditingCustomerId(null);
      showToast('Profil pelanggan diperbarui.', 'success');
    } catch {
      showToast('Gagal menyimpan perubahan.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
        </div>
      </div>
    );
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all',       label: `Semua (${leads.length})` },
    { id: 'active',    label: `Aktif (${leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS').length})` },
    { id: 'escalated', label: `Eskalasi (${leads.filter(l => l.status === 'ESCALATED').length})` },
    { id: 'ordered',   label: `Selesai (${leads.filter(l => l.status === 'ORDERED').length})` },
    { id: 'dropped',   label: `Gugur (${leads.filter(l => l.status === 'DROPPED').length})` },
  ];

  const visible = filterLeads(leads, activeTab, search);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-[#012749] text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-400">
        <Search className="w-4 h-4 shrink-0" />
        <input
          className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          placeholder="Cari nama, nomor WA, perusahaan..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Memuat pipeline...</div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          {leads.length === 0
            ? 'Belum ada lead. Lead dibuat otomatis saat percakapan WhatsApp baru masuk.'
            : search.trim()
            ? 'Tidak ada lead yang cocok dengan pencarian.'
            : 'Tidak ada lead dengan status ini.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {visible.map(lead => {
            const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.NEW;
            const customer = lead.customers;
            const isExpanded = expandedId === lead.id;
            const linkedOrder = lead.orders?.[0] ?? null;

            return (
              <div key={lead.id} className="border-b border-gray-100 last:border-0">
                {/* Collapsed row */}
                <div
                  className={`flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span
                        className="font-semibold text-sm text-[#012749] underline underline-offset-2 cursor-pointer hover:opacity-80"
                        onClick={e => { e.stopPropagation(); if (customer?.id) onOpenCustomer(customer.id); }}
                      >
                        {customer?.name || lead.wa_number}
                      </span>
                      {customer?.company && (
                        <span className="text-xs text-gray-400 truncate">· {customer.company}</span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-gray-400">{lead.wa_number}</p>
                  </div>
                  <div className="hidden md:block shrink-0">
                    <p className="text-xs font-mono text-gray-400">{lead.id.slice(0, 12)}...</p>
                  </div>
                  <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400 hidden sm:block">{relativeTime(lead.updated_at)}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded row */}
                {isExpanded && (
                  lead.status === 'ORDERED' && linkedOrder ? (
                    <div className="px-6 py-4 border-t border-green-200 bg-green-50">
                      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1">
                            Pelanggan
                            {customer?.id && editingCustomerId !== customer.id && (
                              <button
                                onClick={e => { e.stopPropagation(); setEditingCustomerId(customer!.id); setEditName(customer!.name); setEditCompany(customer!.company); }}
                                className="text-gray-400 hover:text-gray-600 ml-1"
                              ><Pencil className="w-2.5 h-2.5" /></button>
                            )}
                          </div>
                          {editingCustomerId === customer?.id ? (
                            <div className="space-y-1" onClick={e => e.stopPropagation()}>
                              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nama" className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400" />
                              <input value={editCompany} onChange={e => setEditCompany(e.target.value)} placeholder="Perusahaan" className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400" />
                              <div className="flex gap-1 mt-1">
                                <button onClick={e => { e.stopPropagation(); handleSaveCustomer(customer!.id); }} disabled={saving} className="flex items-center gap-0.5 bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold px-2 py-0.5 rounded transition-colors disabled:opacity-50"><Check className="w-2.5 h-2.5" />{saving ? '...' : 'Simpan'}</button>
                                <button onClick={e => { e.stopPropagation(); setEditingCustomerId(null); }} className="flex items-center gap-0.5 bg-gray-200 hover:bg-gray-300 text-gray-600 text-[10px] px-2 py-0.5 rounded transition-colors"><X className="w-2.5 h-2.5" /></button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold text-gray-700">{customer?.name || lead.wa_number}</div>
                              {customer?.company && <div className="text-gray-400 text-[10px]">{customer.company}</div>}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                          <div className="font-mono font-semibold text-gray-700">{lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pesanan Terkait</div>
                          <span
                            className="font-semibold text-[#012749] underline underline-offset-2 cursor-pointer text-xs"
                            onClick={() => onNavigate('order-history')}
                          >
                            {linkedOrder.gjp_order_id ?? linkedOrder.id.slice(0, 8)} ↗
                          </span>
                        </div>
                      </div>
                      <PipelineItemsTable order={linkedOrder} />
                      <div className="flex gap-3 mt-1">
                        <button
                          onClick={() => onNavigate('sales-inbox')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                        >
                          → Buka Percakapan
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1">
                            Pelanggan
                            {customer?.id && editingCustomerId !== customer.id && (
                              <button
                                onClick={e => { e.stopPropagation(); setEditingCustomerId(customer!.id); setEditName(customer!.name); setEditCompany(customer!.company); }}
                                className="text-gray-400 hover:text-gray-600 ml-1"
                              ><Pencil className="w-2.5 h-2.5" /></button>
                            )}
                          </div>
                          {editingCustomerId === customer?.id ? (
                            <div className="space-y-1" onClick={e => e.stopPropagation()}>
                              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nama" className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400" />
                              <input value={editCompany} onChange={e => setEditCompany(e.target.value)} placeholder="Perusahaan" className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-indigo-400" />
                              <div className="flex gap-1 mt-1">
                                <button onClick={e => { e.stopPropagation(); handleSaveCustomer(customer!.id); }} disabled={saving} className="flex items-center gap-0.5 bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold px-2 py-0.5 rounded transition-colors disabled:opacity-50"><Check className="w-2.5 h-2.5" />{saving ? '...' : 'Simpan'}</button>
                                <button onClick={e => { e.stopPropagation(); setEditingCustomerId(null); }} className="flex items-center gap-0.5 bg-gray-200 hover:bg-gray-300 text-gray-600 text-[10px] px-2 py-0.5 rounded transition-colors"><X className="w-2.5 h-2.5" /></button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold text-gray-700">{customer?.name || lead.wa_number}</div>
                              {customer?.company && <div className="text-gray-400 text-[10px]">{customer.company}</div>}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                          <div className="font-mono font-semibold text-gray-700">{lead.wa_number}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Status</div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                        </div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-500 text-center mb-3">
                        Lead ini belum memiliki pesanan terkonfirmasi.
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => onNavigate('sales-inbox')}
                          className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                        >
                          → Buka Percakapan
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
