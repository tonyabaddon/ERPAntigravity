import { useEffect, useMemo, useState } from 'react';
import { fetchOrdersWithArchive, subscribeOrders } from '../../lib/sales/queries';
import type { Order, FunnelStage } from '../../lib/sales/types';
import { filterOrdersByTypeTab, subStageBelongsToTab, type TypeTab } from '../../lib/sales/typeTabConfig';
import { getSubStagesForStage, isUrgentSubStage } from '../../lib/sales/stageMapping';
import { getQuickAction } from '../../lib/sales/quickActionMap';
import { transitionOrder } from '../../lib/sales/mutations';
import { fetchStoreSettings, fetchBankAccounts } from '../../lib/pengaturan/queries';
import type { StoreSettings, BankAccount } from '../../lib/pengaturan/types';
import { TypeTabs } from './TypeTabs';
import { StageStrip } from './StageStrip';
import { SubStageSection } from './SubStageSection';
import { PaymentProofLightbox } from './PaymentProofLightbox';
import { ProofUploadModal } from './ProofUploadModal';
import { EditOrderModal } from './EditOrderModal';
import { ReasonInputModal } from './ReasonInputModal';
import LockSubmissionModal from '../penjualan/LockSubmissionModal';
import type { RakitJobLine } from '../../types';
import {
  withdrawRakitLock,
  findPendingRakitLockApprovalForOrder,
  fetchRakitJobLinesForOrder,
} from '../../lib/supabaseClient';
import { buildWhatsAppReminderUrl } from '../../lib/sales/waReminder';
import { fetchRecentRejectsByOrder, type RejectInfo } from '../../lib/sales/recentRejects';

interface DaftarPesananScreenProps {
  /** Reserved for future Owner-only gating; currently unused. */
  currentUserRole?: string;
  /** Required to pass auth context into LockSubmissionModal at 3f. */
  currentUserId?: string;
  /** Display name for LockSubmissionModal's audit-trail header. */
  currentUserName?: string;
}

export function DaftarPesananScreen({ currentUserRole: _currentUserRole, currentUserId, currentUserName }: DaftarPesananScreenProps = {}) {
  const [typeTab, setTypeTab] = useState<TypeTab>('komponen');
  const [stage, setStage] = useState<FunnelStage>(2);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<{ url: string; orderId: string; version: number; fromSub: string; toSub: string } | null>(null);
  const [uploadModal, setUploadModal] = useState<{ orderId: string; field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' } | null>(null);
  const [pendingVerify, setPendingVerify] = useState<{ orderId: string; toSub: string } | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  // Driven by the 3f Selesai click for CP/RP orders. Holds the order id plus
  // pre-fetched rakit_job_lines so LockSubmissionModal can render synchronously.
  const [lockModalOrder, setLockModalOrder] = useState<{ id: string; rakitLines: RakitJobLine[] } | null>(null);
  // ReasonInputModal driver: title/prompt/confirmLabel/tone come from the
  // action that was clicked; perform() captures the transition target +
  // any side-effect (e.g. dropping to 6a vs 4d).
  const [reasonModal, setReasonModal] = useState<
    | null
    | {
        title: string;
        prompt: string;
        confirmLabel: string;
        tone: 'danger' | 'warning' | 'primary';
        hint?: string;
        perform: (reason: string) => Promise<void>;
      }
  >(null);
  const [waMessage, setWaMessage] = useState<string | null>(null);
  // Store settings + active bank accounts gate PDF generation. Either being null
  // means "still loading or load failed" — ActionPanel disables PDF buttons
  // and shows "Lengkapi Pengaturan dulu" tooltip in that case.
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [banks, setBanks] = useState<BankAccount[] | null>(null);
  // Map order_id → recent rakit_lock_rejected audit entry. Used to render
  // the ⚠️ Owner reject-reason chip on 3f rows so admin sees why a
  // submission was bounced back without opening RiwayatPersetujuanPanel.
  const [rejectInfoMap, setRejectInfoMap] = useState<Record<string, RejectInfo>>({});

  // initial load + realtime
  useEffect(() => {
    fetchOrdersWithArchive().then(setOrders).catch(err => console.error('fetchOrdersWithArchive failed', err));
    fetchStoreSettings().then(setSettings).catch(err => {
      console.error('fetchStoreSettings failed', err);
      setSettings(null);
    });
    fetchBankAccounts(true).then(setBanks).catch(err => {
      console.error('fetchBankAccounts failed', err);
      setBanks(null);
    });
    const sub = subscribeOrders(() => {
      fetchOrdersWithArchive().then(setOrders).catch(err => console.error('refresh fetch failed', err));
    });
    return () => { sub.unsubscribe?.(); };
  }, []);

  // Refresh reject-reason map whenever orders change. Filter to CP/RP at 3f
  // (the only sub-stage that can carry a recent rakit_lock_rejected) so we
  // don't fetch audit_log unnecessarily on every keystroke / realtime push.
  useEffect(() => {
    const threeFIds = orders
      .filter(o => o.funnel_sub_stage === '3f' && (o.order_type === 'CUSTOM_PANEL' || o.order_type === 'RAKIT_PANEL'))
      .map(o => o.id);
    if (threeFIds.length === 0) {
      setRejectInfoMap({});
      return;
    }
    fetchRecentRejectsByOrder(threeFIds).then(setRejectInfoMap);
  }, [orders]);

  // auto-expand urgent sub-stages when stage/tab changes — also include orphan urgent
  // sub-stages where orders for this tab exist (e.g. KOMPONEN order at 3g from backfill)
  useEffect(() => {
    const next = new Set<string>();
    const ordersForTab = filterOrdersByTypeTab(orders, typeTab);
    const subsWithOrders = new Set(ordersForTab.filter(o => o.funnel_stage === stage).map(o => o.funnel_sub_stage));
    getSubStagesForStage(stage).forEach(s => {
      const isVisible = subStageBelongsToTab(s.id, typeTab) || subsWithOrders.has(s.id);
      if (isVisible && isUrgentSubStage(s.id)) next.add(s.id);
    });
    setExpandedSubs(next);
  }, [stage, typeTab, orders]);

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

  // Show sub-stages that belong to the tab + any sub-stage that has orders for this tab
  // (handles backfill anomalies where order_type=KOMPONEN but sub_stage is workshop-only e.g. 3g).
  // Without this, the stage count and visible rows can desync.
  const subsForStage = (() => {
    const allSubs = getSubStagesForStage(stage);
    const ordersAtStage = ordersByStage[stage] ?? [];
    const subsWithOrders = new Set(ordersAtStage.map(o => o.funnel_sub_stage));
    return allSubs.filter(s => subStageBelongsToTab(s.id, typeTab) || subsWithOrders.has(s.id));
  })();

  async function handleQuickAction(order: Order, toSubStage: string) {
    const action = getQuickAction(order);

    // WhatsApp reminder buttons (2c / 3d / 3h): open wa.me in a new tab
    // (or surface the message text if customer_phone is not on file). Does
    // NOT change funnel_sub_stage.
    if (action?.intent === 'wa-reminder') {
      if (!settings || !banks) {
        // eslint-disable-next-line no-alert
        alert('Lengkapi Identitas Toko + Rekening Bank di Pengaturan dulu supaya isi pesan lengkap.');
        return;
      }
      const { url, message } = buildWhatsAppReminderUrl(order, settings, banks);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setWaMessage(message);
      }
      return;
    }

    // Funnel 3f Selesai for CP/RP → open LockSubmissionModal so admin records
    // material/labor costs. Submission calls request_rakit_lock which sets
    // funnel_sub_stage='3g' atomically (migration 20260626000001).
    if (
      order.funnel_sub_stage === '3f' &&
      action?.label === 'Selesai' &&
      (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL')
    ) {
      try {
        const lines = await fetchRakitJobLinesForOrder(order.id);
        if (lines.length === 0) {
          // eslint-disable-next-line no-alert
          alert('Belum ada line item rakit untuk pesanan ini. Hubungi tech support.');
          return;
        }
        setLockModalOrder({ id: order.id, rakitLines: lines });
      } catch (err) {
        console.error('fetchRakitJobLinesForOrder failed', err);
        // eslint-disable-next-line no-alert
        alert('Gagal memuat detail pesanan.');
      }
      return;
    }

    if (action?.requiresProof) {
      const proofField: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' =
        order.funnel_sub_stage === '3b' ? 'pelunasan_proof_url' : 'payment_proof_url';
      const proofUrl =
        proofField === 'pelunasan_proof_url'
          ? order.pelunasan_proof_url
          : (order.payment_proof_url ?? order.marketplace_proof_url);

      if (!proofUrl) {
        setPendingVerify({ orderId: order.id, toSub: toSubStage });
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
      const fresh = await fetchOrdersWithArchive().catch(() => null);
      if (fresh) setOrders(fresh);
    }
  }

  function handleOpenProof(order: Order) {
    const proofUrl = order.funnel_sub_stage === '3b'
      ? order.pelunasan_proof_url
      : (order.payment_proof_url ?? order.marketplace_proof_url);
    if (!proofUrl) return;
    const action = getQuickAction(order);
    if (!action?.toSubStage) return;
    setProofModal({
      url: proofUrl,
      orderId: order.id,
      version: order.version,
      fromSub: order.funnel_sub_stage,
      toSub: action.toSubStage,
    });
  }

  function handleUploadProof(order: Order) {
    const proofField: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url' =
      order.funnel_sub_stage === '3b' ? 'pelunasan_proof_url' : 'payment_proof_url';
    const action = getQuickAction(order);
    if (!action?.toSubStage) return;
    setPendingVerify({ orderId: order.id, toSub: action.toSubStage });
    setUploadModal({ orderId: order.id, field: proofField });
  }

  function handleEdit(order: Order) {
    setEditingOrder(order);
  }

  // Direct transition helper used by all the new "recovery" actions
  // (Buka Lagi, Lanjut Kirim, Sudah Diterima). Returns a promise that
  // resolves after the orders refetch so callers can chain refresh logic.
  async function runTransition(order: Order, toSubStage: Order['funnel_sub_stage'], reason?: string) {
    try {
      const result = await transitionOrder({
        id: order.id,
        fromSubStage: order.funnel_sub_stage,
        toSubStage,
        expectedVersion: order.version,
        reason,
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
      const fresh = await fetchOrdersWithArchive().catch(() => null);
      if (fresh) setOrders(fresh);
    }
  }

  function handleReject(order: Order) {
    setReasonModal({
      title: 'Tolak Order',
      prompt: `Tolak pesanan #${order.id.slice(0, 8)} (${order.customer})? Pesanan masuk ke status Ditolak; customer bisa upload bukti ulang nanti.`,
      confirmLabel: 'Tolak Order',
      tone: 'warning',
      hint: 'Alasan disimpan di audit log dan jadi catatan untuk follow-up.',
      perform: async (reason) => { await runTransition(order, '2e', reason); },
    });
  }

  function handleReopen(order: Order) {
    // 2e → 2d (cek bukti baru). 3e → 3b (cek bukti pelunasan baru).
    const target: Order['funnel_sub_stage'] = order.funnel_sub_stage === '3e' ? '3b' : '2d';
    runTransition(order, target);
  }

  function handleMarkProblem(order: Order) {
    setReasonModal({
      title: 'Tandai Bermasalah',
      prompt: `Tandai pesanan #${order.id.slice(0, 8)} sebagai bermasalah saat dikirim? Pesanan pindah ke "Ada Masalah Pengiriman".`,
      confirmLabel: 'Tandai Bermasalah',
      tone: 'warning',
      hint: 'Contoh: alamat tidak ketemu, customer minta reschedule, paket rusak.',
      perform: async (reason) => { await runTransition(order, '4d', reason); },
    });
  }

  function handleResolveContinue(order: Order) {
    runTransition(order, '4a');
  }

  function handleResolveReceived(order: Order) {
    runTransition(order, '5a');
  }

  async function handleWithdrawRakitLock(order: Order) {
    try {
      const approvalId = await findPendingRakitLockApprovalForOrder(order.id);
      if (!approvalId) {
        // eslint-disable-next-line no-alert
        alert('Tidak ada permintaan persetujuan yang pending untuk pesanan ini.');
        return;
      }
      await withdrawRakitLock(approvalId, currentUserId);
    } catch (err) {
      console.error('withdrawRakitLock failed', err);
      // eslint-disable-next-line no-alert
      alert('Gagal menarik pengajuan. Coba lagi.');
    } finally {
      const fresh = await fetchOrdersWithArchive().catch(() => null);
      if (fresh) setOrders(fresh);
    }
  }

  function handleCancelOrder(order: Order) {
    setReasonModal({
      title: 'Batalkan Pesanan',
      prompt: `Batalkan pesanan #${order.id.slice(0, 8)} (${order.customer})? Pesanan pindah ke Stage 6 (Dibatalkan).`,
      confirmLabel: 'Batalkan',
      tone: 'danger',
      hint: 'Aksi ini tercatat di audit log. Stok / refund follow up manual untuk sekarang.',
      perform: async (reason) => { await runTransition(order, '6a', reason); },
    });
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
              settings={settings}
              banks={banks}
              onToggleSection={() => toggleSection(sub.id)}
              onToggleRow={(id) => setExpandedRowId(prev => prev === id ? null : id)}
              onQuickAction={handleQuickAction}
              onOpenProof={handleOpenProof}
              onUploadProof={handleUploadProof}
              onEdit={handleEdit}
              onReject={handleReject}
              onReopen={handleReopen}
              onMarkProblem={handleMarkProblem}
              onResolveContinue={handleResolveContinue}
              onResolveReceived={handleResolveReceived}
              onCancelOrder={handleCancelOrder}
              onWithdrawRakitLock={handleWithdrawRakitLock}
              rejectInfoMap={rejectInfoMap}
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
            const fresh = await fetchOrdersWithArchive().catch(() => null);
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
            const fresh = await fetchOrdersWithArchive().catch(() => null);
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
            setUploadModal(null);
            // Refresh + re-open lightbox for verify
            const fresh = await fetchOrdersWithArchive().catch(() => null);
            if (fresh) {
              setOrders(fresh);
              if (pendingVerify) {
                const refreshed = fresh.find(o => o.id === pendingVerify.orderId);
                if (refreshed) {
                  const url = refreshed.funnel_sub_stage === '3b'
                    ? refreshed.pelunasan_proof_url
                    : (refreshed.payment_proof_url ?? refreshed.marketplace_proof_url);
                  if (url) {
                    setProofModal({
                      url,
                      orderId: refreshed.id,
                      version: refreshed.version,
                      fromSub: refreshed.funnel_sub_stage,
                      toSub: pendingVerify.toSub,
                    });
                  }
                }
                setPendingVerify(null);
              }
            }
          }}
          onClose={() => { setUploadModal(null); setPendingVerify(null); }}
        />
      )}
      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={async () => {
            const fresh = await fetchOrdersWithArchive().catch(() => null);
            if (fresh) setOrders(fresh);
          }}
        />
      )}
      {lockModalOrder && (
        <LockSubmissionModal
          transactionId={lockModalOrder.id}
          rakitLines={lockModalOrder.rakitLines}
          currentUser={{ id: currentUserId ?? '', name: currentUserName ?? '' }}
          onClose={() => setLockModalOrder(null)}
          onSubmitted={async () => {
            setLockModalOrder(null);
            const fresh = await fetchOrdersWithArchive().catch(() => null);
            if (fresh) setOrders(fresh);
          }}
          showToast={(msg) => {
            // eslint-disable-next-line no-alert
            alert(msg);
          }}
        />
      )}
      {reasonModal && (
        <ReasonInputModal
          title={reasonModal.title}
          prompt={reasonModal.prompt}
          confirmLabel={reasonModal.confirmLabel}
          tone={reasonModal.tone}
          hint={reasonModal.hint}
          onConfirm={async (reason) => { await reasonModal.perform(reason); }}
          onClose={() => setReasonModal(null)}
        />
      )}
      {waMessage && (
        <WhatsAppFallbackModal message={waMessage} onClose={() => setWaMessage(null)} />
      )}
    </div>
  );
}

function WhatsAppFallbackModal({ message, onClose }: { message: string; onClose: () => void }) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      // eslint-disable-next-line no-alert
      alert('Pesan disalin ke clipboard.');
    } catch (err) {
      console.error('clipboard write failed', err);
    }
  }
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'white', borderRadius: 16, maxWidth: 480, width: '100%',
        padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      }}>
        <h3 style={{ margin: 0, marginBottom: 6, color: 'var(--color-primary)', fontSize: 16 }}>Tidak ada nomor HP di pesanan</h3>
        <p style={{ margin: 0, marginBottom: 12, color: '#4b5563', fontSize: 13 }}>
          Salin pesan di bawah, buka WhatsApp manual, dan kirim ke customer.
        </p>
        <textarea
          value={message}
          readOnly
          rows={6}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: 10, fontSize: 13, lineHeight: 1.4,
            border: '1px solid #d1d5db', borderRadius: 10, fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'white', color: '#374151', border: '1px solid #d1d5db', cursor: 'pointer' }}
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleCopy}
            style={{ padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            Salin Pesan
          </button>
        </div>
      </div>
    </div>
  );
}
