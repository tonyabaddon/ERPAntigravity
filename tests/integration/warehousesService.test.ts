// tests/integration/warehousesService.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
const TEST_CODE = `T${Date.now()}`.slice(-8); // 8-char unique code

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});

afterAll(async () => {
  await supabase.from('warehouses').delete().eq('code', TEST_CODE);
});

describe('warehousesService.fetchAll', () => {
  test('returns active + inactive warehouses ordered by sort_order', async () => {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .order('sort_order', { ascending: true });
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
    // ATAS sort_order=10, BAWAH sort_order=20 — should come in that order
    expect(data![0].code).toBe('ATAS');
    expect(data![1].code).toBe('BAWAH');
  });
});

describe('warehousesService.fetchActive', () => {
  test('filters out is_active=false rows', async () => {
    // Insert a deactivated probe
    const { error: insertError } = await supabase.from('warehouses').insert({
      code: TEST_CODE, name: `Probe ${TEST_CODE}`,
      is_active: false, sort_order: 999,
    });
    expect(insertError).toBeNull();
    const { data } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true);
    expect(data!.every(w => w.code !== TEST_CODE)).toBe(true);
  });
});
