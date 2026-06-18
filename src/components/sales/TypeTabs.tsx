import { TYPE_TAB_CFG, type TypeTab } from '../../lib/sales/typeTabConfig';

interface Props {
  active: TypeTab;
  counts: Record<TypeTab, number>;
  onChange: (tab: TypeTab) => void;
}

export function TypeTabs({ active, counts, onChange }: Props) {
  return (
    <div style={{ background: 'linear-gradient(180deg, #ffffff 0%, #fafbff 100%)', padding: '20px 24px 0', borderBottom: '1px solid #e5eeff' }}>
      <div style={{ display: 'flex', gap: 32 }}>
        {(Object.entries(TYPE_TAB_CFG) as [TypeTab, typeof TYPE_TAB_CFG[TypeTab]][]).map(([key, cfg]) => {
          const isSel = key === active;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              style={{
                background: 'transparent',
                padding: '10px 0 14px',
                fontSize: 15,
                cursor: 'pointer',
                color: isSel ? 'var(--color-primary)' : '#6b7280',
                fontWeight: isSel ? 700 : 600,
                borderBottom: isSel ? '3px solid var(--color-primary)' : '3px solid transparent',
                border: 'none',
                borderRadius: 0,
              }}
            >
              {cfg.label}
              <span style={{ fontSize: 12, color: isSel ? 'var(--color-secondary)' : '#9ca3af', fontWeight: 700, marginLeft: 4 }}>· {counts[key]}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', padding: '8px 0 16px', minHeight: 30, fontStyle: 'italic' }}>
        {TYPE_TAB_CFG[active].hint}
      </div>
    </div>
  );
}
