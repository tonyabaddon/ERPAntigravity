// src/components/admin/RecordPaymentModal.tsx
// Modal for recording a new payment or editing an existing one.
// Covers spec §15.3(b) upload-mandatory rule and §15.3(c) field set.
// VOSI design tokens; Bahasa Indonesia labels.
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ChangeEvent,
} from 'react';
import { recordPayment, updatePayment, uploadPaymentProof } from '../../lib/paymentsApi';
import { adminToast } from '../../lib/adminToast';
import {
  AdminApiError,
  PaymentFileTooLargeError,
  PaymentFileWrongTypeError,
} from '../../lib/adminTypes';
import type { AdminTenantRow } from '../../lib/adminTypes';
import type {
  PaymentMethod,
  BankName,
  EwalletProvider,
  PaymentRow,
  RecordPaymentResult,
} from '../../lib/paymentsTypes';
import { wibDateString } from '../../lib/format';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  tenant: AdminTenantRow;
  mode: 'record' | 'edit';
  existingPayment?: PaymentRow;
  /** Called when the default amount should be the plan's annual price. */
  defaultAmount?: number;
  onClose: () => void;
  onSuccess: (result: RecordPaymentResult | { ok: true; payment_id: string }) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return wibDateString();
}

function todayPlusOneYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return wibDateString(d);
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK_TRANSFER', label: 'Transfer bank' },
  { value: 'CASH',          label: 'Tunai' },
  { value: 'E_WALLET',      label: 'E-Wallet' },
  { value: 'QRIS',          label: 'QRIS' },
  { value: 'VIRTUAL_ACCOUNT', label: 'Virtual account' },
  { value: 'OTHER',         label: 'Lainnya' },
];

const BANK_NAMES: { value: BankName; label: string }[] = [
  { value: 'BCA',       label: 'BCA' },
  { value: 'MANDIRI',   label: 'Mandiri' },
  { value: 'BRI',       label: 'BRI' },
  { value: 'BNI',       label: 'BNI' },
  { value: 'PERMATA',   label: 'Permata' },
  { value: 'CIMB',      label: 'CIMB Niaga' },
  { value: 'BSI',       label: 'BSI' },
  { value: 'DANAMON',   label: 'Danamon' },
  { value: 'BTN',       label: 'BTN' },
  { value: 'MEGA',      label: 'Mega' },
  { value: 'MAYBANK',   label: 'Maybank' },
  { value: 'PANIN',     label: 'Panin' },
  { value: 'OCBC',      label: 'OCBC NISP' },
  { value: 'JAGO',      label: 'Bank Jago' },
  { value: 'SEA_BANK',  label: 'SeaBank' },
  { value: 'OTHER',     label: 'Lainnya' },
];

const EWALLET_PROVIDERS: { value: EwalletProvider; label: string }[] = [
  { value: 'OVO',        label: 'OVO' },
  { value: 'GOPAY',      label: 'GoPay' },
  { value: 'DANA',       label: 'DANA' },
  { value: 'LINKAJA',    label: 'LinkAja' },
  { value: 'SHOPEEPAY',  label: 'ShopeePay' },
  { value: 'JENIUS_PAY', label: 'Jenius Pay' },
  { value: 'OTHER',      label: 'Lainnya' },
];

/** Methods that require bank selection */
const NEEDS_BANK: PaymentMethod[] = ['BANK_TRANSFER', 'VIRTUAL_ACCOUNT'];
/** Methods that require e-wallet provider */
const NEEDS_EWALLET: PaymentMethod[] = ['E_WALLET', 'QRIS'];

function formatRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

// ─── RecordPaymentModal ───────────────────────────────────────────────────────

export function RecordPaymentModal({
  open,
  tenant,
  mode,
  existingPayment,
  defaultAmount,
  onClose,
  onSuccess,
}: Props) {
  const [amount, setAmount]           = useState('');
  const [method, setMethod]           = useState<PaymentMethod>('BANK_TRANSFER');
  const [bankName, setBankName]       = useState<BankName | ''>('');
  const [ewalletProvider, setEwallet] = useState<EwalletProvider | ''>('');
  const [paymentDate, setPaymentDate] = useState(today());
  const [periodFrom, setPeriodFrom]   = useState(today());
  const [periodTo, setPeriodTo]       = useState(todayPlusOneYear());
  const [bankRef, setBankRef]         = useState('');
  const [notes, setNotes]             = useState('');
  const [proofFile, setProofFile]     = useState<File | null>(null);
  const [fileError, setFileError]     = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && existingPayment) {
      setAmount(String(existingPayment.amount));
      setMethod(existingPayment.payment_method);
      setBankName(existingPayment.bank_name ?? '');
      setEwallet(existingPayment.ewallet_provider ?? '');
      setPaymentDate(existingPayment.payment_date);
      setPeriodFrom(existingPayment.period_from);
      setPeriodTo(existingPayment.period_to);
      setBankRef(existingPayment.bank_reference ?? '');
      setNotes(existingPayment.notes ?? '');
    } else {
      setAmount(defaultAmount != null ? String(defaultAmount) : '');
      setMethod('BANK_TRANSFER');
      setBankName('');
      setEwallet('');
      setPaymentDate(today());
      setPeriodFrom(today());
      setPeriodTo(todayPlusOneYear());
      setBankRef('');
      setNotes('');
    }
    setProofFile(null);
    setFileError(null);
    setSubmitting(false);

    const raf = requestAnimationFrame(() => {
      amountInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, mode, existingPayment, defaultAmount]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  // ─── Derived state ─────────────────────────────────────────────────────────

  const showBank    = NEEDS_BANK.includes(method);
  const showEwallet = NEEDS_EWALLET.includes(method);
  const requireUpload = method !== 'CASH';
  const hasExistingProof = mode === 'edit' && existingPayment?.proof_url;

  // ─── Validation ────────────────────────────────────────────────────────────

  const amountNum = parseFloat(amount);
  const amountValid    = !isNaN(amountNum) && amountNum > 0;
  const periodValid    = periodFrom <= periodTo;
  const bankValid      = !showBank    || bankName    !== '';
  const ewalletValid   = !showEwallet || ewalletProvider !== '';
  // Upload mandatory in record mode if method != CASH; in edit mode skip if existing proof
  const uploadRequired = requireUpload && mode === 'record';
  const uploadValid    = !uploadRequired || proofFile !== null;

  const formValid = amountValid && periodValid && bankValid && ewalletValid && uploadValid && fileError === null;

  // ─── File handling ─────────────────────────────────────────────────────────

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);
    setProofFile(null);
    if (!file) return;

    // Client-side validation matching paymentsApi limits
    if (file.size > 5 * 1024 * 1024) {
      setFileError(new PaymentFileTooLargeError().userMessage);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setFileError(new PaymentFileWrongTypeError().userMessage);
      return;
    }

    setProofFile(file);
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formValid || submitting) return;

    setSubmitting(true);
    try {
      let proofObjectKey: string | null = null;

      if (proofFile) {
        const { objectKey } = await uploadPaymentProof(tenant.tenant_id, proofFile);
        proofObjectKey = objectKey;
      }

      if (mode === 'record') {
        const result = await recordPayment({
          tenant_id:        tenant.tenant_id,
          amount:           amountNum,
          payment_method:   method,
          payment_date:     paymentDate,
          period_from:      periodFrom,
          period_to:        periodTo,
          bank_name:        showBank    ? (bankName as BankName) : null,
          ewallet_provider: showEwallet ? (ewalletProvider as EwalletProvider) : null,
          proof_object_key: proofObjectKey,
          bank_reference:   bankRef.trim() || null,
          notes:            notes.trim()   || null,
        });
        adminToast.success('Pembayaran tercatat.');
        onSuccess(result);
        onClose();
      } else if (mode === 'edit' && existingPayment) {
        // Build updates: only include fields that changed
        const updates: Record<string, unknown> = {};
        if (amountNum !== existingPayment.amount) updates.amount = amountNum;
        if (method !== existingPayment.payment_method) updates.payment_method = method;
        if (paymentDate !== existingPayment.payment_date) updates.payment_date = paymentDate;
        if (periodFrom !== existingPayment.period_from) updates.period_from = periodFrom;
        if (periodTo !== existingPayment.period_to) updates.period_to = periodTo;
        const newBank = showBank ? (bankName as BankName) : null;
        if (newBank !== existingPayment.bank_name) updates.bank_name = newBank;
        const newEwallet = showEwallet ? (ewalletProvider as EwalletProvider) : null;
        if (newEwallet !== existingPayment.ewallet_provider) updates.ewallet_provider = newEwallet;
        if (proofObjectKey) updates.proof_object_key = proofObjectKey;
        const newRef = bankRef.trim() || null;
        if (newRef !== existingPayment.bank_reference) updates.bank_reference = newRef;
        const newNotes = notes.trim() || null;
        if (newNotes !== existingPayment.notes) updates.notes = newNotes;

        await updatePayment(existingPayment.id, updates);
        adminToast.success('Pembayaran diperbarui.');
        onSuccess({ ok: true, payment_id: existingPayment.id });
        onClose();
      }
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
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const title = mode === 'edit' ? 'Edit pembayaran' : 'Catat pembayaran';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-modal-title"
      data-testid="record-payment-modal-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-vosi-navy/40 backdrop-blur-sm overflow-y-auto py-8"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full font-vosi mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2
          id="record-payment-modal-title"
          className="text-vosi-navy font-bold text-lg mb-1"
        >
          {title}
        </h2>
        <p className="text-[13px] mb-5" style={{ color: '#5A6472' }}>
          <span className="font-semibold">{tenant.name}</span>
          {tenant.plan_code && (
            <span className="ml-2 text-[12px]">· {tenant.plan_code}</span>
          )}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {/* Nominal diterima */}
          <div className="mb-4">
            <label
              htmlFor="rp-amount"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Nominal diterima
              <span className="font-normal text-vosi-navy/50 ml-1">(IDR)</span>
            </label>
            <input
              id="rp-amount"
              ref={amountInputRef}
              type="number"
              min="1"
              step="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              placeholder={defaultAmount != null
                ? `Contoh: ${defaultAmount}`
                : 'Contoh: 3600000'}
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Nominal diterima"
            />
            {amount && !amountValid && (
              <p className="text-[11px] mt-1 text-vosi-danger">Nominal harus lebih dari 0.</p>
            )}
          </div>

          {/* Metode pembayaran */}
          <div className="mb-4">
            <label
              htmlFor="rp-method"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Metode pembayaran
            </label>
            <select
              id="rp-method"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as PaymentMethod);
                setBankName('');
                setEwallet('');
              }}
              disabled={submitting}
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy bg-white focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Metode pembayaran"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Bank name — conditional */}
          {showBank && (
            <div className="mb-4">
              <label
                htmlFor="rp-bank"
                className="block text-[12px] font-semibold text-vosi-navy mb-1"
              >
                Bank
              </label>
              <select
                id="rp-bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value as BankName)}
                disabled={submitting}
                className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy bg-white focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
                aria-label="Bank"
              >
                <option value="">— Pilih bank —</option>
                {BANK_NAMES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              {!bankValid && (
                <p className="text-[11px] mt-1 text-vosi-danger">Pilih bank untuk metode ini.</p>
              )}
            </div>
          )}

          {/* E-wallet provider — conditional */}
          {showEwallet && (
            <div className="mb-4">
              <label
                htmlFor="rp-ewallet"
                className="block text-[12px] font-semibold text-vosi-navy mb-1"
              >
                Penyedia e-wallet
              </label>
              <select
                id="rp-ewallet"
                value={ewalletProvider}
                onChange={(e) => setEwallet(e.target.value as EwalletProvider)}
                disabled={submitting}
                className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy bg-white focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
                aria-label="Penyedia e-wallet"
              >
                <option value="">— Pilih e-wallet —</option>
                {EWALLET_PROVIDERS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
              {!ewalletValid && (
                <p className="text-[11px] mt-1 text-vosi-danger">Pilih penyedia e-wallet untuk metode ini.</p>
              )}
            </div>
          )}

          {/* Tanggal terima */}
          <div className="mb-4">
            <label
              htmlFor="rp-date"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Tanggal terima
            </label>
            <input
              id="rp-date"
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={submitting}
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Tanggal terima"
            />
          </div>

          {/* Periode */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label
                htmlFor="rp-period-from"
                className="block text-[12px] font-semibold text-vosi-navy mb-1"
              >
                Periode mulai
              </label>
              <input
                id="rp-period-from"
                type="date"
                required
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                disabled={submitting}
                className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
                aria-label="Periode mulai"
              />
            </div>
            <div>
              <label
                htmlFor="rp-period-to"
                className="block text-[12px] font-semibold text-vosi-navy mb-1"
              >
                Periode selesai
              </label>
              <input
                id="rp-period-to"
                type="date"
                required
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                disabled={submitting}
                className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
                aria-label="Periode selesai"
              />
            </div>
          </div>
          {!periodValid && (
            <p className="text-[11px] -mt-3 mb-3 text-vosi-danger">Periode selesai harus setelah periode mulai.</p>
          )}

          {/* Upload bukti transfer */}
          <div className="mb-4">
            <label
              htmlFor="rp-proof"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Bukti transfer
              {uploadRequired && (
                <span className="text-vosi-danger ml-1">*</span>
              )}
              {!uploadRequired && (
                <span className="font-normal text-vosi-navy/50 ml-1">(opsional)</span>
              )}
            </label>
            {hasExistingProof && !proofFile && (
              <p className="text-[11px] mb-1" style={{ color: '#5A6472' }}>
                Sudah ada bukti tersimpan. Upload baru untuk mengganti.
              </p>
            )}
            <input
              id="rp-proof"
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              onChange={handleFileChange}
              disabled={submitting}
              className="w-full text-[13px] text-vosi-navy border border-vosi-navy/30 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-[11px] file:font-semibold file:bg-vosi-gold file:text-vosi-navy hover:file:opacity-90 disabled:opacity-50"
              aria-label="Upload bukti transfer"
              data-testid="rp-proof-input"
            />
            {fileError && (
              <p className="text-[11px] mt-1 text-vosi-danger">{fileError}</p>
            )}
            {proofFile && !fileError && (
              <p className="text-[11px] mt-1" style={{ color: '#1F8A5B' }}>
                ✓ {proofFile.name} ({(proofFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
            {uploadRequired && !proofFile && !hasExistingProof && (
              <p className="text-[11px] mt-1 text-vosi-danger">
                Bukti wajib diupload untuk metode ini.
              </p>
            )}
          </div>

          {/* Referensi bank */}
          <div className="mb-4">
            <label
              htmlFor="rp-bank-ref"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Referensi bank <span className="font-normal text-vosi-navy/50">(opsional)</span>
            </label>
            <input
              id="rp-bank-ref"
              type="text"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              disabled={submitting}
              maxLength={100}
              placeholder="Contoh: TRF-0001-XYZ"
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy placeholder:text-vosi-navy/30 focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Referensi bank"
            />
          </div>

          {/* Catatan */}
          <div className="mb-6">
            <label
              htmlFor="rp-notes"
              className="block text-[12px] font-semibold text-vosi-navy mb-1"
            >
              Catatan <span className="font-normal text-vosi-navy/50">(opsional)</span>
            </label>
            <textarea
              id="rp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              maxLength={500}
              rows={3}
              placeholder="Catatan internal tentang pembayaran ini"
              className="w-full border border-vosi-navy/30 rounded-lg px-3 py-2 text-[13px] text-vosi-navy placeholder:text-vosi-navy/30 resize-none focus:outline-none focus:ring-2 focus:ring-vosi-gold disabled:opacity-50"
              aria-label="Catatan"
            />
            <p className="text-[11px] text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {notes.length}/500
            </p>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-vosi-navy border border-vosi-navy/30 hover:bg-vosi-cream rounded-full px-5 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !formValid}
              className="bg-vosi-gold text-vosi-navy font-extrabold rounded-full px-5 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
              data-testid="rp-submit"
            >
              {submitting
                ? 'Menyimpan…'
                : mode === 'edit'
                ? 'Simpan perubahan'
                : 'Catat pembayaran'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Export helper types for test re-use
export { formatRupiah };
