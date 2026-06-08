import { useEffect, useMemo, useState } from 'react';
import type {
  ApprovalRequest,
  ApprovalRequestType,
  PermissionSet,
} from '../../types';
import {
  listPendingApprovals,
  subscribeApprovalRequests,
  commitApprovedAdjustment,
  commitApprovedPriceChange,
  commitOpname,
  supabase,
} from '../../lib/supabaseClient';
import ApprovalRequestRow from './ApprovalRequestRow';

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

type FilterPill = 'all' | 'adjustment' | 'price_change' | 'opname' | 'kasir';

const PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all',           label: 'Semua' },
  { key: 'adjustment',    label: 'Adjustment' },
  { key: 'price_change',  label: 'Harga' },
  { key: 'opname',        label: 'Opname' },
  { key: 'kasir',         label: 'Kasir' },
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

  const perms = currentUser?.permissions;
  const isOwner = !!(
    perms?.can_approve_adjustment ||
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

  const handleApprove = async (id: number) => {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    setBusyId(id);
    try {
      switch (req.requestType) {
        case 'adjustment':
          await commitApprovedAdjustment(id);
          break;
        case 'price_change':
          await commitApprovedPriceChange(id);
          break;
        case 'opname':
          await commitOpname(id);
          break;
        case 'kasir_price_override':
        case 'kasir_void':
        case 'kasir_refund':
          // Kasir approval RPCs land in Phase 3b — surface the gap explicitly
          // rather than silently no-op.
          showToast('Persetujuan kasir belum tersedia (Fase 3b)', 'info');
          return;
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
            <ApprovalRequestRow
              request={r}
              isOwner={isOwner}
              disabled={busyId !== null && busyId !== r.id}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
