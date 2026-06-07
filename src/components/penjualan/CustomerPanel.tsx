import React, { useState } from 'react';
import { Search, Lock, X } from 'lucide-react';
import type { DbCustomerWithStats } from '../../types';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface CustomerPanelProps {
  customers: DbCustomerWithStats[];
  selectedCustomerId: string | null;
  customerName: string;
  customerPhone: string;
  customerCompany: string;
  onSelectExisting: (c: DbCustomerWithStats) => void;
  onClearSelection: () => void;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
}

export default function CustomerPanel(props: CustomerPanelProps) {
  const {
    customers, selectedCustomerId, customerName, customerPhone, customerCompany,
    onSelectExisting, onClearSelection, onNameChange, onPhoneChange, onCompanyChange,
  } = props;
  const [search, setSearch] = useState('');

  const isSelected = !!selectedCustomerId;

  const filtered = !isSelected && search.trim().length > 0
    ? customers.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.company?.toLowerCase().includes(search.toLowerCase()) ||
        c.wa_number?.includes(search)
      ).slice(0, 6)
    : [];

  const selected = isSelected
    ? customers.find(c => c.id === selectedCustomerId) ?? null
    : null;

  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Pelanggan
      </label>

      {/* Search input (locked when selected) */}
      <div className="relative mb-2">
        {isSelected
          ? <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
        <input
          value={isSelected ? `${selected?.name} (dipilih)` : search}
          onChange={e => !isSelected && setSearch(e.target.value)}
          readOnly={isSelected}
          placeholder="Cari nama / HP / perusahaan…"
          className={`w-full pl-10 pr-3 py-2 border rounded-xl text-[13px] outline-none ${
            isSelected
              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              : 'bg-slate-50 border-slate-200 focus:border-[#2d8a4e] focus:ring-1 focus:ring-[#2d8a4e]'
          }`}
        />
      </div>

      {/* Search dropdown */}
      {filtered.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow mb-2 overflow-hidden">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelectExisting(c); setSearch(''); }}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-slate-100 last:border-b-0 flex justify-between items-center text-[13px]"
            >
              <div>
                <div className="font-extrabold">{c.name}</div>
                <div className="text-[11px] text-slate-400">
                  {c.wa_number ?? '—'} · {c.company ?? '—'} · {c.order_count ?? 0} pesanan
                </div>
              </div>
              <span className="text-[10px] text-green-600 font-extrabold">PILIH</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected customer chip */}
      {isSelected && selected && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2.5 flex justify-between items-center mb-2">
          <div>
            <div className="font-extrabold text-emerald-700 text-[13px]">{selected.name}</div>
            <div className="text-[11px] text-emerald-700 opacity-75">
              📞 {selected.wa_number ?? '—'} · 🏢 {selected.company ?? '—'}
            </div>
            <div className="text-[11px] text-emerald-700 mt-0.5 font-semibold">
              🛒 {selected.order_count ?? 0} pesanan · 💰 {formatRp(selected.total_spend ?? 0)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-emerald-700 text-[11px] font-extrabold bg-white px-3 py-1.5 rounded-lg border border-emerald-300 hover:bg-emerald-100 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Ganti
          </button>
        </div>
      )}

      {/* New customer block (disabled when selected) */}
      <div className={`mt-2 rounded-xl p-3 ${
        isSelected
          ? 'bg-slate-50 border border-dashed border-slate-200 opacity-60 pointer-events-none'
          : 'bg-yellow-50 border border-dashed border-yellow-300'
      }`}>
        <label className={`text-[11px] font-extrabold uppercase tracking-widest block mb-2 ${
          isSelected ? 'text-slate-400' : 'text-amber-700'
        }`}>
          + Daftar Pelanggan Baru
        </label>
        <input
          value={customerName}
          onChange={e => onNameChange(e.target.value)}
          placeholder="Nama lengkap *"
          disabled={isSelected}
          className="w-full mb-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
        />
        <div className="grid grid-cols-[1.4fr_1fr] gap-2">
          <input
            value={customerPhone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="Nomor HP / WA *"
            disabled={isSelected}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
          />
          <input
            value={customerCompany}
            onChange={e => onCompanyChange(e.target.value)}
            placeholder="Nama perusahaan"
            disabled={isSelected}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
        <p className="text-[11px] mt-1 font-semibold text-slate-500">
          {isSelected
            ? '🔒 Nonaktif — sudah pilih pelanggan terdaftar. Klik ✕ Ganti untuk reset.'
            : '* wajib · Nama perusahaan opsional'}
        </p>
      </div>
    </div>
  );
}
