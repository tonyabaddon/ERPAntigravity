import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  KasirChannel, KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType,
  KasirDpInputType, KasirItem, PermissionSet, KasirTransaction,
  ActivePage,
} from '../types';
import type { DbCustomerWithStats, RakitServiceType } from '../types';
import { stockService, customersService, kasirService, supabase } from '../lib/supabaseClient';
import { createTempoInvoice } from '../lib/piutangService';
import type { SupabaseStockItem } from '../lib/supabaseClient';
import { wibDateString } from '../lib/format';
import { useWarehouses } from '../hooks/useWarehouses';
import { CHANNEL_REQUIRES_ORDER_NO } from '../lib/salesChannels';
import ChannelSelector from './penjualan/ChannelSelector';
import { TokpedStrip, WhatsappStrip } from './penjualan/ChannelStrip';
import ItemSearchPanel from './penjualan/ItemSearchPanel';
import CartRows from './penjualan/CartRows';
import CustomerPanel from './penjualan/CustomerPanel';
import PaymentPanel from './penjualan/PaymentPanel';
import SalesInvoicePDF from './penjualan/SalesInvoicePDF';
import RakitButtonsRow from './penjualan/RakitButtonsRow';
import RakitInlineForm from './penjualan/RakitInlineForm';

let _itemSeq = 0;

export interface PenjualanBaruScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;            // navigate back to kasir
  onSaved: (txId: string) => void; // after save, parent can refresh + open invoice
  initialChannel?: KasirChannel;
  onNavigate?: (page: ActivePage) => void; // optional: navigate to another page after WIP save
}

export default function PenjualanBaruScreen({
  currentUser, showToast, onBack, onSaved, initialChannel, onNavigate,
}: PenjualanBaruScreenProps) {
  // Channel
  const [channel, setChannel] = useState<KasirChannel>(initialChannel ?? 'walkin');

  // Channel-specific fields
  const [marketplaceOrderNo, setMarketplaceOrderNo] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waChatUrl, setWaChatUrl] = useState('');

  // Cart items
  const [cart, setCart] = useState<(KasirItem & { _key: number })[]>([]);

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  const [paymentSubtype, setPaymentSubtype] = useState<KasirPaymentSubtype>(null);
  const [paymentType, setPaymentType] = useState<KasirPaymentType>('FULL');
  const [dpAmount, setDpAmount] = useState(0);
  const [dpInputType, setDpInputType] = useState<KasirDpInputType>('AMOUNT');

  // Extras
  const [ongkirOn, setOngkirOn] = useState(false);
  const [ongkirAmount, setOngkirAmount] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Master data
  const [stocks, setStocks] = useState<SupabaseStockItem[]>([]);
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Warehouse list (for default warehouse in addItem)
  const { warehouses } = useWarehouses();

  // Invoice modal after save
  const [savedTx, setSavedTx] = useState<KasirTransaction | null>(null);

  // Tempo: outstanding lookup per selected customer (sum of open INVOICE_TEMPO)
  const [tempoOutstanding, setTempoOutstanding] = useState<number>(0);
  // Tempo: over-limit hard-block modal
  const [overLimitModal, setOverLimitModal] = useState<null | {
    outstanding: number; new_amount: number; limit: number; shortage: number;
  }>(null);

  // Rakit lines
  const [rakitLines, setRakitLines] = useState<Array<{
    id: string;
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
    hppEstimate: number;
  }>>([]);
  const [rakitFormOpen, setRakitFormOpen] = useState(false);
  const [rakitFormType, setRakitFormType] = useState<RakitServiceType | null>(null);

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
    setRakitLines(prev => [...prev, { id, ...line }]);
    cancelRakitForm();
  };
  const removeRakitLine = (id: string) => {
    setRakitLines(prev => prev.filter(l => l.id !== id));
  };

  // Clear all per-transaction inputs so a second sale doesn't accidentally
  // inherit the first customer + last cart + last rakit form state. Master
  // data (stocks, customers) is preserved.
  const resetForm = () => {
    setCart([]);
    setRakitLines([]);
    setRakitFormOpen(false);
    setRakitFormType(null);
    setSelectedCustomerId(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCompany('');
    setPaymentMethod('cash');
    setPaymentSubtype(null);
    setPaymentType('FULL');
    setDpAmount(0);
    setDpInputType('AMOUNT');
    setOngkirOn(false);
    setOngkirAmount(0);
    setDeliveryAddress('');
    setNotes('');
    setMarketplaceOrderNo('');
    setWaPhone('');
    setWaChatUrl('');
  };

  // Load master data once
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch(err => showToast(`Gagal memuat data: ${err.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
  }, []);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) ?? null;
  // Reset payment type to FULL if user clears the customer while on TEMPO
  useEffect(() => {
    if (paymentType === 'TEMPO' && !selectedCustomer?.allows_tempo) {
      setPaymentType('FULL');
    }
  }, [paymentType, selectedCustomer?.allows_tempo]);

  // Tempo outstanding refresh when customer changes (and they allow tempo).
  useEffect(() => {
    if (!selectedCustomer?.allows_tempo || !supabase) {
      setTempoOutstanding(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('orders')
        .select('total')
        .eq('customer_id', selectedCustomer.id)
        .eq('payment_type', 'TEMPO')
        .eq('status', 'INVOICE_TEMPO');
      if (cancelled) return;
      const sum = (data ?? []).reduce((a: number, o: { total: number }) => a + Number(o.total ?? 0), 0);
      setTempoOutstanding(sum);
    })();
    return () => { cancelled = true; };
  }, [selectedCustomer?.id, selectedCustomer?.allows_tempo]);

  // Rakit derived values
  const hasRakit = rakitLines.length > 0;
  const isMixedCart = hasRakit && cart.length > 0;
  const isPureJasa = hasRakit && cart.length === 0;
  const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);

  // Totals — effectiveDp converts percent input to Rp; sisaPelunasan uses it
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0) + rakitTotal;
  const totalInvoice = subtotal + (ongkirOn ? ongkirAmount : 0);
  const effectiveDp = paymentType === 'DP'
    ? (dpInputType === 'PERCENT' ? Math.round(totalInvoice * dpAmount / 100) : dpAmount)
    : 0;
  const sisaPelunasan = paymentType === 'DP' ? Math.max(0, totalInvoice - effectiveDp) : 0;

  // Cart handlers
  function addItem(stock: SupabaseStockItem) {
    const defaultWh = warehouses.find(w => w.is_default) ?? warehouses[0];
    setCart(prev => [
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
    setCart(prev => prev.map(i =>
      i._key === key
        ? { ...i, qty, subtotal: i.unit_price * qty, hpp_subtotal: i.hpp_per_unit * qty }
        : i
    ));
  }

  function updateWarehouse(key: number, warehouseId: string) {
    setCart(prev => prev.map(i => i._key === key ? { ...i, warehouse_id: warehouseId } : i));
  }

  function removeItem(key: number) {
    setCart(prev => prev.filter(i => i._key !== key));
  }

  async function handleSave() {
    // Validation
    if (cart.length === 0 && rakitLines.length === 0) {
      showToast('Tambahkan minimal 1 item atau jasa.', 'warning');
      return;
    }
    if (!customerName.trim()) { showToast('Nama pelanggan wajib diisi.', 'warning'); return; }
    if (!customerPhone.trim()) { showToast('Nomor HP wajib diisi.', 'warning'); return; }
    if (CHANNEL_REQUIRES_ORDER_NO.has(channel) && !marketplaceOrderNo.trim()) {
      showToast('Nomor Order Marketplace wajib diisi.', 'warning'); return;
    }
    if (channel === 'whatsapp' && !waPhone.trim()) {
      showToast('Nomor WhatsApp wajib diisi untuk channel WhatsApp Manual.', 'warning'); return;
    }
    if (paymentType !== 'TEMPO' && paymentMethod === 'edc' && !paymentSubtype) {
      showToast('Pilih sub-tipe EDC (Debit / QRIS).', 'warning'); return;
    }
    if (paymentType === 'DP' && dpInputType === 'PERCENT' && (dpAmount <= 0 || dpAmount > 100)) {
      showToast('Persen DP harus antara 1 dan 100.', 'warning'); return;
    }
    if (paymentType === 'DP' && (effectiveDp <= 0 || effectiveDp >= totalInvoice)) {
      showToast('Jumlah DP harus > 0 dan < Total Invoice.', 'warning'); return;
    }

    // TEMPO branch — calls atomic create_tempo_invoice RPC
    if (paymentType === 'TEMPO') {
      if (!selectedCustomer) { showToast('Pilih pelanggan terdaftar untuk Tempo.', 'warning'); return; }
      if (!selectedCustomer.allows_tempo) { showToast('Pelanggan ini belum diaktifkan untuk Tempo.', 'warning'); return; }
      if (isMixedCart) {
        showToast('Tempo tidak boleh dicampur SKU + jasa. Pisahkan jasa di transaksi terpisah.', 'warning'); return;
      }
      setSaving(true);
      try {
        const result = await createTempoInvoice({
          customer_id: selectedCustomer.id,
          customer_name: customerName,
          customer_phone: customerPhone || undefined,
          customer_company: customerCompany || undefined,
          delivery_address: deliveryAddress.trim() || undefined,
          channel,
          sales_channel: channel,
          delivery_type: deliveryAddress.trim() ? 'DELIVERY' : 'PICKUP',
          items: cart.map(({ _key, ...rest }) => rest),
          subtotal,
          shipping_fee: ongkirOn ? ongkirAmount : 0,
          total: totalInvoice,
        });
        if (result.kind === 'ok') {
          showToast(`Faktur tempo dibuat (Jatuh tempo ${selectedCustomer.term_days} hari).`, 'success');
          resetForm();
          if (onNavigate) onNavigate('piutang'); else onBack();
        } else if (result.kind === 'credit_limit_exceeded') {
          setOverLimitModal({
            outstanding: result.outstanding, new_amount: result.new_amount,
            limit: result.limit, shortage: result.shortage,
          });
        } else if (result.kind === 'tempo_not_enabled') {
          showToast('Tempo belum aktif untuk pelanggan ini.', 'warning');
        } else {
          showToast(`Gagal: ${result.message}`, 'warning');
        }
      } catch (e: any) {
        showToast(`Gagal membuat faktur tempo: ${e?.message ?? 'unknown'}`, 'warning');
      } finally {
        setSaving(false);
      }
      return;
    }

    // WIP branch: mixed carts (SKU + jasa) go through lock-approval so SKU
    // stock can be deducted at lock time. Pure-jasa carts fall through to
    // the recordSale path below.
    if (isMixedCart) {
      setSaving(true);
      try {
        const today = wibDateString();
        await kasirService.insertWipWithRakit({
          tx: {
            date: today,
            channel,
            subtotal,
            total_amount: totalInvoice,
            dp_amount: effectiveDp,
            ongkir_amount: ongkirOn ? ongkirAmount : 0,
            payment_method: paymentMethod,
            payment_subtype: paymentSubtype,
            payment_type: paymentType,
            dp_input_type: paymentType === 'DP' ? dpInputType : null,
            notes: notes.trim() || null,
            customer_id: selectedCustomerId ?? null,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            customer_company: customerCompany || null,
            delivery_address: deliveryAddress.trim() || null,
            marketplace_order_no: CHANNEL_REQUIRES_ORDER_NO.has(channel) ? marketplaceOrderNo : null,
            wa_phone: channel === 'whatsapp' ? waPhone : null,
            wa_chat_url: channel === 'whatsapp' ? waChatUrl : null,
          },
          rakitLines: rakitLines.map(l => ({
            serviceType: l.type,
            description: l.description,
            estimatedPrice: l.estimatedPrice,
          })),
        });
        showToast('✅ Transaksi WIP tersimpan. Lanjutkan ke WIP list untuk submit lock.', 'success');
        if (onNavigate) {
          onNavigate('wip-list');
        } else {
          onBack();
        }
      } catch (e: any) {
        // PostgrestError isn't an Error instance, but has .message + .code + .details + .hint
        const msg = e?.message || e?.error_description || (typeof e === 'string' ? e : JSON.stringify(e));
        const code = e?.code ? ` [${e.code}]` : '';
        showToast(`❌ Gagal simpan WIP: ${msg}${code}`, 'warning');
        console.error('insertWipWithRakit failed:', e);  // log full object for debugging
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const today = wibDateString();
      const skuItems = cart.map(({ _key, ...rest }) => rest);
      const serviceItems = rakitLines.map(l => ({
        sku: null,
        name: l.description,
        qty: 1,
        unit_price: l.estimatedPrice,
        hpp_per_unit: l.hppEstimate,
        subtotal: l.estimatedPrice,
        hpp_subtotal: l.hppEstimate,
        warehouse: null,
      }));
      const saved = await kasirService.recordSale({
        date: today,
        channel,
        items: [...skuItems, ...serviceItems],
        subtotal,
        payment_method: paymentMethod,
        payment_subtype: paymentSubtype,
        payment_type: paymentType,
        dp_amount: effectiveDp,
        dp_input_type: paymentType === 'DP' ? dpInputType : undefined,
        ongkir_amount: ongkirOn ? ongkirAmount : 0,
        notes: notes.trim() || undefined,
        total_amount: totalInvoice,
        marketplace_order_no: CHANNEL_REQUIRES_ORDER_NO.has(channel) ? marketplaceOrderNo : undefined,
        wa_phone: channel === 'whatsapp' ? waPhone : undefined,
        wa_chat_url: channel === 'whatsapp' ? waChatUrl : undefined,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_company: customerCompany || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        customer_id: selectedCustomerId ?? undefined,
      });
      setSavedTx(saved);
      // Clear cart + rakit + customer + payment so re-clicking Simpan
      // (e.g. while the invoice modal is up) does not silently invoice the
      // same line again — surfaced by the 2026-06-12 e2e audit.
      resetForm();
    } catch (err: any) {
      const msg = err?.message || err?.error_description || (typeof err === 'string' ? err : JSON.stringify(err));
      const code = err?.code ? ` [${err.code}]` : '';
      showToast(`Gagal menyimpan: ${msg}${code}`, 'warning');
      console.error('recordSale failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      {/* Top bar */}
      <div className="bg-[#012749] text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/80 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="font-extrabold text-sm">📋 Catat Penjualan</div>
            <div className="text-[11px] opacity-65">Dashboard › Penjualan › Baru</div>
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

      <div className="bg-white rounded-b-2xl p-5 md:p-6 shadow-sm">
        {loading ? (
          <p className="text-center text-slate-400 py-12 text-sm">Memuat data...</p>
        ) : (
          <>
            {/* Channel selector + strips go here (Task 4.x) */}
            <ChannelSelector value={channel} onChange={setChannel} />
            {CHANNEL_REQUIRES_ORDER_NO.has(channel) && (
              <div className="mt-4">
                <TokpedStrip value={marketplaceOrderNo} onChange={setMarketplaceOrderNo} />
              </div>
            )}
            {channel === 'whatsapp' && (
              <div className="mt-4">
                <WhatsappStrip
                  phone={waPhone}
                  chatUrl={waChatUrl}
                  onPhoneChange={setWaPhone}
                  onChatUrlChange={setWaChatUrl}
                />
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4 mt-4">
              <div>
                <ItemSearchPanel
                  stocks={stocks}
                  cartCount={cart.length + rakitLines.length}
                  cartSubtotal={subtotal}
                  onAdd={addItem}
                >
                  <CartRows
                    items={cart}
                    stocks={stocks}
                    onQtyChange={updateQty}
                    onWarehouseChange={updateWarehouse}
                    onRemove={removeItem}
                    rakitLines={rakitLines}
                    onRemoveRakit={removeRakitLine}
                  />
                </ItemSearchPanel>
                <RakitButtonsRow
                  formOpen={rakitFormOpen}
                  formType={rakitFormType}
                  onOpen={openRakitForm}
                />
                {rakitFormOpen && rakitFormType && (
                  <RakitInlineForm
                    type={rakitFormType}
                    onAdd={addRakitLine}
                    onCancel={cancelRakitForm}
                  />
                )}
              </div>
              <div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
                  <CustomerPanel
                    customers={customers}
                    selectedCustomerId={selectedCustomerId}
                    customerName={customerName}
                    customerPhone={customerPhone}
                    customerCompany={customerCompany}
                    onSelectExisting={(c) => {
                      setSelectedCustomerId(c.id);
                      setCustomerName(c.name);
                      setCustomerPhone(c.wa_number ?? '');
                      setCustomerCompany(c.company ?? '');
                    }}
                    onClearSelection={() => {
                      setSelectedCustomerId(null);
                      setCustomerName('');
                      setCustomerPhone('');
                      setCustomerCompany('');
                    }}
                    onNameChange={setCustomerName}
                    onPhoneChange={setCustomerPhone}
                    onCompanyChange={setCustomerCompany}
                  />
                  {isMixedCart && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-800 mt-3">
                      ⚠ <strong>Transaksi ini akan masuk status WIP</strong> karena ada SKU + jasa rakit di cart yang sama.
                      Lock + approval owner diperlukan sebelum stock decrement &amp; pelunasan.
                    </div>
                  )}
                  {isPureJasa && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[12px] text-emerald-800 mt-3">
                      💡 Cart pure-jasa &mdash; invoice langsung dicetak tanpa lock/approval.
                    </div>
                  )}
                  <PaymentPanel
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
                    allowsTempo={!!selectedCustomer?.allows_tempo}
                    termDays={selectedCustomer?.term_days ?? null}
                    creditLimit={selectedCustomer?.credit_limit ?? null}
                    outstanding={tempoOutstanding}
                    customerSelected={!!selectedCustomerId}
                    saving={saving}
                    onSave={handleSave}
                    onCancel={onBack}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {savedTx && (
        <SalesInvoicePDF
          transaction={savedTx}
          variant={savedTx.payment_type === 'DP' ? 'dp' : 'lunas'}
          adminName={currentUser?.name}
          autoPrint
          onClose={() => { setSavedTx(null); onSaved(savedTx.id); }}
        />
      )}
      {overLimitModal && (
        <OverLimitModal
          {...overLimitModal}
          customerName={customerName || selectedCustomer?.name || ''}
          onClose={() => setOverLimitModal(null)}
        />
      )}
    </div>
  );
}

function OverLimitModal({ outstanding, new_amount, limit, shortage, customerName, onClose }: {
  outstanding: number; new_amount: number; limit: number; shortage: number; customerName: string;
  onClose: () => void;
}) {
  const fmt = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-rose-200 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="bg-rose-50 border-b border-rose-200 px-5 py-4">
          <h2 className="text-sm font-extrabold text-rose-800">⛔ Plafon Kredit Terlampaui</h2>
          <div className="text-[12px] text-rose-700 mt-1">Faktur tempo untuk <strong>{customerName}</strong> tidak dapat dibuat.</div>
        </div>
        <div className="px-5 py-4 space-y-1.5 text-[12px]">
          <div className="flex justify-between"><span className="text-slate-500">Plafon kredit</span><span className="font-bold">{fmt(limit)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Outstanding saat ini</span><span className="font-bold">{fmt(outstanding)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Invoice ini</span><span className="font-bold">{fmt(new_amount)}</span></div>
          <div className="border-t border-slate-200 my-1.5" />
          <div className="flex justify-between text-rose-700">
            <span className="font-bold">Kelebihan</span><span className="font-extrabold">{fmt(shortage)}</span>
          </div>
        </div>
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
          <div className="text-[11px] text-slate-600 mb-3">
            Minta pelanggan untuk melunasi faktur tempo yang masih outstanding, atau ajukan kenaikan plafon kredit di menu Pelanggan.
          </div>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-slate-800 text-white text-[13px] font-bold hover:bg-slate-900">
            Mengerti
          </button>
        </div>
      </div>
    </div>
  );
}
