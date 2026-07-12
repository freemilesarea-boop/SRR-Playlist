// AI-MUSIC-10 — Boundary sequence validator. Validates a state transition for each signal group against the
// legal transition map. An illegal transition is RECORDED only (INVALID_TRANSITION) — the observer never blocks
// the player. Session change and stale revision short-circuit. Pure & deterministic.

import type {
  SequenceResult, SequenceStatus, CrossfadeState, RecoveryState, PreloadState, AudioSwapState,
} from './types';

// Allowed next-states per state (a start from IDLE may skip an intermediate state, since observation can miss it).
const CROSSFADE: Record<CrossfadeState, CrossfadeState[]> = {
  IDLE: ['PREPARING', 'ACTIVE', 'IDLE'],
  PREPARING: ['ACTIVE', 'IDLE'],
  ACTIVE: ['COMPLETING', 'FALLBACK', 'STUCK', 'IDLE'],
  COMPLETING: ['IDLE'],
  FALLBACK: ['IDLE'],
  STUCK: ['IDLE', 'COMPLETING'],
  UNKNOWN: ['IDLE', 'PREPARING', 'ACTIVE', 'COMPLETING', 'FALLBACK', 'STUCK', 'UNKNOWN'],
};
const RECOVERY: Record<RecoveryState, RecoveryState[]> = {
  IDLE: ['DETECTED', 'ATTEMPTING', 'IDLE'],
  DETECTED: ['ATTEMPTING', 'IDLE'],
  ATTEMPTING: ['RECOVERED', 'FAILED'],
  RECOVERED: ['IDLE'],
  FAILED: ['IDLE', 'ATTEMPTING'],
  UNKNOWN: ['IDLE', 'DETECTED', 'ATTEMPTING', 'RECOVERED', 'FAILED', 'UNKNOWN'],
};
const PRELOAD: Record<PreloadState, PreloadState[]> = {
  IDLE: ['REQUESTED', 'LOADING', 'IDLE'],
  REQUESTED: ['LOADING', 'CANCELLED', 'FAILED'],
  LOADING: ['READY', 'FAILED', 'CANCELLED'],
  READY: ['IDLE', 'CANCELLED'],
  FAILED: ['IDLE'],
  CANCELLED: ['IDLE'],
  UNKNOWN: ['IDLE', 'REQUESTED', 'LOADING', 'READY', 'FAILED', 'CANCELLED', 'UNKNOWN'],
};
const AUDIO_SWAP: Record<AudioSwapState, AudioSwapState[]> = {
  IDLE: ['PREPARING', 'SWAPPING', 'IDLE'],
  PREPARING: ['SWAPPING', 'IDLE', 'FAILED'],
  SWAPPING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['IDLE'],
  FAILED: ['IDLE'],
  UNKNOWN: ['IDLE', 'PREPARING', 'SWAPPING', 'COMPLETED', 'FAILED', 'UNKNOWN'],
};

const MAPS = { crossfade: CROSSFADE, recovery: RECOVERY, preload: PRELOAD, audioSwap: AUDIO_SWAP } as const;

export interface SequenceInput {
  kind: 'crossfade' | 'recovery' | 'preload' | 'audioSwap';
  from: string | null;
  to: string;
  sameSession: boolean;
  staleRevision: boolean;
}

export function validateTransition(i: SequenceInput): SequenceResult {
  const mk = (status: SequenceStatus, reason: string): SequenceResult => ({ status, reasons: [reason] });
  if (!i.sameSession) return mk('SESSION_CHANGED', 'Session 변경 중 전이');
  if (i.staleRevision) return mk('STALE_TRANSITION', '오래된 Revision 전이');
  if (i.from == null) return mk('INSUFFICIENT_DATA', '이전 상태 없음');
  const map = MAPS[i.kind] as Record<string, string[]>;
  const allowed = map[i.from];
  if (allowed == null) return mk('INSUFFICIENT_DATA', `알 수 없는 이전 상태 ${i.from}`);
  if (allowed.includes(i.to)) return mk('VALID', `${i.from} → ${i.to}`);
  return mk('INVALID_TRANSITION', `허용되지 않은 전이 ${i.from} → ${i.to}`);
}
