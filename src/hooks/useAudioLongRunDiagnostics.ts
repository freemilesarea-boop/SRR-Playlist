/**
 * useAudioLongRunDiagnostics — Phase 3-3 Long-Run Playback Stability Test Harness.
 *
 * 목적:
 * 매장 플레이어 12h/24h 장시간 재생 안정성 관측/검증. 활성화 flag 가 켜졌을
 * 때만 30초 tick + 10분 summary interval 을 생성. 활성화 안 되면 hook 은
 * no-op (interval 생성 0).
 *
 * 활성화 방식 (둘 중 하나):
 *   • URL query param `?audioLongRun=1` — 방문 시 localStorage 로 persist
 *   • localStorage `deudda.audioLongRun` = `'1'`
 *
 * 비활성화:
 *   • localStorage.removeItem('deudda.audioLongRun') 또는 값을 '0' 으로 변경
 *   • 다음 mount 부터 interval 생성 안 함
 *
 * 새 polling 은 이 flag 가 켜졌을 때만 허용. 일반 운영 흐름은 무영향.
 * 실제 재생 로직 · Guardian · Player · Phase 3-1/3-2 guard 전부 무변경.
 * 관찰만 하고 아무것도 복구하지 않음 (recovery 는 Phase 3-2 가 담당).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { audioDebugWarn } from '@/lib/audioDebug';

const STORAGE_KEY = 'deudda.audioLongRun';
const QUERY_PARAM = 'audioLongRun';
const TICK_INTERVAL_MS = 30_000;
const SUMMARY_INTERVAL_MS = 10 * 60_000;

export interface LongRunHarnessInputs {
  audioARef: { current: HTMLAudioElement | null };
  audioBRef: { current: HTMLAudioElement | null };
  getActiveIdx: () => 0 | 1;
  getPlaying: () => boolean;
  getCrossfading: () => boolean;
  getSinkReady: () => boolean;
  getCurrentTrackId: () => string | null;
}

export interface LongRunSummary {
  active: boolean;
  startedAtMs: number;
  elapsedMs: number;
  ticks: number;
  trackTransitions: number;
  healthIssueCount: number;
  sinkMismatchCount: number;
  inactivePlayingCount: number;
  bothPlayingCount: number;
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit?: number };
}

export interface LongRunHandle {
  getLongRunSummary: () => LongRunSummary;
}

interface Counters {
  ticks: number;
  trackTransitions: number;
  healthIssueCount: number;
  sinkMismatchCount: number;
  inactivePlayingCount: number;
  bothPlayingCount: number;
  lastTrackId: string | null;
}

interface SlotSnap {
  currentTime: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  sinkId: string;
  readyState: number;
  networkState: number;
  currentSrc: string;
}

interface MemorySnap {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit?: number;
}

function isEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.localStorage?.getItem(STORAGE_KEY) === '1') return true;
    const url = new URL(window.location.href);
    if (url.searchParams.get(QUERY_PARAM) === '1') {
      // Persist to localStorage — 새로고침 후에도 유지 (개발자 편의)
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* silent */ }
      return true;
    }
  } catch { /* silent */ }
  return false;
}

function snapshotSlot(el: HTMLAudioElement | null): SlotSnap | null {
  if (!el) return null;
  return {
    currentTime: el.currentTime,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    paused: el.paused,
    volume: el.volume,
    muted: el.muted,
    sinkId: (el as HTMLAudioElement & { sinkId?: string }).sinkId ?? '',
    readyState: el.readyState,
    networkState: el.networkState,
    currentSrc: el.currentSrc,
  };
}

function readMemory(): MemorySnap | undefined {
  try {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit?: number };
    };
    const m = perf.memory;
    if (!m) return undefined;
    return {
      usedJSHeapSize: m.usedJSHeapSize,
      totalJSHeapSize: m.totalJSHeapSize,
      jsHeapSizeLimit: m.jsHeapSizeLimit,
    };
  } catch {
    return undefined;
  }
}

export function useAudioLongRunDiagnostics(inputs: LongRunHarnessInputs): LongRunHandle {
  // React state 를 stale closure 없이 읽도록 매 렌더 갱신
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const countersRef = useRef<Counters>({
    ticks: 0,
    trackTransitions: 0,
    healthIssueCount: 0,
    sinkMismatchCount: 0,
    inactivePlayingCount: 0,
    bothPlayingCount: 0,
    lastTrackId: null,
  });
  // Phase 4-2 — Dashboard 가 폴링해서 읽어가는 startedAt / active flag
  const startedAtRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isEnabled()) return; // flag OFF → interval 생성 0
    const startedAt = performance.now();
    startedAtRef.current = startedAt;
    activeRef.current = true;
    const startedAtIso = new Date().toISOString();
    audioDebugWarn('[audio:longrun:start]', {
      startedAtIso,
      tickIntervalMs: TICK_INTERVAL_MS,
      summaryIntervalMs: SUMMARY_INTERVAL_MS,
      storageKey: STORAGE_KEY,
      queryParam: QUERY_PARAM,
    });

    // core snapshot factory — tick 과 summary 가 공유
    const buildSnapshot = () => {
      const cur = inputsRef.current;
      const counters = countersRef.current;
      const activeIdx = cur.getActiveIdx();
      const activeEl = activeIdx === 0 ? cur.audioARef.current : cur.audioBRef.current;
      const inactiveEl = activeIdx === 0 ? cur.audioBRef.current : cur.audioARef.current;
      const active = snapshotSlot(activeEl);
      const inactive = snapshotSlot(inactiveEl);
      const desiredSinkId = useAudioOutputStore.getState().sinkId;
      const trackId = cur.getCurrentTrackId();
      const playing = cur.getPlaying();
      const crossfadeInProgress = cur.getCrossfading();
      const sinkReady = cur.getSinkReady();

      // trackTransitions
      if (trackId !== counters.lastTrackId) {
        counters.trackTransitions += 1;
        counters.lastTrackId = trackId;
      }

      // issue detection (Phase 3-2 와 동일 조건 · 여기서는 카운트만)
      const issues: string[] = [];
      if (desiredSinkId && sinkReady && active && active.sinkId !== desiredSinkId) {
        counters.sinkMismatchCount += 1;
        counters.healthIssueCount += 1;
        issues.push('sink-mismatch');
      }
      if (!crossfadeInProgress && inactive && !inactive.paused) {
        counters.inactivePlayingCount += 1;
        counters.healthIssueCount += 1;
        issues.push('inactive-playing');
      }
      if (!crossfadeInProgress && active && inactive && !active.paused && !inactive.paused) {
        counters.bothPlayingCount += 1;
        counters.healthIssueCount += 1;
        issues.push('both-playing');
      }

      counters.ticks += 1;

      return {
        elapsedMs: Math.round(performance.now() - startedAt),
        currentTrackId: trackId,
        activeIdx,
        active,
        inactive,
        playing,
        crossfadeInProgress,
        sinkReady,
        desiredSinkId,
        memory: readMemory(),
        counters: { ...counters },
        issues,
      };
    };

    const tickId = window.setInterval(() => {
      const snap = buildSnapshot();
      audioDebugWarn('[audio:longrun:tick]', snap);
      for (const issue of snap.issues) {
        audioDebugWarn('[audio:longrun:issue]', {
          issue,
          tickIndex: snap.counters.ticks,
          elapsedMs: snap.elapsedMs,
          currentTrackId: snap.currentTrackId,
        });
      }
    }, TICK_INTERVAL_MS);

    const summaryId = window.setInterval(() => {
      const snap = buildSnapshot();
      audioDebugWarn('[audio:longrun:summary]', {
        ...snap,
        startedAtIso,
      });
    }, SUMMARY_INTERVAL_MS);

    // countersRef 는 module-life 유지 (매 렌더 새로 만들지 않음) — 여기 로컬 var 로
    // capture 해서 cleanup 시점의 ref-changed 경고 회피.
    const countersForCleanup = countersRef.current;
    return () => {
      window.clearInterval(tickId);
      window.clearInterval(summaryId);
      activeRef.current = false;
      audioDebugWarn('[audio:longrun:cleanup]', {
        elapsedMs: Math.round(performance.now() - startedAt),
        finalCounters: { ...countersForCleanup },
      });
    };
  }, []);

  const getLongRunSummary = useCallback((): LongRunSummary => {
    const c = countersRef.current;
    return {
      active: activeRef.current,
      startedAtMs: startedAtRef.current,
      elapsedMs: activeRef.current ? Math.round(performance.now() - startedAtRef.current) : 0,
      ticks: c.ticks,
      trackTransitions: c.trackTransitions,
      healthIssueCount: c.healthIssueCount,
      sinkMismatchCount: c.sinkMismatchCount,
      inactivePlayingCount: c.inactivePlayingCount,
      bothPlayingCount: c.bothPlayingCount,
      memory: readMemory(),
    };
  }, []);

  return { getLongRunSummary };
}
