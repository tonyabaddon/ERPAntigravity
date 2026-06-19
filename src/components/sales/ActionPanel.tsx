import { useState } from 'react';
import type { Order, FunnelSubStage } from '../../lib/sales/types';
import type { StoreSettings, BankAccount } from '../../lib/pengaturan/types';
import { PaymentProofThumbnail } from './PaymentProofThumbnail';
import { PdfPreviewModal } from './PdfPreviewModal';
import { availablePdfsForOrder, type AvailablePdf } from '../../lib/sales/pdf/availablePdfs';
import { generateSalesOrderPdf } from '../../lib/sales/pdf/salesOrderPdf';
import { generateInvoiceDpPdf } from '../../lib/sales/pdf/invoiceDpPdf';
import { generateInvoiceLunasPdf } from '../../lib/sales/pdf/invoiceLunasPdf';
import { generateInvoicePelunasanPdf } from '../../lib/sales/pdf/invoicePelunasanPdf';
import { generateSuratJalanPdf } from '../../lib/sales/pdf/suratJalanPdf';
import { generateCatatanPembatalanPdf } from '../../lib/sales/pdf/catatanPembatalanPdf';

interface Props {
  order: Order;
  settings: StoreSettings | null;
  banks: BankAccount[] | null;
  onOpenProof: () => void;
  onUploadProof: () => void;
  onEdit?: () => void;
}

// Pre-payment sub-stages where the Edit button is shown. Mirrors the spec
// in "Task 4 — EditOrderModal" — admin can still tweak ongkir / items before
// the customer pays.
const EDITABLE_SUBS = new Set<FunnelSubStage>(['2a', '2b', '2c', '2d']);

const PDF_LABELS: Record<AvailablePdf, { emoji: string; label: string; bg: string; fg: string; border: string }> = {
  'SO':        { emoji: '📄', label: 'Sales Order',        bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
  'INV-DP':    { emoji: '💛', label: 'Invoice DP',         bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  'INV-LUNAS': { emoji: '💰', label: 'Invoice Lunas',      bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
  'INV-PEL':   { emoji: '💰', label: 'Invoice Pelunasan',  bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
  'SJ':        { emoji: '🚚', label: 'Surat Jalan',        bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  'CAN':       { emoji: '📝', label: 'Catatan Pembatalan', bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
};

export function ActionPanel({ order, settings, banks, onOpenProof, onUploadProof, onEdit }: Props) {
  const [generating, setGenerating] = useState<AvailablePdf | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; filename: string } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const isVerifyStage = order.funnel_sub_stage === '2d' || order.funnel_sub_stage === '3b';
  const pdfs = availablePdfsForOrder(order);
  const showEdit = EDITABLE_SUBS.has(order.funnel_sub_stage) && !!onEdit;

  // Hide the whole panel if there's nothing to show (no proof step, no PDFs, no edit).
  if (!isVerifyStage && pdfs.length === 0 && !showEdit) return null;

  const proofUrl = order.funnel_sub_stage === '3b'
    ? order.pelunasan_proof_url
    : (order.payment_proof_url ?? order.marketplace_proof_url);

  const pdfsDisabled = !settings || !banks;

  async function handleClickPdf(kind: AvailablePdf) {
    if (pdfsDisabled || !settings || !banks) return;
    setGenError(null);
    setGenerating(kind);
    try {
      let result;
      switch (kind) {
        case 'SO':
          result = await generateSalesOrderPdf(order, settings, banks);
          break;
        case 'INV-DP':
          result = await generateInvoiceDpPdf(order, settings, banks);
          break;
        case 'INV-LUNAS':
          result = await generateInvoiceLunasPdf(order, settings, banks);
          break;
        case 'INV-PEL':
          result = await generateInvoicePelunasanPdf(order, settings, banks);
          break;
        case 'SJ':
          result = await generateSuratJalanPdf(order, settings, banks);
          break;
        case 'CAN':
          result = await generateCatatanPembatalanPdf(order, settings, banks);
          break;
      }
      setPreview({ blob: result.blob, filename: result.filename });
    } catch (err) {
      console.error(`Generate ${kind} PDF failed`, err);
      setGenError(`Gagal generate ${PDF_LABELS[kind].label}.`);
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div style={{ background: '#fafbff', padding: '14px 24px 14px 60px', borderBottom: '1px solid #e5eeff' }}>
      {isVerifyStage && (
        <>
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
        </>
      )}

      {(pdfs.length > 0 || showEdit) && (
        <div style={{ marginTop: isVerifyStage ? 14 : 0 }}>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Dokumen & Aksi
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {pdfs.map(kind => {
              const meta = PDF_LABELS[kind];
              const isLoading = generating === kind;
              const label = isLoading ? 'Memuat…' : `${meta.emoji} ${meta.label}`;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleClickPdf(kind)}
                  disabled={pdfsDisabled || isLoading || generating !== null}
                  title={pdfsDisabled ? 'Lengkapi Pengaturan dulu' : `Generate ${meta.label}`}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: pdfsDisabled ? '#f3f4f6' : meta.bg,
                    color: pdfsDisabled ? '#9ca3af' : meta.fg,
                    border: `1px solid ${pdfsDisabled ? '#e5e7eb' : meta.border}`,
                    fontWeight: 600,
                    cursor: pdfsDisabled || isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.7 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
            {showEdit && (
              <button
                type="button"
                onClick={onEdit}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: '#eef2ff',
                  color: '#3730a3',
                  border: '1px solid #c7d2fe',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: pdfs.length > 0 ? 8 : 0,
                }}
              >
                ✏️ Edit
              </button>
            )}
          </div>
          {pdfsDisabled && pdfs.length > 0 && (
            <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 6 }}>
              Lengkapi Pengaturan dulu (Identitas Toko + Rekening) supaya dokumen bisa di-generate.
            </div>
          )}
          {genError && (
            <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 6 }}>⚠️ {genError}</div>
          )}
        </div>
      )}

      {preview && (
        <PdfPreviewModal
          blob={preview.blob}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
