// AI-MUSIC-2 — AI Playlist API. Composes the AI-MUSIC-1 read RPCs (store aggregate + track profiles) with
// the 0465 builder RPC (recent-7d plays = fatigue signal) and runs the rule-based aiPlaylist engines
// client-side to GENERATE a proposed playlist. Read-only analysis + advisory snapshots. Nothing
// auto-deploys a playlist or runs a policy — every result is a proposal or a simulation.

import { supabase } from '@/lib/supabase';
import {
  computeStoreProfile, computeTrackProfile, computeCompatibility,
  type StorePlayAggregate, type TrackMeta, type TrackPerformance,
} from '@/lib/aiMusic';
import {
  buildPlaylist, compareCandidates,
  type BuilderTrack, type GeneratedPlaylist, type CandidateComparison, type BuildStrategy, type PlaylistBuildInput,
} from '@/lib/aiPlaylist';

export interface AiPlaylistBundleInput {
  storeId: string;
  storeType: string | null;
  hour: number | null;
  targetLength: number;
}

interface TrackRow { meta: TrackMeta; perf: TrackPerformance; }

async function fetchAggregate(storeId: string): Promise<StorePlayAggregate | null> {
  const { data, error } = await supabase.rpc('admin_ai_store_aggregate', { p_store: storeId, p_window: '30d' });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean; aggregate?: StorePlayAggregate }).aggregate ?? null;
}
async function fetchTrackRows(storeType: string | null, limit = 200): Promise<TrackRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_track_profiles', { p_store_type: storeType, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; tracks?: TrackRow[] };
  return res.ok ? (res.tracks ?? []) : [];
}
async function fetchRecentPlays(storeId: string, days = 7): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('admin_ai_playlist_builder', { p_store: storeId, p_days: days, p_limit: 2000 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; recentPlays?: Record<string, number> };
  return res.ok ? (res.recentPlays ?? {}) : {};
}

/** Assemble the BuilderTrack pool for a store (store profile + track compatibility + recent-play fatigue). */
async function assemblePool(input: AiPlaylistBundleInput): Promise<{ pool: BuilderTrack[]; storeReady: boolean; storeEnergyPreference: number | null }> {
  const [agg, rows, recent] = await Promise.all([
    fetchAggregate(input.storeId), fetchTrackRows(input.storeType), fetchRecentPlays(input.storeId),
  ]);
  if (!agg) return { pool: [], storeReady: false, storeEnergyPreference: null };
  const store = computeStoreProfile(agg);
  const pool: BuilderTrack[] = rows.map((r) => {
    const tp = computeTrackProfile(r.meta, r.perf);
    const compat = computeCompatibility(store, tp, r.perf);
    return {
      trackId: r.meta.trackId, title: r.meta.title, genre: r.meta.genre, mood: r.meta.mood, energy: r.meta.energy,
      instrumental: r.meta.instrumental, bpm: r.meta.bpm, compatScore: compat.score,
      learningScore: r.perf.learningScore, recentPlays7d: recent[r.meta.trackId] ?? 0,
    };
  });
  return { pool, storeReady: store.status === 'READY', storeEnergyPreference: store.energyPreference };
}

function toBuildInput(input: AiPlaylistBundleInput, pool: BuilderTrack[], storeReady: boolean, energyPref: number | null, strategy: BuildStrategy): PlaylistBuildInput {
  return {
    storeId: input.storeId, storeType: input.storeType, storeReady, storeEnergyPreference: energyPref,
    hour: input.hour, targetLength: input.targetLength, strategy, pool,
  };
}

/** Generate a single proposed playlist for a store (SIMULATION ONLY). */
export async function generateStorePlaylist(input: AiPlaylistBundleInput, strategy: BuildStrategy = 'BALANCED'): Promise<GeneratedPlaylist> {
  const { pool, storeReady, storeEnergyPreference } = await assemblePool(input);
  return buildPlaylist(toBuildInput(input, pool, storeReady, storeEnergyPreference, strategy));
}

/** Build + compare A/B/C candidates for a store (SIMULATION ONLY). */
export async function compareStorePlaylists(input: AiPlaylistBundleInput): Promise<CandidateComparison> {
  const { pool, storeReady, storeEnergyPreference } = await assemblePool(input);
  const base = {
    storeId: input.storeId, storeType: input.storeType, storeReady, storeEnergyPreference,
    hour: input.hour, targetLength: input.targetLength, pool,
  };
  return compareCandidates(base);
}

// ── Persisted generated playlists (advisory — no auto-distribution) ──
export interface AiGeneratedPlaylistRow {
  id: string; storeId: string | null; storeType: string | null; strategy: string; timeSlot: string | null;
  trackCount: number; diversity: number | null; fatigueRisk: number | null; curveFit: number | null;
  confidence: string | null; trackIds: string[]; notes: string[]; createdAt: string;
}
export async function getGeneratedPlaylists(storeId: string | null, limit = 50): Promise<AiGeneratedPlaylistRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_playlist_candidates', { p_store: storeId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; playlists?: AiGeneratedPlaylistRow[] };
  return res.ok ? (res.playlists ?? []) : [];
}

/** Persist a generated playlist proposal snapshot (advisory — nothing deployed/played). */
export async function saveGeneratedPlaylist(pl: GeneratedPlaylist): Promise<string | null> {
  const { data, error } = await supabase.rpc('record_ai_generated_playlist', {
    p_store: pl.storeId, p_store_type: pl.storeType, p_strategy: pl.strategy, p_time_slot: pl.timeSlot?.key ?? null,
    p_track_ids: pl.picks.map((p) => p.trackId), p_track_count: pl.trackCount, p_diversity: pl.diversity,
    p_fatigue_risk: pl.fatigueRisk, p_curve_fit: pl.curveFit, p_confidence: pl.confidence.level,
    p_energy_curve: pl.energyCurve, p_explain: pl.picks.map((p) => ({ trackId: p.trackId, factors: p.explain.factors })),
    p_notes: pl.notes,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean; id?: string }).id ?? null;
}

/** Persist an A/B/C candidate comparison snapshot (advisory). */
export async function saveComparison(cmp: CandidateComparison): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_ai_playlist_compare', {
    p_store: cmp.storeId,
    p_candidates: cmp.candidates.map((c) => ({ label: c.label, strategy: c.strategy, score: c.score, isBest: c.isBest, metrics: c.metrics })),
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}

/** Persist a playlist simulation snapshot (advisory — prediction only). */
export async function saveSimulation(input: {
  storeId: string; playlistId: string | null; predictedSkip: number | null; predictedCompletion: number | null;
  diversity: number | null; fatigueRisk: number | null; meanCompatibility: number | null; band: string; confidence: string; notes: string[];
}): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_ai_playlist_simulation', {
    p_store: input.storeId, p_playlist: input.playlistId, p_predicted_skip: input.predictedSkip,
    p_predicted_completion: input.predictedCompletion, p_diversity: input.diversity, p_fatigue_risk: input.fatigueRisk,
    p_mean_compatibility: input.meanCompatibility, p_band: input.band, p_confidence: input.confidence, p_notes: input.notes,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
