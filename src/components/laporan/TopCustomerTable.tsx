import React, { useEffect, useState } from 'react';
import { getTopCustomers } from '../../lib/dashboardReports/api';
import type { TopCustomerRow, PeriodDays } from '../../lib/dashboardReports/types';

interface Props {
  days: PeriodDays;
  onOpenCustomer?: (customerId: string) => void;
}

function formatRupiah(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(val);
}

export default function TopCustomerTable({ days, onOpenCustomer }: Props) {
  const [rows, setRows] = useState<TopCustomerRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    getTopCustomers(days, 10).then(setRows).catch((err) => {
      console.error('[TopCustomerTable]', err);
      setRows([]);
    });
  }, [days]);

  if (rows === null) {
    return <p className="text-sm text-slate-400 italic">Memuat data customer...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 italic">Belum ada transaksi customer dalam periode ini.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
          <th className="text-left pb-3 font-bold">#</th>
          <th className="text-left pb-3 font-bold">Customer</th>
          <th className="text-right pb-3 font-bold">Total belanja</th>
          <th className="text-right pb-3 font-bold"># Trans</th>
          <th className="text-right pb-3 font-bold">Terakhir beli</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.customer_id}
            className={`border-b border-gray-50 transition-colors ${onOpenCustomer ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            onClick={() => onOpenCustomer?.(r.customer_id)}
          >
            <td className="py-3 text-gray-300 font-bold w-8">{i + 1}</td>
            <td className="py-3">
              <div className="text-slate-800 font-semibold">{r.customer_name}</div>
              {r.customer_company && (
                <div className="text-xs text-slate-500">{r.customer_company}</div>
              )}
            </td>
            <td className="py-3 text-right font-bold text-emerald-700">{formatRupiah(r.total_revenue)}</td>
            <td className="py-3 text-right text-slate-600">{r.transaction_count}x</td>
            <td className="py-3 text-right">
              <span className={r.days_since_last > 14 ? 'text-amber-700' : 'text-slate-600'}>
                {r.days_since_last === 0 ? 'Hari ini' : `${r.days_since_last} hari lalu`}
                {r.days_since_last > 14 && ' ⚠'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
