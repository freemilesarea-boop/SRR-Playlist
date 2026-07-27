/**
 * aiLearningEngine.ts — Phase AI-LEARNING-ENGINE-1
 *
 * PURE runtime-feedback learning logic (no network, no DOM, fully unit-testable).
 * DB 계약(supabase/migrations/0465_ai_learning_engine.sql)의 클라이언트 미러다.
 *
 *   Store Player → Playback Feedback → Reaction Score → Adaptive Score
 *   → (batch) Materialize → Queue Re-rank
 *
 * 설계 원칙 (DB 와 1:1):
 *   • Reaction score(0..100): 완곡률/스킵률/next률 + 선택적 like/dislike 보정.
 *   • Adaptive score = fit + clamp(±ADJUST, (reaction−50)·WEIGHT), 0..100 clamp.
 *   • Minimum sample gate: sample < MIN_SAMPLE 이면 학습 미적용 → adaptive = fit.
 *   • 새 Score Formula 아님. fit_score 는 그대로. 매장 반응으로 adaptive 만 별도 산출.
 *   • 여기엔 network / persistence / DOM 없음 — service/hook 레이어 담당.
 *
 * 주의: 이 모듈은 표시·프리뷰 계산용 미러다. Runtime 정렬의 SSOT 는 DB
 *   (_ai_adaptive_score / _ai_store_reaction_score / track_adaptive_scores) 이며,
 *   두 구현은 동일 상수·동일 반올림 규칙을 공유한다(테스트로 고정).
 */

// =============================================================================
// Constants — MUST match 0465 (_ai_adaptive_score / _ai_store_reaction_score)
// =============================================================================

/** 학습 적용 최소 표본. 미만이면 adaptive = fit (학습 미적용). */
export const MIN_SAMPLE = 20;
/** reaction 편차(reaction−50)에 곱하는 가중치. */
export const ADAPTIVE_WEIGHT = 0.4;
/** adaptive 조정폭 clamp(±). */
export const ADAPTIVE_ADJUST_CLAMP = 20;
/** 표본 없을 때의 중립 reaction score. */
export const NEUTRAL_REACTION_SCORE = 50;

/** 수집되는 재생 피드백 이벤트. DB check 제약과 1:1. */
export type PlaybackFeedbackEvent =
  | 'play'
  | 'complete'
  | 'skip'
  | 'next'
  | 'previous'
  | 'pause'
  | 'resume';

export const PLAYBACK_FEEDBACK_EVENTS: readonly PlaybackFeedbackEvent[] = [
  'play',
  'complete',
  'skip',
  'next',
  'previous',
  'pause',
  'resume',
] as const;

/** 학습 상태. sample gate 기준. */
export type LearningStatus = 'collecting' | 'active';

// =============================================================================
// Types — mirror the RPC JSON payloads (0465)
// =============================================================================

/** _ai_store_reaction_score 결과. */
export interface ReactionScoreResult {
  reaction_score: number;
  sample_count: number;
  skip_rate: number;
  completion_rate: number;
}

/** admin_ai_learning_dashboard 의 tracks[] 행. */
export interface LearningDashboardTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  order_index: number | null;
  fit_score: number;
  reaction_score: number;
  adaptive_score_live: number;
  adaptive_score_applied: number | null;
  difference: number;
  skip_rate: number;
  completion_rate: number;
  sample_count: number;
  learning_status: LearningStatus;
  applied_status: LearningStatus | 'none';
  applied_at: string | null;
}

export interface LearningDashboardResult {
  store_id: string;
  playlist_id: string;
  tracks: LearningDashboardTrack[];
  computed_at: string;
}

/** admin_ai_recompute_adaptive_scores 결과. */
export interface RecomputeResult {
  store_id: string;
  playlist_id: string;
  updated: number;
  active: number;
  computed_at: string;
}

/** 반응 점수 산출 입력(집계된 이벤트 카운트). */
export interface ReactionCounts {
  plays: number;
  completes: number;
  skips: number;
  nexts: number;
  /** 평균 완곡률(0..1). */
  completionDepth: number;
  /** 선택적 명시 반응. */
  likes?: number;
  dislikes?: number;
}

// =============================================================================
// Pure math — MUST match the SQL exactly (locked by tests)
// =============================================================================

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Reaction score (0..100). _ai_store_reaction_score 미러.
 *   plays == 0 → { 50, sample 0, rates 0 } (중립, 표본 없음).
 *   raw = 50 + comp·40 + depth·10 − skip·50 − next·15 + react_bonus(±10)
 * comp/skip/next 은 plays 로 나눈 비율(각 1 로 clamp), depth 는 평균 완곡률.
 */
export function computeReactionScore(counts: ReactionCounts): ReactionScoreResult {
  const plays = Math.max(0, Math.floor(counts.plays || 0));
  if (plays === 0) {
    return {
      reaction_score: NEUTRAL_REACTION_SCORE,
      sample_count: 0,
      skip_rate: 0,
      completion_rate: 0,
    };
  }

  const compR = clamp((counts.completes || 0) / plays, 0, 1);
  const skipR = clamp((counts.skips || 0) / plays, 0, 1);
  const nextR = clamp((counts.nexts || 0) / plays, 0, 1);
  const depth = clamp(counts.completionDepth || 0, 0, 1);

  const likes = Math.max(0, counts.likes || 0);
  const dislikes = Math.max(0, counts.dislikes || 0);
  const reactBonus =
    likes + dislikes > 0 ? ((likes - dislikes) / (likes + dislikes)) * 10 : 0;

  const raw = clamp(
    50 + compR * 40 + depth * 10 - skipR * 50 - nextR * 15 + reactBonus,
    0,
    100,
  );

  return {
    reaction_score: Math.round(raw),
    sample_count: plays,
    skip_rate: roundTo(skipR, 4),
    completion_rate: roundTo(compR, 4),
  };
}

/**
 * Adaptive score. _ai_adaptive_score 미러.
 *   sample < MIN_SAMPLE → round(fit)  (학습 미적용)
 *   else → round(clamp(0..100, fit + clamp(±ADJUST, (reaction−50)·WEIGHT)))
 */
export function computeAdaptiveScore(
  fit: number | null | undefined,
  reactionScore: number | null | undefined,
  sampleCount: number | null | undefined,
): number {
  const f = fit == null || Number.isNaN(fit) ? 0 : fit;
  const sample = sampleCount == null ? 0 : sampleCount;
  if (sample < MIN_SAMPLE) return Math.round(f);

  const reaction =
    reactionScore == null || Number.isNaN(reactionScore)
      ? NEUTRAL_REACTION_SCORE
      : reactionScore;
  const adjust = clamp(
    (reaction - NEUTRAL_REACTION_SCORE) * ADAPTIVE_WEIGHT,
    -ADAPTIVE_ADJUST_CLAMP,
    ADAPTIVE_ADJUST_CLAMP,
  );
  return Math.round(clamp(f + adjust, 0, 100));
}

/** 표본 → 학습 상태. */
export function learningStatusFor(sampleCount: number | null | undefined): LearningStatus {
  return (sampleCount ?? 0) >= MIN_SAMPLE ? 'active' : 'collecting';
}

// =============================================================================
// Pure presentation helpers (no DOM / no network)
// =============================================================================

/** 학습 상태 → 한글 라벨. */
export function learningStatusLabel(s: string): string {
  switch (s) {
    case 'active':
      return '학습 적용';
    case 'collecting':
      return '수집 중';
    case 'none':
      return '미적용';
    default:
      return s;
  }
}

/**
 * 학습 상태 → Tailwind 톤(배지). adminTones.badge 규격(alpha /25, 고대비 text-*-100).
 * 알 수 없는 값은 중립 톤.
 */
export function learningStatusTone(s: string): string {
  switch (s) {
    case 'active':
      return 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50';
    case 'collecting':
      return 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/50';
    case 'none':
      return 'bg-ink/15 text-ink-mute ring-1 ring-line/20';
    default:
      return 'bg-ink/15 text-ink-mute ring-1 ring-line/20';
  }
}

/** adaptive−fit 차이 표기. 예: "+15", "−20", "0". null-safe. */
export function formatDifference(diff: number | null | undefined): string {
  if (diff == null || Number.isNaN(diff)) return '—';
  const r = Math.round(diff);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${Math.abs(r)}`; // U+2212 minus for typographic consistency
  return '0';
}

/** 차이 방향 → 톤(상승 emerald / 하락 rose / 동일 중립). */
export function differenceTone(diff: number | null | undefined): string {
  const r = diff == null || Number.isNaN(diff) ? 0 : Math.round(diff);
  if (r > 0) return 'text-emerald-300';
  if (r < 0) return 'text-rose-300';
  return 'text-ink-mute';
}

/** 비율(0..1) → 퍼센트 문자열. 예: 0.1234 → "12%". null-safe. */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '—';
  return `${Math.round(clamp(rate, 0, 1) * 100)}%`;
}

/** 표본 진행 문자열. 예: "12 / 20". active 이면 표본 그대로. */
export function formatSampleProgress(sampleCount: number | null | undefined): string {
  const s = Math.max(0, Math.floor(sampleCount ?? 0));
  if (s >= MIN_SAMPLE) return String(s);
  return `${s} / ${MIN_SAMPLE}`;
}

// =============================================================================
// internal
// =============================================================================

function roundTo(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
