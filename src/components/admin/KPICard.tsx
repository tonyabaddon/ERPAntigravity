// src/components/admin/KPICard.tsx
// Reusable KPI metric card — VOSI Design System palette.
// Value displayed in JetBrains Mono (font-mono). Label uppercase tracking-widest.

interface KPICardProps {
  title: string;
  value: number | null;
  subtitle?: string;
  alert?: boolean;
  placeholder?: string;
}

export function KPICard({ title, value, subtitle, alert, placeholder }: KPICardProps) {
  return (
    <div
      className={`border rounded-xl p-4 ${
        alert ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
      }`}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-widest mb-1"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          color: alert ? '#92400e' : '#9DB2CE',
        }}
      >
        {title}
      </div>
      <div
        className="text-[26px] font-bold leading-none"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          color: value === null ? '#9DB2CE' : alert ? '#92400e' : '#0B2545',
        }}
      >
        {value === null ? '—' : value.toString()}
      </div>
      {subtitle && (
        <div className="text-[11px] mt-1" style={{ color: '#9DB2CE' }}>
          {subtitle}
        </div>
      )}
      {value === null && placeholder && (
        <div className="text-[11px] mt-1" style={{ color: '#9DB2CE' }}>
          {placeholder}
        </div>
      )}
    </div>
  );
}
