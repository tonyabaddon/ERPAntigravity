import { useEffect } from 'react';

interface Props {
  proofUrl: string;
  orderId: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
}

export function PaymentProofLightbox({ proofUrl, orderId, onApprove, onReject, onClose }: Props) {
  // close on ESC key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300, padding: 16, backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', maxWidth: 900, width: '100%', maxHeight: '92vh',
        }}
      >
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-caleo-mist)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>Bukti Pembayaran</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Order #{orderId.slice(0, 8)}</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <img
            src={proofUrl}
            alt="Bukti pembayaran (full)"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
          />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-caleo-mist)', display: 'flex', gap: 12, justifyContent: 'flex-end', background: '#fafbff' }}>
          <button
            onClick={() => {
              // eslint-disable-next-line no-alert
              const r = window.prompt('Alasan tolak bukti?') ?? '';
              if (r.trim()) onReject(r);
            }}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #fecaca', color: '#b91c1c', background: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >❌ Tolak Bukti</button>
          <button
            onClick={onApprove}
            style={{ padding: '8px 18px', borderRadius: 10, background: 'var(--color-secondary)', color: 'white', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >✓ Bukti Benar · Approve</button>
        </div>
      </div>
    </div>
  );
}
