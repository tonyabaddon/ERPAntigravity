/**
 * Integration tests for configurable sales channels (Phase A+B).
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY/VITE_SUPABASE_ANON_KEY missing');
}

let supabase: SupabaseClient;
const TEST_PREFIX = `QA-CHAN-${Date.now()}`;
const ALL_CHANNELS = [
  'walkin','grosir','sales','expo',
  'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
  'whatsapp','instagram','website',
] as const;

beforeAll(() => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});

afterAll(async () => {
  // Cleanup any test rows
  await supabase.from('kasir_transactions').delete().like('customer_name', `${TEST_PREFIX}%`);
});

describe('Phase A — ENUM + table', () => {
  test('sales_channel_settings has 14 seeded rows', async () => {
    const { data, error } = await supabase
      .from('sales_channel_settings')
      .select('channel_code, is_visible, sort_order')
      .order('sort_order');
    expect(error).toBeNull();
    expect(data?.length).toBe(14);
    expect(data?.map(r => r.channel_code)).toEqual([...ALL_CHANNELS]);
    expect(data?.every(r => r.is_visible === true)).toBe(true);
  });

  test('validate_sales_channel rejects invalid channel', async () => {
    const { error } = await supabase.rpc('validate_sales_channel', { p_channel: 'invalid-foo' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/invalid sales channel/i);
  });

  test('validate_sales_channel accepts all 14 channels', async () => {
    for (const ch of ALL_CHANNELS) {
      const { error } = await supabase.rpc('validate_sales_channel', { p_channel: ch });
      expect(error, `channel=${ch}`).toBeNull();
    }
  });
});
