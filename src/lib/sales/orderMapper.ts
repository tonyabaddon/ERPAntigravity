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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (raw as any[])
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToOrder(row: any): Order {
  const subStage = (row.funnel_sub_stage ?? '1a') as Order['funnel_sub_stage'];
  const meta = (() => { try { return getSubStageMeta(subStage); } catch { return null; } })();
  const createdAt = row.created_at ? new Date(row.created_at) : new Date();
  const wipStartedAt = row.wip_started_at ? new Date(row.wip_started_at) : null;
  const ageMs = Date.now() - createdAt.getTime();
  const isStuck = subStage === '2c' && ageMs > 7 * 24 * 3600 * 1000;
  return {
    id: row.id,
    customer: row.customer_name ?? '—',
    total: Number(row.subtotal ?? 0),
    channel: row.channel ?? 'WhatsApp',
    order_type: row.order_type ?? 'KOMPONEN',
    funnel_stage: row.funnel_stage ?? 1,
    funnel_sub_stage: subStage,
    delivery_method: row.delivery_method ?? 'PICKUP',
    version: row.version ?? 1,
    payment_type: normalizePaymentType(row.payment_type),
    payment_proof_url: row.payment_proof_url ?? undefined,
    pelunasan_proof_url: row.pelunasan_proof_url ?? undefined,
    marketplace_proof_url: row.marketplace_proof_url ?? undefined,
    proof_source: row.proof_source ?? undefined,
    estimated_completion_days: row.estimated_completion_days ?? undefined,
    hari_progress: wipStartedAt ? Math.floor((Date.now() - wipStartedAt.getTime()) / (24 * 3600 * 1000)) : undefined,
    status_label: meta?.name ?? 'Status',
    time_ago: formatTimeAgo(ageMs),
    stuck: isStuck,
    items: normalizeItems(row.items),
    ongkir_amount: row.ongkir_amount != null ? Number(row.ongkir_amount) : undefined,
    dp_amount: row.dp_amount != null ? Number(row.dp_amount) : undefined,
    payment_method: row.payment_method ?? undefined,
    customer_phone: row.customer_phone ?? undefined,
    customer_address: row.customer_address ?? undefined,
    delivery_address: row.delivery_address ?? undefined,
  };
}
