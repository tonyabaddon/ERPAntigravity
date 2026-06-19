import { useEffect, useMemo, useState } from 'react';
import type {
  ApprovalRequest,
  ApprovalRequestType,
  PermissionSet,
  RakitJobLine,
} from '../../types';
import {
  listPendingApprovals,
  subscribeApprovalRequests,
  commitApprovedAdjustment,
  commitApprovedPriceChange,
  commitOpname,
  adminUsersService,
  supabase,
} from '../../lib/supabaseClient';
import ApprovalRequestRow from './ApprovalRequestRow';
import RakitLockApprovalRequestRow from './RakitLockApprovalRequestRow';
import TempoWriteOffApprovalRequestRow from './TempoWriteOffApprovalRequestRow';
import OwnerPinPad from './OwnerPinPad';
import { approveRakitLock, rejectRakitLock } from '../../lib/supabaseClient';
import { approveTempoWriteOff, rejectTempoWriteOff } from '../../lib/piutang/writeOff';
import LockSubmissionModal from '../penjualan/LockSubmissionModal';

/**
 * Owner-facing inbox of pending `approval_requests`. Subscribes to Supabase
 * realtime when available, but always polls every 30 seconds as a backstop
 * because the project's Realtime publication on `approval_requests` may be
 * disabled (T22 critical context). A 4-user MSME finds 30s acceptable.
 *
 * Approve/Reject dispatch is per request_type:
 *   - adjustment   → commit_approved_adjustment(id)
 *   - price_change → commit_approved_price_change(id)
 *   - opname       → commit_opname(id)
 *   - kasir_*      → deferred to Phase 3b; rows render but action buttons no-op
 *
 * Reject is a generic UPDATE on `approval_requests` to keep this screen
 * self-contained for Phase 2 (per-type reject RPCs land in later phases).
 */
interface ApprovalInboxScreenProps {
  currentUser: {
    id: string;
    name: string;
    role: string;
    permissions: PermissionSet;
  } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterPill = 'all' | 'adjustment' | 'price_change' | 'opname' | 'rakit_lock' | 'kasir' | 'piutang_write_off';

const PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all',                label: 'Semua' },
  { key: 'adjustment',         label: 'Adjustment' },
  { key: 'price_change',       label: 'Harga' },
  { key: 'opname',             label: 'Opname' },
  { key: 'rakit_lock',         label: 'Rakit Lock' },
  { key: 'kasir',              label: 'Kasir' },
  { key: 'piutang_write_off',  label: 'Tulis-off' },
];

function matchesFilter(req: ApprovalRequest, filter: FilterPill): boolean {
  if (filter === 'all') return true;
  if (filter === 'kasir') return req.requestType.startsWith('kasir_');
  return req.requestType === (filter as ApprovalRequestType);
}

export default function ApprovalInboxScreen({
  currentUser,
  showToast,
}: ApprovalInboxScreenProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterPill>('all');
  const [busyId, setBusyId] = useState<number | null>(null);
  // requesterId → name lookup. Filled once on mount so each row resolves the
  // raw UUID into the admin's display name (was previously rendered raw —
  // surfaced by the 2026-06-12 e2e audit).
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  // Setujui on adjustment / price_change / opname requires Owner PIN before the
  // commit RPC will accept the request (the commit RPC verifies
  // approval_requests.status='approved' and the only sanctioned approver-side
  // transition path is verify_owner_pin → _transition_approval). Track the
  // request waiting on PIN here; null means no PIN modal is open.
  const [pinTarget, setPinTarget] = useState<{ id: number; type: ApprovalRequestType } | null>(null);
  // Owner-amend target — when set, opens LockSubmissionModal in owner-amend
  // mode so the Owner can edit snapshot values then approve in one tx.
  const [ownerAmendTarget, setOwnerAmendTarget] = useState<{
    approvalId: number;
    transactionId: string;
    rakitLines: RakitJobLine[];
  } | null>(null);

  const perms = currentUser?.permissions;
  const isOwner = !!(
    perms?.can_approve_adjustment ||      // also gates rakit_lock approvals for session 1
                                           // (dedicated can_approve_rakit_lock perm deferred to session 2)
    perms?.can_approve_price_change ||
    perms?.can_commit_opname ||
    perms?.can_approve_kasir_price_override ||
    perms?.can_approve_kasir_void ||
    perms?.can_approve_kasir_refund
  );

  const refresh = async () => {
    try {
      const list = await listPendingApprovals();
      setRequests(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat persetujuan', 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // One-shot admin lookup. We don't subscribe to changes — admin renames
    // are rare and a 30s poll backstop already refreshes the request list.
    adminUsersService
      .fetchAll()
      .then((rows) => {
        const map: Record<string, string> = {};
        for (const a of rows) map[a.id] = a.name;
        setActorNames(map);
      })
      .catch(() => {
        /* leave map empty; rows fall back to raw UUID */
      });
    void refresh();
    // Best-effort realtime — silently no-ops if Realtime publication is
    // disabled for `approval_requests` (T22 fallback note).
    const unsub = subscribeApprovalRequests(() => {
      void refresh();
    });
    // Backstop poll — works whether or not Realtime fires.
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);
    return () => {
      unsub();
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => requests.filter((r) => matchesFilter(r, filter)),
    [requests, filter],
  );

  // Adjustment / price_change / opname commits require the gate to already be
  // status='approved'. The in-app sanctioned path to flip it is Owner PIN →
  // verify_owner_pin (which itself calls _transition_approval). This helper
  // runs the commit RPC AFTER verify_owner_pin has returned TRUE.
  const runCommitAfterPin = async (id: number, type: ApprovalRequestType) => {
    setBusyId(id);
    try {
      switch (type) {
        case 'adjustment':
          await commitApprovedAdjustment(id);
          break;
        case 'price_change':
          await commitApprovedPriceChange(id);
          break;
        case 'opname':
          await commitOpname(id);
          break;
        default:
          showToast('Tipe permintaan tidak dikenali', 'warning');
          return;
      }
      showToast('Permintaan disetujui', 'success');
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyetujui', 'warning');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (id: number) => {
    const req = requests.find((r) => r.id === id);
    if (!req) return;

    // piutang_write_off has a one-shot RPC pair (approve / reject) that
    // commit inside the RPC. Approve may auto-reject if the invoice was
    // paid between request + approval — surface that distinct race path
    // with an `info` toast rather than a generic success.
    if (req.requestType === 'piutang_write_off') {
      setBusyId(id);
      try {
        const result = await approveTempoWriteOff(id);
        if (result.status === 'auto_rejected_race') {
          showToast('Invoice sudah dibayar sebelum disetujui — pengajuan dibatalkan otomatis', 'info');
        } else {
          showToast('Tulis-off disetujui', 'success');
        }
        await refresh();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Gagal menyetujui', 'warning');
      } finally {
        setBusyId(null);
      }
      return;
    }

    // rakit_lock has a one-shot RPC that wraps _transition_approval + commit
    // in one txn and gates on auth.uid()'s admin_users.role='Owner'. PIN does
    // not gate this path today — keep the existing direct call.
    if (req.requestType === 'rakit_lock') {
      setBusyId(id);
      try {
        await approveRakitLock(id);
        showToast('Permintaan disetujui', 'success');
        await refresh();
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Gagal menyetujui', 'warning');
      } finally {
        setBusyId(null);
      }
      return;
    }

    if (
      req.requestType === 'kasir_price_override' ||
      req.requestType === 'kasir_void' ||
      req.requestType === 'kasir_refund'
    ) {
      // Kasir approval RPCs land in Phase 3b — surface the gap explicitly
      // rather than silently no-op.
      showToast('Persetujuan kasir belum tersedia (Fase 3b)', 'info');
      return;
    }

    // adjustment | price_change | opname → prompt for Owner PIN. The commit
    // RPC checks status='approved' and verify_owner_pin is what flips it.
    setPinTarget({ id, type: req.requestType });
  };

  const onPinSuccess = () => {
    if (!pinTarget) return;
    const { id, type } = pinTarget;
    setPinTarget(null);
    void runCommitAfterPin(id, type);
  };

  const handleReject = async (id: number, reason?: string) => {
    if (!supabase) {
      showToast('Supabase belum dikonfigurasi', 'warning');
      return;
    }
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    setBusyId(id);
    try {
      // The `approval_requests` table is append-only (REVOKE UPDATE on
      // authenticated + a deny-mutation trigger); state transitions must go
      // through the per-type SECURITY DEFINER RPCs. Only `reject_adjustment`
      // ships in Phase 2 — reject for opname/price_change/kasir is deferred
      // to later phases and surfaced here as a toast instead of a 403.
      if (req.requestType === 'adjustment') {
        const { error } = await supabase.rpc('reject_adjustment', {
          p_approval_id: id,
          p_reason_note: reason ?? null,
        });
        if (error) throw error;
        showToast('Permintaan ditolak', 'info');
        await refresh();
      } else if (req.requestType === 'piutang_write_off') {
        await rejectTempoWriteOff(id, reason ?? 'Owner reject from Persetujuan inbox');
        showToast('Tulis-off ditolak', 'info');
        await refresh();
      } else if (req.requestType === 'rakit_lock') {
        if (!currentUser) {
          showToast('User belum login', 'warning');
          return;
        }
        await rejectRakitLock(id, reason ?? 'Owner reject from Persetujuan inbox', currentUser.id);
        showToast('Permintaan ditolak', 'info');
        await refresh();
      } else {
        showToast(
          'Penolakan untuk tipe ini belum tersedia di Fase 2',
          'info',
        );
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menolak', 'warning');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-extrabold text-lg text-[#012749]">Persetujuan Menunggu</h1>
          <p className="text-xs text-slate-500">
            {requests.length} permintaan terbuka &middot; auto-expire 30 menit
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PILLS.map((p) => {
            const active = filter === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setFilter(p.key)}
                className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-[#012749] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-500">Memuat&hellip;</p>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-center text-sm py-6 text-slate-500">
          Semua permintaan sudah diputuskan.
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.id}>
            {r.requestType === 'rakit_lock' ? (
              <RakitLockApprovalRequestRow
                request={r}
                isOwner={isOwner}
                disabled={busyId !== null && busyId !== r.id}
                onApprove={handleApprove}
                onReject={handleReject}
                onEditAndApprove={(id, txId, lines) =>
                  setOwnerAmendTarget({ approvalId: id, transactionId: txId, rakitLines: lines })
                }
              />
            ) : r.requestType === 'piutang_write_off' ? (
              <TempoWriteOffApprovalRequestRow
                request={r}
                isOwner={isOwner}
                disabled={busyId !== null && busyId !== r.id}
                actorName={actorNames[r.requestedBy]}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ) : (
              <ApprovalRequestRow
                request={r}
                isOwner={isOwner}
                disabled={busyId !== null && busyId !== r.id}
                onApprove={handleApprove}
                onReject={handleReject}
                actorName={actorNames[r.requestedBy]}
              />
            )}
          </div>
        ))}
      </div>

      {pinTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setPinTarget(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <OwnerPinPad
              approvalId={pinTarget.id}
              onSuccess={onPinSuccess}
              onCancel={() => setPinTarget(null)}
              showToast={(msg, type) =>
                showToast(msg, type === 'error' ? 'warning' : 'success')
              }
            />
          </div>
        </div>
      )}

      {ownerAmendTarget && currentUser && (
        <LockSubmissionModal
          mode="owner-amend"
          approvalId={ownerAmendTarget.approvalId}
          transactionId={ownerAmendTarget.transactionId}
          rakitLines={ownerAmendTarget.rakitLines}
          currentUser={{ id: currentUser.id, name: currentUser.name }}
          onClose={() => setOwnerAmendTarget(null)}
          onSubmitted={() => {
            setOwnerAmendTarget(null);
            // Realtime subscription on approval_requests will refresh the
            // inbox list automatically; backstop poll covers Realtime-off.
            void refresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
