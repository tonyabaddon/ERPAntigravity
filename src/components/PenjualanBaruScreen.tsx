import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  KasirChannel, KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType,
  KasirDpInputType, KasirItem, WarehouseLocation, PermissionSet, KasirTransaction,
  ActivePage,
} from '../types';
import type { DbCustomerWithStats, RakitServiceType } from '../types';
import { stockService, customersService, kasirService } from '../lib/supabaseClient';
import type { SupabaseStockItem } from '../lib/supabaseClient';
import { wibDateString } from '../lib/format';
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
  const [tokpedOrderNo, setTokpedOrderNo] = useState('');
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

  // Invoice modal after save
  const [savedTx, setSavedTx] = useState<KasirTransaction | null>(null);

  // Rakit lines
  const [rakitLines, setRakitLines] = useState<Array<{
    id: string;
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
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
  const addRakitLine = (line: { type: RakitServiceType; description: string; estimatedPrice: number }) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `rakit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRakitLines(prev => [...prev, { id, ...line }]);
    cancelRakitForm();
  };
  const removeRakitLine = (id: string) => {
    setRakitLines(prev => prev.filter(l => l.id !== id));
  };

  // Load master data once
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch(err => showToast(`Gagal memuat data: ${err.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
  }, []);

  // Rakit derived values
  const hasRakit = rakitLines.length > 0;
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
    const atas = stock.stock_atas ?? 0;
    const bawah = stock.stock_bawah ?? 0;
    const defaultWh: WarehouseLocation = atas > 0 ? 'atas' : (bawah > 0 ? 'bawah' : 'atas');
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
        warehouse: defaultWh,
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

  function updateWarehouse(key: number, wh: WarehouseLocation) {
    setCart(prev => prev.map(i => i._key === key ? { ...i, warehouse: wh } : i));
  }

  function removeItem(key: number) {
    setCart(prev => prev.filter(i => i._key !== key));
  }

  async function handleSave() {
    // Validation
    if (cart.length === 0) { showToast('Tambahkan minimal 1 item.', 'warning'); return; }
    if (!customerName.trim()) { showToast('Nama pelanggan wajib diisi.', 'warning'); return; }
    if (!customerPhone.trim()) { showToast('Nomor HP wajib diisi.', 'warning'); return; }
    if (channel === 'tokopedia' && !tokpedOrderNo.trim()) {
      showToast('Nomor Pesanan Tokopedia wajib diisi.', 'warning'); return;
    }
    if (channel === 'whatsapp' && !waPhone.trim()) {
      showToast('Nomor WhatsApp wajib diisi untuk channel WhatsApp Manual.', 'warning'); return;
    }
    if (paymentMethod === 'edc' && !paymentSubtype) {
      showToast('Pilih sub-tipe EDC (Debit / QRIS).', 'warning'); return;
    }
    if (paymentType === 'DP' && dpInputType === 'PERCENT' && (dpAmount <= 0 || dpAmount > 100)) {
      showToast('Persen DP harus antara 1 dan 100.', 'warning'); return;
    }
    if (paymentType === 'DP' && (effectiveDp <= 0 || effectiveDp >= totalInvoice)) {
      showToast('Jumlah DP harus > 0 dan < Total Invoice.', 'warning'); return;
    }

    // WIP branch: when rakit lines exist, save as WIP and navigate to wip-list
    if (hasRakit) {
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
            notes: notes.trim() || null,
            customer_id: selectedCustomerId ?? null,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            customer_company: customerCompany || null,
            delivery_address: deliveryAddress.trim() || null,
            tokped_order_no: channel === 'tokopedia' ? tokpedOrderNo : null,
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
        showToast(`❌ Gagal simpan WIP: ${e instanceof Error ? e.message : String(e)}`, 'warning');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const today = wibDateString();
      const saved = await kasirService.recordSale({
        date: today,
        channel,
        items: cart.map(({ _key, ...rest }) => rest),
        subtotal,
        payment_method: paymentMethod,
        payment_subtype: paymentSubtype,
        payment_type: paymentType,
        dp_amount: effectiveDp,
        dp_input_type: paymentType === 'DP' ? dpInputType : undefined,
        ongkir_amount: ongkirOn ? ongkirAmount : 0,
        notes: notes.trim() || undefined,
        total_amount: totalInvoice,
        tokped_order_no: channel === 'tokopedia' ? tokpedOrderNo : undefined,
        wa_phone: channel === 'whatsapp' ? waPhone : undefined,
        wa_chat_url: channel === 'whatsapp' ? waChatUrl : undefined,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_company: customerCompany || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        customer_id: selectedCustomerId ?? undefined,
      });
      setSavedTx(saved);
    } catch (err: any) {
      showToast(`Gagal menyimpan: ${err.message ?? 'unknown'}`, 'warning');
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
            {channel === 'tokopedia' && (
              <div className="mt-4">
                <TokpedStrip value={tokpedOrderNo} onChange={setTokpedOrderNo} />
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
                  cartCount={cart.length}
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
                  {hasRakit && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-800 mt-3">
                      ⚠ <strong>Transaksi ini akan masuk status WIP</strong> karena ada jasa rakit.
                      Lock + approval owner diperlukan sebelum stock decrement &amp; pelunasan.
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
    </div>
  );
}
