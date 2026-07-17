import { describe, test, expect, vi, beforeEach } from 'vitest';

// Per-test results — set by each test before invoking the mutation.
let updateError: unknown = null;
let insertResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateSelectResult: { data: unknown; error: unknown } = { data: null, error: null };
let deleteError: unknown = null;

// Spies so tests can assert what was sent to Supabase.
const fromSpy = vi.fn();
const updateSpy = vi.fn();
const insertSpy = vi.fn();
const deleteSpy = vi.fn();
const eqSpy = vi.fn();

vi.mock('../supabaseClient', () => {
  // Two terminal shapes share one builder:
  //   updateStoreSettings / updateOperatingHour → .update().eq() (returns { error })
  //   updateBankAccount                         → .update().eq().select().single()
  //   createBankAccount                         → .insert().select().single()
  //   deleteBankAccount                         → .delete().eq()           (returns { error })
  const builder: Record<string, unknown> = {};
  builder['update'] = vi.fn((...args: unknown[]) => {
    updateSpy(...args);
    return builder;
  });
  builder['insert'] = vi.fn((...args: unknown[]) => {
    insertSpy(...args);
    return builder;
  });
  builder['delete'] = vi.fn(() => {
    deleteSpy();
    return builder;
  });
  builder['select'] = vi.fn().mockReturnThis();
  builder['single'] = vi.fn().mockImplementation(() => {
    // .single() is reached after either .insert().select() or .update().eq().select()
    // Both paths share a single result holder; tests that care set the right one.
    if ((insertSpy as any).mock.calls.length > 0 && !(updateSpy as any).mock.calls.length) {
      return Promise.resolve(insertResult);
    }
    return Promise.resolve(updateSelectResult);
  });
  builder['eq'] = vi.fn((...args: unknown[]) => {
    eqSpy(...args);
    // For .update().eq() this is the terminal awaitable; for delete().eq() too.
    // For updateBankAccount it continues to .select().single(); to support that
    // we return a thenable that's also chainable.
    const obj: Record<string, unknown> = {
      select: builder['select'],
      single: builder['single'],
    };
    obj['then'] = (onfulfilled: (v: unknown) => unknown) => {
      // Decide which terminal result based on which mutation kicked off the chain.
      if ((deleteSpy as any).mock.calls.length > 0) {
        return Promise.resolve({ error: deleteError }).then(onfulfilled);
      }
      return Promise.resolve({ error: updateError }).then(onfulfilled);
    };
    return obj;
  });
  // updateStoreSettings uses .not(col, 'is', null) as a PostgREST safety filter.
  // The builder needs .not to be chainable like .eq — it terminates with { error }.
  builder['not'] = vi.fn(() => {
    const obj: Record<string, unknown> = {};
    obj['then'] = (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ error: updateError }).then(onfulfilled);
    return obj;
  });

  return {
    supabase: {
      from: vi.fn((table: string) => {
        fromSpy(table);
        return builder;
      }),
    },
  };
});

import {
  updateStoreSettings,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from './mutations';

describe('pengaturan/mutations', () => {
  beforeEach(() => {
    updateError = null;
    insertResult = { data: null, error: null };
    updateSelectResult = { data: null, error: null };
    deleteError = null;
    fromSpy.mockClear();
    updateSpy.mockClear();
    insertSpy.mockClear();
    deleteSpy.mockClear();
    eqSpy.mockClear();
  });

  test('updateStoreSettings calls update on store_settings and stamps updated_at', async () => {
    await updateStoreSettings({ nama_toko: 'Toko Baru' });
    expect(fromSpy).toHaveBeenCalledWith('store_settings');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const patch = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.nama_toko).toBe('Toko Baru');
    expect(typeof patch.updated_at).toBe('string');
    // updateStoreSettings uses .not('tenant_id', 'is', null) as a PostgREST
    // safety filter (not .eq) — RLS restricts to caller's own store row.
    // No eqSpy assertion needed here.
  });

  test('updateStoreSettings throws on supabase error', async () => {
    updateError = { message: 'rls' };
    await expect(updateStoreSettings({ nama_toko: 'X' })).rejects.toBeTruthy();
  });

  test('createBankAccount inserts and returns the new row', async () => {
    insertResult = {
      data: {
        id: 'uuid-1',
        bank_name: 'BCA',
        account_number: '123',
        account_holder: 'Sinar',
        is_active: true,
        sort_order: 0,
      },
      error: null,
    };
    const row = await createBankAccount({
      bank_name: 'BCA',
      account_number: '123',
      account_holder: 'Sinar',
      is_active: true,
      sort_order: 0,
    });
    expect(fromSpy).toHaveBeenCalledWith('store_bank_accounts');
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(row.id).toBe('uuid-1');
    expect(row.bank_name).toBe('BCA');
  });

  test('updateBankAccount returns the updated row', async () => {
    updateSelectResult = {
      data: {
        id: 'uuid-2',
        bank_name: 'Mandiri',
        account_number: '999',
        account_holder: 'Z',
        is_active: false,
        sort_order: 1,
      },
      error: null,
    };
    const row = await updateBankAccount('uuid-2', { is_active: false });
    expect(fromSpy).toHaveBeenCalledWith('store_bank_accounts');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('id', 'uuid-2');
    expect(row.is_active).toBe(false);
  });

  test('deleteBankAccount calls delete().eq() and resolves', async () => {
    await deleteBankAccount('uuid-3');
    expect(fromSpy).toHaveBeenCalledWith('store_bank_accounts');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('id', 'uuid-3');
  });

  test('deleteBankAccount throws on supabase error', async () => {
    deleteError = { message: 'fk violation' };
    await expect(deleteBankAccount('uuid-4')).rejects.toBeTruthy();
  });
});
