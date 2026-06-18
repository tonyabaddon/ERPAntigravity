import { describe, test, expect } from 'vitest';
import { TYPE_TAB_CFG, filterOrdersByTypeTab, subStageBelongsToTab } from './typeTabConfig';
import type { Order } from './types';

const fake = (id: string, t: Order['order_type']): Order => ({
  id, customer: 'X', total: 1, channel: 'WhatsApp', order_type: t,
  funnel_stage: 2, funnel_sub_stage: '2a', delivery_method: 'PICKUP',
  version: 1, payment_type: 'FULL', status_label: '', time_ago: '', stuck: false,
});

describe('typeTabConfig', () => {
  const orders = [fake('1', 'KOMPONEN'), fake('2', 'CUSTOM_PANEL'), fake('3', 'RAKIT_PANEL')];

  test('komponen tab keeps KOMPONEN only', () => {
    expect(filterOrdersByTypeTab(orders, 'komponen').map(o => o.id)).toEqual(['1']);
  });
  test('workshop tab keeps CP + RP', () => {
    expect(filterOrdersByTypeTab(orders, 'workshop').map(o => o.id)).toEqual(['2', '3']);
  });
  test('all tab keeps all', () => {
    expect(filterOrdersByTypeTab(orders, 'all').map(o => o.id)).toEqual(['1', '2', '3']);
  });
  test('subStageBelongsToTab — 3a is komponen only', () => {
    expect(subStageBelongsToTab('3a', 'komponen')).toBe(true);
    expect(subStageBelongsToTab('3a', 'workshop')).toBe(false);
  });
  test('subStageBelongsToTab — 3f is workshop only', () => {
    expect(subStageBelongsToTab('3f', 'workshop')).toBe(true);
    expect(subStageBelongsToTab('3f', 'komponen')).toBe(false);
  });
  test('all tab accepts every sub-stage', () => {
    expect(subStageBelongsToTab('3a', 'all')).toBe(true);
    expect(subStageBelongsToTab('3f', 'all')).toBe(true);
  });
  test('config has 3 tabs with hints', () => {
    expect(Object.keys(TYPE_TAB_CFG)).toEqual(['komponen', 'workshop', 'all']);
    expect(TYPE_TAB_CFG.komponen.hint.length).toBeGreaterThan(10);
  });
});
