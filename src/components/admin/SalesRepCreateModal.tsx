// src/components/admin/SalesRepCreateModal.tsx
// Modal for creating a new sales rep via UUID paste (Task 9 Edge Function deferred).
// VOSI design tokens; Bahasa Indonesia labels (Pre-Flight Note F).
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { salesRepsApi } from '../../lib/salesRepsApi';
import { adminToast } from '../../lib/adminToast';
import { AdminApiError } from '../../lib/adminTypes';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── SalesRepCreateModal ──────────────────────────────────────────────────────

export function SalesRepCreateModal({ open, onClose, onSuccess }: Props) {
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens.
  useEffect(() => {
    if (open) {
      setUserId('');
      setEmail('');
      setName('');
      setSubmitting(false);
      const raf = requestAnimationFrame(() => {
        firstInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

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

  const isUUIDLike = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

  const isValid =
    isUUIDLike(userId) &&
    email.trim().length > 0 &&
    name.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    try {
      await salesRepsApi.create(userId.trim(), email.trim(), name.trim());
      adminToast.success('Sales rep berhasil ditambahkan.');
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
      aria-labelledby="create-salesrep-modal-title"
      data-testid="create-salesrep-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-caleo-navy/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded shadow-xl p-6 max-w-md w-full font-caleo mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gold focal accent */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#F9B233' }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B2545" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <h2
            id="create-salesrep-modal-title"
            className="text-lg font-bold"
            style={{ color: '#0B2545' }}
          >
            Tambah Sales Rep
          </h2>
        </div>

        {/* Instruction callout */}
        <div
          className="border-l-4 p-3 rounded mb-5 text-[13px]"
          style={{ background: '#F0F4F8', borderColor: '#9DB2CE', color: '#0B2545' }}
        >
          Buat user di Supabase Dashboard dulu → copy UUID-nya → paste di bawah.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* User UUID */}
          <div className="mb-4">
            <label
              htmlFor="salesrep-user-id"
              className="block text-[12px] font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              User UUID (dari Supabase Dashboard) <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              id="salesrep-user-id"
              ref={firstInputRef}
              type="text"
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={submitting}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full border rounded px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              style={{
                borderColor: '#D3D8E0',
                color: '#0B2545',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              aria-label="User UUID dari Supabase Dashboard"
            />
            {userId && !isUUIDLike(userId) && (
              <p className="text-[11px] mt-0.5" style={{ color: '#DC2626' }}>
                Format UUID tidak valid.
              </p>
            )}
          </div>

          {/* Email */}
          <div className="mb-4">
            <label
              htmlFor="salesrep-email"
              className="block text-[12px] font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              Email <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              id="salesrep-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="salesrep@contoh.com"
              className="w-full border rounded px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Email sales rep"
            />
          </div>

          {/* Nama lengkap */}
          <div className="mb-6">
            <label
              htmlFor="salesrep-name"
              className="block text-[12px] font-semibold mb-1"
              style={{ color: '#0B2545' }}
            >
              Nama lengkap <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              id="salesrep-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="Nama lengkap"
              className="w-full border rounded px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Nama lengkap sales rep"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="border rounded-full px-4 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !isValid}
              className="font-extrabold rounded-full px-4 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: '#0B2545', color: '#ffffff' }}
            >
              {submitting ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
