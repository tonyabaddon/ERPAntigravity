import { describe, it, expect } from 'vitest';
import { aggregateInferenceRows } from '../clipMonitorService';

describe('aggregateInferenceRows', () => {
  it('returns zeros when no rows', () => {
    expect(aggregateInferenceRows([])).toEqual({
      search: { success: 0, error: 0, coldStart: 0 },
      index: { success: 0, error: 0, coldStart: 0 },
      latencyP50: null,
      latencyP95: null,
      lastErrorAt: null,
    });
  });

  it('counts statuses per kind', () => {
    const rows = [
      { kind: 'search', status: 'success', latency_ms: 150, error_msg: null, called_at: '2026-06-16T03:00:00Z' },
      { kind: 'search', status: 'error',   latency_ms: 200, error_msg: 'boom', called_at: '2026-06-16T03:01:00Z' },
      { kind: 'search', status: 'cold_start_timeout', latency_ms: null, error_msg: null, called_at: '2026-06-16T03:02:00Z' },
      { kind: 'index',  status: 'success', latency_ms: 130, error_msg: null, called_at: '2026-06-16T03:03:00Z' },
    ] as const;
    const agg = aggregateInferenceRows(rows as any);
    expect(agg.search.success).toBe(1);
    expect(agg.search.error).toBe(1);
    expect(agg.search.coldStart).toBe(1);
    expect(agg.index.success).toBe(1);
    expect(agg.lastErrorAt).toBe('2026-06-16T03:01:00Z');
  });

  it('computes p50/p95 latency from search rows only', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      kind: 'search', status: 'success', latency_ms: i + 1, error_msg: null, called_at: '2026-06-16T03:00:00Z',
    }));
    const agg = aggregateInferenceRows(rows as any);
    expect(agg.latencyP50).toBe(50);
    expect(agg.latencyP95).toBe(95);
  });
});
