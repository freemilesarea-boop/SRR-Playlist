/**
 * learningSignals — Continuous Learning Signal Foundation & Safe Feedback Loop
 * (Phase AI-LEARNING-1).
 *
 * 학습 데이터의 수집·검증·Attribution·정규화·Confidence·집계·Bias 감지·v1/v2 비교·
 * Counterfactual 평가·Shadow Weight Proposal·Backtest **까지만** 담당하는 순수 로직.
 * Production Recommendation Weight/v1·v2 점수식/Playlist/Queue/Scheduler/Player 는
 * 어떤 경로로도 변경하지 않는다(Apply 함수 자체가 없음 — BLOCKED 목록으로 고정).
 *
 * 원칙: 존재하지 않는 Reaction/Exposure 를 생성하지 않음 · Proxy 를 원장이라
 * 주장하지 않음 · Sample 부족을 기준 완화로 덮지 않음(insufficient_data) ·
 * Correlation ≠ Causation · Shadow v2 결과는 Offline Estimated Outcome 으로만
 * 표기(실제 A/B 아님) · 외부 LLM 미사용 · 서버(0568)가 정규화/Confidence/
 * Attribution 을 재계산하며 이 모듈의 계산은 미리보기+테스트 기준이다.
 *
 * 재사용 정책: Early Skip 30초(0182) · Complete 80%(기존 v1 정책) ·
 * mute/low-volume(<10%) 제외(0347 계열) · 24h cap/30s dedup 은 v1 스트림 계층에
 * 실존하므로 참조만(재정의 없음).
 */

import { REC_WEIGHTS } from './recommendIntelV2';

/* ── Domain 타입 ─────────────────────────────────────────────────────── */
export type LearningEventType =
  | 'recommendation_exposed' | 'recommendation_selected' | 'track_queued'
  | 'playback_started' | 'playback_completed' | 'playback_skipped' | 'playback_failed'
  | 'track_replayed' | 'track_liked' | 'track_disliked' | 'track_excluded' | 'session_ended';

export type RecommendationSource =
  | 'recommendation_v1' | 'recommendation_v2_shadow' | 'playlist' | 'sequence_draft'
  | 'scheduler' | 'auto_continue' | 'manual' | 'unknown';

export type AttributionStatus = 'attributed' | 'partially_attributed' | 'unattributed' | 'ambiguous' | 'invalid';
export type LearningSignalStatus = 'valid' | 'invalid' | 'duplicate' | 'insufficient_data' | 'excluded' | 'pending';
export type LearningSignalType = 'positive' | 'negative' | 'neutral' | 'quality_failure' | 'not_applicable';

export interface LearningEventInput {
  idempotencyKey: string;
  eventType: LearningEventType;
  trackId: string;
  storeId: string | null;
  sessionId: string | null;
  occurredAt: string;
  listenedSeconds: number | null;
  trackDurationSeconds: number | null;
  volume: number | null;
  muted: boolean | null;
  exposureId: string | null;
}

export interface ExposureRef {
  id: string;
  trackId: string;
  isShadow: boolean;
  exposedAt: string;
  source: RecommendationSource;
}

export interface NormalizedSignal {
  signalType: LearningSignalType;
  normalizedValue: number | null;
  signalStatus: LearningSignalStatus;
  reasons: string[];
}

export const SIGNAL_NORM_VERSION = 'sig-norm-v1';
/** 초기 정규화 상수(서버 0568 과 동일) — 버전 관리 대상. */
export const SIGNAL_VALUES = {
  like: 1.0, replay: 0.8, complete: 0.6, long_listen: 0.4, neutral: 0,
  skip: -0.4, early_skip: -0.7, exclusion: -0.9, dislike: -1.0,
} as const;
export const EARLY_SKIP_SECONDS = 30; // 0182 기존 정책 재사용
export const COMPLETE_MIN_RATIO = 0.8; // 기존 v1 Complete 정책
export const LOW_VOLUME_THRESHOLD = 0.1; // 0347 계열 정책 재사용

export const FIXED_LEARNING_WARNING =
  '승인된 Learning Proposal은 실제 Production Recommendation Weight에 자동 반영되지 않습니다.';

/** 금지 액션 — 스펙 금지 기능과 1:1(Apply/Enable/Disable/Rollout 없음). */
export const BLOCKED_LEARNING_ACTIONS = [
  'apply_production_weights',
  'disable_recommendation_v1',
  'enable_recommendation_v2',
  'apply_to_playlist',
  'apply_to_queue',
  'apply_to_scheduler',
  'apply_to_player',
  'auto_rollout',
  'auto_publish',
] as const;
export function isBlockedLearningAction(action: string): boolean {
  return (BLOCKED_LEARNING_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── Signal Normalization(서버와 동일 규칙) ───────────────────────────── */
export function normalizeSignal(ev: LearningEventInput): NormalizedSignal {
  const reasons: string[] = [];
  let status: LearningSignalStatus = 'valid';
  if (ev.muted === true || (ev.volume != null && ev.volume < LOW_VOLUME_THRESHOLD)) {
    status = 'excluded';
    reasons.push('muted_or_low_volume');
  }
  switch (ev.eventType) {
    case 'track_liked': return { signalType: 'positive', normalizedValue: SIGNAL_VALUES.like, signalStatus: status, reasons };
    case 'track_replayed': return { signalType: 'positive', normalizedValue: SIGNAL_VALUES.replay, signalStatus: status, reasons };
    case 'playback_completed': return { signalType: 'positive', normalizedValue: SIGNAL_VALUES.complete, signalStatus: status, reasons };
    case 'playback_skipped': {
      const early = ev.listenedSeconds != null && ev.listenedSeconds < EARLY_SKIP_SECONDS;
      return {
        signalType: 'negative',
        normalizedValue: early ? SIGNAL_VALUES.early_skip : SIGNAL_VALUES.skip,
        signalStatus: status, reasons: early ? [...reasons, 'early_skip'] : reasons,
      };
    }
    case 'track_disliked': return { signalType: 'negative', normalizedValue: SIGNAL_VALUES.dislike, signalStatus: status, reasons };
    case 'track_excluded': return { signalType: 'negative', normalizedValue: SIGNAL_VALUES.exclusion, signalStatus: status, reasons };
    case 'playback_failed':
      // 재생 실패는 Track 선호 Negative 가 아니라 품질 신호.
      return { signalType: 'quality_failure', normalizedValue: null, signalStatus: status, reasons: [...reasons, 'quality_signal_not_preference'] };
    default:
      return { signalType: 'neutral', normalizedValue: SIGNAL_VALUES.neutral, signalStatus: status, reasons };
  }
}

/* ── Attribution(서버와 동일 우선순위, 임의 귀속 금지) ────────────────────── */
export interface AttributionResult { status: AttributionStatus; confidence: number; reasons: string[] }

export function attributeEvent(
  ev: LearningEventInput, exposure: ExposureRef | null,
  fallback: { queueSource: RecommendationSource | null; candidateSources: RecommendationSource[] },
): AttributionResult {
  if (exposure) {
    if (exposure.trackId !== ev.trackId) return { status: 'invalid', confidence: 0, reasons: ['exposure_track_mismatch'] };
    if (exposure.isShadow) return { status: 'invalid', confidence: 0, reasons: ['shadow_exposure_not_attributable'] };
    if (Date.parse(ev.occurredAt) < Date.parse(exposure.exposedAt)) {
      return { status: 'invalid', confidence: 0, reasons: ['event_before_exposure'] };
    }
    return { status: 'attributed', confidence: 1, reasons: ['explicit_exposure_id'] };
  }
  if (fallback.candidateSources.length > 1) {
    return { status: 'ambiguous', confidence: 0.3, reasons: ['multiple_candidate_sources'] };
  }
  if (fallback.queueSource) {
    // 추정 귀속 — Unknown 을 v1 로 임의 귀속하지 않는다.
    if (fallback.queueSource === 'unknown') return { status: 'unattributed', confidence: 0.3, reasons: ['unknown_source'] };
    return { status: 'partially_attributed', confidence: 0.6, reasons: [`queue_source:${fallback.queueSource}`] };
  }
  return { status: 'unattributed', confidence: 0.3, reasons: ['no_identifier'] };
}

/* ── Confidence(곱 구조, 0~1) ────────────────────────────────────────── */
export function computeSignalConfidence(parts: {
  attribution: number; eventValidity: number; playbackQuality: number; sample: number;
}): number {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return round3(clamp01(parts.attribution) * clamp01(parts.eventValidity) * clamp01(parts.playbackQuality) * clamp01(parts.sample));
}

/* ── Sample Sufficiency(기준 완화 금지) ──────────────────────────────── */
export const SAMPLE_THRESHOLDS = {
  track: { exposure: 20, playback: 10 },
  store: { playback: 50, minDays: 7 },
  algorithm: { exposure: 100, validOutcome: 30 },
} as const;

export function sampleStatus(entity: 'track' | 'store' | 'algorithm', stats: {
  exposure?: number; playback?: number; days?: number; validOutcome?: number;
}): 'sufficient' | 'insufficient_data' {
  if (entity === 'track') {
    return (stats.exposure ?? 0) >= SAMPLE_THRESHOLDS.track.exposure && (stats.playback ?? 0) >= SAMPLE_THRESHOLDS.track.playback
      ? 'sufficient' : 'insufficient_data';
  }
  if (entity === 'store') {
    return (stats.playback ?? 0) >= SAMPLE_THRESHOLDS.store.playback && (stats.days ?? 0) >= SAMPLE_THRESHOLDS.store.minDays
      ? 'sufficient' : 'insufficient_data';
  }
  return (stats.exposure ?? 0) >= SAMPLE_THRESHOLDS.algorithm.exposure && (stats.validOutcome ?? 0) >= SAMPLE_THRESHOLDS.algorithm.validOutcome
    ? 'sufficient' : 'insufficient_data';
}

/* ── Aggregate(순수 계산 — 서버 0568 집계와 동일 지표) ─────────────────── */
export interface LearningEventRow {
  eventType: LearningEventType;
  trackId: string;
  storeId: string | null;
  signalStatus: LearningSignalStatus;
  attributionStatus: AttributionStatus;
  normalizedValue: number | null;
  confidence: number;
}

export interface LearningAggregate {
  entityType: 'track' | 'artist' | 'store' | 'brand' | 'industry' | 'algorithm';
  entityId: string;
  exposureCount: number;
  playCount: number;
  completionCount: number;
  skipCount: number;
  likeCount: number;
  dislikeCount: number;
  replayCount: number;
  failureCount: number;
  completionRate: number | null;
  skipRate: number | null;
  positiveRate: number | null;
  attributedRate: number | null;
  averageSignal: number | null;
  confidence: number;
  sampleStatus: 'sufficient' | 'insufficient_data';
}

export function buildAggregate(
  entityType: LearningAggregate['entityType'], entityId: string,
  events: LearningEventRow[], exposureCount: number,
): LearningAggregate {
  const valid = events.filter((e) => e.signalStatus === 'valid');
  const count = (t: LearningEventType) => valid.filter((e) => e.eventType === t).length;
  const play = events.filter((e) => e.eventType === 'playback_started').length;
  const completion = count('playback_completed');
  const skip = count('playback_skipped');
  const signals = valid.map((e) => e.normalizedValue).filter((v): v is number => v != null);
  const positives = valid.filter((e) => (e.normalizedValue ?? 0) > 0).length;
  const attributed = events.filter((e) => e.attributionStatus === 'attributed').length;
  return {
    entityType, entityId,
    exposureCount, playCount: play, completionCount: completion, skipCount: skip,
    likeCount: count('track_liked'), dislikeCount: count('track_disliked'),
    replayCount: count('track_replayed'),
    failureCount: events.filter((e) => e.eventType === 'playback_failed').length,
    completionRate: play > 0 ? round3(completion / play) : null,
    skipRate: play > 0 ? round3(skip / play) : null,
    positiveRate: valid.length > 0 ? round3(positives / valid.length) : null,
    attributedRate: events.length > 0 ? round3(attributed / events.length) : null,
    averageSignal: signals.length > 0 ? round3(signals.reduce((s, v) => s + v, 0) / signals.length) : null,
    confidence: events.length > 0 ? round3(events.reduce((s, e) => s + e.confidence, 0) / events.length) : 0,
    sampleStatus: sampleStatus(entityType === 'store' ? 'store' : entityType === 'algorithm' ? 'algorithm' : 'track',
      { exposure: exposureCount, playback: play, validOutcome: valid.length, days: 0 }),
  };
}

/* ── Bias & Data Quality Detection(자동 보정 없음 — 경고만) ─────────────── */
export interface BiasFlag { code: string; message: string; severity: 'warning' | 'critical'; affected: string }

export function detectBias(input: {
  storeShares: Record<string, number>;
  artistShares: Record<string, number>;
  genreShares: Record<string, number>;
  avgExposedRank: number | null;
  avgPlayedRank: number | null;
  unattributedRatio: number;
  reactionCount: number;
  duplicateRatio: number;
  newTrackRatio: number | null;
}): BiasFlag[] {
  const flags: BiasFlag[] = [];
  const topShare = (m: Record<string, number>): [string, number] | null => {
    const es = Object.entries(m);
    if (!es.length) return null;
    return es.reduce((a, b) => (b[1] > a[1] ? b : a));
  };
  const conc = (m: Record<string, number>, code: string, label: string, cap: number) => {
    const top = topShare(m);
    if (top && top[1] > cap) flags.push({ code, message: `${label} 편중(${top[0]} ${Math.round(top[1] * 100)}%)`, severity: top[1] > cap * 1.5 ? 'critical' : 'warning', affected: top[0] });
  };
  conc(input.storeShares, 'store_concentration', 'Store', 0.5);
  conc(input.artistShares, 'artist_concentration', 'Artist', 0.3);
  conc(input.genreShares, 'genre_concentration', 'Genre', 0.5);
  if (input.avgExposedRank != null && input.avgPlayedRank != null && input.avgExposedRank - input.avgPlayedRank > 2) {
    flags.push({ code: 'position_bias', message: `상위 Rank 편중 재생(노출 평균 ${round1(input.avgExposedRank)} vs 재생 평균 ${round1(input.avgPlayedRank)})`, severity: 'warning', affected: 'rank' });
  }
  if (input.unattributedRatio > 0.5) {
    flags.push({ code: 'missing_attribution', message: `Attribution 누락 ${Math.round(input.unattributedRatio * 100)}%`, severity: 'critical', affected: 'attribution' });
  }
  if (input.reactionCount < 20) {
    flags.push({ code: 'reaction_sparse', message: `Reaction 표본 ${input.reactionCount}건 — 학습 반영 불가 수준`, severity: 'warning', affected: 'reaction' });
  }
  if (input.duplicateRatio > 0.05) {
    flags.push({ code: 'duplicate_burst', message: `중복 이벤트 비율 ${Math.round(input.duplicateRatio * 100)}%`, severity: 'warning', affected: 'events' });
  }
  if (input.newTrackRatio != null && input.newTrackRatio < 0.05) {
    flags.push({ code: 'new_track_underrepresented', message: '신곡 데이터 부족', severity: 'warning', affected: 'novelty' });
  }
  return flags;
}

/* ── v1/v2 Outcome Comparison — Shadow 는 Offline Estimated 로만 표기 ───── */
export interface OutcomeComparison {
  v1: { label: 'actual'; aggregate: LearningAggregate | null };
  v2: { label: 'offline_estimated'; aggregate: LearningAggregate | null };
  comparable: boolean;
  limitations: string[];
  winnerClaimAllowed: false;
}

export function compareOutcomes(v1: LearningAggregate | null, v2Shadow: LearningAggregate | null): OutcomeComparison {
  const limitations: string[] = [
    'v2 는 Shadow(Production 미노출) — 결과는 Offline Estimated Outcome 이며 실제 A/B 결과가 아님.',
    'Correlation 은 Causation 이 아님 — 우열 단정 금지.',
  ];
  const comparable = !!v1 && !!v2Shadow
    && v1.sampleStatus === 'sufficient' && v2Shadow.sampleStatus === 'sufficient';
  if (!comparable) limitations.push('Sample 부족 — 비교 결론을 생성하지 않음(insufficient_data).');
  return { v1: { label: 'actual', aggregate: v1 }, v2: { label: 'offline_estimated', aggregate: v2Shadow }, comparable, limitations, winnerClaimAllowed: false };
}

/* ── Counterfactual / Offline Replay 평가 상태 ─────────────────────────── */
export interface CounterfactualInput {
  hasCandidateSnapshot: boolean;
  hasV1Result: boolean;
  hasOutcome: boolean;
  usesFutureReactions: boolean;
  usesCurrentAvailabilityAsPast: boolean;
  usesCurrentReputationAsPast: boolean;
}

export function evaluateCounterfactual(input: CounterfactualInput): {
  verdict: 'valid' | 'partial' | 'invalid' | 'insufficient_data';
  leakage: string[];
} {
  const leakage: string[] = [];
  if (input.usesFutureReactions) leakage.push('future_reactions_leak');
  if (input.usesCurrentAvailabilityAsPast) leakage.push('current_availability_as_past');
  if (input.usesCurrentReputationAsPast) leakage.push('current_reputation_as_past');
  if (leakage.length && input.usesFutureReactions) return { verdict: 'invalid', leakage };
  if (!input.hasOutcome || !input.hasV1Result) return { verdict: 'insufficient_data', leakage };
  if (!input.hasCandidateSnapshot || leakage.length) return { verdict: 'partial', leakage };
  return { verdict: 'valid', leakage };
}

/* ── Weight Proposal(자동 적용 없음 — Δ≤5 · 합 100 · Hard Policy 불변) ──── */
export const WEIGHT_DELTA_CAP = 5;
/** 제안 금지 가중치 — Eligibility/Guardrail 계열은 학습으로 완화하지 않는다. */
export const HARD_POLICY_WEIGHT_KEYS = ['policyCompliance'] as const;

export interface WeightProposalResult {
  ok: boolean;
  reason?: string;
  currentWeights?: Record<string, number>;
  proposedWeights?: Record<string, number>;
  deltas?: Record<string, number>;
}

export function generateWeightProposal(input: {
  desiredDeltas: Record<string, number>;
  sampleValidOutcomes: number;
}): WeightProposalResult {
  const current: Record<string, number> = { ...REC_WEIGHTS };
  if (input.sampleValidOutcomes < SAMPLE_THRESHOLDS.algorithm.validOutcome) {
    return { ok: false, reason: `insufficient_sample(${input.sampleValidOutcomes} < ${SAMPLE_THRESHOLDS.algorithm.validOutcome})` };
  }
  for (const k of Object.keys(input.desiredDeltas)) {
    if ((HARD_POLICY_WEIGHT_KEYS as readonly string[]).includes(k)) {
      return { ok: false, reason: `hard_policy_weight_immutable(${k})` };
    }
    if (!(k in current)) return { ok: false, reason: `unknown_weight(${k})` };
    if (Math.abs(input.desiredDeltas[k]) > WEIGHT_DELTA_CAP) {
      return { ok: false, reason: `delta_cap_exceeded(${k}: ${input.desiredDeltas[k]})` };
    }
  }
  const proposed: Record<string, number> = { ...current };
  let net = 0;
  for (const [k, d] of Object.entries(input.desiredDeltas)) { proposed[k] = current[k] + d; net += d; }
  // 합 100 유지: 순변화를 나머지 조정 가능 가중치에 균등 재분배(Hard Policy 제외).
  if (net !== 0) {
    const adjustable = Object.keys(proposed).filter((k) =>
      !(k in input.desiredDeltas) && !(HARD_POLICY_WEIGHT_KEYS as readonly string[]).includes(k));
    if (!adjustable.length) return { ok: false, reason: 'cannot_rebalance_to_100' };
    const share = net / adjustable.length;
    for (const k of adjustable) proposed[k] = round1(proposed[k] - share);
    if (adjustable.some((k) => Math.abs(proposed[k] - current[k]) > WEIGHT_DELTA_CAP)) {
      return { ok: false, reason: 'rebalance_exceeds_delta_cap' };
    }
  }
  const sum = Object.values(proposed).reduce((s, v) => s + v, 0);
  if (Math.round(sum) !== 100) return { ok: false, reason: `sum_not_100(${sum})` };
  const deltas: Record<string, number> = {};
  for (const k of Object.keys(proposed)) {
    const d = round1(proposed[k] - current[k]);
    if (d !== 0) deltas[k] = d;
  }
  return { ok: true, currentWeights: current, proposedWeights: proposed, deltas };
}

/* ── Shadow Backtest — 가중치 재점수화(Production 미적용) ─────────────── */
export interface BacktestCandidate {
  trackId: string;
  artistKey: string | null;
  genre: string | null;
  signals: Record<string, number | null>; // REC_WEIGHTS 키 기준 0~100 신호
  hardViolation: boolean;
}

export function scoreWithWeights(signals: Record<string, number | null>, weights: Record<string, number>): number {
  const present = Object.entries(signals).filter(([k, v]) => v != null && k in weights);
  const wsum = present.reduce((s, [k]) => s + weights[k], 0);
  if (wsum <= 0) return 0;
  return round1(present.reduce((s, [k, v]) => s + (v as number) * weights[k], 0) / wsum);
}

export interface BacktestResult {
  verdict: 'pass' | 'fail' | 'insufficient_data';
  sampleCount: number;
  currentAvgScore: number | null;
  proposedAvgScore: number | null;
  scoreDelta: number | null;
  currentTopArtistShare: number | null;
  proposedTopArtistShare: number | null;
  hardGateViolations: number;
  regressions: string[];
  limitations: string[];
}

export function backtestProposal(
  candidates: BacktestCandidate[], currentW: Record<string, number>, proposedW: Record<string, number>, topN: number,
): BacktestResult {
  const limitations = ['Offline Backtest — 실제 Production 성과가 아님(과거 신호 재점수화).'];
  const eligible = candidates.filter((c) => !c.hardViolation);
  const hardGateViolations = 0; // Hard 위반 후보는 양쪽 모두에서 제외(완화 없음).
  if (eligible.length < SAMPLE_THRESHOLDS.algorithm.validOutcome) {
    return {
      verdict: 'insufficient_data', sampleCount: eligible.length,
      currentAvgScore: null, proposedAvgScore: null, scoreDelta: null,
      currentTopArtistShare: null, proposedTopArtistShare: null,
      hardGateViolations, regressions: [], limitations: [...limitations, 'sample_below_threshold'],
    };
  }
  const rank = (w: Record<string, number>) =>
    [...eligible].sort((a, b) => scoreWithWeights(b.signals, w) - scoreWithWeights(a.signals, w)
      || (a.trackId < b.trackId ? -1 : 1)).slice(0, topN);
  const topShare = (list: BacktestCandidate[]): number | null => {
    const m = new Map<string, number>();
    for (const c of list) if (c.artistKey) m.set(c.artistKey, (m.get(c.artistKey) ?? 0) + 1);
    return m.size ? Math.max(...m.values()) / list.length : null;
  };
  const curTop = rank(currentW);
  const propTop = rank(proposedW);
  const avg = (list: BacktestCandidate[], w: Record<string, number>) =>
    round1(list.reduce((s, c) => s + scoreWithWeights(c.signals, w), 0) / Math.max(1, list.length));
  const curAvg = avg(curTop, currentW);
  const propAvg = avg(propTop, proposedW);
  const curShare = topShare(curTop);
  const propShare = topShare(propTop);
  const regressions: string[] = [];
  if (propAvg < curAvg - 2) regressions.push(`avg_score_regression(${curAvg}→${propAvg})`);
  if (curShare != null && propShare != null && propShare > curShare + 0.05) {
    regressions.push(`artist_concentration_increase(${round3(curShare)}→${round3(propShare)})`);
  }
  const fitKey = 'storeFit';
  const fitAvg = (list: BacktestCandidate[]) => {
    const vs = list.map((c) => c.signals[fitKey]).filter((v): v is number => v != null);
    return vs.length ? round1(vs.reduce((s, v) => s + v, 0) / vs.length) : null;
  };
  const curFit = fitAvg(curTop);
  const propFit = fitAvg(propTop);
  if (curFit != null && propFit != null && propFit < curFit - 2) regressions.push(`store_fit_regression(${curFit}→${propFit})`);
  return {
    verdict: regressions.length ? 'fail' : 'pass',
    sampleCount: eligible.length,
    currentAvgScore: curAvg, proposedAvgScore: propAvg, scoreDelta: round1(propAvg - curAvg),
    currentTopArtistShare: curShare == null ? null : round3(curShare),
    proposedTopArtistShare: propShare == null ? null : round3(propShare),
    hardGateViolations, regressions, limitations,
  };
}

/* ── Learning Quality Score ──────────────────────────────────────────── */
export interface LearningQualityInput {
  attributionRate: number | null;
  validSignalRate: number | null;
  duplicateRate: number | null;
  sampleSufficient: boolean;
  storeCoverage: number;
  trackCoverage: number;
  biasCriticalCount: number;
  backtestVerdict: 'pass' | 'fail' | 'insufficient_data' | null;
  leakageDetected: boolean;
}

export interface LearningQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data';
  promotionBlockers: string[];
}

export function computeLearningQuality(input: LearningQualityInput): LearningQualityResult {
  const blockers: string[] = [];
  if ((input.attributionRate ?? 0) < 0.5) blockers.push('attribution_rate_below_threshold');
  if ((input.validSignalRate ?? 0) < 0.5) blockers.push('valid_signal_insufficient');
  if (!input.sampleSufficient) blockers.push('sample_insufficient');
  if ((input.duplicateRate ?? 0) > 0.05) blockers.push('duplicate_rate_excessive');
  if (input.biasCriticalCount > 0) blockers.push('bias_risk_critical');
  if (input.backtestVerdict === 'fail') blockers.push('backtest_regression');
  if (input.backtestVerdict == null || input.backtestVerdict === 'insufficient_data') blockers.push('backtest_missing_or_insufficient');
  if (input.leakageDetected) blockers.push('dataset_leakage_detected');

  if (!input.sampleSufficient || input.attributionRate == null || input.validSignalRate == null) {
    return { score: null, grade: 'insufficient_data', promotionBlockers: blockers };
  }
  const parts = [
    (input.attributionRate ?? 0) * 100 * 0.25,
    (input.validSignalRate ?? 0) * 100 * 0.25,
    (1 - Math.min(1, input.duplicateRate ?? 0)) * 100 * 0.1,
    Math.min(1, input.storeCoverage / 10) * 100 * 0.1,
    Math.min(1, input.trackCoverage / 50) * 100 * 0.1,
    (input.biasCriticalCount > 0 ? 0 : 100) * 0.1,
    (input.backtestVerdict === 'pass' ? 100 : 0) * 0.1,
  ];
  const score = round1(parts.reduce((s, v) => s + v, 0));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade, promotionBlockers: blockers };
}

/* ── Explainability(템플릿 결정론 — LLM 미사용) ───────────────────────── */
export function buildLearningExplanation(input: {
  windowLabel: string;
  storeCount: number;
  playCount: number;
  attributionRate: number | null;
  v1AttributedPlays: number;
  reactionCount: number;
  proposal: WeightProposalResult | null;
  backtest: BacktestResult | null;
}): string[] {
  const lines: string[] = [];
  lines.push(`${input.windowLabel} 동안 Store ${input.storeCount}곳에서 ${input.playCount}회 재생이 수집되었습니다.`);
  lines.push(input.attributionRate == null
    ? '유효 Attribution 비율은 데이터 부족으로 산출하지 않았습니다.'
    : `유효 Attribution 비율은 ${Math.round(input.attributionRate * 100)}%이며, Recommendation v1 귀속 재생은 ${input.v1AttributedPlays}회입니다.`);
  lines.push(input.reactionCount < SAMPLE_THRESHOLDS.algorithm.validOutcome
    ? `Reaction 데이터는 ${input.reactionCount}건뿐이므로 Reaction Weight 변경은 제안하지 않았습니다.`
    : `Reaction 데이터 ${input.reactionCount}건을 Confidence 와 함께 반영했습니다.`);
  if (input.proposal?.ok && input.proposal.deltas) {
    const ds = Object.entries(input.proposal.deltas).map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`).join(', ');
    lines.push(`Shadow Weight Proposal: ${ds} (총합 100 유지 · Δ≤${WEIGHT_DELTA_CAP} · Hard Policy 불변).`);
  } else if (input.proposal) {
    lines.push(`Weight Proposal 은 생성되지 않았습니다(${input.proposal.reason}).`);
  }
  if (input.backtest) {
    lines.push(input.backtest.verdict === 'insufficient_data'
      ? 'Backtest 는 Sample 부족으로 결론을 생성하지 않았습니다.'
      : `Offline Backtest ${input.backtest.verdict}: 평균 점수 ${input.backtest.currentAvgScore}→${input.backtest.proposedAvgScore} (실제 Production 성과 아님).`);
  }
  lines.push('본 분석은 상관 관계 관측이며 인과를 단정하지 않습니다.');
  lines.push(FIXED_LEARNING_WARNING);
  return lines;
}
