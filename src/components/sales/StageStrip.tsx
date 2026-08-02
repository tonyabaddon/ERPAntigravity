import { STAGE_NAMES } from '../../lib/sales/stageMapping';
import type { FunnelStage } from '../../lib/sales/types';

interface Props {
  active: FunnelStage;
  counts: Record<FunnelStage, number>;
  onChange: (stage: FunnelStage) => void;
}

export function StageStrip({ active, counts, onChange }: Props) {
  return (
    <div style={{ background: 'white', borderBottom: '1px solid var(--color-caleo-mist)', display: 'flex', gap: 6, padding: '14px 24px', overflowX: 'auto' }}>
      {([1, 2, 3, 4, 5, 6] as FunnelStage[]).map(n => {
        const count = counts[n] ?? 0;
        const isSel = n === active;
        return (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              background: isSel ? 'var(--color-primary)' : 'white',
              color: isSel ? 'white' : (count > 0 ? 'var(--color-primary)' : '#6b7280'),
              border: `1px solid ${isSel ? 'transparent' : (count > 0 ? 'var(--color-caleo-mist-dark)' : '#d1d5db')}`,
              boxShadow: isSel ? '0 2px 8px rgba(30,61,96,0.2)' : 'none',
              opacity: 1,
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>{STAGE_NAMES[n].icon}</span>
            <span>{n}. {STAGE_NAMES[n].name}</span>
            <span style={{
              background: isSel ? 'rgba(255,255,255,0.2)' : 'var(--color-caleo-cloud)',
              color: isSel ? 'white' : 'var(--color-primary)',
              padding: '1px 6px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
            }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
