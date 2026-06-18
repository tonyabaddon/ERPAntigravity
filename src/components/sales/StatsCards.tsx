import { formatJuta } from '../../lib/sales/format';
import type { SalesDashboardStats } from '../../lib/sales/types';

interface Props { stats: SalesDashboardStats; }

export function StatsCards({ stats }: Props) {
  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      <div style={{ background: 'white', border: '1px solid #fde68a', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(146,64,14,0.06)' }}>
        <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚡ Perlu Kerjakan</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.urgent_count}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>pesanan urgent</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #c7d7f5', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(1,39,73,0.06)' }}>
        <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⏳ Tunggu Customer</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.tunggu_count}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>aktif passive</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #c7d7f5', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(1,39,73,0.06)' }}>
        <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>💰 Revenue Pending</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-secondary)', marginTop: 4, lineHeight: 1, fontFamily: 'ui-monospace,monospace', letterSpacing: '-0.02em' }}>{formatJuta(stats.revenue_pending)}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>belum dilunasi</div>
      </div>
      <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 8px rgba(22,101,52,0.06)' }}>
        <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>✓ Selesai Bulan Ini</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginTop: 2, lineHeight: 1, letterSpacing: '-0.02em' }}>{stats.completed_this_month}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>{formatJuta(stats.revenue_this_month)} total</div>
      </div>
    </div>
  );
}
