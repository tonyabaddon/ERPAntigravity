import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDiscountBinding } from './useDiscountBinding';

describe('useDiscountBinding', () => {
  test('initial state with no discount: typed_price = master, amount = 0', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    expect(result.current.state.typed_price).toBe(100000);
    expect(result.current.state.discount_amount_rp).toBe(0);
    expect(result.current.state.discount_type).toBeNull();
  });

  test('setTypedPrice 80000 (master 100000, qty 5) → discount AMOUNT 100000 (20×5)', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setTypedPrice(80000); });
    expect(result.current.state.discount_type).toBe('AMOUNT');
    expect(result.current.state.discount_value).toBe(100000);
    expect(result.current.state.discount_amount_rp).toBe(100000);
    expect(result.current.state.typed_price).toBe(80000);
  });

  test('setTypedPrice higher than master rejected (state unchanged)', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setTypedPrice(120000); });
    expect(result.current.state.typed_price).toBe(100000); // master, no change
    expect(result.current.state.discount_amount_rp).toBe(0);
  });

  test('setDiscountFromInput PERCENT 10 (master 100000, qty 5) → amount 50000, typed 90000', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(10, 'PERCENT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    expect(result.current.state.discount_value).toBe(10);
    expect(result.current.state.discount_type).toBe('PERCENT');
    expect(result.current.state.typed_price).toBe(90000);
  });

  test('setDiscountFromInput AMOUNT 50000 (master 100000, qty 5) → typed 90000', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(50000, 'AMOUNT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    expect(result.current.state.typed_price).toBe(90000); // 100k - (50k / 5)
  });

  test('toggleType PERCENT→AMOUNT preserves Rupiah equivalent', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(10, 'PERCENT'); });
    expect(result.current.state.discount_amount_rp).toBe(50000);
    act(() => { result.current.toggleType('AMOUNT'); });
    expect(result.current.state.discount_type).toBe('AMOUNT');
    expect(result.current.state.discount_value).toBe(50000);
    expect(result.current.state.discount_amount_rp).toBe(50000);
  });

  test('toggleType AMOUNT→PERCENT computes equivalent %', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5));
    act(() => { result.current.setDiscountFromInput(50000, 'AMOUNT'); });
    act(() => { result.current.toggleType('PERCENT'); });
    expect(result.current.state.discount_type).toBe('PERCENT');
    // 50k / (100k * 5) * 100 = 10
    expect(result.current.state.discount_value).toBe(10);
    expect(result.current.state.discount_amount_rp).toBe(50000);
  });

  test('initial DiscountTriple respected', () => {
    const { result } = renderHook(() => useDiscountBinding(100000, 5, {
      discount_type: 'AMOUNT', discount_value: 30000, discount_amount_rp: 30000,
    }));
    expect(result.current.state.discount_amount_rp).toBe(30000);
    expect(result.current.state.typed_price).toBe(94000); // 100k - 6k
  });
});
