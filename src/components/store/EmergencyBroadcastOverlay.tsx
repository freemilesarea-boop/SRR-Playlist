/**
 * EmergencyBroadcastOverlay — Emergency Broadcast V1 (Priority 7).
 *
 * 매장 플레이어 안전 overlay. Player.tsx / queue / crossfade 무수정.
 *
 * 동작:
 *   1) 5초 polling (페이지 visible + storeId 존재 시)
 *   2) active emergency broadcast 감지 → 같은 broadcast_id 이미 재생했으면 skip
 *   3) interrupt_mode 별 처리:
 *        fade_out: 500ms 볼륨 fade → BGM pause → 긴급 audio 재생
 *        pause:    BGM 즉시 pause → 긴급 audio 재생
 *        after_current_track: V1 한정 → pause 와 동일하게 즉시 재생 (다음 곡 전 삽입은 V2)
 *   4) ended: store_mark_emergency_broadcast_status('played') → BGM volume 복원 + play
 *   5) error 또는 timeout(5분): mark 'failed' → BGM 복원
 *
 * 안전장치:
 *   - 별도 <audio> ref (BGM audio 와 분리)
 *   - sessionStorage 로 played broadcast_ids dedup
 *   - max-duration 5분 timeout (런어웨이 방지)
 *   - audio load/play 실패 시 BGM 영향 0 (mark failed + resume)
 *   - 한 번에 한 방송만 (busyRef)
 *   - stream count / artist settlement 호출 0 (별도 audio element)
 *   - 페이지 hidden 시 polling stop
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, AlertCircle } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import {
  getActiveEmergencyBroadcast, markEmergencyBroadcastStatus,
  type ActiveBroadcastPayload,
} from '@/lib/api/emergencyBroadcastApi';

const POLL_INTERVAL_MS = 5_000;
const FADE_OUT_MS = 500;
const MAX_PLAYBACK_MS = 5 * 60 * 1000;  // 5분 안전 timeout
const DEDUP_KEY = 'srr.emergency.played.v1';

function loadDedupSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DEDUP_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDedupSet(s: Set<string>): void {
  try { sessionStorage.setItem(DEDUP_KEY, JSON.stringify(Array.from(s))); } catch { void 0; }
}

export interface EmergencyBroadcastOverlayProps {
  storeId: string | null;
  debug?: boolean;
}

export default function EmergencyBroadcastOverlay({ storeId, debug = false }: EmergencyBroadcastOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<ActiveBroadcastPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );

  const busyRef       = useRef(false);
  const dedupRef      = useRef<Set<string>>(loadDedupSet());
  const restoreVolRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const fadeTimerRef  = useRef<number | null>(null);
  const maxTimerRef   = useRef<number | null>(null);
  // forward-decl ref so startBroadcast can call finishBroadcast without circular ref
  const finishRef = useRef<((s: 'played' | 'failed' | 'skipped', m?: string | null) => Promise<void>) | null>(null);

  const log = useCallback((...args: unknown[]) => {
    if (debug) console.log('[emergency-overlay]', ...args);
  }, [debug]);

  // visibility
  useEffect(() => {
    const onVis = () => setVisible(typeof document === 'undefined' ? true : !document.hidden);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, []);

  // BGM 상태 저장 → emergency 재생
  const startBroadcast = useCallback((b: ActiveBroadcastPayload) => {
    if (busyRef.current) return;
    if (dedupRef.current.has(b.broadcast_id)) {
      log('skip — already played in this session', b.broadcast_id);
      return;
    }
    const a = audioRef.current;
    if (!a) return;

    busyRef.current = true;
    setActive(b);
    setError(null);

    const player = usePlayerStore.getState();
    restoreVolRef.current = player.volume;
    wasPlayingRef.current = player.playing;
    log('starting broadcast', { id: b.broadcast_id, mode: b.interrupt_mode, prevPlaying: wasPlayingRef.current });

    const beginPlay = () => {
      // emergency audio play
      a.src = b.file_url;
      a.volume = 1.0;
      a.currentTime = 0;

      // optimistic playing 상태 mark
      void markEmergencyBroadcastStatus(b.broadcast_id, 'playing', null, deviceInfo()).catch((e) =>
        log('mark playing failed', e),
      );

      // safety timeout (5분)
      maxTimerRef.current = window.setTimeout(() => {
        log('max playback timeout — forcing finish');
        void finishRef.current?.('failed', 'max playback timeout (5 min)');
      }, MAX_PLAYBACK_MS);

      void a.play().catch((e) => {
        log('autoplay/play failed', e);
        void finishRef.current?.('failed', (e as Error).message);
      });
    };

    // interrupt mode 분기
    if (b.interrupt_mode === 'fade_out') {
      // 0.5s 볼륨 fade → pause → play
      const startVol = player.volume;
      const steps = 10;
      const stepMs = FADE_OUT_MS / steps;
      let i = 0;
      const tick = () => {
        i += 1;
        const next = Math.max(0, startVol * (1 - i / steps));
        try { usePlayerStore.getState().setVolume(next); } catch { void 0; }
        if (i >= steps) {
          if (fadeTimerRef.current) window.clearInterval(fadeTimerRef.current);
          fadeTimerRef.current = null;
          try { usePlayerStore.getState().pause(); } catch { void 0; }
          beginPlay();
        }
      };
      fadeTimerRef.current = window.setInterval(tick, stepMs);
    } else {
      // 'pause' 또는 'after_current_track' (V1 동일 처리)
      try { usePlayerStore.getState().pause(); } catch { void 0; }
      beginPlay();
    }
  }, [log]);

  // emergency 종료 → BGM 복귀
  const finishBroadcast = useCallback(async (status: 'played' | 'failed' | 'skipped', errMsg?: string | null) => {
    const b = active;
    if (!b) return;

    // 타이머 정리
    if (fadeTimerRef.current) { window.clearInterval(fadeTimerRef.current); fadeTimerRef.current = null; }
    if (maxTimerRef.current)  { window.clearTimeout(maxTimerRef.current);  maxTimerRef.current  = null; }

    const a = audioRef.current;
    if (a) {
      try { a.pause(); } catch { void 0; }
      try { a.removeAttribute('src'); a.load(); } catch { void 0; }
    }

    // dedup 등록
    dedupRef.current.add(b.broadcast_id);
    saveDedupSet(dedupRef.current);

    setActive(null);
    busyRef.current = false;

    // 서버 mark
    try {
      await markEmergencyBroadcastStatus(b.broadcast_id, status, errMsg ?? null, deviceInfo());
    } catch (e) {
      log('mark status failed', e);
    }

    // BGM 복원
    try {
      if (restoreVolRef.current != null) usePlayerStore.getState().setVolume(restoreVolRef.current);
      if (wasPlayingRef.current) usePlayerStore.getState().play();
    } catch (e) {
      log('BGM resume failed', e);
    }
    restoreVolRef.current = null;
    wasPlayingRef.current = false;
  }, [active, log]);

  // expose latest finishBroadcast via ref (forward-decl pattern)
  useEffect(() => { finishRef.current = finishBroadcast; }, [finishBroadcast]);

  // polling
  const poll = useCallback(async () => {
    if (!storeId) return;
    if (busyRef.current) return;
    try {
      const r = await getActiveEmergencyBroadcast(storeId, deviceInfo());
      setError(null);
      if (r.broadcast && !dedupRef.current.has(r.broadcast.broadcast_id)) {
        log('poll → active', r.broadcast.broadcast_id);
        startBroadcast(r.broadcast);
      }
    } catch (e) {
      const msg = (e as Error).message;
      log('poll failed', msg);
      setError(msg);
    }
  }, [storeId, startBroadcast, log]);

  useEffect(() => {
    if (!storeId || !visible) return;
    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [storeId, visible, poll]);

  // audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => void finishBroadcast('played');
    const onError = () => void finishBroadcast('failed', 'audio element error');
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
  }, [finishBroadcast]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) window.clearInterval(fadeTimerRef.current);
      if (maxTimerRef.current)  window.clearTimeout(maxTimerRef.current);
    };
  }, []);

  if (!storeId) return null;

  return (
    <>
      <audio ref={audioRef} preload="auto" />

      {active && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-0 top-0 z-[130] flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-black/40"
        >
          <Megaphone size={16} className="animate-pulse" />
          <div className="flex flex-col">
            <span>긴급 방송 송출 중 — {active.title}</span>
            {active.message && <span className="text-[11px] font-normal opacity-90">{active.message}</span>}
          </div>
        </div>
      )}

      {debug && error && (
        <div className="fixed bottom-24 left-1/2 z-[130] -translate-x-1/2 rounded bg-rose-500/25 px-3 py-1 text-[10px] text-rose-200">
          <AlertCircle size={10} className="inline mr-1" />
          emergency poll error: {error}
        </div>
      )}
    </>
  );
}

function deviceInfo(): Record<string, unknown> {
  try {
    return {
      ua: navigator.userAgent,
      lang: navigator.language,
      online: navigator.onLine,
      ts: new Date().toISOString(),
    };
  } catch {
    return {};
  }
}
