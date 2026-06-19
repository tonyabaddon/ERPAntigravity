import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fromMock, eqMock, inMock } = vi.hoisted(() => {
  const eqMock = vi.fn();
  const inMock = vi.fn();
  const fromMock = vi.fn();
  return { fromMock, eqMock, inMock };
});

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: fromMock,
  },
}));

import { fetchPiutangRows } from '../piutangService';

describe('fetchPiutangRows includeWrittenOff', () => {
  beforeEach(() => {
    fromMock.mockReset(); eqMock.mockReset(); inMock.mockReset();
  });

  test('default (no opts) filters to INVOICE_TEMPO only', async () => {
    const select = vi.fn().mockReturnValue({
      eq: (col: string, val: unknown) => {
        eqMock(col, val);
        return {
          eq: (col2: string, val2: unknown) => {
            eqMock(col2, val2);
            return {
              order: () => Promise.resolve({ data: [], error: null }),
            };
          },
        };
      },
    });
    fromMock.mockReturnValue({ select });
    await fetchPiutangRows();
    expect(eqMock).toHaveBeenCalledWith('payment_type', 'TEMPO');
    expect(eqMock).toHaveBeenCalledWith('status', 'INVOICE_TEMPO');
  });

  test('includeWrittenOff=true uses .in() with both statuses', async () => {
    const select = vi.fn().mockReturnValue({
      eq: (col: string, val: unknown) => {
        eqMock(col, val);
        return {
          in: (col2: string, vals: unknown[]) => {
            inMock(col2, vals);
            return {
              order: () => Promise.resolve({ data: [], error: null }),
            };
          },
        };
      },
    });
    fromMock.mockReturnValue({ select });
    await fetchPiutangRows({ includeWrittenOff: true });
    expect(eqMock).toHaveBeenCalledWith('payment_type', 'TEMPO');
    expect(inMock).toHaveBeenCalledWith('status', ['INVOICE_TEMPO', 'INVOICE_WRITTEN_OFF']);
  });
});
