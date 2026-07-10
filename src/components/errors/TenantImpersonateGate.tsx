// src/components/errors/TenantImpersonateGate.tsx
//
// Rendered when a platform admin lands on `/t/<slug>/*` without an active
// impersonation for that slug. Explicit gate (not silent auto-impersonate)
// so URL-bar/bookmark entry still requires a confirming click — matches the
// pattern of the "Impersonasi" button in `/admin/tenants` and keeps the
// audit trail meaningful.
import React, { useState } from 'react';
import { ShieldCheck, ExternalLink } from 'lucide-react';

interface Props {
  slug: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export const TenantImpersonateGate: React.FC<Props> = ({ slug, onConfirm, onCancel }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 font-vosi"
      style={{ background: '#FAF7F0' }}
    >
      <div
        className="max-w-md w-full bg-white rounded-lg shadow-lg p-8"
        data-testid="tenant-impersonate-gate"
      >
        <div className="flex items-center gap-2 mb-4" style={{ color: '#0B2545' }}>
          <ShieldCheck size={20} strokeWidth={1.8} style={{ color: '#F9B233' }} />
          <span className="text-[13px] font-semibold">VOSI Admin — Impersonasi Tenant</span>
        </div>

        <h1 className="text-[18px] font-bold mb-2" style={{ color: '#0B2545' }}>
          Masuk sebagai tenant <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[15px]">{slug}</code>?
        </h1>

        <p className="text-[13px] text-slate-600 leading-relaxed mb-6">
          Anda akan melihat dashboard tenant ini dengan JWT impersonasi. Setiap tindakan tulis akan
          tercatat di log audit atas nama Anda (bukan owner tenant). Klik tombol di bawah untuk
          konfirmasi.
        </p>

        {error && (
          <div
            className="mb-4 p-3 rounded border text-[12px]"
            style={{ background: '#FEF2F2', borderColor: '#FCA5A5', color: '#7F1D1D' }}
            role="alert"
          >
            Gagal impersonasi: {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded text-[13px] font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: '#0B2545' }}
          >
            <ExternalLink size={14} strokeWidth={2} />
            {submitting ? 'Mengimpersonasi…' : `Impersonasi & Lanjutkan ke /t/${slug}`}
          </button>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded text-[13px] font-medium disabled:opacity-60"
            style={{ background: '#F3F4F6', color: '#374151' }}
          >
            Kembali ke VOSI Admin
          </button>
        </div>
      </div>
    </div>
  );
};
