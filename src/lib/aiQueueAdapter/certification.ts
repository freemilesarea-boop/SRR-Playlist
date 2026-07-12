// AI-MUSIC-8 — Queue adapter certification + preview-hook readiness. Rule-based & deterministic. A failing
// current-track or playback-state preservation, a control divergence, or a fail-open failure caps at BLOCKED.
// The advisory score is capped and never means "production ready". Certification reaches at most
// READY_FOR_ISOLATED_PREVIEW_HOOK; NO runtime hook is implemented this phase (runtimeHookImplemented:false).

import { CERT_WEIGHTS, CERT_PURE_HARNESS_MIN, CERT_PREVIEW_HOOK_MIN, MIN_SCENARIOS } from './thresholds';
import type { AdapterCertInput, AdapterCertResult, PreviewHookReadinessResult } from './types';

export function computeAdapterCertification(i: AdapterCertInput): AdapterCertResult {
  const blockers: string[] = [];
  const limitations: string[] = [];

  if (!i.currentTrackPreservationPass) blockers.push('Current Track Preservation 실패');
  if (!i.playbackStatePreservationPass) blockers.push('Playback State Preservation 실패');
  if (!i.controlPreservationPass) blockers.push('Control Preservation 실패');
  if (!i.failOpenPass) blockers.push('Fail-open 실패');
  if (!i.killSwitchPass) blockers.push('Kill Switch 실패');

  if (i.scenariosRun <= 0) {
    return { status: 'INSUFFICIENT_DATA', score: null, components: {}, blockers, limitations: ['Scenario 미실행'], automated: false };
  }
  const thin = i.scenariosRun < Math.max(i.minScenarios, MIN_SCENARIOS);

  const comp: Record<string, number | null> = {
    currentTrackPreservation: i.currentTrackPreservationPass ? 1 : 0,
    playbackStatePreservation: i.playbackStatePreservationPass ? 1 : 0,
    boundarySafety: i.boundarySafetyProven ? 1 : 0,
    staleProtection: i.staleProtectionPass ? 1 : 0,
    idempotency: i.idempotencyPass ? 1 : 0,
    resolverRaceSafety: i.resolverRaceSafe ? 1 : 0,
    controlPreservation: i.controlPreservationPass ? 1 : 0,
    failOpen: i.failOpenPass ? 1 : 0,
    killSwitch: i.killSwitchPass ? 1 : 0,
  };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(CERT_WEIGHTS)) { const c = comp[k]; if (c == null) continue; num += c * w; den += w; }
  const score = den > 0 ? Math.round((num / den) * 100) : null;

  let status: AdapterCertResult['status'];
  if (blockers.length > 0) status = 'BLOCKED';
  else if (thin || score == null) { status = 'INSUFFICIENT_DATA'; limitations.push(`Scenario 표본 부족 (${i.scenariosRun}/${Math.max(i.minScenarios, MIN_SCENARIOS)})`); }
  else if (score >= CERT_PREVIEW_HOOK_MIN && i.queuePlaybackSeparationDesigned && i.boundarySafetyProven) status = 'READY_FOR_ISOLATED_PREVIEW_HOOK';
  else if (score >= CERT_PURE_HARNESS_MIN) status = 'CERTIFIED_FOR_PURE_HARNESS';
  else status = 'REVIEW_REQUIRED';

  limitations.push('Pure Harness 인증 — 실제 Preview Runtime 적용 아님. 다음 Phase Change Request 대상.');
  return { status, score, components: comp, blockers, limitations, automated: false };
}

export function computePreviewHookReadiness(cert: AdapterCertResult): PreviewHookReadinessResult {
  const base = { automated: false as const, runtimeHookImplemented: false as const };
  const evidence: string[] = [];
  const risks = ['이번 Phase 는 Runtime Hook 을 구현하지 않음 — 격리 Preview Hook 은 다음 Phase Change Request 대상'];
  const nextRequiredAction: string[] = [];

  if (cert.status === 'BLOCKED') return { ...base, state: 'BLOCKED', evidence: cert.blockers, risks, nextRequiredAction: ['Preservation/Control/Fail-open 재확보'] };
  if (cert.status === 'INSUFFICIENT_DATA' || cert.score == null) return { ...base, state: 'INSUFFICIENT_DATA', evidence: ['Scenario 부족'], risks, nextRequiredAction: ['Synthetic Scenario 확대'] };
  if (cert.status === 'READY_FOR_ISOLATED_PREVIEW_HOOK') {
    evidence.push('Current Track/Playback 보존 + Boundary 안전 + Stale/Race 방지 + Control 보존 충족');
    nextRequiredAction.push('격리 Preview Hook Change Request', '내부 Test Store + Preview Migration 준비');
    return { ...base, state: 'READY_FOR_ISOLATED_PREVIEW_HOOK', evidence, risks, nextRequiredAction };
  }
  if (cert.status === 'CERTIFIED_FOR_PURE_HARNESS') {
    evidence.push('Pure Harness 인증 — 실제 Hook 준비 전');
    nextRequiredAction.push('Boundary 관측성 향상 / Queue-Playback 분리 설계 보강');
    return { ...base, state: 'PURE_HARNESS_ONLY', evidence, risks, nextRequiredAction };
  }
  return { ...base, state: 'NOT_READY', evidence: ['점수 미달'], risks, nextRequiredAction: ['증거 보강'] };
}
