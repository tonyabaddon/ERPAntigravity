interface Props { label: string; onClick: () => void; }

export function QuickActionPill({ label, onClick }: Props) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        color: 'white',
        background: 'var(--color-primary)',
        fontSize: 12,
        fontWeight: 700,
        padding: '5px 12px',
        borderRadius: 999,
        border: 'none',
        boxShadow: '0 1px 3px rgba(30,61,96,0.2)',
        cursor: 'pointer',
      }}
    >{label}</button>
  );
}
