/**
 * useStorePlaybackPolicy — BRAND-PLAYLIST-ROTATION-4.
 *
 * Wires the certified DB resolver (`resolve_store_playback_policy`, migration 0459)
 * into the live Store Player as a MODE OVERLAY. It does NOT load playlists or build
 * queues — that stays with the existing `useFranchisePolicySync` / business-mode paths
 * (regression 0). This hook only:
 *   - resolves the current playback mode (play / break / closed / fallback) for the store
 *   - drives the playerStore schedule-suppression gate so break/closed are silent and
 *     auto-resume when the window ends (reusing the certified decideBreakResume, §9)
 *   - owns EXACTLY ONE next_transition timer + re-evaluates on visibility/focus/pageshow/
 *     online + a low-frequency safety poll (§11/§15)
 *   - guards against stale/racing responses via a generation token (§16)
 *
 * Fail-safe (§20): on RPC/contract error it NEVER forces the store closed. A first-load
 * error falls back to legacy playback; a mid-session error keeps the last known decision
 * (existing playback continues) and retries on the next trigger. StrictMode-double-invoke
 * safe: every timer/listener is cleaned up and the gate is released on unmount.
 *
 * For non-franchise stores the resolver returns has_franchise_policy=false → 'fallback',
 * and the hook keeps the gate off — existing behavior is untouched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveStorePlaybackPolicy } from '@/lib/api/franchiseApi';
import { usePlayerStore } from '@/store/playerStore';
import { decideBreakResume } from '@/lib/storePlaybackPolicy';
import {
  mapResolutionToRuntimeState,
  computeTransitionDelayMs,
  legacyDecision,
  loadRotationMemory,
  saveRotationMemory,
  recordSetPlay,
  EMPTY_ROTATION_MEMORY,
  type RuntimeDecision,
  type RotationMemory,
} from '@/lib/storePlaybackRuntime';

/** Low-frequency safety re-evaluation — catches HQ override changes + any missed event. */
const SAFETY_POLL_MS = 5 * 60_000; // 5 min

interface Options {
  storeId: string | null;
  /** false → hook inert (personal users / admin pages); reports 'legacy'. */
  enabled: boolean;
}

export interface StorePlaybackPolicyState {
  decision: RuntimeDecision;
  loading: boolean;
  error: string | null;
}

export function useStorePlaybackPolicy({ storeId, enabled }: Options): StorePlaybackPolicyState {
  const [decision, setDecision] = useState<RuntimeDecision>(() =>
    mapResolutionToRuntimeState(null, { loading: true }),
  );
  const [error, setError] = useState<string | null>(null);

  // Request generation — any increment invalidates in-flight responses (stale/race guard).
  const genRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // Suppression bookkeeping so we resume correctly when a break/closed window ends.
  const prevSuppressReasonRef = useRef<'break' | 'closed' | null>(null);
  const wasPlayingBeforeSuppressRef = useRef(false);
  // Whether we've ever applied a real (non-error) decision — for first-load fail-safe.
  const hadResolutionRef = useRef(false);
  // Deterministic, refresh-stable curated-set rotation memory (persisted per store).
  const rotationMemRef = useRef<RotationMemory>(EMPTY_ROTATION_MEMORY);
  // Latest evaluate(), so timers/listeners can call it without re-subscribing.
  const evaluateRef = useRef<(trigger: string) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (nextMs: number | null) => {
      clearTimer();
      const delay = computeTransitionDelayMs(nextMs, Date.now());
      if (delay === null) return; // no known transition → rely on triggers + safety poll
      timerRef.current = window.setTimeout(() => {
        evaluateRef.current('transition');
      }, delay);
    },
    [clearTimer],
  );

  // Apply a valid (non-error) decision to the schedule-suppression gate. Reuses the
  // certified decideBreakResume for auto-resume; never touches playlists/queues.
  const applyDecision = useCallback(
    (d: RuntimeDecision) => {
      const setSuppress = usePlayerStore.getState().setScheduleSuppression;
      const play = usePlayerStore.getState().play;

      if (d.suppressPlayback && d.suppressReason) {
        // Entering (or remaining in) break/closed → immediate suppression (§6/§8/§10).
        if (prevSuppressReasonRef.current === null) {
          wasPlayingBeforeSuppressRef.current = usePlayerStore.getState().playing;
        }
        setSuppress(d.suppressReason);
        prevSuppressReasonRef.current = d.suppressReason;
        return;
      }

      // Not suppressed (play / fallback / legacy). Release a prior gate + maybe resume.
      const prevReason = prevSuppressReasonRef.current;
      if (prevReason !== null) {
        setSuppress(null);
        prevSuppressReasonRef.current = null;
        const hasQueue = usePlayerStore.getState().queue.length > 0;
        // Closed→open (store opening) intends playback if a queue is staged; a mid-day
        // break resumes only if it was playing when the break began (§9/§10).
        const intendPlay =
          prevReason === 'closed'
            ? wasPlayingBeforeSuppressRef.current || hasQueue
            : wasPlayingBeforeSuppressRef.current;
        const resume = decideBreakResume({
          wasPlayingBeforeBreak: intendPlay,
          userPausedDuringBreak: false, // break bypass is disabled by the gate itself
          isOperatingNow: d.state === 'play',
          hasPlayablePlaylist: hasQueue,
          accountOk: true,
          autoplayAllowed: true, // optimistic — existing tryResume / "재생 시작" button covers a block
          otherAudioPlaying: false, // crossfade is disabled in store mode
        });
        if (resume.resume) play();
        wasPlayingBeforeSuppressRef.current = false;
      }

      // Record curated-set rotation memory for observability + refresh-stability (§7).
      if (d.state === 'play' && d.playlistSetId && storeId) {
        rotationMemRef.current = recordSetPlay(rotationMemRef.current, d.playlistSetId, Date.now());
        saveRotationMemory(storeId, rotationMemRef.current);
      }
    },
    [storeId],
  );

  const evaluate = useCallback(
    async (_trigger: string) => {
      if (!enabled || !storeId) return;
      const gen = ++genRef.current;
      const setSuppress = usePlayerStore.getState().setScheduleSuppression;
      try {
        const resolution = await resolveStorePlaybackPolicy(storeId);
        if (gen !== genRef.current) return; // stale — a newer request/store won

        const d = mapResolutionToRuntimeState(resolution);

        if (d.state === 'error') {
          // Contract anomaly (unknown mode / play+null playlist). Fail-safe: never force
          // closed; keep the last good decision if we had one, else revert to legacy.
          setError(d.reason);
          if (!hadResolutionRef.current) {
            setSuppress(null);
            prevSuppressReasonRef.current = null;
            setDecision(legacyDecision());
          }
          scheduleNext(null);
          return;
        }

        hadResolutionRef.current = true;
        setError(null);
        applyDecision(d);
        setDecision(d);
        scheduleNext(d.nextTransitionAtMs);
      } catch (e) {
        if (gen !== genRef.current) return;
        // Transport/RPC failure. Fail-safe (§20): do NOT change the gate mid-session.
        setError(e instanceof Error ? e.message : String(e));
        if (!hadResolutionRef.current) {
          setSuppress(null);
          prevSuppressReasonRef.current = null;
          setDecision(legacyDecision());
        }
        scheduleNext(null);
      }
    },
    [enabled, storeId, applyDecision, scheduleNext],
  );

  // Keep the ref pointing at the latest evaluate for timer/listener callbacks.
  useEffect(() => {
    evaluateRef.current = (trigger: string) => {
      void evaluate(trigger);
    };
  }, [evaluate]);

  // ---- mount / store-change: initial evaluation + cleanup --------------------
  useEffect(() => {
    genRef.current++; // invalidate any in-flight from a previous store
    hadResolutionRef.current = false;
    clearTimer();

    if (!enabled || !storeId) {
      usePlayerStore.getState().setScheduleSuppression(null);
      prevSuppressReasonRef.current = null;
      setDecision(legacyDecision());
      return () => clearTimer();
    }

    rotationMemRef.current = loadRotationMemory(storeId);
    void evaluate('mount');
    return () => clearTimer();
  }, [enabled, storeId, evaluate, clearTimer]);

  // ---- refresh triggers (§15) -----------------------------------------------
  useEffect(() => {
    if (!enabled || !storeId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') evaluateRef.current('visibility');
    };
    const onFocus = () => evaluateRef.current('focus');
    const onPageShow = () => evaluateRef.current('pageshow');
    const onOnline = () => evaluateRef.current('online');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    const pollId = window.setInterval(() => evaluateRef.current('safety-poll'), SAFETY_POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      window.clearInterval(pollId);
    };
  }, [enabled, storeId]);

  // ---- final unmount: release the gate so suppression never leaks off-page ----
  useEffect(
    () => () => {
      usePlayerStore.getState().setScheduleSuppression(null);
    },
    [],
  );

  return { decision, loading: decision.state === 'policy_loading', error };
}
