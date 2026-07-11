// AI-MUSIC-1 — Recommendation Engine. Ranks candidate tracks for a store by compatibility and produces
// RECOMMEND / EXCLUDE track lists + recommended genre/mood. RECOMMENDATION ONLY — nothing is queued,
// deployed, or played. Every result is advisory (requiresApproval / not automated).

import { REC_MAX_RESULTS, REC_EXCLUDE_COMPAT_MAX } from './thresholds';
import type { StoreProfile, Compatibility, MusicRecommendation, AiConfidenceLevel } from './types';

const APPROVAL = { requiresApproval: true, automated: false } as const;

export interface RecommendationInput {
  store: StoreProfile;
  compatibilities: Array<{ trackId: string; title: string | null; compat: Compatibility }>;
  confidence: AiConfidenceLevel;
}

/** Build advisory track/genre/mood recommendations for a store from computed compatibilities. */
export function buildMusicRecommendations(input: RecommendationInput): MusicRecommendation[] {
  const out: MusicRecommendation[] = [];
  const { store, compatibilities, confidence } = input;
  if (store.status === 'INSUFFICIENT_DATA') return out;

  const scored = compatibilities.filter((c) => c.compat.score != null);
  const ranked = [...scored].sort((a, b) => (b.compat.score as number) - (a.compat.score as number));

  // Recommend the top compatible tracks (ACCEPTABLE+).
  for (const c of ranked.slice(0, REC_MAX_RESULTS)) {
    if (c.compat.band === 'EXCELLENT' || c.compat.band === 'GOOD' || c.compat.band === 'ACCEPTABLE') {
      out.push({ id: `rec:${c.trackId}`, kind: 'RECOMMEND_TRACK', targetId: c.trackId, label: c.title ?? c.trackId, score: c.compat.score, reason: `${c.compat.band} 호환 (${c.compat.reasons.join(', ') || '규칙 매칭'})`, confidence, ...APPROVAL });
    }
  }
  // Exclude the clearly unsuitable tracks.
  for (const c of ranked) {
    if ((c.compat.score as number) <= REC_EXCLUDE_COMPAT_MAX) {
      out.push({ id: `excl:${c.trackId}`, kind: 'EXCLUDE_TRACK', targetId: c.trackId, label: c.title ?? c.trackId, score: c.compat.score, reason: `${c.compat.band} — 매장 부적합`, confidence, ...APPROVAL });
    }
  }
  // Recommend the store's strongest genre/mood preferences.
  const topGenre = store.genrePreference.find((g) => g.strength === 'STRONG' || g.strength === 'MODERATE');
  if (topGenre) out.push({ id: `genre:${topGenre.key}`, kind: 'RECOMMEND_GENRE', targetId: topGenre.key, label: topGenre.key, score: Math.round(topGenre.share * 100), reason: `선호 장르 (${(topGenre.share * 100).toFixed(0)}%)`, confidence, ...APPROVAL });
  const topMood = store.moodPreference.find((m) => m.strength === 'STRONG' || m.strength === 'MODERATE');
  if (topMood) out.push({ id: `mood:${topMood.key}`, kind: 'RECOMMEND_MOOD', targetId: topMood.key, label: topMood.key, score: Math.round(topMood.share * 100), reason: `선호 무드 (${(topMood.share * 100).toFixed(0)}%)`, confidence, ...APPROVAL });

  return out.slice(0, REC_MAX_RESULTS * 2);
}
