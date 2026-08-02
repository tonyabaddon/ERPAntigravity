// OrderBnlSection — embedded in OrderHistoryScreen (per C5: OrderDetailPage
// doesn't exist; integration target is OrderHistoryScreen). Shows BNLs
// linked to a given Order + a "+ Buat PI untuk Order ini" shortcut.
import React, { useEffect, useState } from 'react';
import { Zap, Plus } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import PiStatusBadge from './PiStatusBadge';
import { formatIDR } from '../../../lib/formatIDR';
import { captureError } from '../../../lib/captureError';
import EmptyState from '../../ui/EmptyState';

interface Props {
  orderId: string;
  customerName?: string;
  /** When provided, the new-PI button opens Pembelian in a new tab pre-filled. */
  newTabUrl?: boolean;
}


export default function OrderBnlSection({ orderId, customerName, newTabUrl = true }: Props) {
  const [pis, setPis] = useState<DbPurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    purchaseInvoiceService.fetchByOrderId(orderId)
      .then(setPis)
      .catch((err) => {
        captureError(err, { feature: 'pembelian_bnl', action: 'fetch_by_order_id' });
        setPis([]);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  function openCreate() {
    if (newTabUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('screen', 'pembelian');
      url.searchParams.delete('po');
      url.searchParams.delete('bnl');
      url.searchParams.set('bnl-new-for-order', orderId);
      if (customerName) url.searchParams.set('bnl-new-customer', customerName);
      window.open(url.toString(), '_blank');
    }
  }

  if (loading) return null;
  if (pis.length === 0) {
    return (
      <div className="mt-3 flex items-center justify-between bg-violet-50/40 border border-violet-200 rounded px-3 py-2">
        <div className="flex items-center gap-1.5 text-violet-700">
          <Zap className="w-3 h-3 shrink-0" />
          <EmptyState message="Belum ada Purchase Invoice (pass-through) untuk Order ini." inline className="text-violet-700" />
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1 text-caleo-11 font-bold text-violet-700 px-2 py-1 rounded bg-white border border-violet-200 hover:bg-violet-50">
          <Plus className="w-3 h-3" /> Buat PI
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 bg-violet-50/40 border border-violet-200 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-caleo-11 font-bold uppercase tracking-wide text-violet-700 flex items-center gap-1.5">
          <Zap className="w-3 h-3" /> Purchase Invoice Terkait ({pis.length})
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1 text-caleo-11 font-bold text-violet-700 px-2 py-1 rounded bg-white border border-violet-200 hover:bg-violet-50">
          <Plus className="w-3 h-3" /> Buat PI
        </button>
      </div>
      <div className="space-y-1.5">
        {pis.map(pi => (
          <a
            key={pi.id}
            href={`?screen=pembelian&bnl=${pi.pi_number}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 bg-white rounded border border-gray-200 px-2 py-1.5 text-xs hover:bg-violet-50"
          >
            <div className="font-bold text-[var(--color-caleo-primary)]">{pi.pi_number}</div>
            <PiStatusBadge pi={pi} />
            <div className="text-gray-500 flex-1">{pi.supplier?.name ?? '—'} • {pi.items?.length ?? 0} item</div>
            <div className="font-bold text-[var(--color-caleo-primary)]">{formatIDR(pi.total)}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
