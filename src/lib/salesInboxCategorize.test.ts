import { describe, it, expect } from 'vitest';
import { categorize, categoryCounts } from './salesInboxCategorize';

describe('categorize', () => {
  it('routes ESCALATED_ADMIN to butuhAksi', () => {
    expect(categorize({ state: 'ESCALATED_ADMIN', ai_active: false })).toBe('butuhAksi');
  });
  it('routes ESCALATED_WIRING to butuhAksi', () => {
    expect(categorize({ state: 'ESCALATED_WIRING', ai_active: false })).toBe('butuhAksi');
  });
  it('routes BOOKED to butuhAksi', () => {
    expect(categorize({ state: 'BOOKED', ai_active: true })).toBe('butuhAksi');
  });
  it('routes TIMEOUT_REMINDER to butuhAksi', () => {
    expect(categorize({ state: 'TIMEOUT_REMINDER', ai_active: true })).toBe('butuhAksi');
  });
  it('routes ai_active=false non-terminal to butuhAksi (manual override case)', () => {
    expect(categorize({ state: 'CONFIRMING', ai_active: false })).toBe('butuhAksi');
    expect(categorize({ state: 'COLLECTING', ai_active: false })).toBe('butuhAksi');
  });
  it('routes COMPLETED ai_active=false to riwayat (not butuhAksi)', () => {
    expect(categorize({ state: 'COMPLETED', ai_active: false })).toBe('riwayat');
  });
  it('routes CANCELLED to riwayat', () => {
    expect(categorize({ state: 'CANCELLED', ai_active: true })).toBe('riwayat');
  });
  it('routes ai_active=true AI states to aiAktif', () => {
    for (const s of ['GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING','ADD_MORE','APPROVED'] as const) {
      expect(categorize({ state: s, ai_active: true })).toBe('aiAktif');
    }
  });
  it('routes DELIVERY to menunggu', () => {
    expect(categorize({ state: 'DELIVERY', ai_active: true })).toBe('menunggu');
  });
});

describe('categoryCounts', () => {
  it('counts each conversation exactly once', () => {
    const convs = [
      { state: 'ESCALATED_ADMIN' as const, ai_active: false },
      { state: 'CONFIRMING' as const, ai_active: true },
      { state: 'CONFIRMING' as const, ai_active: false }, // override case
      { state: 'COMPLETED' as const, ai_active: false },
      { state: 'DELIVERY' as const, ai_active: true },
    ];
    expect(categoryCounts(convs)).toEqual({
      butuhAksi: 2, // ESCALATED_ADMIN + overridden CONFIRMING
      aiAktif: 1,   // ai_active CONFIRMING
      menunggu: 1,  // DELIVERY
      riwayat: 1,   // COMPLETED
    });
  });
  it('handles empty array', () => {
    expect(categoryCounts([])).toEqual({ butuhAksi: 0, aiAktif: 0, menunggu: 0, riwayat: 0 });
  });
});
