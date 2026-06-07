import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Package, DollarSign,
  Plus, Printer, X, Search, Lock
} from 'lucide-react';
import {
  KasirTransaction, KasirChannel, KasirPaymentMethod, KasirExpenseCategory,
  KasirItem, NewSaleTransaction, DailySummary, PermissionSet, DbOrder
} from '../types';
import {
  kasirService, stockService, customersService, isSupabaseConfigured,
} from '../lib/supabaseClient';
import type { SupabaseStockItem } from '../lib/supabaseClient';
import { purchaseOrderService } from '../lib/pembelianService';
import type { DbCustomerWithStats } from '../types';
import KasirInvoiceModal from './KasirInvoiceModal';

interface KasirScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── helpers ─────────────────────────────────────────────────

const CHANNEL_LABEL: Record<KasirChannel, string> = {
  walkin: '🏪 Walk-in',
  tokopedia: '🛍️ Tokopedia',
  grosir: '🏭 Grosir',
  whatsapp: '💬 WhatsApp',
};

const PAYMENT_LABEL: Record<KasirPaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  edc: 'EDC',
};

const EXPENSE_CATEGORIES: KasirExpenseCategory[] = [
  'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain',
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRp(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(val);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// ─── Sub-components ──────────────────────────────────────────

function ChannelPill({ channel }: { channel: KasirChannel }) {
  const styles: Record<KasirChannel, string> = {
    walkin: 'bg-blue-50 text-blue-700',
    tokopedia: 'bg-yellow-50 text-yellow-700',
    grosir: 'bg-violet-50 text-violet-700',
    whatsapp: 'bg-green-50 text-green-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles[channel]}`}>
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

// ─── KpiCard ────────────────────────────────────────────────

interface KpiCardProps {
  label: string; value: string; sub: string;
  color: 'green' | 'red' | 'amber' | 'navy'; icon: React.ReactNode;
  locked?: boolean;
}

function KpiCard({ label, value, sub, color, icon, locked }: KpiCardProps) {
  const colorMap = {
    green: 'bg-emerald-50 border-emerald-100',
    red: 'bg-red-50 border-red-100',
    amber: 'bg-amber-50 border-amber-100',
    navy: 'bg-[#012749] border-[#012749]',
  };
  const topBar = {
    green: 'from-[#2d8a4e] to-emerald-400',
    red: 'from-red-600 to-red-400',
    amber: 'from-amber-600 to-amber-400',
    navy: 'from-[#012749] to-[#1e3d60]',
  };
  const textColor = color === 'navy' ? 'text-white' : 'text-[#012749]';
  const subColor = color === 'navy' ? 'text-white/50' : 'text-gray-400';
  const labelColor = color === 'navy' ? 'text-white/50' : 'text-gray-500';

  if (locked) {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-5 flex flex-col items-center justify-center gap-1">
        <Lock className="w-5 h-5 text-gray-300" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-300">{label}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-3xl p-5 border relative overflow-hidden ${colorMap[color]}`}>
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${topBar[color]}`} />
      <div className={`text-lg mb-2 ${color === 'navy' ? 'text-white' : ''}`}>{icon}</div>
      <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${labelColor}`}>{label}</div>
      <div className={`text-xl font-black leading-none ${textColor}`}>{value}</div>
      <div className={`text-[10px] font-semibold mt-1.5 ${subColor}`}>{sub}</div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────

type Entry = { _src: 'kasir'; tx: KasirTransaction; order: null } | { _src: 'wa'; tx: null; order: DbOrder };

export default function KasirScreen({ currentUser, showToast }: KasirScreenProps) {
  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [transactions, setTransactions] = useState<KasirTransaction[]>([]);
  const [waOrders, setWaOrders] = useState<DbOrder[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, SupabaseStockItem>>({});
  const [allStocks, setAllStocks] = useState<SupabaseStockItem[]>([]);
  const [allCustomers, setAllCustomers] = useState<DbCustomerWithStats[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'walkin' | 'wa' | 'online' | 'expense'>('all');

  // Modal states
  const [showSaleModal, setShowSaleModal] = useState<KasirChannel | null>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [printTx, setPrintTx] = useState<KasirTransaction | null>(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [txs, orders, stocks, customers] = await Promise.all([
        kasirService.fetchTransactions(selectedDate),
        kasirService.fetchWaOrdersForDate(selectedDate),
        stockService.fetchAll(),
        customersService.fetchAll(),
      ]);
      setTransactions(txs);
      setWaOrders(orders);
      const map: Record<string, SupabaseStockItem> = {};
      (stocks as SupabaseStockItem[]).forEach(s => { map[s.sku] = s; });
      setStockMap(map);
      setAllStocks(stocks as SupabaseStockItem[]);
      setAllCustomers(customers);
      const hppMap: Record<string, number | null> = {};
      (stocks as SupabaseStockItem[]).forEach(s => { hppMap[s.sku] = s.harga_modal ?? null; });
      setSummary(kasirService.computeDailySummary(txs, orders, hppMap));
    } catch {
      showToast('Gagal memuat data kasir.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered log ──
  const allEntries: Entry[] = [
    ...transactions.map(tx => ({ _src: 'kasir' as const, tx, order: null })),
    ...waOrders.map(o => ({ _src: 'wa' as const, tx: null, order: o })),
  ].sort((a, b) => {
    const aTime = a._src === 'kasir' ? a.tx.created_at : a.order.updated_at;
    const bTime = b._src === 'kasir' ? b.tx.created_at : b.order.updated_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const filteredEntries = allEntries.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'wa') return e._src === 'wa';
    if (filter === 'expense') return e._src === 'kasir' && e.tx!.type === 'expense';
    if (filter === 'walkin') return e._src === 'kasir' && e.tx!.channel === 'walkin';
    if (filter === 'online') return e._src === 'kasir' && (e.tx!.channel === 'tokopedia' || e.tx!.channel === 'grosir');
    return true;
  });

  const missingHpp = summary && isOwner
    ? transactions.filter(tx =>
        tx.type === 'income' && tx.items.some(i => i.hpp_per_unit === 0)
      ).length
    : 0;

  // ── Render ──
  return (
    <div className="space-y-5 animate-fadeIn pb-24">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-6 rounded-[2.5rem] border border-[#e5eeff] shadow-lg">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black tracking-widest text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
              Rekonsiliasi Aktif
            </span>
          </div>
          <h2 className="text-xl font-black text-[#012749] tracking-tight">Kasir Harian</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isOwner && (
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-white border border-[#e5eeff] rounded-xl px-3 py-2 text-xs font-semibold text-[#012749] outline-none focus:ring-1 focus:ring-[#012749]"
            />
          )}
          {isOwner && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white border border-[#e5eeff] text-[#012749] hover:border-[#012749] transition-all"
            >
              <Printer className="w-3.5 h-3.5" /> Cetak Laporan
            </button>
          )}
          <button
            onClick={() => setShowSaleModal('walkin')}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold bg-[#012749] text-white shadow hover:bg-[#1e3d60] transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Catat Penjualan
          </button>
        </div>
      </div>

      {/* KPI strip */}
      {!loading && summary && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total Pemasukan" color="green" icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
            value={formatRp(summary.totalIncome)}
            sub={`${allEntries.filter(e => e._src === 'wa' || (e._src === 'kasir' && e.tx.type === 'income')).length} transaksi`}
          />
          <KpiCard
            label="Total Pengeluaran" color="red" icon={<TrendingDown className="w-5 h-5 text-red-600" />}
            value={formatRp(summary.totalExpense)}
            sub={`${transactions.filter(t => t.type === 'expense').length} pos`}
          />
          {isOwner ? (
            <>
              <KpiCard
                label="HPP (Harga Modal)" color="amber" icon={<Package className="w-5 h-5 text-amber-600" />}
                value={formatRp(summary.totalHpp)}
                sub={missingHpp > 0 ? `⚠ ${missingHpp} item tanpa HPP` : 'Semua item ada HPP'}
              />
              <KpiCard
                label="Laba Bersih" color="navy" icon={<DollarSign className="w-5 h-5 text-white" />}
                value={formatRp(summary.labaBersih)}
                sub={`Kotor: ${formatRp(summary.labaKotor)}`}
              />
            </>
          ) : (
            <>
              <KpiCard
                label="Item Terjual" color="amber" icon={<Package className="w-5 h-5 text-amber-600" />}
                value={String(summary.itemsSold)} sub="dari semua channel"
              />
              <KpiCard
                label="Laba Bersih" color="navy" icon={<Lock className="w-5 h-5" />}
                value="" sub="" locked
              />
            </>
          )}
        </div>
      )}

      {/* Main columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Transaction log — takes 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl overflow-hidden flex flex-col">
          <div className="p-6 pb-3 border-b border-slate-50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#012749]">Log Transaksi</h3>
                <p className="text-xs text-gray-400 mt-0.5">Real-time · semua channel</p>
              </div>
            </div>
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {([
                ['all', 'Semua'],
                ['walkin', 'Walk-in'],
                ['wa', 'WA Order'],
                ['online', 'Online'],
                ['expense', 'Pengeluaran'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                    filter === key ? 'bg-[#012749] text-white' : 'bg-slate-50 text-gray-500 hover:text-[#012749]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[480px]">
            {loading && <p className="text-xs text-gray-400 text-center py-8">Memuat...</p>}
            {!loading && filteredEntries.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-12">Belum ada transaksi.</p>
            )}
            {filteredEntries.map((entry) => {
              if (entry._src === 'wa') {
                const o = entry.order;
                const waHpp = isOwner
                  ? (o.items ?? []).reduce((s: number, i: { sku: string; qty: number }) => s + (stockMap[i.sku]?.harga_modal ?? 0) * i.qty, 0)
                  : 0;
                return (
                  <div key={`wa-${o.id}`} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-emerald-50/30 transition-all">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 flex-shrink-0">
                      💬 WA Order
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate">
                        {o.gjp_order_id ?? o.id.slice(0, 8)} — {o.customer_name}
                      </div>
                      <div className="text-[10px] text-gray-400 font-medium">Auto-sync · {formatTime(o.updated_at)}</div>
                    </div>
                    {isOwner && waHpp > 0 && (
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg flex-shrink-0">
                        HPP {formatRp(waHpp)}
                      </span>
                    )}
                    <span className="text-sm font-black text-emerald-600 flex-shrink-0">+{formatRp(o.total)}</span>
                  </div>
                );
              }
              const tx = entry.tx;
              const isIncome = tx.type === 'income';
              return (
                <div key={`tx-${tx.id}`} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-blue-50/20 transition-all">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isIncome ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {tx.channel ? (
                    <ChannelPill channel={tx.channel} />
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 flex-shrink-0">
                      📤 Keluar
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">
                      {tx.type === 'expense'
                        ? `${tx.expense_category} — ${tx.description}`
                        : tx.items.map(i => `${i.name} ×${i.qty}`).join(', ')}
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium flex items-center gap-2">
                      {tx.invoice_number && <span>{tx.invoice_number}</span>}
                      {tx.payment_method && <span>· {PAYMENT_LABEL[tx.payment_method]}</span>}
                      {tx.po_id && <span className="text-violet-500">🔗 dari PO</span>}
                      <span>· {formatTime(tx.created_at)}</span>
                    </div>
                  </div>
                  {isOwner && isIncome && tx.hpp_total > 0 && (
                    <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg flex-shrink-0">
                      HPP {formatRp(tx.hpp_total)}
                    </span>
                  )}
                  <span className={`text-sm font-black flex-shrink-0 ${isIncome ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isIncome ? '+' : '−'}{formatRp(tx.subtotal)}
                  </span>
                  {isIncome && tx.invoice_number && (
                    <button
                      onClick={() => setPrintTx(tx)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-400 hover:text-[#012749] transition-all flex-shrink-0"
                      title="Cetak invoice"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-4">

          {/* Add transaction */}
          <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl p-5">
            <h3 className="text-sm font-extrabold text-[#012749] mb-1">Catat Transaksi</h3>
            <p className="text-[10px] text-gray-400 mb-4">Pilih jenis transaksi</p>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-start gap-2.5 mb-4">
              <span className="w-2 h-2 mt-1 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-emerald-800">WA Orders — Auto-Sync</div>
                <div className="text-[10px] text-emerald-600">Order terverifikasi otomatis masuk</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {(['walkin', 'tokopedia', 'grosir'] as KasirChannel[]).map(ch => (
                <button
                  key={ch}
                  onClick={() => setShowSaleModal(ch)}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 text-center transition-all hover:scale-[1.02] ${
                    ch === 'walkin' ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100' :
                    ch === 'tokopedia' ? 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100' :
                    'bg-violet-50 border-violet-200 text-violet-800 hover:bg-violet-100'
                  }`}
                >
                  <span className="text-xl mb-1">
                    {ch === 'walkin' ? '🏪' : ch === 'tokopedia' ? '🛍️' : '🏭'}
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wide">
                    {ch === 'walkin' ? 'Walk-in' : ch === 'tokopedia' ? 'Tokopedia' : 'Grosir'}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setShowExpenseModal(true)}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 bg-red-50 border-red-200 text-red-700 hover:bg-red-100 transition-all hover:scale-[1.02] text-center"
              >
                <span className="text-xl mb-1">📤</span>
                <span className="text-[11px] font-black uppercase tracking-wide">Pengeluaran</span>
              </button>
            </div>
          </div>

          {/* Payment method breakdown — visible to all, for cash drawer check */}
          {!loading && summary && (
            <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl p-5">
              <h3 className="text-sm font-extrabold text-[#012749] mb-0.5">Rekap Pembayaran</h3>
              <p className="text-[10px] text-gray-400 mb-3">Cek laci kas & rekening</p>
              <div className="space-y-2">
                {([
                  { key: 'cash', label: '💵 Tunai (Laci Kas)', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                  { key: 'transfer', label: '🏦 Transfer', color: 'text-blue-700 bg-blue-50 border-blue-200' },
                  { key: 'qris', label: '📲 QRIS', color: 'text-violet-700 bg-violet-50 border-violet-200' },
                ] as const).map(({ key, label, color }) => {
                  const val = summary.byPaymentMethod[key] ?? 0;
                  return (
                    <div key={key} className={`flex items-center justify-between px-3 py-2 rounded-xl border ${color}`}>
                      <span className="text-[11px] font-bold">{label}</span>
                      <span className="text-[11px] font-black">{formatRp(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Closing summary — owner only */}
          {isOwner && summary && (
            <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl overflow-hidden">
              <div className="p-5 pb-4">
                <h3 className="text-sm font-extrabold text-[#012749] mb-1">Tutup Buku Harian</h3>
                <p className="text-[10px] text-gray-400 mb-4">Ringkasan &amp; cetak laporan</p>
              </div>
              <div className="mx-5 mb-5 bg-gradient-to-br from-[#012749] to-[#1e3d60] rounded-2xl p-4 text-white">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-3">
                  Rekap {new Date(selectedDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {(Object.entries(summary.byChannel) as [string, number][]).filter(([, v]) => v > 0).map(([ch, val]) => (
                  <div key={ch} className="flex justify-between items-center mb-1.5">
                    <span className="text-xs opacity-70 capitalize">{ch === 'wa_order' ? 'WA Orders' : (CHANNEL_LABEL[ch as KasirChannel] ?? ch)}</span>
                    <span className="text-xs font-bold text-emerald-300">+{formatRp(val)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs opacity-70">− HPP</span>
                  <span className="text-xs font-bold text-yellow-300">−{formatRp(summary.totalHpp)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs opacity-70">− Biaya Operasional</span>
                  <span className="text-xs font-bold text-red-300">−{formatRp(summary.totalExpense)}</span>
                </div>
                <div className="border-t border-white/15 pt-2 flex justify-between items-center">
                  <span className="text-sm font-black">Laba Bersih</span>
                  <span className={`text-xl font-black ${summary.labaBersih >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatRp(summary.labaBersih)}
                  </span>
                </div>
                <button
                  onClick={() => window.print()}
                  className="mt-3 w-full py-2 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-wide hover:bg-white/20 transition-all"
                >
                  🖨️ Cetak Laporan Harian
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showSaleModal && (
        <SaleModal
          channel={showSaleModal}
          stocks={allStocks}
          customers={allCustomers}
          selectedDate={selectedDate}
          isOwner={isOwner}
          onClose={() => setShowSaleModal(null)}
          onSaved={async (tx) => {
            setShowSaleModal(null);
            await loadData();
            showToast('Transaksi disimpan.', 'success');
            if (tx.invoice_number) setPrintTx(tx);
          }}
          showToast={showToast}
        />
      )}
      {showExpenseModal && (
        <ExpenseModal
          selectedDate={selectedDate}
          onClose={() => setShowExpenseModal(false)}
          onSaved={async () => {
            setShowExpenseModal(false);
            await loadData();
            showToast('Pengeluaran dicatat.', 'success');
          }}
          showToast={showToast}
        />
      )}
      {printTx && (
        <KasirInvoiceModal transaction={printTx} onClose={() => setPrintTx(null)} />
      )}
    </div>
  );
}

// ─── SaleModal ───────────────────────────────────────────────

let _itemSeq = 0;

interface SaleModalProps {
  channel: KasirChannel;
  stocks: SupabaseStockItem[];
  customers: DbCustomerWithStats[];
  selectedDate: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (tx: KasirTransaction) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function SaleModal({ channel, stocks, customers, selectedDate, isOwner, onClose, onSaved, showToast }: SaleModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  const [items, setItems] = useState<(KasirItem & { _key: number })[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [warehouse, setWarehouse] = useState<'atas' | 'bawah'>('atas');

  const filteredCustomers = customerSearch.trim().length > 0
    ? customers.filter(c =>
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.company?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.wa_number?.includes(customerSearch)
      ).slice(0, 6)
    : [];

  const filtered = stocks.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.sku.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 8);

  function addItem(stock: SupabaseStockItem) {
    setItems(prev => [...prev, {
      _key: ++_itemSeq,
      sku: stock.sku,
      name: stock.name,
      qty: 1,
      unit_price: stock.price,
      hpp_per_unit: stock.harga_modal ?? 0,
      subtotal: stock.price,
      hpp_subtotal: stock.harga_modal ?? 0,
      warehouse,
    }]);
    setSearch('');
  }

  function updateQty(key: number, qty: number) {
    setItems(prev => prev.map(i =>
      i._key === key
        ? { ...i, qty, subtotal: i.unit_price * qty, hpp_subtotal: i.hpp_per_unit * qty }
        : i
    ));
  }

  function removeItem(key: number) {
    setItems(prev => prev.filter(i => i._key !== key));
  }

  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const hppTotal = items.reduce((s, i) => s + i.hpp_subtotal, 0);

  async function handleSave(print: boolean) {
    if (items.length === 0) { showToast('Tambahkan minimal 1 item.', 'warning'); return; }
    if (!customerName.trim()) { showToast('Nama customer wajib diisi.', 'warning'); return; }
    if (!customerPhone.trim()) { showToast('Nomor HP wajib diisi.', 'warning'); return; }

    setSaving(true);
    try {
      const invoiceNumber = await kasirService.nextInvoiceNumber(channel, selectedDate);

      // Resolve true COGS via FIFO before recording the transaction.
      // NOTE: non-atomic — deductFifo cannot be rolled back if insertSaleTransaction fails.
      // On partial failure, check stock_lots manually to restore qty_remaining.
      let itemsWithFifo: typeof items;
      try {
        itemsWithFifo = await Promise.all(
          items.map(async (item) => {
            const totalCost = await purchaseOrderService.deductFifo(item.sku, item.qty);
            return {
              ...item,
              hpp_per_unit: item.qty > 0 ? totalCost / item.qty : 0,
              hpp_subtotal: totalCost,
            };
          })
        );
      } catch (fifoErr: any) {
        console.error('deductFifo failed — some stock lots may have been partially decremented:', fifoErr);
        showToast('Gagal menghitung HPP FIFO. Cek stock_lots jika stok tidak sesuai.', 'warning');
        setSaving(false);
        return;
      }

      const newTx: NewSaleTransaction = {
        date: selectedDate,
        channel,
        items: itemsWithFifo.map(({ _key, ...rest }) => rest),
        subtotal,
        hpp_total: itemsWithFifo.reduce((s, i) => s + i.hpp_subtotal, 0),
        payment_method: paymentMethod,
        payment_type: 'FULL',
        dp_amount: 0,
        ongkir_amount: 0,
        total_amount: subtotal,
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        customer_company: customerCompany || undefined,
        invoice_number: invoiceNumber,
      };

      const saved = await kasirService.insertSaleTransaction(newTx);

      // Auto-save new customer if name + phone filled and not selected from existing list
      if (customerName.trim() && customerPhone.trim() && !selectedCustomerId) {
        try {
          await customersService.createCustomer(
            customerPhone.trim(),
            customerName.trim(),
            customerCompany.trim()
          );
        } catch {
          showToast('Transaksi disimpan, tapi gagal simpan data pelanggan.', 'warning');
        }
      }

      for (const item of items) {
        try {
          await stockService.decrementStock(item.sku, item.qty, warehouse);
        } catch {
          showToast(`Gagal kurangi stok ${item.name}.`, 'warning');
        }
      }

      onSaved(print ? saved : { ...saved, invoice_number: null });
    } catch {
      showToast('Gagal menyimpan transaksi.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-extrabold text-[#012749]">
              Catat Penjualan — {channel === 'walkin' ? 'Walk-in' : channel === 'tokopedia' ? 'Tokopedia' : 'Grosir'}
            </h3>
            <p className="text-xs text-gray-400">Pilih item dari stok</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-bold text-gray-500">Gudang:</span>
              <select
                value={warehouse}
                onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}
                className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              >
                <option value="atas">Gudang Atas</option>
                <option value="bawah">Gudang Bawah</option>
              </select>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Customer autocomplete */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Data Customer
            </label>
            {/* Search from existing customers */}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDrop(true); setSelectedCustomerId(null); }}
                onFocus={() => setShowCustomerDrop(true)}
                placeholder="Cari pelanggan tersimpan..."
                className="w-full bg-slate-50 rounded-xl pl-9 pr-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              />
              {showCustomerDrop && filteredCustomers.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
                  {filteredCustomers.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition-all border-b border-slate-50 last:border-0"
                      onClick={() => {
                        setCustomerName(c.name);
                        setCustomerPhone(c.wa_number ?? '');
                        setCustomerCompany(c.company ?? '');
                        setSelectedCustomerId(c.id);
                        setCustomerSearch('');
                        setShowCustomerDrop(false);
                      }}
                    >
                      <div className="text-xs font-bold text-slate-800">{c.name}</div>
                      <div className="text-[10px] text-gray-400">{c.company && `${c.company} · `}{c.wa_number}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Manual fields */}
            <input
              value={customerName}
              onChange={e => { setCustomerName(e.target.value); setSelectedCustomerId(null); }}
              placeholder="Nama customer *"
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e] mb-1.5"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                placeholder="No. HP / WA *"
                className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              />
              <input
                value={customerCompany}
                onChange={e => setCustomerCompany(e.target.value)}
                placeholder="Nama perusahaan..."
                className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              />
            </div>
            {customerName.trim() && customerPhone.trim() && !selectedCustomerId && (
              <p className="text-[10px] mt-1.5 pl-1 font-semibold text-emerald-600">
                ✓ Pelanggan baru akan otomatis disimpan ke menu Pelanggan
              </p>
            )}
          </div>

          {/* Item search */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Cari &amp; Tambah Item
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Ketik nama atau SKU..."
                className="w-full bg-white rounded-xl pl-9 pr-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              />
            </div>
            {search && (
              <div className="mt-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg max-h-44 overflow-y-auto">
                {filtered.length === 0 && (
                  <p className="text-xs text-gray-400 p-3 text-center">Tidak ditemukan.</p>
                )}
                {filtered.map(s => (
                  <button
                    key={s.sku}
                    onClick={() => addItem(s)}
                    className="w-full flex justify-between items-center px-3 py-2 hover:bg-blue-50 text-left border-b border-slate-50 last:border-0"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">{s.name}</div>
                      <div className="text-[10px] text-gray-400">{s.sku} · Stok: {s.stock}</div>
                    </div>
                    <span className="text-xs font-black text-[#2d8a4e]">{formatRp(s.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Item list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block">
                Item Dipilih
              </label>
              {items.map(item => (
                <div key={item._key} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{item.name}</div>
                    <div className="text-[10px] text-gray-400">{formatRp(item.unit_price)} /pcs</div>
                  </div>
                  <input
                    type="number" min="1" value={item.qty}
                    onChange={e => updateQty(item._key, Math.max(1, Number(e.target.value)))}
                    className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-center outline-none"
                  />
                  <span className="text-xs font-black text-[#2d8a4e] w-20 text-right">{formatRp(item.subtotal)}</span>
                  <button onClick={() => removeItem(item._key)} className="text-gray-300 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {isOwner && hppTotal > 0 && (
                <div className="text-[10px] text-violet-600 font-bold pl-1">
                  HPP total: {formatRp(hppTotal)}
                </div>
              )}
            </div>
          )}

          {/* Payment method */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Metode Pembayaran
            </label>
            <div className="flex gap-2">
              {(['cash', 'transfer', 'qris'] as KasirPaymentMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    paymentMethod === m
                      ? 'bg-[#012749] text-white border-[#012749]'
                      : 'bg-white text-gray-600 border-slate-200 hover:border-[#012749]'
                  }`}
                >
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-gray-500">Total</span>
            <span className="text-xl font-black text-[#012749]">{formatRp(subtotal)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-[#012749] hover:border-[#012749] transition-all disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Saja'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#012749] text-white hover:bg-[#1e3d60] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Simpan &amp; Cetak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ExpenseModal ────────────────────────────────────────────

interface ExpenseModalProps {
  selectedDate: string;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function ExpenseModal({ selectedDate, onClose, onSaved, showToast }: ExpenseModalProps) {
  const [category, setCategory] = useState<KasirExpenseCategory>('Utilitas');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(amount.replace(/\D/g, ''));
    if (!val || val <= 0) { showToast('Masukkan jumlah yang valid.', 'warning'); return; }
    if (!description.trim()) { showToast('Deskripsi wajib diisi.', 'warning'); return; }
    setSaving(true);
    try {
      await kasirService.insertExpense({
        date: selectedDate,
        expense_category: category,
        description: description.trim(),
        subtotal: val,
      });
      onSaved();
    } catch {
      showToast('Gagal menyimpan pengeluaran.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-[#012749]">Catat Pengeluaran</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Kategori</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as KasirExpenseCategory)}
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            >
              {EXPENSE_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Deskripsi</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contoh: Galon air x2, Bayar WiFi Indihome..."
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>

          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Jumlah (Rp)</label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-[#012749] text-white hover:bg-[#1e3d60] transition-all disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Pengeluaran'}
          </button>
        </div>
      </div>
    </div>
  );
}
