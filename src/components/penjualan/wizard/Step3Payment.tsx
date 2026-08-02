import { useState } from 'react';
import type {
  DbCustomer,
  DiscountType,
  KasirItem,
  KasirPaymentMethod,
  KasirPaymentSubtype,
  KasirPaymentType,
  KasirDpInputType,
  RakitServiceType,
} from '../../../types';
import { formatRp } from '../../../lib/format';
import { dispatchSave, validateStep3, type WizardState } from '../../../lib/wizard/validation';
import CashAccountPicker from '../../akuntansi/CashAccountPicker';
import { DiscountRow, computeDiscountAmount } from '../../ui/discount';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

type CartItem = KasirItem & { _key: number };
type RakitLine = {
  id: string;
  type: RakitServiceType;
  description: string;
  estimatedPrice: number;
  hppEstimate: number;
};

interface Props {
  customer: DbCustomer;
  items: CartItem[];
  rakitLines: RakitLine[];

  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;

  /**
   * Phase 0b: required when method != 'cash'. Cash flows auto-route to
   * default Kas account via accounting_config; transfer/qris/edc need
   * explicit picker selection.
   */
  cashAccountId: string | null;
  onCashAccountIdChange: (id: string | null) => void;

  paymentType: KasirPaymentType;
  onPaymentTypeChange: (t: KasirPaymentType) => void;
  dpAmount: number;
  dpInputType: KasirDpInputType;
  onDpAmountChange: (n: number) => void;
  onDpInputTypeChange: (t: KasirDpInputType) => void;

  ongkirOn: boolean;
  ongkirAmount: number;
  onOngkirToggle: (on: boolean) => void;
  onOngkirAmountChange: (n: number) => void;

  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;

  subtotal: number;          // products + jasa (after line discounts)
  totalInvoice: number;      // subtotal - orderDiscount + ongkir
  effectiveDp: number;
  sisaPelunasan: number;

  outstanding: number;

  /** Task 14: order-level discount state, managed by parent wizard */
  orderDiscountValue: number | null;
  orderDiscountType: DiscountType;
  onOrderDiscountChange: (value: number | null, type: DiscountType) => void;
  /** Task 14: when false, DiscountRow is hidden */
  modulDiskonOn?: boolean;

  onSave: (path: 'tempo' | 'wip' | 'standard') => Promise<void>;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;

  mode?: 'invoice' | 'quote';   // default 'invoice'
}

const METHODS: { code: KasirPaymentMethod; icon: string; label: string }[] = [
  { code: 'cash',     icon: '💵', label: 'Cash' },
  { code: 'transfer', icon: '🏦', label: 'Transfer' },
  { code: 'qris',     icon: '📱', label: 'QRIS' },
  { code: 'edc',      icon: '💳', label: 'EDC' },
];

function formatJatuhTempo(termDays: number): string {
  const due = new Date();
  due.setDate(due.getDate() + termDays);
  return due.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Step3Payment(props: Props) {
  const [submitting, setSubmitting] = useState(false);

  const wizardState: WizardState = {
    customer: { id: props.customer.id, allows_tempo: props.customer.allows_tempo ?? false },
    items: props.items
      .filter((it): it is CartItem & { sku: string } => typeof it.sku === 'string' && it.sku.length > 0)
      .map((it) => ({ sku: it.sku, qty: it.qty, warehouse_id: it.warehouse_id ?? undefined })),
    rakitLines: props.rakitLines.map((rl) => ({
      type: rl.type,
      description: rl.description,
      estimated_price: rl.estimatedPrice,
    })),
    payment_type: props.paymentType,
  };
  const validation = validateStep3(wizardState);

  /** Maps known RPC error codes to Bahasa user messages. Add new cases here. */
  function friendlyRpcError(err: unknown): string {
    const raw = extractErrorMessage(err);
    if (raw.includes('PRICE_MISMATCH')) {
      return 'Harga sistem berubah. Silakan refresh halaman + coba lagi.';
    }
    return raw;
  }

  const onSimpan = async () => {
    if (!validation.ok) {
      props.showToast(validation.errors?.[0] ?? 'Tidak valid', 'warning');
      return;
    }
    setSubmitting(true);
    // 2026-07-27 SO→SI debug: defensive timeout. If props.onSave() promise
    // never resolves (e.g. hung network, subscription that never fires,
    // Sentry beforeSend blocking the promise chain), submitting stays true
    // and button becomes unclickable. This 30s watchdog forces reset with
    // a clear error message so the user isn't stuck.
    const watchdog = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('[Simpan Invoice] onSave watchdog fired — 30s no resolve');
      setSubmitting(false);
      props.showToast('Simpan invoice hang >30 detik. Cek koneksi / refresh halaman.', 'warning');
    }, 30_000);
    try {
      const path = dispatchSave(wizardState);
      await props.onSave(path);
    } catch (e) {
      props.showToast(`Gagal simpan: ${friendlyRpcError(e)}`, 'warning');
    } finally {
      clearTimeout(watchdog);
      setSubmitting(false);
    }
  };

  const isTempo = props.paymentType === 'TEMPO';
  const isDp    = props.paymentType === 'DP';
  const allowsTempo = !!props.customer.allows_tempo;
  const termDays    = props.customer.term_days ?? 14;
  const limit       = props.customer.credit_limit ?? 0;
  const used        = props.outstanding ?? 0;
  const available   = Math.max(0, limit - used);
  const overLimit   = isTempo && limit > 0 && (used + props.totalInvoice) > limit;
  const jatuhTempoStr = formatJatuhTempo(termDays);
  const outstandingAfter = used + (isTempo ? props.totalInvoice : 0);

  const mode = props.mode ?? 'invoice';

  function renderQuoteMode() {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-blue-50 border border-blue-200 rounded p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">ℹ️</div>
              <div>
                <div className="text-sm font-extrabold text-blue-900 mb-1">Mode Penawaran (Sales Order)</div>
                <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                  <li>Tidak perlu pilih payment method — penawaran belum commit ke pembayaran.</li>
                  <li><strong>Ongkir + alamat pengiriman diisi nanti</strong> waktu convert ke Sales Invoice.</li>
                  <li>Stok tidak akan bergerak saat disimpan.</li>
                  <li>Customer accept → klik <strong>"→ Jadi Sales Invoice"</strong> di Daftar Penawaran.</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Catatan / Syarat Penawaran (optional)
            </label>
            <textarea rows={4}
              value={props.notes}
              onChange={(e) => props.onNotesChange(e.target.value)}
              placeholder="Mis: Penawaran berlaku selama harga komponen tidak naik. Garansi pabrik 1 tahun. Ongkir dihitung saat di-convert jadi invoice."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 focus:border-[var(--color-caleo-primary)]"
            />
            <p className="text-[11px] text-slate-500 mt-1.5 italic">Note ini tampil di PDF Penawaran dan di Daftar Penawaran.</p>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="bg-amber-50 border-2 border-amber-300 rounded p-4 space-y-1.5">
            <div className="flex justify-between text-xs text-amber-800">
              <span>Subtotal produk</span>
              <span>{formatRp(props.subtotal)}</span>
            </div>
            <div className="border-t border-amber-200 my-1.5"></div>
            <div className="flex justify-between text-sm font-bold text-amber-900">
              <span>TOTAL PENAWARAN</span>
              <span className="text-xl">{formatRp(props.subtotal)}</span>
            </div>
            <div className="text-[10px] text-amber-700 italic mt-2">
              ⚠️ Total ini belum termasuk ongkir. Ongkir dihitung saat di-convert ke Sales Invoice.
            </div>
          </div>

          <button type="button" onClick={onSimpan} disabled={submitting || !validation.ok}
            className="w-full px-6 py-3 text-sm font-bold rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Menyimpan…' : '✓ Simpan Sales Order'}
          </button>
          {!validation.ok && validation.errors?.[0] && (
            <p className="text-[11px] text-rose-600 text-center">{validation.errors[0]}</p>
          )}
        </div>
      </div>
    );
  }

  function renderInvoiceMode() {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* LEFT: payment type + TEMPO context + method */}
        <div className="lg:col-span-7 space-y-5">

          {/* Payment type cards */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Tipe Pembayaran <span className="text-red-500">*</span>
            </label>
            <div className={`grid ${allowsTempo ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
              <button
                type="button"
                onClick={() => props.onPaymentTypeChange('FULL')}
                className={`px-4 py-3 rounded border-2 text-left transition ${
                  props.paymentType === 'FULL'
                    ? 'bg-[var(--color-caleo-primary)]/5 border-[var(--color-caleo-primary)] text-[var(--color-caleo-primary)]'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-sm">LUNAS</div>
                <div className={`text-[11px] ${props.paymentType === 'FULL' ? 'text-[var(--color-caleo-primary)]/80' : 'text-slate-500'}`}>Bayar penuh sekarang</div>
              </button>
              <button
                type="button"
                onClick={() => props.onPaymentTypeChange('DP')}
                className={`px-4 py-3 rounded border-2 text-left transition ${
                  props.paymentType === 'DP'
                    ? 'bg-amber-50 border-amber-500 text-amber-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-sm">DP</div>
                <div className={`text-[11px] ${props.paymentType === 'DP' ? 'text-amber-700' : 'text-slate-500'}`}>Bayar muka sebagian</div>
              </button>
              {allowsTempo && (
                <button
                  type="button"
                  onClick={() => props.onPaymentTypeChange('TEMPO')}
                  className={`px-4 py-3 rounded border-2 text-left transition ${
                    isTempo
                      ? 'bg-amber-50 border-amber-500 text-amber-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="font-bold text-sm">TEMPO</div>
                  <div className={`text-[11px] ${isTempo ? 'text-amber-700' : 'text-slate-500'}`}>Bayar nanti (kredit)</div>
                </button>
              )}
            </div>
          </div>

          {/* TEMPO context box (only when TEMPO active) */}
          {isTempo && (
            <div className={`rounded p-4 border ${overLimit ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-200'}`}>
              <div className={`text-xs font-bold mb-2 uppercase tracking-wider ${overLimit ? 'text-rose-900' : 'text-amber-900'}`}>
                Status Kredit Customer
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className={`${overLimit ? 'text-rose-700' : 'text-amber-700'} text-[10px] uppercase tracking-wider`}>Limit</div>
                  <div className={`font-bold text-base ${overLimit ? 'text-rose-900' : 'text-amber-900'}`}>{formatRp(limit)}</div>
                </div>
                <div>
                  <div className={`${overLimit ? 'text-rose-700' : 'text-amber-700'} text-[10px] uppercase tracking-wider`}>Outstanding</div>
                  <div className={`font-bold text-base ${overLimit ? 'text-rose-900' : 'text-amber-900'}`}>{formatRp(used)}</div>
                </div>
                <div>
                  <div className={`${overLimit ? 'text-rose-700' : 'text-amber-700'} text-[10px] uppercase tracking-wider`}>Sisa Tersedia</div>
                  <div className={`font-bold text-base ${overLimit ? 'text-rose-900' : 'text-emerald-700'}`}>{formatRp(available)}</div>
                </div>
              </div>
              <div className={`text-[11px] mt-3 ${overLimit ? 'text-rose-800' : 'text-amber-800'}`}>
                💳 Term: <strong>{termDays} hari</strong> · Jatuh tempo: <strong>{jatuhTempoStr}</strong>
              </div>
              {overLimit ? (
                <div className="text-[11px] text-rose-700 mt-1 font-semibold">
                  ⚠️ Over limit. Pesanan {formatRp(props.totalInvoice)} melebihi sisa kredit {formatRp(available)}.
                </div>
              ) : (
                <div className="text-[11px] text-emerald-700 mt-1 font-semibold">
                  ✓ Pesanan {formatRp(props.totalInvoice)} cukup di sisa kredit.
                </div>
              )}
            </div>
          )}

          {/* DP amount input (only when DP) */}
          {isDp && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wider text-amber-900">DP / Tanda Jadi</div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => props.onDpInputTypeChange('AMOUNT')}
                  className={`px-3 py-1.5 text-xs font-bold rounded ${
                    props.dpInputType === 'AMOUNT' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 border border-amber-300'
                  }`}
                >
                  Rp Nominal
                </button>
                <button
                  type="button"
                  onClick={() => props.onDpInputTypeChange('PERCENT')}
                  className={`px-3 py-1.5 text-xs font-bold rounded ${
                    props.dpInputType === 'PERCENT' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 border border-amber-300'
                  }`}
                >
                  % Persen
                </button>
              </div>
              <input
                type="number"
                value={props.dpAmount || ''}
                onChange={(e) => props.onDpAmountChange(Number(e.target.value || 0))}
                placeholder={props.dpInputType === 'PERCENT' ? 'Mis: 30' : 'Mis: 1.000.000'}
                className="w-full px-3 py-2 text-sm border border-amber-300 rounded outline-none focus:ring-2 focus:ring-amber-200"
              />
              <div className="text-[11px] text-amber-800 mt-2">
                Bayar sekarang: <strong>{formatRp(props.effectiveDp)}</strong> · Sisa pelunasan: <strong>{formatRp(props.sisaPelunasan)}</strong>
              </div>
            </div>
          )}

          {/* Payment method (faded for TEMPO) */}
          <div className={isTempo ? 'opacity-50' : ''}>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Metode Bayar{isTempo ? ' (untuk pelunasan nanti)' : ''}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => !isTempo && props.onMethodChange(m.code)}
                  disabled={isTempo}
                  className={`px-3 py-2 text-xs font-semibold rounded border ${
                    props.method === m.code
                      ? 'bg-[var(--color-caleo-primary)]/5 border-[var(--color-caleo-primary)] text-[var(--color-caleo-primary)]'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
            {isTempo && (
              <p className="text-[11px] text-slate-500 mt-1.5 italic">Optional — bisa di-set saat pelunasan via Catat Bayar.</p>
            )}
          </div>

          {/* Cash account picker — Phase 0b dual-write target. Hidden for cash (auto-routes to Kas Toko via accounting_config default). */}
          {!isTempo && props.method !== 'cash' && (
            <CashAccountPicker
              value={props.cashAccountId}
              onChange={props.onCashAccountIdChange}
              paymentMethod={props.method}
              purposeFilter="business-only"
              required
              label="Masuk ke akun *"
            />
          )}
        </div>

        {/* RIGHT: ongkir + notes + summary */}
        <div className="lg:col-span-5 space-y-4">

          {/* Ongkir */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">Ongkir</label>
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <input type="checkbox" checked={props.ongkirOn} onChange={(e) => props.onOngkirToggle(e.target.checked)} /> Pakai ongkir
              </label>
            </div>
            <input
              type="number"
              value={props.ongkirAmount || ''}
              onChange={(e) => props.onOngkirAmountChange(Number(e.target.value || 0))}
              disabled={!props.ongkirOn}
              placeholder="0"
              className="w-full text-right px-3 py-2 text-sm border border-slate-300 rounded outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 focus:border-[var(--color-caleo-primary)] disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          {/* Delivery address */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Alamat Pengiriman</label>
            <textarea
              rows={2}
              value={props.deliveryAddress}
              onChange={(e) => props.onDeliveryAddressChange(e.target.value)}
              placeholder="Mis: Jl. Merdeka No. 12, Jakarta Utara"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 focus:border-[var(--color-caleo-primary)]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Catatan</label>
            <textarea
              rows={2}
              value={props.notes}
              onChange={(e) => props.onNotesChange(e.target.value)}
              placeholder="Mis: kirim Selasa, jangan hari libur"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 focus:border-[var(--color-caleo-primary)]"
            />
          </div>

          {/* Order-level discount row — shown above navy summary, gated by modulDiskonOn */}
          {props.modulDiskonOn && (
            <DiscountRow
              label="Diskon Order"
              value={props.orderDiscountValue}
              type={props.orderDiscountType}
              base={props.subtotal}
              onChange={props.onOrderDiscountChange}
            />
          )}

          {/* Final summary card — signature dark navy panel from mockup */}
          {/* Show gross subtotal so Diskon Item / Diskon Order subtractions are transparent. */}
          {(() => {
            const lineDiscount = (props.items ?? []).reduce(
              (sum, i) => sum + (i.discount_amount_rp ?? 0), 0,
            );
            const grossSubtotal = props.subtotal + lineDiscount;
            const orderDiscount = computeDiscountAmount(
              props.orderDiscountValue, props.orderDiscountType, props.subtotal,
            );
            const orderLabel = props.orderDiscountType === 'PERCENT' && props.orderDiscountValue
              ? `− Diskon Order (${props.orderDiscountValue}%)`
              : '− Diskon Order';
            return (
              <div className="bg-[var(--color-caleo-primary)] text-white rounded p-4 space-y-1.5">
                <div className="flex justify-between text-xs opacity-80">
                  <span>Subtotal pesanan</span>
                  <span>{formatRp(grossSubtotal)}</span>
                </div>
                {lineDiscount > 0 && (
                  <div className="flex justify-between text-xs text-orange-200">
                    <span>− Diskon Item</span>
                    <span>− {formatRp(lineDiscount)}</span>
                  </div>
                )}
                {orderDiscount > 0 && (
                  <div className="flex justify-between text-xs text-orange-200">
                    <span>{orderLabel}</span>
                    <span>− {formatRp(orderDiscount)}</span>
                  </div>
                )}
                {props.ongkirOn && (
                  <div className="flex justify-between text-xs opacity-80">
                    <span>Ongkir</span>
                    <span>{formatRp(props.ongkirAmount)}</span>
                  </div>
                )}
                <div className="border-t border-white/20 my-1.5"></div>
                <div className="flex justify-between text-sm font-bold">
                  <span>TOTAL {isTempo ? '(TEMPO)' : isDp ? '(DP)' : ''}</span>
                  <span className="text-xl">{formatRp(props.totalInvoice)}</span>
                </div>
                {isDp && (
                  <div className="text-[11px] mt-2 opacity-80">
                    Bayar sekarang: <strong>{formatRp(props.effectiveDp)}</strong> · Sisa pelunasan: <strong>{formatRp(props.sisaPelunasan)}</strong>
                  </div>
                )}
                {isTempo && (
                  <div className="text-[11px] mt-2 opacity-80">
                    Jatuh tempo: <strong>{jatuhTempoStr}</strong> · Outstanding setelah: <strong>{formatRp(outstandingAfter)}</strong>
                  </div>
                )}
              </div>
            );
          })()}
          {/* Save button — full-width green per mockup.
              Also gated on cashAccountId when a non-cash method is picked, so
              the button reflects reality instead of firing a toast on click. */}
          {(() => {
            const needsCashAccount = !isTempo && props.method !== 'cash';
            const cashAccountMissing = needsCashAccount && !props.cashAccountId;
            const edcSubtypeMissing = !isTempo && props.method === 'edc' && !props.subtype;
            const saveDisabled =
              submitting || !validation.ok || overLimit ||
              cashAccountMissing || edcSubtypeMissing;
            // 2026-07-27 SO→SI debug: previously `submitting` case showed no
            // hint text — user saw disabled button with no explanation and
            // reported "tidak bisa klik Simpan Invoice". Now every disable
            // reason surfaces a hint so the operator can self-diagnose.
            const saveHint =
              submitting ? 'Sedang menyimpan… (kalau nge-freeze >15 detik, refresh halaman)'
              : !validation.ok ? validation.errors?.[0]
              : overLimit ? 'Pesanan melewati sisa kredit customer.'
              : edcSubtypeMissing ? 'Pilih sub-tipe EDC (Debit / QRIS).'
              : cashAccountMissing ? 'Pilih akun tujuan pembayaran dulu.'
              : null;
            return (
              <>
                <button
                  type="button"
                  onClick={onSimpan}
                  disabled={saveDisabled}
                  title={saveDisabled ? (saveHint ?? 'Tombol non-aktif') : 'Klik untuk simpan'}
                  className="w-full px-6 py-3 text-sm font-bold rounded bg-[#2d8a4e] text-white hover:bg-[#236b3d] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Menyimpan…' : '✓ Simpan Sales Invoice'}
                </button>
                {saveHint && (
                  <p className="text-[11px] text-rose-600 text-center">{saveHint}</p>
                )}
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  if (mode === 'quote') {
    return renderQuoteMode();
  }
  return renderInvoiceMode();
}
