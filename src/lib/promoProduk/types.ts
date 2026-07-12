export type PromoDiscountType = 'PERCENT' | 'AMOUNT';
export type PromoStatus = 'active' | 'expiring_7d' | 'expired';
export type PromoFilter = 'active' | 'expiring_7d' | 'expired' | 'all';

export interface PromoRow {
  sku: string;
  name: string;
  category: string;
  price: number;
  promo_discount_type: PromoDiscountType;
  promo_discount_value: number;
  promo_expires_at: string | null;
  status: PromoStatus;
}

export interface UpsertPromoInput {
  sku: string;
  promoDiscountType: PromoDiscountType | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
}

export interface BulkUpsertPromoInput {
  skus: string[];
  promoDiscountType: PromoDiscountType | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
}

export interface BulkUpsertResultRow {
  sku: string;
  ok: boolean;
  error_message: string | null;
}

export interface PromoSummary {
  total_active: number;
  expiring_7d: number;
  expired_30d: number;
}

export interface PromoSnapshot {
  type: PromoDiscountType;
  value: number;
  expires_at: string | null;
  applied_at: string;
}

export function computeLinePromoDiscount(
  unitPrice: number,
  qty: number,
  promo: { promo_discount_type: PromoDiscountType; promo_discount_value: number } | null,
): { discount: number; net: number; snapshot: Pick<PromoSnapshot, 'type' | 'value'> | null } {
  if (!promo || !promo.promo_discount_type) {
    return { discount: 0, net: unitPrice * qty, snapshot: null };
  }
  if (promo.promo_discount_type === 'PERCENT') {
    const discount = Math.round(unitPrice * qty * (Number(promo.promo_discount_value) / 100));
    return {
      discount,
      net: unitPrice * qty - discount,
      snapshot: { type: 'PERCENT', value: Number(promo.promo_discount_value) },
    };
  }
  const perUnit = Number(promo.promo_discount_value);
  if (perUnit > unitPrice) {
    return { discount: 0, net: unitPrice * qty, snapshot: null };
  }
  const discount = perUnit * qty;
  return {
    discount,
    net: (unitPrice - perUnit) * qty,
    snapshot: { type: 'AMOUNT', value: perUnit },
  };
}
