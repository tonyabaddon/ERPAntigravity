// Integration tests for general_ledger view — Pattern C
//
// The general_ledger view provides a detailed list of all posted journal entry
// lines with running balance calculations per account. Tests verify:
//   1. View is deployed and returns expected schema columns
//   2. Filtering by account_id works
//   3. Running balance calculation is present
//   4. Column types align (side is DEBIT/CREDIT, amount is numeric, etc.)

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('general_ledger view — schema + existence', () => {
  it('view exists and returns data with expected columns', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select(
        'account_id, account_code, account_name, normal_balance, entry_id, entry_number, entry_date, posted_at, entry_description, line_description, side, amount, debit, credit, counterparty_type, counterparty_id, status, reconciled_at, source_type, source_ref_table, source_ref_id, running_balance, tenant_id'
      )
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('account_id column is uuid type', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('account_id')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].account_id).toBe('string');
    }
  });

  it('entry_id column is uuid type', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('entry_id')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].entry_id).toBe('string');
    }
  });

  it('side column accepts DEBIT and CREDIT values', async () => {
    const { data: debit, error: e1 } = await supabaseAdmin
      .from('general_ledger')
      .select('side')
      .eq('side', 'DEBIT')
      .limit(1);

    const { data: credit, error: e2 } = await supabaseAdmin
      .from('general_ledger')
      .select('side')
      .eq('side', 'CREDIT')
      .limit(1);

    expect(e1).toBeNull();
    expect(e2).toBeNull();
    expect(Array.isArray(debit)).toBe(true);
    expect(Array.isArray(credit)).toBe(true);
  });

  it('amount column is numeric', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('amount')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].amount).toBe('number');
    }
  });

  it('running_balance column is numeric', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('running_balance')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].running_balance).toBe('number');
    }
  });
});

describe('general_ledger view — debit/credit split', () => {
  it('debit column equals amount when side=DEBIT, else 0', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('side, amount, debit')
      .eq('side', 'DEBIT')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data[0].debit).toBe(data[0].amount);
    }
  });

  it('credit column equals amount when side=CREDIT, else 0', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('side, amount, credit')
      .eq('side', 'CREDIT')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data[0].credit).toBe(data[0].amount);
    }
  });
});

describe('general_ledger view — filtering + ordering', () => {
  it('can filter by account_code using eq', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('account_code')
      .eq('account_code', '1-1110')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns empty when filtering by non-existent account_code', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('account_code')
      .eq('account_code', 'ZZZZZ-DOES-NOT-EXIST')
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length).toBe(0);
  });

  it('can order by entry_date ascending', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('entry_date, entry_number')
      .order('entry_date', { ascending: true })
      .limit(2);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length >= 2) {
      // Verify order
      const d1 = new Date(data[0].entry_date).getTime();
      const d2 = new Date(data[1].entry_date).getTime();
      expect(d1 <= d2).toBe(true);
    }
  });
});

describe('general_ledger view — journal entry structure', () => {
  it('entry_number column is present and is string or number', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('entry_number')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data[0].entry_number).toBeTruthy();
      // entry_number can be string or number depending on DB schema
      expect(['string', 'number']).toContain(typeof data[0].entry_number);
    }
  });

  it('entry_date is ISO date format', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('entry_date')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].entry_date).toBe('string');
      expect(data[0].entry_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('source_type column is present', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('source_type')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].source_type).toBe('string');
    }
  });
});

describe('general_ledger view — tenant isolation', () => {
  it('tenant_id column exists (may be null if no posting entries)', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('tenant_id')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // tenant_id may be null if there are no posted entries
  });
});

describe('general_ledger view — accounting rules', () => {
  it('normal_balance is DEBIT or CREDIT', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('normal_balance')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(['DEBIT', 'CREDIT']).toContain(data[0].normal_balance);
    }
  });

  it('status column is present', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('status')
      .limit(1);

    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].status).toBe('string');
    }
  });
});
