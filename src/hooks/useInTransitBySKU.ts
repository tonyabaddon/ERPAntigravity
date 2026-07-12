import { useEffect, useState } from 'react';
import { warehouseTransferService } from '../lib/warehouseTransferService';

export function useInTransitBySKU(warehouseId: string | null): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!warehouseId) { setMap(new Map()); return; }
    let cancelled = false;
    warehouseTransferService.getInTransitByWarehouse(warehouseId).then(rows => {
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.sku, r.in_transit_qty);
      setMap(m);
    }).catch(() => { if (!cancelled) setMap(new Map()); });
    return () => { cancelled = true; };
  }, [warehouseId]);
  return map;
}
