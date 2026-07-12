// AI-MUSIC-8 — Current-track & playback-state preservation (SIMULATION ONLY). The audit confirmed the real
// setQueue resets currentTime to 0, forces playing:true, and does NOT remap the currently-playing track — so a
// raw setQueue mid-playback would interrupt the current track. This engine models the SAFE adapter intent:
// apply a candidate only at a track boundary, keep the current track playing until it ends (its index remapped
// if it exists in the candidate queue), and never touch the audio element. It never mutates anything.

import type {
  CurrentTrackInput, CurrentTrackPreservation, CurrentTrackResult,
  PlaybackStateSnapshot, PlaybackStatePreservation, PlaybackStateResult, BoundaryResult,
} from './types';

export function preserveCurrentTrack(i: CurrentTrackInput): CurrentTrackPreservation {
  const reasons: string[] = [];

  // Boundary-blocked cases first (crossfade/recovery/preload/unobservable).
  const b = i.boundary.safety;
  if (b === 'UNSAFE_CROSSFADE') return blocked('BLOCKED_CROSSFADE', 'Crossfade 진행 중 — 적용 차단');
  if (b === 'UNSAFE_RECOVERY') return blocked('BLOCKED_RECOVERY', 'Recovery 진행 중 — 적용 차단');
  if (b === 'UNSAFE_PRELOAD') return blocked('BLOCKED_PRELOAD', 'Preload 사용 중 — 적용 차단');
  if (b === 'NOT_AVAILABLE' || b === 'UNKNOWN' || b === 'UNSAFE_AUDIO_SWAP' || b === 'UNSAFE_PLAYER_STATE') {
    return { result: 'NOT_AVAILABLE', remappedIndex: null, reasons: ['Boundary 안전성 미확정 → 적용 불가(NOT_AVAILABLE)'] };
  }

  if (i.currentTrackId == null) return { result: 'NOT_AVAILABLE', remappedIndex: null, reasons: ['현재 Track 없음'] };

  const remapped = i.candidateQueueTrackIds.indexOf(i.currentTrackId);
  if (remapped >= 0) {
    // Current track exists in the candidate queue → its index is remapped; playback continues seamlessly.
    reasons.push(`현재 Track 이 새 Queue에 존재 → index ${i.currentIndex}→${remapped} 재매핑, 재생 유지`);
    return { result: 'PRESERVED_IN_NEW_QUEUE', remappedIndex: remapped, reasons };
  }
  // Current track absent from the candidate → keep the existing queue until the current track ends, then swap.
  reasons.push('현재 Track 이 새 Queue에 없음 → 현재 Track 종료 경계까지 기존 Queue 유지, 이후 새 Queue 사용');
  return { result: 'PRESERVED_UNTIL_BOUNDARY', remappedIndex: null, reasons };
}

function blocked(result: CurrentTrackResult, reason: string): CurrentTrackPreservation {
  return { result, remappedIndex: null, reasons: [reason] };
}

// Compares a hypothetical apply against the current playback state. The SAFE adapter path preserves playback
// (apply at boundary via a separate queue-replacement that does NOT set playing/currentTime); the raw setQueue
// path WOULD reset currentTime and force playing. This models which path a given apply corresponds to.
export function preservePlaybackState(
  before: PlaybackStateSnapshot,
  applyVia: 'SAFE_BOUNDARY_ADAPTER' | 'RAW_SET_QUEUE',
  boundary: BoundaryResult,
): PlaybackStatePreservation {
  const diff: string[] = [];
  // A raw setQueue always resets currentTime to 0 and forces playing:true (audit) → not preserved.
  if (applyVia === 'RAW_SET_QUEUE') {
    diff.push('setQueue 는 currentTime=0, playing=true 로 설정 → 현재 재생 상태 변경');
    const result: PlaybackStateResult = before.currentTime > 0 ? 'WOULD_RESET_CURRENT_TIME' : 'WOULD_CHANGE_PLAYING';
    return { result, diff };
  }
  // Safe adapter path only proceeds at a SAFE boundary; if the boundary isn't safe, no apply happens (preserved).
  if (!boundary.applyPossible) return { result: 'PRESERVED', diff: ['안전 경계 아님 → 미적용, 재생 상태 유지'] };
  // At a safe track boundary the current track has ended (currentTime moot); playing intent is unchanged.
  if (before.crossfading) return { result: 'PRESERVED', diff: ['Crossfade 중 미적용 → 유지'] };
  return { result: 'PRESERVED', diff: ['안전 경계에서 다음 Track 부터 적용 → playing/currentTime/volume/muted/sinkId 불변'] };
}
