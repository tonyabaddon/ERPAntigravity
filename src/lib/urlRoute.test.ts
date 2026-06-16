import { describe, test, expect } from 'vitest';
import { buildHref } from './urlRoute';
import { parseSearch } from './urlRoute';

describe('urlRoute.buildHref', () => {
  test('no params returns ?screen=<screen>', () => {
    expect(buildHref('dashboard')).toBe('?screen=dashboard');
  });

  test('with single param', () => {
    expect(buildHref('pembelian', { po: 'PO-001' })).toBe('?screen=pembelian&po=PO-001');
  });

  test('with multiple params (sorted by key for deterministic output)', () => {
    // Insertion order (tab first, po second) deliberately differs from
    // alphabetical sort order — verifies the sort path is actually exercised.
    expect(buildHref('pembelian', { tab: 'detail', po: 'PO-001' })).toBe('?screen=pembelian&po=PO-001&tab=detail');
  });

  test('encodes special characters', () => {
    expect(buildHref('pembelian', { po: 'PO/2026#1' })).toBe('?screen=pembelian&po=PO%2F2026%231');
  });

  test('drops undefined / null / empty string params (no key=&)', () => {
    expect(buildHref('pelanggan', { customer: '' })).toBe('?screen=pelanggan');
    expect(buildHref('pelanggan', { customer: undefined as unknown as string })).toBe('?screen=pelanggan');
    expect(buildHref('pelanggan', { customer: null as unknown as string })).toBe('?screen=pelanggan');
  });
});

describe('urlRoute.parseSearch', () => {
  test('empty string returns dashboard + empty params', () => {
    expect(parseSearch('')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('?screen=dashboard returns dashboard + empty params', () => {
    expect(parseSearch('?screen=dashboard')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('?screen=pembelian&po=PO-001 returns pembelian + po param', () => {
    expect(parseSearch('?screen=pembelian&po=PO-001')).toEqual({
      screen: 'pembelian',
      params: { po: 'PO-001' },
    });
  });

  test('unknown screen falls back to dashboard', () => {
    expect(parseSearch('?screen=xyz-not-real')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('missing screen param falls back to dashboard', () => {
    expect(parseSearch('?other=value')).toEqual({ screen: 'dashboard', params: { other: 'value' } });
  });

  test('decodes URL-encoded values', () => {
    expect(parseSearch('?screen=pembelian&po=PO%2F2026%231')).toEqual({
      screen: 'pembelian',
      params: { po: 'PO/2026#1' },
    });
  });

  test('handles search without leading "?"', () => {
    expect(parseSearch('screen=dashboard')).toEqual({ screen: 'dashboard', params: {} });
  });
});

import { shouldInterceptClick } from './urlRoute';

type MockEvent = {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const ev = (overrides: Partial<MockEvent> = {}): MockEvent => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('urlRoute.shouldInterceptClick', () => {
  test('plain left-click → intercept (true)', () => {
    expect(shouldInterceptClick(ev())).toBe(true);
  });

  test('Ctrl+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ ctrlKey: true }))).toBe(false);
  });

  test('Cmd+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ metaKey: true }))).toBe(false);
  });

  test('Shift+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ shiftKey: true }))).toBe(false);
  });

  test('Alt+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ altKey: true }))).toBe(false);
  });

  test('middle-click (button=1) → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ button: 1 }))).toBe(false);
  });

  test('right-click (button=2) → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ button: 2 }))).toBe(false);
  });
});
