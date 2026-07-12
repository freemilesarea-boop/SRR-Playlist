// AI-MUSIC-10 — Runtime boundary evidence (low-frequency, hash-only, redacted). Records session/store HASHES,
// state, reason, revision, and a duration bucket — and NEVER a track title, artist, audio URL, signed URL, raw
// queue, raw error, token, or PII. Redaction is encoded as literal `false` flags on every event. In-memory /
// admin-harness first (no DB this phase). Pure & deterministic (no clock — nowMs passed in).

export type BoundaryEvidenceKind =
  | 'boundary_snapshot' | 'crossfade_state_changed' | 'recovery_state_changed' | 'preload_state_changed'
  | 'audio_swap_state_changed' | 'safe_boundary_detected' | 'boundary_blocked' | 'stale_event_dropped'
  | 'observer_error';

export interface BoundaryEvidence {
  kind: BoundaryEvidenceKind;
  sessionHash: string | null;
  storeHash: string | null;
  state: string;
  reason: string;
  revision: number;
  durationBucket: string;
  createdAtMs: number;
  containsTrackTitle: false;
  containsArtist: false;
  containsAudioUrl: false;
  containsSignedUrl: false;
  containsRawQueue: false;
  containsRawError: false;
  containsToken: false;
  containsPii: false;
}

export interface BoundaryEvidenceInput {
  kind: BoundaryEvidenceKind;
  sessionHash: string | null;
  storeHash: string | null;
  state: string;
  reason: string;
  revision: number;
  durationMs: number;
  nowMs: number;
}

function durationBucket(ms: number): string {
  if (ms < 5) return '<5ms';
  if (ms < 20) return '5-20ms';
  if (ms < 100) return '20-100ms';
  if (ms < 1000) return '100ms-1s';
  return '>=1s';
}

export function buildBoundaryEvidence(i: BoundaryEvidenceInput): BoundaryEvidence {
  return {
    kind: i.kind,
    sessionHash: i.sessionHash,
    storeHash: i.storeHash,
    state: i.state,
    reason: i.reason,
    revision: i.revision,
    durationBucket: durationBucket(i.durationMs),
    createdAtMs: i.nowMs,
    containsTrackTitle: false, containsArtist: false, containsAudioUrl: false, containsSignedUrl: false,
    containsRawQueue: false, containsRawError: false, containsToken: false, containsPii: false,
  };
}
