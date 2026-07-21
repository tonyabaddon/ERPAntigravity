import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { formatIDR } from '../../lib/formatIDR';

interface Props {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  actorName?: string;
  onApprove: (id: number) => void;
  onReject: (id: number, reason?: string) => void;
}

interface SatelliteSnap {
  reason: string;
  order_id: string;
  customer_name?: string;
  amount?: number;
  invoice_short?: string;
}

function fmtRp(n: number | undefined): string {
  if (n == null) return '—';
  return formatIDR(Math.round(n));
}

export default function TempoWriteOffApprovalRequestRow({
  request, isOwner, disabled, actorName, onApprove, onReject,
}: Props) {
  const [snap, setSnap] = useState<SatelliteSnap | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      // Fetch satellite + a tiny order summary in two queries (Postgres-friendly)
      const { data: sat } = await supabase
        .from('piutang_write_off_requests')
        .select('reason, order_id')
        .eq('approval_id', request.id)
        .single();
      if (!sat) return;
      const { data: ord } = await supabase
        .from('orders')
        .select('id, total, customer_name')
        .eq('id', sat.order_id)
        .single();
      setSnap({
        reason: sat.reason,
        order_id: sat.order_id,
        customer_name: ord?.customer_name ?? undefined,
        amount: ord?.total ?? undefined,
        invoice_short: ord?.id?.slice(0, 8),
      });
    })();
  }, [request.id]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-extrabold uppercase tracking-wider">
              Tulis-off
            </span>
            <span className="text-slate-500">#{request.id}</span>
            {actorName && <span className="text-slate-500">oleh <span className="font-semibold">{actorName}</span></span>}
          </div>
          <div className="text-sm">
            {snap?.customer_name ?? '—'}
            {snap?.invoice_short && <span className="text-slate-400 font-mono ml-2">{snap.invoice_short}</span>}
          </div>
          <div className="text-sm font-bold" style={{ color: '#012749' }}>{fmtRp(snap?.amount)}</div>
          {snap?.reason && (
            <div className="text-xs text-slate-700 italic max-w-md">
              "{snap.reason}"
            </div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRejectOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApprove(request.id)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Setujui Tulis-off
            </button>
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
          <label className="block text-xs font-semibold text-slate-700">Alasan penolakan</label>
          <textarea
            rows={2}
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Mis: belum coba semua channel collection..."
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                onReject(request.id, rejectReason.trim() || undefined);
                setRejectOpen(false);
                setRejectReason('');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Konfirmasi Tolak
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
