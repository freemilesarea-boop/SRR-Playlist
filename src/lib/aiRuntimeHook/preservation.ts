// AI-MUSIC-9 — Current-track & playback-state preservation runtime checks (before vs after snapshots, in-model
// only). A safe hook may change ONLY queue metadata / next candidate / revision / resolver source. It must never
// change playing, paused, currentTime, volume, muted, sinkId, activeAudioIndex, the current track, or the audio
// source. If any forbidden field differs the check FAILS (blocked → keep existing). If the before/after are not
// observable the check degrades to NOT_OBSERVABLE (never a false PASS). Pure & deterministic.

import type {
  PreservationRuntimeInput, CurrentTrackRuntimeCheck, PlaybackStateRuntimeCheck,
} from './types';

export function checkCurrentTrackPreservation(i: PreservationRuntimeInput): CurrentTrackRuntimeCheck {
  const { before, after } = i;
  if (!before.observable || !after.observable) {
    return { result: 'NOT_OBSERVABLE', currentTrackIdEqual: false, currentTimeEqual: false, activeAudioIndexEqual: false, playingEqual: false, pausedEqual: false, transientStateEqual: false, reasons: ['Runtime 관측 불가 — Player 내부 상태 접근 불가'] };
  }
  const currentTrackIdEqual = before.currentTrackId === after.currentTrackId;
  const currentTimeEqual = before.currentTime === after.currentTime;
  const activeAudioIndexEqual = before.activeAudioIndex === after.activeAudioIndex;
  const playingEqual = before.playing === after.playing;
  const pausedEqual = before.paused === after.paused;
  const transientStateEqual = before.crossfading === after.crossfading && before.recovering === after.recovering && before.buffering === after.buffering;

  const reasons: string[] = [];
  if (!currentTrackIdEqual) reasons.push('현재 Track 변경됨');
  if (!currentTimeEqual) reasons.push('currentTime 변경됨');
  if (!activeAudioIndexEqual) reasons.push('activeAudioIndex 변경됨');
  if (!playingEqual || !pausedEqual) reasons.push('재생/일시정지 상태 변경됨');
  if (!transientStateEqual) reasons.push('crossfade/recovery/buffering 상태 변경됨');

  const allEqual = currentTrackIdEqual && currentTimeEqual && activeAudioIndexEqual && playingEqual && pausedEqual && transientStateEqual;
  const result = allEqual ? 'PRESERVED' : 'CHANGED_BLOCKED';
  if (allEqual) reasons.push('현재 Track/시간/오디오 인덱스/재생상태 모두 보존');
  return { result, currentTrackIdEqual, currentTimeEqual, activeAudioIndexEqual, playingEqual, pausedEqual, transientStateEqual, reasons };
}

const FORBIDDEN: Array<[keyof PreservationRuntimeInput['before'], string]> = [
  ['playing', 'playing'], ['paused', 'paused'], ['currentTime', 'currentTime'], ['volume', 'volume'],
  ['muted', 'muted'], ['sinkId', 'sinkId'], ['activeAudioIndex', 'activeAudioIndex'], ['currentTrackId', 'currentTrack'],
];

export function checkPlaybackStatePreservation(i: PreservationRuntimeInput): PlaybackStateRuntimeCheck {
  const { before, after } = i;
  if (!before.observable || !after.observable) {
    return { result: 'NOT_OBSERVABLE', forbiddenChanges: [], allowedChanges: [], reasons: ['Runtime 관측 불가'] };
  }
  const forbiddenChanges: string[] = [];
  for (const [key, label] of FORBIDDEN) { if (before[key] !== after[key]) forbiddenChanges.push(label); }

  const allowedChanges: string[] = [];
  if (before.queueLength !== after.queueLength) allowedChanges.push('queueLength (Candidate metadata)');

  const reasons: string[] = [];
  if (forbiddenChanges.length > 0) { reasons.push(`금지된 Playback 변경: ${forbiddenChanges.join(', ')}`); return { result: 'FORBIDDEN_CHANGE', forbiddenChanges, allowedChanges, reasons }; }
  reasons.push('Playback State 보존 (Queue metadata 만 변경 허용)');
  return { result: 'PRESERVED', forbiddenChanges, allowedChanges, reasons };
}
