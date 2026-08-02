// src/components/rekonsiliasi/UploadPDFModal.tsx
import React, { useState } from 'react';
import type { BankAccount } from '../../types';
import { reconciliationService } from '../../lib/supabaseClient';
import { wibDateString } from '../../lib/format';

interface Props {
  account: BankAccount;
  year: number;
  month: number;
  onDone: () => void;
  onCancel: () => void;
}

export default function UploadPDFModal({ account, year, month, onDone, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = wibDateString(new Date(year, month, 0));
    try {
      await reconciliationService.uploadPDF(file, account.id, account.bank_code, start, end);
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Upload gagal');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onCancel}>
      <div className="bg-white rounded-sm p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-black text-[#012749] mb-1">Upload Mutasi PDF</h3>
        <p className="text-[11px] text-slate-500 font-semibold mb-4">{account.account_label}</p>
        <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs mb-4" />
        {err && <div className="text-[11px] text-red-700 font-bold mb-3">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button onClick={handleUpload} disabled={!file || busy} className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white disabled:opacity-50">
            {busy ? 'Memproses…' : 'Upload + Auto-cocok'}
          </button>
        </div>
      </div>
    </div>
  );
}
