// AI-MUSIC-9 — Single-store runtime certification + production-CR readiness. Rule-based & deterministic. The
// decisive rule: without REAL single-store runtime evidence (which does NOT exist this phase — the hook is
// DEFERRED), certification is NOT_RUN and production-CR readiness is NOT_RUN. Even with evidence, a failed
// preservation / control / fail-open / kill-switch / rollback caps at BLOCKED, and the top status is only
// CERTIFIED_FOR_SINGLE_INTERNAL_STORE — never "production ready". A production canary is never run here.

import { RUNTIME_CERT_WEIGHTS } from './thresholds';
import type {
  SingleStoreCertInput, SingleStoreCertResult, SingleStoreCertStatus,
  ProductionCrReadinessResult, ProductionCrReadinessStatus,
} from './types';

export function computeSingleStoreCertification(i: SingleStoreCertInput): SingleStoreCertResult {
  const limitations = ['Single Internal Store 인증 — Production Ready 아님. Multi-session/Production Canary 는 다음 Change Request 대상.'];

  // No real runtime evidence → NOT_RUN (this phase). Never a false PASS.
  if (!i.runtimeEvidencePresent) {
    return { status: 'NOT_RUN', evidence: [], blockers: [], limitations: ['Runtime Hook DEFERRED — 실제 단일 Store Runtime 증거 없음 (NOT_RUN)', ...limitations], automated: false };
  }

  const blockers: string[] = [];
  if (!i.currentTrackPreserved) blockers.push('Current Track Preservation 실패');
  if (!i.playbackStatePreserved) blockers.push('Playback State Preservation 실패');
  if (!i.existingQueueFailOpen) blockers.push('Existing Queue Fail-open 실패');
  if (!i.killSwitchProven) blockers.push('Kill Switch 미증명');
  if (!i.controlStoreUnchanged) blockers.push('Control Store 변경됨');
  if (!i.noDoublePlayback) blockers.push('Double Playback 발생');
  if (!i.noUnexpectedPause) blockers.push('Unexpected Pause 발생');
  if (!i.noQueueEmpty) blockers.push('Queue Empty 발생');
  if (!i.noRuntimeError) blockers.push('Runtime Error 발생');

  const gate = i.previewEnvironmentConfirmed && i.deploymentMatch && i.storeAllowlistMatch && i.singleSession
    && i.candidateVersionMatch && i.snapshotHashMatch;
  if (!gate) blockers.push('환경/Deployment/Allowlist/Session/Version/Snapshot Gate 미충족');

  const comp: Record<string, boolean> = {
    currentTrackPreserved: i.currentTrackPreserved,
    playbackStatePreserved: i.playbackStatePreserved,
    safeBoundaryConfirmed: i.safeBoundaryConfirmed,
    existingQueueFailOpen: i.existingQueueFailOpen,
    killSwitchProven: i.killSwitchProven,
    manualRollbackProven: i.manualRollbackProven,
    controlStoreUnchanged: i.controlStoreUnchanged,
    noDoublePlayback: i.noDoublePlayback,
    noUnexpectedPause: i.noUnexpectedPause,
    noQueueEmpty: i.noQueueEmpty,
    noRuntimeError: i.noRuntimeError,
  };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(RUNTIME_CERT_WEIGHTS)) { den += w; if (comp[k]) num += w; }
  const score = den > 0 ? Math.round((num / den) * 100) : 0;

  const evidence = Object.entries(comp).filter(([, v]) => v).map(([k]) => k);

  let status: SingleStoreCertStatus;
  if (blockers.length > 0) status = 'BLOCKED';
  else if (score >= 100 && i.manualRollbackProven && i.safeBoundaryConfirmed) status = 'CERTIFIED_FOR_SINGLE_INTERNAL_STORE';
  else if (score >= 80) status = 'READY_WITH_WARNINGS';
  else status = 'REVIEW_REQUIRED';

  return { status, evidence, blockers, limitations, automated: false };
}

export function computeProductionCrReadiness(cert: SingleStoreCertResult): ProductionCrReadinessResult {
  const base = { actualProductionCanaryRun: false as const, automated: false as const };
  const mk = (status: ProductionCrReadinessStatus, reasons: string[], evidenceRequired: string[]): ProductionCrReadinessResult => ({ status, reasons, evidenceRequired, ...base });

  if (cert.status === 'NOT_RUN') {
    return mk('NOT_RUN', ['단일 Store Runtime 인증 NOT_RUN — Hook DEFERRED'], ['격리 Preview Hook Change Request', '내부 Test Store + Preview Migration 적용', '단일 Store Runtime 증거']);
  }
  if (cert.status === 'BLOCKED') return mk('BLOCKED', ['단일 Store 인증 BLOCKED'], ['Preservation/Control/Fail-open/Kill Switch 재확보']);
  if (cert.status === 'CERTIFIED_FOR_SINGLE_INTERNAL_STORE') {
    return mk('MORE_SINGLE_STORE_EVIDENCE_REQUIRED', ['단일 Store 인증 완료 — 반복/장기 증거 필요'], ['다회 세션 반복 증거', 'Multi-session 내부 Preview 계획']);
  }
  if (cert.status === 'READY_WITH_WARNINGS') return mk('MORE_SINGLE_STORE_EVIDENCE_REQUIRED', ['경고와 함께 준비 — 추가 증거 필요'], ['경고 항목 해소 증거']);
  return mk('NOT_READY', ['증거 부족'], ['단일 Store 인증 재수행']);
}
