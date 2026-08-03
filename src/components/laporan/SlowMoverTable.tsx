import React, { useEffect, useState } from 'react';
import { getSlowMovingStock } from '../../lib/dashboardReports/api';
import type { SlowMovingRow, PeriodDays } from '../../lib/dashboardReports/types';
import { captureError } from '../../lib/captureError';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';

interface Props { days: PeriodDays; }

export default function SlowMoverTable({ days }: Props) {
  const [rows, setRows] = useState<SlowMovingRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    getSlowMovingStock(days, 20).then(setRows).catch((err) => {
      captureError(err, { feature: 'laporan', action: 'fetch_slow_moving_stock' });
      setRows([]);
    });
  }, [days]);

  if (rows === null) {
    return <LoadingState label="Memuat data slow-moving..." inline />;
  }
  if (rows.length === 0) {
    return <EmptyState message="Tidak ada SKU slow-moving dalam periode ini." inline />;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
          <th className="text-left pb-3 font-bold">SKU</th>
          <th className="text-left pb-3 font-bold">Nama</th>
          <th className="text-right pb-3 font-bold">Stok</th>
          <th className="text-right pb-3 font-bold">Terjual periode</th>
          <th className="text-right pb-3 font-bold">Umur stagnasi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.sku} className="border-b border-gray-50 hover:bg-slate-50 transition-colors">
            <td className="py-3 font-mono text-xs text-slate-600">{r.sku}</td>
            <td className="py-3 text-slate-800 font-semibold">{r.name}</td>
            <td className="py-3 text-right text-slate-600">{r.stock}</td>
            <td className="py-3 text-right text-slate-600">{r.qty_sold} unit</td>
            <td className="py-3 text-right">
              <span className={r.severity === 'dead' ? 'text-caleo-danger font-bold' : 'text-amber-700 font-semibold'}>
                {r.days_stagnant} hari{r.severity === 'dead' ? ' \u{1F480}' : ' ⚠'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
