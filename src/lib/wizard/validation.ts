import type { KasirChannel } from '../../types';

// Strings here are validated at runtime; widened to string to permit future
// channels (e.g. 'tiktok') that aren't yet in the KasirChannel union.
const MARKETPLACE_CHANNELS: readonly string[] = ['tokopedia', 'shopee', 'lazada', 'blibli', 'tiktok'];
const WHATSAPP_CHANNELS: readonly string[] = ['whatsapp'];

export interface WizardState {
  channel?: KasirChannel;
  customer?: { id: string; allows_tempo?: boolean };
  marketplace_order_no?: string;
  wa_phone?: string;
  items: Array<{ sku: string; qty: number; warehouse_id?: string }>;
  rakitLines: Array<{ type: string; description?: string; estimated_price?: number; qty?: number }>;
  payment_type?: 'FULL' | 'DP' | 'TEMPO';
}

export type ValidationResult = { ok: boolean; errors?: string[] };

export function validateStep1(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if (!s.channel) errors.push('channel wajib');
  if (!s.customer?.id) errors.push('customer wajib');
  if (s.channel && MARKETPLACE_CHANNELS.includes(s.channel) && !s.marketplace_order_no?.trim()) {
    errors.push('marketplace_order_no wajib untuk channel marketplace');
  }
  if (s.channel && WHATSAPP_CHANNELS.includes(s.channel) && !s.wa_phone?.trim()) {
    errors.push('wa_phone wajib untuk channel whatsapp');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateStep2(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if ((s.items?.length ?? 0) === 0 && (s.rakitLines?.length ?? 0) === 0) {
    errors.push('cart kosong — tambah produk atau jasa');
  }
  for (const item of s.items ?? []) {
    if (!(item.qty > 0)) errors.push(`SKU ${item.sku}: qty wajib > 0`);
    if (!item.warehouse_id) errors.push(`SKU ${item.sku}: gudang wajib dipilih`);
  }
  for (const rl of s.rakitLines ?? []) {
    if (!rl.description?.trim()) errors.push('Jasa: deskripsi wajib');
    if (!(rl.estimated_price && rl.estimated_price > 0)) errors.push('Jasa: estimasi harga wajib > 0');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateStep3(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if (!s.payment_type) errors.push('tipe pembayaran wajib');
  if (s.payment_type === 'TEMPO' && !s.customer?.allows_tempo) {
    errors.push('customer belum punya TEMPO eligibility');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function isPreOrder(
  item: { sku: string; qty: number; warehouse_id?: string },
  stockByWarehouseSku: Record<string, number>,
): boolean {
  const key = `${item.sku}|${item.warehouse_id ?? ''}`;
  const stock = stockByWarehouseSku[key] ?? 0;
  return item.qty > stock;
}

export function dispatchSave(s: WizardState): 'tempo' | 'wip' | 'standard' {
  if (s.payment_type === 'TEMPO') return 'tempo';
  if ((s.rakitLines?.length ?? 0) > 0) return 'wip';
  return 'standard';
}
