import { useState } from 'react';
import { Search, Lock, X } from 'lucide-react';
import type { DbCustomerWithStats } from '../../types';
import { formatRp } from '../../lib/format';

/**
 * CustomerPanel — search-and-select only. Per `feedback_no_adhoc_customers`
 * memory: every customer in a sale must persist to `customers`. New
 * customers go through `NewCustomerInlineForm` + `insertNewCustomer`.
 */

export interface CustomerPanelProps {
  customers: DbCustomerWithStats[];
  selectedCustomerId: string | null;
  onSelectExisting: (c: DbCustomerWithStats) => void;
  onClearSelection: () => void;
}

function CreditChip({ c }: { c: DbCustomerWithStats }) {
  if (!c.allows_tempo) {
    return <span className="text-[10px] text-slate-400 font-semibold">CASH ONLY</span>;
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">TEMPO OK</span>
      <span className="text-slate-500">
        Limit {formatRp(c.credit_limit ?? 0)} · {c.term_days ?? 0} hari
      </span>
    </div>
  );
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
      {/* Search input (locked when selected) */}
      <div className="relative">
        {isSelected
          ? <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
        <input
          value={isSelected ? `${selected?.name} (dipilih)` : search}
          onChange={e => !isSelected && setSearch(e.target.value)}
          readOnly={isSelected}
          placeholder="Cari nama / HP / perusahaan…"
          className={`w-full pl-10 pr-3 py-2.5 text-sm border rounded-sm outline-none ${
            isSelected
              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              : 'bg-white border-slate-300 focus:border-[#012749] focus:ring-2 focus:ring-[#012749]/30'
          }`}
        />
      </div>

      {/* Search results dropdown */}
      {filtered.length > 0 && (
        <div className="mt-2 border border-slate-200 rounded-sm overflow-hidden divide-y divide-slate-100 bg-white">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelectExisting(c); setSearch(''); }}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-semibold">{c.name}</div>
                <div className="text-[11px] text-slate-500">
                  {c.company || '—'} · {c.wa_number ?? '—'} · {c.order_count ?? 0} pesanan
                </div>
              </div>
              <CreditChip c={c} />
            </button>
          ))}
        </div>
      )}

      {/* No results — hint to use + Customer Baru button (rendered by parent) */}
      {search.trim().length > 0 && filtered.length === 0 && !isSelected && (
        <div className="text-[11px] text-slate-500 italic px-1 mt-2">
          Tidak ketemu di daftar. Gunakan "+ Customer Baru" di bawah untuk daftarkan customer baru.
        </div>
      )}

      {/* Selected customer chip (navy-themed to match mockup palette) */}
      {isSelected && selected && (
        <div className="mt-2 bg-[#012749]/5 border border-[#012749]/30 rounded-sm px-4 py-3 flex justify-between items-center">
          <div>
            <div className="font-bold text-[#012749] text-sm">{selected.name}</div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              📞 {selected.wa_number ?? '—'} · 🏢 {selected.company || '—'}
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              🛒 {selected.order_count ?? 0} pesanan · 💰 {formatRp(selected.total_spend ?? 0)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <CreditChip c={selected} />
            <button
              type="button"
              onClick={onClearSelection}
              className="text-[#012749] text-[11px] font-bold bg-white px-3 py-1 rounded-sm border border-[#012749]/30 hover:bg-[#012749]/5 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Ganti
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
