// AI-MUSIC-6 — Shadow Decision Event builder. Produces a low-frequency, PRIVACY-SAFE event from a shadow
// evaluation: only stable hashes of ids (store/session/playlist) — never titles, track lists, audio URLs,
// artist names, user PII, raw error stacks, raw queries, or tokens. Deterministic (no randomness, no clock in
// the hash). The event is for analysis/dashboard only and is never used for playback.

import type { ExistingResolution, ShadowResolution, DivergenceResult, ShadowResolverInput, ShadowDecisionEvent } from './types';

// Deterministic 32-bit FNV-1a → hex (same family as the AI-MUSIC-5 assignment hash). Stable across runs.
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function hashOrNull(v: string | null | undefined): string | null { return v ? stableHash(v) : null; }

export function buildShadowEvent(
  input: ShadowResolverInput,
  shadow: ShadowResolution,
  divergence: DivergenceResult,
  sessionToken: string,
): ShadowDecisionEvent {
  const existing: ExistingResolution = input.existing;
  return {
    storeIdHash: stableHash(input.storeId),
    sessionHash: stableHash(sessionToken),
    existingPlaylistHash: hashOrNull(existing.selectedPlaylistId),
    shadowPlaylistHash: hashOrNull(shadow.selectedPlaylistId),
    existingSource: existing.selectionSource,
    shadowSource: shadow.selectionSource,
    divergenceType: divergence.type,
    experimentId: input.experimentId,
    pilotRunId: input.pilotRunId,
    assignmentId: input.assignmentId,
    candidateVersion: input.candidateVersion,
    reasonCode: shadow.reasonCode,
    evaluatedAt: input.resolvedAt,
  };
}

// Map a divergence type to its decision-event name (for the low-frequency event stream).
export function eventName(d: DivergenceResult, shadow: ShadowResolution): string {
  if (shadow.reasonCode === 'RESOLVER_ERROR') return 'shadow_resolution_error';
  if (shadow.reasonCode === 'OVERRIDE_APPLIED') return 'shadow_override_eligible';
  if (shadow.reasonCode === 'CONTROL_PRESERVED') return 'shadow_control_preserved';
  if (shadow.reasonCode === 'CANDIDATE_MISSING') return 'shadow_candidate_missing';
  if (shadow.reasonCode === 'VERSION_MISMATCH') return 'shadow_version_mismatch';
  if (shadow.reasonCode === 'ASSIGNMENT_CONFLICT') return 'shadow_assignment_conflict';
  if (shadow.reasonCode === 'OVERRIDE_EXPIRED') return 'shadow_override_expired';
  if (d.type !== 'SAME_RESULT' && d.severity !== 'NONE') return 'shadow_divergence_detected';
  if (d.failOpenSuccess && shadow.fallbackUsed) return 'shadow_fallback_used';
  return 'shadow_resolution_evaluated';
}
