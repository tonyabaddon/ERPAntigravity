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

  // Internal loader used by the realtime subscription. `refresh` (exported)
  // is the public version that consumers can call imperatively; both share
  // the same body, but only the in-effect version is guarded by the
  // mounted flag so we don't setState on an unmounted component.
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
    let mounted = true;
    const load = async () => {
      try {
        const rows = activeOnly
          ? await warehousesService.fetchActive()
          : await warehousesService.fetchAll();
        if (!mounted) return;
        setWarehouses(rows);
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    if (!supabase) {
      return () => { mounted = false; };
    }
    const ch = supabase
      .channel('warehouses-realtime')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'warehouses' },
          () => { void load(); })
      .subscribe();
    return () => {
      mounted = false;
      supabase!.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  return { warehouses, loading, error, refresh };
}
