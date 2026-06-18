import type { Order, OrderType, FunnelSubStage } from './types';

export type TypeTab = 'komponen' | 'workshop' | 'all';

interface TabConfig {
  label: string;
  hint: string;
  orderTypes: OrderType[] | null;
}

export const TYPE_TAB_CFG: Record<TypeTab, TabConfig> = {
  komponen: {
    label: '📦 Komponen',
    hint: 'Fast turnover · daily ops · pick from stock → ship/pickup',
    orderTypes: ['KOMPONEN'],
  },
  workshop: {
    label: '🛠️ Workshop',
    hint: 'Multi-day projects · custom panel & rakit panel · owner cost approval',
    orderTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'],
  },
  all: {
    label: 'Semua',
    hint: 'Lihat semua tipe digabung (escape valve · pakai kalau perlu)',
    orderTypes: null,
  },
};

export function filterOrdersByTypeTab(orders: Order[], tab: TypeTab): Order[] {
  const types = TYPE_TAB_CFG[tab].orderTypes;
  if (types === null) return orders;
  return orders.filter(o => types.includes(o.order_type));
}

export function subStageBelongsToTab(subStage: FunnelSubStage, tab: TypeTab): boolean {
  if (tab === 'all') return true;
  const komponenOnly: FunnelSubStage[] = ['3a', '3d'];
  const workshopOnly: FunnelSubStage[] = ['3f', '3g', '3h'];
  if (tab === 'komponen') return !workshopOnly.includes(subStage);
  if (tab === 'workshop') return !komponenOnly.includes(subStage);
  return true;
}
