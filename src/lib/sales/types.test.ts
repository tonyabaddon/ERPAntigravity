import { describe, test, expectTypeOf } from 'vitest';
import type { OrderType, FunnelStage, FunnelSubStage, Order } from './types';

describe('Sales types', () => {
  test('OrderType is enum of 3', () => {
    expectTypeOf<OrderType>().toEqualTypeOf<'KOMPONEN' | 'CUSTOM_PANEL' | 'RAKIT_PANEL'>();
  });
  test('FunnelStage covers 1-6', () => {
    expectTypeOf<FunnelStage>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
  });
  test('Order has required fields', () => {
    const o: Order = {
      id: 'a', customer: 'C', total: 100, channel: 'WhatsApp',
      order_type: 'KOMPONEN', funnel_stage: 2, funnel_sub_stage: '2a',
      delivery_method: 'PICKUP', version: 1, payment_type: 'FULL',
      status_label: 's', time_ago: '5m', stuck: false,
    };
    expectTypeOf(o.id).toEqualTypeOf<string>();
  });
});
