// src/hooks/useWarehouses.ts
//
// One-shot fetch + realtime cache of the active warehouse list. Used by
// every consumer of <WarehousePicker> so they don't each hit the DB.
// 2026-06-13 spec.

import { useEffect, useId, useState } from 'react';
import type { Warehouse } from '../types';
import { warehousesService, supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { extractErrorMessage } from '../lib/extractErrorMessage';

interface UseWarehousesResult {
  warehouses: Warehouse[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWarehouses(opts: { activeOnly?: boolean } = {}): UseWarehousesResult {
  const { activeOnly = true } = opts;
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Unique-per-instance channel name. supabase.channel(name) returns the
  // existing channel if `name` matches one already subscribed elsewhere —
  // which then throws when a second consumer tries to call .on() on the
  // already-subscribed channel. Multiple components (PenjualanBaruScreen +
  // CartRows + modals) all call useWarehouses on the same page, so the
  // channel name MUST be per-instance to keep their subscriptions independent.
  const instanceId = useId();

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
      setError(extractErrorMessage(e));
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
        setError(extractErrorMessage(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    if (!supabase) {
      return () => { mounted = false; };
    }
    if (!tenantId) {
      return () => { mounted = false; };
    }
    // tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
    // unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
    // Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
    const ch = supabase
      .channel(`warehouses-realtime-${instanceId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'warehouses', filter: `tenant_id=eq.${tenantId}` },
          () => { void load(); })
      .subscribe();
    return () => {
      mounted = false;
      supabase!.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly, tenantId]);

  return { warehouses, loading, error, refresh };
}
