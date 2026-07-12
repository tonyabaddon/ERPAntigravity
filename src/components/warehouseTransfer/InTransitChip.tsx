// src/components/warehouseTransfer/InTransitChip.tsx
import { useInTransitBySKU } from '../../hooks/useInTransitBySKU';

export function InTransitChip({ warehouseId, sku }: { warehouseId: string; sku: string }) {
  const map = useInTransitBySKU(warehouseId);
  const qty = map.get(sku) ?? 0;
  if (qty <= 0) return null;
  return (
    <span title={`+${qty} pcs sedang dalam perjalanan ke gudang ini`}
      className="ml-2 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
      +{qty} in-transit
    </span>
  );
}
