// src/components/admin/TenantDetail/PembayaranTab.tsx
// Payment history tab for a single tenant (Phase B Wave 5 Task 8).
// Coverage summary strip + table with Edit/Delete/Bukti actions.
// VOSI design tokens; Bahasa Indonesia labels.
import { useEffect, useState } from 'react';
import { listPayments, generatePaymentProofSignedUrl, deletePayment, getTenantCoverage } from '../../../lib/paymentsApi';
import { adminToast } from '../../../lib/adminToast';
import {
  AdminApiError,
  StorageAccessDeniedError,
  type CoverageStatus,
} from '../../../lib/adminTypes';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import type { PaymentRow } from '../../../lib/paymentsTypes';
import { RecordPaymentModal } from '../RecordPaymentModal';
import { CoverageStatusBadge } from '../CoverageStatusBadge';
import type { RecordPaymentResult } from '../../../lib/paymentsTypes';

// ─── VOSI colour constants ────────────────────────────────────────────────────

const C = {
  navy:    '#0B2545',
  gold:    '#F9B233',
  cream:   '#FAF7F0',
  slate:   '#5A6472',
  muted:   '#9DB2CE',
  surface: '#ECEEF1',
  ink:     '#14161B',
  success: '#1F8A5B',
  danger:  '#C0392B',
  info:    '#2A6FDB',
} as const;

// ─── Plan price map (matches Wave 5 Task 1 seed values in plans.price_annual)
// Used only as a default hint for RecordPaymentModal nominal input — the
// authoritative source is the plans table. Kept as a constant to avoid an
// extra network round-trip on tab mount for a purely optional default.
const PLAN_PRICE_IDR = {
  STARTER: 1_200_000,
  PRO:     3_600_000,
  PREMIUM: 9_000_000,
} as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tenantId:   string;
  tenantSlug: string;
  row:        AdminTenantRow;
}

// ─── Date/amount formatters ───────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

function fmtMethod(method: PaymentRow['payment_method']): string {
  const map: Record<PaymentRow['payment_method'], string> = {
    BANK_TRANSFER:  'Transfer',
    CASH:           'Tunai',
    E_WALLET:       'E-Wallet',
    QRIS:           'QRIS',
    VIRTUAL_ACCOUNT: 'VA',
    OTHER:          'Lainnya',
  };
  return map[method] ?? method;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" data-testid="pembayaran-tab-skeleton">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-10 rounded-sm"
          style={{ background: C.surface }}
        />
      ))}
    </div>
  );
}

// ─── Delete confirmation dialog ───────────────────────────────────────────────

interface DeleteDialogProps {
  open:        boolean;
  paymentId:   string;
  onClose:     () => void;
  onDeleted:   () => void;
}

function DeleteConfirmDialog({ open, paymentId, onClose, onDeleted }: DeleteDialogProps) {
  const [reason,     setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) { setReason(''); setSubmitting(false); }
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      await deletePayment(paymentId, reason.trim());
      adminToast.success('Pembayaran dihapus.');
      onDeleted();
    } catch (err) {
      if (err instanceof AdminApiError) {
        adminToast.error(err.userMessage);
      } else {
        adminToast.error('Gagal menghapus pembayaran.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-payment-title"
      data-testid="delete-payment-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-caleo-navy/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        className="bg-white rounded-sm shadow-xl p-6 max-w-sm w-full font-caleo mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="delete-payment-title"
          className="text-[15px] font-bold text-caleo-navy mb-3"
        >
          Konfirmasi Hapus Pembayaran
        </h3>
        <p className="text-[13px] mb-4" style={{ color: C.slate }}>
          Tindakan ini tidak dapat dibatalkan. Masukkan alasan penghapusan:
        </p>
        <div className="mb-5">
          <label
            htmlFor="delete-reason"
            className="block text-[12px] font-semibold text-caleo-navy mb-1"
          >
            Alasan penghapusan <span className="text-caleo-danger">*</span>
          </label>
          <textarea
            id="delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            maxLength={500}
            rows={3}
            placeholder="Contoh: duplikat, kesalahan input, dll."
            className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy placeholder:text-caleo-navy/30 resize-none focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
            aria-label="Alasan penghapusan"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-caleo-navy border border-caleo-navy/30 hover:bg-caleo-cream rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-40 transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !reason.trim()}
            className="rounded-full px-4 py-2 text-[13px] font-extrabold disabled:opacity-40 transition-opacity hover:opacity-90"
            style={{ background: C.danger, color: '#ffffff' }}
            data-testid="delete-confirm-btn"
          >
            {submitting ? 'Menghapus…' : 'Konfirmasi Hapus'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PembayaranTab ────────────────────────────────────────────────────────────

export function PembayaranTab({ tenantId, tenantSlug, row }: Props) {
  const [payments,       setPayments]       = useState<PaymentRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<CoverageStatus | null>(null);

  // Modal state
  const [recordOpen, setRecordOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PaymentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentRow | null>(null);

  // Fetch on mount + after mutations
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      listPayments({ tenant_id: tenantId, page_size: 100 }),
      getTenantCoverage(tenantId),
    ])
      .then(([rows, coverage]) => {
        if (!cancelled) {
          setPayments(rows);
          setCoverageStatus(coverage);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof AdminApiError ? err.userMessage : String(err);
          setError(msg);
          adminToast.error('Gagal memuat riwayat pembayaran', msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tenantId, fetchKey]);

  function refresh() {
    setFetchKey((k) => k + 1);
  }

  function handleModalSuccess(_result: RecordPaymentResult | { ok: true; payment_id: string }) {
    refresh();
  }

  // ── Coverage summary ──────────────────────────────────────────────────────

  const thisYear = new Date().getFullYear();
  const totalYTD = payments
    .filter((p) => new Date(p.payment_date).getFullYear() === thisYear)
    .reduce((sum, p) => sum + p.amount, 0);
  const totalAllTime = payments.reduce((sum, p) => sum + p.amount, 0);

  // ── Signed URL preview ────────────────────────────────────────────────────

  async function handleBuktiClick(proofUrl: string) {
    try {
      const url = await generatePaymentProofSignedUrl(proofUrl);
      window.open(url, '_blank');
    } catch (err) {
      if (err instanceof StorageAccessDeniedError) {
        adminToast.error(err.userMessage);
      } else {
        adminToast.error('Gagal membuka bukti pembayaran.');
      }
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 font-caleo" data-testid="pembayaran-tab-loading">
        <TableSkeleton />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <div
        className="border rounded-sm p-6 text-center"
        style={{ background: '#fff5f5', borderColor: '#fecaca' }}
        data-testid="pembayaran-tab-error"
      >
        <p className="text-[13px] font-semibold mb-1" style={{ color: C.danger }}>
          Gagal memuat riwayat pembayaran
        </p>
        <p className="text-[12px] mb-3" style={{ color: C.slate }}>{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="text-[13px] font-semibold rounded-full px-4 py-1.5 border"
          style={{ borderColor: C.navy, color: C.navy }}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (payments.length === 0) {
    return (
      <>
        <RecordPaymentModal
          open={recordOpen}
          tenant={row}
          mode="record"
          defaultAmount={PLAN_PRICE_IDR[row.plan_code as keyof typeof PLAN_PRICE_IDR]}
          onClose={() => setRecordOpen(false)}
          onSuccess={(result) => { handleModalSuccess(result); setRecordOpen(false); }}
        />
        <div
          className="border rounded-sm p-10 text-center"
          style={{ borderColor: C.surface }}
          data-testid="pembayaran-tab-empty"
        >
          <p
            className="text-[14px] font-semibold mb-2"
            style={{ color: C.navy }}
          >
            Belum ada pembayaran tercatat
          </p>
          <p className="text-[13px] mb-6" style={{ color: C.muted }}>
            Catat pembayaran pertama untuk tenant ini.
          </p>
          <button
            type="button"
            onClick={() => setRecordOpen(true)}
            className="bg-caleo-gold text-caleo-navy font-extrabold rounded-full px-6 py-3 text-[14px] hover:opacity-90 transition-opacity"
            data-testid="catat-pembayaran-cta"
          >
            + Catat pembayaran
          </button>
        </div>
      </>
    );
  }

  // ── Non-empty: summary + table ────────────────────────────────────────────

  return (
    <>
      {/* RecordPaymentModal (record) — defaultAmount from tenant's plan price */}
      <RecordPaymentModal
        open={recordOpen}
        tenant={row}
        mode="record"
        defaultAmount={PLAN_PRICE_IDR[row.plan_code as keyof typeof PLAN_PRICE_IDR]}
        onClose={() => setRecordOpen(false)}
        onSuccess={(result) => { handleModalSuccess(result); setRecordOpen(false); }}
      />

      {/* RecordPaymentModal (edit) */}
      {editTarget && (
        <RecordPaymentModal
          open={editTarget !== null}
          tenant={row}
          mode="edit"
          existingPayment={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={(result) => { handleModalSuccess(result); setEditTarget(null); }}
        />
      )}

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        paymentId={deleteTarget?.id ?? ''}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => { setDeleteTarget(null); refresh(); }}
      />

      <div className="space-y-4 font-caleo" data-testid="pembayaran-tab">
        {/* Coverage summary strip */}
        <div
          className="border rounded-sm px-5 py-4 flex flex-wrap gap-5 items-center"
          style={{ background: '#ffffff', borderColor: C.surface }}
          data-testid="coverage-summary"
        >
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase mb-0.5"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
              Total dibayar YTD
            </div>
            <div className="text-[16px] font-bold" style={{ color: C.navy }}>
              {fmtRupiah(totalYTD)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase mb-0.5"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
              Total dibayar (all-time)
            </div>
            <div className="text-[16px] font-bold" style={{ color: C.navy }}>
              {fmtRupiah(totalAllTime)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase mb-0.5"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
              Status coverage
            </div>
            <CoverageStatusBadge status={coverageStatus} />
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase mb-0.5"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
              Aktif s/d
            </div>
            <div className="text-[13px]" style={{ color: C.ink, fontFamily: 'JetBrains Mono, monospace' }}>
              {row.expires_at ?? '—'}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setRecordOpen(true)}
            className="bg-caleo-gold text-caleo-navy font-extrabold rounded-full px-4 py-2 text-[13px] hover:opacity-90 transition-opacity"
            data-testid="catat-pembayaran-btn"
          >
            + Catat pembayaran
          </button>
        </div>

        {/* Table */}
        <div
          className="border rounded-sm overflow-x-auto"
          style={{ borderColor: C.surface }}
        >
          <table
            className="w-full text-[12px]"
            style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
          >
            <thead>
              <tr style={{ background: C.navy }}>
                {(
                  ['Tanggal', 'Nominal', 'Metode', 'Periode', 'Bukti', 'Ref bank', 'Catatan', 'Dicatat oleh', 'Aksi'] as const
                ).map((label) => (
                  <th
                    key={label}
                    className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p, idx) => (
                <tr
                  key={p.id}
                  style={{
                    background: idx % 2 === 0 ? '#ffffff' : C.cream,
                    borderTop: `1px solid ${C.surface}`,
                  }}
                >
                  {/* Tanggal */}
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: C.slate }}>
                    {fmtDate(p.payment_date)}
                  </td>

                  {/* Nominal */}
                  <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: C.navy, fontFamily: 'JetBrains Mono, monospace' }}>
                    {fmtRupiah(p.amount)}
                  </td>

                  {/* Metode */}
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: C.slate }}>
                    {fmtMethod(p.payment_method)}
                    {p.bank_name && (
                      <span className="ml-1 text-[11px]" style={{ color: C.muted }}>
                        · {p.bank_name}
                      </span>
                    )}
                    {p.ewallet_provider && (
                      <span className="ml-1 text-[11px]" style={{ color: C.muted }}>
                        · {p.ewallet_provider}
                      </span>
                    )}
                  </td>

                  {/* Periode */}
                  <td className="px-3 py-2 whitespace-nowrap text-[11px]" style={{ color: C.slate, fontFamily: 'JetBrains Mono, monospace' }}>
                    {p.period_from} → {p.period_to}
                  </td>

                  {/* Bukti */}
                  <td className="px-3 py-2 text-center">
                    {p.proof_url ? (
                      <button
                        type="button"
                        onClick={() => handleBuktiClick(p.proof_url!)}
                        title="Lihat bukti"
                        className="text-caleo-gold hover:opacity-70 transition-opacity"
                        data-testid={`bukti-btn-${p.id}`}
                      >
                        📎
                      </button>
                    ) : (
                      <span style={{ color: C.muted }}>—</span>
                    )}
                  </td>

                  {/* Ref bank */}
                  <td className="px-3 py-2 text-[11px] max-w-[120px] truncate" style={{ color: C.slate, fontFamily: 'JetBrains Mono, monospace' }}>
                    {p.bank_reference ?? '—'}
                  </td>

                  {/* Catatan */}
                  <td className="px-3 py-2 text-[11px] max-w-[160px] truncate" style={{ color: C.slate }}>
                    {p.notes ?? '—'}
                  </td>

                  {/* Dicatat oleh */}
                  <td className="px-3 py-2 text-[11px] max-w-[140px] truncate" style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                    {p.recorded_by_admin}
                  </td>

                  {/* Aksi */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditTarget(p)}
                        className="text-[11px] font-semibold rounded-full px-2 py-0.5 border transition-colors hover:bg-caleo-cream"
                        style={{ borderColor: C.navy, color: C.navy }}
                        data-testid={`edit-payment-btn-${p.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
                        className="text-[11px] font-semibold rounded-full px-2 py-0.5 border transition-colors"
                        style={{ borderColor: C.danger, color: C.danger }}
                        data-testid={`delete-payment-btn-${p.id}`}
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <p className="text-[11px] text-right" style={{ color: C.muted }}>
          {payments.length} pembayaran · tenant: {tenantSlug}
        </p>
      </div>
    </>
  );
}
