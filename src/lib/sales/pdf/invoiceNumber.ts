// Thin wrapper around the `next_invoice_number` RPC defined in migration
// 20260625000014. The RPC atomically increments a per-(doc_type, year) counter
// and returns the formatted number, e.g. "SO/2026/00012". The union type below
// matches the doc types Phase 1B PDF generators need.
//
// NOTE: do NOT format numbers client-side. Always go through this wrapper so
// the counter stays the single source of truth, avoiding duplicate doc
// numbers under concurrent admin sessions.

import { supabase } from '../../supabaseClient';

export type SalesDocType =
  | 'SO'
  | 'INV-DP'
  | 'INV-PEL'
  | 'INV-LUNAS'
  | 'INV-TEMPO'
  | 'SJ'
  | 'CANCEL';

/**
 * Atomically increments per-year per-doc-type counter in Supabase and
 * returns the formatted doc number. Backed by RPC `next_invoice_number`
 * defined in migration 20260625000014.
 */
export async function nextInvoiceNumber(docType: SalesDocType): Promise<string> {
  const { data, error } = await supabase.rpc('next_invoice_number', { p_doc_type: docType });
  if (error) throw error;
  return data as string;
}
