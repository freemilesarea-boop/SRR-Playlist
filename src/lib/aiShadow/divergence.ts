// AI-MUSIC-6 — Divergence classification. Compares the (authoritative) existing resolution against the shadow
// resolution and classifies the difference. The real playback ALWAYS uses the existing result — this only
// labels the comparison. Treatment candidate differences are EXPECTED; any Control difference is CRITICAL; a
// shadow failure that fell open to the existing result is a fail-open success (runtime-safe) but may be a
// certification risk.

import { DIVERGENCE_SEVERITY } from './thresholds';
import type { ExistingResolution, ShadowResolution, DivergenceResult, DivergenceType } from './types';

export function classifyDivergence(
  existing: ExistingResolution,
  shadow: ShadowResolution,
  group: 'control' | 'treatment' | null,
): DivergenceResult {
  const same = existing.selectedPlaylistId === shadow.selectedPlaylistId
    && existing.selectionSource === shadow.selectionSource;

  let type: DivergenceType;
  let certificationRisk = false;

  if (shadow.reasonCode === 'RESOLVER_ERROR') {
    // Shadow errored → it fell open to existing. Runtime-safe, but a certification risk to record.
    type = 'RESOLVER_ERROR';
    certificationRisk = true;
  } else if (group === 'control' && !same) {
    // A control store must NEVER differ. Any difference is critical.
    type = 'UNEXPECTED_CONTROL_DIVERGENCE';
    certificationRisk = true;
  } else if (group === 'treatment' && shadow.reasonCode === 'OVERRIDE_APPLIED') {
    // Treatment applied the approved candidate → this difference is intended.
    type = 'EXPECTED_TREATMENT_DIVERGENCE';
  } else if (shadow.reasonCode === 'VERSION_MISMATCH') {
    // The shadow tried the override but the pin mismatched → fell open. Surfaced even though the playlist matches.
    type = 'VERSION_MISMATCH'; certificationRisk = true;
  } else if (shadow.reasonCode === 'CANDIDATE_MISSING') {
    type = 'CANDIDATE_MISSING'; certificationRisk = true;
  } else if (shadow.reasonCode === 'ASSIGNMENT_CONFLICT') {
    type = 'ASSIGNMENT_CONFLICT'; certificationRisk = true;
  } else if (shadow.reasonCode === 'OVERRIDE_EXPIRED') {
    type = 'EXPIRED_OVERRIDE';
  } else if (same) {
    type = 'SAME_RESULT';
  } else if (existing.selectionSource !== shadow.selectionSource) {
    // Different non-override source (e.g. fallback vs schedule) with no clear pilot reason.
    type = existing.selectionSource === 'FALLBACK' || shadow.selectionSource === 'FALLBACK'
      ? 'POLICY_CONFLICT' : 'SCHEDULE_CONFLICT';
    certificationRisk = true;
  } else {
    type = 'UNKNOWN'; certificationRisk = true;
  }

  const severity = DIVERGENCE_SEVERITY[type] ?? 'WARNING';
  // Fail-open success = shadow fell open to (or matched) the existing result — the real playlist is unchanged.
  const failOpenSuccess = shadow.fallbackUsed || same || type === 'RESOLVER_ERROR';

  return {
    type, severity, failOpenSuccess, certificationRisk,
    actualPlaylistUnchanged: true,
    reason: reasonFor(type, existing, shadow),
  };
}

function reasonFor(type: DivergenceType, existing: ExistingResolution, shadow: ShadowResolution): string {
  switch (type) {
    case 'SAME_RESULT': return '기존/Shadow 결과 동일 — 차이 없음';
    case 'EXPECTED_TREATMENT_DIVERGENCE': return 'Treatment Candidate 적용으로 인한 의도된 차이 (Expected)';
    case 'UNEXPECTED_CONTROL_DIVERGENCE': return 'Control Store 결과 차이 — Critical (Control 보존 위반)';
    case 'VERSION_MISMATCH': return `Version Pin 불일치 → 기존 결과 유지 (${existing.selectionSource})`;
    case 'CANDIDATE_MISSING': return 'Candidate Playlist 없음 → 기존 결과로 Fail-open';
    case 'ASSIGNMENT_CONFLICT': return 'Assignment 충돌 → 기존 결과 유지';
    case 'EXPIRED_OVERRIDE': return 'Override 만료 → 기존 결과 유지';
    case 'RESOLVER_ERROR': return 'Shadow Resolver 오류 → 기존 결과 유지 (Runtime Safe, Certification Risk)';
    case 'POLICY_CONFLICT': return `Policy/Fallback 소스 차이 (${existing.selectionSource} vs ${shadow.selectionSource})`;
    case 'SCHEDULE_CONFLICT': return `Schedule 소스 차이 (${existing.selectionSource} vs ${shadow.selectionSource})`;
    default: return '분류 불가 — 조사 필요';
  }
}
