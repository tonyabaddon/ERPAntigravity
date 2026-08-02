import type { Order } from '../../lib/sales/types';
import type { TypeTab } from '../../lib/sales/typeTabConfig';
import type { SubStageMeta } from '../../lib/sales/stageMapping';
import type { StoreSettings, BankAccount } from '../../lib/pengaturan/types';
import { OrderRow } from './OrderRow';
import { ActionPanel } from './ActionPanel';

interface Props {
  sub: SubStageMeta;
  orders: Order[];
  expanded: boolean;
  expandedRowId: string | null;
  typeTab: TypeTab;
  settings: StoreSettings | null;
  banks: BankAccount[] | null;
  onToggleSection: () => void;
  onToggleRow: (id: string) => void;
  onQuickAction: (order: Order, toSubStage: string) => void;
  onOpenProof: (order: Order) => void;
  onUploadProof: (order: Order) => void;
  onEdit: (order: Order) => void;
  onReject: (order: Order) => void;
  onReopen: (order: Order) => void;
  onMarkProblem: (order: Order) => void;
  onResolveContinue: (order: Order) => void;
  onResolveReceived: (order: Order) => void;
  onCancelOrder: (order: Order) => void;
  /** Admin self-withdraw at 3g for CP/RP orders with a pending approval. */
  onWithdrawRakitLock: (order: Order) => void;
  /**
   * Map of order_id → recent rakit_lock_rejected info. Threaded to OrderRow
   * so 3f rows can render a ⚠️ Owner reject-reason chip. Structural type
   * (not RejectInfo) to keep this leaf component free of audit_log imports.
   */
  rejectInfoMap?: Record<string, { reason: string; rejected_at: string }>;
}

export function SubStageSection({
  sub, orders, expanded, expandedRowId, typeTab, settings, banks,
  onToggleSection, onToggleRow, onQuickAction, onOpenProof, onUploadProof, onEdit,
  onReject, onReopen, onMarkProblem, onResolveContinue, onResolveReceived, onCancelOrder,
  onWithdrawRakitLock, rejectInfoMap,
}: Props) {
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
          borderBottom: '1px solid var(--color-caleo-mist)',
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
                rejectInfoMap={rejectInfoMap}
              />
              {expandedRowId === o.id && (
                <ActionPanel
                  order={o}
                  settings={settings}
                  banks={banks}
                  onOpenProof={() => onOpenProof(o)}
                  onUploadProof={() => onUploadProof(o)}
                  onEdit={() => onEdit(o)}
                  onReject={() => onReject(o)}
                  onReopen={() => onReopen(o)}
                  onMarkProblem={() => onMarkProblem(o)}
                  onResolveContinue={() => onResolveContinue(o)}
                  onResolveReceived={() => onResolveReceived(o)}
                  onCancelOrder={() => onCancelOrder(o)}
                  onWithdrawRakitLock={() => onWithdrawRakitLock(o)}
                />
              )}
            </div>
          ))
      )}
    </>
  );
}
