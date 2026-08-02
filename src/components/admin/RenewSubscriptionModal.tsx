// src/components/admin/RenewSubscriptionModal.tsx
// Dialog for renewing a tenant subscription (Perpanjang Masa Aktif).
// Calls renewSubscription RPC; emits onSuccess(result) to parent for re-fetch.
// Optionally chains recordPayment after a successful renewal.
// VOSI design tokens; Bahasa Indonesia labels.
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ChangeEvent,
} from 'react';
import { renewSubscription } from '../../lib/adminApi';
import { recordPayment, uploadPaymentProof } from '../../lib/paymentsApi';
import { adminToast } from '../../lib/adminToast';
import type { AdminTenantRow, RenewSubscriptionResult } from '../../lib/adminTypes';
import {
  AdminApiError,
  PaymentFileTooLargeError,
  PaymentFileWrongTypeError,
} from '../../lib/adminTypes';
import type { PaymentMethod, BankName, EwalletProvider } from '../../lib/paymentsTypes';
import { wibDateString } from '../../lib/format';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  tenant: AdminTenantRow;
  onClose: () => void;
  onSuccess: (result: RenewSubscriptionResult) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute ISO YYYY-MM-DD for 1 year from the given date string. */
function addOneYear(iso: string): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + 1);
  return wibDateString(d);
}

/** Today as ISO YYYY-MM-DD. */
function today(): string {
  return wibDateString();
}

/** Default new_expires_at: tenant.expires_at + 1 year, or today + 1 year when null. */
function defaultExpiresAt(tenant: AdminTenantRow): string {
  const base = tenant.expires_at ?? today();
  return addOneYear(base);
}

// Plan price defaults (matches Task 1 seed values — fallback for when plans API is unavailable)
const PLAN_PRICES: Record<string, number> = {
  STARTER: 1_200_000,
  PRO:     3_600_000,
  PREMIUM: 9_000_000,
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK_TRANSFER',   label: 'Transfer bank' },
  { value: 'CASH',             label: 'Tunai' },
  { value: 'E_WALLET',         label: 'E-Wallet' },
  { value: 'QRIS',             label: 'QRIS' },
  { value: 'VIRTUAL_ACCOUNT',  label: 'Virtual account' },
  { value: 'OTHER',            label: 'Lainnya' },
];

const BANK_NAMES: { value: BankName; label: string }[] = [
  { value: 'BCA',      label: 'BCA' },
  { value: 'MANDIRI',  label: 'Mandiri' },
  { value: 'BRI',      label: 'BRI' },
  { value: 'BNI',      label: 'BNI' },
  { value: 'PERMATA',  label: 'Permata' },
  { value: 'CIMB',     label: 'CIMB Niaga' },
  { value: 'BSI',      label: 'BSI' },
  { value: 'DANAMON',  label: 'Danamon' },
  { value: 'BTN',      label: 'BTN' },
  { value: 'MEGA',     label: 'Mega' },
  { value: 'MAYBANK',  label: 'Maybank' },
  { value: 'PANIN',    label: 'Panin' },
  { value: 'OCBC',     label: 'OCBC NISP' },
  { value: 'JAGO',     label: 'Bank Jago' },
  { value: 'SEA_BANK', label: 'SeaBank' },
  { value: 'OTHER',    label: 'Lainnya' },
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

const NEEDS_BANK: PaymentMethod[]    = ['BANK_TRANSFER', 'VIRTUAL_ACCOUNT'];
const NEEDS_EWALLET: PaymentMethod[] = ['E_WALLET', 'QRIS'];

// ─── RenewSubscriptionModal ───────────────────────────────────────────────────

export function RenewSubscriptionModal({ open, tenant, onClose, onSuccess }: Props) {
  // ── Core renewal fields ─────────────────────────────────────────────────────
  const [newExpiresAt, setNewExpiresAt] = useState(() => defaultExpiresAt(tenant));
  const [newPlanCode, setNewPlanCode]   = useState<'' | 'STARTER' | 'PRO' | 'PREMIUM'>('');
  const [notes, setNotes]               = useState('');
  const [submitting, setSubmitting]     = useState(false);

  // ── Payment chain fields ────────────────────────────────────────────────────
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [payAmount, setPayAmount]           = useState('');
  const [payMethod, setPayMethod]           = useState<PaymentMethod>('BANK_TRANSFER');
  const [payBankName, setPayBankName]       = useState<BankName | ''>('');
  const [payEwallet, setPayEwallet]         = useState<EwalletProvider | ''>('');
  const [payBankRef, setPayBankRef]         = useState('');
  const [payProofFile, setPayProofFile]     = useState<File | null>(null);
  const [payFileError, setPayFileError]     = useState<string | null>(null);

  const dateInputRef = useRef<HTMLInputElement>(null);

  // ── Default amount based on plan ────────────────────────────────────────────
  const effectivePlanCode = newPlanCode !== '' ? newPlanCode : tenant.plan_code;
  const defaultPayAmount = effectivePlanCode
    ? String(PLAN_PRICES[effectivePlanCode] ?? '')
    : '';

  // Reset form when modal opens with (possibly new) tenant.
  useEffect(() => {
    if (open) {
      setNewExpiresAt(defaultExpiresAt(tenant));
      setNewPlanCode('');
      setNotes('');
      setSubmitting(false);
      setPaymentEnabled(false);
      setPayAmount(tenant.plan_code ? String(PLAN_PRICES[tenant.plan_code] ?? '') : '');
      setPayMethod('BANK_TRANSFER');
      setPayBankName('');
      setPayEwallet('');
      setPayBankRef('');
      setPayProofFile(null);
      setPayFileError(null);
      // Focus date input on open
      const raf = requestAnimationFrame(() => {
        dateInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, tenant]);

  // Update default amount when plan changes
  useEffect(() => {
    if (paymentEnabled) {
      setPayAmount(defaultPayAmount);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPlanCode, paymentEnabled]);

  // ESC key to close (only when not submitting).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  // ── Validation ──────────────────────────────────────────────────────────────

  const isDateValid = newExpiresAt > today();

  const showBank    = NEEDS_BANK.includes(payMethod);
  const showEwallet = NEEDS_EWALLET.includes(payMethod);
  const requireUpload = payMethod !== 'CASH';

  const payAmountNum = parseFloat(payAmount);
  const payAmountValid  = !isNaN(payAmountNum) && payAmountNum > 0;
  const payBankValid    = !showBank    || payBankName    !== '';
  const payEwalletValid = !showEwallet || payEwallet     !== '';
  const payUploadValid  = !requireUpload || payProofFile !== null;

  const paymentSectionValid = !paymentEnabled ||
    (payAmountValid && payBankValid && payEwalletValid && payUploadValid && payFileError === null);

  const formValid = isDateValid && paymentSectionValid;

  // ── File handling ───────────────────────────────────────────────────────────

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPayFileError(null);
    setPayProofFile(null);
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setPayFileError(new PaymentFileTooLargeError().userMessage);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setPayFileError(new PaymentFileWrongTypeError().userMessage);
      return;
    }
    setPayProofFile(file);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formValid || submitting) return;

    setSubmitting(true);
    let renewResult: RenewSubscriptionResult | null = null;

    // Step 1: Renew subscription
    try {
      renewResult = await renewSubscription({
        tenant_id:    tenant.tenant_id,
        new_expires_at: newExpiresAt,
        new_plan_code: newPlanCode === '' ? null : newPlanCode,
        notes: notes.trim() || null,
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        adminToast.error(err.userMessage);
      } else {
        adminToast.error('Terjadi kesalahan tak terduga.');
      }
      setSubmitting(false);
      return;
    }

    // Step 2 + 3: Payment chain (optional)
    if (paymentEnabled && renewResult) {
      let proofObjectKey: string | null = null;

      // Step 2: Upload proof if present
      if (payProofFile) {
        try {
          const { objectKey } = await uploadPaymentProof(tenant.tenant_id, payProofFile);
          proofObjectKey = objectKey;
        } catch (_uploadErr) {
          // Upload failed but renewal succeeded — partial success
          adminToast.error(
            'Perpanjangan berhasil, tapi upload bukti gagal. Silakan catat manual di tab Pembayaran.'
          );
          onSuccess(renewResult);
          onClose();
          return;
        }
      }

      // Step 3: Record payment
      try {
        const oldExpiresAt = tenant.expires_at ?? today();
        await recordPayment({
          tenant_id:        tenant.tenant_id,
          amount:           payAmountNum,
          payment_method:   payMethod,
          payment_date:     today(),
          period_from:      oldExpiresAt,
          period_to:        renewResult.new_expires_at,
          bank_name:        showBank    ? (payBankName  as BankName)        : null,
          ewallet_provider: showEwallet ? (payEwallet   as EwalletProvider) : null,
          proof_object_key: proofObjectKey,
          bank_reference:   payBankRef.trim() || null,
          notes:            null,
        });
        adminToast.success('Perpanjangan + pembayaran berhasil.');
      } catch (_recordErr) {
        // Record failed but renewal (and possibly upload) succeeded
        adminToast.error(
          'Perpanjangan berhasil, tapi pembayaran gagal tersimpan. Catat manual di tab Pembayaran.'
        );
        onSuccess(renewResult);
        onClose();
        return;
      }
    } else {
      adminToast.success('Masa aktif diperpanjang.');
    }

    onSuccess(renewResult);
    onClose();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    // Only close when clicking the backdrop itself, not bubbled from the card.
    if (e.target === e.currentTarget && !submitting) {
      onClose();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="renew-modal-title"
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-caleo-navy/40 backdrop-blur-sm overflow-y-auto py-8"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-sm shadow-xl p-6 max-w-md w-full font-caleo mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2
          id="renew-modal-title"
          className="text-caleo-navy font-bold text-lg mb-1"
        >
          Perpanjang Masa Aktif
        </h2>

        {/* Subheader — tenant name + current expires_at */}
        <p className="text-[13px] mb-4" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#5A6472' }}>
          <span className="font-semibold">{tenant.name}</span>
          {tenant.expires_at && (
            <span className="ml-2 text-[12px]">
              · aktif s/d {tenant.expires_at}
            </span>
          )}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Masa aktif baru */}
          <div className="mb-4">
            <label
              htmlFor="renew-expires-at"
              className="block text-[12px] font-semibold text-caleo-navy mb-1"
            >
              Masa aktif baru
            </label>
            <input
              id="renew-expires-at"
              ref={dateInputRef}
              type="date"
              required
              value={newExpiresAt}
              onChange={(e) => setNewExpiresAt(e.target.value)}
              disabled={submitting}
              className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
              aria-label="Masa aktif baru"
            />
            {newExpiresAt && !isDateValid && (
              <p className="text-[11px] mt-1 text-caleo-danger">
                Tanggal harus lebih dari hari ini.
              </p>
            )}
          </div>

          {/* Ganti paket */}
          <div className="mb-4">
            <label
              htmlFor="renew-plan-code"
              className="block text-[12px] font-semibold text-caleo-navy mb-1"
            >
              Ganti paket <span className="font-normal text-[11px]">(opsional)</span>
            </label>
            <select
              id="renew-plan-code"
              value={newPlanCode}
              onChange={(e) =>
                setNewPlanCode(e.target.value as '' | 'STARTER' | 'PRO' | 'PREMIUM')
              }
              disabled={submitting}
              className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy bg-white focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
              aria-label="Ganti paket"
            >
              <option value="">— Tidak diganti —</option>
              <option value="STARTER">STARTER</option>
              <option value="PRO">PRO</option>
              <option value="PREMIUM">PREMIUM</option>
            </select>
          </div>

          {/* Catatan internal */}
          <div className="mb-4">
            <label
              htmlFor="renew-notes"
              className="block text-[12px] font-semibold text-caleo-navy mb-1"
            >
              Catatan internal <span className="font-normal text-[11px]">(opsional)</span>
            </label>
            <textarea
              id="renew-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              maxLength={500}
              rows={3}
              placeholder="Contoh: renewal 1 tahun, bayar transfer BCA 5 Jul 2026"
              className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy placeholder:text-caleo-navy/30 resize-none focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
              aria-label="Catatan internal"
            />
            <p className="text-[11px] text-right mt-0.5" style={{ color: '#9DB2CE' }}>
              {notes.length}/500
            </p>
          </div>

          {/* ── Payment chain section ──────────────────────────────────────────── */}
          <div
            className="mb-6 border rounded-sm"
            style={{ borderColor: '#ECEEF1' }}
          >
            {/* Checkbox toggle */}
            <label
              className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
              htmlFor="renew-pay-enabled"
            >
              <input
                id="renew-pay-enabled"
                type="checkbox"
                checked={paymentEnabled}
                onChange={(e) => setPaymentEnabled(e.target.checked)}
                disabled={submitting}
                className="w-4 h-4 accent-caleo-gold disabled:opacity-50"
                aria-label="Sekaligus catat pembayaran"
                data-testid="renew-pay-toggle"
              />
              <span className="text-[13px] font-semibold text-caleo-navy">
                Sekaligus catat pembayaran
              </span>
            </label>

            {/* Expandable payment fields */}
            {paymentEnabled && (
              <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: '#ECEEF1' }}>
                {/* Nominal */}
                <div className="mt-4">
                  <label
                    htmlFor="renew-pay-amount"
                    className="block text-[12px] font-semibold text-caleo-navy mb-1"
                  >
                    Nominal diterima <span className="font-normal text-caleo-navy/50">(IDR)</span>
                  </label>
                  <input
                    id="renew-pay-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    disabled={submitting}
                    placeholder="Contoh: 3600000"
                    className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
                    aria-label="Nominal pembayaran"
                    data-testid="renew-pay-amount"
                  />
                  {payAmount && !payAmountValid && (
                    <p className="text-[11px] mt-1 text-caleo-danger">Nominal harus lebih dari 0.</p>
                  )}
                </div>

                {/* Metode */}
                <div>
                  <label
                    htmlFor="renew-pay-method"
                    className="block text-[12px] font-semibold text-caleo-navy mb-1"
                  >
                    Metode pembayaran
                  </label>
                  <select
                    id="renew-pay-method"
                    value={payMethod}
                    onChange={(e) => {
                      setPayMethod(e.target.value as PaymentMethod);
                      setPayBankName('');
                      setPayEwallet('');
                    }}
                    disabled={submitting}
                    className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy bg-white focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
                    aria-label="Metode pembayaran (rantai)"
                    data-testid="renew-pay-method"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Bank — conditional */}
                {showBank && (
                  <div>
                    <label
                      htmlFor="renew-pay-bank"
                      className="block text-[12px] font-semibold text-caleo-navy mb-1"
                    >
                      Bank
                    </label>
                    <select
                      id="renew-pay-bank"
                      value={payBankName}
                      onChange={(e) => setPayBankName(e.target.value as BankName)}
                      disabled={submitting}
                      className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy bg-white focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
                      aria-label="Bank (rantai)"
                    >
                      <option value="">— Pilih bank —</option>
                      {BANK_NAMES.map((b) => (
                        <option key={b.value} value={b.value}>{b.label}</option>
                      ))}
                    </select>
                    {!payBankValid && (
                      <p className="text-[11px] mt-1 text-caleo-danger">Pilih bank untuk metode ini.</p>
                    )}
                  </div>
                )}

                {/* E-wallet — conditional */}
                {showEwallet && (
                  <div>
                    <label
                      htmlFor="renew-pay-ewallet"
                      className="block text-[12px] font-semibold text-caleo-navy mb-1"
                    >
                      Penyedia e-wallet
                    </label>
                    <select
                      id="renew-pay-ewallet"
                      value={payEwallet}
                      onChange={(e) => setPayEwallet(e.target.value as EwalletProvider)}
                      disabled={submitting}
                      className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy bg-white focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
                      aria-label="Penyedia e-wallet (rantai)"
                    >
                      <option value="">— Pilih e-wallet —</option>
                      {EWALLET_PROVIDERS.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Upload bukti */}
                <div>
                  <label
                    htmlFor="renew-pay-proof"
                    className="block text-[12px] font-semibold text-caleo-navy mb-1"
                  >
                    Bukti transfer
                    {requireUpload
                      ? <span className="text-caleo-danger ml-1">*</span>
                      : <span className="font-normal text-caleo-navy/50 ml-1">(opsional)</span>
                    }
                  </label>
                  <input
                    id="renew-pay-proof"
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleFileChange}
                    disabled={submitting}
                    className="w-full text-[13px] text-caleo-navy border border-caleo-navy/30 rounded-sm px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-[11px] file:font-semibold file:bg-caleo-gold file:text-caleo-navy hover:file:opacity-90 disabled:opacity-50"
                    aria-label="Upload bukti pembayaran"
                    data-testid="renew-pay-proof"
                  />
                  {payFileError && (
                    <p className="text-[11px] mt-1 text-caleo-danger">{payFileError}</p>
                  )}
                  {payProofFile && !payFileError && (
                    <p className="text-[11px] mt-1" style={{ color: '#1F8A5B' }}>
                      ✓ {payProofFile.name} ({(payProofFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                </div>

                {/* Referensi bank */}
                <div>
                  <label
                    htmlFor="renew-pay-ref"
                    className="block text-[12px] font-semibold text-caleo-navy mb-1"
                  >
                    Referensi bank <span className="font-normal text-caleo-navy/50">(opsional)</span>
                  </label>
                  <input
                    id="renew-pay-ref"
                    type="text"
                    value={payBankRef}
                    onChange={(e) => setPayBankRef(e.target.value)}
                    disabled={submitting}
                    maxLength={100}
                    placeholder="Contoh: TRF-0001-XYZ"
                    className="w-full border border-caleo-navy/30 rounded-sm px-3 py-2 text-[13px] text-caleo-navy placeholder:text-caleo-navy/30 focus:outline-none focus:ring-2 focus:ring-caleo-gold disabled:opacity-50"
                    aria-label="Referensi bank pembayaran"
                    data-testid="renew-pay-ref"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-caleo-navy border border-caleo-navy/30 hover:bg-caleo-cream rounded-full px-4 py-2.5 text-[13px] font-medium disabled:opacity-40 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !formValid}
              className="bg-caleo-gold text-caleo-navy font-extrabold rounded-full px-4 py-2.5 text-[13px] disabled:opacity-40 hover:opacity-90 transition-opacity"
              data-testid="renew-submit"
            >
              {submitting ? 'Menyimpan…' : 'Simpan Perpanjangan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
