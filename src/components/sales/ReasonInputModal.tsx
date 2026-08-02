import { useState } from 'react';
import { captureError } from '../../lib/captureError';

interface Props {
  title: string;
  prompt: string;
  /** Label on the confirm button. */
  confirmLabel: string;
  /** Tailwind/styles tone of the confirm button. */
  tone?: 'danger' | 'warning' | 'primary';
  /** Minimum reason length (default 5). */
  minLength?: number;
  /** Optional secondary helper text under the textarea. */
  hint?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}

const TONE_BG: Record<NonNullable<Props['tone']>, string> = {
  danger: '#dc2626',
  warning: '#d97706',
  primary: 'var(--color-caleo-primary)',
};

/**
 * Generic modal that collects an audit reason before performing a
 * destructive or escalation action. Used by Batalkan, Tolak Bukti,
 * Ada Masalah, etc.
 */
export function ReasonInputModal({
  title, prompt, confirmLabel, tone = 'primary',
  minLength = 5, hint, onConfirm, onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= minLength;

  async function handleConfirm() {
    if (!valid) {
      setError(`Alasan wajib (minimal ${minLength} karakter).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      captureError(err, { feature: 'sales', action: 'reason_confirm' });
      setError(err instanceof Error ? err.message : 'Aksi gagal.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'white', borderRadius: 16, maxWidth: 480, width: '100%',
        padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      }}>
        <h3 style={{ margin: 0, marginBottom: 4, color: 'var(--color-primary)', fontWeight: 700, fontSize: 16 }}>{title}</h3>
        <p style={{ margin: 0, marginBottom: 12, color: '#4b5563', fontSize: 13 }}>{prompt}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan / catatan…"
          rows={4}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            padding: 10, fontSize: 13, lineHeight: 1.4,
            border: '1px solid #d1d5db', borderRadius: 10, fontFamily: 'inherit',
          }}
        />
        {hint && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{hint}</div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>⚠️ {error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: 'white', color: '#374151', border: '1px solid #d1d5db',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !valid}
            style={{
              padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: TONE_BG[tone], color: 'white', border: 'none',
              cursor: (submitting || !valid) ? 'not-allowed' : 'pointer',
              opacity: (submitting || !valid) ? 0.7 : 1,
            }}
          >
            {submitting ? 'Menyimpan…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
