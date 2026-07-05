// src/components/admin/RecentActivityFeed.tsx
// Renders last N audit events. When empty, shows "Belum ada aktivitas" state.
import type { AuditEventRow } from '../../lib/adminTypes';

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  const days = Math.floor(hrs / 24);
  return `${days}h lalu`;
}

interface Props {
  events: AuditEventRow[];
}

export function RecentActivityFeed({ events }: Props) {
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
      {/* Header */}
      <div
        className="px-4 py-2 text-[12px] font-bold uppercase tracking-widest"
        style={{
          background: '#FAF7F0',
          color: '#9DB2CE',
          fontFamily: 'JetBrains Mono, monospace',
          borderBottom: '1px solid #ECEEF1',
        }}
      >
        Aktivitas terbaru
      </div>

      {events.length === 0 ? (
        <div
          className="px-4 py-4 text-[13px]"
          style={{ color: '#9DB2CE' }}
          data-testid="activity-feed-empty"
        >
          Belum ada aktivitas
        </div>
      ) : (
        <div>
          {events.map((e) => (
            <div
              key={e.id}
              className="px-4 py-2.5 flex items-start gap-3 text-[13px]"
              style={{ borderBottom: '1px solid #ECEEF1' }}
            >
              {/* Timestamp badge */}
              <span
                className="shrink-0 text-[11px] font-mono pt-0.5"
                style={{ color: '#9DB2CE', minWidth: '55px' }}
              >
                {relativeTime(e.ts)}
              </span>
              {/* Actor + action */}
              <div style={{ color: '#5A6472' }}>
                <span className="font-medium" style={{ color: '#0B2545' }}>
                  {e.admin_email ?? 'system'}
                </span>
                <span> · </span>
                <span className="font-mono text-[12px]" style={{ color: '#5A6472' }}>
                  {e.action_code}
                </span>
                {e.tenant_slug && (
                  <>
                    <span style={{ color: '#9DB2CE' }}> on </span>
                    <span className="font-mono font-semibold" style={{ color: '#0B2545' }}>
                      {e.tenant_slug}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
