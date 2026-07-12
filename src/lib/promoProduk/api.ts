import { supabase } from '../supabaseClient';
import type {
  PromoRow,
  UpsertPromoInput,
  BulkUpsertPromoInput,
  BulkUpsertResultRow,
  PromoSummary,
  PromoFilter,
} from './types';

export async function upsertStockPromo(input: UpsertPromoInput): Promise<void> {
  const { error } = await supabase.rpc('upsert_stock_promo', {
    p_sku: input.sku,
    p_promo_discount_type: input.promoDiscountType,
    p_promo_discount_value: input.promoDiscountValue,
    p_promo_expires_at: input.promoExpiresAt,
  });
  if (error) throw error;
}

export async function bulkUpsertStockPromo(
  input: BulkUpsertPromoInput,
): Promise<BulkUpsertResultRow[]> {
  const { data, error } = await supabase.rpc('bulk_upsert_stock_promo', {
    p_skus: input.skus,
    p_promo_discount_type: input.promoDiscountType,
    p_promo_discount_value: input.promoDiscountValue,
    p_promo_expires_at: input.promoExpiresAt,
  });
  if (error) throw error;
  return (data ?? []) as BulkUpsertResultRow[];
}

export async function listActivePromos(
  filter: PromoFilter = 'active',
): Promise<PromoRow[]> {
  const { data, error } = await supabase.rpc('list_active_promos', {
    p_filter: filter,
  });
  if (error) throw error;
  return (data ?? []) as PromoRow[];
}

export async function getPromoSummary(): Promise<PromoSummary> {
  const { data, error } = await supabase.rpc('get_promo_summary');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (
    (row as PromoSummary | undefined) ?? {
      total_active: 0,
      expiring_7d: 0,
      expired_30d: 0,
    }
  );
}
