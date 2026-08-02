import React, { useState } from 'react';
import type { Order, FunnelSubStage } from '../../lib/sales/types';
import type { StoreSettings, BankAccount } from '../../lib/pengaturan/types';
import { PaymentProofThumbnail } from './PaymentProofThumbnail';
import { PdfPreviewModal } from './PdfPreviewModal';
import { availablePdfsForOrder, type AvailablePdf } from '../../lib/sales/pdf/availablePdfs';
import type { PdfPrintMode } from '../../lib/sales/pdf/common';
import { RiwayatPersetujuanPanel } from './RiwayatPersetujuanPanel';
import TambahLayananModal from '../penjualan/TambahLayananModal';
import { captureError } from '../../lib/captureError';
import EmptyState from '../ui/EmptyState';

interface Props {
  order: Order;
  settings: StoreSettings | null;
  banks: BankAccount[] | null;
  onOpenProof: () => void;
  onUploadProof: () => void;
  onEdit?: () => void;
  /** Tolak Order at 2b → 2e (with reason). */
  onReject?: () => void;
  /** Buka Lagi 2e → 2d, or 3e → 3b. */
  onReopen?: () => void;
  /** 4a / 4b → 4d (with reason). */
  onMarkProblem?: () => void;
  /** 4d → 4a (continue delivery after problem solved). */
  onResolveContinue?: () => void;
  /** 4d → 5a (close out after problem resolved + handed over). */
  onResolveReceived?: () => void;
  /** Batalkan Pesanan → 6a (with reason). Hidden on terminal stages. */
  onCancelOrder?: () => void;
  /** Admin withdraws own pending rakit_lock approval at 3g. CP/RP only. */
  onWithdrawRakitLock?: () => void;
}

// Pre-payment sub-stages where the Edit button is shown. Mirrors the spec
// in "Task 4 — EditOrderModal" — admin can still tweak ongkir / items before
// the customer pays.
const EDITABLE_SUBS = new Set<FunnelSubStage>(['2a', '2b', '2c', '2d']);

// Sub-stages where the universal Batalkan button is visible (i.e. anywhere
// except the terminal ones).
const TERMINAL_SUBS = new Set<FunnelSubStage>(['5a', '6a', '6b']);

// Sub-stages where Tolak (→ 2e) is offered as a manual escalation.
const REJECTABLE_SUBS = new Set<FunnelSubStage>(['2b']);

// Sub-stages where a Buka Lagi action is offered (manual recovery from a
// dead-end "ditolak" state once the customer comes back).
const REOPEN_SUBS = new Set<FunnelSubStage>(['2e', '3e']);

// Sub-stages where Ada Masalah → 4d is offered (in-flight delivery).
const PROBLEM_SUBS = new Set<FunnelSubStage>(['4a', '4b']);

const PDF_LABELS: Record<AvailablePdf, { emoji: string; label: string; bg: string; fg: string; border: string }> = {
  'SO':        { emoji: '📄', label: 'Sales Order',        bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
  'INV-DP':    { emoji: '💛', label: 'Invoice DP',         bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  'INV-LUNAS': { emoji: '💰', label: 'Invoice Lunas',      bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
  'INV-PEL':   { emoji: '💰', label: 'Invoice Pelunasan',  bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
  'SJ':        { emoji: '🚚', label: 'Surat Jalan',        bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  'CAN':       { emoji: '📝', label: 'Catatan Pembatalan', bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
};

export function ActionPanel({
  order, settings, banks, onOpenProof, onUploadProof, onEdit,
  onReject, onReopen, onMarkProblem, onResolveContinue, onResolveReceived, onCancelOrder,
  onWithdrawRakitLock,
}: Props) {
  const [generating, setGenerating] = useState<AvailablePdf | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; filename: string } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [layananModalOpen, setLayananModalOpen] = useState(false);
  const [layananToast, setLayananToast] = useState<string | null>(null);
  // Print target picker: normal = A4 with colors; dot_matrix = mono, no fills,
  // sized for LX-310 / LX-2190 fanfold impact printers. The mode toggle wraps
  // every generate*Pdf call below.
  const [printMode, setPrintMode] = useState<PdfPrintMode>('normal');

  const isVerifyStage = order.funnel_sub_stage === '2d' || order.funnel_sub_stage === '3b';
  const pdfs = availablePdfsForOrder(order);
  const showEdit = EDITABLE_SUBS.has(order.funnel_sub_stage) && !!onEdit;
  const showReject = REJECTABLE_SUBS.has(order.funnel_sub_stage) && !!onReject;
  const showReopen = REOPEN_SUBS.has(order.funnel_sub_stage) && !!onReopen;
  const showProblem = PROBLEM_SUBS.has(order.funnel_sub_stage) && !!onMarkProblem;
  const showResolve = order.funnel_sub_stage === '4d' && (!!onResolveContinue || !!onResolveReceived);
  const showWithdrawRakit =
    order.funnel_sub_stage === '3g' &&
    (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL') &&
    !!onWithdrawRakitLock;
  const showCancel = !TERMINAL_SUBS.has(order.funnel_sub_stage) && !!onCancelOrder;
  const showExtraRow = showReject || showReopen || showProblem || showResolve || showCancel || showWithdrawRakit;
  const showRiwayat =
    (order.funnel_sub_stage === '3g' || order.funnel_sub_stage === '3h') &&
    (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL');

  // Item #2: panel always shown so 🛠 Tambah Layanan is reachable regardless
  // of stage. Original early-return kept as a soft check — if genuinely
  // nothing else is showing, the button itself still renders below.

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
        case 'SO': {
          const { generateSalesOrderPdf } = await import('../../lib/sales/pdf/salesOrderPdf');
          result = await generateSalesOrderPdf(order, settings, banks, printMode);
          break;
        }
        case 'INV-DP': {
          const { generateInvoiceDpPdf } = await import('../../lib/sales/pdf/invoiceDpPdf');
          result = await generateInvoiceDpPdf(order, settings, banks, printMode);
          break;
        }
        case 'INV-LUNAS': {
          const { generateInvoiceLunasPdf } = await import('../../lib/sales/pdf/invoiceLunasPdf');
          result = await generateInvoiceLunasPdf(order, settings, banks, printMode);
          break;
        }
        case 'INV-PEL': {
          const { generateInvoicePelunasanPdf } = await import('../../lib/sales/pdf/invoicePelunasanPdf');
          result = await generateInvoicePelunasanPdf(order, settings, banks, printMode);
          break;
        }
        case 'SJ': {
          const { generateSuratJalanPdf } = await import('../../lib/sales/pdf/suratJalanPdf');
          result = await generateSuratJalanPdf(order, settings, banks, printMode);
          break;
        }
        case 'CAN': {
          const { generateCatatanPembatalanPdf } = await import('../../lib/sales/pdf/catatanPembatalanPdf');
          result = await generateCatatanPembatalanPdf(order, settings, banks, printMode);
          break;
        }
      }
      setPreview({ blob: result!.blob, filename: result!.filename });
    } catch (err) {
      captureError(err, { feature: 'sales', action: 'generate_pdf', kind });
      setGenError(`Gagal generate ${PDF_LABELS[kind].label}.`);
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div style={{ background: '#fafbff', padding: '14px 24px 14px 60px', borderBottom: '1px solid var(--color-caleo-mist)' }}>
      {isVerifyStage && (
        <>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Cek Bukti Pembayaran
          </div>
          {proofUrl ? (
            <PaymentProofThumbnail proofUrl={proofUrl} source={order.proof_source} onClick={onOpenProof} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <EmptyState
                inline
                message="Belum ada bukti dari customer"
                className="flex-1 rounded bg-[#f9fafb]"
              />
              <button onClick={onUploadProof} style={{ background: 'var(--color-primary)', color: 'white', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                📤 Upload Bukti Manual
              </button>
            </div>
          )}
        </>
      )}

      {(pdfs.length > 0 || showEdit) && (
        <div style={{ marginTop: isVerifyStage ? 14 : 0 }}>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Dokumen & Aksi</span>
            {pdfs.length > 0 && (
              <span style={{ display: 'inline-flex', gap: 4, background: '#f3f4f6', borderRadius: 8, padding: 2 }}>
                <button
                  type="button"
                  onClick={() => setPrintMode('normal')}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: printMode === 'normal' ? 'var(--color-caleo-primary)' : 'transparent',
                    color: printMode === 'normal' ? 'white' : '#6b7280',
                    fontWeight: 700, letterSpacing: 0,
                  }}
                >A4 Berwarna</button>
                <button
                  type="button"
                  onClick={() => setPrintMode('dot_matrix')}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: printMode === 'dot_matrix' ? 'var(--color-caleo-primary)' : 'transparent',
                    color: printMode === 'dot_matrix' ? 'white' : '#6b7280',
                    fontWeight: 700, letterSpacing: 0,
                  }}
                >Dot Matrix</button>
              </span>
            )}
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

      {showExtraRow && (
        <div style={{ marginTop: (pdfs.length > 0 || showEdit || isVerifyStage) ? 14 : 0 }}>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Aksi Lain
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {showReject && (
              <button type="button" onClick={onReject} style={pillStyle('#fee2e2', '#991b1b', '#fecaca')}>
                ❌ Tolak Order
              </button>
            )}
            {showReopen && (
              <button type="button" onClick={onReopen} style={pillStyle('#e0e7ff', '#3730a3', '#c7d2fe')}>
                🔄 Buka Lagi
              </button>
            )}
            {showProblem && (
              <button type="button" onClick={onMarkProblem} style={pillStyle('#fef3c7', '#92400e', '#fde68a')}>
                🆘 Ada Masalah Kirim
              </button>
            )}
            {showResolve && onResolveContinue && (
              <button type="button" onClick={onResolveContinue} style={pillStyle('#e0e7ff', '#3730a3', '#c7d2fe')}>
                🚚 Lanjut Kirim
              </button>
            )}
            {showResolve && onResolveReceived && (
              <button type="button" onClick={onResolveReceived} style={pillStyle('#dcfce7', '#166534', '#bbf7d0')}>
                ✓ Sudah Diterima
              </button>
            )}
            {showWithdrawRakit && (
              <button type="button" onClick={onWithdrawRakitLock} style={pillStyle('#fef3c7', '#92400e', '#fde68a')}>
                ↩ Tarik Pengajuan
              </button>
            )}
            {showCancel && (
              <button type="button" onClick={onCancelOrder} style={pillStyle('#fef2f2', '#b91c1c', '#fca5a5')}>
                🗑 Batalkan Pesanan
              </button>
            )}
          </div>
        </div>
      )}

      {/* Item #2: 🛠 Tambah Layanan — always available for any order */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
        <button
          type="button"
          onClick={() => setLayananModalOpen(true)}
          style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 8,
            background: '#ecfdf5',
            color: '#047857',
            border: '1px solid #a7f3d0',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          title="Attach layanan (Wiring / Custom Panel) dari katalog"
        >
          🛠 + Tambah Layanan
        </button>
      </div>

      {showRiwayat && <RiwayatPersetujuanPanel orderId={order.id} />}

      {preview && (
        <PdfPreviewModal
          blob={preview.blob}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}

      {layananModalOpen && (
        <TambahLayananModal
          orderId={order.id}
          onDone={() => {
            setLayananModalOpen(false);
            setLayananToast('Layanan ditambahkan');
            setTimeout(() => setLayananToast(null), 3000);
          }}
          onCancel={() => setLayananModalOpen(false)}
          showToast={(msg) => setLayananToast(msg)}
        />
      )}
      {layananToast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 60,
          background: '#065f46', color: 'white',
          padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
        }}>
          {layananToast}
        </div>
      )}
    </div>
  );
}

function pillStyle(bg: string, fg: string, border: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 8,
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
