// AI-MUSIC-3 — Adaptive Learning API. Wraps the 0466 read RPCs (reinforcement signals + reputation inputs
// + persisted history/drift/adaptive timeline) and runs the rule-based aiLearning engines client-side. Read-
// only analysis + advisory snapshots. Nothing auto-applies — every result is a Recommendation requiring
// operator approval.

import { supabase } from '@/lib/supabase';
import {
  runLearningLoop, computeTrackReputation, buildEvolution,
  type ReinforcementSignals, type LearningLoopResult, type TrackReputation, type PlaylistEvolution, type PlaylistVersion,
} from '@/lib/aiLearning';

// ── Continuous learning loop (reinforcement + adaptive score) ──
export async function getLearningSignals(storeId: string, days = 14): Promise<ReinforcementSignals | null> {
  const { data, error } = await supabase.rpc('admin_ai_learning', { p_store: storeId, p_days: days });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; signals?: ReinforcementSignals };
  return res.ok ? (res.signals ?? null) : null;
}

export interface LearningLoopBundle { signals: ReinforcementSignals | null; loop: LearningLoopResult | null; }
export async function runStoreLearningLoop(storeId: string, priorScore: number | null, days = 14): Promise<LearningLoopBundle> {
  const signals = await getLearningSignals(storeId, days);
  if (!signals) return { signals: null, loop: null };
  const loop = runLearningLoop({ storeId, priorScore, signals });
  return { signals, loop };
}

// ── Track reputation (computed over real behavior scores) ──
interface ReputationRow { trackId: string; title: string | null; completionRate: number | null; skipRate: number | null; likeRate: number | null; replayRate: number | null; plays: number; priorScore: number | null; }
export async function getTrackReputations(storeType: string | null, limit = 120): Promise<TrackReputation[]> {
  const { data, error } = await supabase.rpc('admin_ai_track_reputation', { p_store_type: storeType, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; tracks?: ReputationRow[] };
  const rows = res.ok ? (res.tracks ?? []) : [];
  return rows.map((r) => computeTrackReputation(r));
}

// ── Playlist evolution (versions → V1..Vn + trend) ──
interface VersionRow { version: number; score: number | null; trackCount: number; diversity: number | null; fatigueRisk: number | null; label: string | null; }
export async function getPlaylistEvolution(storeId: string, ref: string | null): Promise<{ versions: VersionRow[]; evolution: PlaylistEvolution }> {
  const { data, error } = await supabase.rpc('admin_ai_playlist_history', { p_store: storeId, p_ref: ref, p_limit: 100 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; versions?: VersionRow[] };
  const versions = res.ok ? (res.versions ?? []) : [];
  const asVersions: PlaylistVersion[] = versions.map((v) => ({ version: v.version, score: v.score, trackCount: v.trackCount, diversity: v.diversity, fatigueRisk: v.fatigueRisk, label: v.label }));
  return { versions, evolution: buildEvolution(asVersions) };
}

// ── Persisted drift + adaptive timeline (read) ──
export interface DriftRow { id: string; storeId: string | null; playlistRef: string | null; drift: number | null; band: string | null; genreDrift: number | null; moodDrift: number | null; energyDrift: number | null; createdAt: string; }
export async function getDriftHistory(storeId: string | null, limit = 50): Promise<DriftRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_drift', { p_store: storeId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; drift?: DriftRow[] };
  return res.ok ? (res.drift ?? []) : [];
}
export interface AdaptiveRow { id: string; storeId: string | null; playlistRef: string | null; yesterday: number | null; today: number | null; next: number | null; reward: number | null; penalty: number | null; net: number | null; trend: string | null; createdAt: string; }
export async function getAdaptiveHistory(storeId: string | null, limit = 100): Promise<AdaptiveRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_adaptive_score', { p_store: storeId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; history?: AdaptiveRow[] };
  return res.ok ? (res.history ?? []) : [];
}

// ── Advisory record RPCs (snapshots — nothing applied) ──
export async function savePlaylistVersion(storeId: string, ref: string, version: number, score: number | null, trackCount: number, diversity: number | null, fatigue: number | null, label: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_playlist_version', { p_store: storeId, p_ref: ref, p_version: version, p_score: score, p_track_count: trackCount, p_diversity: diversity, p_fatigue: fatigue, p_label: label });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function saveLearningSnapshot(storeId: string, ref: string, loop: LearningLoopResult): Promise<boolean> {
  const a = loop.adaptiveScore, r = loop.reinforcement;
  const { data, error } = await supabase.rpc('record_ai_learning_snapshot', {
    p_store: storeId, p_ref: ref, p_yesterday: a.yesterday, p_today: a.today, p_next: a.next,
    p_reward: r.reward, p_penalty: r.penalty, p_net: r.net, p_trend: a.trend,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function saveTrackReputation(rep: TrackReputation, storeType: string | null, priorScore: number | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_track_reputation', { p_track: rep.trackId, p_store_type: storeType, p_score: rep.score, p_band: rep.band, p_trend: rep.trend, p_prior: priorScore });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function savePlaylistDrift(storeId: string, ref: string, drift: number | null, band: string, genre: number | null, mood: number | null, energy: number | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_playlist_drift', { p_store: storeId, p_ref: ref, p_drift: drift, p_band: band, p_genre: genre, p_mood: mood, p_energy: energy });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
