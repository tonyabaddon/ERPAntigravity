import { supabase } from './supabaseClient';

export interface InferenceRow {
  kind: 'search' | 'index';
  status: 'success' | 'error' | 'cold_start_timeout';
  latency_ms: number | null;
  error_msg: string | null;
  called_at: string;
}

export interface InferenceAggregate {
  search: { success: number; error: number; coldStart: number };
  index:  { success: number; error: number; coldStart: number };
  latencyP50: number | null;
  latencyP95: number | null;
  lastErrorAt: string | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

export function aggregateInferenceRows(rows: InferenceRow[]): InferenceAggregate {
  const agg: InferenceAggregate = {
    search: { success: 0, error: 0, coldStart: 0 },
    index:  { success: 0, error: 0, coldStart: 0 },
    latencyP50: null,
    latencyP95: null,
    lastErrorAt: null,
  };
  const searchLatencies: number[] = [];
  for (const r of rows) {
    const bucket = r.kind === 'search' ? agg.search : agg.index;
    if (r.status === 'success') bucket.success++;
    else if (r.status === 'error') {
      bucket.error++;
      if (!agg.lastErrorAt || r.called_at > agg.lastErrorAt) agg.lastErrorAt = r.called_at;
    } else if (r.status === 'cold_start_timeout') bucket.coldStart++;
    if (r.kind === 'search' && r.latency_ms != null) searchLatencies.push(r.latency_ms);
  }
  const sorted = searchLatencies.sort((a, b) => a - b);
  agg.latencyP50 = percentile(sorted, 0.50);
  agg.latencyP95 = percentile(sorted, 0.95);
  return agg;
}

export async function fetchTodayInferenceRows(): Promise<InferenceRow[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const now = new Date();
  const offsetMs = 7 * 60 * 60 * 1000;
  const todayWIB = new Date(now.getTime() + offsetMs);
  todayWIB.setUTCHours(0, 0, 0, 0);
  const startUTC = new Date(todayWIB.getTime() - offsetMs).toISOString();
  const { data, error } = await supabase
    .from('clip_inference_log')
    .select('kind, status, latency_ms, error_msg, called_at')
    .gte('called_at', startUTC)
    .order('called_at', { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as InferenceRow[];
}
