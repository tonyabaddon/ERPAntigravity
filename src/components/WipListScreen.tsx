// src/components/WipListScreen.tsx
import React, { useEffect, useState } from 'react';
import { fetchWipList } from '../lib/supabaseClient';
import LockSubmissionModal from './penjualan/LockSubmissionModal';
import type { RakitJobLine } from '../types';

interface WipListScreenProps {
  currentUser: { id: string; name: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type WipRow = {
  id: string;
  total_amount: number;
  dp_amount: number;
  customer_name: string | null;
  customer_phone: string | null;
  service_summary: string | null;
  created_at: string;
  rakit_lines: RakitJobLine[];
};

function formatRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function WipListScreen({ currentUser, showToast }: WipListScreenProps) {
  const [rows, setRows] = useState<WipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockTx, setLockTx] = useState<WipRow | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await fetchWipList();
      setRows(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat WIP list', 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-extrabold text-lg text-[#012749]">⏳ WIP — Rakit Job in Progress</h1>
          <p className="text-xs text-slate-500">
            {rows.length} transaksi sedang dirakit · klik salah satu untuk lock atau cancel
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Memuat&hellip;</p>}
      {!loading && rows.length === 0 && (
        <p className="text-center text-sm py-6 text-slate-500">
          Belum ada transaksi WIP. Buat lewat <strong>Catat Penjualan</strong>.
        </p>
      )}

      <div className="space-y-2">
        {rows.map(tx => (
          <div key={tx.id} className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-amber-400 transition">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-extrabold text-[14px]">{tx.id.slice(0, 8)}...</span>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800">WIP</span>
                </div>
                <div className="text-[12px] text-slate-600">{tx.customer_name ?? '—'} · {tx.customer_phone ?? '—'}</div>
                <div className="text-[11px] text-slate-400 mt-1">Created: {new Date(tx.created_at).toLocaleString('id-ID')}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-400">Total</div>
                <div className="font-extrabold text-[15px] text-[#012749]">{formatRp(tx.total_amount)}</div>
                <div className="text-[11px] text-emerald-700">DP: {formatRp(tx.dp_amount)}</div>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 mb-3 text-[12px]">
              <div className="text-slate-700"><strong>{tx.service_summary ?? '—'}</strong></div>
              {tx.rakit_lines.map(r => (
                <div key={r.id} className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                      r.serviceType === 'jasa_custom_panel' ? 'bg-sky-50 text-sky-700' : 'bg-orange-50 text-orange-700'
                    }`}>
                      {r.serviceType === 'jasa_custom_panel' ? '📦 Custom Panel' : '⚡ Rakit'}
                    </span>
                    <span className="text-[12px] font-bold">{r.description}</span>
                  </div>
                  <span className="text-[12px] font-bold text-amber-700">{formatRp(r.estimatedPrice)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => showToast('Cancel Job belum tersedia di session ini', 'info')}
                className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100"
              >
                ❌ Cancel Job
              </button>
              <button
                type="button"
                onClick={() => setLockTx(tx)}
                className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-white bg-[#012749] hover:bg-[#01365f]"
              >
                🔒 Selesaikan Rakit
              </button>
            </div>
          </div>
        ))}
      </div>

      {lockTx && currentUser && (
        <LockSubmissionModal
          transactionId={lockTx.id}
          rakitLines={lockTx.rakit_lines}
          currentUser={currentUser}
          onClose={() => setLockTx(null)}
          onSubmitted={() => {
            setLockTx(null);
            showToast('Permintaan lock terkirim — menunggu approval owner', 'success');
            void refresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
