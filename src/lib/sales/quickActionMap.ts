import type { Order, FunnelSubStage } from './types';

export interface QuickAction {
  label: string;
  toSubStage: FunnelSubStage;
  requiresProof?: boolean;
}

export function getQuickAction(order: Order): QuickAction | null {
  switch (order.funnel_sub_stage) {
    case '2b': return { label: 'Setujui', toSubStage: '2c' };
    case '2c': return { label: 'Reminder', toSubStage: '2c' };
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
    case '3d': return { label: 'Reminder', toSubStage: '3d' };
    case '3f': return { label: 'Selesai', toSubStage: '3g' };
    case '3g': return { label: 'Persetujuan', toSubStage: '3g' };
    case '3h': return { label: 'Reminder', toSubStage: '3h' };
    case '4a': return { label: 'Diterima', toSubStage: '5a' };
    case '4b': return { label: 'Diterima', toSubStage: '5a' };
    default: return null;
  }
}
