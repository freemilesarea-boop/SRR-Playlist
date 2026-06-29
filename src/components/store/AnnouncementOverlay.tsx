/**
 * AnnouncementOverlay — Priority 5 (Announcement Audio Scheduler V1).
 *
 * 매장 플레이어에 안전하게 부착되는 광고/안내 음원 오버레이.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Trigger 정책 (2026-06 reliability fix)
 * ─────────────────────────────────────────────────────────────────────────────
 *  실행 채널 3가지 — 어느 하나라도 발화하면 안내음 재생:
 *
 *  (1) 폴링 채널  : POLL_INTERVAL_MS (10s) 마다 store_get_due_announcements 호출.
 *                  due 가 비어있지 않으면 evaluateTrigger('poll') 실행.
 *
 *  (2) 트랙 전환  : usePlayerStore.subscribe 로 queue[index].id 변경 감지.
 *                  변경 즉시 evaluateTrigger('track_change') — 자연스러운 삽입.
 *
 *  (3) Grace tick : TICK_INTERVAL_MS (5s) 마다 local tick.
 *                  due 가 GRACE_PERIOD_MS (60s) 이상 유지되면 강제 interrupt.
 *
 *  서버 측 _announcement_is_due_now (0386 hotfix 후 window=15min) 가
 *  scheduled_time <= now <= scheduled_time + 15min 범위를 판정.
 *  클라이언트는 서버 판정을 신뢰하고, 같은 schedule_id 가 비어있던 상태에서
 *  처음 등장한 시각 (dueFirstSeenAt) 부터 grace 를 측정.
 *
 *  대단순 비교 (now.minute === scheduled.minute) 는 사용하지 않음 —
 *  interval 비교 (lastSeen <= scheduledTime <= now + window) 는 서버가 처리하고,
 *  클라이언트는 "서버가 due 라고 답한 시점부터의 경과 시간" 을 기준으로 판단.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Recovery (놓침 복구)
 * ─────────────────────────────────────────────────────────────────────────────
 *  - 15min 서버 window 안에 매장이 polling 만 하면 반드시 한 번은 due 감지.
 *  - 감지 후 60s 안에 트랙 전환이 없으면 force-interrupt 로 발화.
 *  - max_plays_per_day + 5min 서버 debounce 가 중복 실행 차단 (안전).
 *  - 매장 reload / overlay remount 시 dueFirstSeenAt 은 리셋되지만,
 *    같은 schedule 이 여전히 due 이면 다음 poll 부터 다시 카운팅 시작.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 디버그
 * ─────────────────────────────────────────────────────────────────────────────
 *  localStorage.setItem('debug', 'announcement-overlay') 로 활성화 또는
 *  props.debug = true.
 *  콘솔 출력:
 *    [announcement-overlay] eval {source, schedule_id, scheduled_time(서버 NOW),
 *      now, last_poll_at, first_seen_at, elapsed_ms, grace_ms,
 *      current_track_id, is_playing, today_count, max_plays_per_day,
 *      shouldTrigger, reason}
 *
 *  실패 디버깅 시나리오:
 *    daily:HH:MM 예약 후 HH:MM-1 / HH:MM / HH:MM+1 콘솔 확인:
 *      - HH:MM-1 → eval 없음 또는 due=0
 *      - HH:MM    → eval poll, dueFirstSeenAt 기록, shouldTrigger=false (대기)
 *      - HH:MM+1  → eval poll/tick, elapsed 누적, 트랙 전환 시 fire
 *      - HH:MM+1m → 트랙 전환 없으면 grace 초과로 force-interrupt
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 절대 무수정
 * ─────────────────────────────────────────────────────────────────────────────
 *  Player.tsx / queue / crossfade / 추천 / AI / artist settlement / stream count.
 *  안내음 재생 동안 BGM 은 paused — stream count 영향 없음.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import {
  getDueAnnouncements, markAnnouncementPlayed,
  type DueAnnouncement,
} from '@/lib/api/announcementApi';

const POLL_INTERVAL_MS = 10_000;  // 서버 due 폴링 주기
const TICK_INTERVAL_MS = 5_000;   // local grace tick (서버 호출 없음)
const GRACE_PERIOD_MS  = 60_000;  // due 감지 후 자연 트랙 전환을 기다리는 최대 시간

export interface AnnouncementOverlayProps {
  /** 매장 사용자 id (auth.uid()). null 이면 비활성. */
  storeId: string | null;
  /** 디버그 로그 활성화 (또는 localStorage 'debug' === 'announcement-overlay'). */
  debug?: boolean;
}

export default function AnnouncementOverlay({ storeId, debug = false }: AnnouncementOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [due, setDue] = useState<DueAnnouncement[]>([]);
  const [active, setActive] = useState<DueAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trigger 추적 refs (poll/tick/track-change 모두 공유)
  const playingRef        = useRef(false);          // overlay 자체 재생 중 flag
  const dueRef            = useRef<DueAnnouncement[]>([]);  // 최신 due 스냅샷
  const dueFirstSeenAtRef = useRef<Map<string, number>>(new Map()); // schedule_id → ms timestamp
  const lastPollAtRef     = useRef<number>(0);
  const lastServerNowRef  = useRef<string | null>(null);
  const lastTrackIdRef    = useRef<string | null>(null);

  // due state 와 dueRef 동기화 (tick/subscribe 가 항상 최신 due 참조)
  useEffect(() => { dueRef.current = due; }, [due]);

  const debugEnabled = useCallback((): boolean => {
    if (debug) return true;
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('debug') === 'announcement-overlay';
    } catch { return false; }
  }, [debug]);

  const log = useCallback((...args: unknown[]) => {
    if (debugEnabled()) console.log('[announcement-overlay]', ...args);
  }, [debugEnabled]);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 재생 시작
  // ───────────────────────────────────────────────────────────────────────
  const startAnnouncement = useCallback((ann: DueAnnouncement, reason: string) => {
    if (playingRef.current) return;
    const a = audioRef.current;
    if (!a) return;
    playingRef.current = true;
    setActive(ann);

    log('start', {
      schedule_id: ann.schedule_id,
      asset_title: ann.asset_title,
      reason,
    });

    // BGM 일시정지
    try {
      usePlayerStore.getState().pause();
    } catch (e) {
      log('pause BGM failed', e);
    }

    a.src = ann.asset_file_url;
    a.volume = 1.0;
    a.currentTime = 0;
    void a.play().catch((e) => {
      log('play announcement failed', e);
      void markAnnouncementPlayed(ann.schedule_id, ann.asset_id, 'failed', (e as Error).message)
        .catch(() => undefined);
      playingRef.current = false;
      setActive(null);
      try { usePlayerStore.getState().play(); } catch (_e) { void _e; }
    });
  }, [log]);

  // ───────────────────────────────────────────────────────────────────────
  // 폴링: 서버에서 due 새로 가져오기
  // ───────────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!storeId) return;
    const startedAt = performance.now();
    try {
      const r = await getDueAnnouncements(storeId);
      const next = r.data ?? [];
      const nowMs = startedAt;  // 초기 호출 시각으로 통일 (Date.now 회피 시 ref 기반 카운팅)
      lastPollAtRef.current = nowMs;
      lastServerNowRef.current = r.now_at ?? null;

      // dueFirstSeenAt 갱신: 새 schedule 등장 시 now 기록, 사라진 schedule 은 제거
      const seen = dueFirstSeenAtRef.current;
      const liveIds = new Set(next.map(d => d.schedule_id));
      for (const id of Array.from(seen.keys())) {
        if (!liveIds.has(id)) seen.delete(id);
      }
      for (const d of next) {
        if (!seen.has(d.schedule_id)) seen.set(d.schedule_id, nowMs);
      }

      setDue(next);
      setError(null);

      log('poll', {
        store_id: storeId,
        server_now: r.now_at,
        client_now_ms: Math.round(nowMs),
        due_count: next.length,
        due_ids: next.map(d => d.schedule_id),
      });
    } catch (e) {
      const msg = (e as Error).message;
      log('poll failed', msg);
      setError(msg);
    }
  }, [storeId, log]);

  // ───────────────────────────────────────────────────────────────────────
  // Trigger 평가 — poll / tick / track_change 어디서든 호출 가능
  // ───────────────────────────────────────────────────────────────────────
  const evaluateTrigger = useCallback((source: 'poll' | 'tick' | 'track_change' | 'initial') => {
    const dueNow = dueRef.current;
    if (playingRef.current) {
      log('eval skipped — already playing announcement', { source });
      return;
    }
    if (dueNow.length === 0) {
      // dueRef 가 비어있으면 굳이 매 tick 로그 찍지 않음 (noise)
      if (source !== 'tick') log('eval skipped — no due', { source });
      return;
    }

    const nowMs = performance.now();
    const next = dueNow[0];
    const firstSeen = dueFirstSeenAtRef.current.get(next.schedule_id) ?? nowMs;
    const elapsedMs = nowMs - firstSeen;

    const ps = usePlayerStore.getState();
    const currentTrack = ps.queue[ps.index] ?? null;
    const isPlaying = ps.playing;

    let shouldTrigger = false;
    let reason: string;

    if (!currentTrack) {
      shouldTrigger = true;
      reason = 'no_current_track';
    } else if (!isPlaying) {
      shouldTrigger = true;
      reason = 'player_paused';
    } else if (source === 'track_change') {
      shouldTrigger = true;
      reason = 'natural_track_change';
    } else if (elapsedMs >= GRACE_PERIOD_MS) {
      shouldTrigger = true;
      reason = `grace_exceeded (${Math.round(elapsedMs / 1000)}s >= ${GRACE_PERIOD_MS / 1000}s)`;
    } else {
      reason = `wait_for_track_change (${Math.round(elapsedMs / 1000)}s / ${GRACE_PERIOD_MS / 1000}s)`;
    }

    log('eval', {
      source,
      schedule_id: next.schedule_id,
      schedule_name: next.schedule_name,
      asset_title: next.asset_title,
      server_now: lastServerNowRef.current,
      client_now_ms: Math.round(nowMs),
      last_poll_at_ms: Math.round(lastPollAtRef.current),
      first_seen_at_ms: Math.round(firstSeen),
      elapsed_ms: Math.round(elapsedMs),
      grace_ms: GRACE_PERIOD_MS,
      current_track_id: currentTrack?.id ?? null,
      is_playing: isPlaying,
      today_count: next.today_count,
      max_plays_per_day: next.max_plays_per_day,
      shouldTrigger,
      reason,
    });

    if (shouldTrigger) startAnnouncement(next, reason);
  }, [log, startAnnouncement]);

  // due state 변경 직후마다 trigger 평가 (poll 완료 또는 finish 후 refresh)
  useEffect(() => { evaluateTrigger('poll'); }, [due, evaluateTrigger]);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 종료/실패 핸들러
  // ───────────────────────────────────────────────────────────────────────
  const finishAnnouncement = useCallback(async (
    status: 'played' | 'failed' | 'skipped',
    errorMsg?: string,
  ) => {
    const ann = active;
    if (!ann) return;
    playingRef.current = false;
    setActive(null);

    // 동일 schedule 즉시 재발화 방지: dueFirstSeenAt 에서 제거
    dueFirstSeenAtRef.current.delete(ann.schedule_id);

    try {
      await markAnnouncementPlayed(ann.schedule_id, ann.asset_id, status, errorMsg ?? null);
    } catch (e) {
      log('mark played failed', e);
    }

    // BGM 재개 (사용자가 직접 pause 한 게 아닌 경우만)
    try { usePlayerStore.getState().play(); } catch (e) { log('resume BGM failed', e); }

    // 서버 측 debounce + max_plays_per_day 반영하여 due 새로고침
    void refresh();
  }, [active, refresh, log]);

  // ───────────────────────────────────────────────────────────────────────
  // 폴링 effect (10s)
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [storeId, refresh]);

  // ───────────────────────────────────────────────────────────────────────
  // Grace tick effect (5s) — due 가 일정 시간 유지되면 force-interrupt
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    const id = window.setInterval(() => evaluateTrigger('tick'), TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [storeId, evaluateTrigger]);

  // ───────────────────────────────────────────────────────────────────────
  // 트랙 전환 감지 (자연 삽입 fast-path)
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    const unsub = usePlayerStore.subscribe((state) => {
      const cur = state.queue[state.index]?.id ?? null;
      const prev = lastTrackIdRef.current;
      lastTrackIdRef.current = cur;
      if (!cur || !prev || cur === prev) return;  // 트랙 변경 아님
      evaluateTrigger('track_change');
    });
    return unsub;
  }, [storeId, evaluateTrigger]);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 오디오 이벤트 wiring
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => void finishAnnouncement('played');
    const onError = () => void finishAnnouncement('failed', 'audio error');
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
  }, [finishAnnouncement]);

  if (!storeId) return null;

  return (
    <>
      <audio ref={audioRef} preload="auto" />

      {active && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-black/30"
        >
          <Volume2 size={12} className="animate-pulse" />
          안내방송 재생 중 · {active.asset_title}
        </div>
      )}

      {debugEnabled() && error && (
        <div className="fixed bottom-16 left-1/2 z-[120] -translate-x-1/2 rounded bg-rose-500/25 px-3 py-1 text-[10px] text-rose-200">
          announcement poll error: {error}
        </div>
      )}
    </>
  );
}
