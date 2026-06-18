import React, { useRef, useState } from 'react';
import { uploadPaymentProof } from '../../lib/sales/mutations';
import type { ProofSource } from '../../lib/sales/types';

interface Props {
  orderId: string;
  field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url';
  onUploaded: (url: string) => void;
  onClose: () => void;
}

export function ProofUploadModal({ orderId, field, onUploaded, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<ProofSource>('ADMIN_UPLOAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadPaymentProof({ orderId, file, source, field });
      onUploaded(url);
      onClose();
    } catch (err) {
      console.error('uploadPaymentProof failed', err);
      setError(err instanceof Error ? err.message : 'Upload gagal');
    } finally {
      setBusy(false);
    }
  }

  function radioRow(value: ProofSource, title: string, desc: string) {
    const isSel = source === value;
    return (
      <label style={{ display: 'flex', gap: 8, padding: 12, borderRadius: 10, border: `2px solid ${isSel ? 'var(--color-primary)' : '#e5eeff'}`, cursor: 'pointer' }}>
        <input type="radio" name="src" checked={isSel} onChange={() => setSource(value)} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-primary)' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{desc}</div>
        </div>
      </label>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 }}>Upload Bukti Pembayaran</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Order #{orderId.slice(0, 8)}</div>
        <div style={{ marginBottom: 12, fontSize: 12, color: '#374151', fontWeight: 600 }}>Sumber bukti:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {radioRow('WA_CALISTA', '📱 Dari WhatsApp (Calista AI)', 'Customer kirim via WA, Calista auto-attach (otomatis, jarang perlu manual)')}
          {radioRow('ADMIN_UPLOAD', '📤 Upload Manual oleh Admin', 'Foto bukti dari WA owner, SMS, email, atau cash di toko')}
          {radioRow('MARKETPLACE_SCREENSHOT', '🛒 Screenshot Marketplace', 'Screenshot order detail dari Tokopedia/Shopee seller dashboard')}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handlePick} disabled={busy} style={{ display: 'block', width: '100%', marginBottom: 12 }} />
        {busy && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Uploading…</div>}
        {error && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>⚠️ {error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 10, background: 'white', border: '1px solid #e5e7eb', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Batal</button>
        </div>
      </div>
    </div>
  );
}
