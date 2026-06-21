import { useState } from 'react';
import { Search, Lock, X } from 'lucide-react';
import type { DbCustomerWithStats } from '../../types';
import { formatRp } from '../../lib/format';

/**
 * CustomerPanel — search-and-select only. Per `feedback_no_adhoc_customers`
 * memory: every customer in a sale must persist to `customers`. New
 * customers go through `NewCustomerInlineForm` + `insertNewCustomer`
 * (src/lib/customers/customerWrappers.ts), surfaced by the wizard's
 * Step1ChannelCustomer "+ Customer Baru" button.
 *
 * The previous manual-entry fallback block was retired with PR #40's
 * PenjualanBaruScreen deletion (the only consumer that needed it).
 */

export interface CustomerPanelProps {
  customers: DbCustomerWithStats[];
  selectedCustomerId: string | null;
  onSelectExisting: (c: DbCustomerWithStats) => void;
  onClearSelection: () => void;
}

export default function CustomerPanel(props: CustomerPanelProps) {
  const { customers, selectedCustomerId, onSelectExisting, onClearSelection } = props;
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

      {/* No results — hint to use + Customer Baru button (rendered by parent) */}
      {search.trim().length > 0 && filtered.length === 0 && !isSelected && (
        <div className="text-[11px] text-slate-500 italic px-1 mb-2">
          Tidak ketemu di daftar. Gunakan "+ Customer Baru" di bawah untuk daftarkan customer baru.
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
    </div>
  );
}
