// tests/integration/pi-phase1-cogs-view.test.ts
// BNL Phase 1 — Task 8: order_cogs_breakdown view structure + no-PI fallback.
import { describe, test, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

describe('order_cogs_breakdown view', () => {
  test('returns expected columns', async () => {
    const { data, error } = await sb.from('order_cogs_breakdown').select('*').limit(1);
    expect(error).toBeNull();
    if (data && data[0]) {
      const row = data[0] as any;
      expect(row).toHaveProperty('order_id');
      expect(row).toHaveProperty('line_index');
      expect(row).toHaveProperty('sku');
      expect(row).toHaveProperty('order_qty');
      expect(row).toHaveProperty('sell_price');
      expect(row).toHaveProperty('source_pi_number');
      expect(row).toHaveProperty('pi_unit_cost');
      expect(row).toHaveProperty('qty_from_pi');
      expect(row).toHaveProperty('qty_from_stock');
    }
  });

  test('Order with no linked PI -> qty_from_pi=0, source_pi_number=null', async () => {
    const { data: orphans } = await sb.from('orders').select('id').limit(20);
    for (const o of (orphans ?? [])) {
      const { data: linked } = await sb.from('purchase_invoices').select('id')
        .eq('order_id', (o as any).id).limit(1);
      if (!linked || linked.length === 0) {
        const { data } = await sb.from('order_cogs_breakdown').select('*').eq('order_id', (o as any).id);
        for (const row of data ?? []) {
          expect((row as any).qty_from_pi).toBe(0);
          expect((row as any).source_pi_number).toBeNull();
        }
        return;
      }
    }
  });
});
