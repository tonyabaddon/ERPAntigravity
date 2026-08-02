// src/components/admin/SuspendTenantModal.tsx
// Dialog for suspending a tenant (Suspend Tenant).
// Requires a reason ≥ 5 chars; calls suspendTenant RPC on confirm.
// VOSI design tokens; Bahasa Indonesia labels.
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { suspendTenant } from '../../lib/adminApi';
import { adminToast } from '../../lib/adminToast';
import type { AdminTenantRow } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  tenant: AdminTenantRow;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── SuspendTenantModal ───────────────────────────────────────────────────────

export function SuspendTenantModal({ open, tenant, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens with (possibly new) tenant.
  useEffect(() => {
    if (open) {
      setReason('');
      setSubmitting(false);
      // Focus textarea on open
      const raf = requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, tenant]);

  // ESC key to close (only when not submitting).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const isReasonValid = reason.trim().length >= 5;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isReasonValid || submitting) return;

    setSubmitting(true);
    try {
      await suspendTenant(tenant.tenant_id, reason.trim());
      adminToast.success('Tenant di-suspend.');
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof AdminApiError) {
        adminToast.error(err.userMessage);
      } else {
        adminToast.error('Terjadi kesalahan tak terduga.');
      }
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    // Only close when clicking the backdrop itself, not bubbled from the card.
    if (e.target === e.currentTarget && !submitting) {
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspend-modal-title"
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-caleo-navy/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded shadow-xl p-6 max-w-md w-full font-caleo mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2
          id="suspend-modal-title"
          className="text-caleo-navy font-bold text-lg mb-3"
        >
          Suspend Tenant
        </h2>

        {/* Tenant name */}
        <p
          className="text-[14px] font-semibold mb-3"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
        >
          {tenant.name}
        </p>

        {/* Warning callout */}
        <div
          className="bg-caleo-danger/10 border-l-4 border-caleo-danger p-3 rounded mb-4 text-[13px]"
          style={{ color: '#0B2545' }}
          role="alert"
        >
          Tenant tidak bisa menulis data setelah di-suspend. Login tetap bisa, tapi setiap
          aksi tulis akan gagal. Pastikan alasan tercatat untuk audit.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Alasan */}
          <div className="mb-6">
            <label
              htmlFor="suspend-reason"
              className="block text-[12px] font-semibold text-caleo-navy mb-1"
            >
              Alasan <span className="text-caleo-danger">*</span>
            </label>
            <textarea
              id="suspend-reason"
              ref={textareaRef}
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={4}
              placeholder="Contoh: pembayaran overdue 60 hari, tidak ada respons"
              className="w-full border border-caleo-navy/30 rounded px-3 py-2 text-[13px] text-caleo-navy placeholder:text-caleo-navy/30 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-danger focus-visible:ring-offset-2 disabled:opacity-50"
              aria-label="Alasan suspend"
            />
            <p className="text-[11px] text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {reason.length}/500
            </p>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-caleo-navy border border-caleo-navy/30 hover:bg-caleo-cream rounded-full px-4 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !isReasonValid}
              className="bg-caleo-danger text-white font-extrabold rounded-full px-4 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {submitting ? 'Menyimpan…' : 'Konfirmasi Suspend'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
