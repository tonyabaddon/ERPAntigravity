// Pure decision helper: given an Order's funnel sub-stage + payment type, return
// the list of PDF documents that should be downloadable from ActionPanel. The
// matrix below is the source of truth for which buttons render where; extracting
// it as a pure function lets the UI stay declarative and lets us unit-test the
// rules without spinning up React.
//
// Matrix (from `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`):
//   2a, 2b, 2c, 2d, 2e          → Sales Order
//   3a, 3b (DP-path)            → Sales Order + Invoice DP
//   3a, 3b (FULL-path)          → Sales Order + Invoice Lunas
//   3c, 3d, 3e, 3f, 3g, 3h      → Sales Order + Invoice DP + Invoice Pelunasan
//   4a, 4b (FULL)               → Sales Order + Invoice Lunas + Surat Jalan
//   4a, 4b (DP)                 → Sales Order + Invoice Pelunasan + Surat Jalan
//   5a (FULL)                   → Sales Order + Invoice Lunas + Surat Jalan
//   5a (DP)                     → Sales Order + Invoice DP + Invoice Pelunasan + Surat Jalan
//   5a (TEMPO)                  → Sales Order + Surat Jalan
//   6a, 6b                      → Sales Order + Catatan Pembatalan
//   1a, 4d                      → (none — silent in spec, render no panel)

import type { Order, FunnelSubStage, PaymentType } from '../types';

/** Stable identifiers for the six PDF document kinds. */
export type AvailablePdf = 'SO' | 'INV-DP' | 'INV-LUNAS' | 'INV-PEL' | 'SJ' | 'CAN';

type Subset = Pick<Order, 'funnel_sub_stage' | 'payment_type'>;

/**
 * Return the ordered list of PDFs to surface as download buttons for `order`.
 * Order matters: Sales Order is always first, the relevant invoice next, then
 * Surat Jalan or Catatan Pembatalan. Empty array → ActionPanel skips the row.
 */
export function availablePdfsForOrder(order: Subset): AvailablePdf[] {
  const sub = order.funnel_sub_stage;
  const pt: PaymentType = order.payment_type;

  switch (sub) {
    case '1a':
    case '4d':
      return [];

    case '2a':
    case '2b':
    case '2c':
    case '2d':
    case '2e':
      return ['SO'];

    case '3a':
    case '3b': {
      if (pt === 'DP') return ['SO', 'INV-DP'];
      if (pt === 'FULL') return ['SO', 'INV-LUNAS'];
      // TEMPO at 3a/3b: invoice will come at delivery time; show SO only.
      return ['SO'];
    }

    case '3c':
    case '3d':
    case '3e':
    case '3f':
    case '3g':
    case '3h':
      // All DP-flow sub-stages per the matrix. Show both DP + Pelunasan invoice.
      return ['SO', 'INV-DP', 'INV-PEL'];

    case '4a':
    case '4b': {
      // At delivery: SJ + the "fully paid" invoice (Lunas for FULL, Pelunasan for DP).
      if (pt === 'DP') return ['SO', 'INV-PEL', 'SJ'];
      if (pt === 'FULL') return ['SO', 'INV-LUNAS', 'SJ'];
      // TEMPO: not yet paid in full; SO + SJ only.
      return ['SO', 'SJ'];
    }

    case '5a': {
      // Archive view — show whatever applies to the payment path.
      if (pt === 'DP') return ['SO', 'INV-DP', 'INV-PEL', 'SJ'];
      if (pt === 'FULL') return ['SO', 'INV-LUNAS', 'SJ'];
      return ['SO', 'SJ'];
    }

    case '6a':
    case '6b':
      return ['SO', 'CAN'];

    default: {
      // Exhaustiveness guard. Unknown sub-stage → no buttons (safer than throwing
      // in render). TypeScript will flag missing cases above when SubStage union
      // is extended.
      const _exhaustive: FunnelSubStage = sub;
      void _exhaustive;
      return [];
    }
  }
}
