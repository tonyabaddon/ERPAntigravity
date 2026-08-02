// src/components/rekonsiliasi/MultiAccountStatus.tsx
import React from 'react';
import type { BankAccount } from '../../types';

interface Props {
  accounts: BankAccount[];
  uploadedAccountIds: Set<string>;
  onAddAccount: () => void;
  onUpload: (account: BankAccount) => void;
}

function accountColor(bank: string) {
  if (bank === 'BCA') return { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' };
  if (bank === 'MANDIRI') return { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' };
  if (bank === 'BRI') return { bg: '#ddd6fe', text: '#5b21b6', border: '#c4b5fd' };
  return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' };
}

export default function MultiAccountStatus({ accounts, uploadedAccountIds, onAddAccount, onUpload }: Props) {
  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[var(--color-caleo-mist)] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-caleo-11 font-black uppercase tracking-widest text-[var(--color-caleo-primary)]">🏦 Rekening Aktif</div>
          <div className="text-caleo-10 text-slate-500 font-semibold mt-0.5">{accounts.length} rekening terdaftar</div>
        </div>
        <button onClick={onAddAccount} className="bg-slate-50 border border-[var(--color-caleo-mist)] text-[var(--color-caleo-primary)] px-3 py-1.5 rounded text-caleo-10 font-extrabold">+ Tambah</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {accounts.map(a => {
          const c = accountColor(a.bank_code);
          const uploaded = uploadedAccountIds.has(a.id);
          return (
            <div key={a.id} className="rounded p-3 border" style={{ background: c.bg + '80', borderColor: c.border }}>
              <div className="flex items-center justify-between">
                <span className="text-caleo-9 font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>
                  {a.bank_code}
                </span>
                <span className={`text-caleo-9 font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full ${uploaded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {uploaded ? '✓' : '⚠️'}
                </span>
              </div>
              <div className="text-xs font-bold text-[var(--color-caleo-primary)] mt-1.5">{a.account_label}</div>
              {!uploaded && <button onClick={() => onUpload(a)} className="mt-2 w-full bg-white border border-amber-300 text-amber-700 text-caleo-10 font-extrabold py-1 rounded">Upload PDF →</button>}
            </div>
          );
        })}
        {accounts.length === 0 && (
          <div className="col-span-full text-center text-xs text-slate-500 font-semibold py-4">Belum ada rekening. Klik <strong>+ Tambah</strong>.</div>
        )}
      </div>
    </div>
  );
}
