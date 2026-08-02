// src/components/admin/SalesRepDeactivateModal.tsx
// Modal for deactivating a sales rep (Pre-Flight Note G).
// VOSI design tokens; Bahasa Indonesia labels.
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { salesRepsApi } from '../../lib/salesRepsApi';
import { adminToast } from '../../lib/adminToast';
import { AdminApiError } from '../../lib/adminTypes';
import type { SalesRep } from '../../lib/salesRepsApi';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  salesRep: SalesRep | null;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── SalesRepDeactivateModal ──────────────────────────────────────────────────

export function SalesRepDeactivateModal({ open, salesRep, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens with (possibly new) sales rep.
  useEffect(() => {
    if (open) {
      setReason('');
      setSubmitting(false);
      const raf = requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, salesRep]);

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

  if (!open || !salesRep) return null;

  const isReasonValid = reason.trim().length >= 5;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isReasonValid || submitting || !salesRep) return;

    setSubmitting(true);
    try {
      await salesRepsApi.deactivate(salesRep.user_id, reason.trim());
      adminToast.success(`Sales rep "${salesRep.name}" dinonaktifkan.`);
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
    if (e.target === e.currentTarget && !submitting) {
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-salesrep-modal-title"
      data-testid="deactivate-salesrep-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-caleo-navy/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded shadow-xl p-6 max-w-md w-full font-caleo mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gold focal accent */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#F9B233' }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B2545" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2
            id="deactivate-salesrep-modal-title"
            className="text-lg font-bold"
            style={{ color: '#0B2545' }}
          >
            Nonaktifkan Sales Rep
          </h2>
        </div>

        {/* Sales rep name */}
        <p
          className="text-sm font-semibold mb-3"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
        >
          {salesRep.name}
        </p>

        {/* Warning callout */}
        <div
          className="border-l-4 p-3 rounded mb-4 text-caleo-13"
          style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#0B2545' }}
          role="alert"
        >
          Sales rep tidak bisa login setelah JWT expiry (~1 jam). Rekaman aktivitas mereka
          tetap tersimpan di audit log.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Alasan */}
          <div className="mb-6">
            <label
              htmlFor="deactivate-reason"
              className="block text-xs font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              Alasan nonaktifkan <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <textarea
              id="deactivate-reason"
              ref={textareaRef}
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={4}
              placeholder="Contoh: karyawan mengundurkan diri per 10 Juli 2026"
              className="w-full border rounded px-3 py-2 text-caleo-13 placeholder:opacity-40 resize-none focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Alasan nonaktifkan"
            />
            <p className="text-caleo-11 text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {reason.length}/500
            </p>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="border rounded-full px-4 py-2.5 text-caleo-13 font-medium disabled:opacity-40 transition-colors"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !isReasonValid}
              className="font-extrabold rounded-full px-4 py-2.5 text-caleo-13 disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: '#DC2626', color: '#ffffff' }}
            >
              {submitting ? 'Menyimpan…' : 'Nonaktifkan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
