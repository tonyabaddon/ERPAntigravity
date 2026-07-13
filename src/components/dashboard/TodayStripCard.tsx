import React, { useEffect, useState } from 'react';
import { getTodaySnapshot } from '../../lib/dashboardReports/api';
import type { TodaySnapshot } from '../../lib/dashboardReports/types';
import { formatIDR } from '../../lib/formatIDR';

export default function TodayStripCard() {
  const [snap, setSnap] = useState<TodaySnapshot | null>(null);

  useEffect(() => {
    getTodaySnapshot().then(setSnap).catch((err) => {
      console.error('[TodayStripCard]', err);
      setSnap({ revenue_today: 0, count_today: 0 });
    });
  }, []);

  if (!snap) {
    return <div className="text-sm text-slate-400">Memuat data hari ini...</div>;
  }

  return (
    <div className="text-sm text-slate-600">
      Hari ini: <span className="font-bold text-slate-800">{formatIDR(snap.revenue_today)}</span>
      {' · '}
      <span className="font-bold text-slate-800">{snap.count_today} transaksi</span>
    </div>
  );
}
