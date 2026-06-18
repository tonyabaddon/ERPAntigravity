import { describe, test, expect } from 'vitest';
import { availablePdfsForOrder, type AvailablePdf } from './availablePdfs';
import type { FunnelSubStage, PaymentType } from '../types';

// Exhaustive matrix test. Pinning every (sub_stage × payment_type) cell here
// keeps the spec interpretation reviewable in one place — any future tweak to
// the helper must update this table, which the diff will surface.
type Row = { sub: FunnelSubStage; pt: PaymentType; expect: AvailablePdf[] };

const matrix: Row[] = [
  // Stage 1 / 4d — silent in spec, no panel.
  { sub: '1a', pt: 'FULL', expect: [] },
  { sub: '1a', pt: 'DP', expect: [] },
  { sub: '1a', pt: 'TEMPO', expect: [] },
  { sub: '4d', pt: 'FULL', expect: [] },
  { sub: '4d', pt: 'DP', expect: [] },
  { sub: '4d', pt: 'TEMPO', expect: [] },

  // Stage 2 — SO only across all payment types and 2a..2e.
  ...(['2a', '2b', '2c', '2d', '2e'] as FunnelSubStage[]).flatMap(sub => ([
    { sub, pt: 'FULL' as PaymentType, expect: ['SO'] as AvailablePdf[] },
    { sub, pt: 'DP' as PaymentType, expect: ['SO'] as AvailablePdf[] },
    { sub, pt: 'TEMPO' as PaymentType, expect: ['SO'] as AvailablePdf[] },
  ])),

  // 3a, 3b — split by payment type.
  { sub: '3a', pt: 'FULL', expect: ['SO', 'INV-LUNAS'] },
  { sub: '3a', pt: 'DP', expect: ['SO', 'INV-DP'] },
  { sub: '3a', pt: 'TEMPO', expect: ['SO'] },
  { sub: '3b', pt: 'FULL', expect: ['SO', 'INV-LUNAS'] },
  { sub: '3b', pt: 'DP', expect: ['SO', 'INV-DP'] },
  { sub: '3b', pt: 'TEMPO', expect: ['SO'] },

  // 3c..3h — DP flow per spec (SO + INV-DP + INV-PEL across all payment types).
  ...(['3c', '3d', '3e', '3f', '3g', '3h'] as FunnelSubStage[]).flatMap(sub => ([
    { sub, pt: 'FULL' as PaymentType, expect: ['SO', 'INV-DP', 'INV-PEL'] as AvailablePdf[] },
    { sub, pt: 'DP' as PaymentType, expect: ['SO', 'INV-DP', 'INV-PEL'] as AvailablePdf[] },
    { sub, pt: 'TEMPO' as PaymentType, expect: ['SO', 'INV-DP', 'INV-PEL'] as AvailablePdf[] },
  ])),

  // 4a, 4b — SJ + fully-paid invoice (LUNAS for FULL, PEL for DP).
  { sub: '4a', pt: 'FULL', expect: ['SO', 'INV-LUNAS', 'SJ'] },
  { sub: '4a', pt: 'DP', expect: ['SO', 'INV-PEL', 'SJ'] },
  { sub: '4a', pt: 'TEMPO', expect: ['SO', 'SJ'] },
  { sub: '4b', pt: 'FULL', expect: ['SO', 'INV-LUNAS', 'SJ'] },
  { sub: '4b', pt: 'DP', expect: ['SO', 'INV-PEL', 'SJ'] },
  { sub: '4b', pt: 'TEMPO', expect: ['SO', 'SJ'] },

  // 5a — archive: everything that applies.
  { sub: '5a', pt: 'FULL', expect: ['SO', 'INV-LUNAS', 'SJ'] },
  { sub: '5a', pt: 'DP', expect: ['SO', 'INV-DP', 'INV-PEL', 'SJ'] },
  { sub: '5a', pt: 'TEMPO', expect: ['SO', 'SJ'] },

  // 6a, 6b — cancellation record.
  { sub: '6a', pt: 'FULL', expect: ['SO', 'CAN'] },
  { sub: '6a', pt: 'DP', expect: ['SO', 'CAN'] },
  { sub: '6a', pt: 'TEMPO', expect: ['SO', 'CAN'] },
  { sub: '6b', pt: 'FULL', expect: ['SO', 'CAN'] },
  { sub: '6b', pt: 'DP', expect: ['SO', 'CAN'] },
  { sub: '6b', pt: 'TEMPO', expect: ['SO', 'CAN'] },
];

describe('availablePdfsForOrder', () => {
  test.each(matrix)(
    'sub=$sub pt=$pt → $expect',
    ({ sub, pt, expect: want }) => {
      const got = availablePdfsForOrder({ funnel_sub_stage: sub, payment_type: pt });
      expect(got).toEqual(want);
    },
  );

  test('order matters: Sales Order is always first when present', () => {
    const rows: Row[] = matrix.filter(r => r.expect.length > 0);
    for (const r of rows) {
      const got = availablePdfsForOrder({ funnel_sub_stage: r.sub, payment_type: r.pt });
      expect(got[0]).toBe('SO');
    }
  });
});
