// src/hooks/useWarehouses.ts
//
// One-shot fetch + realtime cache of the active warehouse list. Used by
// every consumer of <WarehousePicker> so they don't each hit the DB.
// 2026-06-13 spec.

import { useEffect, useState } from 'react';
import type { Warehouse } from '../types';
import { warehousesService, supabase } from '../lib/supabaseClient';

interface UseWarehousesResult {
  warehouses: Warehouse[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWarehouses(opts: { activeOnly?: boolean } = {}): UseWarehousesResult {
  const { activeOnly = true } = opts;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const rows = activeOnly
        ? await warehousesService.fetchActive()
        : await warehousesService.fetchAll();
      setWarehouses(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    if (!supabase) return;
    const ch = supabase
      .channel('warehouses-realtime')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'warehouses' },
          () => { void refresh(); })
      .subscribe();
    return () => { supabase!.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  return { warehouses, loading, error, refresh };
}
