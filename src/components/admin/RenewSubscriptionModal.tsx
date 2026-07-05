// src/components/admin/RenewSubscriptionModal.tsx
// Dialog for renewing a tenant subscription (Perpanjang Masa Aktif).
// Calls renewSubscription RPC; emits onSuccess(result) to parent for re-fetch.
// VOSI design tokens; Bahasa Indonesia labels.
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { renewSubscription } from '../../lib/adminApi';
import { adminToast } from '../../lib/adminToast';
import type { AdminTenantRow, RenewSubscriptionResult } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  tenant: AdminTenantRow;
  onClose: () => void;
  onSuccess: (result: RenewSubscriptionResult) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute ISO YYYY-MM-DD for 1 year from the given date string. */
function addOneYear(iso: string): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Today as ISO YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Default new_expires_at: tenant.expires_at + 1 year, or today + 1 year when null. */
function defaultExpiresAt(tenant: AdminTenantRow): string {
  const base = tenant.expires_at ?? today();
  return addOneYear(base);
}

// ─── RenewSubscriptionModal ───────────────────────────────────────────────────

export function RenewSubscriptionModal({ open, tenant, onClose, onSuccess }: Props) {
  const [newExpiresAt, setNewExpiresAt] = useState(() => defaultExpiresAt(tenant));
  const [newPlanCode, setNewPlanCode] = useState<'' | 'STARTER' | 'PRO' | 'PREMIUM'>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dateInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens with (possibly new) tenant.
  useEffect(() => {
    if (open) {
      setNewExpiresAt(defaultExpiresAt(tenant));
      setNewPlanCode('');
      setNotes('');
      setSubmitting(false);
      // Focus date input on open
      const raf = requestAnimationFrame(() => {
        dateInputRef.current?.focus();
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

  // Validate: new date must be strictly after today
  const isDateValid = newExpiresAt > today();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isDateValid || submitting) return;

    setSubmitting(true);
    try {
      const result = await renewSubscription({
        tenant_id: tenant.tenant_id,
        new_expires_at: newExpiresAt,
        new_plan_code: newPlanCode === '' ? null : newPlanCode,
        notes: notes.trim() || null,
      });
      adminToast.success('Masa aktif diperpanjang.');
      onSuccess(result);
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
      aria-labelledby="renew-modal-title"
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-vosi-navy/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full font-vosi mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2
          id="renew-modal-title"
          className="text-vosi-navy font-bold text-lg mb-1"
        >
          Perpanjang Masa Aktif
        </h2>

        {/* Subheader — tenant name + current expires_at */}
        <p className="text-[13px] mb-4" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#5A6472' }}>
          <span className="font-semibold">{tenant.name}</span>
          {tenant.expires_at && (
            <span className="ml-2 text-[12px]">
              · aktif s/d {tenant.expires_at}
            </span>
          )}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Masa aktif baru */}
          <div className="mb-4">
            <label
              htmlFor="renew-expires-at"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Masa aktif baru
            </label>
            <input
              id="renew-expires-at"
              ref={dateInputRef}
              type="date"
              required
              value={newExpiresAt}
              onChange={(e) => setNewExpiresAt(e.target.value)}
              disabled={submitting}
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Masa aktif baru"
            />
            {newExpiresAt && !isDateValid && (
              <p className="text-[11px] mt-1 text-vosi-danger">
                Tanggal harus lebih dari hari ini.
              </p>
            )}
          </div>

          {/* Ganti paket */}
          <div className="mb-4">
            <label
              htmlFor="renew-plan-code"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Ganti paket <span className="font-normal text-[11px]">(opsional)</span>
            </label>
            <select
              id="renew-plan-code"
              value={newPlanCode}
              onChange={(e) =>
                setNewPlanCode(e.target.value as '' | 'STARTER' | 'PRO' | 'PREMIUM')
              }
              disabled={submitting}
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy bg-white focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Ganti paket"
            >
              <option value="">— Tidak diganti —</option>
              <option value="STARTER">STARTER</option>
              <option value="PRO">PRO</option>
              <option value="PREMIUM">PREMIUM</option>
            </select>
          </div>

          {/* Catatan internal */}
          <div className="mb-6">
            <label
              htmlFor="renew-notes"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Catatan internal <span className="font-normal text-[11px]">(opsional)</span>
            </label>
            <textarea
              id="renew-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              maxLength={500}
              rows={3}
              placeholder="Contoh: renewal 1 tahun, bayar transfer BCA 5 Jul 2026"
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy placeholder:text-vosi-navy/30 resize-none focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Catatan internal"
            />
            <p className="text-[11px] text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {notes.length}/500
            </p>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-vosi-navy border border-vosi-navy/30 hover:bg-vosi-cream rounded-full px-5 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !isDateValid}
              className="bg-vosi-gold text-vosi-navy font-extrabold rounded-full px-5 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {submitting ? 'Menyimpan…' : 'Simpan Perpanjangan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
