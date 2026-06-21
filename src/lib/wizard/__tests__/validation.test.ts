import { describe, test, expect } from 'vitest';
import { validateStep1, validateStep2, validateStep3, isPreOrder, dispatchSave } from '../validation';

describe('validateStep1', () => {
  test('ok when channel + customer set', () => {
    expect(validateStep1({ channel: 'walkin', customer: { id: 'c1' } } as any)).toMatchObject({ ok: true });
  });
  test('error when channel missing', () => {
    expect(validateStep1({ customer: { id: 'c1' } } as any)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/channel/i)]) });
  });
  test('error when customer missing', () => {
    expect(validateStep1({ channel: 'walkin' } as any)).toMatchObject({ ok: false });
  });
  test('marketplace channel requires marketplace_order_no', () => {
    expect(validateStep1({ channel: 'tokopedia', customer: { id: 'c1' }, marketplace_order_no: '' } as any)).toMatchObject({ ok: false });
    expect(validateStep1({ channel: 'tokopedia', customer: { id: 'c1' }, marketplace_order_no: 'TKP-123' } as any)).toMatchObject({ ok: true });
  });
  test('whatsapp channel requires wa_phone', () => {
    expect(validateStep1({ channel: 'whatsapp', customer: { id: 'c1' } } as any)).toMatchObject({ ok: false });
    expect(validateStep1({ channel: 'whatsapp', customer: { id: 'c1' }, wa_phone: '081' } as any)).toMatchObject({ ok: true });
  });
});

describe('validateStep2', () => {
  test('ok when ≥1 SKU item with qty>0 + warehouse', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 2, warehouse_id: 'atas' }], rakitLines: [] } as any)).toMatchObject({ ok: true });
  });
  test('ok when only rakit line with desc + estimated_price', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', description: 'genset', estimated_price: 5000000, qty: 0 }] } as any)).toMatchObject({ ok: true });
  });
  test('error when empty cart', () => {
    expect(validateStep2({ items: [], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when SKU qty=0', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 0, warehouse_id: 'atas' }], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when SKU missing warehouse', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 2 }], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when rakit missing description', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', estimated_price: 5000000, qty: 0 }] } as any)).toMatchObject({ ok: false });
  });
  test('error when rakit estimated_price=0', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', description: 'x', estimated_price: 0, qty: 0 }] } as any)).toMatchObject({ ok: false });
  });
});

describe('validateStep3', () => {
  test('ok when payment_type set + tempo customer eligible', () => {
    expect(validateStep3({ payment_type: 'TEMPO', customer: { allows_tempo: true } } as any)).toMatchObject({ ok: true });
  });
  test('error TEMPO + customer not eligible', () => {
    expect(validateStep3({ payment_type: 'TEMPO', customer: { allows_tempo: false } } as any)).toMatchObject({ ok: false });
  });
  test('ok LUNAS regardless of allows_tempo', () => {
    expect(validateStep3({ payment_type: 'FULL', customer: { allows_tempo: false } } as any)).toMatchObject({ ok: true });
  });
  test('error when payment_type missing', () => {
    expect(validateStep3({ customer: {} } as any)).toMatchObject({ ok: false });
  });
});

describe('isPreOrder', () => {
  test('true when qty > stock', () => {
    expect(isPreOrder({ sku: 'X', qty: 5, warehouse_id: 'atas' } as any, { 'X|atas': 2 })).toBe(true);
  });
  test('false when qty <= stock', () => {
    expect(isPreOrder({ sku: 'X', qty: 2, warehouse_id: 'atas' } as any, { 'X|atas': 5 })).toBe(false);
  });
  test('true when stock entry missing (=0)', () => {
    expect(isPreOrder({ sku: 'X', qty: 1, warehouse_id: 'atas' } as any, {})).toBe(true);
  });
});

describe('dispatchSave', () => {
  test('TEMPO payment → tempo', () => {
    expect(dispatchSave({ payment_type: 'TEMPO', items: [{ sku: 'X', qty: 1 }], rakitLines: [] } as any)).toBe('tempo');
  });
  test('mixed SKU + rakit, FULL → wip', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [{ sku: 'X' }], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('wip');
  });
  test('pure SKU FULL → standard', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [{ sku: 'X' }], rakitLines: [] } as any)).toBe('standard');
  });
  test('pure jasa FULL → wip', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('wip');
  });
  test('mixed + TEMPO → tempo (tempo takes precedence)', () => {
    expect(dispatchSave({ payment_type: 'TEMPO', items: [{ sku: 'X' }], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('tempo');
  });
});
