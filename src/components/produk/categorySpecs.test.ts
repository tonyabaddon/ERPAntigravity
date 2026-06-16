import { describe, it, expect } from 'vitest';
import { generateName, specFieldsFor } from './categorySpecs';

describe('generateName', () => {
  it('Panel formats dims', () => {
    expect(generateName('Panel', { material: 'Besi', tipe_pasang: 'Outdoor',
      tinggi_cm: '80', lebar_cm: '60', tebal_cm: '25', ketebalan_mm: '1.5',
      finishing: 'RAL7032', kelengkapan: 'Kosong' }))
      .toBe('Panel Besi Outdoor 80×60×25cm 1.5mm RAL7032 Kosong');
  });
  it('MCB joins merek + ampere + phase', () => {
    expect(generateName('MCB', { mcb_merek: 'Schneider', mcb_ampere: '16', mcb_phase: '1P' }))
      .toBe('MCB Schneider 16A 1P');
  });
  it('Custom category falls back to deskripsi', () => {
    expect(generateName('Kontaktor', { deskripsi: 'Kontaktor Schneider LC1D09 9A 220V' }))
      .toBe('Kontaktor Schneider LC1D09 9A 220V');
  });
});

describe('specFieldsFor', () => {
  it('returns Aksesori fields for unknown category', () => {
    expect(specFieldsFor('Kontaktor')).toEqual(specFieldsFor('Aksesori'));
  });
  it('returns Panel fields for Panel', () => {
    expect(specFieldsFor('Panel').length).toBeGreaterThan(1);
  });
});
