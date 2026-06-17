// src/components/produk/stokGudangFormat.ts
import type { Warehouse } from '../../types';

export interface GudangChip {
  name: string;
  qty: number;
}

export interface TopGudangResult {
  shown: GudangChip[];
  remaining: number;
}

/**
 * Pick the first 3 warehouses by sort_order ascending and render each as
 * { name, qty }. `remaining` counts the rest so the caller can show "+N lagi".
 */
export function pickTopGudang(
  warehouses: Warehouse[],
  stockByWarehouseId: Map<string, number>,
): TopGudangResult {
  const sorted = [...warehouses].sort((a, b) => a.sort_order - b.sort_order);
  const shown = sorted.slice(0, 3).map(w => ({
    name: w.name,
    qty: stockByWarehouseId.get(w.id) ?? 0,
  }));
  const remaining = Math.max(0, sorted.length - 3);
  return { shown, remaining };
}
