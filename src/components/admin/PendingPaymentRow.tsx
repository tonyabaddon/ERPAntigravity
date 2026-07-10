// src/components/admin/PendingPaymentRow.tsx
// Renders one row in the PendingPaymentsQueue — Approve + Reject actions.
import React, { useState } from 'react';
import { paymentVerificationApi, PendingPayment } from '../../lib/paymentVerificationApi';
import { adminToast } from '../../lib/adminToast';
import { RejectPaymentModal } from './RejectPaymentModal';

interface Props {
  payment: PendingPayment;
  onRefresh: () => void;
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PendingPaymentRow({ payment, onRefresh }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

  async function handleVerify() {
    if (verifying) return;
    setVerifying(true);
    try {
      await paymentVerificationApi.verify(payment.id);
      adminToast.success(`Pembayaran ${payment.tenant_name} berhasil diverifikasi.`);
      onRefresh();
    } catch (e) {
      adminToast.error('Gagal verifikasi', e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  }

  async function handleReject(reason: string) {
    try {
      await paymentVerificationApi.reject(payment.id, reason);
      adminToast.success(`Pembayaran ${payment.tenant_name} ditolak.`);
      setShowRejectModal(false);
      onRefresh();
    } catch (e) {
      adminToast.error('Gagal menolak pembayaran', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div
        className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        style={{ borderBottom: '1px solid #F1F5F9' }}
        data-testid={`pending-payment-row-${payment.id}`}
      >
        {/* Left — tenant + amount */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-bold" style={{ color: '#0B2545' }}>
              {payment.tenant_name}
            </span>
            <span
              className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded"
              style={{ background: '#E2E8F0', color: '#0B2545' }}
            >
              {payment.tenant_slug}
            </span>
            {payment.amount_anomaly && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ background: '#FEF3C7', color: '#92400E', borderColor: '#FCD34D' }}
                data-testid="amount-anomaly-badge"
              >
                ⚠️ Amount tidak sesuai plan
              </span>
            )}
          </div>
          <div
            className="text-[13px] font-semibold"
            style={{ color: '#0B2545' }}
            data-testid={`payment-amount-${payment.id}`}
          >
            {formatRupiah(payment.amount)}
          </div>
          <div className="text-[12px]" style={{ color: '#6B7C93' }}>
            {payment.payment_method}
            {payment.bank_reference && (
              <span> · Ref: <span className="font-mono">{payment.bank_reference}</span></span>
            )}
          </div>
        </div>

        {/* Middle — dates + notes */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="text-[12px]" style={{ color: '#6B7C93' }}>
            Tanggal: <span className="font-medium text-[#0B2545]">{formatDate(payment.payment_date)}</span>
          </div>
          {payment.notes && (
            <div className="text-[12px] italic" style={{ color: '#6B7C93' }}>
              &ldquo;{payment.notes}&rdquo;
            </div>
          )}
        </div>

        {/* Right — proof + actions */}
        <div className="flex flex-col gap-2 items-end shrink-0">
          {/* Proof link */}
          <div>
            {payment.proof_url ? (
              <a
                href={payment.proof_url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-medium underline"
                style={{ color: '#2563EB' }}
                data-testid={`proof-link-${payment.id}`}
              >
                Lihat bukti
              </a>
            ) : (
              <span
                className="text-[12px] italic"
                style={{ color: '#9DB2CE' }}
                data-testid={`proof-missing-${payment.id}`}
              >
                Tidak ada bukti
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowRejectModal(true)}
              disabled={verifying}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
              style={{ border: '1px solid #DC2626', color: '#DC2626', background: 'white' }}
              data-testid={`reject-btn-${payment.id}`}
            >
              Tolak
            </button>
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
              style={{
                border: '1px solid #16A34A',
                color: verifying ? '#9DB2CE' : '#16A34A',
                background: 'white',
              }}
              data-testid={`verify-btn-${payment.id}`}
            >
              {verifying ? 'Memverifikasi…' : 'Verifikasi'}
            </button>
          </div>
        </div>
      </div>

      {showRejectModal && (
        <RejectPaymentModal
          paymentId={payment.id}
          tenantName={payment.tenant_name}
          onReject={handleReject}
          onClose={() => setShowRejectModal(false)}
        />
      )}
    </>
  );
}
