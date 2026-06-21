import { useState } from 'react';
import type {
  DbCustomer,
  KasirItem,
  KasirPaymentMethod,
  KasirPaymentSubtype,
  KasirPaymentType,
  KasirDpInputType,
  RakitServiceType,
} from '../../../types';
import PaymentPanel from '../PaymentPanel';
import { dispatchSave, validateStep3, type WizardState } from '../../../lib/wizard/validation';

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

  // payment method
  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;

  // payment type / DP
  paymentType: KasirPaymentType;
  onPaymentTypeChange: (t: KasirPaymentType) => void;
  dpAmount: number;
  dpInputType: KasirDpInputType;
  onDpAmountChange: (n: number) => void;
  onDpInputTypeChange: (t: KasirDpInputType) => void;

  // ongkir
  ongkirOn: boolean;
  ongkirAmount: number;
  onOngkirToggle: (on: boolean) => void;
  onOngkirAmountChange: (n: number) => void;

  // delivery address
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;

  // notes
  notes: string;
  onNotesChange: (v: string) => void;

  // computed totals
  subtotal: number;
  totalInvoice: number;
  effectiveDp: number;
  sisaPelunasan: number;

  // tempo
  outstanding: number;

  // actions
  onSave: (path: 'tempo' | 'wip' | 'standard') => Promise<void>;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
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

  const onSimpan = async () => {
    if (!validation.ok) {
      props.showToast(validation.errors?.[0] ?? 'Tidak valid', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const path = dispatchSave(wizardState);
      await props.onSave(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      props.showToast(`Gagal simpan: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PaymentPanel
        method={props.method}
        subtype={props.subtype}
        onMethodChange={props.onMethodChange}
        onSubtypeChange={props.onSubtypeChange}
        paymentType={props.paymentType}
        onPaymentTypeChange={props.onPaymentTypeChange}
        dpAmount={props.dpAmount}
        dpInputType={props.dpInputType}
        onDpAmountChange={props.onDpAmountChange}
        onDpInputTypeChange={props.onDpInputTypeChange}
        ongkirOn={props.ongkirOn}
        ongkirAmount={props.ongkirAmount}
        onOngkirToggle={props.onOngkirToggle}
        onOngkirAmountChange={props.onOngkirAmountChange}
        deliveryAddress={props.deliveryAddress}
        onDeliveryAddressChange={props.onDeliveryAddressChange}
        notes={props.notes}
        onNotesChange={props.onNotesChange}
        subtotal={props.subtotal}
        totalInvoice={props.totalInvoice}
        effectiveDp={props.effectiveDp}
        sisaPelunasan={props.sisaPelunasan}
        allowsTempo={!!props.customer.allows_tempo}
        termDays={props.customer.term_days ?? null}
        creditLimit={props.customer.credit_limit ?? null}
        outstanding={props.outstanding}
        customerSelected={true}
        saving={submitting}
        onSave={onSimpan}
        onCancel={props.onCancel}
      />
    </div>
  );
}
