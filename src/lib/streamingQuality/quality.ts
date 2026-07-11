// WEB-OBS-7 — Streaming Quality classifiers + score (pure, unit-tested, rule-based — NO ML).
//
// Turns one windowed QualityAggregate into a StreamingQualityResult: per-dimension status + a 0..100
// score computed over ONLY the components that have signal (NO_DATA components are dropped and the
// weights renormalize — a missing signal is never scored as 0). Signal coverage is reported so a
// thin-signal score is never mistaken for a full one. Honesty: TTFA is APPROX (request→first
// progress), crossfade/preload are NOT_AVAILABLE for business-mode scopes (disabled), preload
// "consumed" is NOT_AVAILABLE.

import { clamp, round, safeRatio } from '../observability/math';
import type { Confidence } from '../observability/release';
import type {
  QualityAggregate, StreamingQualityResult, QualityComponent,
  StartStatus, TransitionStatus, CrossfadeStatus, StallStatus, PreloadStatus,
  MediaErrorStatus, RecoveryStatus, ContinuityStatus, QualityStatus,
} from './types';
import {
  QUALITY_WEIGHTS, QUALITY_BAND_EXCELLENT, QUALITY_BAND_HEALTHY, QUALITY_BAND_WATCH, QUALITY_BAND_DEGRADED,
  START_SUCCESS_RATE_BUDGET, TTFA_GOOD_MS, TTFA_SLOW_MS, TRANSITION_SEAMLESS_MS, TRANSITION_ACCEPTABLE_MS,
  GAP_WARNING_MS, OVERLAP_WARNING_MS, CROSSFADE_COMPLETION_BUDGET, STALL_SESSION_RATE_BUDGET,
  MEDIA_ERROR_SESSION_RATE_BUDGET, PRELOAD_READY_RATE_BUDGET, RECOVERY_SUCCESS_RATE_BUDGET,
  MIN_SESSIONS_FOR_SCORE, MIN_EVENTS_FOR_SCORE, CONTINUITY_MIN_TRANSITIONS,
  CONFIDENCE_HIGH_SAMPLES, CONFIDENCE_MEDIUM_SAMPLES,
} from './thresholds';

const TTFA_DISCLAIMER = 'TTFA_APPROX = 재생 요청→currentTime 최초 진행. 실제 스피커 출력 시점은 브라우저에서 증명 불가.';

function startStatus(rate: number | null): StartStatus {
  if (rate == null) return 'INSUFFICIENT_DATA';
  if (rate >= 0.95) return 'SUCCESS';
  if (rate >= 0.85) return 'DEGRADED';
  return 'FAILING';
}
function ttfaGoodness(p75: number | null): number | null {
  if (p75 == null) return null;
  if (p75 <= TTFA_GOOD_MS) return 1;
  if (p75 >= TTFA_SLOW_MS) return 0;
  return clamp(1 - (p75 - TTFA_GOOD_MS) / (TTFA_SLOW_MS - TTFA_GOOD_MS), 0, 1);
}
function transitionStatus(p75: number | null): TransitionStatus {
  if (p75 == null) return 'NOT_AVAILABLE';
  if (p75 < -OVERLAP_WARNING_MS) return 'OVERLAP_WARNING';
  if (p75 <= TRANSITION_SEAMLESS_MS) return 'SEAMLESS';
  if (p75 <= TRANSITION_ACCEPTABLE_MS) return 'ACCEPTABLE';
  if (p75 <= GAP_WARNING_MS) return 'GAP_WARNING';
  return 'GAP_CRITICAL';
}

export function computeStreamingQuality(agg: QualityAggregate): StreamingQualityResult {
  const components: QualityComponent[] = [];
  const reasons: string[] = [];
  const add = (key: keyof typeof QUALITY_WEIGHTS, status: string, goodness: number | null, detail: string) => {
    components.push({ key, status, goodness, detail });
  };

  // ── Start success ──
  const startDenom = agg.startSuccess + agg.startFailed + agg.startAbandoned;
  const startRate = startDenom > 0 ? safeRatio(agg.startSuccess, startDenom) : null;
  const sStatus = startStatus(startRate);
  add('startSuccess', sStatus, startRate == null ? null : clamp(startRate / START_SUCCESS_RATE_BUDGET, 0, 1),
    startRate == null ? 'no start data' : `${(startRate * 100).toFixed(1)}% success`);
  if (sStatus === 'FAILING') reasons.push('재생 시작 성공률 저하');

  // ── TTFA_APPROX ──
  const ttfaGood = ttfaGoodness(agg.ttfa.p75);
  add('ttfaApprox', agg.ttfa.p75 == null ? 'NO_DATA' : agg.ttfa.p75 <= TTFA_GOOD_MS ? 'GOOD' : agg.ttfa.p75 <= TTFA_SLOW_MS ? 'OK' : 'SLOW', ttfaGood,
    agg.ttfa.p75 == null ? 'no TTFA samples' : `p75 ${agg.ttfa.p75}ms`);

  // ── Transition gap ──
  const tStatus = transitionStatus(agg.transitionGap.p75);
  const tGood = agg.transitionGap.p75 == null ? null : clamp(1 - (agg.transitionGap.p75) / GAP_WARNING_MS, 0, 1);
  add('transitionGap', tStatus, tGood, agg.transitionGap.p75 == null ? 'NOT_AVAILABLE (gap 신호 없음)' : `gap p75 ${agg.transitionGap.p75}ms`);
  if (tStatus === 'GAP_CRITICAL') reasons.push('Track 전환 공백 과다');

  // ── Crossfade ──
  let cStatus: CrossfadeStatus; let cGood: number | null; let cRate: number | null = null;
  if (!agg.crossfadeApplicable) { cStatus = 'NOT_AVAILABLE'; cGood = null; }
  else if (agg.crossfadeStarted === 0) { cStatus = 'UNKNOWN'; cGood = null; }
  else {
    cRate = safeRatio(agg.crossfadeCompleted, agg.crossfadeStarted);
    cGood = clamp(cRate / CROSSFADE_COMPLETION_BUDGET, 0, 1);
    cStatus = cRate >= 0.95 ? 'HEALTHY' : cRate >= 0.8 ? 'DEGRADED' : 'FAILING';
    if (cStatus === 'FAILING') reasons.push('Crossfade 완료율 저하');
  }
  add('crossfadeCompletion', cStatus, cGood, cRate == null ? (agg.crossfadeApplicable ? 'no crossfade' : 'business-mode: crossfade disabled') : `${(cRate * 100).toFixed(1)}% completed`);

  // ── Stall ──
  const stallRate = agg.sessions > 0 ? safeRatio(agg.stallSessions, agg.sessions) : null;
  let stallStat: StallStatus;
  if (agg.sessions < MIN_SESSIONS_FOR_SCORE) stallStat = agg.sessions === 0 ? 'NO_DATA' : 'UNKNOWN';
  else stallStat = stallRate! <= STALL_SESSION_RATE_BUDGET * 0.5 ? 'HEALTHY' : stallRate! <= STALL_SESSION_RATE_BUDGET ? 'ELEVATED' : 'HIGH';
  const stallGood = stallRate == null ? null : clamp(1 - stallRate / STALL_SESSION_RATE_BUDGET, 0, 1);
  add('stallRate', stallStat, agg.sessions < MIN_SESSIONS_FOR_SCORE ? null : stallGood, stallRate == null ? 'no session data' : `${(stallRate * 100).toFixed(1)}% sessions stalled`);
  if (stallStat === 'HIGH') reasons.push('Stall 세션 비율 높음');

  // ── Media error ──
  const meRate = agg.sessions > 0 ? safeRatio(agg.mediaErrorSessions, agg.sessions) : null;
  let meStat: MediaErrorStatus;
  if (agg.sessions < MIN_SESSIONS_FOR_SCORE) meStat = agg.sessions === 0 ? 'NO_DATA' : 'UNKNOWN';
  else meStat = meRate! <= MEDIA_ERROR_SESSION_RATE_BUDGET * 0.5 ? 'HEALTHY' : meRate! <= MEDIA_ERROR_SESSION_RATE_BUDGET ? 'ELEVATED' : 'HIGH';
  const meGood = meRate == null ? null : clamp(1 - meRate / MEDIA_ERROR_SESSION_RATE_BUDGET, 0, 1);
  add('mediaErrorRate', meStat, agg.sessions < MIN_SESSIONS_FOR_SCORE ? null : meGood, meRate == null ? 'no session data' : `${(meRate * 100).toFixed(2)}% sessions w/ media error`);
  if (meStat === 'HIGH') reasons.push('Media/Decoder 오류 세션 비율 높음');

  // ── Preload ──
  const preloadDenom = agg.preloadReady + agg.preloadFailed;
  let pStatus: PreloadStatus; let pGood: number | null; let pRate: number | null = null;
  if (!agg.crossfadeApplicable) { pStatus = 'NOT_AVAILABLE'; pGood = null; }
  else if (preloadDenom === 0) { pStatus = 'UNKNOWN'; pGood = null; }
  else { pRate = safeRatio(agg.preloadReady, preloadDenom); pGood = clamp(pRate / PRELOAD_READY_RATE_BUDGET, 0, 1); pStatus = pRate >= 0.9 ? 'HEALTHY' : pRate >= 0.7 ? 'DEGRADED' : 'FAILING'; }
  add('preloadReady', pStatus, pGood, pRate == null ? (agg.crossfadeApplicable ? 'no preload' : 'business-mode: preload disabled') : `${(pRate * 100).toFixed(1)}% ready`);

  // ── Recovery ──
  let rStatus: RecoveryStatus; let rGood: number | null; let rRate: number | null = null;
  if (agg.recoveryAttempted === 0) { rStatus = 'NOT_ATTEMPTED'; rGood = null; }
  else { rRate = safeRatio(agg.recoverySucceeded, agg.recoveryAttempted); rGood = clamp(rRate / RECOVERY_SUCCESS_RATE_BUDGET, 0, 1); rStatus = rRate >= 0.8 ? 'HEALTHY' : rRate >= 0.5 ? 'DEGRADED' : 'FAILING'; }
  add('recoverySuccess', rStatus, rGood, rRate == null ? 'no recovery attempts' : `${(rRate * 100).toFixed(1)}% recovered`);
  if (rStatus === 'FAILING') reasons.push('Recovery 성공률 저하');

  // ── Session continuity ──
  let contStatus: ContinuityStatus; let contGood: number | null; let stableRate: number | null = null;
  if (agg.continuityTransitions < CONTINUITY_MIN_TRANSITIONS || agg.sessions === 0) { contStatus = 'INSUFFICIENT_DATA'; contGood = null; }
  else { stableRate = safeRatio(agg.stableSessions, agg.sessions); contGood = stableRate; contStatus = stableRate >= 0.85 ? 'STABLE' : stableRate >= 0.6 ? 'DEGRADED' : stableRate >= 0.3 ? 'INTERRUPTED' : 'FAILED'; }
  add('sessionContinuity', contStatus, contGood, stableRate == null ? 'insufficient transitions' : `${(stableRate * 100).toFixed(1)}% stable`);

  // ── Score over PRESENT components ──
  let wSum = 0; let gSum = 0; let totalW = 0;
  for (const c of components) {
    const w = QUALITY_WEIGHTS[c.key as keyof typeof QUALITY_WEIGHTS];
    totalW += w;
    if (c.goodness != null) { wSum += w; gSum += w * c.goodness; }
  }
  const signalCoverage = totalW > 0 ? round(wSum / totalW, 3)! : 0;
  // Sessions are the primary sample. A scope with too few sessions OR no signal at all → INSUFFICIENT.
  // The total event count only distinguishes HIGH/MEDIUM/LOW (never forces INSUFFICIENT on a
  // session-rich scope whose signals happen to be session-based).
  const totalEvents = agg.startRequests + agg.mediaErrorEvents + agg.crossfadeStarted + agg.ttfa.samples + agg.recoveryAttempted + agg.preloadReady + agg.preloadFailed;
  const confidence: Confidence = agg.sessions < MIN_SESSIONS_FOR_SCORE
    ? 'INSUFFICIENT'
    : agg.sessions >= CONFIDENCE_HIGH_SAMPLES && totalEvents >= MIN_EVENTS_FOR_SCORE ? 'HIGH'
    : agg.sessions >= CONFIDENCE_MEDIUM_SAMPLES ? 'MEDIUM' : 'LOW';

  let score: number | null;
  let status: QualityStatus;
  if (wSum === 0 || agg.sessions < MIN_SESSIONS_FOR_SCORE) {
    score = null; status = 'INSUFFICIENT_DATA';
  } else {
    score = round((gSum / wSum) * 100, 1);
    status = score! >= QUALITY_BAND_EXCELLENT ? 'EXCELLENT' : score! >= QUALITY_BAND_HEALTHY ? 'HEALTHY' : score! >= QUALITY_BAND_WATCH ? 'WATCH' : score! >= QUALITY_BAND_DEGRADED ? 'DEGRADED' : 'CRITICAL';
  }

  return {
    scope: agg.scope, sessions: agg.sessions,
    start: { status: sStatus, successRate: round(startRate, 4), requests: agg.startRequests, failed: agg.startFailed, abandoned: agg.startAbandoned },
    ttfa: { p50: agg.ttfa.p50, p75: agg.ttfa.p75, p95: agg.ttfa.p95, samples: agg.ttfa.samples, approxDisclaimer: TTFA_DISCLAIMER },
    transition: { status: tStatus, gapP75: agg.transitionGap.p75, gapP95: agg.transitionGap.p95, samples: agg.transitionGap.samples },
    crossfade: { status: cStatus, completionRate: round(cRate, 4), started: agg.crossfadeStarted, fallback: agg.crossfadeFallback, aborted: agg.crossfadeAborted },
    stall: { status: stallStat, sessionRate: round(stallRate, 4), stallSessions: agg.stallSessions },
    mediaError: { status: meStat, sessionRate: round(meRate, 4), events: agg.mediaErrorEvents, byCode: agg.mediaErrorByCode },
    preload: { status: pStatus, readyRate: round(pRate, 4), ready: agg.preloadReady, failed: agg.preloadFailed, consumed: 'NOT_AVAILABLE' },
    recovery: { status: rStatus, successRate: round(rRate, 4), attempted: agg.recoveryAttempted, succeeded: agg.recoverySucceeded, failed: agg.recoveryFailed },
    continuity: { status: contStatus, stableRate: round(stableRate, 4), stableSessions: agg.stableSessions },
    score, status, signalCoverage, components, confidence, reasons,
  };
}
