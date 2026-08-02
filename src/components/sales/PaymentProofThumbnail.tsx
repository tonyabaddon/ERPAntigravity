import EmptyState from '../ui/EmptyState';
import type { ProofSource } from '../../lib/sales/types';

interface Props {
  proofUrl?: string;
  source?: ProofSource;
  onClick: () => void;
}

const SOURCE_LABEL: Record<ProofSource, string> = {
  WA_CALISTA: '📱 Dikirim via WhatsApp (Calista)',
  ADMIN_UPLOAD: '📤 Upload manual oleh admin',
  MARKETPLACE_SCREENSHOT: '🛒 Screenshot dari marketplace',
};

export function PaymentProofThumbnail({ proofUrl, source, onClick }: Props) {
  if (!proofUrl) {
    return <EmptyState message="Belum ada bukti" inline />;
  }
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <img
        src={proofUrl}
        alt="Bukti pembayaran (thumbnail)"
        style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--color-caleo-mist-dark)' }}
      />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>Bukti Pembayaran</div>
        <div style={{ fontSize: 10, color: '#6b7280' }}>{source ? SOURCE_LABEL[source] : '—'}</div>
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          style={{ marginTop: 4, fontSize: 12, color: '#2563eb', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
        >🔍 Lihat ukuran penuh →</button>
      </div>
    </div>
  );
}
