// src/lib/platformSettingsApi.test.ts
// Unit tests for platformSettingsApi typed wrappers.
// Mocks supabase client; no network calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { platformSettingsApi } from './platformSettingsApi';
import { SuperAdminRequiredError, PlatformAdminRequiredError } from './adminTypes';

// ─── Mock supabaseClient ──────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleRow = {
  id: 1,
  bank_name: 'BCA',
  bank_account_no: '1234567890',
  bank_account_name: 'PT VOSI Digital',
  admin_wa_number: '+62812-3456-7890',
  updated_at: '2026-07-10T00:00:00Z',
  updated_by: null,
};

// ─── Chain builders ───────────────────────────────────────────────────────────

/** Build .from().select().eq().single() chain mock. */
function makeSelectChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select });
  return { select, eq, single };
}

/** Build .from().update().eq().select().single() chain mock. */
function makeUpdateChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const selectAfterUpdate = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select: selectAfterUpdate });
  const update = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ update });
  return { update, eq, selectAfterUpdate, single };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platformSettingsApi.get', () => {
  it('happy path — returns PlatformSettings on success', async () => {
    makeSelectChain({ data: sampleRow, error: null });
    const result = await platformSettingsApi.get();
    expect(result.id).toBe(1);
    expect(result.bank_name).toBe('BCA');
    expect(result.bank_account_no).toBe('1234567890');
    expect(mockFrom).toHaveBeenCalledWith('platform_settings');
  });

  it('propagates P0403 as PlatformAdminRequiredError', async () => {
    makeSelectChain({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(platformSettingsApi.get()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

describe('platformSettingsApi.update', () => {
  it('happy path — returns updated PlatformSettings', async () => {
    const updated = { ...sampleRow, bank_name: 'Mandiri' };
    makeUpdateChain({ data: updated, error: null });
    const result = await platformSettingsApi.update({ bank_name: 'Mandiri' });
    expect(result.bank_name).toBe('Mandiri');
    expect(mockFrom).toHaveBeenCalledWith('platform_settings');
  });

  it('propagates P0403 SUPER_ADMIN_REQUIRED as SuperAdminRequiredError', async () => {
    makeUpdateChain({ data: null, error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' } });
    await expect(platformSettingsApi.update({ bank_name: 'BNI' })).rejects.toBeInstanceOf(
      SuperAdminRequiredError
    );
  });

  it('propagates generic error as Error', async () => {
    makeUpdateChain({ data: null, error: { code: '99999', message: 'unknown db error' } });
    await expect(platformSettingsApi.update({ bank_name: 'BNI' })).rejects.toThrow('unknown db error');
  });
});
