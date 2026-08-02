// src/components/rekonsiliasi/AddBankAccountModal.tsx
import React, { useState } from 'react';
import type { BankAccount } from '../../types';

interface Props {
  onSave: (payload: Omit<BankAccount, 'id'>) => Promise<void>;
  onCancel: () => void;
}

export default function AddBankAccountModal({ onSave, onCancel }: Props) {
  const [form, setForm] = useState<Omit<BankAccount, 'id'>>({
    bank_code: 'BCA',
    account_number: '',
    account_label: '',
    purpose: 'OPERATIONAL',
    is_active: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onCancel}>
      <div className="bg-white rounded-sm p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-black text-[var(--color-caleo-primary)] mb-4">Tambah Rekening Bank</h3>
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Bank</label>
        <select value={form.bank_code} onChange={e => setForm({ ...form, bank_code: e.target.value as BankAccount['bank_code'] })} className="w-full mb-3 px-3 py-2 border border-[var(--color-caleo-mist)] rounded-sm text-xs">
          {(['BCA', 'MANDIRI', 'BRI', 'BNI', 'PERMATA', 'CIMB', 'OTHER'] as const).map(b => <option key={b}>{b}</option>)}
        </select>
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Nomor Rekening</label>
        <input value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} className="w-full mb-3 px-3 py-2 border border-[var(--color-caleo-mist)] rounded-sm text-xs" />
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Label</label>
        <input value={form.account_label} onChange={e => setForm({ ...form, account_label: e.target.value })} className="w-full mb-3 px-3 py-2 border border-[var(--color-caleo-mist)] rounded-sm text-xs" placeholder="BCA Bisnis Operasional 8420" />
        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tujuan</label>
        <select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value as BankAccount['purpose'] })} className="w-full mb-4 px-3 py-2 border border-[var(--color-caleo-mist)] rounded-sm text-xs">
          {(['OPERATIONAL', 'OWNER_PERSONAL', 'SAVINGS', 'OTHER'] as const).map(p => <option key={p}>{p}</option>)}
        </select>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 rounded-full text-xs font-bold bg-[var(--color-caleo-primary)] text-white">Simpan</button>
        </div>
      </div>
    </div>
  );
}
