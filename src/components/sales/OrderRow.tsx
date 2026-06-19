import type { Order, PaymentType } from '../../lib/sales/types';
import type { TypeTab } from '../../lib/sales/typeTabConfig';
import { getQuickAction } from '../../lib/sales/quickActionMap';
import { QuickActionPill } from './QuickActionPill';

interface Props {
  order: Order;
  expanded: boolean;
  typeTab: TypeTab;
  onToggle: () => void;
  onQuickAction: (label: string, toSubStage: string) => void;
  /**
   * Map of order_id → recent rakit_lock_rejected info. When present and
   * matching the current row's order at sub-stage 3f, OrderRow renders a
   * ⚠️ Owner reject-reason chip next to the customer name. Structural type
   * (no audit_log dependency) — populated by DaftarPesananScreen via
   * fetchRecentRejectsByOrder.
   */
  rejectInfoMap?: Record<string, { reason: string; rejected_at: string }>;
}

const CHANNEL_DISPLAY: Record<string, { icon: string; label: string }> = {
  WhatsApp: { icon: '📱', label: 'WA' },
  'Walk-in': { icon: '🏪', label: 'Walk-in' },
  Grosir: { icon: '📦', label: 'Grosir' },
  Tokopedia: { icon: '🛒', label: 'Tokopedia' },
  Shopee: { icon: '🛒', label: 'Shopee' },
  Instagram: { icon: '📷', label: 'IG' },
};

function shortPaymentType(pt: PaymentType): string {
  if (pt === 'TEMPO') return 'Tempo';
  if (pt === 'FULL') return 'Lunas';
  if (pt === 'DP') return 'DP';
  return '';
}

export function OrderRow({ order, expanded, typeTab, onToggle, onQuickAction, rejectInfoMap }: Props) {
  const action = getQuickAction(order);
  const ch = CHANNEL_DISPLAY[order.channel] ?? { icon: '📱', label: order.channel };
  const payment = shortPaymentType(order.payment_type);
  const showTypeBadge = typeTab === 'all';
  const typeLabel =
    order.order_type === 'CUSTOM_PANEL' ? 'Custom Panel' :
    order.order_type === 'RAKIT_PANEL' ? 'Rakit Panel' : 'Komponen';

  // Reject-reason chip: only shown when the order is at 3f AND there's a
  // recent rakit_lock_rejected audit entry in the map. Snippet truncates
  // to ~33 chars + ellipsis to keep the chip compact; full text lives in
  // the tooltip alongside the formatted reject date.
  const rejectInfo = rejectInfoMap?.[order.id];
  const showRejectChip = order.funnel_sub_stage === '3f' && !!rejectInfo;
  const rejectSnippet = rejectInfo?.reason
    ? (rejectInfo.reason.length > 36 ? rejectInfo.reason.slice(0, 33) + '…' : rejectInfo.reason)
    : '';

  return (
    <div style={{ background: 'white', borderBottom: '1px solid #e5eeff' }}>
      <div onClick={onToggle} style={{ padding: '14px 24px 14px 60px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: 14 }}>{order.customer}</span>
              {showRejectChip && (
                <span
                  title={`Direject ${new Date(rejectInfo!.rejected_at).toLocaleDateString('id-ID')}: ${rejectInfo!.reason}`}
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    fontWeight: 700,
                    marginLeft: 8,
                  }}
                >
                  ⚠️ Owner: {rejectSnippet}
                </span>
              )}
              <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>#{order.id.slice(0, 8)}</span>
              {showTypeBadge && (
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#eff4ff', color: 'var(--color-primary)', fontWeight: 600, marginLeft: 8, border: '1px solid #c7d7f5' }}>{typeLabel}</span>
              )}
              {order.stuck && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#fee2e2', color: '#b91c1c', fontWeight: 700, marginLeft: 8, border: '1px solid #fecaca' }}>stuck</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{ch.icon} {ch.label}</span>
              <span style={{ color: '#9ca3af' }}>·</span>
              {payment && (
                <>
                  <span style={{ background: '#eff4ff', color: 'var(--color-primary)', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid #c7d7f5' }}>{payment}</span>
                  <span style={{ color: '#9ca3af' }}>·</span>
                </>
              )}
              <span>{order.status_label}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: 'var(--color-secondary)', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>Rp {order.total.toLocaleString('id-ID')}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{order.time_ago}</div>
          </div>
          {action && (
            <QuickActionPill label={action.label} onClick={() => onQuickAction(action.label, action.toSubStage)} />
          )}
          <span style={{ color: '#c7d7f5', fontSize: 12 }}>{expanded ? '▾' : '›'}</span>
        </div>
      </div>
    </div>
  );
}
