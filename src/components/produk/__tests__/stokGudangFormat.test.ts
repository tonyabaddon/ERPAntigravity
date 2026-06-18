import { describe, it, expect } from 'vitest';
import { pickTopGudang } from '../stokGudangFormat';
import type { Warehouse } from '../../../types';

const wh = (id: string, name: string, sort_order: number): Warehouse =>
  ({ id, code: id.toUpperCase(), name, sort_order, is_default: false, is_active: true, address: null, tenant_id: null, created_at: '', updated_at: '' } as Warehouse);

describe('pickTopGudang', () => {
  it('returns all warehouses with stock when count <= 3, sorted by sort_order asc', () => {
    const warehouses = [wh('w2', 'Bawah', 2), wh('w1', 'Atas', 1)];
    const stockByWh = new Map([['w1', 87], ['w2', 55]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result).toEqual({
      shown: [{ name: 'Atas', qty: 87 }, { name: 'Bawah', qty: 55 }],
      remaining: 0,
    });
  });

  it('returns top 3 by sort_order and counts the remainder when count > 3', () => {
    const warehouses = [
      wh('w1', 'A', 1), wh('w2', 'B', 2), wh('w3', 'C', 3),
      wh('w4', 'D', 4), wh('w5', 'E', 5),
    ];
    const stockByWh = new Map([['w1', 10], ['w2', 20], ['w3', 30], ['w4', 40], ['w5', 50]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result.shown).toEqual([
      { name: 'A', qty: 10 }, { name: 'B', qty: 20 }, { name: 'C', qty: 30 },
    ]);
    expect(result.remaining).toBe(2);
  });

  it('treats missing stock as 0', () => {
    const warehouses = [wh('w1', 'Atas', 1), wh('w2', 'Bawah', 2)];
    const stockByWh = new Map([['w1', 87]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result.shown).toEqual([{ name: 'Atas', qty: 87 }, { name: 'Bawah', qty: 0 }]);
    expect(result.remaining).toBe(0);
  });

  it('returns empty shown + 0 remaining when warehouses list is empty', () => {
    const result = pickTopGudang([], new Map());
    expect(result).toEqual({ shown: [], remaining: 0 });
  });
});
