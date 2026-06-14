/**
 * embeddingPipeline — X6.73 / Phase 6.
 *
 * CLAP embedding 자동 파이프라인 운영 RPC 래퍼.
 * SQL 0340 (track_embedding_jobs 큐 + trigger + pg_cron dispatcher) 와 1:1.
 * 외부 컴퓨트 = "embed backend" (Modal endpoint 또는 Supabase Edge Function URL) 추상화.
 */
import { supabase } from '@/lib/supabase';

export interface EmbeddingPipelineStatus {
  embedded: number;
  released_total: number;
  pending_no_job: number;
  queue_pending: number;
  queue_dispatched: number;
  queue_done_24h: number;
  queue_error_24h: number;
  backend_url: string | null;
  computed_at: string;
}

export interface EmbeddingJobRow {
  id: string;
  track_id: string;
  track_title: string | null;
  status: 'pending' | 'dispatched' | 'done' | 'error' | 'skipped';
  source: string;
  attempts: number;
  max_attempts: number;
  enqueued_at: string;
  dispatched_at: string | null;
  finished_at: string | null;
  error: string | null;
  response: Record<string, unknown> | null;
}

export async function getEmbeddingPipelineStatus(): Promise<EmbeddingPipelineStatus | null> {
  const { data, error } = await supabase.rpc('admin_embedding_pipeline_status');
  if (error) throw error;
  return data as EmbeddingPipelineStatus | null;
}

export async function listEmbeddingJobs(
  status: 'pending' | 'dispatched' | 'done' | 'error' | 'all' = 'all',
  limit = 50,
): Promise<EmbeddingJobRow[]> {
  const { data, error } = await supabase.rpc('admin_list_embedding_jobs', {
    p_status: status, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as EmbeddingJobRow[];
}

export async function backfillEnqueue(limit = 1000): Promise<{ ok: boolean; enqueued: number; skipped: number }> {
  const { data, error } = await supabase.rpc('admin_embedding_backfill_enqueue', { p_limit: limit });
  if (error) throw error;
  return data as { ok: boolean; enqueued: number; skipped: number };
}

export async function retryEmbeddingJob(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  const { data, error } = await supabase.rpc('admin_retry_embedding_job', { p_job_id: jobId });
  if (error) throw error;
  return data as { ok: boolean; job_id: string };
}

export async function setEmbedBackendUrl(url: string): Promise<{ ok: boolean; url: string }> {
  const { data, error } = await supabase.rpc('admin_set_embed_backend_url', { p_url: url });
  if (error) throw error;
  return data as { ok: boolean; url: string };
}

export async function manualDispatch(maxBatch?: number): Promise<{ ok: boolean; dispatched: number; reason?: string }> {
  const { data, error } = await supabase.rpc('dispatch_embedding_jobs', {
    p_max_batch: maxBatch ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; dispatched: number; reason?: string };
}
