// AI-MUSIC-9 — Runtime evidence builder. Low-frequency, hash-only, redacted. It records store/session/deployment
// /playlist/queue/current-track HASHES, boundary, result, reason code, and a duration bucket — and NEVER an
// audio URL, track title, artist, raw queue, raw error stack, token, signed URL, or any PII. The redaction
// guarantee is encoded as literal `false` flags on every event. Pure & deterministic (no clock; nowMs passed in).

import type { RuntimeEvidence, EvidenceKind, BoundaryStateKnown } from './types';

export interface EvidenceInput {
  kind: EvidenceKind;
  storeHash: string;
  sessionHash: string;
  deploymentHash: string;
  existingPlaylistHash: string | null;
  candidatePlaylistHash: string | null;
  queueHashBefore: string | null;
  queueHashAfter: string | null;
  currentTrackHash: string | null;
  boundary: BoundaryStateKnown | null;
  result: string;
  reasonCode: string;
  durationMs: number;
  nowMs: number;
}

function durationBucket(ms: number): string {
  if (ms < 5) return '<5ms';
  if (ms < 20) return '5-20ms';
  if (ms < 50) return '20-50ms';
  if (ms < 100) return '50-100ms';
  return '>=100ms';
}

export function buildEvidence(i: EvidenceInput): RuntimeEvidence {
  return {
    kind: i.kind,
    storeHash: i.storeHash,
    sessionHash: i.sessionHash,
    deploymentHash: i.deploymentHash,
    existingPlaylistHash: i.existingPlaylistHash,
    candidatePlaylistHash: i.candidatePlaylistHash,
    queueHashBefore: i.queueHashBefore,
    queueHashAfter: i.queueHashAfter,
    currentTrackHash: i.currentTrackHash,
    boundary: i.boundary,
    result: i.result,
    reasonCode: i.reasonCode,
    durationBucket: durationBucket(i.durationMs),
    createdAtMs: i.nowMs,
    containsAudioUrl: false,
    containsTrackTitle: false,
    containsArtist: false,
    containsRawQueue: false,
    containsRawError: false,
    containsToken: false,
    containsPii: false,
  };
}
