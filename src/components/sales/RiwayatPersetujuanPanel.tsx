import { useEffect, useState } from 'react';
import { fetchRakitLockHistory, type RakitLockHistoryEvent } from '../../lib/sales/queries';

interface Props {
  orderId: string;
}

const TYPE_LABEL: Record<RakitLockHistoryEvent['type'], { emoji: string; label: string }> = {
  requested: { emoji: '📩', label: 'Admin submit' },
  approved: { emoji: '✓', label: 'Owner approve' },
  approved_with_edit: { emoji: '✏️', label: 'Owner approve dengan edit' },
  rejected: { emoji: '✗', label: 'Owner reject' },
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function RiwayatPersetujuanPanel({ orderId }: Props) {
  const [events, setEvents] = useState<RakitLockHistoryEvent[] | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchRakitLockHistory(orderId).then(setEvents);
  }, [orderId]);

  if (events === null) {
    return <div style={{ fontSize: 12, color: '#6b7280' }}>Memuat riwayat…</div>;
  }
  if (events.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        fontSize: 11, color: '#6b7280', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
      }}>
        Riwayat Persetujuan
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map((ev, i) => {
          const meta = TYPE_LABEL[ev.type];
          const isExpandable = ev.type === 'approved_with_edit' || ev.type === 'rejected';
          const isExpanded = expandedIdx === i;
          return (
            <div key={i} style={{
              background: 'white', borderRadius: 8, border: '1px solid #e5eeff',
              padding: 8, fontSize: 12,
            }}>
              <div
                onClick={() => isExpandable && setExpandedIdx(isExpanded ? null : i)}
                style={{
                  display: 'flex', alignItems: 'center',
                  cursor: isExpandable ? 'pointer' : 'default',
                }}
              >
                <span style={{ marginRight: 8 }}>{meta.emoji}</span>
                <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{meta.label}</span>
                <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{fmt(ev.created_at)}</span>
                {isExpandable && (
                  <span style={{ marginLeft: 8, color: '#9ca3af' }}>{isExpanded ? '▾' : '▸'}</span>
                )}
              </div>
              {isExpanded && ev.type === 'approved_with_edit' && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#374151' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Field yang diedit:</div>
                  <div>{ev.diff_keys.length === 0 ? '(tidak ada perubahan tercatat)' : ev.diff_keys.join(', ')}</div>
                </div>
              )}
              {isExpanded && ev.type === 'rejected' && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>
                  Alasan: {ev.reason || '(tidak ada alasan)'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
