import React, { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService, supplierService } from '../lib/pembelianService';
import type { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type Tab = 'orders' | 'suppliers';

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function PembelianScreen({ stockList, showToast }: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 });
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    try {
      const [ords, sups, sum] = await Promise.all([
        purchaseOrderService.fetchAll(),
        supplierService.fetchAll(),
        purchaseOrderService.fetchSummary(),
      ]);
      setOrders(ords);
      setSuppliers(sups);
      setSummary(sum);
    } catch {
      showToast('Gagal memuat data pembelian.', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <ShoppingCart className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Pembelian</h1>
          <p className="text-xs text-gray-500">Manajemen Supplier & Purchase Order</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatRupiah(summary.totalMtd)}</p>
            <p className="text-xs text-gray-400 mt-1">{summary.countMtd} purchase order</p>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4">
            <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Jatuh Tempo Bulan Ini</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{formatRupiah(summary.dueMtd)}</p>
            <p className="text-xs text-amber-400 mt-1">belum dibayar, jatuh tempo bulan ini</p>
          </div>
          <div className="bg-white rounded-xl border border-rose-200 p-4">
            <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Total Belum Dibayar</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.totalUnpaid)}</p>
            <p className="text-xs text-rose-400 mt-1">semua PO outstanding</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Jumlah PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.countMtd}</p>
            <p className="text-xs text-gray-400 mt-1">purchase order dibuat</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setTab('orders')}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px ${tab === 'orders' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => setTab('suppliers')}
            className={`px-4 py-2.5 text-sm font-medium -mb-px ${tab === 'suppliers' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Supplier
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">Memuat data...</div>
        ) : tab === 'orders' ? (
          <OrdersTab
            orders={orders}
            suppliers={suppliers}
            stockList={stockList}
            showToast={showToast}
            onRefresh={reload}
          />
        ) : (
          <SuppliersTab
            suppliers={suppliers}
            showToast={showToast}
            onRefresh={reload}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder sub-components — implemented in Tasks 6 and 7
function OrdersTab(_props: any) { return <div className="text-sm text-gray-400">Orders tab — coming in Task 7</div>; }
function SuppliersTab(_props: any) { return <div className="text-sm text-gray-400">Suppliers tab — coming in Task 6</div>; }
