import type { Order } from '../../lib/sales/types';
import type { TypeTab } from '../../lib/sales/typeTabConfig';
import type { SubStageMeta } from '../../lib/sales/stageMapping';
import { OrderRow } from './OrderRow';
import { ActionPanel } from './ActionPanel';

interface Props {
  sub: SubStageMeta;
  orders: Order[];
  expanded: boolean;
  expandedRowId: string | null;
  typeTab: TypeTab;
  onToggleSection: () => void;
  onToggleRow: (id: string) => void;
  onQuickAction: (order: Order, toSubStage: string) => void;
  onOpenProof: (order: Order) => void;
  onUploadProof: (order: Order) => void;
}

export function SubStageSection({ sub, orders, expanded, expandedRowId, typeTab, onToggleSection, onToggleRow, onQuickAction, onOpenProof, onUploadProof }: Props) {
  const isUrgent = sub.actionType === 'urgent';
  const totalRp = orders.reduce((acc, o) => acc + o.total, 0);

  return (
    <>
      <div
        onClick={onToggleSection}
        style={{
          padding: '14px 24px',
          cursor: 'pointer',
          background: isUrgent ? 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)' : 'white',
          borderBottom: '1px solid #e5eeff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ color: isUrgent ? '#92400e' : '#6b7280', fontSize: 11, width: 14 }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontSize: 13, fontWeight: isUrgent ? 700 : 600, color: 'var(--color-primary)' }}>{sub.name}</span>
          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>· {orders.length}</span>
          {isUrgent && (
            <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 10 }}>
              Perlu Kerjakan
            </span>
          )}
          {totalRp > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-secondary)', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>
              Rp {(totalRp / 1000).toLocaleString('id-ID', { maximumFractionDigits: 0 })}K
            </span>
          )}
        </div>
      </div>
      {expanded && (
        orders.length === 0
          ? <div style={{ padding: '20px 24px', textAlign: 'center', color: '#9ca3af', fontSize: 12, fontStyle: 'italic', background: '#fafbff' }}>Kosong 🎉</div>
          : orders.map(o => (
            <div key={o.id}>
              <OrderRow
                order={o}
                expanded={expandedRowId === o.id}
                typeTab={typeTab}
                onToggle={() => onToggleRow(o.id)}
                onQuickAction={(_label, toSubStage) => onQuickAction(o, toSubStage)}
              />
              {expandedRowId === o.id && (
                <ActionPanel
                  order={o}
                  onOpenProof={() => onOpenProof(o)}
                  onUploadProof={() => onUploadProof(o)}
                />
              )}
            </div>
          ))
      )}
    </>
  );
}
