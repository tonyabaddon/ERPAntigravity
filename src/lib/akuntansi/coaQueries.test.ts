/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBebanCategories, fetchAdjustmentCounterparts } from './coaQueries';
import * as supabaseClient from '../supabaseClient';

// Mock the supabase client
vi.mock('../supabaseClient', () => ({
  supabase: null,
}));

describe('coaQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchBebanCategories', () => {
    it('should return beban categories sorted by account_code', async () => {
      const mockData = [
        {
          id: 'uuid-1',
          account_code: '5-2100',
          account_name: 'Beban Gaji',
        },
        {
          id: 'uuid-2',
          account_code: '5-2200',
          account_name: 'Beban Sewa Tempat',
        },
        {
          id: 'uuid-3',
          account_code: '5-2300',
          account_name: 'Beban Utilitas',
        },
      ];

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    eq: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn().mockResolvedValue({
                          data: mockData,
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchBebanCategories();

      expect(result).toEqual(mockData);
      expect(result).toHaveLength(3);
      expect(result[0].account_code).toBe('5-2100');
    });

    it('should return empty array when no beban categories exist', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    eq: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchBebanCategories();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should throw error when query fails', async () => {
      const mockError = { message: 'Database connection failed' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    eq: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn().mockResolvedValue({
                          data: null,
                          error: mockError,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      await expect(fetchBebanCategories()).rejects.toThrow('Database connection failed');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(fetchBebanCategories()).rejects.toThrow('Supabase not configured');
    });

    it('should return null data as empty array', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    eq: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn().mockResolvedValue({
                          data: null,
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchBebanCategories();

      expect(result).toEqual([]);
    });
  });

  describe('fetchAdjustmentCounterparts', () => {
    it('should return PENDAPATAN and BEBAN counterparts excluding parent accounts', async () => {
      const mockData = [
        {
          id: 'uuid-pend-1',
          account_code: '4-1100',
          account_name: 'Penjualan',
          account_type: 'PENDAPATAN',
          account_subtype: 'PENJUALAN',
        },
        {
          id: 'uuid-beban-1',
          account_code: '5-2100',
          account_name: 'Beban Gaji',
          account_type: 'BEBAN',
          account_subtype: 'BEBAN_OPERASIONAL',
        },
        {
          id: 'uuid-beban-2',
          account_code: '5-2200',
          account_name: 'Beban Sewa Tempat',
          account_type: 'BEBAN',
          account_subtype: 'BEBAN_OPERASIONAL',
        },
      ];

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    not: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn()
                          .mockReturnValueOnce({
                            order: vi.fn().mockResolvedValue({
                              data: mockData,
                              error: null,
                            }),
                          }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchAdjustmentCounterparts();

      expect(result).toEqual(mockData);
      expect(result).toHaveLength(3);
      expect(result[0].account_type).toBe('PENDAPATAN');
      expect(result[1].account_subtype).not.toBeNull();
    });

    it('should return empty array when no counterparts exist', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    not: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn()
                          .mockReturnValueOnce({
                            order: vi.fn().mockResolvedValue({
                              data: [],
                              error: null,
                            }),
                          }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchAdjustmentCounterparts();

      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      const mockError = { message: 'Query execution failed' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    not: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn()
                          .mockReturnValueOnce({
                            order: vi.fn().mockResolvedValue({
                              data: null,
                              error: mockError,
                            }),
                          }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      await expect(fetchAdjustmentCounterparts()).rejects.toThrow('Query execution failed');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(fetchAdjustmentCounterparts()).rejects.toThrow('Supabase not configured');
    });

    it('should return null data as empty array', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    not: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn()
                          .mockReturnValueOnce({
                            order: vi.fn().mockResolvedValue({
                              data: null,
                              error: null,
                            }),
                          }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchAdjustmentCounterparts();

      expect(result).toEqual([]);
    });

    it('should sort by account_type first, then account_code', async () => {
      const mockData = [
        {
          id: 'uuid-pend-1',
          account_code: '4-1100',
          account_name: 'Penjualan',
          account_type: 'PENDAPATAN',
          account_subtype: 'PENJUALAN',
        },
        {
          id: 'uuid-pend-2',
          account_code: '4-1200',
          account_name: 'Pendapatan Lain-lain',
          account_type: 'PENDAPATAN',
          account_subtype: 'PENDAPATAN_LAIN',
        },
        {
          id: 'uuid-beban-1',
          account_code: '5-2100',
          account_name: 'Beban Gaji',
          account_type: 'BEBAN',
          account_subtype: 'BEBAN_OPERASIONAL',
        },
      ];

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn()
              .mockReturnValueOnce({
                eq: vi.fn()
                  .mockReturnValueOnce({
                    not: vi.fn()
                      .mockReturnValueOnce({
                        order: vi.fn()
                          .mockReturnValueOnce({
                            order: vi.fn().mockResolvedValue({
                              data: mockData,
                              error: null,
                            }),
                          }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchAdjustmentCounterparts();

      expect(result).toHaveLength(3);
      expect(result[0].account_type).toBe('PENDAPATAN');
      expect(result[1].account_type).toBe('PENDAPATAN');
      expect(result[2].account_type).toBe('BEBAN');
    });
  });
});
