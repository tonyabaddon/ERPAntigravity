import React, { useState, useEffect } from 'react';
import { TrendingUp } from 'lucide-react';
import { DbLead } from '../types';
import { leadsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PengaturanScreenProps {
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

function filterLeads(leads: DbLead[], tab: FilterTab): DbLead[] {
  switch (tab) {
    case 'active':    return leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS');
    case 'escalated': return leads.filter(l => l.status === 'ESCALATED');
    case 'ordered':   return leads.filter(l => l.status === 'ORDERED');
    case 'dropped':   return leads.filter(l => l.status === 'DROPPED');
    default:          return leads;
  }
}

export default function PipelineScreen({ showToast }: PengaturanScreenProps) {
  const [leads, setLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    leadsService.fetchAll()
      .then(setLeads)
      .catch(err => {
        console.error('PipelineScreen load error:', err);
        showToast('Gagal memuat data pipeline.', 'warning');
      })
      .finally(() => setLoading(false));
  }, []);

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

  const visible = filterLeads(leads, activeTab);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
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

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Memuat pipeline...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {leads.length === 0
              ? 'Belum ada lead. Lead dibuat otomatis saat percakapan WhatsApp baru masuk.'
              : 'Tidak ada lead dengan status ini.'}
          </div>
        ) : (
          visible.map(lead => {
            const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.NEW;
            const customer = lead.customers;
            return (
              <div key={lead.id} className="flex items-center gap-4 px-6 py-4">
                {/* Customer info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-gray-800 truncate">
                      {customer?.name || lead.wa_number}
                    </span>
                    {customer?.company && (
                      <span className="text-xs text-gray-400 truncate hidden sm:block">
                        · {customer.company}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-gray-400">{lead.wa_number}</p>
                </div>

                {/* Lead ID */}
                <div className="hidden md:block shrink-0">
                  <p className="text-xs font-mono text-gray-400">{lead.id}</p>
                </div>

                {/* Status badge */}
                <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
                  {badge.label}
                </span>

                {/* Updated time */}
                <span className="shrink-0 text-xs text-gray-400 hidden sm:block">
                  {relativeTime(lead.updated_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
