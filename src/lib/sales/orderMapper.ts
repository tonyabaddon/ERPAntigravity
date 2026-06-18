import type { Order, PaymentType } from './types';
import { getSubStageMeta } from './stageMapping';

export function normalizePaymentType(s: unknown): PaymentType {
  const v = String(s ?? 'FULL').toUpperCase();
  if (v === 'DP' || v === 'TEMPO') return v;
  return 'FULL';
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
  };
}
