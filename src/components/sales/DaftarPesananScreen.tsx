import { useEffect, useMemo, useState } from 'react';
import { fetchActiveOrders, subscribeOrders } from '../../lib/sales/queries';
import type { Order, FunnelStage, FunnelSubStage } from '../../lib/sales/types';
import { TYPE_TAB_CFG, filterOrdersByTypeTab, subStageBelongsToTab, type TypeTab } from '../../lib/sales/typeTabConfig';
import { getSubStagesForStage, isUrgentSubStage } from '../../lib/sales/stageMapping';
import { transitionOrder } from '../../lib/sales/mutations';
import { TypeTabs } from './TypeTabs';
import { StageStrip } from './StageStrip';
import { SubStageSection } from './SubStageSection';

export function DaftarPesananScreen() {
  const [typeTab, setTypeTab] = useState<TypeTab>('komponen');
  const [stage, setStage] = useState<FunnelStage>(2);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // initial load + realtime
  useEffect(() => {
    fetchActiveOrders().then(setOrders).catch(err => console.error('fetchActiveOrders failed', err));
    const sub = subscribeOrders(() => {
      fetchActiveOrders().then(setOrders).catch(err => console.error('refresh fetch failed', err));
    });
    return () => { sub.unsubscribe?.(); };
  }, []);

  // auto-expand urgent sub-stages when stage/tab changes
  useEffect(() => {
    const next = new Set<string>();
    getSubStagesForStage(stage).forEach(s => {
      if (subStageBelongsToTab(s.id, typeTab) && isUrgentSubStage(s.id)) next.add(s.id);
    });
    setExpandedSubs(next);
  }, [stage, typeTab]);

  const filteredOrders = useMemo(() => filterOrdersByTypeTab(orders, typeTab), [orders, typeTab]);

  const ordersByStage = useMemo(() => {
    const m: Record<number, Order[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    filteredOrders.forEach(o => m[o.funnel_stage]?.push(o));
    return m;
  }, [filteredOrders]);

  const totalCounts: Record<TypeTab, number> = {
    komponen: orders.filter(o => o.order_type === 'KOMPONEN').length,
    workshop: orders.filter(o => o.order_type !== 'KOMPONEN').length,
    all: orders.length,
  };

  const stageCounts: Record<FunnelStage, number> = {
    1: ordersByStage[1].length,
    2: ordersByStage[2].length,
    3: ordersByStage[3].length,
    4: ordersByStage[4].length,
    5: ordersByStage[5].length,
    6: ordersByStage[6].length,
  };

  const subsForStage = getSubStagesForStage(stage).filter(s => subStageBelongsToTab(s.id, typeTab));

  async function handleQuickAction(order: Order, toSubStage: string) {
    try {
      const result = await transitionOrder({
        id: order.id,
        fromSubStage: order.funnel_sub_stage,
        toSubStage: toSubStage as FunnelSubStage,
        expectedVersion: order.version,
      });
      if (!result.ok) {
        // eslint-disable-next-line no-alert
        alert(`Gagal: ${result.code}. Refresh dan coba lagi.`);
      }
    } catch (err) {
      console.error('transitionOrder failed', err);
      // eslint-disable-next-line no-alert
      alert('Gagal: network/server error.');
    } finally {
      const fresh = await fetchActiveOrders().catch(() => null);
      if (fresh) setOrders(fresh);
    }
  }

  function toggleSection(subId: string) {
    setExpandedSubs(prev => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      return next;
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-primary)' }}>Daftar Pesanan</h2>
      <div style={{ background: 'white', borderRadius: 24, boxShadow: '0 2px 12px rgba(1,39,73,0.06)', border: '1px solid #e5eeff', overflow: 'hidden' }}>
        <TypeTabs active={typeTab} counts={totalCounts} onChange={setTypeTab} />
        <StageStrip active={stage} counts={stageCounts} onChange={setStage} />
        <div>
          {subsForStage.map(sub => (
            <SubStageSection
              key={sub.id}
              sub={sub}
              orders={ordersByStage[stage].filter(o => o.funnel_sub_stage === sub.id)}
              expanded={expandedSubs.has(sub.id)}
              expandedRowId={expandedRowId}
              typeTab={typeTab}
              onToggleSection={() => toggleSection(sub.id)}
              onToggleRow={(id) => setExpandedRowId(prev => prev === id ? null : id)}
              onQuickAction={handleQuickAction}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
