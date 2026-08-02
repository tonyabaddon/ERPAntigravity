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

interface CustomerSummary {
  id: string;
  name: string;
  wa_number?: string;
  company?: string;
}

function fmtRp(n: number | undefined): string {
  if (n == null) return '—';
  return formatIDR(Math.round(n));
}

export default function CustomerCreditActivateApprovalRequestRow({
  request, isOwner, disabled, actorName, onApprove, onReject,
}: Props) {
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const payload = request.payload as Record<string, unknown>;
  const requestedLimit = (payload?.credit_limit ?? payload?.requested_limit) as number | undefined;
  const requestedTerm = (payload?.term_days ?? payload?.requested_term) as number | undefined;
  const reason = payload?.reason as string | undefined;
  const customerId = payload?.customer_id as string | undefined;

  useEffect(() => {
    if (!supabase || !customerId) return;
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, wa_number, company')
        .eq('id', customerId)
        .single();
      if (data) setCustomer(data as CustomerSummary);
    })();
  }, [customerId]);

  return (
    <div className="bg-white rounded border border-slate-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-extrabold uppercase tracking-wider">
              Aktivasi TEMPO
            </span>
            <span className="text-slate-500">#{request.id}</span>
            {actorName && <span className="text-slate-500">oleh <strong>{actorName}</strong></span>}
          </div>
          <div className="text-sm">
            {customer?.name ?? '—'}
            {customer?.company && <span className="text-slate-500 ml-2">{customer.company}</span>}
            {customer?.wa_number && <span className="text-slate-400 font-mono ml-2">{customer.wa_number}</span>}
          </div>
          <div className="text-xs flex gap-4">
            <div><span className="text-slate-500">Limit:</span> <strong>{fmtRp(requestedLimit)}</strong></div>
            <div><span className="text-slate-500">Term:</span> <strong>{requestedTerm} hari</strong></div>
          </div>
          {reason && (
            <div className="text-xs text-slate-700 italic max-w-md">"{reason}"</div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRejectOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApprove(request.id)}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Setujui Aktivasi
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
            className="w-full text-sm border border-slate-300 rounded px-3 py-2"
            placeholder="Mis: limit terlalu tinggi untuk customer baru…"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}
              className="px-3 py-1.5 text-xs font-semibold rounded text-slate-700 hover:bg-slate-100"
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
              className="px-3 py-1.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700"
            >
              Konfirmasi Tolak
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
