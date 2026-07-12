// AI-MUSIC-10 — Stable boundary engine. From an OBSERVED snapshot it computes whether the runtime currently
// shows any conflict state that would make a queue change unsafe. IMPORTANT: `SAFE` means "no observed conflict
// state" — NOT a guarantee that a queue change would succeed, and this engine NEVER changes the queue. Blockers
// are evaluated in a fixed precedence so the result is reproducible. Pure & deterministic.

import type { RuntimeBoundarySnapshot, StableBoundary, StableBoundaryResult } from './types';

export function computeStableBoundary(s: RuntimeBoundarySnapshot | null): StableBoundary {
  if (s == null || s.dataStatus === 'NOT_AVAILABLE') {
    return { result: 'NOT_AVAILABLE', blockers: ['Snapshot 없음'], currentTrackPresent: false, indexValid: false, sessionValid: false };
  }
  const sessionValid = s.playerSessionId != null;
  const currentTrackPresent = s.currentTrackIdHash != null;
  const indexValid = s.currentIndex >= 0 && s.currentIndex < s.queueLength;

  const out = (result: StableBoundaryResult, blocker: string | null): StableBoundary => ({
    result, blockers: blocker ? [blocker] : [], currentTrackPresent, indexValid, sessionValid,
  });

  if (!sessionValid) return out('NO_SESSION', 'Player Session 없음');
  if (s.dataStatus === 'INSUFFICIENT_DATA') return out('INSUFFICIENT_DATA', '관측 데이터 부족');

  // Conflict states (fixed precedence).
  if (s.crossfadeState !== 'IDLE' && s.crossfadeState !== 'UNKNOWN') return out('BLOCKED_CROSSFADE', `Crossfade ${s.crossfadeState}`);
  if (s.recoveryState !== 'IDLE' && s.recoveryState !== 'RECOVERED' && s.recoveryState !== 'UNKNOWN') return out('BLOCKED_RECOVERY', `Recovery ${s.recoveryState}`);
  if (s.preloadState !== 'IDLE' && s.preloadState !== 'CANCELLED' && s.preloadState !== 'READY' && s.preloadState !== 'UNKNOWN') return out('BLOCKED_PRELOAD', `Preload ${s.preloadState}`);
  if (s.audioSwapState !== 'IDLE' && s.audioSwapState !== 'COMPLETED' && s.audioSwapState !== 'UNKNOWN') return out('BLOCKED_AUDIO_SWAP', `Audio Swap ${s.audioSwapState}`);
  if (s.buffering) return out('BLOCKED_BUFFERING', 'Buffering');
  if (s.waiting) return out('BLOCKED_WAITING', 'Waiting');
  if (s.stalled) return out('BLOCKED_STALLED', 'Stalled');

  if (s.queueLength <= 0) return out('EMPTY_QUEUE', 'Queue 비어있음');
  if (!currentTrackPresent) return out('INVALID_CURRENT_TRACK', '현재 Track 없음');
  if (!indexValid) return out('INVALID_INDEX', '현재 Index 무효');

  return out('SAFE', null);
}

export function isStableBoundarySafe(r: StableBoundaryResult): boolean { return r === 'SAFE'; }
