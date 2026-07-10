// src/components/admin/TenantDetail/DeleteTenantModal.tsx
// Confirm-slug modal for permanently deleting a tenant (super_admin only).
// Pattern: alasan textarea + slug-match input + "Hapus Permanen" button.
// Button disabled until slug matches EXACTLY and reason ≥ 5 chars.
// VOSI design tokens; Bahasa Indonesia labels.
import React, { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { deprovisionTenant } from '../../../lib/adminApi';
import { adminToast } from '../../../lib/adminToast';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { AdminApiError } from '../../../lib/adminTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  tenant: AdminTenantRow;
  onClose: () => void;
  onDeleted: () => void;
}

// ─── DeleteTenantModal ────────────────────────────────────────────────────────

export function DeleteTenantModal({ open, tenant, onClose, onDeleted }: Props) {
  const [reason, setReason]           = useState('');
  const [slugInput, setSlugInput]     = useState('');
  const [submitting, setSubmitting]   = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens.
  useEffect(() => {
    if (open) {
      setReason('');
      setSlugInput('');
      setSubmitting(false);
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
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const isReasonValid  = reason.trim().length >= 5;
  const isSlugMatch    = slugInput === tenant.slug;
  const canSubmit      = isReasonValid && isSlugMatch && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await deprovisionTenant(tenant.tenant_id, reason.trim());
      adminToast.success(`Tenant "${tenant.slug}" berhasil dihapus permanen.`);
      onDeleted();
    } catch (err) {
      if (err instanceof AdminApiError) {
        adminToast.error(err.userMessage);
      } else {
        adminToast.error('Terjadi kesalahan tak terduga saat menghapus tenant.');
      }
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-tenant-modal-title"
      data-testid="delete-tenant-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-vosi-navy/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full font-vosi mx-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="delete-tenant-modal"
      >
        {/* Header */}
        <h2
          id="delete-tenant-modal-title"
          className="font-bold text-lg mb-3"
          style={{ color: '#991b1b' }}
        >
          Hapus Tenant Permanen
        </h2>

        {/* Tenant slug */}
        <p
          className="text-[13px] font-semibold mb-3"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
        >
          {tenant.name}
        </p>

        {/* Warning */}
        <div
          className="border-l-4 p-3 rounded mb-4 text-[13px]"
          style={{
            background: '#fef2f2',
            borderColor: '#DC2626',
            color: '#7f1d1d',
          }}
          role="alert"
        >
          Semua data tenant akan hilang selamanya. Aksi ini tidak bisa dibatalkan.
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Alasan */}
          <div className="mb-4">
            <label
              htmlFor="delete-reason"
              className="block text-[12px] font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              Alasan hapus <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <textarea
              id="delete-reason"
              ref={textareaRef}
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={3}
              placeholder="Contoh: tenant test, tidak ada data produksi"
              className="w-full border rounded-lg px-3 py-2 text-[13px] placeholder:text-vosi-navy/30 resize-none focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{
                borderColor: '#ECEEF1',
                color: '#0B2545',
                '--tw-ring-color': '#DC2626',
              } as React.CSSProperties}
              aria-label="Alasan hapus tenant"
            />
            <p className="text-[11px] text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {reason.length}/500
            </p>
          </div>

          {/* Slug confirmation */}
          <div className="mb-6">
            <label
              htmlFor="delete-slug-confirm"
              className="block text-[12px] font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              Ketik slug tenant untuk konfirmasi:{' '}
              <code
                className="px-1.5 py-0.5 rounded text-[12px]"
                style={{
                  background: '#fef2f2',
                  color: '#DC2626',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {tenant.slug}
              </code>
            </label>
            <input
              id="delete-slug-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              disabled={submitting}
              placeholder={tenant.slug}
              className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{
                borderColor: slugInput.length > 0 && !isSlugMatch ? '#DC2626' : '#ECEEF1',
                color: '#0B2545',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              aria-label="Konfirmasi slug tenant"
              data-testid="slug-confirm-input"
            />
            {slugInput.length > 0 && !isSlugMatch && (
              <p className="text-[11px] mt-0.5" style={{ color: '#DC2626' }}>
                Slug tidak cocok.
              </p>
            )}
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="border rounded-full px-5 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors hover:bg-gray-50"
              style={{ color: '#0B2545', borderColor: '#ECEEF1' }}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="text-white font-extrabold rounded-full px-5 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: '#DC2626' }}
              data-testid="hapus-permanen-btn"
            >
              {submitting ? 'Menghapus…' : 'Hapus Permanen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
