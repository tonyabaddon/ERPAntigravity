import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useInTransitBySKU } from '../../../hooks/useInTransitBySKU';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: { getInTransitByWarehouse: vi.fn() },
}));

describe('useInTransitBySKU', () => {
  it('returns empty map for null warehouse', () => {
    const { result } = renderHook(() => useInTransitBySKU(null));
    expect(result.current.size).toBe(0);
  });
  it('populates map from service response', async () => {
    (warehouseTransferService.getInTransitByWarehouse as any).mockResolvedValue([
      { sku: 'S1', in_transit_qty: 5 }, { sku: 'S2', in_transit_qty: 12 },
    ]);
    const { result } = renderHook(() => useInTransitBySKU('wh-x'));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get('S1')).toBe(5);
    expect(result.current.get('S2')).toBe(12);
  });
});
