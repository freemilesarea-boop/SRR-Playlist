// WEB-OBS-8 — Playback / Store / Fleet replay. Turns PII-free event rows (Store replay) or per-bucket
// fleet snapshots (Fleet replay) into an ordered, human-readable timeline the operator can follow. No
// track title / URL / user id — only event types, hashes, codes and bucket counts. Bounded step count.

import { REPLAY_MAX_STEPS } from './thresholds';
import type { SqEventRow, ReplayStep, ReplayKind, PlaybackReplay, FleetSnapshot, FleetReplay } from './types';

const MEDIA_LABEL: Record<number, string> = { 0: 'UNKNOWN', 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };

function mapEvent(e: SqEventRow): ReplayStep {
  const at = e.receivedAt;
  const sid = e.sessionId;
  switch (e.eventType) {
    case 'first_progress':
      return { at, kind: 'progress', label: 'Playing', detail: e.durationMs != null ? `TTFA_APPROX ${e.durationMs}ms (요청→최초 진행)` : '최초 진행', sessionId: sid, severity: 'good' };
    case 'crossfade_completed':
      return { at, kind: 'crossfade', label: 'Crossfade', detail: '전환 완료', sessionId: sid, severity: 'good' };
    case 'crossfade_fallback':
      return { at, kind: 'crossfade', label: 'Crossfade Fallback', detail: 'safety_timeout 경로', sessionId: sid, severity: 'warn' };
    case 'crossfade_aborted':
      return { at, kind: 'crossfade', label: 'Crossfade Aborted', detail: e.reason ?? '중단', sessionId: sid, severity: 'warn' };
    case 'preload_ready':
      return { at, kind: 'preload', label: 'Preload Ready', detail: e.durationMs != null ? `${e.durationMs}ms` : '준비 완료', sessionId: sid, severity: 'info' };
    case 'preload_failed':
      return { at, kind: 'preload', label: 'Preload Failed', detail: e.mediaCode != null ? MEDIA_LABEL[e.mediaCode] ?? String(e.mediaCode) : '실패', sessionId: sid, severity: 'warn' };
    case 'media_error':
      return { at, kind: 'error', label: 'Media Error', detail: `${e.mediaCode != null ? MEDIA_LABEL[e.mediaCode] ?? e.mediaCode : '?'} · net=${e.networkState ?? '?'} ready=${e.readyState ?? '?'}`, sessionId: sid, severity: 'error' };
    case 'recovery_attempted':
      return { at, kind: 'recovery', label: 'Recovery', detail: e.reason ?? '복구 시도', sessionId: sid, severity: 'warn' };
    case 'recovery_succeeded':
      return { at, kind: 'recovered', label: 'Recovered', detail: e.reason ?? '복구 성공', sessionId: sid, severity: 'good' };
    case 'recovery_failed':
      return { at, kind: 'recovery', label: 'Recovery Failed', detail: e.reason ?? '복구 실패', sessionId: sid, severity: 'error' };
    default:
      return { at, kind: 'progress', label: e.eventType, detail: e.reason ?? '', sessionId: sid, severity: 'info' };
  }
}

/** Build a per-store (or per-session) playback replay from ordered event rows. */
export function buildPlaybackReplay(scope: string, rows: SqEventRow[]): PlaybackReplay {
  const ordered = [...rows].sort((a, b) => (a.receivedAt.localeCompare(b.receivedAt)) || (a.occurredAt - b.occurredAt));
  const truncated = ordered.length > REPLAY_MAX_STEPS;
  const steps = ordered.slice(0, REPLAY_MAX_STEPS).map(mapEvent);
  return { scope, steps, truncated };
}

function snapshotStep(s: FleetSnapshot): ReplayStep {
  const problems = s.waiting + s.recovering + s.error;
  const kind: ReplayKind = 'fleet-snapshot';
  const severity = s.error > 0 ? 'error' : problems > 0 ? 'warn' : 'good';
  const parts = [`${s.healthy} Healthy`];
  if (s.waiting) parts.push(`${s.waiting} Waiting`);
  if (s.recovering) parts.push(`${s.recovering} Recovering`);
  if (s.error) parts.push(`${s.error} Error`);
  return { at: s.bucketStart, kind, label: `${s.total} Store`, detail: parts.join(' · '), severity };
}

/** Build a fleet replay from time-ordered fleet snapshots (one per bucket). */
export function buildFleetReplay(snapshots: FleetSnapshot[]): FleetReplay {
  const ordered = [...snapshots].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
  const truncated = ordered.length > REPLAY_MAX_STEPS;
  const capped = ordered.slice(0, REPLAY_MAX_STEPS);
  return { steps: capped.map(snapshotStep), snapshots: capped, truncated };
}
