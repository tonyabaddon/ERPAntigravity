import { describe, test, expect } from 'vitest';
import { buildHref } from './urlRoute';

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
