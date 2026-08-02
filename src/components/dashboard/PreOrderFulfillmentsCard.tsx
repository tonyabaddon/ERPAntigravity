// PreOrderFulfillmentsCard.tsx
//
// Consumes `audit_log.event_type='preorder_fulfilled'` events (emitted by
// `record_pi` migration 20260630000005 when an SKU's pre-call balance is
// negative). Lists last 7 days of fulfillments with per-customer WA notify
// buttons. Notifications fire manually — operator clicks "WA <name>", we
// open wa.me with prefilled text. No auto-send (per founder choice B5 in
// brainstorming session, captured in spec).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { captureError } from '../../lib/captureError';

interface CustomerSummary {
  id: string;
  name: string;
  wa_number?: string | null;
}

interface FulfillmentRow {
  audit_id: number;
  sku: string;
  qty_fulfilled: number;
  pending_order_ids: string[];
  customer_summaries: CustomerSummary[];
  fulfilled_at: string;
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PreOrderFulfillmentsCard({ showToast }: Props) {
  const [rows, setRows] = useState<FulfillmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, payload, created_at')
        .eq('event_type', 'preorder_fulfilled')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        captureError(error, { feature: 'dashboard', action: 'fetch_preorder_fulfillments' });
        setLoading(false);
        return;
      }

      const rowsRaw: FulfillmentRow[] = (data ?? []).map((r) => {
        const payload = r.payload as Record<string, unknown> | null;
        return {
          audit_id: r.id,
          sku: (payload?.sku as string | undefined) ?? '?',
          qty_fulfilled: (payload?.qty_fulfilled as number | undefined) ?? 0,
          pending_order_ids: (payload?.pending_order_ids as string[] | undefined) ?? [],
          customer_summaries: [],
          fulfilled_at: r.created_at,
        };
      });

      // Hydrate customer info per row (best-effort batch). The audit payload
      // captures order IDs that were pending; we resolve those to their
      // customer via orders.customer_id so the operator sees who to notify.
      const allOrderIds = Array.from(new Set(rowsRaw.flatMap((r) => r.pending_order_ids)));
      if (allOrderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, customer_id, customers(id, name, wa_number)')
          .in('id', allOrderIds);
        // Supabase FK join returns arrays even for single-row joins; unwrap [0].
        const byOrderId = new Map<string, CustomerSummary | null>(
          (orders ?? []).map((o) => [
            o.id,
            (Array.isArray(o.customers) ? o.customers[0] : o.customers) as CustomerSummary | null,
          ]),
        );
        for (const r of rowsRaw) {
          r.customer_summaries = r.pending_order_ids
            .map((oid) => byOrderId.get(oid))
            .filter((c): c is CustomerSummary => !!c);
        }
      }

      setRows(rowsRaw);
      setLoading(false);
    })();
  }, []);

  const onNotifyWA = (cust: CustomerSummary, sku: string) => {
    if (!cust.wa_number) {
      showToast('Customer ini tidak punya nomor WA', 'warning');
      return;
    }
    const phone = cust.wa_number.replace(/^0/, '62');
    const text = encodeURIComponent(
      `Halo ${cust.name}, kabar baik — pesanan pre-order Anda (SKU ${sku}) sudah tiba di toko. Bisa diambil/dikirim sesuai kesepakatan. Terima kasih!`,
    );
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
  };

  return (
    <div className="bg-white rounded border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)]">Pre-order ter-fulfill (7 hari terakhir)</h3>
        <span className="text-caleo-10 uppercase tracking-wider text-slate-400 font-bold">Notify customer manual</span>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Belum ada pre-order yang ter-fulfill minggu ini.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.audit_id} className="py-2 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs"><strong>{r.sku}</strong> &middot; {r.qty_fulfilled} unit</div>
                <div className="text-caleo-11 text-slate-500 truncate">
                  {r.customer_summaries.map((c) => c.name).filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                {r.customer_summaries.slice(0, 3).map((c, i) => (
                  c.wa_number ? (
                    <button
                      key={`${r.audit_id}-${i}`}
                      onClick={() => onNotifyWA(c, r.sku)}
                      className="px-2 py-1 text-caleo-11 font-semibold rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    >
                      WA {c.name.split(' ')[0]}
                    </button>
                  ) : null
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
