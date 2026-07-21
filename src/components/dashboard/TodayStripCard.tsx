import React, { useEffect, useState } from 'react';
import { getTodaySnapshot } from '../../lib/dashboardReports/api';
import type { TodaySnapshot } from '../../lib/dashboardReports/types';
import { formatIDR } from '../../lib/formatIDR';
import { captureError } from '../../lib/captureError';

export default function TodayStripCard() {
  const [snap, setSnap] = useState<TodaySnapshot | null>(null);

  useEffect(() => {
    getTodaySnapshot().then(setSnap).catch((err) => {
      captureError(err, { feature: 'dashboard', action: 'fetch_today_snapshot' });
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
