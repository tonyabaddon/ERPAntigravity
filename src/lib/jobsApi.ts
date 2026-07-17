import { supabase } from './supabaseClient';

export interface JobRow {
  id: string;
  tenant_id: string;
  job_type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
}

/**
 * Enqueue an async job for the current tenant.
 * Returns the job UUID (idempotent if idempotencyKey is provided and already exists).
 */
export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown> = {},
  opts: { priority?: number; idempotencyKey?: string } = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('enqueue_job', {
    p_job_type: jobType,
    p_payload: payload,
    p_priority: opts.priority ?? 100,
    p_idempotency_key: opts.idempotencyKey ?? null,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Fetch a single job by ID. Returns null if not found.
 */
export async function getJob(jobId: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('t_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data as JobRow | null;
}

/**
 * Poll a job until it reaches a terminal state (SUCCEEDED / FAILED / CANCELED).
 *
 * @param jobId      - UUID returned by enqueueJob
 * @param intervalMs - polling interval in ms (default 2000)
 * @param timeoutMs  - max total wait in ms (default 5 min)
 * @throws if the job is not found, or if the deadline is exceeded
 */
export async function pollJobUntilDone(
  jobId: string,
  intervalMs = 2000,
  timeoutMs = 5 * 60 * 1000,
): Promise<JobRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(job.status)) {
      return job;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Job ${jobId} polling timeout after ${timeoutMs}ms`);
}
