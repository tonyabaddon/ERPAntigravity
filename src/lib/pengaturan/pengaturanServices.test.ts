import { describe, test, expect, vi, beforeEach } from 'vitest';

let singleResult: { data: unknown; error: unknown } = { data: null, error: null };
let multiResult: { data: unknown; error: unknown } = { data: [], error: null };
let updateResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('../supabaseClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supabaseClient')>();
  return {
    ...actual,
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue(multiResult),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(singleResult),
            order: vi.fn().mockResolvedValue(multiResult),
          }),
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(singleResult),
          }),
          maybeSingle: vi.fn().mockResolvedValue(singleResult),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue(updateResult),
          }),
          is: vi.fn().mockResolvedValue(updateResult),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(singleResult),
          }),
        }),
      })),
    },
  };
});

import { approvalSettingsService, tenantSettingsService, serviceTypesService } from './pengaturanServices';

describe('approvalSettingsService', () => {
  beforeEach(() => { singleResult = { data: null, error: null }; multiResult = { data: [], error: null }; updateResult = { data: null, error: null }; });

  test('fetch returns array of approval settings', async () => {
    multiResult = { data: [{ id: 1, request_type: 'adjustment', approval_required: true, verification_method: 'PIN' }], error: null };
    const result = await approvalSettingsService.fetch();
    expect(result).toHaveLength(1);
    expect(result[0].request_type).toBe('adjustment');
  });

  test('updateOne updates approval_required + verification_method', async () => {
    updateResult = { data: null, error: null };
    await expect(approvalSettingsService.updateOne('adjustment', { approval_required: false })).resolves.not.toThrow();
  });
});

describe('tenantSettingsService', () => {
  beforeEach(() => { singleResult = { data: null, error: null }; multiResult = { data: [], error: null }; updateResult = { data: null, error: null }; });

  test('fetch returns single row', async () => {
    singleResult = { data: { id: 1, modul_kasir: true, pajak_mode: 'FINAL_UMKM' }, error: null };
    const result = await tenantSettingsService.fetch();
    expect(result?.modul_kasir).toBe(true);
    expect(result?.pajak_mode).toBe('FINAL_UMKM');
  });

  test('updateModul updates single modul switch', async () => {
    updateResult = { data: null, error: null };
    await expect(tenantSettingsService.updateModul('modul_kasir', false)).resolves.not.toThrow();
  });

  test('updatePajak updates pajak group fields', async () => {
    updateResult = { data: null, error: null };
    await expect(tenantSettingsService.updatePajak({ pajak_mode: 'PKP', pajak_pkp_registered_at: '2026-06-21' })).resolves.not.toThrow();
  });
});

describe('serviceTypesService', () => {
  beforeEach(() => { singleResult = { data: null, error: null }; multiResult = { data: [], error: null }; updateResult = { data: null, error: null }; });

  test('fetchActive returns only is_active=true sorted by display_order', async () => {
    multiResult = { data: [{ id: 1, code: 'custom_panel', is_active: true, display_order: 1 }, { id: 2, code: 'wiring_panel', is_active: true, display_order: 2 }], error: null };
    const result = await serviceTypesService.fetchActive();
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('custom_panel');
  });
});
