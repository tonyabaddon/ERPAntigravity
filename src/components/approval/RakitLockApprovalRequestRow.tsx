// src/components/approval/RakitLockApprovalRequestRow.tsx
import React, { useEffect, useState } from 'react';
import type { ApprovalRequest, RakitJobLine, RakitLockRequest } from '../../types';
import { fetchRakitLockRequestByApprovalId } from '../../lib/supabaseClient';
import { formatIDR } from '../../lib/formatIDR';

interface RakitLockApprovalRequestRowProps {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  onApprove: (id: number) => void | Promise<void>;
  onReject: (id: number, reason?: string) => void | Promise<void>;
  /**
   * Owner-only: opens LockSubmissionModal in owner-amend mode. Receives the
   * approval id plus the snapshot already converted to RakitJobLine shape
   * (so the modal can seed its component drafts directly).
   */
  onEditAndApprove?: (id: number, transactionId: string, lines: RakitJobLine[]) => void;
}


/**
 * Convert a stored linesSnapshot entry (snake_case JSONB as written by
 * requestRakitLock) into a RakitJobLine (camelCase) suitable for seeding
 * LockSubmissionModal in owner-amend mode. transactionId/lineNumber/serviceType
 * are not present in the snapshot but are not used by the modal's seed path —
 * fill with safe placeholders to satisfy the type.
 */
function snapshotToRakitJobLine(transactionId: string, raw: unknown, idx: number): RakitJobLine {
  const r = raw as Record<string, unknown>;
  const rawComps = Array.isArray(r.components) ? r.components : [];
  const components = rawComps.map((c: unknown) => {
    const comp = c as Record<string, unknown>;
    return {
      sku: String(comp.sku ?? ''),
      name: String(comp.name ?? ''),
      qty: Number(comp.qty ?? 0),
      warehouse: ((comp.warehouse ?? 'atas') as string) === 'bawah' ? 'bawah' as const : 'atas' as const,
      fifoCostSnapshot: Number(comp.fifo_cost ?? 0),
      // Modal's seed reads `warehouse_id` + `fifo_cost` off the component via
      // a structural cast — attach them as extra fields so the modal can pick
      // them up without losing the warehouse UUID stored in the snapshot.
      warehouse_id: comp.warehouse_id as string | undefined,
      fifo_cost: Number(comp.fifo_cost ?? 0),
    };
  });
  return {
    id: String(r.id ?? `snapshot-${idx}`),
    transactionId,
    lineNumber: idx + 1,
    serviceType: 'jasa_rakit', // not used by modal's seed; placeholder
    description: String(r.description ?? ''),
    estimatedPrice: Number(r.final_price ?? 0),
    finalPrice: Number(r.final_price ?? 0),
    trackingMode: ((r.tracking_mode ?? 'detail') as string) === 'lumpsum' ? 'lumpsum' : 'detail',
    laborCost: Number(r.labor_cost ?? 0),
    lumpSumHpp: Number(r.lump_sum_hpp ?? 0),
    hppOwnerOverride: null,
    hppFinal: null,
    components,
  };
}

export default function RakitLockApprovalRequestRow({
  request,
  isOwner,
  disabled,
  onApprove,
  onReject,
  onEditAndApprove,
}: RakitLockApprovalRequestRowProps) {
  const [snapshot, setSnapshot] = useState<RakitLockRequest | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    void fetchRakitLockRequestByApprovalId(request.id).then(setSnapshot);
  }, [request.id]);

  const lines: unknown[] = snapshot?.linesSnapshot ?? [];
  const totalFinal: number = lines.reduce<number>((s, l) => {
    const row = l as Record<string, unknown>;
    return s + Number(row.final_price ?? 0);
  }, 0);
  const totalHpp: number = lines.reduce<number>((s, l) => {
    const row = l as Record<string, unknown>;
    if (row.tracking_mode === 'lumpsum') {
      return s + Number(row.lump_sum_hpp ?? 0);
    }
    const comps: unknown[] = Array.isArray(row.components) ? row.components : [];
    const compsHpp: number = comps.reduce<number>(
      (cs, c) => {
        const comp = c as Record<string, unknown>;
        return cs + Number(comp.fifo_cost ?? 0) * Number(comp.qty ?? 0);
      },
      0,
    );
    return s + compsHpp + Number(row.labor_cost ?? 0);
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
    <div className="rounded border border-orange-200 bg-orange-50/30 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded bg-orange-100 text-orange-700 flex items-center justify-center text-base flex-shrink-0">🛠</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-block rounded-full bg-orange-200 text-orange-800 text-caleo-10 font-extrabold uppercase tracking-wider px-2 py-0.5">
              Rakit Lock
            </span>
            <span className="text-xs font-bold text-[var(--color-caleo-primary)]">{request.requestedBy.slice(0, 8)}…</span>
            <span className="ml-auto text-xs text-slate-500">
              {new Date(request.requestedAt).toLocaleString('id-ID')}
            </span>
          </div>
          {!snapshot ? (
            <p className="text-xs italic text-slate-500">Memuat snapshot…</p>
          ) : (
            <>
              <p className="text-sm text-slate-800">
                {lines.length} line · {lines.map((l) => (l as Record<string, unknown>).description as string).join(' · ')}
              </p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs">Final: <strong>{formatIDR(totalFinal)}</strong></span>
                <span className="text-xs">HPP: <strong>{formatIDR(totalHpp)}</strong></span>
                <span className={`text-xs font-bold ${marginWarn ? 'text-caleo-danger' : 'text-caleo-success'}`}>
                  {marginWarn ? '⚠ ' : ''}Margin: {formatIDR(margin)} ({marginPct.toFixed(1)}%)
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded(s => !s)}
                  className="ml-auto text-caleo-11 underline text-slate-500 hover:text-slate-700"
                >
                  {expanded ? 'Tutup detail' : 'Lihat detail komponen'}
                </button>
              </div>
              {expanded && (
                <div className="mt-2 bg-white border border-slate-200 rounded p-2 text-xs space-y-1">
                  {lines.map((l, idx) => {
                    const row = l as Record<string, unknown>;
                    const comps = Array.isArray(row.components) ? row.components : [];
                    return (
                      <div key={idx} className="border-b last:border-b-0 border-slate-100 pb-1">
                        <div className="font-bold">{row.description as string} — {formatIDR(Number(row.final_price ?? 0))}</div>
                        {comps.length > 0 ? (
                          <ul className="ml-3 text-slate-600">
                            {comps.map((c: unknown, ci: number) => {
                              const comp = c as Record<string, unknown>;
                              return (
                                <li key={ci}>
                                  {comp.sku as string} {comp.name as string} — qty {comp.qty as number} {comp.warehouse as string} @ FIFO {formatIDR(Number(comp.fifo_cost ?? 0))}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="ml-3 text-slate-500 italic">Lumpsum HPP: {formatIDR(Number(row.lump_sum_hpp ?? 0))}</div>
                        )}
                      </div>
                    );
                  })}
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
                className="px-4 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-caleo-danger text-xs font-extrabold hover:bg-rose-100 disabled:opacity-50"
              >
                {busy === 'reject' ? 'Menolak…' : 'Tolak'}
              </button>
              {isOwner && onEditAndApprove && snapshot && (
                <button
                  type="button"
                  onClick={() =>
                    onEditAndApprove(
                      request.id,
                      snapshot.transactionId,
                      snapshot.linesSnapshot.map((l, idx) =>
                        snapshotToRakitJobLine(snapshot.transactionId, l, idx),
                      ),
                    )
                  }
                  disabled={disabled || !!busy}
                  className="px-4 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-xs font-extrabold hover:bg-amber-100 disabled:opacity-50"
                >
                  ✏️ Edit &amp; Setujui
                </button>
              )}
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
