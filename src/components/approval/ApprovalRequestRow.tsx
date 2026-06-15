import { useState } from 'react';
import type { ApprovalRequest, ApprovalRequestType, ApprovalStatus } from '../../types';

interface ApprovalRequestRowProps {
  request: ApprovalRequest;
  onApprove: (id: number) => void | Promise<void>;
  onReject: (id: number, reason?: string) => void | Promise<void>;
  /** When true, show Setujui / Tolak action buttons. View-only otherwise. */
  isOwner?: boolean;
  /** Disables action buttons (e.g. while a parent mutation is in-flight). */
  disabled?: boolean;
  /** Optional display name for the actor — falls back to the raw user id. */
  actorName?: string;
}

const TYPE_LABEL: Record<ApprovalRequestType, string> = {
  adjustment: 'Adjustment',
  opname: 'Stok Opname',
  price_change: 'Harga / HPP',
  kasir_price_override: 'Kasir Override',
  kasir_void: 'Kasir Void',
  kasir_refund: 'Kasir Refund',
  rakit_lock: 'Rakit Lock',
  customer_credit_activate: 'Aktifkan Kredit',
  customer_credit_limit_change: 'Ubah Limit Kredit',
  customer_credit_deactivate: 'Nonaktifkan Kredit',
};

const TYPE_ICON: Record<
  ApprovalRequestType,
  { icon: string; bg: string; fg: string }
> = {
  adjustment:                   { icon: '📊', bg: 'bg-rose-50',    fg: 'text-rose-600'    },
  opname:                       { icon: '🧮', bg: 'bg-blue-50',    fg: 'text-blue-700'    },
  price_change:                 { icon: '💰', bg: 'bg-blue-50',    fg: 'text-blue-700'    },
  kasir_price_override:         { icon: '🧾', bg: 'bg-violet-50',  fg: 'text-violet-700'  },
  kasir_void:                   { icon: '💸', bg: 'bg-violet-50',  fg: 'text-violet-700'  },
  kasir_refund:                 { icon: '💸', bg: 'bg-violet-50',  fg: 'text-violet-700'  },
  rakit_lock:                   { icon: '🔧', bg: 'bg-amber-50',   fg: 'text-amber-700'   },
  customer_credit_activate:     { icon: '✅', bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  customer_credit_limit_change: { icon: '💳', bg: 'bg-sky-50',     fg: 'text-sky-700'     },
  customer_credit_deactivate:   { icon: '🚫', bg: 'bg-slate-50',   fg: 'text-slate-700'   },
};

const STATUS_PILL: Record<ApprovalStatus, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired:  'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending:  'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  expired:  'Kedaluwarsa',
};

/** "8 menit lalu" — minimal Indonesian relative-time formatter. */
function relativeId(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID');
}

function formatRupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

/**
 * Distil a single-line, Indonesian summary out of the request payload.
 * Each request_type produces its payload via the corresponding RPC
 * (request_adjustment, request_price_change, kasir_request_*); the keys
 * referenced here mirror those RPC contracts.
 */
function summarisePayload(req: ApprovalRequest): string {
  const p = req.payload ?? {};
  const get = (k: string) => (p as Record<string, unknown>)[k];
  const num = (k: string): number | undefined => {
    const v = get(k);
    return typeof v === 'number' ? v : undefined;
  };
  const str = (k: string): string | undefined => {
    const v = get(k);
    return typeof v === 'string' ? v : undefined;
  };

  switch (req.requestType) {
    case 'adjustment': {
      const sku = str('sku');
      const name = str('name') ?? str('item_name');
      const qty = num('qty_delta');
      const warehouse = str('warehouse');
      const reason = str('reason_code');
      const value = num('value');
      const parts: string[] = [];
      if (name) parts.push(name); else if (sku) parts.push(sku);
      if (qty !== undefined) parts.push(`${qty > 0 ? '+' : ''}${qty} pcs`);
      if (warehouse) parts.push(`gudang ${warehouse}`);
      if (reason) parts.push(reason);
      if (value !== undefined) parts.push(formatRupiah(value));
      return parts.join(' · ') || 'Permintaan adjustment';
    }
    case 'opname': {
      const sessionId = num('session_id') ?? num('opname_session_id');
      const variance = num('variance_total_value');
      const parts: string[] = [];
      if (sessionId !== undefined) parts.push(`Sesi #${sessionId}`);
      if (variance !== undefined) parts.push(`varians ${formatRupiah(variance)}`);
      return parts.join(' · ') || 'Commit hasil opname';
    }
    case 'price_change': {
      const sku = str('sku');
      const field = str('field');
      const newVal = num('new_value');
      const oldVal = num('old_value');
      const fieldLabel = field === 'harga_modal' ? 'HPP' : 'Harga';
      const parts: string[] = [];
      if (sku) parts.push(sku);
      parts.push(fieldLabel);
      if (oldVal !== undefined && newVal !== undefined) {
        parts.push(`${formatRupiah(oldVal)} → ${formatRupiah(newVal)}`);
      } else if (newVal !== undefined) {
        parts.push(`baru ${formatRupiah(newVal)}`);
      }
      return parts.join(' · ');
    }
    case 'kasir_price_override': {
      const sku = str('sku');
      const def = num('default_price');
      const req2 = num('requested_price');
      const parts: string[] = [];
      if (sku) parts.push(sku);
      if (def !== undefined && req2 !== undefined) {
        parts.push(`${formatRupiah(def)} → ${formatRupiah(req2)}`);
      }
      return parts.join(' · ') || 'Override harga kasir';
    }
    case 'kasir_void': {
      const txn = str('transaction_id') ?? str('order_id');
      const total = num('total');
      const parts: string[] = ['Void transaksi'];
      if (txn) parts.push(txn);
      if (total !== undefined) parts.push(formatRupiah(total));
      return parts.join(' · ');
    }
    case 'kasir_refund': {
      const txn = str('transaction_id') ?? str('order_id');
      const total = num('refund_total') ?? num('total');
      const parts: string[] = ['Refund'];
      if (txn) parts.push(txn);
      if (total !== undefined) parts.push(formatRupiah(total));
      return parts.join(' · ');
    }
    case 'customer_credit_activate':
      return `Aktifkan tempo untuk ${get('customer_id')} — Net ${get('term_days')} hari, limit ${formatRupiah(Number(get('credit_limit') ?? 0))}`;

    case 'customer_credit_limit_change':
      return `Ubah limit tempo ${get('customer_id')} → ${formatRupiah(Number(get('new_limit') ?? 0))} (alasan: ${get('reason')})`;

    case 'customer_credit_deactivate':
      return `Nonaktifkan tempo ${get('customer_id')} (alasan: ${get('reason')})`;

    default:
      return 'Permintaan persetujuan';
  }
}

export default function ApprovalRequestRow({
  request,
  onApprove,
  onReject,
  isOwner = false,
  disabled = false,
  actorName,
}: ApprovalRequestRowProps) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const lock = disabled || busy !== null;

  const icon = TYPE_ICON[request.requestType] ?? TYPE_ICON.adjustment;
  const typeLabel = TYPE_LABEL[request.requestType] ?? request.requestType;
  const statusPill = STATUS_PILL[request.status] ?? STATUS_PILL.pending;
  const statusLabel = STATUS_LABEL[request.status] ?? request.status;
  const summary = summarisePayload(request);
  const note = (request.payload as Record<string, unknown>)?.reason_note;
  const reasonNote = typeof note === 'string' && note.trim().length > 0 ? note : null;

  const showActions = isOwner && request.status === 'pending';

  const handleApprove = async () => {
    if (lock) return;
    setBusy('approve');
    try {
      await onApprove(request.id);
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (lock) return;
    setBusy('reject');
    try {
      await onReject(request.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[#e5eeff] p-4 bg-white">
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-2xl ${icon.bg} ${icon.fg} flex items-center justify-center text-base flex-shrink-0`}
          aria-hidden="true"
        >
          {icon.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-block rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5">
              {typeLabel}
            </span>
            <span className="text-xs font-bold text-[#012749]">
              {actorName ?? request.requestedBy}
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {relativeId(request.requestedAt)}
              </span>
              <span className={`inline-block rounded-full text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 ${statusPill}`}>
                {statusLabel}
              </span>
            </span>
          </div>
          <p className="text-sm text-slate-800 break-words">{summary}</p>
          {reasonNote && (
            <p className="text-xs italic text-slate-500 mt-1 break-words">
              &ldquo;{reasonNote}&rdquo;
            </p>
          )}
          {showActions && (
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={handleReject}
                disabled={lock}
                className="px-4 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 text-xs font-extrabold hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'reject' ? 'Menolak…' : 'Tolak'}
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={lock}
                className="px-4 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-extrabold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'approve' ? 'Menyetujui…' : 'Setujui'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
