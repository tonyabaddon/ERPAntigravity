import { describe, test, expect, vi, beforeEach } from 'vitest';

// Per-test results — set by each test before invoking the query.
let singleResult: { data: unknown; error: unknown } = { data: null, error: null };
let orderResult: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('../supabaseClient', () => {
  // `.order()` is both awaitable (for the no-filter case) AND chainable to
  // `.eq()` (for fetchBankAccounts(activeOnly=true)). The returned object also
  // carries `.single()` so the same builder works for fetchStoreSettings,
  // which terminates in `.eq().single()`.
  const buildOrderResult = () => {
    const obj: Record<string, unknown> = {};
    obj['then'] = (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve(orderResult).then(onfulfilled);
    obj['eq'] = vi.fn().mockImplementation(() => Promise.resolve(orderResult));
    return obj;
  };

  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(buildOrderResult),
    single: vi.fn().mockImplementation(() => Promise.resolve(singleResult)),
  };
  return {
    supabase: {
      from: vi.fn(() => queryBuilder),
    },
  };
});

import { fetchStoreSettings, fetchOperatingHours, fetchBankAccounts } from './queries';

describe('pengaturan/queries', () => {
  beforeEach(() => {
    singleResult = { data: null, error: null };
    orderResult = { data: [], error: null };
  });

  test('fetchStoreSettings returns the singleton row', async () => {
    singleResult = {
      data: {
        id: 1,
        nama_toko: 'Sinar Elektrik',
        alamat_lengkap: 'Jl. X',
        kota: 'Surabaya',
        telp_wa: '0812',
        updated_at: '2026-06-19T00:00:00Z',
      },
      error: null,
    };
    const s = await fetchStoreSettings();
    expect(s.id).toBe(1);
    expect(s.nama_toko).toBe('Sinar Elektrik');
  });

  test('fetchStoreSettings throws on supabase error', async () => {
    singleResult = { data: null, error: { message: 'rls' } };
    await expect(fetchStoreSettings()).rejects.toBeTruthy();
  });

  test('fetchOperatingHours returns array sorted by day_of_week', async () => {
    orderResult = {
      data: [
        { day_of_week: 0, is_open: true, open_time: '08:00:00', close_time: '17:00:00' },
        { day_of_week: 6, is_open: false },
      ],
      error: null,
    };
    const h = await fetchOperatingHours();
    expect(h).toHaveLength(2);
    expect(h[0].day_of_week).toBe(0);
    expect(h[1].is_open).toBe(false);
  });

  test('fetchOperatingHours throws on supabase error', async () => {
    orderResult = { data: null, error: { message: 'boom' } };
    await expect(fetchOperatingHours()).rejects.toBeTruthy();
  });

  test('fetchBankAccounts returns array (default activeOnly=false)', async () => {
    orderResult = {
      data: [
        {
          id: 'u1',
          bank_name: 'BCA',
          account_number: '123',
          account_holder: 'X',
          is_active: true,
          sort_order: 0,
        },
      ],
      error: null,
    };
    const b = await fetchBankAccounts();
    expect(b).toHaveLength(1);
    expect(b[0].bank_name).toBe('BCA');
  });

  test('fetchBankAccounts with activeOnly=true still resolves to array', async () => {
    orderResult = {
      data: [
        {
          id: 'u2',
          bank_name: 'Mandiri',
          account_number: '456',
          account_holder: 'Y',
          is_active: true,
          sort_order: 1,
        },
      ],
      error: null,
    };
    const b = await fetchBankAccounts(true);
    expect(b).toHaveLength(1);
    expect(b[0].bank_name).toBe('Mandiri');
  });

  test('fetchBankAccounts returns empty array when data is null', async () => {
    orderResult = { data: null, error: null };
    const b = await fetchBankAccounts();
    expect(b).toEqual([]);
  });
});
