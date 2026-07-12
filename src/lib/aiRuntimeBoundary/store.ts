// AI-MUSIC-10 — Read-only runtime boundary observation store. SEPARATE from usePlayerStore. It has NO player /
// queue / audio control methods — only observation intake (`_startSession`, `_apply`, `_recordError`, `reset`)
// and read selectors. The intake methods are internal (prefixed `_`) and are meant to be called ONLY through the
// gated, fail-open helpers in `publish.ts`. Publishing here never re-renders the player (Player does not select
// from this store) and never throws to the player. It keeps only the latest snapshot (no history).

import { create } from 'zustand';
import type { ObserverSignal } from './types';
import { initialBoundaryState, applySignal, resetForSession, type BoundaryReducerState } from './reducer';

interface RuntimeBoundaryStore extends BoundaryReducerState {
  // Observation intake ONLY — no setQueue/setPlaying/play/pause/load/seek/recover/startCrossfade here, by design.
  _startSession: (sessionId: string | null, nowMs: number) => void;
  _apply: (signal: ObserverSignal, nowMs: number) => void;
  _recordError: () => void;
  reset: () => void;
}

export const useRuntimeBoundaryStore = create<RuntimeBoundaryStore>((set) => ({
  ...initialBoundaryState(),
  _startSession: (sessionId, nowMs) => set((s) => resetForSession(s, sessionId, nowMs)),
  _apply: (signal, nowMs) => set((s) => applySignal(s, signal, nowMs)),
  _recordError: () => set((s) => ({ counters: { ...s.counters, observerErrors: s.counters.observerErrors + 1 } })),
  reset: () => set(() => ({ ...initialBoundaryState() })),
}));

// Read-only selector hooks for the dashboard (never expose intake to UI consumers).
export function useRuntimeBoundarySnapshot() { return useRuntimeBoundaryStore((s) => s.snapshot); }
export function useRuntimeBoundaryCounters() { return useRuntimeBoundaryStore((s) => s.counters); }
export function useRuntimeBoundaryRevisions() { return useRuntimeBoundaryStore((s) => s.revisions); }
