// AI-MUSIC-6 — Certification engines: control preservation, treatment eligibility, fail-open, coverage,
// certification score, and integration readiness. Rule-based & deterministic. Sample floors → INSUFFICIENT_DATA
// (never a fabricated PASS). A single Control divergence caps certification at BLOCKED. The 0..100 score is
// advisory breadth-of-evidence — it never means real playback will succeed. Readiness reaches at most
// READY_FOR_MANUAL_CANARY_REVIEW; no actual canary is ever started.

import {
  CONTROL_MIN_SAMPLES, SHADOW_MIN_SESSIONS, COVERAGE_PARTIAL_SESSIONS, CERT_WEIGHTS,
  CERT_CERTIFIED_MIN, CERT_READY_WITH_WARNINGS_MIN, CERT_REVIEW_MIN, RESOLVER_ERROR_RATE_BLOCK,
  READINESS_PREVIEW_MIN_SCORE, READINESS_CANARY_MIN_SCORE,
} from './thresholds';
import type {
  ControlPreservationInput, ControlPreservationResult, TreatmentEligibilityInput, TreatmentEligibilityResult,
  FailOpenCase, FailOpenResult, CoverageInput, CoverageResult, CertificationInput, CertificationResult,
  ReadinessResult,
} from './types';

// ── Control preservation ───────────────────────────────────────────────────────
export function certifyControlPreservation(i: ControlPreservationInput): ControlPreservationResult {
  const reasons: string[] = [];
  if (i.controlSessions <= 0) return { status: 'NOT_AVAILABLE', controlSessions: 0, divergences: i.controlDivergences, reasons: ['Control Session 없음'] };
  if (i.controlDivergences > 0) {
    reasons.push(`Control Divergence ${i.controlDivergences}건 — Control 보존 위반 (BLOCKED 유발)`);
    return { status: 'FAIL', controlSessions: i.controlSessions, divergences: i.controlDivergences, reasons };
  }
  if (i.controlSessions < Math.max(i.minSamples, CONTROL_MIN_SAMPLES)) {
    reasons.push(`Control 표본 부족 (${i.controlSessions}/${Math.max(i.minSamples, CONTROL_MIN_SAMPLES)})`);
    return { status: 'INSUFFICIENT_DATA', controlSessions: i.controlSessions, divergences: 0, reasons };
  }
  return { status: 'PASS', controlSessions: i.controlSessions, divergences: 0, reasons: ['Control 결과 전부 기존과 동일'] };
}

// ── Treatment eligibility ──────────────────────────────────────────────────────
export function certifyTreatmentEligibility(i: TreatmentEligibilityInput): TreatmentEligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!i.approvalValid) blockers.push('승인 무효');
  if (!i.assignmentValid) blockers.push('Assignment 무효');
  if (!i.versionPinValid) blockers.push('Version Pin 무효');
  if (!i.candidateExists) blockers.push('Candidate Playlist 없음');
  if (!i.overrideActive) blockers.push('Override 비활성');
  if (!i.expiryValid) blockers.push('Expiry 무효/만료');
  if (!i.noActiveConflict) blockers.push('활성 Pilot 충돌');
  if (!i.existingFallbackAvailable) blockers.push('기존 Resolver Fallback 불가');
  if (!i.rollbackTargetExists) warnings.push('Rollback 대상 없음');
  if (!i.queueInputCompatible) warnings.push('Queue 입력 호환성 미확인');
  if (!i.trackRpcCompatible) warnings.push('Playlist Track RPC 호환성 미확인');

  const status: TreatmentEligibilityResult['status'] =
    blockers.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'REVIEW_REQUIRED' : 'READY';
  return { status, blockers, warnings };
}

// ── Fail-open ──────────────────────────────────────────────────────────────────
export function certifyFailOpen(cases: FailOpenCase[]): FailOpenResult {
  if (cases.length === 0) return { status: 'NOT_AVAILABLE', total: 0, preserved: 0, failed: [] };
  const failed = cases.filter((c) => !c.existingPreserved).map((c) => c.name);
  const preserved = cases.length - failed.length;
  const status = failed.length === 0 ? 'PASS' : 'FAIL';
  return { status, total: cases.length, preserved, failed };
}

// ── Coverage ────────────────────────────────────────────────────────────────────
export function computeCoverage(i: CoverageInput): CoverageResult {
  const notes: string[] = [];
  if (i.storeSessionsEvaluated <= 0 && i.shadowEvaluations <= 0) return { status: 'NO_DATA', signalCoverage: null, notes: ['평가 세션 없음'] };
  const denom = i.storeSessionsEvaluated || i.shadowEvaluations;
  const signalCoverage = denom > 0 ? Math.min(1, i.shadowEvaluations / denom) : null;
  let status: CoverageResult['status'];
  const n = i.shadowEvaluations;
  if (n >= Math.max(i.minSessions, SHADOW_MIN_SESSIONS)) status = 'SUFFICIENT';
  else if (n >= COVERAGE_PARTIAL_SESSIONS) status = 'PARTIAL';
  else if (n > 0) status = 'LOW';
  else status = 'INSUFFICIENT_DATA';
  if (status !== 'SUFFICIENT') notes.push(`Shadow 평가 표본 ${n} (충분 기준 ${Math.max(i.minSessions, SHADOW_MIN_SESSIONS)})`);
  if (i.resolverErrorCount > 0) notes.push(`Resolver 오류 ${i.resolverErrorCount}건`);
  return { status, signalCoverage, notes };
}

// ── Certification score ────────────────────────────────────────────────────────
function rate01(v: number | null): number | null { return v == null ? null : Math.min(1, Math.max(0, v)); }

export function computeCertification(i: CertificationInput): CertificationResult {
  const blockers: string[] = [];
  const limitations: string[] = [];

  // Hard block: any control divergence.
  if (i.control.status === 'FAIL') blockers.push('Control Divergence 발생 — Runtime Integration BLOCKED');
  if (i.failOpen.status === 'FAIL') blockers.push(`Fail-open 실패: ${i.failOpen.failed.join(', ')}`);
  if (i.resolverErrorRate != null && i.resolverErrorRate > RESOLVER_ERROR_RATE_BLOCK) blockers.push(`Resolver 오류율 ${(i.resolverErrorRate * 100).toFixed(1)}% > ${(RESOLVER_ERROR_RATE_BLOCK * 100)}%`);

  // Not enough evidence to score at all.
  const noEvidence = i.control.status === 'NOT_AVAILABLE' || i.coverage.status === 'NO_DATA'
    || (i.control.status === 'INSUFFICIENT_DATA' && i.coverage.status !== 'SUFFICIENT');
  if (noEvidence && blockers.length === 0) {
    return { status: 'INSUFFICIENT_DATA', score: null, components: {}, blockers, limitations: ['표본 부족 — 점수 산출 불가'], automated: false };
  }

  // Component scores (0..1). NO_DATA → excluded (not 0), so scarce evidence never fabricates a low score.
  const comp: Record<string, number | null> = {
    controlPreservation: i.control.status === 'PASS' ? 1 : i.control.status === 'FAIL' ? 0 : null,
    failOpenSuccess: i.failOpen.status === 'PASS' ? 1 : i.failOpen.status === 'FAIL' ? 0 : null,
    candidateAvailability: rate01(i.candidateAvailabilityRate),
    versionIntegrity: rate01(i.versionIntegrityRate),
    assignmentIntegrity: rate01(i.assignmentIntegrityRate),
    resolverErrorRate: i.resolverErrorRate == null ? null : 1 - rate01(i.resolverErrorRate)!,
    coverage: i.coverage.status === 'SUFFICIENT' ? 1 : i.coverage.status === 'PARTIAL' ? 0.6 : i.coverage.status === 'LOW' ? 0.3 : null,
    queueCompatibility: i.queueCompatible ? 1 : 0,
    rollbackReadiness: i.rollbackReady ? 1 : 0,
  };

  // Weighted score over the components that HAVE data (renormalize weights to available components).
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(CERT_WEIGHTS)) {
    const c = comp[k];
    if (c == null) { limitations.push(`${k}: 데이터 없음 → 점수 산정 제외`); continue; }
    num += c * w; den += w;
  }
  const score = den > 0 ? Math.round((num / den) * 100) : null;

  let status: CertificationResult['status'];
  if (blockers.length > 0) status = 'BLOCKED';
  else if (score == null) status = 'INSUFFICIENT_DATA';
  else if (score >= CERT_CERTIFIED_MIN) status = 'CERTIFIED';
  else if (score >= CERT_READY_WITH_WARNINGS_MIN) status = 'READY_WITH_WARNINGS';
  else if (score >= CERT_REVIEW_MIN) status = 'REVIEW_REQUIRED';
  else status = 'REVIEW_REQUIRED';

  limitations.push('점수는 참고용 — 실제 재생 성공을 보장하지 않음');
  return { status, score, components: comp, blockers, limitations, automated: false };
}

// ── Integration readiness (max READY_FOR_MANUAL_CANARY_REVIEW; never starts a canary) ──
export function computeReadiness(cert: CertificationResult, eligibility: TreatmentEligibilityResult): ReadinessResult {
  const base = { automated: false as const, actualCanaryStarted: false as const };
  const reasons: string[] = [];
  const risks: string[] = [];
  const requiredNextEvidence: string[] = [];

  if (cert.status === 'BLOCKED') {
    return { ...base, state: 'BLOCKED', reasons: cert.blockers, risks: ['Control 보존/Fail-open/Resolver 무결성 미충족'], requiredNextEvidence: ['Control Divergence 0 재확인', 'Fail-open 전량 PASS'] };
  }
  if (cert.status === 'INSUFFICIENT_DATA' || cert.score == null) {
    return { ...base, state: 'INSUFFICIENT_DATA', reasons: ['표본/증거 부족'], risks, requiredNextEvidence: ['Shadow 세션 표본 확보', 'Control 표본 확보'] };
  }
  if (eligibility.status === 'BLOCKED') {
    return { ...base, state: 'BLOCKED', reasons: eligibility.blockers, risks, requiredNextEvidence: ['Treatment Eligibility 충족'] };
  }

  if (cert.score >= READINESS_CANARY_MIN_SCORE && cert.status === 'CERTIFIED' && eligibility.status === 'READY') {
    reasons.push('Control 보존 + Fail-open + 무결성 충족, 점수 ≥ Canary 기준');
    risks.push('실제 Runtime 통합/Canary 는 이 Phase 범위 밖 — 수동 검토 필요');
    requiredNextEvidence.push('운영자 수동 Canary 검토 승인', 'Preview Runtime 수동 QA');
    return { ...base, state: 'READY_FOR_MANUAL_CANARY_REVIEW', reasons, risks, requiredNextEvidence };
  }
  if (cert.score >= READINESS_PREVIEW_MIN_SCORE) {
    reasons.push('기본 안전성 충족, 점수 ≥ Preview 기준');
    requiredNextEvidence.push('Coverage 상향', 'Preview Runtime 수동 QA');
    return { ...base, state: 'READY_FOR_PREVIEW_RUNTIME_TEST', reasons, risks, requiredNextEvidence };
  }
  return { ...base, state: 'SHADOW_ONLY', reasons: ['점수가 Preview 기준 미만 — Shadow 관찰만 지속'], risks, requiredNextEvidence: ['증거/Coverage 확보'] };
}
