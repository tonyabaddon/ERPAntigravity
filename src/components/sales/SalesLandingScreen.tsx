import { useEffect, useState } from 'react';
import { fetchDashboardStats, fetchActiveOrders } from '../../lib/sales/queries';
import type { SalesDashboardStats, Order } from '../../lib/sales/types';
import { StatsCards } from './StatsCards';
import { SalesTabStrip } from './SalesTabStrip';
import { UrgentOrdersPreview } from './UrgentOrdersPreview';

export function SalesLandingScreen() {
  const [stats, setStats] = useState<SalesDashboardStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    fetchDashboardStats().then(setStats).catch(err => console.error('fetchDashboardStats failed', err));
    fetchActiveOrders().then(setOrders).catch(err => console.error('fetchActiveOrders failed', err));
  }, []);

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
      <StatsCards stats={stats} />
      <SalesTabStrip activeCount={orders.length} />
      <UrgentOrdersPreview orders={orders} />
    </div>
  );
}
