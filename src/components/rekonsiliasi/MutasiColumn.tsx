// src/components/rekonsiliasi/MutasiColumn.tsx
import React, { useState } from 'react';
import type { BankAccount, BankStatementLine } from '../../types';

interface Props {
  lines: BankStatementLine[];
  accounts: BankAccount[];
  onFindPair: (line: BankStatementLine) => void;
  onClassify: (line: BankStatementLine) => void;
  onSplit: (line: BankStatementLine) => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

const LANE_PILL: Record<string, { bg: string; color: string; label: string }> = {
  GREEN:  { bg: '#dcfce7', color: '#15803d', label: '✓ Cocok' },
  YELLOW: { bg: '#fef3c7', color: '#a16207', label: '🟡 Konfirmasi' },
  ORANGE: { bg: '#fed7aa', color: '#9a3412', label: '🟠 Pilih' },
  RED:    { bg: '#fee2e2', color: '#991b1b', label: '🔴 Belum' },
  GRAY:   { bg: '#f1f5f9', color: '#475569', label: '—' },
};

export default function MutasiColumn({ lines, accounts, onFindPair, onClassify, onSplit }: Props) {
  const [acct, setAcct] = useState<string>('all');
  const filtered = acct === 'all' ? lines : lines.filter(l => l.bank_account_id === acct);
  const matched = lines.filter(l => l.lane === 'GREEN' || l.line_kind === 'INTERNAL_TRANSFER' || l.line_kind === 'LEGACY_PERIOD').length;
  const pct = lines.length === 0 ? 0 : Math.round(matched / lines.length * 100);
  const acctById = new Map(accounts.map(a => [a.id, a]));

  return (
    <div className="bg-white/92 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">🏦 Mutasi Bank</div>
          <span className="text-[10px] text-slate-500 font-bold">{matched}/{lines.length} · {pct}%</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: pct + '%' }} />
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          <span onClick={() => setAcct('all')} className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${acct === 'all' ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}>Semua · {lines.length}</span>
          {accounts.map(a => (
            <span key={a.id} onClick={() => setAcct(a.id)} className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${acct === a.id ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}>{a.bank_code} {a.account_number.slice(-4)}</span>
          ))}
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {filtered.map(l => {
          const pill = LANE_PILL[l.lane] ?? LANE_PILL.GRAY;
          const a = acctById.get(l.bank_account_id);
          const cardBg =
            l.lane === 'GREEN' ? 'rgba(236,253,245,0.5)' :
            l.lane === 'YELLOW' ? 'rgba(255,251,235,0.55)' :
            l.lane === 'ORANGE' ? 'rgba(255,247,237,0.55)' :
            l.lane === 'RED' ? 'rgba(254,242,242,0.55)' :
            'rgba(248,250,252,0.6)';
          const cardBorder =
            l.lane === 'GREEN' ? '#a7f3d0' :
            l.lane === 'YELLOW' ? '#fde68a' :
            l.lane === 'ORANGE' ? '#fed7aa' :
            l.lane === 'RED' ? '#fecaca' :
            '#e2e8f0';
          return (
            <div key={l.id} className="p-3 rounded-sm border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#012749]">{l.counterparty || l.description.slice(0, 22)}</span>
                    {a && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{a.bank_code} {a.account_number.slice(-4)}</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{fmtDate(l.txn_date)} · skor {l.match_confidence?.toFixed(2) ?? '—'}</div>
                </div>
                <div className={`text-xs font-black ${l.direction === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>{l.direction === 'IN' ? '+' : '−'}{fmt(l.amount)}</div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center justify-between">
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
                {(l.lane === 'YELLOW' || l.lane === 'ORANGE' || l.lane === 'RED') && (
                  <div className="flex gap-1">
                    <button onClick={() => onSplit(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-[#e5eeff] text-[#012749]">Split</button>
                    <button onClick={() => onClassify(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-[#e5eeff] text-[#012749]">Klasifikasi</button>
                    <button onClick={() => onFindPair(l)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-red-600 text-white">Cari →</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Belum ada mutasi. Upload PDF.</div>}
      </div>
    </div>
  );
}
