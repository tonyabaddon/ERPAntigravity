import type { Order, OrderItem, PaymentType } from './types';
import { getSubStageMeta } from './stageMapping';

export function normalizePaymentType(s: unknown): PaymentType {
  const v = String(s ?? 'FULL').toUpperCase();
  if (v === 'DP' || v === 'TEMPO') return v;
  return 'FULL';
}

// Items column on kasir_transactions is JSONB defaulting to []. Defensive
// normalize so PDF generators see a clean array of {name, qty, subtotal} rows.
function normalizeItems(raw: unknown): OrderItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = (raw as Array<Record<string, unknown>>)
    .filter(it => it && typeof it === 'object')
    .map(it => ({
      name: String(it.name ?? it.product_name ?? ''),
      qty: Number(it.qty ?? it.quantity ?? 0),
      unit_price: it.unit_price != null ? Number(it.unit_price) : undefined,
      subtotal: Number(it.subtotal ?? 0),
    }));
  return items.length > 0 ? items : undefined;
}

export function formatTimeAgo(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

export function rowToOrder(row: Record<string, unknown>): Order {
  const subStage = (row.funnel_sub_stage ?? '1a') as Order['funnel_sub_stage'];
  const meta = (() => { try { return getSubStageMeta(subStage); } catch { return null; } })();
  const createdAt = row.created_at ? new Date(row.created_at as string) : new Date();
  const wipStartedAt = row.wip_started_at ? new Date(row.wip_started_at as string) : null;
  const ageMs = Date.now() - createdAt.getTime();
  const isStuck = subStage === '2c' && ageMs > 7 * 24 * 3600 * 1000;
  return {
    id: row.id as string,
    customer: (row.customer_name as string | null) ?? '—',
    total: Number(row.subtotal ?? 0),
    channel: (row.channel as string | null) ?? 'WhatsApp',
    order_type: (row.order_type as Order['order_type'] | null) ?? 'KOMPONEN',
    funnel_stage: (row.funnel_stage as Order['funnel_stage'] | null) ?? 1,
    funnel_sub_stage: subStage,
    delivery_method: (row.delivery_method as Order['delivery_method'] | null) ?? 'PICKUP',
    version: (row.version as number | null) ?? 1,
    payment_type: normalizePaymentType(row.payment_type),
    payment_proof_url: (row.payment_proof_url as string | undefined) ?? undefined,
    pelunasan_proof_url: (row.pelunasan_proof_url as string | undefined) ?? undefined,
    marketplace_proof_url: (row.marketplace_proof_url as string | undefined) ?? undefined,
    proof_source: (row.proof_source as Order['proof_source'] | undefined) ?? undefined,
    estimated_completion_days: (row.estimated_completion_days as number | undefined) ?? undefined,
    hari_progress: wipStartedAt ? Math.floor((Date.now() - wipStartedAt.getTime()) / (24 * 3600 * 1000)) : undefined,
    status_label: meta?.name ?? 'Status',
    time_ago: formatTimeAgo(ageMs),
    stuck: isStuck,
    items: normalizeItems(row.items),
    ongkir_amount: row.ongkir_amount != null ? Number(row.ongkir_amount) : undefined,
    dp_amount: row.dp_amount != null ? Number(row.dp_amount) : undefined,
    payment_method: (row.payment_method as string | undefined) ?? undefined,
    customer_phone: (row.customer_phone as string | undefined) ?? undefined,
    customer_address: (row.customer_address as string | undefined) ?? undefined,
    delivery_address: (row.delivery_address as string | undefined) ?? undefined,
  };
}
