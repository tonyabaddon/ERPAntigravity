import { useState, useCallback, useMemo } from 'react';
import type { DiscountType, DiscountTriple } from '../../../types';
import { computeDiscountAmount } from './computeDiscountAmount';

export interface DiscountBindingState extends DiscountTriple {
  typed_price: number;
}

export interface DiscountBindingApi {
  state: DiscountBindingState;
  setDiscountFromInput: (value: number | null, type: DiscountType) => void;
  setTypedPrice: (typedPrice: number) => void;
  toggleType: (next: DiscountType) => void;
}

function deriveTypedPrice(masterPrice: number, qty: number, amountRp: number): number {
  if (qty <= 0) return masterPrice;
  return Math.round(masterPrice - amountRp / qty);
}

export function useDiscountBinding(
  master_price: number,
  qty: number,
  initial?: Partial<DiscountTriple>,
): DiscountBindingApi {
  const base = master_price * Math.max(0, qty);

  const [triple, setTriple] = useState<DiscountTriple>(() => ({
    discount_type: initial?.discount_type ?? null,
    discount_value: initial?.discount_value ?? null,
    discount_amount_rp: initial?.discount_amount_rp ?? 0,
  }));

  const typed_price = useMemo(
    () => deriveTypedPrice(master_price, qty, triple.discount_amount_rp),
    [master_price, qty, triple.discount_amount_rp],
  );

  const setDiscountFromInput = useCallback((value: number | null, type: DiscountType) => {
    if (type === null || value == null || !Number.isFinite(value) || value <= 0) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    const amount = computeDiscountAmount(value, type, base);
    setTriple({ discount_type: type, discount_value: value, discount_amount_rp: amount });
  }, [base]);

  const setTypedPrice = useCallback((typedPrice: number) => {
    if (!Number.isFinite(typedPrice) || typedPrice < 0) return;
    if (typedPrice > master_price) return; // MARKUP_NOT_ALLOWED — silent ignore
    const perUnitOff = master_price - typedPrice;
    const lineTotal = perUnitOff * qty;
    if (lineTotal === 0) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    setTriple({ discount_type: 'AMOUNT', discount_value: lineTotal, discount_amount_rp: lineTotal });
  }, [master_price, qty]);

  const toggleType = useCallback((next: DiscountType) => {
    if (next === triple.discount_type) return;
    if (next === null) {
      setTriple({ discount_type: null, discount_value: null, discount_amount_rp: 0 });
      return;
    }
    const amount = triple.discount_amount_rp;
    if (amount === 0 || base <= 0) {
      setTriple({ discount_type: next, discount_value: 0, discount_amount_rp: 0 });
      return;
    }
    const newValue = next === 'AMOUNT' ? amount : Math.round((amount / base) * 100);
    setTriple({ discount_type: next, discount_value: newValue, discount_amount_rp: amount });
  }, [triple.discount_type, triple.discount_amount_rp, base]);

  return {
    state: { ...triple, typed_price },
    setDiscountFromInput,
    setTypedPrice,
    toggleType,
  };
}
