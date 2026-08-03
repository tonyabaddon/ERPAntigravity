import React from 'react';
import type { DbPurchaseInvoice } from '../../../types';
import { isTerlambat, isDueSoon } from '../../../lib/purchaseInvoiceService';

export default function PiStatusBadge({ pi }: { pi: DbPurchaseInvoice }) {
  if (pi.voided_at) {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">VOID</span>;
  }
  if (pi.status === 'LUNAS') {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-caleo-success">● Lunas</span>;
  }
  if (isTerlambat(pi)) {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-caleo-danger">⚠ Terlambat</span>;
  }
  if (isDueSoon(pi)) {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">⏰ Jatuh Tempo ≤3 Hari</span>;
  }
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">○ Belum Lunas</span>;
}
