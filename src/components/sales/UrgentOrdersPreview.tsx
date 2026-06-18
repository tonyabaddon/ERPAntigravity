import type { Order } from '../../lib/sales/types';
import { SUB_STAGES } from '../../lib/sales/stageMapping';
import { navigate } from '../../lib/urlRoute';

interface Props { orders: Order[]; }

export function UrgentOrdersPreview({ orders }: Props) {
  // Defensive lookup: skip orders with unknown sub-stages instead of throwing
  const urgent = orders
    .filter(o => SUB_STAGES.find(s => s.id === o.funnel_sub_stage)?.actionType === 'urgent')
    .slice(0, 3);

  return (
    <div style={{ background: 'white', border: '1px solid #e5eeff', borderRadius: 20, boxShadow: '0 2px 12px rgba(1,39,73,0.06)', overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', padding: '12px 20px', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>⚡ Perlu Kerjakan Sekarang · {urgent.length}</span>
        <button onClick={() => navigate('daftarPesanan')} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-primary)', fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}>Lihat semua →</button>
      </div>
      {urgent.map(o => (
        <div key={o.id} style={{ padding: '14px 20px', borderBottom: '1px solid #e5eeff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: 14 }}>{o.customer}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{o.channel} · {SUB_STAGES.find(s => s.id === o.funnel_sub_stage)?.name ?? o.funnel_sub_stage}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-secondary)', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>Rp {o.total.toLocaleString('id-ID')}</div>
        </div>
      ))}
      {urgent.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>🎉 Semua sudah dikerjakan!</div>
      )}
    </div>
  );
}
