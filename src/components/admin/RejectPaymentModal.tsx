// src/components/admin/RejectPaymentModal.tsx
// Modal for rejecting a pending payment — prompts for rejection reason.
import React, { useState } from 'react';

interface Props {
  paymentId: string;
  tenantName: string;
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
}

export function RejectPaymentModal({ tenantName, onReject, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await onReject(reason.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(11,37,69,0.35)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Tolak Pembayaran"
      data-testid="reject-payment-modal"
    >
      <div
        className="bg-white rounded shadow-xl w-full max-w-md mx-4 overflow-hidden"
        style={{ border: '1px solid #ECEEF1' }}
      >
        {/* Header */}
        <div
          className="px-4 py-4 border-b"
          style={{ borderColor: '#ECEEF1' }}
        >
          <h2 className="text-sm font-bold" style={{ color: '#0B2545' }}>
            Tolak Pembayaran
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#6B7C93' }}>
            Tenant: <span className="font-semibold">{tenantName}</span>
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-4 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="reject-reason"
              className="text-caleo-13 font-medium"
              style={{ color: '#0B2545' }}
            >
              Alasan penolakan
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Contoh: Bukti transfer tidak terbaca atau nominal tidak sesuai..."
              className="rounded px-3 py-2 text-caleo-13 resize-none outline-none"
              style={{
                border: '1px solid #CBD5E1',
                color: '#0B2545',
                fontFamily: 'inherit',
              }}
              data-testid="reject-reason-input"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded text-caleo-13 font-medium transition-colors"
              style={{ border: '1px solid #CBD5E1', color: '#0B2545', background: 'white' }}
              data-testid="reject-modal-cancel"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="px-4 py-2 rounded text-caleo-13 font-medium transition-colors"
              style={{
                background: submitting || !reason.trim() ? '#FCA5A5' : '#DC2626',
                color: 'white',
                border: 'none',
              }}
              data-testid="reject-modal-submit"
            >
              {submitting ? 'Menolak…' : 'Tolak'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
