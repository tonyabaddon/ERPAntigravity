import type { Order, FunnelSubStage } from './types';

export interface QuickAction {
  label: string;
  toSubStage: FunnelSubStage;
  requiresProof?: boolean;
  /**
   * Defaults to 'transition' (call transition_order_stage RPC).
   * 'wa-reminder' opens a pre-filled WhatsApp reminder in a new tab and
   * does NOT change funnel_sub_stage — used for the "Reminder" buttons
   * at 2c / 3d / 3h while the Calista WA backend wiring is still in
   * Phase 1C.
   */
  intent?: 'transition' | 'wa-reminder';
}

/**
 * Returns the primary row-level pill action for a given order's current
 * sub-stage, or null when no pill should render.
 *
 * Sub-stages WITHOUT a pill (handled via ActionPanel buttons instead):
 *  - 2a: passive — use Batalkan if needed
 *  - 2e / 3e: dead-end after reject — recovery via "Buka Lagi" in panel
 *  - 3g: Owner Persetujuan inbox is Phase 1C
 *  - 4d: pengiriman bermasalah — resolve via panel buttons
 *  - 5a / 6a / 6b: terminal
 */
export function getQuickAction(order: Order): QuickAction | null {
  switch (order.funnel_sub_stage) {
    case '2b': return { label: 'Setujui', toSubStage: '2c' };
    case '2c': return { label: 'Reminder', toSubStage: '2c', intent: 'wa-reminder' };
    case '2d': return { label: 'Verify', toSubStage: '3a', requiresProof: true };
    case '3a': {
      const target: FunnelSubStage = order.delivery_method === 'PICKUP' ? '4b' : '4a';
      return { label: 'Siap', toSubStage: target };
    }
    case '3b': return { label: 'Verify Pelunasan', toSubStage: '3c', requiresProof: true };
    case '3c': {
      const target: FunnelSubStage = order.delivery_method === 'PICKUP' ? '4b' : '4a';
      return { label: 'Siap', toSubStage: target };
    }
    case '3d': return { label: 'Reminder', toSubStage: '3d', intent: 'wa-reminder' };
    case '3f': return { label: 'Selesai', toSubStage: '3g' };
    case '3h': return { label: 'Reminder', toSubStage: '3h', intent: 'wa-reminder' };
    case '4a': return { label: 'Diterima', toSubStage: '5a' };
    case '4b': return { label: 'Diterima', toSubStage: '5a' };
    default: return null;
  }
}
