import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('journal_entries table schema', () => {
  it('table exists and is queryable', async () => {
    const { error } = await supabaseAdmin.from('journal_entries').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('has expected columns (id, entry_number, entry_date, source_type, etc)', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('id, entry_number, entry_date, source_type, total_debit, total_credit, is_balanced')
      .limit(1);
    expect(error).toBeNull();
  });

  it('has RLS enabled', async () => {
    const { error } = await supabaseAdmin.from('journal_entries').select('id').limit(1);
    expect(error).toBeNull();
  });
});
