import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Package, DollarSign,
  Printer, X, Search, Lock
} from 'lucide-react';
import {
  KasirTransaction, KasirChannel, KasirPaymentMethod,
  KasirItem, DailySummary, PermissionSet, DbOrder, SalesChannel
} from '../types';
import {
  kasirService, stockService, customersService, orderService, isSupabaseConfigured,
} from '../lib/supabaseClient';
import { CHANNEL_GROUPS, CHANNEL_VISUAL } from '../lib/salesChannels';
import type { SupabaseStockItem } from '../lib/supabaseClient';
import type { DbCustomerWithStats } from '../types';
import { formatRp } from '../lib/format';
import KasirInvoiceModal from './KasirInvoiceModal';
import MarkLunasModal from './penjualan/MarkLunasModal';
import SalesInvoicePDF from './penjualan/SalesInvoicePDF';
import CariByFotoModal from './kasir/CariByFotoModal';
import HasilCariFotoModal from './kasir/HasilCariFotoModal';
import type { SearchResult } from '../lib/cariByFotoService';
import { useKasirExpenseCategories } from '../lib/hooks/useKasirExpenseCategories';

interface KasirScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  // Optional channel selects which strip is pre-filled on PenjualanBaruScreen.
  // Omitted → default walkin (e.g. the green header quick-action button).
  // Optional prefillSku auto-adds that SKU to the cart on mount (Cari by Foto).
  onOpenPenjualanBaru?: (channel?: KasirChannel, prefillSku?: string) => void;
}

// ─── helpers ─────────────────────────────────────────────────

const PAYMENT_LABEL: Record<KasirPaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  edc: 'EDC',
};


function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// ─── Sub-components ──────────────────────────────────────────

function ChannelPill({ channel }: { channel: KasirChannel }) {
  const def = CHANNEL_VISUAL[channel];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${def.bgClass} ${def.textClass}`}>
      {def.label}
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
    navy: 'bg-[var(--color-caleo-primary)] border-[var(--color-caleo-primary)]',
  };
  const topBar = {
    green: 'from-[#2d8a4e] to-emerald-400',
    red: 'from-red-600 to-red-400',
    amber: 'from-amber-600 to-amber-400',
    navy: 'from-[var(--color-caleo-primary)] to-[#1e3d60]',
  };
  const textColor = color === 'navy' ? 'text-white' : 'text-[var(--color-caleo-primary)]';
  const subColor = color === 'navy' ? 'text-white/50' : 'text-gray-400';
  const labelColor = color === 'navy' ? 'text-white/50' : 'text-gray-500';

  if (locked) {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-sm p-5 flex flex-col items-center justify-center gap-1">
        <Lock className="w-5 h-5 text-gray-300" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-300">{label}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-sm p-5 border relative overflow-hidden ${colorMap[color]}`}>
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

export default function KasirScreen({ currentUser, showToast, onOpenPenjualanBaru }: KasirScreenProps) {
  const isOwner = currentUser?.role?.toLowerCase() === 'owner';
  // Cari by Foto (Plan C)
  const [isFotoOpen, setIsFotoOpen] = useState(false);
  const [isHasilOpen, setIsHasilOpen] = useState(false);
  const [fotoResults, setFotoResults] = useState<SearchResult[]>([]);
  const [queryBlobUrl, setQueryBlobUrl] = useState<string | null>(null);
  const [queryFilename, setQueryFilename] = useState<string | null>(null);
  const handleFotoResults = (rs: SearchResult[], blob: Blob, filename?: string) => {
    setFotoResults(rs);
    if (queryBlobUrl) URL.revokeObjectURL(queryBlobUrl);
    setQueryBlobUrl(URL.createObjectURL(blob));
    setQueryFilename(filename ?? null);
    setIsHasilOpen(true);
  };
  const handleAddToCartFromFoto = (r: SearchResult) => {
    if (queryBlobUrl) { URL.revokeObjectURL(queryBlobUrl); setQueryBlobUrl(null); }
    setIsHasilOpen(false);
    setIsFotoOpen(false);
    onOpenPenjualanBaru?.(undefined, r.sku);
  };

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
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [printTx, setPrintTx] = useState<KasirTransaction | null>(null);
  const [markLunasTx, setMarkLunasTx] = useState<KasirTransaction | null>(null);
  const [lunasInvoice, setLunasInvoice] = useState<KasirTransaction | null>(null);

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
    if (filter === 'online') return e._src === 'kasir' && (
      CHANNEL_GROUPS.marketplace.includes(e.tx!.channel as SalesChannel) ||
      CHANNEL_GROUPS.direct.includes(e.tx!.channel as SalesChannel)
    );
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
          <h2 className="text-xl font-black text-[var(--color-caleo-primary)] tracking-tight">Kasir Harian</h2>
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
              className="bg-white border border-[#e5eeff] rounded-sm px-3 py-2 text-xs font-semibold text-[var(--color-caleo-primary)] outline-none focus:ring-1 focus:ring-[var(--color-caleo-primary)]"
            />
          )}
          {isOwner && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white border border-[#e5eeff] text-[var(--color-caleo-primary)] hover:border-[var(--color-caleo-primary)] transition-all"
            >
              <Printer className="w-3.5 h-3.5" /> Cetak Laporan
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsFotoOpen(true)}
            className="px-4 py-2 bg-gradient-to-br from-[#2d8a4e] to-emerald-700 text-white rounded-full text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 shadow-lg"
          >
            <span className="material-symbols-outlined text-base">photo_camera</span> Cari by Foto [AI]
          </button>
          <button
            type="button"
            onClick={() => onOpenPenjualanBaru?.()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#2d8a4e] text-white font-extrabold text-[13px] rounded-sm hover:bg-green-700"
          >
            📋 Catat Penjualan
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
                <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Log Transaksi</h3>
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
                    filter === key ? 'bg-[var(--color-caleo-primary)] text-white' : 'bg-slate-50 text-gray-500 hover:text-[var(--color-caleo-primary)]'
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
                  <div key={`wa-${o.id}`} className="flex items-center gap-3 p-3 rounded-sm border border-slate-100 bg-slate-50/50 hover:bg-emerald-50/30 transition-all">
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
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-sm flex-shrink-0">
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
                <div key={`tx-${tx.id}`} className="flex items-center gap-3 p-3 rounded-sm border border-slate-100 bg-slate-50/50 hover:bg-blue-50/20 transition-all">
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
                    {tx.status === 'AWAITING_LUNAS' && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-700 border border-amber-300">
                          💰 Belum Lunas {formatRp((tx.total_amount ?? tx.subtotal) - (tx.dp_amount ?? 0))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setMarkLunasTx(tx)}
                          className="px-2 py-0.5 rounded-sm text-[10px] font-extrabold bg-amber-500 text-white hover:bg-amber-600"
                        >
                          Tandai Lunas
                        </button>
                      </div>
                    )}
                  </div>
                  {isOwner && isIncome && tx.hpp_total > 0 && (
                    <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-sm flex-shrink-0">
                      HPP {formatRp(tx.hpp_total)}
                    </span>
                  )}
                  <span className={`text-sm font-black flex-shrink-0 ${isIncome ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isIncome ? '+' : '−'}{formatRp(tx.subtotal)}
                  </span>
                  {isIncome && tx.invoice_number && (
                    <button
                      onClick={() => setPrintTx(tx)}
                      className="p-1.5 rounded-sm hover:bg-slate-100 text-gray-400 hover:text-[var(--color-caleo-primary)] transition-all flex-shrink-0"
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
            <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)] mb-1">Catat Transaksi</h3>
            <p className="text-[10px] text-gray-400 mb-4">Pilih jenis transaksi</p>

            <div className="bg-emerald-50 border border-emerald-200 rounded-sm px-4 py-3 flex items-start gap-2.5 mb-4">
              <span className="w-2 h-2 mt-1 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-emerald-800">WA Orders — Auto-Sync</div>
                <div className="text-[10px] text-emerald-600">Order terverifikasi otomatis masuk</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={() => setShowExpenseModal(true)}
                className="flex flex-col items-center justify-center p-4 rounded-sm border-2 bg-red-50 border-red-200 text-red-700 hover:bg-red-100 transition-all hover:scale-[1.02] text-center"
              >
                <span className="text-xl mb-1">📤</span>
                <span className="text-[11px] font-black uppercase tracking-wide">Pengeluaran</span>
              </button>
            </div>
          </div>

          {/* Payment method breakdown — visible to all, for cash drawer check */}
          {!loading && summary && (
            <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl p-5">
              <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)] mb-0.5">Rekap Pembayaran</h3>
              <p className="text-[10px] text-gray-400 mb-3">Cek laci kas & rekening</p>
              <div className="space-y-2">
                {([
                  { key: 'cash', label: '💵 Tunai (Laci Kas)', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                  { key: 'transfer', label: '🏦 Transfer', color: 'text-blue-700 bg-blue-50 border-blue-200' },
                  { key: 'qris', label: '📲 QRIS', color: 'text-violet-700 bg-violet-50 border-violet-200' },
                ] as const).map(({ key, label, color }) => {
                  const val = summary.byPaymentMethod[key] ?? 0;
                  return (
                    <div key={key} className={`flex items-center justify-between px-3 py-2 rounded-sm border ${color}`}>
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
                <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)] mb-1">Tutup Buku Harian</h3>
                <p className="text-[10px] text-gray-400 mb-4">Ringkasan &amp; cetak laporan</p>
              </div>
              <div className="mx-5 mb-5 bg-gradient-to-br from-[var(--color-caleo-primary)] to-[#1e3d60] rounded-sm p-4 text-white">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-3">
                  Rekap {new Date(selectedDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {(Object.entries(summary.byChannel) as [string, number][]).filter(([, v]) => v > 0).map(([ch, val]) => (
                  <div key={ch} className="flex justify-between items-center mb-1.5">
                    <span className="text-xs opacity-70 capitalize">{ch === 'wa_order' ? 'WA Orders' : (CHANNEL_VISUAL[ch as KasirChannel]?.label ?? ch)}</span>
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
                  className="mt-3 w-full py-2 rounded-sm bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-wide hover:bg-white/20 transition-all"
                >
                  🖨️ Cetak Laporan Harian
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
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
      {markLunasTx && (
        <MarkLunasModal
          transaction={markLunasTx}
          showToast={showToast}
          onClose={() => setMarkLunasTx(null)}
          onMarked={(updated) => {
            setMarkLunasTx(null);
            setLunasInvoice(updated);
            // Refresh tx list
            loadData();
          }}
        />
      )}
      {lunasInvoice && (
        <SalesInvoicePDF
          transaction={lunasInvoice}
          variant="lunas"
          adminName={currentUser?.name}
          autoPrint
          onClose={() => setLunasInvoice(null)}
        />
      )}
      <CariByFotoModal
        isOpen={isFotoOpen}
        onClose={() => setIsFotoOpen(false)}
        onResults={handleFotoResults}
        showToast={showToast}
      />
      <HasilCariFotoModal
        isOpen={isHasilOpen}
        onClose={() => {
          setIsHasilOpen(false);
          if (queryBlobUrl) { URL.revokeObjectURL(queryBlobUrl); setQueryBlobUrl(null); }
        }}
        results={fotoResults}
        queryBlobUrl={queryBlobUrl}
        queryFilename={queryFilename}
        onChangePhoto={() => { setIsHasilOpen(false); setIsFotoOpen(true); }}
        onAddToCart={handleAddToCartFromFoto}
      />
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
  const { data: categories, isLoading, isError, refetch } = useKasirExpenseCategories();
  const activeCategories = useMemo(
    () => (categories ?? []).filter(c => c.active),
    [categories]
  );

  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!category && activeCategories.length > 0) {
      setCategory(activeCategories[0].label);
    }
  }, [activeCategories, category]);

  const canSave = !saving && !isLoading && !isError && activeCategories.length > 0 && Boolean(category);

  async function handleSave() {
    const val = parseFloat(amount.replace(/\D/g, ''));
    if (!val || val <= 0) { showToast('Masukkan jumlah yang valid.', 'warning'); return; }
    if (!description.trim()) { showToast('Deskripsi wajib diisi.', 'warning'); return; }
    if (!category) { showToast('Pilih kategori.', 'warning'); return; }
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
      <div className="bg-white rounded-sm shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Catat Pengeluaran</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Kategori</label>
            {isError ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 text-xs text-red-600">Gagal memuat kategori.</div>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="text-xs font-bold text-[var(--color-caleo-primary)] underline"
                >
                  Coba lagi
                </button>
              </div>
            ) : (
              <select
                aria-label="Kategori"
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={isLoading || activeCategories.length === 0}
                className="w-full bg-white rounded-sm px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e] disabled:opacity-50"
              >
                {isLoading && <option>Memuat kategori...</option>}
                {!isLoading && activeCategories.length === 0 && (
                  <option>Tidak ada kategori aktif — atur di Pengaturan</option>
                )}
                {!isLoading && activeCategories.map(c => (
                  <option key={c.id} value={c.label}>{c.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Deskripsi</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contoh: Galon air x2, Bayar WiFi Indihome..."
              className="w-full bg-white rounded-sm px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
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
              className="w-full bg-white rounded-sm px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>
        </div>

        <div className="px-4 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-2.5 rounded-sm text-xs font-bold bg-[var(--color-caleo-primary)] text-white hover:bg-[#1e3d60] transition-all disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Pengeluaran'}
          </button>
        </div>
      </div>
    </div>
  );
}
