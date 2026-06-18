import { describe, test, expect } from 'vitest';
import { getQuickAction } from './quickActionMap';
import type { Order } from './types';

const baseOrder: Omit<Order, 'funnel_sub_stage'> = {
  id: 'x', version: 1, order_type: 'KOMPONEN', delivery_method: 'PICKUP',
  customer: 'X', total: 1, channel: 'WhatsApp', funnel_stage: 2,
  payment_type: 'FULL', status_label: '', time_ago: '', stuck: false,
};

describe('quickActionMap', () => {
  test('2b returns Setujui targeting 2c', () => {
    const a = getQuickAction({ ...baseOrder, funnel_sub_stage: '2b' });
    expect(a?.label).toBe('Setujui');
    expect(a?.toSubStage).toBe('2c');
  });
  test('2d returns Verify with requiresProof targeting 3a', () => {
    const a = getQuickAction({ ...baseOrder, funnel_sub_stage: '2d' });
    expect(a?.toSubStage).toBe('3a');
    expect(a?.requiresProof).toBe(true);
  });
  test('3a pickup returns Siap targeting 4b', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '3a' })?.toSubStage).toBe('4b');
  });
  test('3a delivery returns Siap targeting 4a', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '3a', delivery_method: 'DELIVERY' })?.toSubStage).toBe('4a');
  });
  test('5a returns null (no action)', () => {
    expect(getQuickAction({ ...baseOrder, funnel_sub_stage: '5a', funnel_stage: 5 })).toBeNull();
  });
});
