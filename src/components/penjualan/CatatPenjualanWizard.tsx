// CatatPenjualanWizard.tsx
//
// 3-step wizard replacing the legacy 624-line PenjualanBaruScreen monolith.
// Owns ALL shared state (channel, customer, cart, rakit lines, payment fields),
// the WizardStepper UI, Lanjut/Kembali nav + jump-back to completed steps, the
// beforeunload warning, master-data fetch (stocks + customers), the prefillSku
// auto-add, and save dispatch (tempo / wip / standard via dispatchSave).
//
// Prop interface MIRRORS PenjualanBaruScreen verbatim so App.tsx can swap
// imports in T18+ without touching call-sites.
//
// Save dispatch routing (preserving legacy navigation per T16 brief):
//   * TEMPO   → createTempoInvoice → navigate('piutang')   [returns orders.id]
//   * WIP     → kasirService.insertWipWithRakit → navigate('invoicePreview')
//   * standard → kasirService.recordSale → navigate('invoicePreview')
// Rationale: TEMPO returns an orders.id (not kasir_transactions.id) so the
// invoicePreview screen — which reads kasir_transactions — would miss it.
// T17 InvoicePreviewScreen therefore only handles non-TEMPO transactions.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type {
  ActivePage,
  DbCustomer,
  DbCustomerWithStats,
  KasirChannel,
  KasirDpInputType,
  KasirItem,
  KasirPaymentMethod,
  KasirPaymentSubtype,
  KasirPaymentType,
  PermissionSet,
  RakitServiceType,
} from '../../types';
import {
  customersService,
  kasirService,
  stockService,
  supabase,
} from '../../lib/supabaseClient';
import type { SupabaseStockItem } from '../../lib/supabaseClient';
import { wibDateString } from '../../lib/format';
import { CHANNEL_REQUIRES_ORDER_NO } from '../../lib/salesChannels';
import { useWarehouses } from '../../hooks/useWarehouses';
import { createTempoInvoice } from '../../lib/piutangService';
import WizardStepper from './wizard/WizardStepper';
import Step1ChannelCustomer from './wizard/Step1ChannelCustomer';
import Step2Items from './wizard/Step2Items';
import Step3Payment from './wizard/Step3Payment';
import { validateStep1, validateStep2 } from '../../lib/wizard/validation';

// Module-scoped sequence for stable cart row keys, mirroring the legacy
// _itemSeq pattern in PenjualanBaruScreen. Per-row _key lets CartRows track
// identity across qty/warehouse edits + removals.
let _itemSeq = 0;

type CartItem = KasirItem & { _key: number };
type RakitLine = {
  id: string;
  type: RakitServiceType;
  description: string;
  estimatedPrice: number;
  hppEstimate: number;
};

export interface CatatPenjualanWizardProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onSaved: (txId: string) => void;
  initialChannel?: KasirChannel;
  initialPrefillSku?: string;
  onNavigate?: (page: ActivePage) => void;
}

export default function CatatPenjualanWizard(props: CatatPenjualanWizardProps) {
  const { currentUser, showToast, onBack, onSaved, initialChannel, initialPrefillSku, onNavigate } = props;

  // Stepper state
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<1 | 2 | 3>>(new Set());

  // ── Step 1: channel + customer + channel-specific fields ──────────────────
  const [channel, setChannel] = useState<KasirChannel>(initialChannel ?? 'walkin');
  const [customer, setCustomer] = useState<DbCustomerWithStats | undefined>(undefined);
  const [marketplaceOrderNo, setMarketplaceOrderNo] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waChatUrl, setWaChatUrl] = useState('');

  // ── Step 2: cart + rakit ──────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [rakitLines, setRakitLines] = useState<RakitLine[]>([]);
  const [rakitFormOpen, setRakitFormOpen] = useState(false);
  const [rakitFormType, setRakitFormType] = useState<RakitServiceType | null>(null);

  // ── Step 3: payment fields ────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  const [paymentSubtype, setPaymentSubtype] = useState<KasirPaymentSubtype>(null);
  const [paymentType, setPaymentType] = useState<KasirPaymentType>('FULL');
  const [dpAmount, setDpAmount] = useState(0);
  const [dpInputType, setDpInputType] = useState<KasirDpInputType>('AMOUNT');
  const [ongkirOn, setOngkirOn] = useState(false);
  const [ongkirAmount, setOngkirAmount] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  // ── Master data ───────────────────────────────────────────────────────────
  const [stocks, setStocks] = useState<SupabaseStockItem[]>([]);
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [tempoOutstanding, setTempoOutstanding] = useState<number>(0);

  const { warehouses } = useWarehouses();

  // Load stocks + customers once on mount
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch((err) => showToast(`Gagal memuat data: ${err?.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived totals ────────────────────────────────────────────────────────
  const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0) + rakitTotal;
  const totalInvoice = subtotal + (ongkirOn ? ongkirAmount : 0);
  const effectiveDp = paymentType === 'DP'
    ? (dpInputType === 'PERCENT' ? Math.round(totalInvoice * dpAmount / 100) : dpAmount)
    : 0;
  const sisaPelunasan = paymentType === 'DP' ? Math.max(0, totalInvoice - effectiveDp) : 0;
  const hasRakit = rakitLines.length > 0;
  const isMixedCart = hasRakit && cart.length > 0;

  // Reset payment type back to FULL if user picks a non-TEMPO-eligible customer
  // while still on TEMPO. Mirrors PenjualanBaruScreen:156-160.
  useEffect(() => {
    if (paymentType === 'TEMPO' && !customer?.allows_tempo) {
      setPaymentType('FULL');
    }
  }, [paymentType, customer?.allows_tempo]);

  // Tempo outstanding lookup for the selected customer (sum of open
  // INVOICE_TEMPO orders). Mirrors PenjualanBaruScreen:162-181.
  useEffect(() => {
    if (!customer?.allows_tempo || !supabase) {
      setTempoOutstanding(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('orders')
        .select('total')
        .eq('customer_id', customer.id)
        .eq('payment_type', 'TEMPO')
        .eq('status', 'INVOICE_TEMPO');
      if (cancelled) return;
      const sum = (data ?? []).reduce(
        (a: number, o: { total: number }) => a + Number(o.total ?? 0),
        0,
      );
      setTempoOutstanding(sum);
    })();
    return () => { cancelled = true; };
  }, [customer?.id, customer?.allows_tempo]);

  // beforeunload warning when wizard has unsaved input.
  useEffect(() => {
    const isDirty = !!customer || cart.length > 0 || rakitLines.length > 0;
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Penjualan belum disimpan. Yakin keluar?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [customer, cart.length, rakitLines.length]);

  // ── Cart handlers (mirrors PenjualanBaruScreen) ───────────────────────────
  function addItem(stock: SupabaseStockItem) {
    // Pick the warehouse with the most stock for this SKU. Falls back to
    // is_default (then sort_order) only if no warehouse has positive stock —
    // the true pre-order case. Mirrors the per-warehouse balance derivation
    // in CartRows.tsx that maps warehouse.code → stock.stock_atas/stock_bawah.
    const balances = warehouses.map((w) => {
      const code = w.code.toLowerCase();
      const qty = code === 'atas' ? (stock.stock_atas ?? 0)
        : code === 'bawah' ? (stock.stock_bawah ?? 0)
        : 0;
      return { w, qty };
    });
    const maxBalance = balances.reduce(
      (best, cur) => (cur.qty > best.qty ? cur : best),
      balances[0] ?? { w: warehouses[0], qty: 0 },
    );
    const defaultWh = maxBalance && maxBalance.qty > 0
      ? maxBalance.w
      : (warehouses.find((w) => w.is_default) ?? warehouses[0]);
    setCart((prev) => [
      ...prev,
      {
        _key: ++_itemSeq,
        sku: stock.sku,
        name: stock.name,
        qty: 1,
        unit_price: stock.price,
        hpp_per_unit: stock.harga_modal ?? 0,
        subtotal: stock.price,
        hpp_subtotal: stock.harga_modal ?? 0,
        warehouse: null,
        warehouse_id: defaultWh?.id ?? null,
      },
    ]);
  }

  function updateQty(key: number, qty: number) {
    setCart((prev) => prev.map((i) =>
      i._key === key
        ? { ...i, qty, subtotal: i.unit_price * qty, hpp_subtotal: i.hpp_per_unit * qty }
        : i,
    ));
  }

  function updateWarehouse(key: number, warehouseId: string) {
    setCart((prev) => prev.map((i) => (i._key === key ? { ...i, warehouse_id: warehouseId } : i)));
  }

  function removeItem(key: number) {
    setCart((prev) => prev.filter((i) => i._key !== key));
  }

  // Prefill SKU from "Cari by Foto" — runs once after stocks load.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    if (!initialPrefillSku || loading || stocks.length === 0) return;
    const match = stocks.find((s) => s.sku === initialPrefillSku);
    if (match) {
      addItem(match);
      showToast(`✅ ${match.name} ditambahkan ke kasir.`, 'success');
    } else {
      showToast(`SKU ${initialPrefillSku} tidak ditemukan di master stok.`, 'warning');
    }
    prefillAppliedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrefillSku, loading, stocks]);

  // Rakit handlers
  const openRakitForm = (t: RakitServiceType) => {
    setRakitFormType(t);
    setRakitFormOpen(true);
  };
  const cancelRakitForm = () => {
    setRakitFormOpen(false);
    setRakitFormType(null);
  };
  const addRakitLine = (line: { type: RakitServiceType; description: string; estimatedPrice: number; hppEstimate: number }) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `rakit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRakitLines((prev) => [...prev, { id, ...line }]);
    cancelRakitForm();
  };
  const removeRakitLine = (id: string) => {
    setRakitLines((prev) => prev.filter((l) => l.id !== id));
  };

  // ── Stepper validation + nav ──────────────────────────────────────────────
  const step1State = useMemo(() => ({
    channel,
    customer: customer ? { id: customer.id, allows_tempo: customer.allows_tempo } : undefined,
    marketplace_order_no: marketplaceOrderNo,
    wa_phone: waPhone,
    items: [],
    rakitLines: [],
  } as Parameters<typeof validateStep1>[0]), [channel, customer, marketplaceOrderNo, waPhone]);

  const step2State = useMemo(() => ({
    items: cart
      .filter((it): it is CartItem & { sku: string } => typeof it.sku === 'string' && it.sku.length > 0)
      .map((it) => ({ sku: it.sku, qty: it.qty, warehouse_id: it.warehouse_id ?? undefined })),
    rakitLines: rakitLines.map((rl) => ({
      type: rl.type,
      description: rl.description,
      estimated_price: rl.estimatedPrice,
    })),
  } as Parameters<typeof validateStep2>[0]), [cart, rakitLines]);

  const canAdvanceStep1 = validateStep1(step1State).ok;
  const canAdvanceStep2 = validateStep2(step2State).ok;

  const goToStep = (step: 1 | 2 | 3) => setCurrentStep(step);

  const onLanjut = () => {
    if (currentStep === 1 && canAdvanceStep1) {
      setCompletedSteps((prev) => new Set(prev).add(1));
      goToStep(2);
    } else if (currentStep === 2 && canAdvanceStep2) {
      setCompletedSteps((prev) => new Set(prev).add(2));
      goToStep(3);
    }
  };

  const onKembali = () => {
    if (currentStep === 2) goToStep(1);
    else if (currentStep === 3) goToStep(2);
  };

  const onJumpBack = (step: 1 | 2 | 3) => {
    if (completedSteps.has(step) && step < currentStep) goToStep(step);
  };

  const onCancel = () => {
    const isDirty = !!customer || cart.length > 0 || rakitLines.length > 0;
    if (isDirty && !window.confirm('Batalkan? Semua input akan hilang.')) return;
    onBack();
  };

  // ── Save dispatch ─────────────────────────────────────────────────────────
  // Called by Step3Payment with the dispatched path. The Step3 component
  // already validated payment_type via validateStep3; we re-guard server-facing
  // invariants (TEMPO eligibility, mixed-cart constraint).
  const onSave = async (path: 'tempo' | 'wip' | 'standard'): Promise<void> => {
    if (!customer) {
      showToast('Customer wajib dipilih.', 'warning');
      throw new Error('customer_missing');
    }
    if (paymentType === 'DP' && dpInputType === 'PERCENT' && (dpAmount <= 0 || dpAmount > 100)) {
      showToast('Persen DP harus antara 1 dan 100.', 'warning');
      throw new Error('dp_percent_invalid');
    }
    if (paymentType === 'DP' && (effectiveDp <= 0 || effectiveDp >= totalInvoice)) {
      showToast('Jumlah DP harus > 0 dan < Total Invoice.', 'warning');
      throw new Error('dp_amount_invalid');
    }
    if (paymentType !== 'TEMPO' && paymentMethod === 'edc' && !paymentSubtype) {
      showToast('Pilih sub-tipe EDC (Debit / QRIS).', 'warning');
      throw new Error('edc_subtype_missing');
    }

    if (path === 'tempo') {
      if (!customer.allows_tempo) {
        showToast('Pelanggan ini belum diaktifkan untuk Tempo.', 'warning');
        throw new Error('tempo_not_eligible');
      }
      if (isMixedCart) {
        showToast(
          'Tempo tidak boleh dicampur SKU + jasa. Pisahkan jasa di transaksi terpisah.',
          'warning',
        );
        throw new Error('tempo_mixed_cart');
      }
      // TODO(T18+): plumb allow_negative_stock through CreateTempoInvoicePayload typing.
      // For now cast at call site so the new payload key reaches the RPC body.
      const result = await createTempoInvoice({
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.wa_number || undefined,
        customer_company: customer.company || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        channel,
        sales_channel: channel,
        delivery_type: deliveryAddress.trim() ? 'DELIVERY' : 'PICKUP',
        items: cart.map(({ _key, ...rest }) => rest),
        subtotal,
        shipping_fee: ongkirOn ? ongkirAmount : 0,
        total: totalInvoice,
        allow_negative_stock: true,
      } as any);
      if (result.kind === 'ok') {
        const termDaysLabel = customer.term_days ? ` (Jatuh tempo ${customer.term_days} hari).` : '.';
        showToast(`Faktur tempo dibuat${termDaysLabel}`, 'success');
        onSaved(result.order_id);
        // TEMPO returns orders.id — InvoicePreviewScreen reads
        // kasir_transactions, so route to piutang instead. T17 explicitly
        // scopes invoicePreview to non-TEMPO transactions.
        if (onNavigate) onNavigate('piutang'); else onBack();
        return;
      }
      if (result.kind === 'credit_limit_exceeded') {
        const fmt = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
        showToast(
          `⛔ Plafon kredit terlampaui. Kelebihan ${fmt(result.shortage)}. ` +
          `Outstanding ${fmt(result.outstanding)} + invoice ini ${fmt(result.new_amount)} > limit ${fmt(result.limit)}.`,
          'warning',
        );
        throw new Error('credit_limit_exceeded');
      }
      if (result.kind === 'tempo_not_enabled') {
        showToast('Tempo belum aktif untuk pelanggan ini.', 'warning');
        throw new Error('tempo_not_enabled');
      }
      showToast(`Gagal: ${result.message}`, 'warning');
      throw new Error(result.message);
    }

    const today = wibDateString();

    if (path === 'wip') {
      // NOTE: WIP path does NOT pass allow_negative_stock. insertWipWithRakit
      // is a direct INSERT into kasir_transactions (status='WIP', items=[]),
      // not an RPC — passing the column would trip PostgREST with "column does
      // not exist". Stock decrement happens later at lock-approval time, so
      // the pre-order flag is implicitly satisfied (no stock check runs here).
      const txId = await kasirService.insertWipWithRakit({
        tx: {
          date: today,
          channel,
          subtotal,
          total_amount: totalInvoice,
          dp_amount: effectiveDp,
          ongkir_amount: ongkirOn ? ongkirAmount : 0,
          payment_method: paymentMethod,
          payment_subtype: paymentSubtype,
          payment_type: paymentType === 'TEMPO' ? 'FULL' : paymentType,
          dp_input_type: paymentType === 'DP' ? dpInputType : null,
          notes: notes.trim() || null,
          customer_id: customer.id,
          customer_name: customer.name || null,
          customer_phone: customer.wa_number || null,
          customer_company: customer.company || null,
          delivery_address: deliveryAddress.trim() || null,
          marketplace_order_no: CHANNEL_REQUIRES_ORDER_NO.has(channel) ? marketplaceOrderNo : null,
          wa_phone: channel === 'whatsapp' ? waPhone : null,
          wa_chat_url: channel === 'whatsapp' ? waChatUrl : null,
        },
        rakitLines: rakitLines.map((l) => ({
          serviceType: l.type,
          description: l.description,
          estimatedPrice: l.estimatedPrice,
        })),
      });
      showToast('✅ Transaksi WIP tersimpan. Cek di Pipeline untuk lock + approval.', 'success');
      onSaved(txId);
      if (onNavigate) onNavigate('pipeline'); else onBack();
      return;
    }

    // path === 'standard'
    const skuItems = cart.map(({ _key, ...rest }) => rest);
    const serviceItems = rakitLines.map((l) => ({
      sku: null,
      name: l.description,
      qty: 1,
      unit_price: l.estimatedPrice,
      hpp_per_unit: l.hppEstimate,
      subtotal: l.estimatedPrice,
      hpp_subtotal: l.hppEstimate,
      warehouse: null,
    }));
    // T20 extended RecordKasirSaleInput + the recordSale wrapper to actually
    // forward p_allow_negative_stock to the RPC (previously the key was
    // silently dropped — functionally OK because deduct_stock_fifo permits
    // silent underflow via RAISE WARNING fallback, but the wizard's intent
    // never reached the DB for downstream T25 pre-order audit).
    const tx = await kasirService.recordSale({
      date: today,
      channel,
      items: [...skuItems, ...serviceItems],
      subtotal,
      payment_method: paymentMethod,
      payment_subtype: paymentSubtype,
      payment_type: paymentType === 'TEMPO' ? 'FULL' : paymentType,
      dp_amount: effectiveDp,
      dp_input_type: paymentType === 'DP' ? dpInputType : undefined,
      ongkir_amount: ongkirOn ? ongkirAmount : 0,
      notes: notes.trim() || undefined,
      total_amount: totalInvoice,
      marketplace_order_no: CHANNEL_REQUIRES_ORDER_NO.has(channel) ? marketplaceOrderNo : undefined,
      wa_phone: channel === 'whatsapp' ? waPhone : undefined,
      wa_chat_url: channel === 'whatsapp' ? waChatUrl : undefined,
      customer_name: customer.name,
      customer_phone: customer.wa_number,
      customer_company: customer.company || undefined,
      delivery_address: deliveryAddress.trim() || undefined,
      customer_id: customer.id,
      p_allow_negative_stock: true,
    });
    onSaved(tx.id);
    if (onNavigate) onNavigate('invoicePreview'); else onBack();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="bg-[#012749] text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-white/80 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="font-extrabold text-sm">📋 Catat Penjualan</div>
            <div className="text-[11px] opacity-65">Step {currentStep} dari 3</div>
          </div>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="bg-white/15 px-3 py-1 rounded-full font-bold">
            📅 {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className="bg-white/15 px-3 py-1 rounded-full font-bold">
            👤 {currentUser?.name ?? 'Admin'}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-b-2xl shadow-sm overflow-hidden">
        <WizardStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onJumpBack={onJumpBack}
        />

        {loading ? (
          <p className="text-center text-slate-400 py-12 text-sm">Memuat data...</p>
        ) : (
          <>
            {currentStep === 1 && (
              <Step1ChannelCustomer
                channel={channel}
                setChannel={setChannel}
                customer={customer as DbCustomer | undefined}
                setCustomer={(c) => {
                  setCustomer(c as DbCustomerWithStats | undefined);
                  // Inline form returns a fresh customer that isn't in the
                  // initial fetch yet — upsert so CustomerPanel can render
                  // the selected chip by id lookup. No-op for picks from
                  // the existing list.
                  if (c && !customers.some((x) => x.id === c.id)) {
                    setCustomers((prev) => [...prev, c as DbCustomerWithStats]);
                  }
                }}
                customers={customers}
                marketplaceOrderNo={marketplaceOrderNo}
                setMarketplaceOrderNo={setMarketplaceOrderNo}
                waPhone={waPhone}
                setWaPhone={setWaPhone}
                waChatUrl={waChatUrl}
                setWaChatUrl={setWaChatUrl}
                showToast={showToast}
              />
            )}

            {currentStep === 2 && (
              <Step2Items
                cart={cart}
                stocks={stocks}
                onAddItem={addItem}
                onQtyChange={updateQty}
                onWarehouseChange={updateWarehouse}
                onRemoveItem={removeItem}
                subtotal={subtotal}
                rakitLines={rakitLines}
                rakitFormOpen={rakitFormOpen}
                rakitFormType={rakitFormType}
                onOpenRakitForm={openRakitForm}
                onCancelRakitForm={cancelRakitForm}
                onAddRakitLine={addRakitLine}
                onRemoveRakitLine={removeRakitLine}
                // Per-warehouse stock map for pre-order detection. Mirrors
                // the warehouse.code → stock_atas/stock_bawah mapping used
                // by CartRows + addItem so the PRE-ORDER chip only fires
                // when the picked warehouse actually has insufficient stock.
                stockByWarehouseSku={(() => {
                  const map: Record<string, number> = {};
                  for (const s of stocks) {
                    for (const w of warehouses) {
                      const code = w.code.toLowerCase();
                      const qty = code === 'atas' ? (s.stock_atas ?? 0)
                        : code === 'bawah' ? (s.stock_bawah ?? 0)
                        : 0;
                      map[`${s.sku}|${w.id}`] = qty;
                    }
                  }
                  return map;
                })()}
                showToast={showToast}
              />
            )}

            {currentStep === 3 && customer && (
              <Step3Payment
                customer={customer}
                items={cart}
                rakitLines={rakitLines}
                method={paymentMethod}
                subtype={paymentSubtype}
                onMethodChange={setPaymentMethod}
                onSubtypeChange={setPaymentSubtype}
                paymentType={paymentType}
                onPaymentTypeChange={setPaymentType}
                dpAmount={dpAmount}
                dpInputType={dpInputType}
                onDpAmountChange={setDpAmount}
                onDpInputTypeChange={setDpInputType}
                ongkirOn={ongkirOn}
                ongkirAmount={ongkirAmount}
                onOngkirToggle={setOngkirOn}
                onOngkirAmountChange={setOngkirAmount}
                deliveryAddress={deliveryAddress}
                onDeliveryAddressChange={setDeliveryAddress}
                notes={notes}
                onNotesChange={setNotes}
                subtotal={subtotal}
                totalInvoice={totalInvoice}
                effectiveDp={effectiveDp}
                sisaPelunasan={sisaPelunasan}
                outstanding={tempoOutstanding}
                onSave={onSave}
                onCancel={onCancel}
                showToast={showToast}
              />
            )}
          </>
        )}

        {!loading && (
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              {currentStep === 1 && !canAdvanceStep1 && 'Lengkapi channel & customer untuk lanjut.'}
              {currentStep === 2 && !canAdvanceStep2 && 'Lengkapi keranjang untuk lanjut.'}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onKembali}
                disabled={currentStep === 1}
                className="px-4 py-2 text-sm font-semibold rounded-lg text-slate-700 border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Kembali
              </button>
              {currentStep < 3 && (
                <button
                  type="button"
                  onClick={onLanjut}
                  disabled={currentStep === 1 ? !canAdvanceStep1 : !canAdvanceStep2}
                  className="px-5 py-2 text-sm font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {currentStep === 1 ? 'Lanjut ke Pesanan →' : 'Lanjut ke Pembayaran →'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
