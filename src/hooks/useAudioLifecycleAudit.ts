/**
 * useAudioLifecycleAudit — Phase 5-1 Memory Leak Detection & Audio Lifecycle Audit.
 *
 * 매장 12h/24h 장시간 재생 안정성 관측용. flag ON (audioDebug 또는 audioLongRun)
 * 일 때만 60초 tick 으로 snapshot + leak 판정. flag OFF 이면 hook 은 no-op —
 * setInterval / listener 생성 0.
 *
 * 규칙:
 *   • 관측 전용 · Player 재생 로직 · Recovery Manager · Health Monitor · Long-Run
 *     Harness · Dashboard · Guardian 모두 무변경
 *   • leak warning 은 로그만 · 자동 수정 X
 *   • debug flag 켜졌을 때만 로그 출력 (audioDebugWarn 사용)
 *   • Dashboard 폴링용 getLifecycleSummary() 제공
 */
import { useCallback, useEffect, useRef } from 'react';
import { audioDebugWarn, isAudioDebugEnabled } from '@/lib/audioDebug';
import { getAudioObjectId } from '@/lib/audioOutput';

const TICK_INTERVAL_MS = 60_000;

// leak warning 기준
const HEAP_GROWTH_WARN_BYTES = 150 * 1024 * 1024; // 150MB
const LISTENER_DIFF_WARN = 4; // attach - detach > 4 는 누수 의심

export interface LifecycleAuditInputs {
  audioARef: { current: HTMLAudioElement | null };
  audioBRef: { current: HTMLAudioElement | null };
  getActiveIdx: () => 0 | 1;
  getCrossfading: () => boolean;
  getCrossfadeStartedAtMs: () => number; // 0 이면 crossfade 아님
  getLongRunActive: () => boolean;
  getDashboardActive: () => boolean;
  getRafActive: () => boolean; // crossfade rAF 진행 중
  getTimeoutActive: () => boolean; // crossfade safety timeout 진행 중
  getListenerAttachCount: () => number;
  getListenerDetachCount: () => number;
}

export interface LifecycleSnapshot {
  startedAtMs: number;
  elapsedMs: number;
  mountedAudioCount: 0 | 1 | 2;
  activeAudioObjectId: string;
  inactiveAudioObjectId: string;
  activeSrc: string;
  inactiveSrc: string;
  activePaused: boolean;
  inactivePaused: boolean;
  activeReadyState: number;
  inactiveReadyState: number;
  activeNetworkState: number;
  inactiveNetworkState: number;
  activeSinkId: string;
  inactiveSinkId: string;
  crossfadeInProgress: boolean;
  crossfadeStartedAtMs: number;
  crossfadeElapsedMs: number;
  rAFActive: boolean;
  timeoutActive: boolean;
  longRunActive: boolean;
  dashboardActive: boolean;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  heapGrowthFromStartBytes: number;
  listenerAttachCount: number;
  listenerDetachCount: number;
  listenerDiff: number;
  potentialLeaks: string[];
}

export interface LifecycleAuditHandle {
  getLifecycleSummary: () => LifecycleSnapshot;
}

function readHeap(): { used: number; total: number; limit: number } {
  try {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit?: number };
    };
    const m = perf.memory;
    if (!m) return { used: 0, total: 0, limit: 0 };
    return {
      used: m.usedJSHeapSize,
      total: m.totalJSHeapSize,
      limit: m.jsHeapSizeLimit ?? 0,
    };
  } catch {
    return { used: 0, total: 0, limit: 0 };
  }
}

function slotSnap(el: HTMLAudioElement | null): {
  paused: boolean; readyState: number; networkState: number;
  currentSrc: string; sinkId: string;
} {
  if (!el) return { paused: true, readyState: 0, networkState: 0, currentSrc: '', sinkId: '' };
  return {
    paused: el.paused,
    readyState: el.readyState,
    networkState: el.networkState,
    currentSrc: el.currentSrc,
    sinkId: (el as HTMLAudioElement & { sinkId?: string }).sinkId ?? '',
  };
}

export function useAudioLifecycleAudit(inputs: LifecycleAuditInputs): LifecycleAuditHandle {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const startedAtRef = useRef<number>(performance.now());
  const startHeapRef = useRef<number>(0);
  const lastSummaryRef = useRef<LifecycleSnapshot | null>(null);
  const enabledRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAudioDebugEnabled()) return; // flag OFF → no interval
    enabledRef.current = true;
    startedAtRef.current = performance.now();
    startHeapRef.current = readHeap().used;
    audioDebugWarn('[audio:lifecycle:mount]', {
      tickIntervalMs: TICK_INTERVAL_MS,
      startedAtIso: new Date().toISOString(),
      startHeapMB: (startHeapRef.current / 1024 / 1024).toFixed(1),
    });

    const build = (): LifecycleSnapshot => {
      const c = inputsRef.current;
      const nowMs = performance.now();
      const activeIdx = c.getActiveIdx();
      const activeEl = activeIdx === 0 ? c.audioARef.current : c.audioBRef.current;
      const inactiveEl = activeIdx === 0 ? c.audioBRef.current : c.audioARef.current;
      const a = slotSnap(activeEl);
      const b = slotSnap(inactiveEl);
      const heap = readHeap();
      const heapGrowth = heap.used - startHeapRef.current;
      const crossfading = c.getCrossfading();
      const cfStartedAt = c.getCrossfadeStartedAtMs();
      const listenerAttach = c.getListenerAttachCount();
      const listenerDetach = c.getListenerDetachCount();
      const listenerDiff = listenerAttach - listenerDetach;
      const rAF = c.getRafActive();
      const to = c.getTimeoutActive();

      // leak warnings
      const potentialLeaks: string[] = [];
      if (heap.used > 0 && heapGrowth > HEAP_GROWTH_WARN_BYTES) {
        potentialLeaks.push(`heap-growth ${(heapGrowth / 1024 / 1024).toFixed(1)}MB`);
      }
      if (listenerDiff > LISTENER_DIFF_WARN) {
        potentialLeaks.push(`listener-diff ${listenerDiff}`);
      }
      if (!crossfading && (rAF || to)) {
        potentialLeaks.push(`stale-crossfade-timer rAF=${rAF} timeout=${to}`);
      }

      const mountedAudioCount: 0 | 1 | 2 =
        (c.audioARef.current ? 1 : 0) + (c.audioBRef.current ? 1 : 0) as 0 | 1 | 2;

      return {
        startedAtMs: startedAtRef.current,
        elapsedMs: Math.round(nowMs - startedAtRef.current),
        mountedAudioCount,
        activeAudioObjectId: activeEl ? getAudioObjectId(activeEl) : '<null>',
        inactiveAudioObjectId: inactiveEl ? getAudioObjectId(inactiveEl) : '<null>',
        activeSrc: a.currentSrc,
        inactiveSrc: b.currentSrc,
        activePaused: a.paused,
        inactivePaused: b.paused,
        activeReadyState: a.readyState,
        inactiveReadyState: b.readyState,
        activeNetworkState: a.networkState,
        inactiveNetworkState: b.networkState,
        activeSinkId: a.sinkId,
        inactiveSinkId: b.sinkId,
        crossfadeInProgress: crossfading,
        crossfadeStartedAtMs: cfStartedAt,
        crossfadeElapsedMs: cfStartedAt > 0 ? Math.round(nowMs - cfStartedAt) : 0,
        rAFActive: rAF,
        timeoutActive: to,
        longRunActive: c.getLongRunActive(),
        dashboardActive: c.getDashboardActive(),
        heapUsedBytes: heap.used,
        heapTotalBytes: heap.total,
        heapLimitBytes: heap.limit,
        heapGrowthFromStartBytes: heapGrowth,
        listenerAttachCount: listenerAttach,
        listenerDetachCount: listenerDetach,
        listenerDiff,
        potentialLeaks,
      };
    };

    const tick = () => {
      const snap = build();
      lastSummaryRef.current = snap;
      audioDebugWarn('[audio:lifecycle:snapshot]', snap);
      if (snap.potentialLeaks.length > 0) {
        audioDebugWarn('[audio:lifecycle:leak-warning]', {
          potentialLeaks: snap.potentialLeaks,
          heapGrowthMB: (snap.heapGrowthFromStartBytes / 1024 / 1024).toFixed(1),
          listenerDiff: snap.listenerDiff,
          rAFActive: snap.rAFActive,
          timeoutActive: snap.timeoutActive,
          crossfadeInProgress: snap.crossfadeInProgress,
        });
      }
    };

    // 즉시 첫 snapshot · 이후 60초 tick
    tick();
    const iv = window.setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      window.clearInterval(iv);
      enabledRef.current = false;
      audioDebugWarn('[audio:lifecycle:cleanup]', {
        elapsedMs: Math.round(performance.now() - startedAtRef.current),
        finalSnapshot: lastSummaryRef.current,
      });
    };
  }, []);

  const getLifecycleSummary = useCallback((): LifecycleSnapshot => {
    // Dashboard 폴링용 — flag OFF 이면 lastSummaryRef=null 상태이므로 즉석 build.
    // 단, 폴링 자체는 Dashboard 가 별도 flag gate 안에서만 함.
    if (lastSummaryRef.current) return lastSummaryRef.current;
    // fallback: 즉석 build (heap growth 는 0 으로 계산)
    const c = inputsRef.current;
    const nowMs = performance.now();
    const activeIdx = c.getActiveIdx();
    const activeEl = activeIdx === 0 ? c.audioARef.current : c.audioBRef.current;
    const inactiveEl = activeIdx === 0 ? c.audioBRef.current : c.audioARef.current;
    const a = slotSnap(activeEl);
    const b = slotSnap(inactiveEl);
    const heap = readHeap();
    return {
      startedAtMs: startedAtRef.current,
      elapsedMs: Math.round(nowMs - startedAtRef.current),
      mountedAudioCount: ((c.audioARef.current ? 1 : 0) + (c.audioBRef.current ? 1 : 0)) as 0 | 1 | 2,
      activeAudioObjectId: activeEl ? getAudioObjectId(activeEl) : '<null>',
      inactiveAudioObjectId: inactiveEl ? getAudioObjectId(inactiveEl) : '<null>',
      activeSrc: a.currentSrc,
      inactiveSrc: b.currentSrc,
      activePaused: a.paused,
      inactivePaused: b.paused,
      activeReadyState: a.readyState,
      inactiveReadyState: b.readyState,
      activeNetworkState: a.networkState,
      inactiveNetworkState: b.networkState,
      activeSinkId: a.sinkId,
      inactiveSinkId: b.sinkId,
      crossfadeInProgress: c.getCrossfading(),
      crossfadeStartedAtMs: c.getCrossfadeStartedAtMs(),
      crossfadeElapsedMs: c.getCrossfadeStartedAtMs() > 0 ? Math.round(nowMs - c.getCrossfadeStartedAtMs()) : 0,
      rAFActive: c.getRafActive(),
      timeoutActive: c.getTimeoutActive(),
      longRunActive: c.getLongRunActive(),
      dashboardActive: c.getDashboardActive(),
      heapUsedBytes: heap.used,
      heapTotalBytes: heap.total,
      heapLimitBytes: heap.limit,
      heapGrowthFromStartBytes: 0,
      listenerAttachCount: c.getListenerAttachCount(),
      listenerDetachCount: c.getListenerDetachCount(),
      listenerDiff: c.getListenerAttachCount() - c.getListenerDetachCount(),
      potentialLeaks: [],
    };
  }, []);

  return { getLifecycleSummary };
}
