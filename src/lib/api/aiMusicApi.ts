// AI-MUSIC-1 — AI Music API. Wraps the 0464 read RPCs (super-admin) and composes the rule-based aiMusic
// engines client-side. Read-only analysis + advisory snapshots. Nothing auto-deploys a playlist or runs
// a policy — every result is a Recommendation or a Simulation.

import { supabase } from '@/lib/supabase';
import {
  computeStoreProfile, computeTrackProfile, computeCompatibility, analyzePlaylist, computeLearningProfile,
  musicDirectorPlan, computeAiConfidence, buildMusicRecommendations, simulatePlaylist, evaluateDiscovery,
  type StorePlayAggregate, type StoreProfile, type TrackProfile, type Compatibility, type MusicRecommendation,
  type PlaylistIntelligence, type PlaylistSimulation, type AiConfidence, type DirectorPlan, type LearningProfile,
  type DiscoveryCandidate, type TrackMeta, type TrackPerformance,
} from '@/lib/aiMusic';

export type AiWindow = '7d' | '30d';

export interface AiStoreListItem { storeId: string; plays: number; storeType: string | null; storeName: string | null; }
export async function getAiStoreList(window: AiWindow = '30d'): Promise<AiStoreListItem[]> {
  const { data, error } = await supabase.rpc('admin_ai_store_list', { p_window: window, p_limit: 100 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; stores?: AiStoreListItem[] };
  return res.ok ? (res.stores ?? []) : [];
}

interface TrackRow { meta: TrackMeta; perf: TrackPerformance; }
async function fetchTrackRows(storeType: string | null, limit = 120): Promise<TrackRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_track_profiles', { p_store_type: storeType, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; tracks?: TrackRow[] };
  return res.ok ? (res.tracks ?? []) : [];
}

export interface AiStoreIntelligence {
  window: AiWindow;
  store: StoreProfile;
  director: DirectorPlan;
  confidence: AiConfidence;
  trackProfiles: TrackProfile[];
  compatibilities: Array<{ trackId: string; title: string | null; compat: Compatibility }>;
  recommendations: MusicRecommendation[];
  playlistIntelligence: PlaylistIntelligence;
  simulation: PlaylistSimulation;
  learning: LearningProfile;
}

/** Compose the full per-store AI-music intelligence bundle (read-only, advisory/simulation only). */
export async function getAiStoreIntelligence(storeId: string, storeType: string | null, window: AiWindow = '30d'): Promise<AiStoreIntelligence | null> {
  const [aggR, tracksR] = await Promise.allSettled([
    supabase.rpc('admin_ai_store_aggregate', { p_store: storeId, p_window: window }),
    fetchTrackRows(storeType),
  ]);
  if (aggR.status !== 'fulfilled' || aggR.value.error) return null;
  const agg = ((aggR.value.data ?? {}) as { ok?: boolean; aggregate?: StorePlayAggregate }).aggregate;
  if (!agg) return null;
  const store = computeStoreProfile(agg);
  const rows = tracksR.status === 'fulfilled' ? tracksR.value : [];

  const trackProfiles = rows.map((r) => computeTrackProfile(r.meta, r.perf));
  const compatibilities = rows.map((r, i) => ({ trackId: r.meta.trackId, title: r.meta.title, compat: computeCompatibility(store, trackProfiles[i], r.perf) }));

  const confidence = computeAiConfidence({
    sampleSize: agg.plays, storeHistoryPlays: agg.plays,
    trackHistoryPlays: rows.reduce((s, r) => s + r.perf.plays, 0),
    learningCoverage: rows.length ? rows.filter((r) => r.perf.learningScore != null).length / rows.length : 0,
    signalCoverage: agg.plays > 0 ? 1 : 0,
  });
  const recommendations = buildMusicRecommendations({ store, compatibilities, confidence: confidence.level });
  const director = musicDirectorPlan(store.storeType);

  // Playlist intelligence + simulation over the top-compatible tracks (advisory sample).
  const rankedIdx = compatibilities.map((c, i) => ({ i, s: c.compat.score ?? -1 })).sort((a, b) => b.s - a.s).slice(0, 20).map((x) => x.i);
  const sampleTracks = rankedIdx.map((i) => trackProfiles[i]);
  const sampleCompat = rankedIdx.map((i) => compatibilities[i].compat);
  const playlistIntelligence = analyzePlaylist(sampleTracks);
  const simulation = simulatePlaylist({ store, tracks: sampleTracks, compatibilities: sampleCompat, confidence: confidence.level });

  const learning = computeLearningProfile(`store:${storeId}`, { skip: agg.skips, complete: agg.completes, like: agg.likes, dislike: agg.dislikes, replay: agg.replays, sessionSeconds: agg.avgSessionSeconds });

  return { window, store, director, confidence, trackProfiles, compatibilities, recommendations, playlistIntelligence, simulation, learning };
}

// ── Discovery pool (advisory — no auto-distribution) ──
export interface AiDiscoveryRow { id: string; trackId: string; title: string | null; stage: string; pilotStores: number; pilotPlays: number; note: string | null; }
export async function getAiDiscovery(): Promise<{ raw: AiDiscoveryRow[]; evaluated: DiscoveryCandidate[] }> {
  const { data, error } = await supabase.rpc('admin_ai_discovery', { p_limit: 100 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; candidates?: AiDiscoveryRow[] };
  const raw = res.ok ? (res.candidates ?? []) : [];
  const evaluated = raw.map((d) => evaluateDiscovery({
    trackId: d.trackId, title: d.title, stage: (d.stage as DiscoveryCandidate['stage']),
    pilotStores: d.pilotStores, pilotPlays: d.pilotPlays,
    pilotCompletes: Math.round(d.pilotPlays * 0.6), pilotSkips: Math.round(d.pilotPlays * 0.2), // rough placeholder until pilot stats wired
  }));
  return { raw, evaluated };
}
export async function saveDiscoveryCandidate(trackId: string, stage: string, pilotStores: number, pilotPlays: number, note: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('upsert_ai_discovery_candidate', { p_track: trackId, p_stage: stage, p_pilot_stores: pilotStores, p_pilot_plays: pilotPlays, p_note: note });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function saveRecommendation(input: { scope: string; storeId: string | null; kind: string; targetId: string; label: string; score: number | null; reason: string; confidence: string }): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_recommendation', {
    p_scope: input.scope, p_store: input.storeId, p_kind: input.kind, p_target: input.targetId, p_label: input.label, p_score: input.score, p_reason: input.reason, p_confidence: input.confidence,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
