import { useEffect, useState } from 'react';
import { listActivePromos } from '../lib/promoProduk/api';
import type { PromoRow } from '../lib/promoProduk/types';
import { captureError } from '../lib/captureError';

export function useActivePromos(): { promos: Map<string, PromoRow>; loading: boolean } {
  const [promos, setPromos] = useState<Map<string, PromoRow>>(new Map());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listActivePromos('active')
      .then(rows => {
        const m = new Map<string, PromoRow>();
        for (const r of rows) m.set(r.sku, r);
        setPromos(m);
      })
      .catch(err => captureError(err, { feature: 'active_promos', action: 'list_active_promos' }))
      .finally(() => setLoading(false));
  }, []);
  return { promos, loading };
}
