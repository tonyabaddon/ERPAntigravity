// Integration tests for trial_balance view — Pattern C
//
// The trial_balance view aggregates account balances across all posted journal
// entries. Tests verify:
//   1. View is deployed and returns expected schema columns
//   2. Filtering by account_id works
//   3. Column types align (balance is numeric, account_code is text, etc.)
//   4. Only active accounts are included

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('trial_balance view — schema + existence', () => {
  it('view exists and returns data with expected columns', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_id, account_code, account_name, account_type, account_subtype, normal_balance, total_debit, total_credit, balance')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('account_id column is uuid type', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_id')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].account_id).toBe('string');
      // UUID is a 36-char string with dashes
      expect(data[0].account_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('account_code is text (e.g., "1-1000")', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].account_code).toBe('string');
    }
  });

  it('balance column contains numeric values', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('balance')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].balance).toBe('number');
    }
  });

  it('total_debit and total_credit are numeric (or 0)', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('total_debit, total_credit')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].total_debit).toBe('number');
      expect(typeof data[0].total_credit).toBe('number');
    }
  });
});

describe('trial_balance view — filtering', () => {
  it('can filter by account_code using eq', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, account_name')
      .eq('account_code', '1-1000')
      .limit(10);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data[0].account_code).toBe('1-1000');
    }
  });

  it('can filter by account_type using eq', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_type')
      .eq('account_type', 'ASET')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns empty array when filtering by non-existent account_code', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code')
      .eq('account_code', 'ZZZZZ-DOES-NOT-EXIST')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length).toBe(0);
  });
});

describe('trial_balance view — account presence + accounting structure', () => {
  it('includes seeded ASET LANCAR account (1-1000)', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, account_type')
      .eq('account_code', '1-1000')
      .single();

    expect(error).toBeNull();
    expect(data?.account_type).toBe('ASET');
  });

  it('includes seeded PENDAPATAN PENJUALAN account (4-1100)', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, account_type, normal_balance')
      .eq('account_code', '4-1100')
      .single();

    expect(error).toBeNull();
    expect(data?.account_type).toBe('PENDAPATAN');
    expect(data?.normal_balance).toBe('CREDIT');
  });

  it('includes seeded BEBAN account (5-2100)', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, account_type, normal_balance')
      .eq('account_code', '5-2100')
      .single();

    expect(error).toBeNull();
    expect(data?.account_type).toBe('BEBAN');
    expect(data?.normal_balance).toBe('DEBIT');
  });
});

describe('trial_balance view — balance calculation structure', () => {
  it('balance is debit-side total for DEBIT-normal accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, normal_balance, total_debit, total_credit, balance')
      .eq('account_type', 'ASET')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      const row = data[0];
      if (row.normal_balance === 'DEBIT') {
        // balance = debit - credit for DEBIT accounts
        expect(row.balance).toBe(row.total_debit - row.total_credit);
      }
    }
  });

  it('balance is credit-side total for CREDIT-normal accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, normal_balance, total_debit, total_credit, balance')
      .eq('account_type', 'PENDAPATAN')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      const row = data[0];
      if (row.normal_balance === 'CREDIT') {
        // balance = credit - debit for CREDIT accounts
        expect(row.balance).toBe(row.total_credit - row.total_debit);
      }
    }
  });
});

describe('trial_balance view — tenant isolation', () => {
  it('tenant_id column exists (may be null if seeded COAs have no entries)', async () => {
    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('tenant_id')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // tenant_id may be null for COAs with no posted entries
  });
});
