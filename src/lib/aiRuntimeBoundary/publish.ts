// AI-MUSIC-10 — Fail-open observer publication helpers. These are the ONLY functions Player.tsx calls. Each one:
// (1) checks the gate (master + observer flag + per-signal flag + kill switch) and returns immediately when off —
// so a disabled observer does ZERO work and the player behaves identically; (2) wraps the store update in
// try/catch and NEVER throws, awaits, retries, or returns a value the player depends on. An observer error is
// dropped (counter bumped) and can never propagate to playback, the queue, crossfade, recovery, preload, or the
// audio element. Publishing is fire-and-forget: the player's control flow is unaffected regardless of outcome.

import { getAiRuntimeBoundaryConfig, isObserverActive, type AiRuntimeBoundaryConfig } from './config';
import { useRuntimeBoundaryStore } from './store';
import { fnv1aHash } from './hash';
import type {
  CrossfadeState, RecoveryState, PreloadState, AudioSwapState, RecoveryReason, ObserverSignal,
} from './types';

function nowMs(): number { try { return Date.now(); } catch { return 0; } }

function dispatch(signal: ObserverSignal, perSignalEnabled: (c: AiRuntimeBoundaryConfig) => boolean): void {
  let cfg: AiRuntimeBoundaryConfig;
  try { cfg = getAiRuntimeBoundaryConfig(); } catch { return; }
  if (!isObserverActive(cfg) || !perSignalEnabled(cfg)) return;   // gate: OFF → zero work, player unaffected
  try {
    useRuntimeBoundaryStore.getState()._apply(signal, nowMs());
  } catch {
    try { useRuntimeBoundaryStore.getState()._recordError(); } catch { /* drop — never throw to the player */ }
  }
}

/** Start / change the observation session (fire-and-forget). Publication belongs to the observer only. */
export function publishSession(playerSessionId: string | null): void {
  let cfg: AiRuntimeBoundaryConfig;
  try { cfg = getAiRuntimeBoundaryConfig(); } catch { return; }
  if (!isObserverActive(cfg)) return;
  try { useRuntimeBoundaryStore.getState()._startSession(playerSessionId, nowMs()); }
  catch { try { useRuntimeBoundaryStore.getState()._recordError(); } catch { /* drop */ } }
}

export function publishCrossfade(state: CrossfadeState, activeAudioIndex?: number): void {
  dispatch({ kind: 'crossfade', state, activeAudioIndex }, (c) => c.crossfadeObserverEnabled);
}
export function publishRecovery(state: RecoveryState, reason?: RecoveryReason): void {
  dispatch({ kind: 'recovery', state, reason }, (c) => c.recoveryObserverEnabled);
}
export function publishPreload(state: PreloadState, nextTrackId?: string | null, inactiveAudioIndex?: number): void {
  dispatch({ kind: 'preload', state, nextTrackHash: nextTrackId === undefined ? undefined : fnv1aHash(nextTrackId), inactiveAudioIndex }, (c) => c.preloadObserverEnabled);
}
export function publishAudioSwap(state: AudioSwapState, beforeActiveIndex?: number, afterActiveIndex?: number, reason?: string): void {
  dispatch({ kind: 'audioSwap', state, beforeActiveIndex, afterActiveIndex, reason }, (c) => c.audioSwapObserverEnabled);
}
export function publishPlayerState(p: {
  playing: boolean; paused: boolean; ended: boolean; buffering: boolean; waiting: boolean; stalled: boolean;
  currentTrackId: string | null; currentIndex: number; queueLength: number; activeAudioIndex: number;
  inactiveAudioReady: boolean; nextTrackId: string | null;
}): void {
  dispatch({
    kind: 'playerState', playing: p.playing, paused: p.paused, ended: p.ended, buffering: p.buffering,
    waiting: p.waiting, stalled: p.stalled, currentTrackIdHash: fnv1aHash(p.currentTrackId), currentIndex: p.currentIndex,
    queueLength: p.queueLength, activeAudioIndex: p.activeAudioIndex, inactiveAudioReady: p.inactiveAudioReady,
    nextTrackHash: fnv1aHash(p.nextTrackId),
  }, () => true);
}
