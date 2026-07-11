// AI-MUSIC-4 — Experiment Eligibility Engine. Rule-based decision on whether a store may join a pilot, from
// READ-ONLY signals. Guardrail-adjacent signals that are NOT_AVAILABLE (no prod source) become warnings, not
// fabricated blocks. Read-only — a recommendation requiring operator approval; nothing is assigned.

import { clamp, round } from '../observability/math';
import {
  MIN_PLAYBACKS_FOR_ELIGIBLE, MIN_SESSIONS_FOR_ELIGIBLE, MIN_PROFILE_COVERAGE, MIN_COMPAT_COVERAGE,
  MAX_OFFLINE_DAYS, STREAMING_QUALITY_MIN,
} from './thresholds';
import type { StoreExperimentSignal, Eligibility, EligibilityStatus } from './types';

export function computeEligibility(s: StoreExperimentSignal): Eligibility {
  const reasons: string[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // signal coverage = blend of AI profile + compatibility coverage
  const signalCoverage = clamp((s.profileCoverage + s.compatibilityCoverage) / 2, 0, 1);

  const base = {
    storeId: s.storeId, storeName: s.storeName,
    sampleSize: { playbacks: s.playbacks, sessions: s.sessions },
    signalCoverage: round(signalCoverage, 3) as number,
    requiresApproval: true as const, automated: false as const,
  };

  // 1) Sample sufficiency (Store/Session/Playback kept distinct)
  if (s.playbacks < MIN_PLAYBACKS_FOR_ELIGIBLE || s.sessions < MIN_SESSIONS_FOR_ELIGIBLE) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: [`표본 부족: playbacks ${s.playbacks}/${MIN_PLAYBACKS_FOR_ELIGIBLE}, sessions ${s.sessions}/${MIN_SESSIONS_FOR_ELIGIBLE}`], blockingReasons: [], warnings, confidence: null };
  }

  // 2) Hard blocks (INELIGIBLE)
  if (s.activeExperiments > 0) blockingReasons.push(`이미 실험 참여 중 (${s.activeExperiments})`);
  if (s.recentPlaylistChange) blockingReasons.push('최근 Playlist 변경 — baseline 오염 위험');

  // 3) Temporary exclusions
  const temporary: string[] = [];
  if (s.offlineDays != null && s.offlineDays > MAX_OFFLINE_DAYS) temporary.push(`장기 오프라인 ${s.offlineDays}일`);
  if (s.streamingQualityScore != null && s.streamingQualityScore < STREAMING_QUALITY_MIN) temporary.push(`Streaming 품질 낮음 ${s.streamingQualityScore}`);
  if (s.criticalIncidents != null && s.criticalIncidents > 0) temporary.push(`Critical Incident ${s.criticalIncidents}`);
  if (s.recentRecoveryCount != null && s.recentRecoveryCount >= 3) temporary.push(`Recovery 반복 ${s.recentRecoveryCount}`);
  if (s.recentReleaseRegression === true) temporary.push('최근 Release Regression');

  // 4) Coverage / review-required
  if (s.profileCoverage < MIN_PROFILE_COVERAGE) reasons.push(`Profile Coverage 낮음 ${(s.profileCoverage * 100).toFixed(0)}%`);
  if (s.compatibilityCoverage < MIN_COMPAT_COVERAGE) reasons.push(`Compatibility Coverage 낮음 ${(s.compatibilityCoverage * 100).toFixed(0)}%`);

  // 5) Honest NOT_AVAILABLE warnings (no fabricated block)
  if (s.streamingQualityScore == null) warnings.push('Streaming 품질 신호 NOT_AVAILABLE (source 미적용)');
  if (s.criticalIncidents == null) warnings.push('Incident 신호 NOT_AVAILABLE');

  // confidence: sample breadth + coverage (capped)
  const sampleScore = clamp(Math.min(s.playbacks / (MIN_PLAYBACKS_FOR_ELIGIBLE * 5), 1) * 100, 0, 100);
  const confidence = round(clamp(sampleScore * 0.6 + signalCoverage * 100 * 0.4, 0, 90), 1);

  let status: EligibilityStatus;
  if (blockingReasons.length > 0) status = 'INELIGIBLE';
  else if (temporary.length > 0) { status = 'TEMPORARILY_EXCLUDED'; reasons.push(...temporary); }
  else if (reasons.length > 0) status = 'REVIEW_REQUIRED';
  else { status = 'ELIGIBLE'; reasons.push('표본/커버리지 충족'); }

  return { ...base, status, reasons, blockingReasons, warnings, confidence };
}
