// AI-MUSIC-7 — Preview runtime certification + production readiness recommendation. Rule-based & deterministic.
// A single control divergence, an unenforced environment, or a fail-open failure caps certification at BLOCKED.
// The score is advisory (capped low — internal preview only) and NEVER means "production ready". Below the
// evidence floor → INSUFFICIENT_DATA / NOT_RUN. Production readiness maxes at
// READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST — this phase never runs a production canary.

import { CERT_WEIGHTS, CERT_INTERNAL_MIN, CERT_READY_WITH_WARNINGS_MIN, CANARY_MIN_EVIDENCE_SESSIONS } from './thresholds';
import type { PreviewCertInput, PreviewCertResult, ProductionReadinessResult } from './types';

export function computePreviewCertification(i: PreviewCertInput): PreviewCertResult {
  const blockers: string[] = [];
  const limitations: string[] = [];

  if (i.envGate.status !== 'ENFORCED') blockers.push('Environment Enforcement 미충족 (ENFORCED 아님)');
  if (i.controlDivergences > 0) blockers.push('Control Divergence 발생 → BLOCKED');
  if (!i.failOpenSuccess) blockers.push('Fail-open 실패');
  if (i.guardrail.status === 'BLOCKED') blockers.push('Playback Guardrail BLOCKED');
  if (!i.allowlistIntegrity) blockers.push('Allowlist Integrity 미충족');
  if (!i.approvalIntegrity) blockers.push('Approval Integrity 미충족');

  // Not run / no evidence.
  if (i.evidenceSessions <= 0 && i.safeBoundaryApplied == null) {
    return { status: 'NOT_RUN', score: null, components: {}, blockers, limitations: ['Runtime Canary 미실행 — Preview Resolver/Validation 까지만'], automated: false };
  }
  const thin = i.evidenceSessions < Math.max(i.minEvidenceSessions, CANARY_MIN_EVIDENCE_SESSIONS);

  const comp: Record<string, number | null> = {
    environmentEnforcement: i.envGate.status === 'ENFORCED' ? 1 : 0,
    controlPreservation: i.controlDivergences === 0 ? 1 : 0,
    approvalIntegrity: i.approvalIntegrity ? 1 : 0,
    candidateQueueValidity: i.candidateQueueValid ? 1 : 0,
    versionIntegrity: i.versionIntegrity ? 1 : 0,
    snapshotIntegrity: i.snapshotIntegrity ? 1 : 0,
    failOpenSuccess: i.failOpenSuccess ? 1 : 0,
    playbackGuardrails: i.guardrail.status === 'PASS' ? 1 : i.guardrail.status === 'WARNING' ? 0.6 : i.guardrail.status === 'NOT_AVAILABLE' || i.guardrail.status === 'INSUFFICIENT_DATA' ? null : 0,
    manualDisable: i.manualDisableVerified ? 1 : 0,
    rollbackReadiness: i.rollbackReady ? 1 : 0,
  };

  // Weighted score over components that have data (renormalize). NO_DATA excluded, not zeroed.
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(CERT_WEIGHTS)) {
    const c = comp[k];
    if (c == null) { limitations.push(`${k}: 데이터 없음 → 점수 산정 제외`); continue; }
    num += c * w; den += w;
  }
  const score = den > 0 ? Math.round((num / den) * 100) : null;

  let status: PreviewCertResult['status'];
  if (blockers.length > 0) status = 'BLOCKED';
  else if (thin || score == null) { status = 'INSUFFICIENT_DATA'; limitations.push(`Evidence 표본 부족 (${i.evidenceSessions}/${Math.max(i.minEvidenceSessions, CANARY_MIN_EVIDENCE_SESSIONS)})`); }
  else if (score >= CERT_INTERNAL_MIN) status = 'CERTIFIED_FOR_INTERNAL_PREVIEW';
  else if (score >= CERT_READY_WITH_WARNINGS_MIN) status = 'READY_WITH_WARNINGS';
  else status = 'REVIEW_REQUIRED';

  limitations.push('내부 Preview 전용 인증 — "Production Ready" 아님. 점수는 참고용이며 실제 프로덕션 재생 성공을 보장하지 않음.');
  return { status, score, components: comp, blockers, limitations, automated: false };
}

export function computeProductionReadiness(cert: PreviewCertResult, multiStoreEvidence: boolean): ProductionReadinessResult {
  const base = { automated: false as const, actualProductionCanary: false as const };
  const reasons: string[] = [];
  const requiredEvidence: string[] = [];
  const risks = ['실제 Production Canary 는 이 Phase 범위 밖 — 별도 Change Request 필요'];

  if (cert.status === 'BLOCKED') return { ...base, state: 'BLOCKED', reasons: cert.blockers, requiredEvidence: ['Control Divergence 0', 'Environment ENFORCED', 'Fail-open PASS'], risks };
  if (cert.status === 'NOT_RUN' || cert.status === 'INSUFFICIENT_DATA' || cert.score == null) {
    return { ...base, state: 'INSUFFICIENT_DATA', reasons: ['Runtime Evidence 부족/미실행'], requiredEvidence: ['내부 Test Store Preview Runtime 증거 확보'], risks };
  }
  if (cert.status === 'REVIEW_REQUIRED') return { ...base, state: 'MORE_PREVIEW_EVIDENCE_REQUIRED', reasons: ['점수 미달 — 추가 Preview 증거 필요'], requiredEvidence: ['Preview 증거 확대'], risks };

  // CERTIFIED_FOR_INTERNAL_PREVIEW or READY_WITH_WARNINGS
  if (cert.status === 'CERTIFIED_FOR_INTERNAL_PREVIEW' && multiStoreEvidence) {
    reasons.push('단일 내부 Store 인증 + 다중 Store Preview 증거 확보');
    requiredEvidence.push('운영자 Production Canary Change Request 검토');
    return { ...base, state: 'READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST', reasons, requiredEvidence, risks };
  }
  reasons.push('단일 내부 Store 인증 — 다중 Store Preview 증거 필요');
  requiredEvidence.push('추가 내부 Test Store Preview 실행');
  return { ...base, state: 'READY_FOR_INTERNAL_MULTI_STORE_PREVIEW', reasons, requiredEvidence, risks };
}
