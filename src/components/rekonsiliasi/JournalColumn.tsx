// src/components/rekonsiliasi/JournalColumn.tsx
import React, { useEffect, useState } from 'react';
import {
  fetchUnreconciledJournalLines,
  type UnreconciledJournalLine,
} from '../../lib/akuntansi/journalReconService';

interface Props {
  /** COA account UUID for the linked bank account. When null, shows a prompt. */
  coaAccountId: string | null;
  /** Bank account UUID for auto-match. When null, auto-match button is disabled. */
  bankAccountId: string | null;
  /** Display label for the bank account (e.g. "BCA 1234"). */
  bankAccountLabel: string;
  fromDate: string;
  toDate: string;
  /** Called when user clicks a journal line (parent opens MappingDrawer). */
  onPickJournalLine: (line: UnreconciledJournalLine) => void;
  /** Called when user presses "Auto-match" button. */
  onAutoMatch: () => Promise<void>;
  /** Bump to force a refetch (e.g. after a match is saved). */
  refreshKey?: number;
}

function fmt(n: number) {
  return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt';
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

export default function JournalColumn({
  coaAccountId,
  bankAccountId,
  bankAccountLabel,
  fromDate,
  toDate,
  onPickJournalLine,
  onAutoMatch,
  refreshKey = 0,
}: Props) {
  const [lines, setLines] = useState<UnreconciledJournalLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoMatchLoading, setAutoMatchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coaAccountId) {
      setLines([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchUnreconciledJournalLines(coaAccountId, fromDate, toDate)
      .then(setLines)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat data');
      })
      .finally(() => setLoading(false));
  }, [coaAccountId, fromDate, toDate, refreshKey]);

  async function handleAutoMatch() {
    if (!bankAccountId) return;
    setAutoMatchLoading(true);
    try {
      await onAutoMatch();
    } finally {
      setAutoMatchLoading(false);
    }
  }

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[var(--color-caleo-mist)] shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-[var(--color-caleo-mist)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-widest text-[var(--color-caleo-primary)]">
              GL · Journal Entries
            </div>
            <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{bankAccountLabel}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              {loading ? '…' : lines.length} belum cocok
            </span>
            <button
              onClick={handleAutoMatch}
              disabled={autoMatchLoading || !bankAccountId}
              className={`text-[10px] font-extrabold px-3 py-1 rounded-full transition-colors ${
                autoMatchLoading || !bankAccountId
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {autoMatchLoading ? '⏳ Matching…' : 'Auto-match'}
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-400 to-indigo-600"
            style={{ width: lines.length === 0 && !loading ? '100%' : '0%' }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {/* No COA linked */}
        {!coaAccountId && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="text-2xl mb-2">🔗</div>
            <div className="text-xs font-bold text-slate-500">
              Tidak ada akun COA yang terhubung
            </div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1">
              Hubungkan akun bank ke Chart of Accounts di Kasbank → Pengaturan
            </div>
          </div>
        )}

        {/* Loading */}
        {coaAccountId && loading && (
          <div className="text-center py-8 text-xs text-slate-400 font-semibold">Memuat…</div>
        )}

        {/* Error */}
        {coaAccountId && !loading && error && (
          <div className="text-center py-8 text-xs text-rose-500 font-semibold">{error}</div>
        )}

        {/* Empty */}
        {coaAccountId && !loading && !error && lines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="text-2xl mb-2">✓</div>
            <div className="text-xs font-bold text-emerald-600">Semua sudah cocok</div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1">
              Tidak ada journal entry yang belum dicocokkan
            </div>
          </div>
        )}

        {/* Lines list */}
        {coaAccountId && !loading && !error && lines.map(line => (
          <div
            key={line.id}
            onClick={() => onPickJournalLine(line)}
            className="p-3 rounded-sm border mb-2 cursor-pointer border-[var(--color-caleo-mist)] hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                {/* Entry number + date */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-blue-700">{line.entry_number}</span>
                  <span className="text-[10px] text-slate-500 font-semibold">{fmtDate(line.entry_date)}</span>
                </div>
                {/* Description */}
                {line.description && (
                  <div className="text-[10px] text-slate-600 font-semibold mt-0.5 truncate max-w-[170px]">
                    {line.description}
                  </div>
                )}
                {/* Account code chip */}
                <div className="mt-1">
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
                    {line.account_code}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
                {/* Amount */}
                <div className="text-xs font-black text-[var(--color-caleo-primary)]">{fmt(line.amount)}</div>
                {/* Side chip */}
                <span
                  className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                    line.side === 'DEBIT'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {line.side === 'DEBIT' ? 'DEBIT' : 'CREDIT'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
