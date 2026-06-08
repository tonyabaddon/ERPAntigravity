import type { DbOrder, KasirTransaction, SalesEntry, SalesChannel } from '../types';

export function orderToSalesEntry(o: DbOrder): SalesEntry {
  return {
    source: 'order',
    id: `order:${o.id}`,
    display_id: o.gjp_order_id ?? o.id.slice(0, 8),
    channel: (o.sales_channel ?? 'whatsapp') as SalesChannel,
    customer_id: o.customer_id ?? null,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_company: o.customer_company,
    items: (o.items ?? []).map(i => ({ name: i.name, qty: i.qty, sku: i.sku })),
    total: o.total,
    status: o.status,
    created_at: o.created_at,
    walkin_order_id: o.sales_channel === 'walkin' ? o.id : null,
  };
}

export function kasirToSalesEntry(t: KasirTransaction): SalesEntry {
  // Kasir income rows are always paid at insert time.
  const channel: SalesChannel = (t.channel ?? 'walkin') as SalesChannel;
  return {
    source: 'kasir',
    id: `kasir:${t.id}`,
    display_id: t.invoice_number ?? t.id.slice(0, 8),
    channel,
    customer_id: t.customer_id ?? null,
    customer_name: t.customer_name ?? '(Tanpa Nama)',
    customer_phone: t.customer_phone ?? null,
    customer_company: t.customer_company ?? null,
    items: (t.items ?? []).map(i => ({ name: i.name, qty: i.qty, sku: i.sku })),
    total: t.subtotal,
    status: 'PAID',
    created_at: t.created_at,
    walkin_order_id: null,
  };
}

export function mergeSalesEntries(
  orders: DbOrder[],
  kasir: KasirTransaction[]
): SalesEntry[] {
  const entries: SalesEntry[] = [
    ...orders.map(orderToSalesEntry),
    ...kasir.filter(t => t.type === 'income').map(kasirToSalesEntry),
  ];
  return entries.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  whatsapp:  'WhatsApp',
  walkin:    'Walk-in',
  tokopedia: 'Tokopedia',
  grosir:    'Grosir',
};

export const CHANNEL_BADGE_CLASS: Record<SalesChannel, string> = {
  whatsapp:  'bg-emerald-100 text-emerald-800',
  walkin:    'bg-slate-100 text-slate-700',
  tokopedia: 'bg-green-100 text-green-800',
  grosir:    'bg-amber-100 text-amber-800',
};
