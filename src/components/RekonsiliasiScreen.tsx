// src/components/RekonsiliasiScreen.tsx
import React, { useState } from 'react';
import { useRekonsiliasi } from '../hooks/useRekonsiliasi';
import { reconciliationService } from '../lib/supabaseClient';

interface Props {
  currentUser: { name: string; role: string; permissions: { reconciliation?: boolean } } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function defaultPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function RekonsiliasiScreen({ currentUser, showToast }: Props) {
  const allowed = currentUser?.role === 'owner' || !!currentUser?.permissions?.reconciliation;
  const [period, setPeriod] = useState(defaultPeriod());
  const { loading, accounts, orders, bankLines, cashBatches, refresh } = useRekonsiliasi(period.year, period.month);

  const handleClose = async () => {
    const r = await reconciliationService.closeMonth(period.year, period.month);
    if (r.ok) showToast('✓ Buku ditutup', 'success');
    else showToast(`❌ ${r.reason ?? 'gagal'}`, 'warning');
    refresh();
  };

  if (!allowed) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Akses Rekonsiliasi terbatas untuk Owner.</div>;
  }

  return (
    <div className="space-y-5 animate-fadeIn max-w-[1440px] mx-auto">
      <div className="flex justify-between items-center gap-4 bg-white/78 backdrop-blur-xl p-5 rounded-[2rem] border border-[#e5eeff] shadow-sm">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#2d8a4e] bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-1.5 align-middle" />
            Rekonsiliasi Aktif
          </span>
          <h2 className="text-xl font-black text-[#012749] mt-2">Rekonsiliasi Buku</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {loading ? 'Memuat data…' : `${orders.length} order · ${bankLines.length} mutasi · ${cashBatches.length} batch kas`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={`${period.year}-${period.month}`}
            onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setPeriod({ year: y, month: m }); }}
            className="bg-white border border-[#e5eeff] rounded-xl px-3 py-2 text-xs font-bold text-[#012749]"
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              return <option key={i} value={`${d.getFullYear()}-${d.getMonth() + 1}`}>{d.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}</option>;
            })}
          </select>
          <button onClick={handleClose} className="bg-[#012749] text-white px-4 py-2 rounded-full text-xs font-extrabold">
            🔒 Tutup Buku
          </button>
        </div>
      </div>

      {/* Placeholder sections — filled in subsequent tasks (T26-T39) */}
      <div className="p-6 text-center text-slate-400 font-semibold">
        Wizard + accounts + tally + 3-column grid akan diisi di task selanjutnya.
        <div className="mt-2 text-[11px]">
          Counts so far: accounts={accounts.length}, orders={orders.length}, bankLines={bankLines.length}, cashBatches={cashBatches.length}
        </div>
      </div>
    </div>
  );
}
