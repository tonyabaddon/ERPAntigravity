import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  KasirChannel, KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType,
  KasirDpInputType, KasirItem, WarehouseLocation, PermissionSet,
} from '../types';
import type { DbCustomerWithStats } from '../types';
import { stockService, customersService, kasirService } from '../lib/supabaseClient';
import type { SupabaseStockItem } from '../lib/supabaseClient';

export interface PenjualanBaruScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;            // navigate back to kasir
  onSaved: (txId: string) => void; // after save, parent can refresh + open invoice
  initialChannel?: KasirChannel;
}

export default function PenjualanBaruScreen({
  currentUser, showToast, onBack, onSaved, initialChannel,
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
  const [notes, setNotes] = useState('');

  // Master data
  const [stocks, setStocks] = useState<SupabaseStockItem[]>([]);
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load master data once
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch(err => showToast(`Gagal memuat data: ${err.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
  }, []);

  // Totals
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  const totalInvoice = subtotal + (ongkirOn ? ongkirAmount : 0);
  const sisaPelunasan = paymentType === 'DP' ? totalInvoice - dpAmount : 0;

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
            <div className="text-sm text-slate-400">[Channel selector, strips, item panel, customer panel — fill in via subsequent tasks]</div>
          </>
        )}
      </div>
    </div>
  );
}
