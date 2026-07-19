/**
 * recommendIntelV2 — Contextual Recommendation Engine v2 & Shadow Comparison
 * (Phase AI-RECOMMEND-2).
 *
 * Production Recommendation v1(recommend_tracks_by_context / 개인화 / 유사곡)과
 * Playlist/Queue/Scheduler/Player 를 일절 변경하지 않는 **Shadow 다목적 추천 엔진**.
 * 결과는 Recommendation Draft(0567) + 사람 검토에서 종료하며, 서버가 Hard Gate ·
 * Rank 무결성 · 품질을 재검증한다(클라이언트 Score/Rank 미신뢰).
 *
 * 원칙: Math.random/시간 Seed/외부 LLM 금지(동일 입력+Seed → 동일 순위) ·
 * null 신호를 0점으로 간주하지 않음(존재 신호만 재정규화 + 상태 기록) ·
 * Reaction 은 표본 기반 Confidence(Production 실측 0행 — 학습 완료 주장 금지) ·
 * Exposure 원장 부재 → 30일 재생 이벤트 프록시 + insufficient_data ·
 * Popularity ≠ Reputation · Fairness 는 Eligibility→Policy→Quality→Fit 다음 순위.
 *
 * 재사용: playlistIntelCore(seededTieBreak · computeDiversityMetrics · computeQuality
 * — Playlist Compatibility Δ 시뮬레이션) · sequencingIntel(evaluateTransition —
 * Sequence Compatibility) · playlistGenerator(getProfile/computeCompatibility —
 * 업종 기본 Profile, default_profile 명시).
 */

import {
  computeDiversityMetrics, computeEnergyProfile, computeQuality, seededTieBreak,
  DEFAULT_INTEL_CONFIG,
  type PlaylistCandidateTrack,
} from './playlistIntelCore';
import {
  DEFAULT_SEQ_CONFIG, evaluateTransition,
  type SequencingTrackFeature,
} from './sequencingIntel';
import { computeCompatibility, getProfile, type PoolTrack } from './playlistGenerator';

/* ── Domain 타입 ─────────────────────────────────────────────────────── */
export type RecommendationMode =
  | 'store' | 'brand' | 'industry' | 'playlist_fill' | 'next_track' | 'similar_track' | 'manual_assist';
export type RecommendationDraftStatus =
  | 'draft' | 'ready_for_review' | 'approved' | 'rejected' | 'expired' | 'archived';
export type RecommendationSignalStatus = 'available' | 'insufficient_data' | 'not_available' | 'not_applicable';

export interface RecommendationReason {
  code: string;
  message: string;
  scoreImpact: number;
  source: string;
  signalStatus: RecommendationSignalStatus;
}

export interface RecPoolRow {
  track_id: string; title: string | null; artist: string | null; album_name: string | null;
  main_genre: string | null; sub_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null; release_date: string | null;
  explicit_content: boolean | null; instrumental: boolean | null;
  energy: number | null; vocal_presence: number | null;
  qc_score: number | null; qc_grade: string | null;
  fit_score: number | null; fit_status: string | null;
  behavior_score: number | null; completion_rate: number | null; skip_rate: number | null;
  play_count: number | null; unique_listener_count: number | null;
  like_count: number | null; dislike_count: number | null;
  like_ratio: number | null; dislike_ratio: number | null; total_reactions: number | null;
  events: number | null; last_event_at: string | null;
  in_source_playlist: boolean | null; store_excluded: boolean | null; genre_blocked: boolean | null;
}

export interface RecommendationCandidate {
  trackId: string;
  title: string | null;
  artistKey: string | null;
  albumKey: string | null;
  genre: string | null;
  moods: string[];
  bpm: number | null;
  energy: number | null;
  isInstrumental: boolean | null;
  isExplicit: boolean | null;
  releaseDate: string | null;
  events: number;
  lastEventAt: string | null;
  storeFitScore: number | null;
  storeFitSource: string;
  qualityScore: number | null;
  playlistCompatibilityScore: number | null;
  sequenceCompatibilityScore: number | null;
  reactionScore: number | null;
  reactionConfidence: number;
  reputationScore: number | null;
  noveltyScore: number | null;
  fatigueScore: number;
  exposureScore: number | null;
  fairnessScore: number | null;
  metadataCompleteness: number;
  finalScore: number;
  eligible: boolean;
  selected: boolean;
  rank: number;
  isExploration: boolean;
  signalStatuses: Record<string, RecommendationSignalStatus>;
  selectionReasons: RecommendationReason[];
  exclusionReasons: RecommendationReason[];
}

export interface RecommendationContext {
  mode: RecommendationMode;
  storeType: string | null;
  brandId: string | null;
  sourcePlaylistId: string | null;
  playlistDraftId: string | null;
  sequenceDraftId: string | null;
  currentTrackId: string | null;
  recentTrackIds: string[];
  daypart: string | null;
  targetCount: number;
  candidateLimit: number;
  seed: number;
  blockedGenres: string[];
  preferredMoods: string[];
  blockedMoods: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  energyMin: number | null;
  energyMax: number | null;
  requireInstrumental: boolean;
  blockExplicit: boolean;
  minStoreFit: number | null;
  minQc: number | null;
  maxArtistShare: number;
  maxAlbumShare: number;
  maxGenreShare: number;
  explorationRatio: number;
  fatigueThreshold: number;
  recentPlayExcludeDays: number | null;
  blockPlaylistDuplicates: boolean;
}

export const DEFAULT_REC_CONTEXT: RecommendationContext = {
  mode: 'store', storeType: null, brandId: null, sourcePlaylistId: null,
  playlistDraftId: null, sequenceDraftId: null, currentTrackId: null, recentTrackIds: [],
  daypart: null, targetCount: 20, candidateLimit: 300, seed: 1,
  blockedGenres: [], preferredMoods: [], blockedMoods: [],
  bpmMin: null, bpmMax: null, energyMin: null, energyMax: null,
  requireInstrumental: false, blockExplicit: true,
  minStoreFit: null, minQc: null,
  maxArtistShare: 0.3, maxAlbumShare: 0.3, maxGenreShare: 0.5,
  explorationRatio: 0.1, fatigueThreshold: 60, recentPlayExcludeDays: null,
  blockPlaylistDuplicates: true,
};

export const REC_ALGORITHM_VERSION = 'rec-v2';
export const FIXED_REC_WARNING =
  '이 Recommendation Draft는 실제 Playlist, Queue, Scheduler, Player 또는 Production 추천 결과에 자동 반영되지 않습니다.';
export const EXPOSURE_LEDGER_STATUS: RecommendationSignalStatus = 'not_available';
export const REACTION_MIN_SAMPLES = 3;
export const REACTION_CONFIDENCE_SAMPLES = 20;
export const MAX_EXPLORATION_RATIO = 0.2;

/** Multi-Objective 가중치(합 100) — 서버 _ai_rec_draft_quality 와 동일 상수. */
export const REC_WEIGHTS = {
  storeFit: 20, policyCompliance: 15, trackQuality: 10, playlistCompatibility: 10,
  sequenceCompatibility: 10, reactionSignal: 10, reputation: 5, novelty: 5,
  fatigueControl: 5, exposureControl: 5, artistFairness: 3, metadataCompleteness: 2,
} as const;

/** 금지 액션 — 스펙 금지 기능과 1:1. */
export const BLOCKED_REC_ACTIONS = [
  'apply_to_production_recommendation',
  'replace_recommendation_v1',
  'apply_to_playlist',
  'insert_playlist_tracks',
  'apply_to_queue',
  'apply_to_scheduler',
  'apply_to_player',
  'auto_approve',
  'auto_global_apply',
] as const;
export function isBlockedRecAction(action: string): boolean {
  return (BLOCKED_REC_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/* ── 후보 정규화 + 신호 계산 ──────────────────────────────────────────── */
export interface RecSignalInputs {
  /** Playlist Compatibility 기준(Phase 1 Draft 선택 Track) — 없으면 insufficient. */
  baselinePlaylist: PlaylistCandidateTrack[] | null;
  /** Sequence Compatibility 기준 — current/next 가 없으면 insufficient. */
  currentTrack: SequencingTrackFeature | null;
  nextTrack: SequencingTrackFeature | null;
}

function toSeqFeature(c: RecommendationCandidate): SequencingTrackFeature {
  return {
    trackId: c.trackId, title: c.title, artistKey: c.artistKey, albumKey: c.albumKey,
    genre: c.genre, moods: c.moods, bpm: c.bpm, energy: c.energy,
    vocalPresence: null, isInstrumental: c.isInstrumental, fitScore: c.storeFitScore,
    fatigueScore: c.fatigueScore, events: c.events, originalDraftOrder: 0, missing: [],
  };
}

function toPlaylistCandidate(c: RecommendationCandidate): PlaylistCandidateTrack {
  return {
    trackId: c.trackId, title: c.title, artistKey: c.artistKey, albumKey: c.albumKey,
    genre: c.genre, subgenre: null, moods: c.moods, bpm: c.bpm, energy: c.energy,
    isInstrumental: c.isInstrumental, isExplicit: c.isExplicit,
    fitScore: c.storeFitScore, fitStatus: null, qcScore: c.qualityScore,
    releaseDate: c.releaseDate, events: c.events, lastEventAt: c.lastEventAt,
    storeExcluded: false, genreBlocked: false, missing: [],
    selected: true, selectionScore: 0, exclusionReasons: [], selectionReasons: [],
  };
}

export function normalizeRecCandidate(row: RecPoolRow, ctx: RecommendationContext, nowMs: number): RecommendationCandidate {
  const statuses: Record<string, RecommendationSignalStatus> = {};
  const events = isNum(row.events) ? row.events : 0;

  // Store Fit: 실측 fit 우선, 없으면 업종 기본 Profile(default_profile 명시).
  let storeFit: number | null = isNum(row.fit_score) ? row.fit_score : null;
  let storeFitSource = 'playlist_track_fit_scores';
  if (storeFit == null && ctx.storeType) {
    const profile = getProfile(ctx.storeType);
    if (profile) {
      const asPool: PoolTrack = {
        track_id: row.track_id, title: row.title, artist: row.artist,
        main_genre: row.main_genre, mood: row.mood, bpm: row.bpm, duration: row.duration, language: null,
        events, skip_rate: row.skip_rate, completion_rate: row.completion_rate,
        likes: row.like_count ?? 0, replays: 0, last_event_at: row.last_event_at,
        store_coverage: null, rollout_stage: null,
      };
      storeFit = computeCompatibility(asPool, profile).score;
      storeFitSource = 'default_profile(INDUSTRY_PROFILES)';
    }
  }
  statuses.storeFit = storeFit == null ? 'insufficient_data' : 'available';

  statuses.trackQuality = isNum(row.qc_score) ? 'available' : 'insufficient_data';

  // Reaction: percent ratio(0..100, 0345 실측) + 표본 Confidence. 없으면 중립값을 만들지 않는다.
  const totalReactions = isNum(row.total_reactions) ? row.total_reactions : 0;
  const reactionConfidence = Math.min(1, totalReactions / REACTION_CONFIDENCE_SAMPLES);
  let reactionScore: number | null = null;
  if (totalReactions >= REACTION_MIN_SAMPLES && isNum(row.like_ratio) && isNum(row.dislike_ratio)) {
    const raw = clamp100(50 + (row.like_ratio - row.dislike_ratio) / 2);
    reactionScore = round1(50 + (raw - 50) * reactionConfidence);
    statuses.reactionSignal = 'available';
  } else {
    statuses.reactionSignal = 'insufficient_data';
  }

  // Reputation(≠Popularity): behavior_score + 표본 Confidence.
  let reputationScore: number | null = null;
  if (isNum(row.behavior_score)) {
    const conf = Math.min(1, (row.unique_listener_count ?? 0) / 10);
    reputationScore = round1(50 + (clamp100(row.behavior_score) - 50) * Math.max(0.3, conf));
    statuses.reputation = conf < 0.3 ? 'insufficient_data' : 'available';
  } else {
    statuses.reputation = 'insufficient_data';
  }

  // Novelty: Release Age(90일 창) + 저노출.
  let noveltyScore: number | null = null;
  if (row.release_date) {
    const age = (nowMs - Date.parse(row.release_date)) / 86400e3;
    if (Number.isFinite(age)) {
      const ageScore = age <= 90 ? (1 - age / 90) * 70 : 0;
      const lowExposure = events < 10 ? 30 : events < 40 ? 15 : 0;
      noveltyScore = round1(clamp100(ageScore + lowExposure));
      statuses.novelty = 'available';
    }
  }
  if (noveltyScore == null) statuses.novelty = 'insufficient_data';

  const fatigue = Math.min(100, (events / 80) * 100);
  // Exposure: 추천 노출 원장 부재(not_available) — 30일 재생 이벤트 프록시.
  statuses.exposureControl = 'insufficient_data';
  const exposureScore = round1(clamp100(100 - fatigue));

  const coreSignals = [row.main_genre, row.mood, row.energy, row.bpm, row.qc_score, storeFit];
  const metadataCompleteness = round1((coreSignals.filter((s) => s != null && s !== '').length / coreSignals.length) * 100);

  return {
    trackId: row.track_id, title: row.title,
    artistKey: norm(row.artist) || null, albumKey: norm(row.album_name) || null,
    genre: row.main_genre, moods: row.mood ? [row.mood.trim()] : [],
    bpm: isNum(row.bpm) ? row.bpm : null, energy: isNum(row.energy) ? row.energy : null,
    isInstrumental: typeof row.instrumental === 'boolean' ? row.instrumental : null,
    isExplicit: typeof row.explicit_content === 'boolean' ? row.explicit_content : null,
    releaseDate: row.release_date, events, lastEventAt: row.last_event_at,
    storeFitScore: storeFit, storeFitSource,
    qualityScore: isNum(row.qc_score) ? row.qc_score : null,
    playlistCompatibilityScore: null, sequenceCompatibilityScore: null,
    reactionScore, reactionConfidence: round1(reactionConfidence * 100) / 100,
    reputationScore, noveltyScore, fatigueScore: round1(fatigue),
    exposureScore, fairnessScore: null, metadataCompleteness,
    finalScore: 0, eligible: true, selected: false, rank: -1, isExploration: false,
    signalStatuses: statuses, selectionReasons: [], exclusionReasons: [],
  };
}

/* ── Hard Eligibility Gate — 부족을 이유로 완화하지 않는다 ───────────────── */
export function evaluateRecEligibility(row: RecPoolRow, ctx: RecommendationContext, nowMs: number): RecommendationReason[] {
  const out: RecommendationReason[] = [];
  const add = (code: string, message: string, source: string) =>
    out.push({ code, message, scoreImpact: -100, source, signalStatus: 'available' });
  if (row.store_excluded) add('store_exclusion', '매장 제외 목록', 'track_store_exclusions');
  if (row.genre_blocked) add('blocked_genre', '업종 차단 장르', 'genre_block_rules');
  if (ctx.blockedGenres.some((g) => norm(g) && norm(row.main_genre).includes(norm(g)))) {
    add('blocked_genre', `차단 장르(${row.main_genre ?? '?'})`, 'context.blockedGenres');
  }
  if (ctx.blockExplicit && row.explicit_content === true) add('explicit_blocked', 'Explicit 금지 위반', 'tracks.explicit_content');
  if (ctx.requireInstrumental && row.instrumental === false) add('instrumental_required', 'Instrumental 필수 위반', 'tracks.instrumental');
  // 값 없음(null)은 Hard Exclude 가 아니라 insufficient_data — 실제 미달만 제외.
  if (ctx.minQc != null && isNum(row.qc_score) && row.qc_score < ctx.minQc) {
    add('qc_below_min', `QC ${row.qc_score} < ${ctx.minQc}`, 'audio_qc_reports');
  }
  if (row.fit_status === 'excluded') add('store_fit_excluded', 'Store Fit excluded', 'playlist_track_fit_scores');
  if (ctx.currentTrackId && row.track_id === ctx.currentTrackId) add('current_track', '현재 재생 곡과 동일', 'context');
  if (ctx.recentTrackIds.includes(row.track_id)) add('recent_track', '최근 재생 목록 포함', 'context.recentTrackIds');
  if (ctx.blockPlaylistDuplicates && row.in_source_playlist === true) {
    add('playlist_duplicate', '대상 Playlist 에 이미 포함', 'playlist_tracks');
  }
  if (ctx.recentPlayExcludeDays != null && row.last_event_at) {
    const days = (nowMs - Date.parse(row.last_event_at)) / 86400e3;
    if (Number.isFinite(days) && days <= ctx.recentPlayExcludeDays) {
      add('recent_play_window', `${ctx.recentPlayExcludeDays}일 내 재생`, 'playback_events_v2');
    }
  }
  return out;
}

/* ── Compatibility 신호(Phase 1/2 재사용) ─────────────────────────────── */
export function computePlaylistCompatibility(
  c: RecommendationCandidate, baseline: PlaylistCandidateTrack[] | null, nowMs: number,
): { score: number | null; status: RecommendationSignalStatus; delta: number | null } {
  if (!baseline || baseline.length === 0) return { score: null, status: 'insufficient_data', delta: null };
  const cfg = { ...DEFAULT_INTEL_CONFIG };
  const iso = new Date(nowMs).toISOString();
  const q0 = computeQuality(baseline, 0, computeDiversityMetrics(baseline, nowMs), computeEnergyProfile(baseline, cfg), cfg, iso);
  const projected = [...baseline, toPlaylistCandidate(c)];
  const q1 = computeQuality(projected, 0, computeDiversityMetrics(projected, nowMs), computeEnergyProfile(projected, cfg), cfg, iso);
  if (q0.score == null || q1.score == null) return { score: null, status: 'insufficient_data', delta: null };
  const delta = round1(q1.score - q0.score);
  return { score: round1(clamp100(50 + delta * 5)), status: 'available', delta };
}

export function computeSequenceCompatibility(
  c: RecommendationCandidate, current: SequencingTrackFeature | null, next: SequencingTrackFeature | null,
): { score: number | null; status: RecommendationSignalStatus; energyDelta: number | null; bpmDelta: number | null } {
  if (!current) return { score: null, status: 'insufficient_data', energyDelta: null, bpmDelta: null };
  const cand = toSeqFeature(c);
  const inbound = evaluateTransition(current, cand, DEFAULT_SEQ_CONFIG);
  if (!next) {
    return { score: inbound.transitionScore, status: 'available', energyDelta: inbound.energyDelta, bpmDelta: inbound.bpmDelta };
  }
  const outbound = evaluateTransition(cand, next, DEFAULT_SEQ_CONFIG);
  return {
    score: round1((inbound.transitionScore + outbound.transitionScore) / 2),
    status: 'available', energyDelta: inbound.energyDelta, bpmDelta: inbound.bpmDelta,
  };
}

/* ── Contextual Fit(정책 기반 Soft 감점) ─────────────────────────────── */
export function contextualPenalties(c: RecommendationCandidate, ctx: RecommendationContext): RecommendationReason[] {
  const out: RecommendationReason[] = [];
  const soft = (code: string, message: string, impact: number, source: string) =>
    out.push({ code, message, scoreImpact: impact, source, signalStatus: 'available' });
  if (ctx.minStoreFit != null && c.storeFitScore != null && c.storeFitScore < ctx.minStoreFit) {
    soft('below_min_store_fit', `fit ${c.storeFitScore} < ${ctx.minStoreFit}`, -15, c.storeFitSource);
  }
  if (ctx.bpmMin != null && c.bpm != null && c.bpm < ctx.bpmMin) soft('bpm_low', `BPM ${c.bpm} < ${ctx.bpmMin}`, -8, 'context');
  if (ctx.bpmMax != null && c.bpm != null && c.bpm > ctx.bpmMax) soft('bpm_high', `BPM ${c.bpm} > ${ctx.bpmMax}`, -8, 'context');
  if (ctx.energyMin != null && c.energy != null && c.energy < ctx.energyMin) soft('energy_low', `E ${c.energy} < ${ctx.energyMin}`, -8, 'context');
  if (ctx.energyMax != null && c.energy != null && c.energy > ctx.energyMax) soft('energy_high', `E ${c.energy} > ${ctx.energyMax}`, -8, 'context');
  if (ctx.blockedMoods.length && c.moods.some((m) => ctx.blockedMoods.includes(m))) soft('blocked_mood', `기피 무드`, -10, 'context');
  if (ctx.preferredMoods.length && c.moods.some((m) => ctx.preferredMoods.includes(m))) soft('preferred_mood', '선호 무드 일치', 8, 'context');
  if (c.fatigueScore >= ctx.fatigueThreshold) soft('fatigue_high', `피로도 ${c.fatigueScore}`, -10, 'playback_events_v2(proxy)');
  return out;
}

/* ── Multi-Objective Score — 존재 신호만 재정규화 ─────────────────────── */
export function computeFinalScore(c: RecommendationCandidate, penalties: RecommendationReason[]): {
  score: number; parts: RecommendationReason[];
} {
  const parts: Array<{ key: keyof typeof REC_WEIGHTS; v: number | null }> = [
    { key: 'storeFit', v: c.storeFitScore },
    { key: 'policyCompliance', v: 100 }, // Hard Gate 통과 후보만 평가 — 정책 위반은 이미 제외됨.
    { key: 'trackQuality', v: c.qualityScore },
    { key: 'playlistCompatibility', v: c.playlistCompatibilityScore },
    { key: 'sequenceCompatibility', v: c.sequenceCompatibilityScore },
    { key: 'reactionSignal', v: c.reactionScore },
    { key: 'reputation', v: c.reputationScore },
    { key: 'novelty', v: c.noveltyScore },
    { key: 'fatigueControl', v: clamp100(100 - c.fatigueScore) },
    { key: 'exposureControl', v: c.exposureScore },
    { key: 'artistFairness', v: c.fairnessScore },
    { key: 'metadataCompleteness', v: c.metadataCompleteness },
  ];
  const present = parts.filter((p) => p.v != null);
  const wsum = present.reduce((s, p) => s + REC_WEIGHTS[p.key], 0);
  const base = wsum > 0 ? present.reduce((s, p) => s + (p.v as number) * REC_WEIGHTS[p.key], 0) / wsum : 0;
  const penaltySum = penalties.reduce((s, p) => s + p.scoreImpact, 0);
  const reasons: RecommendationReason[] = present.map((p) => ({
    code: p.key, message: `${p.key} ${round1(p.v as number)}`,
    scoreImpact: round1((p.v as number) * (REC_WEIGHTS[p.key] / Math.max(1, wsum))),
    source: 'multi_objective', signalStatus: 'available',
  }));
  return { score: clamp100(round1(base + penaltySum)), parts: [...reasons, ...penalties] };
}

/* ── Deterministic Ranking(+Exposure/Fairness/Exploration) ─────────────── */
export interface RecRankingResult {
  candidates: RecommendationCandidate[];
  selected: RecommendationCandidate[];
  eligibleCount: number;
  explorationCount: number;
  warnings: string[];
}

export function rankRecommendations(
  rows: RecPoolRow[], ctx: RecommendationContext, inputs: RecSignalInputs, nowMs: number,
): RecRankingResult {
  const warnings: string[] = [];
  const target = Math.max(1, Math.min(ctx.targetCount, 100));
  const candidates = rows.map((row) => {
    const c = normalizeRecCandidate(row, ctx, nowMs);
    const hard = evaluateRecEligibility(row, ctx, nowMs);
    if (hard.length > 0) { c.eligible = false; c.exclusionReasons = hard; return c; }
    const pc = computePlaylistCompatibility(c, inputs.baselinePlaylist, nowMs);
    c.playlistCompatibilityScore = pc.score;
    c.signalStatuses.playlistCompatibility = pc.status;
    const sc = computeSequenceCompatibility(c, inputs.currentTrack, inputs.nextTrack);
    c.sequenceCompatibilityScore = sc.score;
    c.signalStatuses.sequenceCompatibility = sc.status;
    return c;
  });

  const eligible = candidates.filter((c) => c.eligible);
  // Fairness 사전 신호: Artist 별 후보 점유율(과대 Artist 감점) — 임의 ID 생성 없음.
  const artistCount = new Map<string, number>();
  for (const c of eligible) if (c.artistKey) artistCount.set(c.artistKey, (artistCount.get(c.artistKey) ?? 0) + 1);
  for (const c of eligible) {
    c.fairnessScore = c.artistKey == null ? null
      : round1(clamp100(100 - Math.max(0, (artistCount.get(c.artistKey) ?? 0) / Math.max(1, eligible.length) - 0.1) * 300));
    if (c.fairnessScore == null) c.signalStatuses.artistFairness = 'insufficient_data';
    const penalties = contextualPenalties(c, ctx);
    const { score, parts } = computeFinalScore(c, penalties);
    c.finalScore = score;
    c.selectionReasons = parts.slice(0, 12);
  }

  const sorted = [...eligible].sort((a, b) =>
    b.finalScore - a.finalScore
    || seededTieBreak(a.trackId, ctx.seed) - seededTieBreak(b.trackId, ctx.seed)
    || (a.trackId < b.trackId ? -1 : 1));

  // Exploration Slot: 상한 내 저노출·신곡 후보(Hard Gate 통과 필수).
  const ratio = Math.max(0, Math.min(ctx.explorationRatio, MAX_EXPLORATION_RATIO));
  const explorationSlots = Math.floor(target * ratio);
  const explorationPool = sorted.filter((c) => c.events < 10 && (c.noveltyScore ?? 0) >= 30);

  const selected: RecommendationCandidate[] = [];
  const aCount = new Map<string, number>();
  const alCount = new Map<string, number>();
  const gCount = new Map<string, number>();
  const capOk = (c: RecommendationCandidate): string | null => {
    if (c.artistKey && (aCount.get(c.artistKey) ?? 0) + 1 > Math.max(1, Math.ceil(target * ctx.maxArtistShare))) return 'artist_share_cap';
    if (c.albumKey && (alCount.get(c.albumKey) ?? 0) + 1 > Math.max(1, Math.ceil(target * ctx.maxAlbumShare))) return 'album_share_cap';
    const g = norm(c.genre);
    if (g && (gCount.get(g) ?? 0) + 1 > Math.max(1, Math.ceil(target * ctx.maxGenreShare))) return 'genre_share_cap';
    return null;
  };
  const commit = (c: RecommendationCandidate, exploration: boolean) => {
    c.selected = true; c.isExploration = exploration; c.rank = selected.length;
    if (exploration) c.selectionReasons = [...c.selectionReasons, {
      code: 'exploration_slot', message: '저노출/신곡 Exploration 후보', scoreImpact: 0,
      source: 'exploration', signalStatus: 'available',
    }];
    selected.push(c);
    if (c.artistKey) aCount.set(c.artistKey, (aCount.get(c.artistKey) ?? 0) + 1);
    if (c.albumKey) alCount.set(c.albumKey, (alCount.get(c.albumKey) ?? 0) + 1);
    const g = norm(c.genre);
    if (g) gCount.set(g, (gCount.get(g) ?? 0) + 1);
  };

  // 1) Stable 후보로 (target − explorationSlots) 채움.
  for (const c of sorted) {
    if (selected.length >= target - explorationSlots) break;
    const cap = capOk(c);
    if (cap) { c.exclusionReasons = [{ code: cap, message: `${cap} 상한`, scoreImpact: -100, source: 'exposure_fairness', signalStatus: 'available' }]; continue; }
    commit(c, false);
  }
  // 2) Exploration Slot 채움(점수순, Hard Gate 이미 통과).
  for (const c of explorationPool) {
    if (selected.length >= target) break;
    if (c.selected) continue;
    if (capOk(c)) continue;
    commit(c, true);
  }
  // 3) 잔여는 일반 후보로 보충.
  for (const c of sorted) {
    if (selected.length >= target) break;
    if (c.selected) continue;
    if (capOk(c)) continue;
    commit(c, false);
  }

  if (selected.length < target) warnings.push(`후보 부족 — 목표 ${target} 대비 ${selected.length}곡만 선정.`);
  const explorationCount = selected.filter((c) => c.isExploration).length;
  return { candidates, selected, eligibleCount: eligible.length, explorationCount, warnings };
}

/* ── Recommendation Quality ─────────────────────────────────────────── */
export interface RecommendationScoreBreakdown {
  eligibility: number;
  storeFit: number | null;
  policyCompliance: number;
  trackQuality: number | null;
  playlistCompatibility: number | null;
  sequenceCompatibility: number | null;
  reactionSignal: number | null;
  reputation: number | null;
  novelty: number | null;
  fatigueControl: number | null;
  exposureControl: number | null;
  artistFairness: number | null;
  metadataCompleteness: number | null;
  overallScore: number | null;
}

export interface RecommendationQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data';
  breakdown: RecommendationScoreBreakdown;
  candidateCount: number;
  eligibleCount: number;
  selectedCount: number;
  hardViolations: string[];
  warnings: string[];
  insufficientData: string[];
  generatedAt: string;
  algorithmVersion: string;
}

const MISSING_RATIO_LIMIT = 0.4;

export function computeRecommendationQuality(
  result: RecRankingResult, generatedAt: string, hardViolations: string[] = [],
): RecommendationQualityResult {
  const sel = result.selected;
  const n = sel.length;
  const warnings = [...result.warnings];
  const insufficient: string[] = ['exposure_ledger_not_available'];
  const avgOf = (f: (c: RecommendationCandidate) => number | null): number | null => {
    const vs = sel.map(f).filter(isNum);
    return vs.length ? round1(vs.reduce((s, v) => s + v, 0) / vs.length) : null;
  };
  const missingCount = sel.filter((c) => c.storeFitScore == null).length + sel.filter((c) => c.qualityScore == null).length;
  const missingRatio = n === 0 ? 1 : missingCount / (2 * n);

  const artists = new Map<string, number>();
  for (const c of sel) if (c.artistKey) artists.set(c.artistKey, (artists.get(c.artistKey) ?? 0) + 1);
  const maxArtistShare = n && artists.size ? Math.max(...artists.values()) / n : null;
  const fairness = maxArtistShare == null ? null
    : round1(Math.min(100, (artists.size / n) * 70 + Math.max(0, 1 - maxArtistShare / 0.3) * 30));

  const breakdown: RecommendationScoreBreakdown = {
    eligibility: hardViolations.length ? 0 : 100,
    storeFit: avgOf((c) => c.storeFitScore),
    policyCompliance: hardViolations.length ? 0 : 100,
    trackQuality: avgOf((c) => c.qualityScore),
    playlistCompatibility: avgOf((c) => c.playlistCompatibilityScore),
    sequenceCompatibility: avgOf((c) => c.sequenceCompatibilityScore),
    reactionSignal: avgOf((c) => c.reactionScore),
    reputation: avgOf((c) => c.reputationScore),
    novelty: avgOf((c) => c.noveltyScore),
    fatigueControl: n ? round1(clamp100(100 - (sel.reduce((s, c) => s + c.fatigueScore, 0) / n))) : null,
    exposureControl: avgOf((c) => c.exposureScore),
    artistFairness: fairness,
    metadataCompleteness: avgOf((c) => c.metadataCompleteness),
    overallScore: null,
  };
  if (breakdown.reactionSignal == null) insufficient.push('reaction_insufficient');
  if (breakdown.playlistCompatibility == null) insufficient.push('playlist_compatibility_missing');
  if (breakdown.sequenceCompatibility == null) insufficient.push('sequence_compatibility_missing');

  let score: number | null = null;
  let grade: RecommendationQualityResult['grade'] = 'insufficient_data';
  if (hardViolations.length) {
    score = 0; grade = 'D';
  } else if (n > 0 && missingRatio <= MISSING_RATIO_LIMIT) {
    const parts: Array<{ v: number | null; w: number }> = [
      { v: breakdown.storeFit, w: REC_WEIGHTS.storeFit },
      { v: breakdown.policyCompliance, w: REC_WEIGHTS.policyCompliance },
      { v: breakdown.trackQuality, w: REC_WEIGHTS.trackQuality },
      { v: breakdown.playlistCompatibility, w: REC_WEIGHTS.playlistCompatibility },
      { v: breakdown.sequenceCompatibility, w: REC_WEIGHTS.sequenceCompatibility },
      { v: breakdown.reactionSignal, w: REC_WEIGHTS.reactionSignal },
      { v: breakdown.reputation, w: REC_WEIGHTS.reputation },
      { v: breakdown.novelty, w: REC_WEIGHTS.novelty },
      { v: breakdown.fatigueControl, w: REC_WEIGHTS.fatigueControl },
      { v: breakdown.exposureControl, w: REC_WEIGHTS.exposureControl },
      { v: breakdown.artistFairness, w: REC_WEIGHTS.artistFairness },
      { v: breakdown.metadataCompleteness, w: REC_WEIGHTS.metadataCompleteness },
    ].filter((p) => p.v != null);
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    score = wsum > 0 ? round1(parts.reduce((s, p) => s + (p.v as number) * p.w, 0) / wsum) : null;
    grade = score == null ? 'insufficient_data' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  } else if (n > 0) {
    warnings.push(`핵심 신호 결측률 ${Math.round(missingRatio * 100)}% > 40% — 점수를 산출하지 않음`);
  }
  breakdown.overallScore = score;

  return {
    score, grade, breakdown,
    candidateCount: result.candidates.length, eligibleCount: result.eligibleCount, selectedCount: n,
    hardViolations, warnings, insufficientData: [...new Set(insufficient)],
    generatedAt, algorithmVersion: REC_ALGORITHM_VERSION,
  };
}

/* ── v1 비교(순수 계산 — 서버 RPC 가 별도로 공식 기록) ────────────────────── */
export interface V1ComparisonMetrics {
  topNOverlap: number;
  overlapRatio: number | null;
  rankCorrelation: number | null;
  v1Only: string[];
  v2Only: string[];
}

export function compareWithV1(v2Ranked: string[], v1Ranked: string[]): V1ComparisonMetrics {
  const v1Set = new Set(v1Ranked);
  const v2Set = new Set(v2Ranked);
  const common = v2Ranked.filter((id) => v1Set.has(id));
  const v1Pos = new Map(v1Ranked.map((id, i) => [id, i]));
  const v2Pos = new Map(v2Ranked.map((id, i) => [id, i]));
  let corr: number | null = null;
  if (common.length >= 2) {
    // Spearman(공통 Track 순위 상관).
    const n = common.length;
    const d2 = common.reduce((s, id) => {
      const d = (v1Pos.get(id) ?? 0) - (v2Pos.get(id) ?? 0);
      return s + d * d;
    }, 0);
    corr = round1((1 - (6 * d2) / (n * (n * n - 1))) * 100) / 100;
  }
  return {
    topNOverlap: common.length,
    overlapRatio: v2Ranked.length ? round1((common.length / v2Ranked.length) * 100) / 100 : null,
    rankCorrelation: corr,
    v1Only: v1Ranked.filter((id) => !v2Set.has(id)),
    v2Only: v2Ranked.filter((id) => !v1Set.has(id)),
  };
}

/* ── Explainability(템플릿 결정론 — LLM 미사용) ───────────────────────── */
export function buildRecExplanation(
  ctx: RecommendationContext, result: RecRankingResult, quality: RecommendationQualityResult,
): string[] {
  const lines: string[] = [];
  lines.push(`${ctx.storeType ?? ctx.mode} Context 에서 후보 ${result.candidates.length}곡 중 Eligibility ${result.eligibleCount}곡을 평가해 ${result.selected.length}곡을 추천했습니다.`);
  const exclCodes = new Map<string, number>();
  for (const c of result.candidates) if (!c.eligible) for (const r of c.exclusionReasons) exclCodes.set(r.code, (exclCodes.get(r.code) ?? 0) + 1);
  const top = [...exclCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push(`주요 Hard 제외: ${top.map(([c, n]) => `${c} ${n}곡`).join(', ')}.`);
  if (quality.breakdown.storeFit != null) lines.push(`Store Fit 평균 ${quality.breakdown.storeFit} · Track Quality 평균 ${quality.breakdown.trackQuality ?? '—'}.`);
  lines.push(result.explorationCount > 0
    ? `Exploration Slot ${result.explorationCount}곡(비율 상한 ${Math.round(Math.min(ctx.explorationRatio, MAX_EXPLORATION_RATIO) * 100)}%)을 저노출/신곡에 배정했습니다.`
    : 'Exploration Slot 에 배정된 곡이 없습니다.');
  lines.push(quality.breakdown.reactionSignal == null
    ? 'Reaction 데이터가 부족해(표본 3건 미만) 반응 신호를 점수에 반영하지 않았습니다 — 학습 완료를 주장하지 않습니다.'
    : `Reaction 신호는 표본 Confidence 를 적용해 반영했습니다.`);
  lines.push('추천 노출(Exposure) 원장이 없어 30일 재생 이벤트를 프록시로만 사용했습니다(insufficient_data).');
  if (quality.breakdown.playlistCompatibility == null) lines.push('Playlist 기준이 없어 Playlist Compatibility 는 insufficient_data 입니다.');
  if (quality.breakdown.sequenceCompatibility == null) lines.push('Current/Next Track 정보가 없어 Sequence Compatibility 는 insufficient_data 입니다.');
  lines.push(quality.score != null
    ? `Recommendation Quality ${quality.score} (${quality.grade}) — 가중치: Fit20·정책15·품질10·Playlist10·Sequence10·Reaction10·평판5·신규5·피로5·노출5·공정3·메타2.`
    : 'Recommendation Quality 는 데이터 부족으로 산출하지 않았습니다(insufficient_data).');
  lines.push(FIXED_REC_WARNING);
  return lines;
}

/** Track 별 결정론 설명. */
export function buildTrackExplanation(c: RecommendationCandidate): string[] {
  const lines: string[] = [];
  if (c.storeFitScore != null) lines.push(`Store Fit ${c.storeFitScore}점(${c.storeFitSource}).`);
  if (c.sequenceCompatibilityScore != null) lines.push(`Sequence 적합 ${c.sequenceCompatibilityScore}점.`);
  if (c.playlistCompatibilityScore != null) lines.push(`Playlist 개선 기여 ${c.playlistCompatibilityScore}점.`);
  if (c.isExploration) lines.push('최근 노출이 낮아 Exploration 후보로 선정되었습니다.');
  if (c.signalStatuses.reactionSignal === 'insufficient_data') lines.push('Reaction 데이터가 부족해 신뢰도를 낮게 적용했습니다.');
  else if (c.reactionScore != null) lines.push(`Reaction ${c.reactionScore}점(Confidence ${c.reactionConfidence}).`);
  return lines;
}

/* ── 저장 payload(서버가 Hard Gate/Rank/품질 재검증) ────────────────────── */
export function buildRecPayload(
  name: string, ctx: RecommendationContext, result: RecRankingResult,
  explanation: string[], quality: RecommendationQualityResult,
): Record<string, unknown> {
  const cap = (r: RecommendationReason[]) => r.slice(0, 10);
  const excludedSample = result.candidates.filter((c) => !c.selected).slice(0, Math.max(0, 300 - result.selected.length));
  const toTrack = (c: RecommendationCandidate, rank: number) => ({
    track_id: c.trackId, rank, selected: c.selected, eligible: c.eligible,
    final_score: c.finalScore,
    score_breakdown: {
      storeFit: c.storeFitScore, trackQuality: c.qualityScore,
      playlistCompatibility: c.playlistCompatibilityScore, sequenceCompatibility: c.sequenceCompatibilityScore,
      reactionSignal: c.reactionScore, reputation: c.reputationScore, novelty: c.noveltyScore,
      fatigue: c.fatigueScore, exposure: c.exposureScore, fairness: c.fairnessScore,
      metadataCompleteness: c.metadataCompleteness, signalStatuses: c.signalStatuses,
    },
    selection_reasons: cap(c.selectionReasons), exclusion_reasons: cap(c.exclusionReasons),
    feature_snapshot: {
      fit_score: c.storeFitScore, qc_score: c.qualityScore, energy: c.energy, bpm: c.bpm,
      genre: c.genre, mood: c.moods[0] ?? null, events: c.events,
      total_reactions: Math.round(c.reactionConfidence * REACTION_CONFIDENCE_SAMPLES),
      behavior_score: c.reputationScore, exploration: c.isExploration,
    },
  });
  return {
    name,
    recommendation_mode: ctx.mode,
    store_type: ctx.storeType,
    brand_id: ctx.brandId,
    source_playlist_id: ctx.sourcePlaylistId,
    playlist_draft_id: ctx.playlistDraftId,
    sequence_draft_id: ctx.sequenceDraftId,
    current_track_id: ctx.currentTrackId,
    target_track_count: Math.max(1, Math.min(ctx.targetCount, 100)),
    candidate_count: result.candidates.length,
    eligible_count: result.eligibleCount,
    seed: ctx.seed,
    algorithm_version: REC_ALGORITHM_VERSION,
    input_snapshot: {
      mode: ctx.mode, store_type: ctx.storeType, daypart: ctx.daypart, seed: ctx.seed,
      target: ctx.targetCount, candidate_limit: ctx.candidateLimit,
      business_type: ctx.storeType, time_slot: null, situation: null, mood: ctx.preferredMoods[0] ?? null,
      exploration_ratio: Math.min(ctx.explorationRatio, MAX_EXPLORATION_RATIO),
    },
    weight_snapshot: REC_WEIGHTS,
    constraint_snapshot: {
      block_explicit: ctx.blockExplicit, require_instrumental: ctx.requireInstrumental,
      min_qc: ctx.minQc, min_store_fit: ctx.minStoreFit,
      blocked_genres: ctx.blockedGenres, blocked_moods: ctx.blockedMoods,
      max_artist_share: ctx.maxArtistShare, max_album_share: ctx.maxAlbumShare, max_genre_share: ctx.maxGenreShare,
      recent_play_exclude_days: ctx.recentPlayExcludeDays, block_playlist_duplicates: ctx.blockPlaylistDuplicates,
      fatigue_threshold: ctx.fatigueThreshold,
    },
    explanation,
    warnings: quality.warnings,
    insufficient_data: quality.insufficientData,
    tracks: [
      ...result.selected.map((c, i) => toTrack(c, i)),
      ...excludedSample.map((c, i) => toTrack(c, result.selected.length + i)),
    ],
  };
}
