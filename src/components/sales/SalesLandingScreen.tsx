import { useEffect, useState } from 'react';
import { fetchDashboardStats, fetchActiveOrders } from '../../lib/sales/queries';
import type { SalesDashboardStats, Order } from '../../lib/sales/types';
import { navigate } from '../../lib/urlRoute';
import { StatsCards } from './StatsCards';
import { captureError } from '../../lib/captureError';
import { SalesTabStrip } from './SalesTabStrip';
import { UrgentOrdersPreview } from './UrgentOrdersPreview';

export function SalesLandingScreen() {
  const [stats, setStats] = useState<SalesDashboardStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setFetchError(null);
    fetchDashboardStats().then(setStats).catch(err => {
      captureError(err, { feature: 'sales_landing', action: 'fetch_dashboard_stats' });
      setFetchError('Gagal memuat data sales.');
    });
    fetchActiveOrders().then(setOrders).catch(err => captureError(err, { feature: 'sales_landing', action: 'fetch_active_orders' }));
  }, []);

  if (fetchError) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-red-600 mb-2">{fetchError}</p>
        <button
          onClick={() => { setFetchError(null); fetchDashboardStats().then(setStats).catch(err => { captureError(err, { feature: 'sales_landing', action: 'fetch_dashboard_stats' }); setFetchError('Gagal memuat data sales.'); }); }}
          className="text-xs font-bold text-[var(--color-caleo-primary)] underline"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!stats) {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }

  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Operasional</div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--color-primary)', letterSpacing: '-0.02em' }}>Sales</h1>
          <p className="text-sm text-gray-600 mt-1">{today}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button onClick={() => navigate('penjualanBaru')}
          className="border-2 border-[var(--color-caleo-primary)] bg-[var(--color-caleo-primary)]/5 rounded p-6 text-left hover:bg-[var(--color-caleo-primary)]/10 transition">
          <div className="text-3xl mb-2">🧾</div>
          <div className="text-base font-extrabold text-[var(--color-caleo-primary)]">+ Sales Invoice</div>
          <div className="text-xs text-slate-600 mt-1">
            Catat penjualan yang sudah commit — customer bayar sekarang (LUNAS / DP) atau TEMPO. Stok bergerak, invoice resmi keluar.
          </div>
        </button>
        <button onClick={() => navigate('penjualanBaru', { mode: 'quote' })}
          className="border-2 border-amber-400 bg-amber-50 rounded p-6 text-left hover:bg-amber-100 transition">
          <div className="text-3xl mb-2">📄</div>
          <div className="text-base font-extrabold text-amber-800">+ Sales Order</div>
          <div className="text-xs text-amber-700 mt-1">
            Bikin penawaran ke customer. Belum commit, tidak ada payment method, stok tidak bergerak. Kalau customer accept → lanjut jadi Sales Invoice.
          </div>
        </button>
      </div>
      <StatsCards stats={stats} />
      <SalesTabStrip activeCount={orders.length} />
      <UrgentOrdersPreview orders={orders} />
    </div>
  );
}
