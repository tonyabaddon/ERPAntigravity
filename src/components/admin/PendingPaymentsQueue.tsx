// src/components/admin/PendingPaymentsQueue.tsx
// Page component listing all PENDING_VERIFICATION payments for super_admin review.
// Polls every 60s; dispatches per-row verify/reject via PendingPaymentRow.
import React, { useEffect, useState } from 'react';
import { paymentVerificationApi, PendingPayment } from '../../lib/paymentVerificationApi';
import { adminToast } from '../../lib/adminToast';
import { PendingPaymentRow } from './PendingPaymentRow';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

export function PendingPaymentsQueue() {
  const [rows, setRows] = useState<PendingPayment[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await paymentVerificationApi.listPending();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) {
          adminToast.error('Gagal memuat', extractErrorMessage(e));
        }
      }
    }

    load();
    // Skip poll while tab is backgrounded; reload immediately when it
    // becomes visible again. Saves ~1 network round-trip per minute per
    // backgrounded admin tab.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshKey]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-5 font-caleo" data-testid="pending-payments-queue">
      {/* Page header */}
      <div>
        <h1 className="text-[14px] font-bold" style={{ color: '#0B2545' }}>
          Verifikasi Pembayaran
        </h1>
        <p className="text-[12px] mt-1" style={{ color: '#6B7C93' }}>
          Konfirmasi pembayaran yang direkam sales rep — verifikasi atau tolak.
        </p>
      </div>

      {/* Loading skeleton */}
      {rows === null && (
        <div
          className="border rounded-sm overflow-hidden bg-white"
          style={{ borderColor: '#E2E8F0' }}
          data-testid="pending-payments-loading"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="px-4 py-4 border-b animate-pulse"
              style={{ borderColor: '#F1F5F9' }}
            >
              <div className="h-3 rounded w-1/3 mb-2" style={{ background: '#E2E8F0' }} />
              <div className="h-2 rounded w-1/2" style={{ background: '#F1F5F9' }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {rows !== null && rows.length === 0 && (
        <div
          className="border rounded-sm px-5 py-4 text-[13px]"
          style={{ background: '#F0FDF4', borderColor: '#86EFAC', color: '#166534' }}
          data-testid="pending-payments-empty"
        >
          Tidak ada pembayaran menunggu verifikasi.
        </div>
      )}

      {/* List */}
      {rows !== null && rows.length > 0 && (
        <div
          className="border rounded-sm overflow-hidden bg-white"
          style={{ borderColor: '#E2E8F0' }}
          data-testid="pending-payments-list"
        >
          {/* Table header */}
          <div
            className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest flex justify-between items-center"
            style={{
              background: '#F8FAFC',
              color: '#6B7C93',
              fontFamily: 'JetBrains Mono, monospace',
              borderBottom: '1px solid #E2E8F0',
            }}
          >
            <span>Menunggu verifikasi ({rows.length})</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-[11px] font-semibold px-2 py-0.5 rounded transition-colors"
              style={{ color: '#0B2545', border: '1px solid #CBD5E1' }}
              data-testid="refresh-btn"
            >
              Refresh
            </button>
          </div>

          {rows.map((payment) => (
            <PendingPaymentRow
              key={payment.id}
              payment={payment}
              onRefresh={handleRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
