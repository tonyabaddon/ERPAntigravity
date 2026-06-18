import { useEffect, useMemo, useState } from 'react';
import { fetchActiveOrders, subscribeOrders } from '../../lib/sales/queries';
import type { Order, FunnelStage } from '../../lib/sales/types';
import { TYPE_TAB_CFG, filterOrdersByTypeTab, subStageBelongsToTab, type TypeTab } from '../../lib/sales/typeTabConfig';
import { getSubStagesForStage, isUrgentSubStage } from '../../lib/sales/stageMapping';
import { getQuickAction } from '../../lib/sales/quickActionMap';
import { transitionOrder } from '../../lib/sales/mutations';
import { TypeTabs } from './TypeTabs';
import { StageStrip } from './StageStrip';
import { SubStageSection } from './SubStageSection';
import { PaymentProofLightbox } from './PaymentProofLightbox';
import { ProofUploadModal } from './ProofUploadModal';

export function DaftarPesananScreen() {
  const [typeTab, setTypeTab] = useState<TypeTab>('komponen');
  const [stage, setStage] = useState<FunnelStage>(2);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<{ url: string; orderId: string; version: number; fromSub: string; toSub: string } | null>(null);
  const [uploadModal, setUploadModal] = useState<{ orderId: string; field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' } | null>(null);

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
    const action = getQuickAction(order);
    if (action?.requiresProof) {
      const proofField: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' =
        order.funnel_sub_stage === '3b' ? 'pelunasan_proof_url' : 'payment_proof_url';
      const proofUrl =
        proofField === 'pelunasan_proof_url'
          ? order.pelunasan_proof_url
          : (order.payment_proof_url ?? order.marketplace_proof_url);

      if (!proofUrl) {
        setUploadModal({ orderId: order.id, field: proofField });
        return;
      }
      setProofModal({ url: proofUrl, orderId: order.id, version: order.version, fromSub: order.funnel_sub_stage, toSub: toSubStage });
      return;
    }

    // Non-proof actions: transition directly
    try {
      const result = await transitionOrder({
        id: order.id,
        fromSubStage: order.funnel_sub_stage,
        toSubStage: toSubStage as Order['funnel_sub_stage'],
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
      {proofModal && (
        <PaymentProofLightbox
          proofUrl={proofModal.url}
          orderId={proofModal.orderId}
          onApprove={async () => {
            try {
              await transitionOrder({
                id: proofModal.orderId,
                fromSubStage: proofModal.fromSub as Order['funnel_sub_stage'],
                toSubStage: proofModal.toSub as Order['funnel_sub_stage'],
                expectedVersion: proofModal.version,
              });
            } catch (err) {
              console.error('approve failed', err);
            }
            setProofModal(null);
            const fresh = await fetchActiveOrders().catch(() => null);
            if (fresh) setOrders(fresh);
          }}
          onReject={async (reason) => {
            try {
              await transitionOrder({
                id: proofModal.orderId,
                fromSubStage: proofModal.fromSub as Order['funnel_sub_stage'],
                toSubStage: '2e',
                expectedVersion: proofModal.version,
                reason,
              });
            } catch (err) {
              console.error('reject failed', err);
            }
            setProofModal(null);
            const fresh = await fetchActiveOrders().catch(() => null);
            if (fresh) setOrders(fresh);
          }}
          onClose={() => setProofModal(null)}
        />
      )}
      {uploadModal && (
        <ProofUploadModal
          orderId={uploadModal.orderId}
          field={uploadModal.field}
          onUploaded={async () => {
            const fresh = await fetchActiveOrders().catch(() => null);
            if (fresh) setOrders(fresh);
          }}
          onClose={() => setUploadModal(null)}
        />
      )}
    </div>
  );
}
