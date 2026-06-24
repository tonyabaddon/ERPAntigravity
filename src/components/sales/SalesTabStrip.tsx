import { navigate } from '../../lib/urlRoute';

interface Props { activeCount: number; }

export function SalesTabStrip({ activeCount }: Props) {
  return (
    <div className="flex items-end gap-1 border-b mb-5" style={{ borderColor: '#e5eeff' }}>
      <button onClick={() => navigate('penjualanBaru')} className="px-5 py-3 text-sm font-bold transition flex items-center gap-2" style={{ color: '#6b7280', borderBottom: '3px solid transparent', background: 'transparent' }}>
        📝 Sales Invoice
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>→ wizard</span>
      </button>
      <button onClick={() => navigate('daftarPesanan')} className="px-5 py-3 text-sm font-bold transition flex items-center gap-2" style={{ color: 'var(--color-primary)', borderBottom: '3px solid var(--color-primary)', background: 'transparent', marginBottom: '-1px' }}>
        📦 Daftar Pesanan
        <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, border: '1px solid #fde68a' }}>{activeCount} aktif</span>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>→ funnel</span>
      </button>
    </div>
  );
}
