import type { Order } from '../../lib/sales/types';
import { PaymentProofThumbnail } from './PaymentProofThumbnail';

interface Props {
  order: Order;
  onOpenProof: () => void;
  onUploadProof: () => void;
}

export function ActionPanel({ order, onOpenProof, onUploadProof }: Props) {
  const isVerifyStage = order.funnel_sub_stage === '2d' || order.funnel_sub_stage === '3b';
  if (!isVerifyStage) return null;

  const proofUrl = order.funnel_sub_stage === '3b'
    ? order.pelunasan_proof_url
    : (order.payment_proof_url ?? order.marketplace_proof_url);

  return (
    <div style={{ background: '#fafbff', padding: '14px 24px 14px 60px', borderBottom: '1px solid #e5eeff' }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Cek Bukti Pembayaran
      </div>
      {proofUrl ? (
        <PaymentProofThumbnail proofUrl={proofUrl} source={order.proof_source} onClick={onOpenProof} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 16, background: '#f9fafb', borderRadius: 12, color: '#6b7280', fontSize: 12, flex: 1 }}>
            Belum ada bukti dari customer
          </div>
          <button onClick={onUploadProof} style={{ background: 'var(--color-primary)', color: 'white', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            📤 Upload Bukti Manual
          </button>
        </div>
      )}
    </div>
  );
}
