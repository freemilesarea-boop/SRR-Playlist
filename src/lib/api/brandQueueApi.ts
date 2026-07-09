// Phase ENT-OS-4 — Brand Queue Engine RPC 래퍼.
// 0411 admin_preview/build/list/get brand queue. 모두 super_admin RPC.
import { supabase } from '@/lib/supabase';

export type QueueStrategy = 'balanced_shuffle' | 'sequential' | 'weighted';
export const QUEUE_STRATEGIES: QueueStrategy[] = ['balanced_shuffle', 'sequential', 'weighted'];

export interface QueueCandidateTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  bpm: number | null;
  energy: number | null;
  sort_order?: number | null;
  weight?: number | null;
  source_playlist_id: string | null;
  source_reason: string | null;
}

export interface QueueStats {
  total_candidates: number;
  returned: number;
  distinct_artists: number;
  distinct_genres: number;
  distinct_moods: number;
  strategy: string;
  fallback_used: boolean;
}

export interface QueuePreview {
  tracks: QueueCandidateTrack[];
  explanation: string[];
  stats: QueueStats;
  strategy: string;
  seed: string;
  fallback_used: boolean;
  source_playlist_id: string | null;
  runtime_rule_id: string | null;
}

export interface QueueRunSummary {
  id: string;
  strategy: string;
  track_count: number;
  status: string;
  seed: string | null;
  reason: string | null;
  playlist_id: string | null;
  runtime_rule_id: string | null;
}

export interface QueueBuildResult {
  queue_run: QueueRunSummary;
  tracks: QueueCandidateTrack[];
  explanation: string[];
  stats: QueueStats;
}

export interface QueueRunListItem {
  id: string;
  strategy: string;
  status: string;
  track_count: number;
  playlist_id: string | null;
  playlist_name: string | null;
  runtime_rule_id: string | null;
  runtime_rule_name: string | null;
  reason: string | null;
  seed: string | null;
  created_at: string;
}

export interface QueueDetailTrack {
  sort_order: number;
  track_id: string;
  title: string | null;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  bpm: number | null;
  energy: number | null;
  source_playlist_id: string | null;
  source_reason: string | null;
}

export interface QueueDetail {
  queue_run: {
    id: string; brand_id: string; playlist_id: string | null; runtime_rule_id: string | null;
    strategy: string; status: string; track_count: number; seed: string | null; reason: string | null;
    context: Record<string, unknown>; created_at: string;
  };
  tracks: QueueDetailTrack[];
}

interface QueueOpts {
  playlistId?: string | null;
  context?: Record<string, unknown>;
  strategy?: QueueStrategy;
  limit?: number;
}

export async function adminPreviewBrandQueue(brandId: string, opts: QueueOpts = {}): Promise<QueuePreview> {
  const { data, error } = await supabase.rpc('admin_preview_brand_queue', {
    p_brand_id: brandId,
    p_playlist_id: opts.playlistId ?? null,
    p_context: opts.context ?? {},
    p_strategy: opts.strategy ?? 'balanced_shuffle',
    p_limit: opts.limit ?? 100,
  });
  if (error) throw error;
  return data as QueuePreview;
}

export async function adminBuildBrandQueue(brandId: string, opts: QueueOpts = {}): Promise<QueueBuildResult> {
  const { data, error } = await supabase.rpc('admin_build_brand_queue', {
    p_brand_id: brandId,
    p_playlist_id: opts.playlistId ?? null,
    p_context: opts.context ?? {},
    p_strategy: opts.strategy ?? 'balanced_shuffle',
    p_limit: opts.limit ?? 100,
  });
  if (error) throw error;
  return data as QueueBuildResult;
}

export async function adminListBrandQueues(brandId: string): Promise<QueueRunListItem[]> {
  const { data, error } = await supabase.rpc('admin_list_brand_queues', { p_brand_id: brandId });
  if (error) throw error;
  return (data ?? []) as QueueRunListItem[];
}

export async function adminGetBrandQueue(queueRunId: string): Promise<QueueDetail> {
  const { data, error } = await supabase.rpc('admin_get_brand_queue', { p_queue_run_id: queueRunId });
  if (error) throw error;
  return data as QueueDetail;
}
