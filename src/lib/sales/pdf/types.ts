// Shared PDF types for the Phase 1B sales generators. One file per concept
// keeps the six generators in `src/lib/sales/pdf/*Pdf.ts` lined up on the same
// row shape and return contract.

import type { Order } from '../types';

/** Row in the items table — qty/unit price/subtotal in plain rupiah numbers. */
export type ItemRow = {
  name: string;
  qty: number;
  unit_price?: number;
  subtotal: number;
};

/** Common return shape for every PDF generator. */
export type PdfResult = {
  blob: Blob;
  docNumber: string;
  filename: string;
};

/**
 * Superset of the database `Order` row with the optional PDF-only extras the
 * generators read. Each generator only consumes the subset it needs; callers
 * pass the same hydrated object and let TypeScript narrow access.
 */
export type OrderForPdf = Order & {
  items?: ItemRow[];
  ongkir_amount?: number;
  dp_amount?: number;
  payment_method?: string;
  customer_phone?: string;
  customer_address?: string;
  resi_number?: string;
  delivery_notes?: string;
  cancel_date?: string;
  cancelled_by?: string;
  cancel_reason?: string;
  refund_amount?: number;
  refund_method?: string;
};
