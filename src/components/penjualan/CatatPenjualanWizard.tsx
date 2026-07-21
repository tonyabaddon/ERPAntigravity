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
import type {
  ActivePage,
  DbCustomer,
  DbCustomerWithStats,
  DbServiceType,
  DiscountType,
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
import { serviceTypesService, tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { computeDiscountAmount } from '../ui/discount';
import type { SupabaseStockItem } from '../../lib/supabaseClient';
import { wibDateString } from '../../lib/format';
import { formatIDR } from '../../lib/formatIDR';
import { CHANNEL_REQUIRES_ORDER_NO, getChannelDef } from '../../lib/salesChannels';
import { useWarehouses } from '../../hooks/useWarehouses';
import { useActivePromos } from '../../hooks/useActivePromos';
import { computeLinePromoDiscount } from '../../lib/promoProduk/types';
import { createTempoInvoice } from '../../lib/piutangService';
import {
  createSalesOrder,
  fetchSalesOrderById,
  markSalesOrderConverted,
} from '../../lib/salesOrderService';
import WizardStepper from './wizard/WizardStepper';
import Step1ChannelCustomer from './wizard/Step1ChannelCustomer';
import Step2Items from './wizard/Step2Items';
import Step3Payment from './wizard/Step3Payment';
import { validateStep1, validateStep2 } from '../../lib/wizard/validation';
import { isFieldVisible } from '../../lib/pengaturan/cascadeMap';
import type { DbTenantSettings } from '../../types';
import {
  checkDiscountGate,
  requestDiscountApproval,
  linkSaleToApproval,
  cancelDiscountRequest,
  subscribeToApprovalRequest,
} from '../../lib/discountApproval/api';
import { captureError } from '../../lib/captureError';

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
  mode?: 'invoice' | 'quote';
  fromSalesOrderId?: string;
}

export default function CatatPenjualanWizard(props: CatatPenjualanWizardProps) {
  const { currentUser, showToast, onBack, onSaved, initialChannel, initialPrefillSku, onNavigate } = props;
  const mode = props.mode ?? 'invoice';
  const fromSalesOrderId = props.fromSalesOrderId;

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

  // ── Diskon modul toggle (Task 14) + multi-tier price settings (Task 7) ──────
  const [modulDiskonOn, setModulDiskonOn] = useState(true);
  const [tenantSettings, setTenantSettings] = useState<DbTenantSettings | null>(null);
  useEffect(() => {
    tenantSettingsService.fetch()
      .then((s) => {
        setModulDiskonOn(s?.modul_diskon_kasir ?? true);
        setTenantSettings(s ?? null);
      })
      .catch((err) => {
        // Silent catch was hiding real config regressions — diskon column /
        // grosir tier pill would silently revert to permissive defaults.
        captureError(err, { feature: 'wizard', action: 'fetch_tenant_settings' });
      });
  }, []);

  // ── Multi-tier pricing state (Task 7) ─────────────────────────────────────
  const [activeTier, setActiveTier] = useState<'eceran' | 'grosir'>('eceran');
  const showTierPill = tenantSettings ? isFieldVisible('tier_pill_kasir', tenantSettings) : false;

  // ── Auto-apply tier when customer changes (Task 7) ────────────────────────
  useEffect(() => {
    if (!showTierPill) return;
    const customerTier = customer?.default_pricing_tier ?? 'eceran';
    if (customerTier !== activeTier) setActiveTier(customerTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, showTierPill]);

  // ── Re-compute cart prices when tier switches (Task 7) ────────────────────
  // Per-line: zero out any stale percent discount when master price changes
  // (the correct discount_amount_rp would require knowing the new pct×base;
  // zeroing is safer and forces the operator to re-enter if needed).
  // When grosir is active but price_grosir is null for a line, fall back to
  // eceran price AND tag that line as 'eceran' so the JSONB payload stays
  // semantically correct (matches the COALESCE in the Task 6 RPC).
  useEffect(() => {
    if (!showTierPill) return;
    setCart((prev) => prev.map((line) => {
      if (!line.sku) return line;
      const product = stocks.find((s) => s.sku === line.sku);
      if (!product) return line;
      const useGrosir = activeTier === 'grosir' && product.price_grosir != null;
      const newPrice = useGrosir ? product.price_grosir! : product.price;
      const lineTier: 'eceran' | 'grosir' = useGrosir ? 'grosir' : 'eceran';
      if (newPrice === line.unit_price && lineTier === (line.pricing_tier_used ?? 'eceran')) return line;
      return {
        ...line,
        unit_price: newPrice,
        master_price_at_sale: newPrice,
        pricing_tier_used: lineTier,
        subtotal: newPrice * line.qty,
        hpp_subtotal: line.hpp_per_unit * line.qty,
        // Zero out stale line discount when price changes to avoid desync
        discount_type: null,
        discount_value: null,
        discount_amount_rp: 0,
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTier, showTierPill]);

  // ── Order-level discount state (Task 14) ──────────────────────────────────
  const [orderDiscountValue, setOrderDiscountValue] = useState<number | null>(null);
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>(null);

  // Item #4: discount approval state
  // - discountReason: admin-typed reason (visible when gate triggers)
  // - approvedApprovalId: set once owner approves; carries through until sale commits, then attached via linkSaleToApproval
  // - pendingApprovalId: request in-flight (awaiting owner)
  // - reasonPromptOpen: modal open state for reason entry when gate first triggers
  const [discountReason, setDiscountReason] = useState('');
  const [approvedApprovalId, setApprovedApprovalId] = useState<number | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<number | null>(null);
  const [reasonPromptOpen, setReasonPromptOpen] = useState(false);
  const [gateThresholds, setGateThresholds] = useState<{ amount: number | null; percent: number | null } | null>(null);

  // ── Step 3: payment fields ────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  // Phase 0b: cash_account_id picker selection for transfer/qris/edc flows.
  // Reset to null when method flips back to 'cash' (auto-routes to default Kas).
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
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
  // Active service_types: fetched once on mount, passed to Step2Items → CartRows
  // so cart rakit rows display dynamic names from DB instead of hardcoded labels.
  const [serviceTypes, setServiceTypes] = useState<DbServiceType[]>([]);

  const { warehouses } = useWarehouses();
  // Item #4b: active promos by SKU for badge display + auto-apply at save time.
  const { promos } = useActivePromos();

  // Load stocks + customers once on mount
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch((err) => showToast(`Gagal memuat data: ${err?.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load active service_types for dynamic RakitButtonsRow labels in CartRows.
  useEffect(() => {
    serviceTypesService.fetchActive()
      .then(setServiceTypes)
      .catch((err: unknown) => captureError(err, { feature: 'wizard', action: 'fetch_service_types' }));
  }, []);

  // ── Derived totals ────────────────────────────────────────────────────────
  const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);
  const skuSubtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  // Task 14: subtotal after per-line discounts (master × qty − effectiveDiscount per line).
  // Item #4b: when promo applies and no manual discount set, use promo discount amount.
  const skuSubtotalAfterLineDiscount = cart.reduce((s, i) => {
    const master = i.master_price_at_sale ?? i.unit_price;
    const manualDisc = i.discount_amount_rp ?? 0;
    const hasManual = (i.discount_type != null) && manualDisc > 0;
    let effectiveDisc = manualDisc;
    if (!hasManual && i.sku) {
      const promo = promos.get(i.sku);
      if (promo) {
        const pd = computeLinePromoDiscount(master, i.qty, promo);
        if (pd.discount > 0 && pd.snapshot !== null) effectiveDisc = pd.discount;
      }
    }
    return s + (master * i.qty - effectiveDisc);
  }, 0);
  const subtotalAfterLineDiscount = skuSubtotalAfterLineDiscount + rakitTotal;
  const subtotal = skuSubtotal + rakitTotal;
  // Task 14: order-level discount applied on top of line discounts
  const orderDiscountAmountRp = computeDiscountAmount(orderDiscountValue, orderDiscountType, subtotalAfterLineDiscount);
  const totalInvoice = subtotalAfterLineDiscount - orderDiscountAmountRp + (ongkirOn ? ongkirAmount : 0);
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
      const { data, error } = await supabase
        .from('orders')
        .select('total')
        .eq('customer_id', customer.id)
        .eq('payment_type', 'TEMPO')
        .eq('status', 'INVOICE_TEMPO');
      if (cancelled) return;
      if (error) {
        // Was silently defaulting to 0 → wrong credit-limit UI. Surface
        // and set sentinel so Step3 disables TEMPO save until retry.
        captureError(error, { feature: 'wizard', action: 'fetch_tempo_outstanding' });
        setTempoOutstanding(-1);
        return;
      }
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
    // Task 7: apply active tier price when adding item.
    // When grosir is active but price_grosir is null, fall back to eceran
    // price AND record tier as 'eceran' so RPC JSONB is semantically correct.
    const useGrosirAdd = showTierPill && activeTier === 'grosir' && stock.price_grosir != null;
    const tierPrice = useGrosirAdd ? stock.price_grosir! : stock.price;
    const lineTierAdd: 'eceran' | 'grosir' = useGrosirAdd ? 'grosir' : 'eceran';
    setCart((prev) => [
      ...prev,
      {
        _key: ++_itemSeq,
        sku: stock.sku,
        name: stock.name,
        qty: 1,
        unit_price: tierPrice,
        hpp_per_unit: stock.harga_modal ?? 0,
        subtotal: tierPrice,
        hpp_subtotal: stock.harga_modal ?? 0,
        warehouse: null,
        warehouse_id: defaultWh?.id ?? null,
        // Task 14: capture master price at time of add for discount reference
        master_price_at_sale: tierPrice,
        discount_type: null,
        discount_value: null,
        discount_amount_rp: 0,
        // Task 7: record which tier was active (may be eceran if grosir not set)
        pricing_tier_used: showTierPill ? lineTierAdd : undefined,
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

  // Task 14: update per-line discount fields from CartRow bidirectional binding.
  function updateLineDiscount(key: number, discount_type: DiscountType, discount_value: number | null, discount_amount_rp: number) {
    setCart((prev) => prev.map((i) =>
      i._key === key
        ? { ...i, discount_type, discount_value, discount_amount_rp }
        : i,
    ));
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

  // Pre-fill from SO when converting Sales Order → Sales Invoice.
  // One-shot: fetches SO and seeds channel/customer/items/notes. Operator
  // can still edit anything before saving the SI.
  useEffect(() => {
    if (!fromSalesOrderId) return;
    let cancelled = false;
    void (async () => {
      try {
        const so = await fetchSalesOrderById(fromSalesOrderId);
        if (cancelled || !so) return;
        setChannel(so.channel as KasirChannel);
        // Seed channel-specific fields validateStep1 requires. Without this,
        // whatsapp/marketplace SO conversions land on Step 1 with the Lanjut
        // button disabled because wa_phone / marketplace_order_no stayed blank.
        // SO stores customer_phone, which for whatsapp channel is the WA number.
        if (so.channel === 'whatsapp' && so.customer_phone) {
          setWaPhone(so.customer_phone);
        }
        // Customer: try match in local customers, else build a stub
        const match = customers.find((c) => c.id === so.customer_id);
        if (match) {
          setCustomer(match);
        } else if (so.customer_id) {
          setCustomer({
            id: so.customer_id,
            name: so.customer_name,
            wa_number: so.customer_phone ?? '',
            company: so.customer_company ?? '',
            address: null,
            created_at: '',
            allows_tempo: false,
            term_days: 0,
            credit_limit: 0,
            order_count: 0,
            total_spend: 0,
          } as DbCustomerWithStats);
        }
        // Items: split SKU rows from jasa lump-sum rows
        const skuRows: CartItem[] = [];
        const jasaRows: RakitLine[] = [];
        for (const it of so.items) {
          if (it.sku) {
            skuRows.push({
              _key: ++_itemSeq,
              sku: it.sku,
              name: it.name,
              qty: it.qty,
              unit_price: it.unit_price,
              hpp_per_unit: it.hpp_per_unit,
              subtotal: it.subtotal,
              hpp_subtotal: it.hpp_subtotal,
              warehouse: null,
              warehouse_id: it.warehouse_id ?? null,
            });
          } else {
            jasaRows.push({
              id: `prefill-${Math.random().toString(36).slice(2)}`,
              type: 'jasa_custom_panel',  // default; user can adjust
              description: it.name,
              estimatedPrice: it.unit_price,
              hppEstimate: it.hpp_per_unit,
            });
          }
        }
        setCart(skuRows);
        setRakitLines(jasaRows);
        setNotes(so.notes ?? '');
        showToast(`Pre-filled dari ${so.so_number}`, 'success');
      } catch (err) {
        showToast(`Gagal pre-fill dari SO: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromSalesOrderId, customers.length]);

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
  // Item #4: pre-submit discount gate. If discount > threshold and no
  // approved request yet, halt the save and either (a) open the reason
  // modal on first hit, or (b) request approval + show waiting state if
  // reason was already entered.
  const checkAndRequestDiscountApproval = async (): Promise<boolean> => {
    // Returns true when it's safe to proceed with the actual save.
    // Returns false when we've dispatched a request or need reason input.
    if (orderDiscountAmountRp <= 0) return true;
    if (approvedApprovalId !== null) return true; // already approved this session
    if (pendingApprovalId !== null) {
      showToast('Menunggu persetujuan owner…', 'info');
      return false;
    }
    let gate;
    try {
      gate = await checkDiscountGate(orderDiscountAmountRp, subtotalAfterLineDiscount);
    } catch (err) {
      // Non-fatal: if gate check errors (e.g. missing settings row), let sale proceed
      captureError(err, { feature: 'wizard', action: 'check_discount_gate' });
      return true;
    }
    if (!gate.gate_triggered) return true;

    setGateThresholds({ amount: gate.threshold_amount, percent: gate.threshold_percent });

    // If we've never asked for a reason, open the modal and stop the save.
    if (discountReason.trim().length < 3) {
      setReasonPromptOpen(true);
      showToast('Diskon melewati ambang. Isi alasan → owner approve.', 'info');
      return false;
    }

    // Reason present — dispatch approval request.
    try {
      const requestId = await requestDiscountApproval({
        discountAmountRp: orderDiscountAmountRp,
        discountType: orderDiscountType === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
        discountValue: orderDiscountValue ?? 0,
        subtotalRp: subtotalAfterLineDiscount,
        reason: discountReason.trim(),
      });
      if (requestId === -1) {
        // bypass_self path — settings say Owner-as-kasir can skip; no request
        // row created. Mark internally as pre-approved so we skip on next
        // save iteration.
        setApprovedApprovalId(-1);
        return true;
      }
      setPendingApprovalId(requestId);
      showToast('Request approval owner terkirim. Menunggu…', 'success');
    } catch (err) {
      showToast(`Gagal minta approval: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
    return false;
  };

  // Realtime subscription: when the pending approval row transitions,
  // reflect it in UI. On 'approved', flip state so the next Save click
  // will proceed with the actual sale.
  useEffect(() => {
    if (!pendingApprovalId) return;
    return subscribeToApprovalRequest(pendingApprovalId, (newStatus) => {
      if (newStatus === 'approved') {
        setApprovedApprovalId(pendingApprovalId);
        setPendingApprovalId(null);
        showToast('Owner approve. Klik Simpan lagi untuk commit sale.', 'success');
      } else if (newStatus === 'rejected') {
        setPendingApprovalId(null);
        setApprovedApprovalId(null);
        setDiscountReason('');
        showToast('Owner tolak. Diskon dibatalkan — coba tanpa diskon atau ubah nilainya.', 'warning');
      } else if (newStatus === 'expired') {
        setPendingApprovalId(null);
        showToast('Request kedaluwarsa. Ajukan ulang bila perlu.', 'warning');
      }
    });
  }, [pendingApprovalId, showToast]);

  const onSave = async (path: 'tempo' | 'wip' | 'standard'): Promise<void> => {
    if (!customer) {
      showToast('Customer wajib dipilih.', 'warning');
      throw new Error('customer_missing');
    }

    // Item #4: discount approval gate — halt save if gate needs owner
    // action. Runs early so we don't dispatch createTempoInvoice or
    // recordSale until the discount is authorized.
    if (!(await checkAndRequestDiscountApproval())) {
      throw new Error('discount_approval_required');
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
    // Phase 0b: non-cash methods require explicit cash account selection
    // (GL dual-write needs to know which account receives the funds).
    if (paymentType !== 'TEMPO' && paymentMethod !== 'cash' && !cashAccountId) {
      showToast('Pilih akun tujuan transfer/QRIS/EDC.', 'warning');
      throw new Error('cash_account_missing');
    }

    // Item #4b: helper — inject Promo Produk discount fields + promo_snapshot
    // into SKU items when an active promo exists AND no manual discount is
    // set. Shared across quote / tempo / standard paths so promo auto-apply
    // reaches all three sale flows. Preserves operator manual discount.
    const injectPromo = (items: Array<Omit<typeof cart[number], '_key'>>) =>
      items.map((rest) => {
        if (!rest.sku) return rest;
        const promo = promos.get(rest.sku);
        if (!promo) return rest;
        const hasManualDiscount = rest.discount_type != null && (rest.discount_amount_rp ?? 0) > 0;
        if (hasManualDiscount) return rest;
        const masterPrice = rest.master_price_at_sale ?? rest.unit_price;
        const { discount, snapshot } = computeLinePromoDiscount(masterPrice, rest.qty, promo);
        if (discount <= 0 || snapshot === null) return rest;
        return {
          ...rest,
          discount_type: promo.promo_discount_type,
          discount_value: promo.promo_discount_value,
          discount_amount_rp: discount,
          promo_snapshot: {
            type: promo.promo_discount_type,
            value: promo.promo_discount_value,
            expires_at: promo.promo_expires_at,
            applied_at: new Date().toISOString(),
          },
        };
      });

    // New: mode='quote' → createSalesOrder, no payment/ongkir/alamat
    if (mode === 'quote') {
      const skuItems = injectPromo(cart.map(({ _key, ...rest }) => rest));
      const serviceItems = rakitLines.map((l) => ({
        sku: null,
        name: l.description,
        qty: 1,
        unit_price: l.estimatedPrice,
        hpp_per_unit: l.hppEstimate,
        subtotal: l.estimatedPrice,
        hpp_subtotal: l.hppEstimate,
        warehouse_id: null,
        warehouse: null,
      }));
      const so = await createSalesOrder({
        channel,
        items: [...skuItems, ...serviceItems],
        subtotal,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.wa_number || null,
        customer_company: customer.company || null,
        notes: notes.trim() || null,
      });
      showToast(`Sales Order ${so.so_number} tersimpan`, 'success');
      if (onNavigate) onNavigate('daftarPenawaran'); else onBack();
      return;
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
      // Task 15: pass order-level discount as 2nd arg; subtotal uses post-line value
      // (consistent with the standard recordSale path). Per-line discount fields are
      // already embedded in each cart item via the _key-stripped spread.
      const result = await createTempoInvoice({
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.wa_number || undefined,
        customer_company: customer.company || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        channel,
        sales_channel: channel,
        delivery_type: deliveryAddress.trim() ? 'DELIVERY' : 'PICKUP',
        items: injectPromo(cart.map(({ _key, ...rest }) => rest)),
        subtotal: subtotalAfterLineDiscount,
        shipping_fee: ongkirOn ? ongkirAmount : 0,
        total: totalInvoice,
        allow_negative_stock: true,
      } as any, {
        discount_type: orderDiscountType,
        discount_value: orderDiscountValue,
        discount_amount_rp: orderDiscountAmountRp,
      });
      if (result.kind === 'ok') {
        if (fromSalesOrderId) {
          try {
            await markSalesOrderConverted(fromSalesOrderId, { orderId: result.order_id });
          } catch (err) {
            showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
          }
        }
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
        showToast(
          `⛔ Plafon kredit terlampaui. Kelebihan ${formatIDR(result.shortage)}. ` +
          `Outstanding ${formatIDR(result.outstanding)} + invoice ini ${formatIDR(result.new_amount)} > limit ${formatIDR(result.limit)}.`,
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
      if (fromSalesOrderId) {
        try {
          await markSalesOrderConverted(fromSalesOrderId, { kasirTxId: txId });
        } catch (err) {
          showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
        }
      }
      showToast('✅ Transaksi WIP tersimpan. Cek di Daftar Pesanan untuk lock + approval.', 'success');
      onSaved(txId);
      if (onNavigate) onNavigate('daftarPesanan'); else onBack();
      return;
    }

    // path === 'standard'
    // Task 14: include per-line discount fields in items sent to RPC.
    // Item #4b: inject Promo Produk via shared injectPromo() helper (defined
    // above, applied consistently to quote / tempo / standard paths).
    const skuItems = injectPromo(cart.map(({ _key, ...rest }) => rest));
    // Edge-case toast: AMOUNT promo > unit_price (snapshot=null → skipped above)
    for (const item of cart) {
      if (!item.sku) continue;
      const promo = promos.get(item.sku);
      if (!promo || promo.promo_discount_type !== 'AMOUNT') continue;
      const hasManualDiscount = item.discount_type != null && (item.discount_amount_rp ?? 0) > 0;
      if (hasManualDiscount) continue;
      const masterPrice = item.master_price_at_sale ?? item.unit_price;
      if (promo.promo_discount_value > masterPrice) {
        showToast(
          `Promo ${formatIDR(promo.promo_discount_value)}/unit tidak berlaku di ${item.sku} karena harga saat ini ${formatIDR(masterPrice)}`,
          'info',
        );
      }
    }
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
      subtotal: subtotalAfterLineDiscount,
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
      cash_account_id: paymentMethod === 'cash' ? null : cashAccountId,
      // Task 14: pass order-level discount triple
      discount: {
        discount_type: orderDiscountType,
        discount_value: orderDiscountValue,
        discount_amount_rp: orderDiscountAmountRp,
      },
    });
    if (fromSalesOrderId) {
      try {
        await markSalesOrderConverted(fromSalesOrderId, { kasirTxId: tx.id });
      } catch (err) {
        showToast(`SI tersimpan tapi gagal mark SO converted: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }
    // Item #4: link committed sale to its discount approval for audit
    // (only for real request rows; -1 sentinel = Owner bypass, no link).
    if (approvedApprovalId !== null && approvedApprovalId > 0) {
      try {
        await linkSaleToApproval({ saleId: tx.id, requestId: approvedApprovalId });
      } catch (err) {
        showToast(`Sale tersimpan tapi audit-link gagal: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }
    onSaved(tx.id);
    if (onNavigate) onNavigate('invoicePreview'); else onBack();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const stepSlug = currentStep === 1
    ? 'Pilih channel & customer'
    : currentStep === 2
    ? 'Tambah produk & jasa'
    : (mode === 'quote' ? 'Finalisasi penawaran' : 'Pembayaran & finalisasi');

  // Channel label for the context recap bar (Steps 2 & 3).
  const channelDef = getChannelDef(channel);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      {/* Header — white per mockup. Date/user pills dropped; replaced with Batal link. */}
      <div className="bg-white border border-slate-200 rounded-t-lg px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className={`text-lg font-extrabold ${mode === 'quote' ? 'text-amber-800' : 'text-[#012749]'}`}>
            {mode === 'quote' && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold tracking-wider mr-2">QUOTE MODE</span>}
            {mode === 'quote' ? 'Sales Order' : 'Sales Invoice'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Step {currentStep} dari 3 — {stepSlug}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold"
        >
          Batal
        </button>
      </div>

      <div className="bg-white border-x border-b border-slate-200 rounded-b-lg shadow-sm overflow-hidden">
        {fromSalesOrderId && (
          <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-600 text-base">✓</span>
              <span className="text-emerald-900">
                <strong>Pre-filled dari Sales Order</strong> — Channel, customer, items, dan catatan sudah diisi. Bisa adjust kalau scope berubah.
              </span>
            </div>
          </div>
        )}
        <WizardStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onJumpBack={onJumpBack}
        />

        {/* Context recap bar — show on Steps 2 & 3 once Step 1 is complete. */}
        {currentStep > 1 && customer && (
          <div className="px-6 py-3 bg-[#012749]/5 border-b border-slate-100 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-slate-600">🏪 <strong>{channelDef.label}</strong></span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">👤 <strong>{customer.name}</strong></span>
              {customer.allows_tempo && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                  TEMPO OK · Limit {Math.round((customer.credit_limit ?? 0) / 1_000_000)}jt
                </span>
              )}
              {currentStep === 3 && (
                <>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">
                    📦 {cart.length} item{rakitLines.length > 0 ? ` + ${rakitLines.length} jasa` : ''}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-bold text-[#012749]">
                    {formatIDR(Math.round(subtotalAfterLineDiscount))}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setCurrentStep(1); }}
              className="text-[#012749] font-semibold hover:underline"
            >
              Ubah
            </button>
          </div>
        )}

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
                onDiscountChange={updateLineDiscount}
                onClearCart={() => { setCart([]); setRakitLines([]); }}
                subtotal={skuSubtotal}
                subtotalAfterLineDiscount={skuSubtotalAfterLineDiscount}
                rakitSubtotal={rakitTotal}
                modulDiskonOn={modulDiskonOn}
                promos={promos}
                activeTier={activeTier}
                onTierChange={setActiveTier}
                showTierPill={showTierPill}
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
                serviceTypes={serviceTypes}
              />
            )}

            {currentStep === 3 && customer && (
              <Step3Payment
                mode={mode}
                customer={customer}
                items={cart}
                rakitLines={rakitLines}
                method={paymentMethod}
                subtype={paymentSubtype}
                onMethodChange={(m) => {
                  setPaymentMethod(m);
                  if (m === 'cash') setCashAccountId(null);
                }}
                onSubtypeChange={setPaymentSubtype}
                cashAccountId={cashAccountId}
                onCashAccountIdChange={setCashAccountId}
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
                subtotal={subtotalAfterLineDiscount}
                totalInvoice={totalInvoice}
                effectiveDp={effectiveDp}
                sisaPelunasan={sisaPelunasan}
                outstanding={tempoOutstanding}
                orderDiscountValue={orderDiscountValue}
                orderDiscountType={orderDiscountType}
                onOrderDiscountChange={(v, t) => { setOrderDiscountValue(v); setOrderDiscountType(t); }}
                modulDiskonOn={modulDiskonOn}
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
              {currentStep === 1 && !canAdvanceStep1 && (
                (() => {
                  const errs = validateStep1(step1State).errors ?? [];
                  return `Lengkapi untuk lanjut: ${errs.join(', ')}.`;
                })()
              )}
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

      {/* Item #4: discount approval modal — reason entry */}
      {reasonPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg" style={{ fontSize: '14px' }}>
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold text-slate-800">⚠ Diskon butuh approval owner</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
                Diskon {formatIDR(Math.round(orderDiscountAmountRp))}
                {gateThresholds?.amount != null && (
                  <> · melewati ambang {formatIDR(gateThresholds.amount)}</>
                )}
                {gateThresholds?.percent != null && (
                  <> · atau &gt; {gateThresholds.percent}%</>
                )}
              </div>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Alasan diskon (min 3 huruf)</span>
                <textarea
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  rows={3}
                  placeholder="Contoh: Customer loyal 5 tahun · match harga kompetitor · barang display"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <p className="text-xs text-slate-500">
                Setelah kirim, owner akan review di menu Persetujuan. Kamu bisa cancel selama menunggu.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => { setReasonPromptOpen(false); setDiscountReason(''); }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={discountReason.trim().length < 3}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={async () => {
                  setReasonPromptOpen(false);
                  // Trigger request via onSave — checkAndRequestDiscountApproval
                  // will see the reason and dispatch. onSave will throw
                  // discount_approval_required which we catch here to keep UI happy.
                  try { await onSave('standard'); } catch { /* expected: pending */ }
                }}
              >
                Kirim ke Owner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item #4: waiting-for-owner state banner */}
      {pendingApprovalId !== null && !reasonPromptOpen && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-lg" style={{ fontSize: '14px' }}>
          <div className="flex items-start gap-3">
            <div className="text-2xl">⏳</div>
            <div className="flex-1">
              <div className="font-semibold text-blue-900">Menunggu approval owner</div>
              <div className="mt-1 text-xs text-blue-800">
                Diskon {formatIDR(Math.round(orderDiscountAmountRp))} · Alasan: "{discountReason}"
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded border border-blue-300 bg-white px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  onClick={async () => {
                    if (pendingApprovalId === null) return;
                    try {
                      await cancelDiscountRequest(pendingApprovalId);
                      setPendingApprovalId(null);
                      setDiscountReason('');
                      showToast('Request dibatalkan. Kamu bisa lanjut tanpa diskon.', 'info');
                    } catch (err) {
                      showToast(`Cancel gagal: ${err instanceof Error ? err.message : String(err)}`, 'warning');
                    }
                  }}
                >
                  Batalkan request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
