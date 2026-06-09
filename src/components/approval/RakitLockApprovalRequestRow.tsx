// src/components/approval/RakitLockApprovalRequestRow.tsx
import React, { useEffect, useState } from 'react';
import type { ApprovalRequest, RakitLockRequest } from '../../types';
import { fetchRakitLockRequestByApprovalId } from '../../lib/supabaseClient';

interface RakitLockApprovalRequestRowProps {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  onApprove: (id: number) => void | Promise<void>;
  onReject: (id: number, reason?: string) => void | Promise<void>;
}

function formatRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function RakitLockApprovalRequestRow({
  request,
  isOwner,
  disabled,
  onApprove,
  onReject,
}: RakitLockApprovalRequestRowProps) {
  const [snapshot, setSnapshot] = useState<RakitLockRequest | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    void fetchRakitLockRequestByApprovalId(request.id).then(setSnapshot);
  }, [request.id]);

  const lines: any[] = (snapshot?.linesSnapshot as any[]) ?? [];
  const totalFinal = lines.reduce((s: number, l: any) => s + Number(l.final_price ?? 0), 0);
  const totalHpp = lines.reduce((s: number, l: any) => {
    const compsHpp = (l.components ?? []).reduce(
      (cs: number, c: any) => cs + Number(c.fifo_cost ?? 0) * Number(c.qty ?? 0),
      0,
    );
    return s + compsHpp + Number(l.labor_cost ?? l.lump_sum_hpp ?? 0);
  }, 0);
  const margin = totalFinal - totalHpp;
  const marginPct = totalFinal > 0 ? (margin / totalFinal) * 100 : 0;
  const marginWarn = marginPct < 10;

  const showActions = isOwner && request.status === 'pending';

  const doApprove = async () => {
    if (disabled || busy) return;
    setBusy('approve');
    try {
      await onApprove(request.id);
    } finally {
      setBusy(null);
    }
  };
  const doReject = async () => {
    if (disabled || busy) return;
    setBusy('reject');
    try {
      await onReject(request.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50/30 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center text-base flex-shrink-0">🛠</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-block rounded-full bg-orange-200 text-orange-800 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5">
              Rakit Lock
            </span>
            <span className="text-xs font-bold text-[#012749]">{request.requestedBy.slice(0, 8)}…</span>
            <span className="ml-auto text-xs text-slate-500">
              {new Date(request.requestedAt).toLocaleString('id-ID')}
            </span>
          </div>
          {!snapshot ? (
            <p className="text-xs italic text-slate-500">Memuat snapshot…</p>
          ) : (
            <>
              <p className="text-sm text-slate-800">
                {lines.length} line · {lines.map((l: any) => l.description).join(' · ')}
              </p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-[12px]">Final: <strong>{formatRp(totalFinal)}</strong></span>
                <span className="text-[12px]">HPP: <strong>{formatRp(totalHpp)}</strong></span>
                <span className={`text-[12px] font-bold ${marginWarn ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {marginWarn ? '⚠ ' : ''}Margin: {formatRp(margin)} ({marginPct.toFixed(1)}%)
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded(s => !s)}
                  className="ml-auto text-[11px] underline text-slate-500 hover:text-slate-700"
                >
                  {expanded ? 'Tutup detail' : 'Lihat detail komponen'}
                </button>
              </div>
              {expanded && (
                <div className="mt-2 bg-white border border-slate-200 rounded-lg p-2 text-[12px] space-y-1">
                  {lines.map((l: any, idx: number) => (
                    <div key={idx} className="border-b last:border-b-0 border-slate-100 pb-1">
                      <div className="font-bold">{l.description} — {formatRp(Number(l.final_price ?? 0))}</div>
                      {(l.components ?? []).length > 0 ? (
                        <ul className="ml-3 text-slate-600">
                          {(l.components ?? []).map((c: any, ci: number) => (
                            <li key={ci}>
                              {c.sku} {c.name} — qty {c.qty} {c.warehouse} @ FIFO {formatRp(Number(c.fifo_cost ?? 0))}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="ml-3 text-slate-500 italic">Lumpsum HPP: {formatRp(Number(l.lump_sum_hpp ?? 0))}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {showActions && (
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={doReject}
                disabled={disabled || !!busy}
                className="px-4 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 text-xs font-extrabold hover:bg-rose-100 disabled:opacity-50"
              >
                {busy === 'reject' ? 'Menolak…' : 'Tolak'}
              </button>
              <button
                type="button"
                onClick={doApprove}
                disabled={disabled || !!busy}
                className="px-4 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-extrabold hover:bg-emerald-700 disabled:opacity-50"
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
