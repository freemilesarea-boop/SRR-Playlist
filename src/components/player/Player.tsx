import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  ChevronUp,
  ChevronDown,
  ListMusic,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { useModalA11y } from '@/hooks/useModalA11y';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
import { gradientStyle } from '@/lib/cover';
import { trackStream, recordPlaylistQualifiedView, getAnonymousId } from '@/lib/analytics';
import { logPlaybackEventV2 } from '@/lib/playbackEventsV2';
import {
  pushRecentlyPlayed,
  saveContinueListening,
  clearContinueListening,
} from '@/lib/libraryApi';
import { recommendSimilarTracks } from '@/lib/recommendationApi';
import { recordTrackSkip, recordBusinessEarlySkip, type SkipReason } from '@/lib/skipApi';
import { recordPlayEvent } from '@/lib/aiCuration';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import ShareButton from '@/components/ShareButton';
import AddToPlaylistButton from '@/components/AddToPlaylistButton';
import { resolveMembership, PREVIEW_LIMIT_SECONDS } from '@/lib/membership';
import { useGateStore } from '@/store/gateStore';
import { trackShareUrl } from '@/lib/shareApi';
import { toast } from '@/store/toastStore';

/** HTMLMediaElement.error.code → 사람 읽기용 이름 */
const MEDIA_ERROR_CODES: Record<number, string> = {
  1: 'ABORTED',
  2: 'NETWORK',
  3: 'DECODE',
  4: 'SRC_NOT_SUPPORTED',
};

/**
 * 세션당 1회만 실패 처리되는 트랙 id 집합.
 * 모듈 스코프라 페이지 이동/컴포넌트 언마운트해도 유지 (브라우저 탭 단위).
 * SRC_NOT_SUPPORTED / DECODE 등 "재생 불가" 가 확정된 트랙을 같은 세션에서
 * 자동 next 무한 루프로 다시 시도하지 않게 한다.
 */
const sessionFailedTrackIds = new Set<string>();

/** 재생 에러 토스트 디바운스 — 연속 실패 시 토스트 스택 방지(같은 메시지 1개). */
let lastErrorToastAt = 0;
const ERROR_TOAST_DEBOUNCE_MS = 3_000;

/**
 * 0091-fix — 추천 toast dedup (세션 / 10분).
 * 큐 끝 → 추천 추가 → 다시 끝 → 또 추가 시 toast 폭주 방지.
 */
let lastRecommendToastAt = 0;
const RECOMMEND_TOAST_DEDUP_MS = 10 * 60 * 1000;

/** 큐 안에서 next index 계산 (shuffle/repeat 반영) — 미리보기용 (실제 next() 와 동일 로직) */
function computeNextIndex(
  queueLength: number,
  index: number,
  shuffle: boolean,
  shuffleOrder: number[],
  repeat: 'off' | 'all' | 'one',
): number | null {
  if (queueLength === 0) return null;
  if (repeat === 'one') return index;
  if (shuffle && shuffleOrder.length === queueLength) {
    const pos = shuffleOrder.indexOf(index);
    const nextPos = pos + 1;
    if (nextPos >= shuffleOrder.length) return repeat === 'all' ? shuffleOrder[0] : null;
    return shuffleOrder[nextPos];
  }
  if (index + 1 >= queueLength) return repeat === 'all' ? 0 : null;
  return index + 1;
}

export default function Player() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const [activeIdx, setActiveIdx] = useState<0 | 1>(0); // 0=A, 1=B
  const activeRef = () => (activeIdx === 0 ? audioARef.current : audioBRef.current);
  const nextRef = () => (activeIdx === 0 ? audioBRef.current : audioARef.current);

  const {
    queue,
    index,
    playlist,
    playlistContext,
    playing,
    shuffle,
    repeat,
    volume,
    currentTime,
    duration,
    shuffleOrder,
    pendingSeekSec,
    play,
    pause,
    toggle,
    next,
    prev,
    jumpTo,
    setShuffle,
    setRepeat,
    setVolume,
    toggleMute,
    setCurrentTime,
    setDuration,
    setPendingSeek,
  } = usePlayerStore();

  const { crossfadeEnabled, crossfadeSeconds, autoplayRecommendations } = usePlaybackSettingsStore();

  const current = queue[index];
  const playable = isPlayableUrl(current?.audio_url);
  const [expanded, setExpanded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [errored, setErrored] = useState(false);
  const [crossfading, setCrossfading] = useState(false);

  // X6.48: expanded full-screen player Esc + focus trap (a11y)
  // Esc 시 nested queue overlay 먼저 close, 없으면 expanded close
  const expandedRef = useRef<HTMLDivElement>(null);
  useModalA11y(expandedRef, {
    onClose: () => (showQueue ? setShowQueue(false) : setExpanded(false)),
    enabled: expanded,
  });

  // DEV 전용 — 콘솔에서 audio 상태를 직접 들여다보기 위한 진단 헬퍼.
  // 사용: window.__playerDiag() → { active: {currentSrc, currentTime, volume, muted, ...}, next, store }
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __playerDiag?: () => unknown };
    w.__playerDiag = () => {
      const a = activeRef();
      const n = nextRef();
      return {
        active: a ? { currentSrc: a.currentSrc, currentTime: a.currentTime, duration: a.duration, paused: a.paused, muted: a.muted, volume: a.volume, readyState: a.readyState, networkState: a.networkState, ended: a.ended } : null,
        next: n ? { currentSrc: n.currentSrc, paused: n.paused, volume: n.volume } : null,
        store: { playing, crossfading, activeIdx, currentTrackId: current?.id, currentTrackTitle: current?.title, currentTrackUrl: current?.audio_url },
      };
    };
    return () => { try { delete (w as { __playerDiag?: () => unknown }).__playerDiag; } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, playing, crossfading, current?.id]);

  // 0078 — 미니 플레이어 볼륨 popover
  const [volumePopover, setVolumePopover] = useState(false);
  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const volumePopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!volumePopover) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (volumeBtnRef.current?.contains(t)) return;
      if (volumePopoverRef.current?.contains(t)) return;
      setVolumePopover(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [volumePopover]);

  // 0104 — 구독 게이트: anonymous 차단 / free 25초 미리듣기
  const session = useAuthStore((s) => s.session);
  const gateProfile = useAuthStore((s) => s.profile);
  const membership = resolveMembership(session, gateProfile);
  const openGate = useGateStore((s) => s.open);
  const pvTrackIdRef = useRef<string | null>(null);
  const previewSecRef = useRef(0);
  const previewBlockedRef = useRef(false);
  const previewLastTRef = useRef(0);

  const skipChainRef = useRef(0);
  useEffect(() => {
    if (playable) skipChainRef.current = 0;
  }, [current?.id, playable]);

  /* ---------- 스킵률 기반 메타데이터 위반 감지 (silent, fire-and-forget) ---------- */
  // 직전 트랙의 재생 진행도 스냅샷 (onTimeUpdate 가 갱신). 트랙 변경 시 스킵 판정에 사용.
  const skipProgressRef = useRef<{ id: string; played: number; duration: number } | null>(null);
  // 자연 종료(onEnded)로 넘어간 트랙 id — 스킵 아님.
  const naturalEndRef = useRef<string | null>(null);
  // 이전 버튼으로 넘어간 경우 — 스킵 아님 (one-shot).
  const prevPressedRef = useRef(false);
  // 다음 트랙 변경의 스킵 사유 (다음 버튼=manual_skip / 큐에서 다른 곡 선택=select_other).
  const skipReasonRef = useRef<SkipReason>('manual_skip');
  // 스킵 판정 중복 방지용 — 현재 트랙 id 기준으로 직전 트랙 1회만 평가.
  const prevTrackIdForSkipRef = useRef<string | null>(null);

  useEffect(() => {
    setErrored(false);
  }, [current?.id]);

  /* ---------- 0104 구독 게이트 ---------- */
  // 곡 변경 시 미리듣기 타이머 리셋
  useEffect(() => {
    pvTrackIdRef.current = current?.id ?? null;
    previewSecRef.current = 0;
    previewBlockedRef.current = false;
    previewLastTRef.current = 0;
  }, [current?.id]);

  // 재생 시작 시 게이트: anonymous 차단 + free 미리듣기 초과 차단 (모든 진입점 단일 choke, fallback)
  useEffect(() => {
    if (!playing) return;
    if (membership === 'anonymous') {
      pause();
      toast.info('로그인 후 이용해주세요.');
      openGate('login');
    } else if (
      membership === 'free' &&
      previewBlockedRef.current &&
      pvTrackIdRef.current === current?.id
    ) {
      pause();
      openGate('upsell');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, membership, current?.id]);

  /* ---------- 0093 MediaSession API: 잠금화면 / 이어폰 / Bluetooth 컨트롤 ---------- */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current) {
      try { navigator.mediaSession.metadata = null; } catch { /* noop */ }
      return;
    }
    try {
      const artwork = current.cover_url
        ? [
            { src: current.cover_url, sizes: '96x96', type: 'image/png' },
            { src: current.cover_url, sizes: '192x192', type: 'image/png' },
            { src: current.cover_url, sizes: '512x512', type: 'image/png' },
          ]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title ?? '',
        artist: current.artist ?? playlist?.title ?? '',
        album: playlist?.title ?? '',
        artwork,
      });
    } catch {
      /* MediaMetadata 미지원 환경 silent */
    }
    // current?.id/title/artist/cover_url 변경 시만 mediaSession 갱신 — current 전체는 의도적 제외 (잦은 ref 변경)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.title, current?.artist, current?.cover_url, playlist?.title]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const setH = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try { ms.setActionHandler(action, h); } catch { /* 일부 액션 미지원 시 throw */ }
    };
    setH('play', () => { if (!playing) toggle(); });
    setH('pause', () => { if (playing) toggle(); });
    setH('previoustrack', () => prev());
    setH('nexttrack', () => next());
    setH('seekto', (details) => {
      const audio = activeRef();
      if (!audio || typeof details?.seekTime !== 'number') return;
      try { audio.currentTime = details.seekTime; setCurrentTime(details.seekTime); } catch { /* noop */ }
    });
    return () => {
      setH('play', null); setH('pause', null);
      setH('previoustrack', null); setH('nexttrack', null);
      setH('seekto', null);
    };
    // activeRef 는 ref 객체 (안정) — deps 에 포함하면 끝없는 재등록
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, toggle, prev, next, setCurrentTime]);

  // playbackState 동기화 — 잠금화면 play/pause 아이콘
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none';
    } catch { /* noop */ }
    // current 전체는 의도적 제외 — id 변경만 트리거
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current?.id]);

  // 잠금화면 진행바(스크러버) — duration/position 동기화. floor(currentTime) 의존 → ~1초마다 갱신.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession as MediaSession & { setPositionState?: (s?: MediaPositionState) => void };
    if (typeof ms.setPositionState !== 'function') return;
    try {
      if (current && Number.isFinite(duration) && duration > 0) {
        ms.setPositionState({ duration, position: Math.min(Math.max(currentTime, 0), duration), playbackRate: 1 });
      } else {
        // 인자 없이 호출해야 상태가 초기화됨 ({} 는 duration 누락으로 TypeError)
        ms.setPositionState();
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, duration, Math.floor(currentTime)]);

  /* ---------- analytics: start / 15s / 30s / complete ---------- */
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const startedTrackIdRef = useRef<string | null>(null);
  const milestoneSentRef = useRef(false);
  // X4.3 — pev2 session id (페이지 로드당 stable, anonId + load time)
  const pev2SessionRef = useRef<string>(`${getAnonymousId()}-${Date.now()}`);
  // X4.3 — milestone tracking refs (트랙 변경 시 reset)
  const pev2MilestonesRef = useRef<{ track: string | null; sent: Set<string> }>({ track: null, sent: new Set() });
  // X4.3.1 — replay 감지: 같은 session 에서 이미 play_start 시작한 track 기록
  const pev2StartedTracksRef = useRef<Map<string, number>>(new Map());
  const recentSentRef = useRef<string | null>(null);
  // onError 등 이벤트 핸들러에서 예약하는 auto-next 타이머. 언마운트/재예약 시 정리해
  // 마운트 해제 후 stale next() 발화를 막는다.
  const nextTimerRef = useRef<number | null>(null);
  // 메타데이터(loadedmetadata) 로딩 타임아웃 — duration 0:00 으로 멈춰있으면 재생 불가로 처리.
  const metaTimerRef = useRef<number | null>(null);
  // NETWORK(코드2) 오류 곡당 1회 자동 재시도 추적.
  const networkRetriedRef = useRef<Set<string>>(new Set());
  function clearMetaTimer() {
    if (metaTimerRef.current !== null) { window.clearTimeout(metaTimerRef.current); metaTimerRef.current = null; }
  }
  useEffect(() => {
    return () => {
      if (nextTimerRef.current !== null) {
        window.clearTimeout(nextTimerRef.current);
        nextTimerRef.current = null;
      }
      clearMetaTimer();
    };
  }, []);

  // 네트워크 끊김/복귀 처리 — offline 표시, online 복귀 시 재생 자동 재시도 (매장 무중단)
  useEffect(() => {
    const setOnline = usePlaybackHealthStore.getState().setOnline;
    function onOffline() {
      setOnline(false);
    }
    function onOnline() {
      setOnline(true);
      // 재생 의도가 있는데 멈춰 있으면 현재 트랙을 다시 로드 후 재생 시도
      const audio = activeRef();
      if (audio && usePlayerStore.getState().playing && isPlayableUrl(usePlayerStore.getState().queue[usePlayerStore.getState().index]?.audio_url)) {
        try { audio.load(); } catch { /* noop */ }
        const p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay 정책 등 — 무시 */ });
      }
    }
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  // 0102 — 플레이리스트 청취 조회수 누적 (10분 = 1 view, 컨텍스트 단위 합산)
  const pvCtxKeyRef = useRef<string | null>(null);
  const pvSecondsRef = useRef(0);
  const pvRecordedRef = useRef(false);
  const pvLastTimeRef = useRef(0);

  useEffect(() => {
    if (!current || !playable || !playing) return;
    if (startedTrackIdRef.current === current.id) return;
    startedTrackIdRef.current = current.id;
    milestoneSentRef.current = false;
    usePlaybackHealthStore.getState().incTodayPlay();
    void trackStream({
      user_id: userId,
      track_id: current.id,
      playlist_id: playlist?.id ?? null,
      listened_seconds: 0,
      completed: false,
      event_type: 'start',
      // 0089 — 플레이어 볼륨/뮤트 (volume=0 도 muted 로 분류됨)
      player_volume: volume,
      player_muted: volume === 0,
    });
    // AI 큐레이션 behavior — play 이벤트(정산 stream_events 와 분리). 카탈로그 플리에서만.
    if (playlistContext?.type === 'catalog') {
      void recordPlayEvent({ trackId: current.id, playlistId: playlistContext.id, eventType: 'play', duration: current.duration ?? null, anonId: getAnonymousId() });
    }
    // X4.3 — playback_events_v2 play_start (parallel layer, fit_score 영향 없음)
    pev2MilestonesRef.current = { track: current.id, sent: new Set() };
    // X4.3.1 — 같은 session 에서 동일 track 2번째 이상이면 replay 별도 emit
    const priorStarts = pev2StartedTracksRef.current.get(current.id) ?? 0;
    pev2StartedTracksRef.current.set(current.id, priorStarts + 1);
    void logPlaybackEventV2({
      trackId: current.id, eventType: 'play_start',
      sessionId: pev2SessionRef.current,
      trackDurationSeconds: current.duration ?? undefined,
      playlistId: playlist?.id ?? undefined,
      volume, muted: volume === 0,
      anonymousId: getAnonymousId(),
    });
    if (priorStarts > 0) {
      // 같은 session 내 2번째 이상 재생 → replay 이벤트 (milestone 아니라 중복 제한 없음)
      void logPlaybackEventV2({
        trackId: current.id, eventType: 'replay',
        sessionId: pev2SessionRef.current,
        trackDurationSeconds: current.duration ?? undefined,
        playlistId: playlist?.id ?? undefined,
        volume, muted: volume === 0,
        anonymousId: getAnonymousId(),
        evidence: { replay_count: priorStarts + 1 },
      });
    }
    // playlistContext/volume 의도적 제외 — stream start 는 트랙 시작 시만 트리거 (volume 변경마다 X)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, playable, playing, userId, playlist?.id, current]);

  // X4.3 — 25/50/75/complete milestone (percentage 기반)
  useEffect(() => {
    if (!current || !playable || !playing) return;
    if (!duration || !Number.isFinite(duration) || duration < 1) return;
    if (startedTrackIdRef.current !== current.id) return;
    if (pev2MilestonesRef.current.track !== current.id) return;

    const pct = (currentTime / duration) * 100;
    const sent = pev2MilestonesRef.current.sent;
    const fireMilestone = (eventType: 'play_25' | 'play_50' | 'play_75' | 'play_complete', threshold: number) => {
      if (pct < threshold || sent.has(eventType)) return;
      sent.add(eventType);
      void logPlaybackEventV2({
        trackId: current.id, eventType,
        sessionId: pev2SessionRef.current,
        listenedSeconds: Math.floor(currentTime),
        trackDurationSeconds: duration,
        completionPercent: Math.min(100, Math.round(pct * 10) / 10),
        volume, muted: volume === 0,
        playlistId: playlist?.id ?? undefined,
        anonymousId: getAnonymousId(),
      });
    };
    fireMilestone('play_25', 25);
    fireMilestone('play_50', 50);
    fireMilestone('play_75', 75);
    fireMilestone('play_complete', 90);
  }, [currentTime, current, duration, playable, playing, playlist?.id, volume]);

  // X4.3 — volume_low / muted 이벤트 (재생 중에만)
  const pev2VolumeStateRef = useRef<{ track: string | null; lowSent: boolean; mutedSent: boolean }>(
    { track: null, lowSent: false, mutedSent: false }
  );
  useEffect(() => {
    if (!current || !playing) return;
    if (pev2VolumeStateRef.current.track !== current.id) {
      pev2VolumeStateRef.current = { track: current.id, lowSent: false, mutedSent: false };
    }
    if (volume === 0 && !pev2VolumeStateRef.current.mutedSent) {
      pev2VolumeStateRef.current.mutedSent = true;
      void logPlaybackEventV2({
        trackId: current.id, eventType: 'muted',
        sessionId: pev2SessionRef.current,
        volume, muted: true,
        playlistId: playlist?.id ?? undefined,
        anonymousId: getAnonymousId(),
      });
    } else if (volume > 0 && volume < 0.1 && !pev2VolumeStateRef.current.lowSent) {
      pev2VolumeStateRef.current.lowSent = true;
      void logPlaybackEventV2({
        trackId: current.id, eventType: 'volume_low',
        sessionId: pev2SessionRef.current,
        volume, muted: false,
        playlistId: playlist?.id ?? undefined,
        anonymousId: getAnonymousId(),
      });
    }
    // current 전체는 의도적 제외 — id 변경만 트리거
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, current?.id, playing, playlist?.id]);

  useEffect(() => {
    if (!current || milestoneSentRef.current) return;
    // 실제 재생 중 + 재생 가능 + 이 트랙에 대해 start 이벤트가 발화된 경우에만 집계.
    // (세션 복원 seek 로 currentTime 이 30 을 넘긴 채 정지 상태인 경우 오집계 방지)
    if (!playable || !playing) return;
    if (startedTrackIdRef.current !== current.id) return;
    if (currentTime >= 30) {
      milestoneSentRef.current = true;
      void trackStream({
        user_id: userId,
        track_id: current.id,
        playlist_id: playlist?.id ?? null,
        listened_seconds: Math.floor(currentTime),
        completed: false,
        event_type: 'milestone_30s',
        player_volume: volume,
        player_muted: volume === 0,
      });
    }
    // volume 의도적 제외 — milestone 은 30초 도달 시만 1회 트리거 (볼륨 변경마다 재계산 X)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, current, userId, playlist?.id, playable, playing]);

  useEffect(() => {
    if (!current) return;
    if (recentSentRef.current === current.id) return;
    if (currentTime >= 15) {
      recentSentRef.current = current.id;
      void pushRecentlyPlayed(current.id, userId, Math.floor(currentTime));
    }
  }, [currentTime, current, userId]);

  useEffect(() => {
    if (!current || !playable || !playing) return;
    if (currentTime < 5) return;
    void saveContinueListening(
      current.id,
      currentTime,
      Number.isFinite(duration) ? duration : null,
      userId,
    );
  }, [currentTime, current, playable, playing, duration, userId]);

  /* ---------- track sync + play/pause 통합 ---------- */
  // 한 번에 처리해서 src 중복 재할당 / play() AbortError 캐스케이드 방지.
  // - 트랙 변경: pause → src = url → load() → canplay 이벤트에서 자동 play (playing=true 면)
  // - 같은 트랙 + playing 토글: play() or pause() 만
  const lastTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    const audio = activeRef();
    if (!audio || !current) return;

    // 스킵 판정: 현재 트랙으로 바뀌었으면 직전 트랙을 1회 평가 (재생불가 새 트랙으로
    // 바뀌어 아래에서 early-return 되더라도 직전 스킵을 놓치지 않도록 최상단에서 처리).
    const skipOutgoing = prevTrackIdForSkipRef.current;
    if (skipOutgoing !== current.id) {
      if (skipOutgoing) evaluateSkip(skipOutgoing);
      prevTrackIdForSkipRef.current = current.id;
    }

    // 세션 내 이미 재생 실패(DECODE/SRC_NOT_SUPPORTED)로 확정된 트랙 →
    // 자동으로 다음 곡으로 넘기지 않고 현재 곡에서 정지(에러 표시). 재생 실패는 "곡 종료"가 아니다.
    // (플레이리스트 전체가 자동 스킵되며 토스트가 쌓이던 문제 차단)
    if (playing && sessionFailedTrackIds.has(current.id)) {
      setErrored(true);
      pause();
      return;
    }

    if (!playable) {
      // audio_url 누락/형식 이상 → 자동 스킵 금지. 재생 시도 중이면 정지 + 에러 표시.
      if (playing) {
        setErrored(true);
        pause();
      }
      return;
    }

    const trackChanged = lastTrackIdRef.current !== current.id;
    if (trackChanged) {
      if (import.meta.env.DEV) {
        // 진단용 공식 포맷 ([audio] = 재생 직전 상태 스냅샷)
         
        console.log('[audio]', {
          id: current.id,
          title: current.title,
          audio_url: current.audio_url,
          playable,
        });
        console.debug('[Player] track change', {
          from: lastTrackIdRef.current,
          to: current.id,
          url: current.audio_url,
          activeIdx,
        });
      }
      lastTrackIdRef.current = current.id;
      cancelCrossfade();
      setCurrentTime(0);
      setDuration(0);

      // 1) 이전 src 의 play 프로미스 abort
      audio.pause();
      // 2) 새 src 적용
      if (import.meta.env.DEV) {
        console.debug('[Player] src set', { id: current.id, url: current.audio_url, readyState_before: audio.readyState, networkState_before: audio.networkState });
      }
      audio.src = current.audio_url;
      // 3) load() 는 playing=true 일 때만 호출 — preload="metadata" 와 결합해
      //    사용자 의도 없는 자동 fetch / preload 에러 toast 폭주 차단 (0077-hotfix)
      clearMetaTimer();
      if (playing) {
        try { audio.load(); } catch { /* noop */ }
        // 메타데이터 로딩 타임아웃 — 12초 안에 loadedmetadata 가 없으면(duration 0:00 고착)
        // 재생 불가로 처리(iOS 가 디코딩 못 하는 WAV 등). onLoadedMetadata 에서 해제.
        const trackId = current.id;
        metaTimerRef.current = window.setTimeout(() => {
          const a = activeRef();
          const dur = a?.duration;
          if (usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id === trackId
              && (!a || !Number.isFinite(dur) || (dur ?? 0) <= 0)) {
             
            console.warn('[audio] metadata timeout — duration 0:00, 재생 불가 처리', {
              id: trackId, title: current.title, src: a?.currentSrc, readyState: a?.readyState, networkState: a?.networkState,
            });
            usePlaybackHealthStore.getState().reportPlaybackError('META_TIMEOUT');
            setErrored(true);
            pause();
          }
        }, 12000);
      }
      audio.currentTime = 0;
      audio.volume = volume;

      // 다른(next-preload) audio 는 정지 + src 해제
      const other = nextRef();
      if (other) {
        other.pause();
        other.removeAttribute('src');
      }

      // playing=true 면 canplay 이벤트에서 자동 play 호출됨 (onCanPlay)
      return;
    }

    // 같은 트랙 — playing 토글만 동기화
    if (playing) {
      if (audio.paused) {
        if (import.meta.env.DEV) console.debug('[Player] play() resume', { id: current.id, readyState: audio.readyState, currentSrc: audio.currentSrc });
        void attemptPlay(audio, 'resume');
      }
    } else {
      audio.pause();
      const other = nextRef();
      if (other && !other.paused) other.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, playable, playing, queue.length, activeIdx]);

  /* ---------- 볼륨 동기화 ---------- */
  useEffect(() => {
    if (crossfading) return; // crossfade 중엔 rAF 가 직접 제어
    if (audioARef.current) audioARef.current.volume = activeIdx === 0 ? volume : 0;
    if (audioBRef.current) audioBRef.current.volume = activeIdx === 1 ? volume : 0;
  }, [volume, activeIdx, crossfading]);

  /* ============================================
   * Crossfade 엔진
   * ============================================ */
  const crossfadeRafRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const triggeredAtTrackIdRef = useRef<string | null>(null);

  function cancelCrossfade() {
    if (crossfadeRafRef.current !== null) {
      cancelAnimationFrame(crossfadeRafRef.current);
      crossfadeRafRef.current = null;
    }
    if (crossfadeTimeoutRef.current !== null) {
      window.clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }
    setCrossfading(false);
    triggeredAtTrackIdRef.current = null;
  }

  /** 트랙 종료 X초 전 도달 시 crossfade 시작 */
  const startCrossfade = useCallback(() => {
    // 가드 — 모든 조건 충족할 때만 진행
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!playing) return;
    if (crossfading) return;
    if (repeat === 'one') return;
    if (!current || !current.audio_url) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration <= crossfadeSeconds + 5) return; // 곡이 너무 짧으면 X
    if (currentTime <= 10) return; // 시작 10초 안에는 절대 금지 (초기 튐 방지)
    if (currentTime < duration - crossfadeSeconds) return; // 아직 fade 시점 아님
    if (triggeredAtTrackIdRef.current === current.id) return;

    const nextIdx = computeNextIndex(queue.length, index, shuffle, shuffleOrder, repeat);
    if (nextIdx === null) return;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || !nextTrack.audio_url || !isPlayableUrl(nextTrack.audio_url)) return;

    if (import.meta.env.DEV) {
      console.debug('[Player] crossfade start', {
        id: current.id,
        duration,
        currentTime,
        crossfadeSeconds,
        nextId: nextTrack.id,
      });
    }

    const nextAudio = nextRef();
    const activeAudio = activeRef();
    if (!nextAudio || !activeAudio) return;

    triggeredAtTrackIdRef.current = current.id;

    nextAudio.src = nextTrack.audio_url;
    nextAudio.currentTime = 0;
    nextAudio.volume = 0;
    const p = nextAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 자동재생 실패 — 그냥 ended 핸들러가 다음 곡 처리
        triggeredAtTrackIdRef.current = null;
      });
    }

    setCrossfading(true);
    const targetVol = volume;
    const durationMs = crossfadeSeconds * 1000;
    const startedAt = performance.now();

    const tick = () => {
      const now = performance.now();
      const t = Math.min(1, (now - startedAt) / durationMs);
      if (activeAudio) activeAudio.volume = Math.max(0, targetVol * (1 - t));
      if (nextAudio) nextAudio.volume = Math.min(1, targetVol * t);
      if (t < 1) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
      } else {
        // 스왑 완료
        activeAudio.pause();
        activeAudio.currentTime = 0;
        // X6.61 — 크로스페이드 후 jumpTo 가 current.id 를 nextTrack 으로 바꾸면
        // /* track sync */ useEffect 가 재진입해 audio.src 를 재설정 → 정상 재생 중인
        // nextAudio 가 reload 되어 무음 발생 (매장모드 다음곡 무음 버그).
        // jumpTo 이전에 lastTrackIdRef 를 미리 설정해 trackChanged=false 로 만든다.
        lastTrackIdRef.current = nextTrack.id;
        // active 교체
        const becomeActive: 0 | 1 = activeIdx === 0 ? 1 : 0;
        setActiveIdx(becomeActive);
        setCrossfading(false);
        crossfadeRafRef.current = null;
        // playerStore 의 index 도 다음으로 (jumpTo 가 src 재설정하면 안 되니 단순 set)
        jumpTo(nextIdx);
      }
    };
    crossfadeRafRef.current = requestAnimationFrame(tick);
    // activeRef / nextRef 는 ref 객체 (안정) — deps 포함 시 끝없는 재등록
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    crossfadeEnabled,
    crossfadeSeconds,
    crossfading,
    playing,
    current,
    duration,
    currentTime,
    repeat,
    queue,
    index,
    shuffle,
    shuffleOrder,
    volume,
    activeIdx,
    jumpTo,
  ]);

  // duration - crossfadeSeconds 도달 감지 (강화된 가드)
  useEffect(() => {
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!playing) return;
    if (crossfading) return;
    if (repeat === 'one') return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration <= crossfadeSeconds + 5) return; // 곡이 너무 짧으면 X (3초 튐 방지)
    if (currentTime <= 10) return; // 시작 10초 안에는 절대 금지
    const remaining = duration - currentTime;
    if (remaining <= crossfadeSeconds && remaining > 0.2) {
      startCrossfade();
    }
  }, [currentTime, duration, crossfadeEnabled, crossfadeSeconds, crossfading, playing, repeat, startCrossfade]);

  // 사용자 next/prev 시 fade 취소
  useEffect(() => {
    return () => cancelCrossfade();
  }, []);

  if (!current) return null;

  /* ---------- audio element handlers (active 만) ---------- */
  function onTimeUpdate(e: React.SyntheticEvent<HTMLAudioElement>) {
    const target = e.currentTarget;
    // X6.2.13 — activeRef 가드 완화. currentSrc / current.audio_url 매칭 기반.
    if (current?.audio_url && target.currentSrc) {
      try {
        const trackPath = new URL(current.audio_url, window.location.origin).pathname;
        const srcPath = new URL(target.currentSrc, window.location.origin).pathname;
        if (trackPath !== srcPath) return; // 다른 트랙 audio 의 timeupdate 무시
      } catch {
        if (target !== activeRef()) return;
      }
    } else if (target !== activeRef()) {
      return;
    }
    const t = target.currentTime;
    setCurrentTime(t);
    accumulatePlaylistView(t);
    enforcePreviewLimit(t);
    // 스킵 판정용 진행도 스냅샷 (트랙 변경 시 직전 트랙의 played/duration 으로 사용)
    if (current) {
      const dur = target.duration;
      skipProgressRef.current = {
        id: current.id,
        played: t,
        duration: Number.isFinite(dur) ? dur : 0,
      };
    }
  }

  // 직전 트랙이 "스킵"인지 판정해 silent 하게 기록. (다음/다른곡선택/중도이탈 = 스킵)
  // 자연 종료(onEnded·crossfade), 이전 버튼, 재생 실패 트랙, 비-카탈로그 컨텍스트는 제외.
  function evaluateSkip(outgoingId: string) {
    const reason = skipReasonRef.current;
    const wasNaturalEnd =
      naturalEndRef.current === outgoingId || triggeredAtTrackIdRef.current === outgoingId;
    const wasPrev = prevPressedRef.current;
    // one-shot 신호 리셋
    naturalEndRef.current = null;
    prevPressedRef.current = false;
    skipReasonRef.current = 'manual_skip';

    if (wasNaturalEnd) return; // 끝까지 들음(자동 advance / crossfade)
    if (wasPrev) return; // 이전 버튼
    if (sessionFailedTrackIds.has(outgoingId)) return; // 재생 실패(에러)
    const ctx = playlistContext;
    if (!ctx || ctx.type !== 'catalog') return; // 카탈로그 플레이리스트에서만 집계

    const prog = skipProgressRef.current;
    if (!prog || prog.id !== outgoingId) return; // 진행도 스냅샷 없음 → 미재생 간주
    const dur = prog.duration > 0 ? prog.duration : null;
    void recordTrackSkip(ctx.id, outgoingId, prog.played, dur, reason);
    // AI 큐레이션 behavior 이벤트 (정산용 stream_events 와 분리) — skip
    void recordPlayEvent({ trackId: outgoingId, playlistId: ctx.id, eventType: 'skip', played: prog.played, duration: dur, skipReason: reason, anonId: getAnonymousId() });
    // X4.3 — playback_events_v2 skip (parallel layer)
    void logPlaybackEventV2({
      trackId: outgoingId, eventType: 'skip',
      sessionId: pev2SessionRef.current,
      listenedSeconds: prog.played,
      trackDurationSeconds: dur ?? undefined,
      completionPercent: dur && dur > 0 ? Math.min(100, (prog.played / dur) * 100) : undefined,
      volume, muted: volume === 0,
      playlistId: ctx.id,
      anonymousId: getAnonymousId(),
    });
    // 사업자 회원 30초 이내 수동 스킵 → 자동 제외 후보 집계 (비사업자는 서버에서 무시). 정산 무관.
    if (prog.played <= 30) void recordBusinessEarlySkip(ctx.id, outgoingId, prog.played, dur, reason);
  }

  // 0104 — 무료회원 25초 미리듣기 강제. 실제 청취 delta 누적 (seek 점프/뮤트/일시정지 제외).
  function enforcePreviewLimit(t: number) {
    if (membership !== 'free') return;
    // 곡 변경은 effect 가 리셋 — 여기선 같은 곡 기준으로 누적
    if (pvTrackIdRef.current !== current?.id) {
      previewLastTRef.current = t;
      return;
    }
    if (previewBlockedRef.current) {
      previewLastTRef.current = t;
      if (playing) {
        pause();
        openGate('upsell');
      }
      return;
    }
    const delta = t - previewLastTRef.current;
    previewLastTRef.current = t;
    if (playing && delta > 0 && delta < 2 && volume > 0) {
      previewSecRef.current += delta;
      if (previewSecRef.current >= PREVIEW_LIMIT_SECONDS) {
        previewBlockedRef.current = true;
        pause();
        toast.info('무료회원에게는 미리듣기만 제공됩니다.');
        openGate('upsell');
      }
    }
  }

  // 0102 — 플레이리스트 청취 조회수 누적.
  // 컨텍스트(플리)가 바뀌면 리셋. muted/저볼륨/일시정지 시 누적 안 함.
  // 곡이 바뀌어도 같은 컨텍스트면 합산. 10분(600s) 누적 시 1회 RPC.
  function accumulatePlaylistView(t: number) {
    const ctx = playlistContext;
    const ctxKey = ctx ? `${ctx.type}:${ctx.id}` : null;
    if (ctxKey !== pvCtxKeyRef.current) {
      // 컨텍스트 변경 → 누적 리셋
      pvCtxKeyRef.current = ctxKey;
      pvSecondsRef.current = 0;
      pvRecordedRef.current = false;
      pvLastTimeRef.current = t;
      return;
    }
    if (!ctx || pvRecordedRef.current) {
      pvLastTimeRef.current = t;
      return;
    }
    const delta = t - pvLastTimeRef.current;
    pvLastTimeRef.current = t;
    // delta 가 0~2초 범위 + 실제 재생 중 + 볼륨 충분할 때만 (seek 점프/뮤트/저볼륨 제외)
    if (playing && delta > 0 && delta < 2 && volume >= 0.1) {
      pvSecondsRef.current += delta;
      if (pvSecondsRef.current >= 600) {
        pvRecordedRef.current = true; // 중복 호출 방지
        void recordPlaylistQualifiedView(ctx.type, ctx.id, pvSecondsRef.current);
      }
    }
  }

  function onLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const target = e.currentTarget;
    const d = target.duration;
    // X6.2.13 — activeRef 가드 완화. metadata 가 어떤 audio 에서 fire 됐든,
    // 그 audio 의 currentSrc 가 현재 트랙의 audio_url 과 같은 path 면 처리.
    // (매장 모드 / crossfade 등 activeIdx 가 다른 audio 를 가리킬 때 progress 0:00 멈춤 해결)
    if (current?.audio_url && target.currentSrc) {
      try {
        const trackPath = new URL(current.audio_url, window.location.origin).pathname;
        const srcPath = new URL(target.currentSrc, window.location.origin).pathname;
        if (trackPath !== srcPath) {
          // preload 된 next track 의 metadata — 현재 트랙 progress 와 무관, 무시
          return;
        }
      } catch {
        // URL parse 실패 시 fallback — activeRef 검사로
        if (target !== activeRef()) return;
      }
    } else if (target !== activeRef()) {
      return;
    }
    if (import.meta.env.DEV) {
      console.debug('[Player] loadedmetadata', { id: current?.id, duration: d, readyState: target.readyState, currentSrc: target.currentSrc });
    }
    if (Number.isFinite(d) && d > 0) clearMetaTimer();
    if (Number.isFinite(d)) setDuration(d);
    if (
      pendingSeekSec != null &&
      pendingSeekSec > 1 &&
      Number.isFinite(d) &&
      pendingSeekSec < d - 0.5
    ) {
      try {
        target.currentTime = pendingSeekSec;
        setCurrentTime(pendingSeekSec);
      } catch {
        /* iOS Safari 가끔 거부 — 무시 */
      }
    }
    setPendingSeek(null);
  }

  /** X6.2.13 — durationchange 이벤트도 처리 (일부 환경에서 loadedmetadata 가 0 으로 fire 후 duration 만 늦게 갱신) */
  function onDurationChange(e: React.SyntheticEvent<HTMLAudioElement>) {
    const target = e.currentTarget;
    const d = target.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    // current track 매칭
    if (current?.audio_url && target.currentSrc) {
      try {
        const trackPath = new URL(current.audio_url, window.location.origin).pathname;
        const srcPath = new URL(target.currentSrc, window.location.origin).pathname;
        if (trackPath !== srcPath) return;
      } catch {
        if (target !== activeRef()) return;
      }
    } else if (target !== activeRef()) {
      return;
    }
    setDuration(d);
    clearMetaTimer();
    if (import.meta.env.DEV) {
      console.debug('[Player] durationchange', { id: current?.id, duration: d });
    }
  }

  function onCanPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== activeRef()) return;
    if (!playing) return;
    const audio = e.currentTarget;
    if (!audio.paused) return;
    if (import.meta.env.DEV) {
      console.debug('[Player] canplay → auto-play', { id: current?.id, readyState: audio.readyState, currentSrc: audio.currentSrc });
    }
    void attemptPlay(audio, 'canplay');
  }

  // play() 호출 + 성공/실패 로그 + 일시적 실패 시 1회 재시도 (AbortError/NotAllowedError 제외)
  async function attemptPlay(audio: HTMLAudioElement, label: string) {
    const expectedSrc = audio.currentSrc;
    try {
      await audio.play();
      // muted=true 면 안전 해제 (브라우저/사용자 실수 방어)
      if (audio.muted) {
        if (import.meta.env.DEV) console.warn(`[Player] muted=true 감지 — 자동 해제 (${label})`);
        audio.muted = false;
      }
      // volume=0 이면 경고 (크로스페이드 중간 아님)
      if (audio.volume === 0 && !crossfading) {
        if (import.meta.env.DEV) console.warn(`[Player] volume=0 감지 — 사용자 볼륨(${volume})으로 복원 (${label})`);
        audio.volume = volume;
      }
      if (import.meta.env.DEV) {
        console.debug(`[Player] play() ok (${label})`, {
          id: current?.id, currentSrc: audio.currentSrc, currentTime: audio.currentTime, duration: audio.duration,
          readyState: audio.readyState, paused: audio.paused, muted: audio.muted, volume: audio.volume, crossfading,
        });
        // 1s 후 currentTime 실제 진행 여부 검증 — paused 아님 + 같은 src 인 경우에만
        const verifyAt = performance.now();
        window.setTimeout(() => {
          if (audio.paused) return; // 사용자가 일시정지했으면 무시
          if (audio.currentSrc !== expectedSrc) return; // 그 사이 트랙 바뀌었으면 무시
          const elapsed = (performance.now() - verifyAt) / 1000;
          console.debug(`[Player] playback progress @1s (${label})`, {
            currentTime: audio.currentTime, elapsed_real: elapsed.toFixed(2), volume: audio.volume, muted: audio.muted,
          });
          if (audio.currentTime <= 0.05) {
            console.warn(`[Player] currentTime 정체 (${label}) — 1s 경과해도 currentTime=${audio.currentTime}. ` +
              '브라우저 오디오 출력 차단 의심 (시스템 mute / 사이트 권한 / 가속 코덱 이슈).');
          }
        }, 1000);
      }
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e?.name === 'AbortError') {
        if (import.meta.env.DEV) console.debug(`[Player] play() AbortError (${label}) — src 변경으로 인한 무효화`);
        return;
      }
      if (e?.name === 'NotAllowedError') {
        if (import.meta.env.DEV) console.warn(`[Player] play() NotAllowedError (${label}) — autoplay 차단됨`);
        pause();
        toast.info('재생 버튼을 한 번 눌러주세요. (모바일은 자동재생이 제한돼요)');
        return;
      }
      if (import.meta.env.DEV) console.warn(`[Player] play() rejected (${label}) — 250ms 후 재시도 1회`, { name: e?.name, message: e?.message });
      // 재시도 1회 — src 가 같고 여전히 paused 일 때만
      await new Promise((r) => window.setTimeout(r, 250));
      if (audio.currentSrc !== expectedSrc) {
        if (import.meta.env.DEV) console.debug(`[Player] play() retry 취소 (${label}) — src 가 그 사이 변경됨`);
        return;
      }
      if (!audio.paused) return;
      try {
        await audio.play();
        if (import.meta.env.DEV) console.debug(`[Player] play() ok (${label} retry)`, { id: current?.id, currentSrc: audio.currentSrc });
      } catch (err2: unknown) {
        const e2 = err2 as DOMException;
        if (e2?.name === 'AbortError' || e2?.name === 'NotAllowedError') return;
        if (import.meta.env.DEV) console.error(`[Player] play() retry 실패 (${label})`, { name: e2?.name, message: e2?.message });
        pause();
        toast.error('재생 시작에 실패했어요. 다시 시도해주세요.');
      }
    }
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    const audio = activeRef();
    if (audio && Number.isFinite(audio.duration)) {
      audio.currentTime = v;
    }
    setCurrentTime(v);
    // seek 후 crossfade trigger 재계산 가능하게
    triggeredAtTrackIdRef.current = null;
    cancelCrossfade();
  }

  async function maybeAutoplayRecommendations() {
    if (!autoplayRecommendations) return false;
    if (!current) return false;
    if (repeat !== 'off') return false; // repeat 면 무한 루프 막힘
    // queue 의 마지막이면 → 유사곡 추천 큐 추가
    const isLast =
      shuffle && shuffleOrder.length === queue.length
        ? shuffleOrder.indexOf(index) === shuffleOrder.length - 1
        : index === queue.length - 1;
    if (!isLast) return false;
    const recs = await recommendSimilarTracks(current.id, 10);
    if (recs.length === 0) return false;
    const playable = recs.filter((r) => isPlayableUrl(r.audio_url));
    if (playable.length === 0) return false;
    // 기존 큐에 이어 붙임 + 첫 추천곡으로 점프
    const newQueue = [...queue, ...playable];
    usePlayerStore.setState({
      queue: newQueue,
      index: queue.length,
      playing: true,
      currentTime: 0,
      shuffleOrder: shuffle ? [...shuffleOrder, ...playable.map((_, i) => queue.length + i)] : [],
    });
    // 0091-fix — toast dedup (10분 윈도우, 큐 끝 반복 시 폭주 방지)
    const now = Date.now();
    if (now - lastRecommendToastAt >= RECOMMEND_TOAST_DEDUP_MS) {
      lastRecommendToastAt = now;
      toast.success('비슷한 분위기의 곡을 이어서 추천했어요');
    }
    return true;
  }

  function onEnded(e: React.SyntheticEvent<HTMLAudioElement>) {
    // active 가 ended 인 경우만 next 호출 (next audio 가 끝난건 무시)
    if (e.currentTarget !== activeRef()) return;
    if (crossfading) return; // crossfade 가 swap 처리

    // 자연 종료 — 다음 트랙 변경 시 스킵으로 집계하지 않도록 표시.
    if (current) naturalEndRef.current = current.id;

    // AI 큐레이션 behavior 이벤트 — complete (자연 종료만; network error 는 onError 라 여기 안 옴)
    if (current && playlistContext?.type === 'catalog') {
      void recordPlayEvent({ trackId: current.id, playlistId: playlistContext.id, eventType: 'complete', played: duration || currentTime || 0, duration: duration || null, anonId: getAnonymousId() });
    }

    if (current) {
      void trackStream({
        user_id: userId,
        track_id: current.id,
        playlist_id: playlist?.id ?? null,
        listened_seconds: Math.floor(duration || currentTime || 0),
        completed: true,
        event_type: 'complete',
        player_volume: volume,
        player_muted: volume === 0,
      });
      // X4.3 — playback_events_v2 play_complete (자연 종료, parallel layer)
      void logPlaybackEventV2({
        trackId: current.id, eventType: 'play_complete',
        sessionId: pev2SessionRef.current,
        listenedSeconds: Math.floor(duration || currentTime || 0),
        trackDurationSeconds: duration || undefined,
        completionPercent: 100,
        volume, muted: volume === 0,
        playlistId: playlist?.id ?? undefined,
        anonymousId: getAnonymousId(),
      });
      void clearContinueListening(current.id, userId);
    }
    // 자동 이어추천이 큐를 늘렸으면 next() 가 자연스럽게 동작 (마지막 → 새 곡)
    const endedId = current?.id ?? null;
    void maybeAutoplayRecommendations().then((added) => {
      if (added) return;
      // await 도중 사용자가 next/prev/트랙변경을 했으면 중복 진행 금지 (stale closure 방어)
      const st = usePlayerStore.getState();
      if (endedId !== null && st.queue[st.index]?.id !== endedId) return;
      next();
    });
  }

  function onError(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== activeRef()) return;
    if (!playable) return;
    const target = e.currentTarget;
    const err = target.error;
    const codeName = err ? (MEDIA_ERROR_CODES[err.code] ?? `code=${err.code}`) : 'UNKNOWN';
    // iOS Safari 실기기 원격 디버깅용 — 프로덕션에서도 항상 상세 로그(에러는 드물어 spam 아님).
    // codeName=SRC_NOT_SUPPORTED/DECODE 이면 코덱/컨테이너 문제(예: iOS 가 못 읽는 WAV).
     
    // iOS Safari 실기기 디버깅용 상세 로그 (track/src/code/networkState/readyState/시간/상태/UA)
    console.warn('[audio:error]', {
      id: current?.id,
      title: current?.title,
      audio_url: current?.audio_url,
      code: err?.code,
      codeName,
      message: err?.message,
      networkState: target.networkState, // 3=NO_SOURCE
      readyState: target.readyState,     // 0=HAVE_NOTHING
      currentTime: target.currentTime,
      duration: target.duration,
      paused: target.paused,
      ended: target.ended,
      currentSrc: target.currentSrc || target.src,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      playing,
    });

    usePlaybackHealthStore.getState().reportPlaybackError(codeName);

    // X4.3.1 — playback_events_v2 player_error (parallel layer)
    if (current) {
      void logPlaybackEventV2({
        trackId: current.id, eventType: 'player_error',
        sessionId: pev2SessionRef.current,
        trackDurationSeconds: current.duration ?? undefined,
        playlistId: playlist?.id ?? undefined,
        volume, muted: volume === 0,
        anonymousId: getAnonymousId(),
        evidence: {
          code: err?.code ?? null, code_name: codeName,
          message: err?.message ?? null,
          network_state: target.networkState,
          ready_state: target.readyState,
          audio_url: current.audio_url ?? null,
          current_time: target.currentTime,
          online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        },
      });
    }

    // NETWORK(코드2): 스트리밍 중간 끊김 → 곡당 1회만 자동 재시도(load + 위치 복원 + play).
    // 자동 다음곡/토스트 없이 조용히 복구 시도. 재시도 후에도 실패하면 아래 정지 로직으로.
    if (err?.code === 2 && current && playing && !networkRetriedRef.current.has(current.id)) {
      networkRetriedRef.current.add(current.id);
      const resumeAt = target.currentTime || currentTime || 0;
       
      console.warn('[audio] NETWORK 오류 — 1회 자동 재시도', { id: current.id, title: current.title, resumeAt });
      try {
        target.load();
        const onceCanPlay = () => {
          target.removeEventListener('canplay', onceCanPlay);
          try {
            if (resumeAt > 0 && Number.isFinite(target.duration) && resumeAt < target.duration) {
              target.currentTime = resumeAt;
            }
          } catch { /* noop */ }
          const pr = target.play();
          if (pr && typeof pr.catch === 'function') pr.catch(() => { /* 다음 onError 가 처리 */ });
        };
        target.addEventListener('canplay', onceCanPlay, { once: true });
      } catch { /* noop */ }
      return; // 정지/토스트 없이 재시도
    }

    // 디코딩/포맷 문제로 확정된 트랙 표시 (자동 스킵엔 쓰지 않고, 재시도 시 정리됨)
    const isPermanent = err?.code === 3 /* DECODE */ || err?.code === 4 /* SRC_NOT_SUPPORTED */;
    if (current && isPermanent) {
      sessionFailedTrackIds.add(current.id);
    }

    // 재생 에러 = "곡 종료"가 아니다 → 다음 곡으로 자동 이동하지 않고 현재 곡에서 정지.
    // (preload 단계 !playing 에러는 조용히 에러 표시만)
    setErrored(true);
    if (playing) pause();
    if (!playing) return;

    // 에러 토스트는 3초 디바운스로 1개만 노출 (연속 실패해도 토스트 스택 안 쌓임)
    const now = Date.now();
    if (now - lastErrorToastAt >= ERROR_TOAST_DEBOUNCE_MS) {
      lastErrorToastAt = now;
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const isOperatorContext = /^\/(admin|artist)/.test(path);
      if (isPermanent) {
        toast.error(
          isOperatorContext
            ? `이 음원은 브라우저에서 재생할 수 없는 형식이거나 업로드 문제입니다. 재업로드/재검수가 필요합니다. [${codeName}]`
            : '이 음원을 재생할 수 없어요. ▶ 다시 누르면 재시도하거나 다른 곡을 선택해주세요.',
        );
      } else if (err?.code === 2) {
        toast.error('네트워크/파일 접근 오류로 재생이 중단됐어요. ▶ 다시 누르면 재시도해요.');
      } else {
        toast.error(`재생에 실패했어요 (${codeName}). ▶ 다시 누르면 재시도해요.`);
      }
    }
    // 자동 next 제거 — 현재 곡 정지 유지(플레이리스트 자동 스킵 방지).
  }

  function cycleRepeat() {
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');
  }

  function handlePlayBtn() {
    if (!current) return;
    if (!playable) {
      // 자동으로 다음 곡으로 넘기지 않음 — 사용자가 직접 곡을 선택하게 안내만.
      toast.info('이 트랙은 음원이 등록되지 않았어요.');
      return;
    }
    // 에러 상태에서 ▶ 다시 누르면 동일 곡 재시도 (실패 마크 해제 + 강제 재로드).
    if (errored) {
      sessionFailedTrackIds.delete(current.id);
      networkRetriedRef.current.delete(current.id); // 수동 재시도 시 네트워크 자동재시도 한도 초기화
      setErrored(false);
      lastTrackIdRef.current = null; // 트랙 변경으로 간주 → src 재설정/load/재생
      play();
      return;
    }
    toggle();
  }

  function handlePrev() {
    prevPressedRef.current = true; // 이전 버튼 = 스킵 아님
    cancelCrossfade();
    prev();
  }
  function handleNext() {
    skipReasonRef.current = 'manual_skip'; // 다음 버튼 = 스킵
    cancelCrossfade();
    next();
  }

  return (
    <>
      {/* dual audio — 둘 다 마운트, src 는 동적으로 */}
      <audio
        ref={audioARef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />
      <audio
        ref={audioBRef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />

      {/* Mini player — 모바일은 BottomNav 위, 데스크탑은 사이드바 우측 영역 중앙 */}
      <div className="fixed inset-x-0 bottom-[5.25rem] z-20 mx-auto max-w-3xl px-3 pl-safe pr-safe sm:bottom-[5.5rem] sm:px-4 lg:left-60 lg:right-0 lg:bottom-4 lg:max-w-[min(960px,calc(100vw-15rem-4rem))] lg:px-6">
        <button
          onClick={() => setExpanded(true)}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl glass-strong p-2.5 transition duration-smooth ease-emphasized hover:-translate-y-0.5"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-10"
            style={gradientStyle(playlist?.category || current.title)}
          />
          {/* DEUDDA — 상단 진행도 hairline (재생 중 시각적 alive 신호) */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-white/5">
            <div
              className="h-full bg-accent transition-[width] duration-200 ease-out"
              style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%' }}
            />
          </div>
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/15">
            <AutoCover
              title={current.title}
              category={playlist?.category}
              imageUrl={current.cover_url}
              size="sm"
            />
          </div>
          <div className="relative min-w-0 flex-1 text-left">
            <p className="flex items-center gap-1 truncate text-sm font-semibold">
              {!playable && <AlertCircle size={11} className="shrink-0 text-yellow-300" />}
              {crossfading && <Activity size={11} className="shrink-0 animate-pulse text-accent" />}
              {current.title}
            </p>
            <p className="truncate text-xs text-ink-mute">
              {!playable ? '음원 준비중' : (current.artist ?? '—')}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePlayBtn();
            }}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white ring-1 ring-white/15 transition duration-smooth ease-emphasized hover:scale-105 hover:bg-accent-soft disabled:opacity-50"
            style={{ boxShadow: '0 10px 28px rgb(var(--color-accent) / 0.50), 0 4px 10px rgba(0,0,0,0.40)' }}
            aria-label={playing ? '일시정지' : '재생'}
            disabled={errored}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          {/* 0078 — 미니 플레이어 볼륨 버튼 (popover 는 outer button 밖에 sibling 으로) */}
          <button
            ref={volumeBtnRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVolumePopover((v) => !v);
            }}
            className="relative flex h-10 w-10 items-center justify-center text-ink-mute hover:text-ink"
            aria-label="볼륨 조절"
            aria-expanded={volumePopover}
            aria-haspopup="dialog"
          >
            {volume === 0 ? (
              <VolumeX size={18} />
            ) : volume < 0.5 ? (
              <Volume1 size={18} />
            ) : (
              <Volume2 size={18} />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="relative hidden h-10 w-10 items-center justify-center text-ink-mute hover:text-ink sm:flex"
            aria-label="다음 곡"
          >
            <SkipForward size={18} />
          </button>
          <ChevronUp size={18} className="relative mr-1 text-ink-dim sm:hidden" />
        </button>
        {/* 0078 — 볼륨 popover: outer button 외부 sibling 으로 (overflow-hidden 회피) */}
        {volumePopover && (
          <div
            ref={volumePopoverRef}
            role="dialog"
            aria-label="볼륨 조절"
            className="absolute right-3 bottom-full mb-2 z-30 flex items-center gap-2 rounded-2xl bg-bg-card p-3 shadow-elevated ring-1 ring-line/15 backdrop-blur sm:right-4"
            style={{ minWidth: 220 }}
          >
            <button
              type="button"
              onClick={toggleMute}
              aria-label={volume === 0 ? '음소거 해제' : '음소거'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-mute hover:bg-bg-hover hover:text-ink"
            >
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="볼륨 슬라이더"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink/15 accent-accent"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink-mute tabular-nums">
              {Math.round(volume * 100)}
            </span>
          </div>
        )}
        <div className="relative mx-2 mt-1.5 h-1 rounded-full bg-ink/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
            style={{
              width: duration ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%',
              background:
                'linear-gradient(90deg, rgb(var(--color-accent-soft)) 0%, rgb(var(--color-accent)) 100%)',
              boxShadow: '0 0 14px rgb(var(--color-accent) / 0.6)',
            }}
          />
        </div>
      </div>

      {/* Expanded player overlay */}
      {expanded && (
        <div ref={expandedRef} role="dialog" aria-modal="true" aria-label="확장된 플레이어" className="fixed inset-0 z-40 flex flex-col bg-bg pt-safe pb-safe animate-slide-up">
          <div
            className="pointer-events-none absolute inset-0 scale-110 opacity-60 blur-3xl"
            style={gradientStyle(playlist?.category || current.title)}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg" />

          <div className="relative flex items-center justify-between px-5 py-3">
            <button
              onClick={() => setExpanded(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 backdrop-blur"
              aria-label="닫기"
            >
              <ChevronDown size={20} />
            </button>
            <div className="text-center">
              <p className="text-[11px] uppercase tracking-wider text-white/60">
                {playlist?.title ?? '재생 중'}
              </p>
              {crossfadeEnabled && crossfadeSeconds > 0 && (
                <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                  <Activity size={9} /> Crossfade {crossfadeSeconds}s
                </p>
              )}
            </div>
            <button
              onClick={() => setShowQueue(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 backdrop-blur"
              aria-label="대기열"
            >
              <ListMusic size={18} />
            </button>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <div className="relative aspect-square w-full max-w-xs">
              <div
                className="pointer-events-none absolute inset-0 -z-0 scale-105 rounded-3xl opacity-70 blur-3xl"
                style={gradientStyle(playlist?.category || current.title)}
                aria-hidden
              />
              <div className="relative overflow-hidden rounded-3xl shadow-elevated ring-1 ring-line/15 h-full w-full">
                <AutoCover
                  title={current.title}
                  category={playlist?.category}
                  imageUrl={current.cover_url}
                  size="xl"
                />
              </div>
            </div>

            <div className="w-full max-w-xs text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                {current.title}
              </h2>
              <p className="mt-1 text-sm text-white/70">{current.artist ?? '—'}</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur">
                  <TrackLikeButton
                    trackId={current.id}
                    track={current}
                    size={16}
                    stopPropagation={false}
                  />
                </span>
                <ShareButton
                  title={`듣다 — ${current.title}`}
                  text={current.artist ?? '지금 듣고 있는 곡'}
                  url={trackShareUrl(current.id)}
                  targetType="track"
                  targetId={current.id}
                  variant="icon"
                  className="border-0 bg-white/10 backdrop-blur ring-white/15 text-white/90 hover:text-white"
                />
                <AddToPlaylistButton trackId={current.id} variant="player" />
                {!playable && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-1 text-[11px] text-yellow-200 ring-1 ring-yellow-300/30">
                    <AlertCircle size={11} /> 음원 준비중
                  </span>
                )}
              </div>
            </div>

            <div className="w-full max-w-xs space-y-1.5">
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={onSeek}
                step={0.1}
                aria-label="재생 위치"
                disabled={!playable || !duration}
                style={{
                  ['--progress' as string]: duration ? `${(currentTime / duration) * 100}%` : '0%',
                }}
                className="seekbar-accent"
              />
              <div className="flex justify-between text-[11px] text-white/60">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setShuffle(!shuffle)}
                className={`p-2 transition ${shuffle ? 'text-accent' : 'text-white/60 hover:text-white'}`}
                aria-label="셔플"
              >
                <Shuffle size={20} />
              </button>
              <button onClick={handlePrev} className="p-2 text-white" aria-label="이전 곡">
                <SkipBack size={28} fill="currentColor" />
              </button>
              <button
                onClick={handlePlayBtn}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-2xl ring-1 ring-white/20 transition hover:scale-105 hover:bg-accent-soft disabled:opacity-50"
                aria-label={playing ? '일시정지' : '재생'}
                disabled={errored}
              >
                {playing ? (
                  <Pause size={26} fill="currentColor" />
                ) : (
                  <Play size={26} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button onClick={handleNext} className="p-2 text-white" aria-label="다음 곡">
                <SkipForward size={28} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeat}
                className={`p-2 transition ${repeat !== 'off' ? 'text-accent' : 'text-white/60 hover:text-white'}`}
                aria-label="반복"
              >
                {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>

            <div className="flex w-full max-w-xs items-center gap-2 text-white/60">
              <button onClick={toggleMute} aria-label={volume === 0 ? '음소거 해제' : '음소거'}>
                {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="볼륨"
              />
            </div>
          </div>

          {showQueue && (
            <div className="absolute inset-0 z-10 flex flex-col bg-bg/95 backdrop-blur-2xl pt-safe pb-safe animate-slide-up">
              <div className="flex items-center justify-between border-b border-line/10 px-5 py-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/60">재생 중</p>
                  <h3 className="text-base font-semibold">{playlist?.title ?? '대기열'}</h3>
                </div>
                <button
                  onClick={() => setShowQueue(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5"
                  aria-label="닫기"
                >
                  <ChevronDown size={20} />
                </button>
              </div>
              <ul className="flex-1 overflow-y-auto divide-y divide-line/10 px-3 py-2">
                {queue.map((t, i) => {
                  const tPlayable = isPlayableUrl(t.audio_url);
                  const isCurrent = i === index;
                  return (
                    <li
                      key={t.id}
                      onClick={() => {
                        if (i !== index) skipReasonRef.current = 'select_other'; // 다른 곡 선택 = 스킵
                        cancelCrossfade();
                        jumpTo(i);
                        setShowQueue(false);
                      }}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                        isCurrent ? 'bg-accent/15 text-accent' : 'hover:bg-ink/5'
                      } ${!tPlayable ? 'opacity-60' : ''}`}
                    >
                      <div className="w-6 text-right text-xs text-ink-dim">
                        {isCurrent ? (
                          <span className="text-accent">♪</span>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md">
                        <AutoCover
                          title={t.title}
                          category={playlist?.category}
                          imageUrl={t.cover_url}
                          size="sm"
                          showInitial={false}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="truncate text-xs text-ink-mute">
                          {!tPlayable ? '음원 준비중' : (t.artist ?? '—')}
                        </p>
                      </div>
                      {t.duration && (
                        <span className="text-xs text-ink-dim">{formatTime(t.duration)}</span>
                      )}
                      {tPlayable && (
                        <AddToPlaylistButton trackId={t.id} variant="bare" size={16} className="text-ink-mute" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
