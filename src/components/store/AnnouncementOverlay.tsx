/**
 * AnnouncementOverlay — Priority 5 (Announcement Audio Scheduler).
 *
 * 매장 플레이어에 안전하게 부착되는 광고/안내 음원 오버레이.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Trigger 정책 V2 (2026-06 — 00초 정밀 재생)
 * ─────────────────────────────────────────────────────────────────────────────
 *  목표: 예약 시각 HH:MM 이면 HH:MM:00 에 (오차 1~2초 이내) 즉시 재생.
 *        현재 매장음악이 재생 중이어도 기다리지 않고 즉시 pause/interrupt.
 *
 *  핵심 = client-side exact timer (setTimeout):
 *
 *  (1) 폴링(re-arm) : POLL_INTERVAL_MS (15s) 마다 store_get_upcoming_announcements 호출.
 *                     서버가 각 schedule 의 "정확한 scheduled_at + occurrence_key + now_at"
 *                     을 반환. 응답 now_at 으로 클라이언트 시계 오차(offset)를 보정.
 *
 *  (2) Exact timer  : scheduled_at 이 미래면 (targetEpoch - now) 만큼 setTimeout 예약.
 *                     timer 발화 = HH:MM:00 → reason 'exact_time_interrupt' 로 즉시 재생.
 *                     매 폴링마다 offset 을 갱신해 timer 를 re-arm (시계 보정).
 *
 *  (3) Late recovery: scheduled_at 이 이미 과거(놓침)지만 서버 recovery window(15min)
 *                     이내면 즉시 재생 → reason 'poll_late_recovery'.
 *                     (서버 폴링은 "놓친 예약 복구용" 백업 경로로만 동작.)
 *
 *  (4) Visibility    : 탭이 다시 보이면 즉시 re-arm (background throttle 보정).
 *
 *  중복 방지:
 *    - in-memory lock: occurrence_key ('<schedule_id>:YYYYMMDDTHHMM') 기준 firedKeys.
 *      한 occurrence 는 세션 내 1회만 발화 ('skipped_duplicate' 로 차단).
 *    - 서버: max_plays_per_day + 5min debounce (store_get_upcoming_announcements 내부 필터).
 *
 *  제거됨 (V1 → V2):
 *    - GRACE_PERIOD_MS (60s) 자연 트랙 전환 대기 → 즉시 interrupt 로 대체.
 *    - track_change fast-path / grace tick → exact timer 로 대체.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 로그 reason
 * ─────────────────────────────────────────────────────────────────────────────
 *    exact_time_interrupt  — 예약 시각 정시 (setTimeout) 발화
 *    poll_late_recovery    — 놓친 예약을 폴링으로 복구 발화
 *    skipped_duplicate     — 같은 occurrence 재발화 차단 (또는 다른 안내음 재생 중)
 *    player_not_ready      — audio element 미준비 (다음 폴링에서 재시도)
 *    audio_play_failed     — play() 실패 (autoplay block / 403 / decode 등)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 디버그
 * ─────────────────────────────────────────────────────────────────────────────
 *  localStorage.setItem('debug', 'announcement-overlay') 또는 props.debug = true.
 *  trigger reason 은 debug flag 와 무관하게 console.warn 으로 항상 출력.
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
  getUpcomingAnnouncements, markAnnouncementPlayed, resolveAnnouncementPlayableUrl,
  type UpcomingAnnouncement,
} from '@/lib/api/announcementApi';

const POLL_INTERVAL_MS    = 15_000;  // 서버 upcoming 폴링/타이머 re-arm 주기 (백업 + 시계 보정)
const LOOKAHEAD_SECONDS   = 900;     // 서버에 요청할 미래 occurrence 조회 범위 (15min)
const LEAD_ARM_MS         = 1_000;   // delay 가 이보다 크면 setTimeout 예약, 작으면 즉시 발화
const ON_TIME_TOLERANCE_MS = 3_000;  // 예약 시각 대비 이 범위 내 지각이면 'exact', 넘으면 'recovery'
const FIRED_KEY_TTL_MS    = 3_600_000; // firedKeys 보관 시간 (1h) — recovery window(15min) 보다 충분히 김

type TriggerReason =
  | 'exact_time_interrupt'
  | 'poll_late_recovery'
  | 'skipped_duplicate'
  | 'player_not_ready'
  | 'audio_play_failed';

/**
 * 안내음 재생 실패 reason 분류 — failure 로그 + DB 기록용.
 *
 * HTMLMediaElement.error.code:
 *   1 MEDIA_ERR_ABORTED / 2 MEDIA_ERR_NETWORK (403/404) /
 *   3 MEDIA_ERR_DECODE / 4 MEDIA_ERR_SRC_NOT_SUPPORTED (URL/권한)
 */
function classifyAnnouncementError(err: unknown, audio: HTMLAudioElement): string {
  const code = audio.error?.code ?? null;
  const name = (err as Error)?.name ?? '';
  if (name === 'NotAllowedError')   return 'autoplay_blocked';
  if (name === 'AbortError')        return 'play_aborted';
  if (code === 4) return 'reserved_track_audio_403';     // SRC_NOT_SUPPORTED
  if (code === 2) return 'reserved_track_audio_network'; // NETWORK
  if (code === 3) return 'reserved_track_audio_decode';
  if (code === 1) return 'reserved_track_audio_aborted';
  return 'reserved_track_audio_unknown';
}

export interface AnnouncementOverlayProps {
  /** 매장 사용자 id (auth.uid()). null 이면 비활성. */
  storeId: string | null;
  /** 디버그 로그 활성화 (또는 localStorage 'debug' === 'announcement-overlay'). */
  debug?: boolean;
}

export default function AnnouncementOverlay({ storeId, debug = false }: AnnouncementOverlayProps) {
  // 진입/언마운트 — debug flag 와 무관하게 항상 1회 출력 (운영 마운트 확인)
  useEffect(() => {
    console.warn('[announcement-overlay] mount', {
      store_id: storeId ? `${storeId.slice(0, 8)}…` : null,
      debug_prop: debug,
      poll_interval_ms: POLL_INTERVAL_MS,
      lookahead_seconds: LOOKAHEAD_SECONDS,
      trigger: 'exact-timer-v2',
    });
    return () => console.warn('[announcement-overlay] unmount', {
      store_id: storeId ? `${storeId.slice(0, 8)}…` : null,
    });
  }, [storeId, debug]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<UpcomingAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trigger 추적 refs
  const playingRef       = useRef(false);                      // overlay 자체 재생 중 flag
  const activeRef        = useRef<UpcomingAnnouncement | null>(null); // finish 핸들러용 최신 active
  const serverOffsetRef  = useRef(0);                          // serverNowEpoch - clientNowEpoch (ms)
  const timersRef        = useRef<Map<string, number>>(new Map());  // occurrence_key → setTimeout id
  const firedKeysRef     = useRef<Map<string, number>>(new Map());  // occurrence_key → fired client epoch

  useEffect(() => { activeRef.current = active; }, [active]);

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

  // trigger reason 은 항상 출력 (운영 진단 — 'exact_time_interrupt' 등 확인용)
  const logTrigger = useCallback((reason: TriggerReason, data: Record<string, unknown>) => {
    console.warn('[announcement-overlay] trigger', { reason, ...data });
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 종료/실패 핸들러 (startAnnouncement 보다 먼저 선언 — 의존성 순서)
  // ───────────────────────────────────────────────────────────────────────
  const finishAnnouncement = useCallback(async (
    status: 'played' | 'failed' | 'skipped',
    errorMsg?: string,
  ) => {
    const ann = activeRef.current;
    if (!ann) return;
    playingRef.current = false;
    setActive(null);

    try {
      await markAnnouncementPlayed(ann.schedule_id, ann.asset_id, status, errorMsg ?? null);
    } catch (e) {
      log('mark played failed', e);
    }

    // BGM 재개 (안내음 재생 전 우리가 pause 했으므로 복귀)
    try { usePlayerStore.getState().play(); } catch (e) { log('resume BGM failed', e); }
  }, [log]);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 재생 시작 — 현재 BGM 즉시 interrupt(pause) 후 안내음 우선 재생.
  //
  // 0387: 저장된 file_url 이 만료된 signed URL 인 케이스 → file_path 기반 fresh URL 우선.
  // ───────────────────────────────────────────────────────────────────────
  const startAnnouncement = useCallback((ann: UpcomingAnnouncement, reason: TriggerReason) => {
    const a = audioRef.current;
    if (!a) {
      // audio element 미준비 — firedKey 해제하여 다음 폴링에서 재시도
      logTrigger('player_not_ready', { schedule_id: ann.schedule_id, occurrence_key: ann.occurrence_key });
      firedKeysRef.current.delete(ann.occurrence_key);
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    setActive(ann);

    logTrigger(reason, {
      schedule_id: ann.schedule_id,
      occurrence_key: ann.occurrence_key,
      asset_title: ann.asset_title,
      scheduled_at: ann.scheduled_at,
      offset_ms: Math.round(serverOffsetRef.current),
    });

    // 현재 매장음악 즉시 interrupt (자연 종료 대기 없음)
    try {
      usePlayerStore.getState().pause();
    } catch (e) {
      log('pause BGM failed', e);
    }

    void (async () => {
      // 매 재생 직전 fresh URL 발급 (저장된 signed URL 만료 회피)
      const resolved = await resolveAnnouncementPlayableUrl(ann.asset_file_path, ann.asset_file_url);
      console.warn('[announcement-overlay] resolved url', {
        schedule_id: ann.schedule_id,
        url_source: resolved.source,
        url_head:   resolved.url.substring(0, 160),
        fallback_reason: resolved.reason ?? null,
      });

      a.src = resolved.url;
      a.volume = 1.0;
      a.currentTime = 0;

      void a.play().then(() => {
        console.warn('[announcement-overlay] play started', {
          schedule_id: ann.schedule_id,
          duration: a.duration,
          ready_state: a.readyState,
        });
      }).catch((playErr) => {
        const failReason = classifyAnnouncementError(playErr, a);
        const errorMsg = `${failReason} :: ${(playErr as Error).message}`;
        logTrigger('audio_play_failed', {
          schedule_id: ann.schedule_id,
          asset_id: ann.asset_id,
          occurrence_key: ann.occurrence_key,
          url_source: resolved.source,
          url_head: resolved.url.substring(0, 160),
          audio_error_code: a.error?.code ?? null,
          classify: failReason,
          js_error_name: (playErr as Error)?.name ?? null,
          js_error_message: (playErr as Error)?.message ?? null,
        });
        // failed 기록 (last_played_at 은 played 만 갱신 → debounce 영향 없음).
        // firedKey 는 유지하여 같은 occurrence 무한 재시도 방지 (occurrence 당 1회 시도).
        void finishAnnouncement('failed', errorMsg);
      });
    })();
  }, [log, logTrigger, finishAnnouncement]);

  // ───────────────────────────────────────────────────────────────────────
  // occurrence 발화 — in-memory lock + 단일 재생 보장
  // ───────────────────────────────────────────────────────────────────────
  const fireOccurrence = useCallback((item: UpcomingAnnouncement, reason: TriggerReason) => {
    const key = item.occurrence_key;

    // 예약된 timer 가 있으면 정리 (즉시 발화 또는 timer 콜백 진입 모두 여기로 수렴)
    const t = timersRef.current.get(key);
    if (t !== undefined) { clearTimeout(t); timersRef.current.delete(key); }

    if (firedKeysRef.current.has(key)) {
      logTrigger('skipped_duplicate', { occurrence_key: key, note: 'already fired this occurrence' });
      return;
    }
    if (playingRef.current) {
      // 다른 안내음 재생 중 — firedKey 잠그지 않고 종료 후 폴링 복구에 맡김
      logTrigger('skipped_duplicate', { occurrence_key: key, note: 'overlay busy, will recover via poll' });
      return;
    }

    firedKeysRef.current.set(key, Date.now());
    startAnnouncement(item, reason);
  }, [logTrigger, startAnnouncement]);

  // ───────────────────────────────────────────────────────────────────────
  // 폴링 + exact timer re-arm
  // ───────────────────────────────────────────────────────────────────────
  const armUpcoming = useCallback(async () => {
    if (!storeId) return;
    try {
      const r = await getUpcomingAnnouncements(storeId, LOOKAHEAD_SECONDS);
      const items = r.data ?? [];

      // 서버 시계 오차 보정: offset = serverNow - clientNow (ms)
      const serverNow = r.now_at ? Date.parse(r.now_at) : NaN;
      if (!Number.isNaN(serverNow)) serverOffsetRef.current = serverNow - Date.now();
      const offset = serverOffsetRef.current;

      const liveKeys = new Set(items.map((i) => i.occurrence_key));

      // 더 이상 upcoming 이 아닌 occurrence 의 timer 정리
      for (const [key, tid] of Array.from(timersRef.current.entries())) {
        if (!liveKeys.has(key)) { clearTimeout(tid); timersRef.current.delete(key); }
      }
      // firedKeys TTL 정리 (메모리 bound — recovery window 보다 충분히 길게 보관 후 제거)
      const nowMs = Date.now();
      for (const [key, firedAt] of Array.from(firedKeysRef.current.entries())) {
        if (nowMs - firedAt > FIRED_KEY_TTL_MS) firedKeysRef.current.delete(key);
      }

      log('poll-upcoming', {
        server_now: r.now_at,
        offset_ms: Math.round(offset),
        count: items.length,
        keys: items.map((i) => i.occurrence_key),
      });

      for (const item of items) {
        const key = item.occurrence_key;
        if (firedKeysRef.current.has(key)) continue;

        const sched = Date.parse(item.scheduled_at);
        if (Number.isNaN(sched)) continue;

        // 클라이언트 시계 기준 목표 시각 = server 절대시각 - offset
        const targetClient = sched - offset;
        const delay = targetClient - Date.now();

        if (delay > LEAD_ARM_MS) {
          // 미래 → 정확히 그 시각에 발화하도록 (re-)arm
          const existing = timersRef.current.get(key);
          if (existing !== undefined) clearTimeout(existing);
          const tid = window.setTimeout(() => fireOccurrence(item, 'exact_time_interrupt'), delay);
          timersRef.current.set(key, tid);
          log('armed', { occurrence_key: key, delay_ms: Math.round(delay), scheduled_at: item.scheduled_at });
        } else if (delay > -ON_TIME_TOLERANCE_MS) {
          // 거의 정시 (도래 직전 ~ 3초 이내 지각) → 정시 발화
          fireOccurrence(item, 'exact_time_interrupt');
        } else {
          // 놓침 (3초 초과 지각, recovery window 내) → 복구 발화
          fireOccurrence(item, 'poll_late_recovery');
        }
      }
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      log('poll-upcoming failed', msg);
    }
  }, [storeId, fireOccurrence, log]);

  // ───────────────────────────────────────────────────────────────────────
  // 폴링 effect (15s) — 초기 1회 + 주기 re-arm. cleanup 시 모든 timer 해제.
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    void armUpcoming();
    const id = window.setInterval(() => void armUpcoming(), POLL_INTERVAL_MS);
    const timers = timersRef.current;
    return () => {
      window.clearInterval(id);
      for (const tid of timers.values()) clearTimeout(tid);
      timers.clear();
    };
  }, [storeId, armUpcoming]);

  // ───────────────────────────────────────────────────────────────────────
  // Visibility 변경 — 탭이 다시 보이면 즉시 re-arm (background timer throttle 보정)
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        log('visibility → re-arm');
        void armUpcoming();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [storeId, armUpcoming, log]);

  // ───────────────────────────────────────────────────────────────────────
  // 안내음 오디오 이벤트 wiring
  // ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => {
      // 종료 후 다음 occurrence (놓침/연속 예약) 즉시 복구 평가
      void finishAnnouncement('played').then(() => void armUpcoming());
    };
    const onError = () => {
      if (!playingRef.current) return;
      const reason = classifyAnnouncementError(new Error('media error'), a);
      logTrigger('audio_play_failed', {
        classify: reason,
        audio_error_code: a.error?.code ?? null,
        audio_error_message: a.error?.message ?? null,
        src_head: a.src.substring(0, 120),
      });
      void finishAnnouncement('failed', `${reason} :: media error (code=${a.error?.code ?? 'null'})`);
    };
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
  }, [finishAnnouncement, armUpcoming, logTrigger]);

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
