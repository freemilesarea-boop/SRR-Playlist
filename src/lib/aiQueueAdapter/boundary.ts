// AI-MUSIC-8 — Safe boundary model. Decides whether a queue swap could be applied at a given boundary WITHOUT
// disturbing the current track / player. Crossfade, recovery, preload, or an incomplete audio swap → UNSAFE.
// Signals that the current code cannot observe (some live in local component refs, not store state) are marked
// NOT_AVAILABLE — the engine never fabricates a SAFE verdict from missing data. Pure & deterministic.

import type { BoundarySignals, BoundaryResult, BoundarySafety } from './types';

export function evaluateBoundary(s: BoundarySignals): BoundaryResult {
  const reasons: string[] = [];

  // If the boundary's key internals are not observable from current code, we cannot assert safety.
  if (!s.observable) {
    return { safety: 'NOT_AVAILABLE', applyPossible: false, reasons: ['Boundary 내부 상태 관측 불가(local ref) → NOT_AVAILABLE'] };
  }

  // Hard-unsafe conditions (any one blocks application).
  if (s.crossfadeComplete === false) return unsafe('UNSAFE_CROSSFADE', 'Crossfade 진행 중 — Apply 불가');
  if (s.recovering === true) return unsafe('UNSAFE_RECOVERY', 'Recovery 진행 중 — Apply 불가');
  if (s.preloading === true) return unsafe('UNSAFE_PRELOAD', 'Preload 사용 중 — Apply 불가');
  if (s.audioSwapComplete === false) return unsafe('UNSAFE_AUDIO_SWAP', 'Audio Element swap 미완료 — Apply 불가');
  if (s.playerStateStable === false) return unsafe('UNSAFE_PLAYER_STATE', 'Player State 불안정 — Apply 불가');
  if (s.currentIndexStable === false) return unsafe('UNSAFE_PLAYER_STATE', 'Current Index 불안정 — Apply 불가');

  // A genuinely safe boundary requires positive evidence the track boundary is reached (or an idle/session start).
  const safeKinds = s.kind === 'TRACK_ENDED' || s.kind === 'CROSSFADE_COMPLETED'
    || s.kind === 'CROSSFADE_FALLBACK_COMPLETED' || s.kind === 'MANUAL_QUEUE_REFRESH'
    || s.kind === 'PLAYER_IDLE' || s.kind === 'SESSION_START';
  if (!safeKinds) return { safety: 'UNKNOWN', applyPossible: false, reasons: [`Boundary 종류 불명확 (${s.kind})`] };

  // Need positive confirmation the current track ended / crossfade finished for track-boundary kinds.
  const trackBoundary = s.kind === 'TRACK_ENDED' || s.kind === 'CROSSFADE_COMPLETED' || s.kind === 'CROSSFADE_FALLBACK_COMPLETED';
  if (trackBoundary && s.currentTrackEnded !== true && s.crossfadeComplete !== true) {
    return { safety: 'UNKNOWN', applyPossible: false, reasons: ['Track 종료/Crossfade 완료 미확인'] };
  }

  reasons.push('안전 경계 — Apply 가능(시뮬레이션 전용)');
  return { safety: 'SAFE', applyPossible: true, reasons };
}

function unsafe(safety: BoundarySafety, reason: string): BoundaryResult {
  return { safety, applyPossible: false, reasons: [reason] };
}
