// AI-MUSIC-5 — Immutable Assignment Snapshot. When an operator approves & manually sets up a pilot, each
// Store↔Group↔Candidate(version)↔Previous-playlist binding is frozen into a snapshot with a stable,
// deterministic hash. The hash is NOT cryptographic randomness (engines must be deterministic — no crypto
// random, no Date.now here); it is a stable FNV-1a fold over the canonical field string so any later mutation
// of an immutable field is detectable. This layer records the binding ONLY — it never deploys a playlist.

import { IMMUTABLE_ASSIGNMENT_FIELDS } from './types';
import type { AssignmentSnapshotInput, AssignmentSnapshot, ImmutabilityCheck } from './types';

// Deterministic 32-bit FNV-1a → hex. Stable across runs/processes (no randomness, no clock).
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Canonical, order-fixed serialization of the fields that define the assignment's identity.
function canonical(input: AssignmentSnapshotInput): string {
  return [
    input.experimentId,
    input.storeId,
    input.group,
    input.candidatePlaylistId ?? 'null',
    input.candidateVersion ?? 'null',
    input.previousPlaylistId ?? 'null',
    input.previousPlaylistVersion ?? 'null',
    input.scheduledStart ?? 'null',
    input.scheduledEnd ?? 'null',
    input.expiry ?? 'null',
    input.rollbackTarget ?? 'null',
    input.snapshotVersion,
  ].join('|');
}

export function buildAssignmentSnapshot(input: AssignmentSnapshotInput): AssignmentSnapshot {
  // Control stores never carry a candidate playlist/version — enforce here so a control snapshot can never
  // encode a treatment override.
  const normalized: AssignmentSnapshotInput = input.group === 'control'
    ? { ...input, candidatePlaylistId: null, candidateVersion: null }
    : input;
  return { ...normalized, assignmentHash: stableHash(canonical(normalized)) };
}

// Compares a stored snapshot against a re-derived one and reports which immutable fields changed. Any change
// (including a hash mismatch) means the assignment was tampered with and must be REJECTED by the caller.
export function verifyImmutable(original: AssignmentSnapshot, candidate: AssignmentSnapshot): ImmutabilityCheck {
  const changed: string[] = [];
  for (const field of IMMUTABLE_ASSIGNMENT_FIELDS) {
    if (original[field] !== candidate[field]) changed.push(field);
  }
  // Re-derive the hash from the candidate's own fields; a forged hash that doesn't match its content fails too.
  const rederived = stableHash(canonical(candidate));
  if (rederived !== candidate.assignmentHash && !changed.includes('assignmentHash')) {
    changed.push('assignmentHash');
  }
  return { ok: changed.length === 0, changed };
}
