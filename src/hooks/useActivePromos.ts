import { useEffect, useState } from 'react';
import { listActivePromos } from '../lib/promoProduk/api';
import type { PromoRow } from '../lib/promoProduk/types';

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
      .catch(err => console.error('[useActivePromos]', err))
      .finally(() => setLoading(false));
  }, []);
  return { promos, loading };
}
