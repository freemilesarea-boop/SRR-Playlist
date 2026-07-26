/**
 * aiRuntimeApi — Phase AI-RUNTIME-CONNECTION-1
 *
 * RPC wrappers for the store-scoped AI runtime feature flag + candidate queue.
 * SQL: supabase/migrations/0464_ai_runtime_store_settings.sql
 *
 *   get_store_ai_runtime_mode(store)                 — runtime read (store-self/HQ/admin)
 *   get_store_ai_runtime_queue(store, playlist, lim) — runtime candidate queue (mode-gated)
 *   admin_get_ai_runtime_store_settings(store)       — admin/HQ management read
 *   admin_set_ai_runtime_store_settings(...)         — platform-admin approval write
 */
import { supabase } from '@/lib/supabase';
import {
  parseRuntimeMode,
  parseCandidateItems,
  type AiRuntimeModeInfo,
  type RuntimeCandidateItem,
} from '@/lib/aiRuntimeResolver';

export interface AiRuntimeStoreSettings {
  store_id: string;
  enabled: boolean;
  mode: 'off' | 'preview' | 'shadow';
  max_ai_tracks: number;
  minimum_fit_score: number;
  approved_by: string | null;
  approved_at: string | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
  exists: boolean;
}

/** Runtime effective mode. Fail-closed to OFF on any error (never throws). */
export async function fetchStoreAiRuntimeMode(storeId: string): Promise<AiRuntimeModeInfo> {
  try {
    const { data, error } = await supabase.rpc('get_store_ai_runtime_mode', { p_store_id: storeId });
    if (error) throw error;
    return parseRuntimeMode(data);
  } catch (e) {
    if (import.meta.env.DEV) console.debug('[aiRuntimeApi] mode fetch failed → OFF', (e as Error)?.message);
    return parseRuntimeMode(null); // OFF
  }
}

/** Runtime candidate queue. Returns [] on disabled/error (caller falls back to static). */
export async function fetchStoreAiRuntimeQueue(
  storeId: string,
  playlistId: string,
  limit?: number,
): Promise<RuntimeCandidateItem[]> {
  const { data, error } = await supabase.rpc('get_store_ai_runtime_queue', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
    p_limit: limit ?? null,
  });
  if (error) throw error; // caller decides fallback; distinguishes disabled vs empty
  return parseCandidateItems(data);
}

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

export async function adminGetAiRuntimeStoreSettings(storeId: string): Promise<AiRuntimeStoreSettings> {
  const { data, error } = await supabase.rpc('admin_get_ai_runtime_store_settings', { p_store_id: storeId });
  if (error) throw error;
  return data as AiRuntimeStoreSettings;
}

export interface AdminSetRuntimeSettingsInput {
  storeId: string;
  mode: 'off' | 'preview' | 'shadow';
  enabled: boolean;
  maxAiTracks?: number;
  minimumFitScore?: number;
  note?: string | null;
}

export async function adminSetAiRuntimeStoreSettings(
  input: AdminSetRuntimeSettingsInput,
): Promise<AiRuntimeStoreSettings> {
  const { data, error } = await supabase.rpc('admin_set_ai_runtime_store_settings', {
    p_store_id: input.storeId,
    p_mode: input.mode,
    p_enabled: input.enabled,
    p_max_ai_tracks: input.maxAiTracks ?? null,
    p_minimum_fit_score: input.minimumFitScore ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return data as AiRuntimeStoreSettings;
}
