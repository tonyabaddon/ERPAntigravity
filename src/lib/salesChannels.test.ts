import { describe, test, expect } from 'vitest';
import {
  CHANNEL_VISUAL,
  CHANNEL_GROUPS,
  CHANNEL_REQUIRES_ORDER_NO,
  CHANNEL_LOCKED,
  getChannelDef,
} from './salesChannels';

describe('salesChannels', () => {
  test('CHANNEL_VISUAL has 14 entries with unique invoice prefix', () => {
    const codes = Object.keys(CHANNEL_VISUAL);
    expect(codes.length).toBe(14);
    const prefixes = codes.map(c => CHANNEL_VISUAL[c as keyof typeof CHANNEL_VISUAL].invoicePrefix);
    expect(new Set(prefixes).size).toBe(14);
  });

  test('CHANNEL_GROUPS partitions 14 channels exactly once', () => {
    const allFromGroups = [
      ...CHANNEL_GROUPS.offline,
      ...CHANNEL_GROUPS.marketplace,
      ...CHANNEL_GROUPS.direct,
    ];
    expect(allFromGroups.length).toBe(14);
    expect(new Set(allFromGroups).size).toBe(14);
  });

  test('CHANNEL_REQUIRES_ORDER_NO matches marketplace group', () => {
    expect(Array.from(CHANNEL_REQUIRES_ORDER_NO).sort())
      .toEqual([...CHANNEL_GROUPS.marketplace].sort());
  });

  test('CHANNEL_LOCKED contains walkin only', () => {
    expect(Array.from(CHANNEL_LOCKED)).toEqual(['walkin']);
  });

  test('getChannelDef returns expected shape', () => {
    const def = getChannelDef('shopee');
    expect(def.code).toBe('shopee');
    expect(def.label).toBe('Shopee');
    expect(def.group).toBe('marketplace');
    expect(def.invoicePrefix).toBe('SHP');
    expect(def.requiresOrderNo).toBe(true);
  });

  test('whatsapp uses orders flow, others use kasir', () => {
    expect(CHANNEL_VISUAL.whatsapp.flow).toBe('orders');
    expect(CHANNEL_VISUAL.walkin.flow).toBe('kasir');
    expect(CHANNEL_VISUAL.shopee.flow).toBe('kasir');
  });
});
