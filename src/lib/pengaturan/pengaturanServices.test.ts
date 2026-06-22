import { describe, test, expect, vi, beforeEach } from 'vitest';

let singleResult: { data: unknown; error: unknown } = { data: null, error: null };
let multiResult: { data: unknown; error: unknown } = { data: [], error: null };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let rpcCalls: Array<{ fn: string; args: unknown }> = [];

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
      })),
      rpc: vi.fn((fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(rpcResult);
      }),
    },
  };
});

import { approvalSettingsService, tenantSettingsService, serviceTypesService } from './pengaturanServices';

describe('approvalSettingsService', () => {
  beforeEach(() => {
    singleResult = { data: null, error: null };
    multiResult = { data: [], error: null };
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  test('fetch returns array of approval settings', async () => {
    multiResult = { data: [{ id: 1, request_type: 'adjustment', approval_required: true, verification_method: 'PIN' }], error: null };
    const result = await approvalSettingsService.fetch();
    expect(result).toHaveLength(1);
    expect(result[0].request_type).toBe('adjustment');
  });

  test('updateOne calls set_approval_setting RPC with request_type + patch', async () => {
    rpcResult = { data: null, error: null };
    await expect(approvalSettingsService.updateOne('adjustment', { approval_required: false })).resolves.not.toThrow();
    expect(rpcCalls).toEqual([
      { fn: 'set_approval_setting', args: { p_request_type: 'adjustment', p_patch: { approval_required: false } } },
    ]);
  });

  test('updateOne throws when RPC returns error', async () => {
    rpcResult = { data: null, error: { message: 'INSUFFICIENT_ROLE' } };
    await expect(approvalSettingsService.updateOne('adjustment', { approval_required: false })).rejects.toBeDefined();
  });
});

describe('tenantSettingsService', () => {
  beforeEach(() => {
    singleResult = { data: null, error: null };
    multiResult = { data: [], error: null };
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  test('fetch returns single row', async () => {
    singleResult = { data: { id: 1, modul_kasir: true, pajak_mode: 'FINAL_UMKM' }, error: null };
    const result = await tenantSettingsService.fetch();
    expect(result?.modul_kasir).toBe(true);
    expect(result?.pajak_mode).toBe('FINAL_UMKM');
  });

  test('updateModul calls set_tenant_modul RPC with key + value', async () => {
    rpcResult = { data: null, error: null };
    await expect(tenantSettingsService.updateModul('modul_kasir', false)).resolves.not.toThrow();
    expect(rpcCalls).toEqual([
      { fn: 'set_tenant_modul', args: { p_key: 'modul_kasir', p_value: false } },
    ]);
  });

  test('updatePajak calls set_tenant_pajak RPC with patch JSONB', async () => {
    rpcResult = { data: null, error: null };
    await expect(tenantSettingsService.updatePajak({ pajak_mode: 'PKP', pajak_pkp_registered_at: '2026-06-21' })).resolves.not.toThrow();
    expect(rpcCalls).toEqual([
      { fn: 'set_tenant_pajak', args: { p_patch: { pajak_mode: 'PKP', pajak_pkp_registered_at: '2026-06-21' } } },
    ]);
  });
});

describe('serviceTypesService', () => {
  beforeEach(() => {
    singleResult = { data: null, error: null };
    multiResult = { data: [], error: null };
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  test('fetchActive returns only is_active=true sorted by display_order', async () => {
    multiResult = { data: [{ id: 1, code: 'custom_panel', is_active: true, display_order: 1 }, { id: 2, code: 'wiring_panel', is_active: true, display_order: 2 }], error: null };
    const result = await serviceTypesService.fetchActive();
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('custom_panel');
  });

  test('create calls upsert_service_type RPC with p_id=null then re-fetches row', async () => {
    rpcResult = { data: 42, error: null };
    singleResult = { data: { id: 42, code: 'new_jasa', name: 'New Jasa', is_active: true }, error: null };
    const result = await serviceTypesService.create({
      code: 'new_jasa', name: 'New Jasa', description: null,
      pricing_model: 'LUMP_SUM', requires_material_lock: false,
      default_account_revenue: null, default_account_cogs: null,
      color_hex: '#9333EA', is_active: true, display_order: 5,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('upsert_service_type');
    expect((rpcCalls[0].args as { p_id: unknown }).p_id).toBeNull();
    expect(result.id).toBe(42);
  });

  test('update calls upsert_service_type RPC with existing id', async () => {
    rpcResult = { data: 7, error: null };
    await expect(serviceTypesService.update(7, { name: 'Renamed' })).resolves.not.toThrow();
    expect(rpcCalls).toEqual([
      { fn: 'upsert_service_type', args: { p_id: 7, p_input: { name: 'Renamed' } } },
    ]);
  });

  test('deactivate calls deactivate_service_type RPC', async () => {
    rpcResult = { data: null, error: null };
    await expect(serviceTypesService.deactivate(3)).resolves.not.toThrow();
    expect(rpcCalls).toEqual([
      { fn: 'deactivate_service_type', args: { p_id: 3 } },
    ]);
  });
});
