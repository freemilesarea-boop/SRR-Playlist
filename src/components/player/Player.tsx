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
import { useBusinessStore } from '@/store/businessStore';
import { useModalA11y } from '@/hooks/useModalA11y';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useAudioSinkGuardian } from '@/hooks/useAudioSinkGuardian';
import { useAudioLongRunDiagnostics } from '@/hooks/useAudioLongRunDiagnostics';
import { useAudioRecoveryManager, type RecoveryReason } from '@/hooks/useAudioRecoveryManager';
import { useAudioLifecycleAudit } from '@/hooks/useAudioLifecycleAudit';
import { useAudioSessionState, type AudioSessionState } from '@/hooks/useAudioSessionState';
import { useAudioInvalidStateGuard } from '@/hooks/useAudioInvalidStateGuard';
import { AudioDiagnosticsDashboard } from '@/components/player/AudioDiagnosticsDashboard';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { getAudioObjectId } from '@/lib/audioOutput';
import { audioDebugWarn } from '@/lib/audioDebug';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
import { gradientStyle } from '@/lib/cover';
import { trackStream, recordPlaylistQualifiedView, getAnonymousId } from '@/lib/analytics';
import { logPlaybackEventV2 } from '@/lib/playbackEventsV2';
import { captureBusinessError } from '@/lib/sentry';
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
import BusinessExcludeButton from '@/components/player/BusinessExcludeButton';
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
 * X6.79 — iOS/iPadOS Safari 감지.
 * WebKit 은 audio.volume setter 를 무시 (Apple 정책) → 슬라이더 작동 X.
 * iPadOS 13+ 는 navigator.platform='MacIntel' 로 위장하므로 maxTouchPoints 로 추가 판별.
 */
function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 위장 케이스
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * 세션당 1회만 실패 처리되는 트랙 id 집합.
 * 모듈 스코프라 페이지 이동/컴포넌트 언마운트해도 유지 (브라우저 탭 단위).
 * SRC_NOT_SUPPORTED / DECODE 등 "재생 불가" 가 확정된 트랙을 같은 세션에서
 * 자동 next 무한 루프로 다시 시도하지 않게 한다.
 *
 * X6.66 — 24시간+ 매장 무중단 운영 시 무한 누적 방지 (truncateSetOldest 로 cap).
 */
const sessionFailedTrackIds = new Set<string>();

// X6.66 — track-id 기반 Map/Set 무한 성장 차단 (매장 24h+ 무중단 운영 대비).
// 한 매장이 한 달 연속 운영해도 메모리 안정. JS Map/Set 은 삽입 순서 유지 → LRU 트림.
const MAX_TRACK_HISTORY = 500;

function truncateMapOldest<K, V>(map: Map<K, V>, max: number): number {
  if (map.size <= max) return 0;
  let removed = 0;
  const overflow = map.size - max;
  const iter = map.keys();
  for (let i = 0; i < overflow; i++) {
    const { value, done } = iter.next();
    if (done) break;
    map.delete(value);
    removed += 1;
  }
  return removed;
}

function truncateSetOldest<T>(set: Set<T>, max: number): number {
  if (set.size <= max) return 0;
  let removed = 0;
  const overflow = set.size - max;
  const iter = set.values();
  for (let i = 0; i < overflow; i++) {
    const { value, done } = iter.next();
    if (done) break;
    set.delete(value);
    removed += 1;
  }
  return removed;
}

/** 재생 에러 토스트 디바운스 — 연속 실패 시 토스트 스택 방지(같은 메시지 1개). */
let lastErrorToastAt = 0;
const ERROR_TOAST_DEBOUNCE_MS = 3_000;

/**
 * 0091-fix — 추천 toast dedup (세션 / 10분).
 * 큐 끝 → 추천 추가 → 다시 끝 → 또 추가 시 toast 폭주 방지.
 */
let lastRecommendToastAt = 0;
const RECOMMEND_TOAST_DEDUP_MS = 10 * 60 * 1000;

/**
 * Phase 5-2 — next track preload / crossfade readiness 상수.
 *
 * PRELOAD_LEAD_MS   : crossfade 시점 이전에 next audio 를 미리 준비하는 lead time.
 *                     remaining ∈ [crossfadeSeconds+1, crossfadeSeconds+LEAD/1000] 창 안에서
 *                     idempotent 하게 nextAudio.src 세팅.
 * READINESS_TIMEOUT : startCrossfade 진입 시 nextAudio.readyState<HAVE_FUTURE_DATA 이면
 *                     canplay/canplaythrough 를 최대 timeout ms 대기. 초과 시 fallback.
 * DECODE_SLOW_MS    : 대기가 이 값을 넘으면 [audio:decode:slow] 로그.
 */
const PHASE_5_2_PRELOAD_LEAD_MS = 8000;
const PHASE_5_2_READINESS_TIMEOUT_MS = 800;
const PHASE_5_2_DECODE_SLOW_MS = 300;

/**
 * Phase 5-2 — nextAudio 의 readyState 를 HAVE_FUTURE_DATA(3) 이상으로 대기.
 * setInterval 사용 X · canplay/canplaythrough event listener + 단일 timeout.
 * 이미 준비되어 있으면 즉시 resolve · 아니면 timeout ms 대기 후 fallback.
 * 이 함수는 아무런 audio.load() / src 재설정 / currentTime 변경도 하지 않음.
 */
function awaitAudioReadiness(
  audio: HTMLAudioElement,
  timeoutMs: number,
): Promise<{ ready: boolean; waitedMs: number; readyState: number; networkState: number }> {
  if (audio.readyState >= 3 /* HAVE_FUTURE_DATA */) {
    return Promise.resolve({
      ready: true,
      waitedMs: 0,
      readyState: audio.readyState,
      networkState: audio.networkState,
    });
  }
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let done = false;
    const onCan = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve({
        ready: true,
        waitedMs: performance.now() - startedAt,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
    };
    audio.addEventListener('canplay', onCan, { once: true });
    audio.addEventListener('canplaythrough', onCan, { once: true });
    const timerId = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve({
        ready: false,
        waitedMs: performance.now() - startedAt,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
    }, timeoutMs);
    const cleanup = () => {
      audio.removeEventListener('canplay', onCan);
      audio.removeEventListener('canplaythrough', onCan);
      window.clearTimeout(timerId);
    };
  });
}

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
  // Phase 2-5 — MutableRefObject 로 변경. callback ref 안에서 .current 를 직접 대입해야 함.
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const [activeIdx, setActiveIdx] = useState<0 | 1>(0); // 0=A, 1=B
  const activeRef = () => (activeIdx === 0 ? audioARef.current : audioBRef.current);
  const nextRef = () => (activeIdx === 0 ? audioBRef.current : audioARef.current);

  // Phase 2-5 hotfix — audio element 실제 mount 시점을 Guardian 에게 알리는 revision.
  // Player 는 `if (!current) return null;` 로 초기 mount 시 <audio> 를 render 안 하고,
  // queue 채워진 이후에야 refs 가 붙는다. Guardian effect 의 deps 에 이 revision 을
  // 포함시켜, ref 연결 순간 자동으로 setSinkId 를 재적용한다.
  const [audioMountRevision, setAudioMountRevision] = useState(0);
  const lastMountedARef = useRef<HTMLAudioElement | null>(null);
  const lastMountedBRef = useRef<HTMLAudioElement | null>(null);
  const setAudioARef = useCallback((node: HTMLAudioElement | null) => {
    audioARef.current = node;
    if (node && node !== lastMountedARef.current) {
      lastMountedARef.current = node;
      setAudioMountRevision((v) => v + 1);
      audioDebugWarn('[audio:sink:mount] audio A connected', { revisionBumpTo: 'next', hasNode: true });
      // Phase 2-6 진단 로그 E — audio ref mount 시 audio 객체 identity 를 부여하고 기록.
      // 이후 Guardian apply · Player play 로그의 audioObjectId 와 대조하기 위함.
      audioDebugWarn('[audio:sink:audio-ref]', {
        slot: 'A',
        audioObjectId: getAudioObjectId(node),
        sinkId: (node as HTMLAudioElement & { sinkId?: string }).sinkId,
        currentSrc: node.currentSrc,
      });
    } else if (!node) {
      lastMountedARef.current = null;
    }
  }, []);
  const setAudioBRef = useCallback((node: HTMLAudioElement | null) => {
    audioBRef.current = node;
    if (node && node !== lastMountedBRef.current) {
      lastMountedBRef.current = node;
      setAudioMountRevision((v) => v + 1);
      audioDebugWarn('[audio:sink:mount] audio B connected', { revisionBumpTo: 'next', hasNode: true });
      audioDebugWarn('[audio:sink:audio-ref]', {
        slot: 'B',
        audioObjectId: getAudioObjectId(node),
        sinkId: (node as HTMLAudioElement & { sinkId?: string }).sinkId,
        currentSrc: node.currentSrc,
      });
    } else if (!node) {
      lastMountedBRef.current = null;
    }
  }, []);

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
  const businessMode = useBusinessStore((s) => s.businessMode);
  // Audio Output Phase 2 hotfix — audio element 두 개 각각에 sink guardian 적용.
  // useLayoutEffect 로 paint 이전 즉시 apply + loadstart/loadedmetadata/canplay
  // 이벤트마다 재확인. 재생 로직 무변경.
  //
  // Phase 2-4 — Guardian 이 { sinkReady, ensureSinkReady } 노출.
  //   • sinkReady = A/B 모두 audio.sinkId === desired 인 상태
  //   • ensureSinkReady 는 첫 play 직전에 attemptPlay 최상단에서 await
  const guardianA = useAudioSinkGuardian(audioARef, audioMountRevision);
  const guardianB = useAudioSinkGuardian(audioBRef, audioMountRevision);
  const sinkReady = guardianA.sinkReady && guardianB.sinkReady;
  const ensureSinkReady = useCallback(async (reason: string): Promise<boolean> => {
    const results = await Promise.allSettled([
      guardianA.ensureSinkReady(reason),
      guardianB.ensureSinkReady(reason),
    ]);
    const okA = results[0].status === 'fulfilled' && results[0].value === true;
    const okB = results[1].status === 'fulfilled' && results[1].value === true;
    return okA && okB;
  }, [guardianA, guardianB]);

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
  // Phase 3-1 — dual audio engine hardening.
  //   • lastEndedAtRef: onEnded 중복 발화 500ms dedup
  //   • lastProgressRef: currentTime 진행 tracking (stuck 감지 기준)
  //   • lastStuckRecoveryAtRef: recovery play 1초 cooldown
  //   • 이전 재생 로직 무변경 — guard 만 추가
  const lastEndedAtRef = useRef<{ trackId: string | null; ts: number }>({ trackId: null, ts: 0 });
  const lastProgressRef = useRef<{ trackId: string | null; ct: number; ts: number }>({ trackId: null, ct: 0, ts: 0 });
  const lastStuckRecoveryAtRef = useRef<number>(0);

  // Phase 4-1 — Recovery Manager ref (Phase 3-2 checkAudioHealth · onError · visibility
  //             · online 핸들러가 stale closure 없이 recoverAudio 호출).
  //             실제 함수는 useAudioRecoveryManager 후 대입.
  const recoverAudioRef = useRef<((reason: RecoveryReason, detail?: Record<string, unknown>) => Promise<void>) | null>(null);

  // Phase 6-1 — SessionState ↔ Recovery Manager cross-dependency lazy refs.
  // Session 은 recovery 진행 중 여부를 알아야 하고, Recovery 는 진입 시점 세션 상태를
  // 기록해야 한다. 두 hook 이 서로를 참조하므로 useRef 를 통해 지연 연결한다.
  const isRecoveringLazyRef = useRef<() => boolean>(() => false);
  const getSessionStateLazyRef = useRef<() => AudioSessionState>(() => 'idle');
  // Phase 6-1 — recordSessionTransition 을 checkAudioHealth · 이벤트 핸들러에서
  // 참조하기 위한 stable ref (useAudioSessionState 후 대입).
  const recordSessionTransitionRef = useRef<((reason: string) => AudioSessionState) | null>(null);
  // Phase 6-2 — Invalid State Guard 도 checkAudioHealth 에서 piggyback.
  const runInvalidStateCheckRef = useRef<((reason: string) => void) | null>(null);

  // Phase 5-1 — Lifecycle Audit 용 counter (Phase 3-1 native listener useEffect
  //             attach/detach 시 증가). flag OFF 이면 값 그대로 · 부작용 없음.
  const listenerAttachCountRef = useRef<number>(0);
  const listenerDetachCountRef = useRef<number>(0);

  // ============================================================
  // Phase 3-2 — Audio Engine Health Monitor
  // ============================================================
  // 이벤트 기반. 새 polling / setInterval 없음.
  // 기존 이벤트 훅 (onTimeUpdate · onCanPlay · onEnded · native listeners ·
  // visibility/focus/pageshow · crossfade complete/abort) 안에서 checkAudioHealth
  // 를 호출하면 snapshot 생성 → issue 평가 → 위험 상태별 최소 복구.
  // Phase 2 sinkId · Phase 3-1 guard 로직은 무변경.
  type HealthIssue =
    | 'inactive-playing'
    | 'active-stalled'
    | 'sink-mismatch'
    | 'both-playing'
    | 'neither-playing-while-playing-state'
    | 'crossfade-stuck';
  const HEALTH_COOLDOWN_MS = 1000;

  // React state snapshot ref — native listener 안에서도 stale closure 없이 접근.
  const healthStateRef = useRef({
    activeIdx: 0 as 0 | 1,
    playing: false,
    crossfading: false,
    sinkReady: false,
    currentTrackId: null as string | null,
    crossfadeSeconds: 0,
  });
  healthStateRef.current = {
    activeIdx,
    playing,
    crossfading,
    sinkReady,
    currentTrackId: current?.id ?? null,
    crossfadeSeconds,
  };

  // ensureSinkReady 는 useCallback → 각 렌더마다 재생성. ref 로 보관해서
  // stable checkAudioHealth 가 접근.
  const ensureSinkReadyRef = useRef(ensureSinkReady);
  ensureSinkReadyRef.current = ensureSinkReady;

  // crossfade-stuck 감지용 — startCrossfade 에서 set, completeSwap/cancelCrossfade
  // 에서 clear. 0 이면 crossfade 진입 안 함.
  const crossfadeStartedAtRef = useRef<number>(0);

  // Phase 5-2 — next audio preload state.
  // • preloadedNextIdRef: 마지막으로 preload 한 next track id (idempotent guard).
  // • preloadTimeoutRef : preload 타임아웃 setTimeout handle (cleanup 용).
  const preloadedNextIdRef = useRef<string | null>(null);
  const preloadTimeoutRef = useRef<number | null>(null);

  // per-issue 1초 cooldown
  const healthLastRecoveryRef = useRef<Map<HealthIssue, number>>(new Map());

  // active-stalled 감지용 — snapshot 시점 활성 audio 의 currentTime 진행 tracking.
  // Phase 3-1 lastProgressRef 와 별도 (event context 다름).
  const healthLastActiveProgressRef = useRef<{ trackId: string | null; ct: number; ts: number }>({
    trackId: null, ct: 0, ts: 0,
  });

  const checkAudioHealth = useCallback((reason: string) => {
    // Phase 6-1 — 이벤트 진입 시점에 SessionState 전이 기록 (health 판단 로직에는 영향 X).
    // recordSessionTransition 은 상태가 실제로 바뀔 때만 history/log 를 push.
    recordSessionTransitionRef.current?.(reason);
    // Phase 6-2 — Invalid State 감지 + pause 계열 최소 보정 (play() 는 절대 호출 X).
    runInvalidStateCheckRef.current?.(reason);
    const state = healthStateRef.current;
    const a = audioARef.current;
    const b = audioBRef.current;
    const activeEl = state.activeIdx === 0 ? a : b;
    const inactiveEl = state.activeIdx === 0 ? b : a;

    type SlotSnap = {
      paused: boolean; ended: boolean; currentTime: number; duration: number;
      volume: number; muted: boolean; readyState: number; networkState: number;
      sinkId: string; currentSrc: string;
    };
    const snapshotSlot = (el: HTMLAudioElement | null): SlotSnap | null => el ? {
      paused: el.paused,
      ended: el.ended,
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      volume: el.volume,
      muted: el.muted,
      readyState: el.readyState,
      networkState: el.networkState,
      sinkId: (el as HTMLAudioElement & { sinkId?: string }).sinkId ?? '',
      currentSrc: el.currentSrc,
    } : null;

    const desiredSinkId = useAudioOutputStore.getState().sinkId;
    const active = snapshotSlot(activeEl);
    const inactive = snapshotSlot(inactiveEl);

    const issues: HealthIssue[] = [];

    // inactive-playing (crossfade 아닌 상태에서 inactive 재생 중)
    if (!state.crossfading && inactive && !inactive.paused) {
      issues.push('inactive-playing');
    }
    // both-playing (crossfade 아닌 상태에서 둘 다 재생 중 — 이중 재생)
    if (!state.crossfading && active && inactive && !active.paused && !inactive.paused) {
      issues.push('both-playing');
    }
    // sink-mismatch — sinkReady 승격됐는데 실제 active.sinkId 가 desired 와 다름
    if (desiredSinkId && state.sinkReady && active && active.sinkId !== desiredSinkId) {
      issues.push('sink-mismatch');
    }
    // neither-playing-while-playing-state
    if (state.playing && !state.crossfading && active && active.paused && (!inactive || inactive.paused)) {
      issues.push('neither-playing-while-playing-state');
    }
    // active-stalled — playing 이면서 active !paused && !ended · ct 정지 > 2.5s
    if (state.playing && active && !active.paused && !active.ended) {
      const nowTs = performance.now();
      const last = healthLastActiveProgressRef.current;
      if (
        last.trackId === state.currentTrackId &&
        Math.abs(active.currentTime - last.ct) < 0.01 &&
        nowTs - last.ts > 2500
      ) {
        issues.push('active-stalled');
      }
      if (Math.abs(active.currentTime - last.ct) >= 0.01 || last.trackId !== state.currentTrackId) {
        healthLastActiveProgressRef.current = {
          trackId: state.currentTrackId, ct: active.currentTime, ts: nowTs,
        };
      }
    }
    // crossfade-stuck — crossfading + bothPlaying + 시간 초과
    if (
      state.crossfading && active && inactive &&
      !active.paused && !inactive.paused &&
      crossfadeStartedAtRef.current > 0
    ) {
      const elapsed = performance.now() - crossfadeStartedAtRef.current;
      if (elapsed > (state.crossfadeSeconds * 1000) + 2000) {
        issues.push('crossfade-stuck');
      }
    }

    if (issues.length === 0) return;

    // Phase 6-1 — health log 에 현재 SessionState 포함 (관측 통합).
    const sessionState = getSessionStateLazyRef.current();
    for (const issue of issues) {
      audioDebugWarn('[audio:health]', {
        reason,
        issue,
        activeIdx: state.activeIdx,
        playing: state.playing,
        crossfadeInProgress: state.crossfading,
        sinkReady: state.sinkReady,
        desiredSinkId,
        currentTrackId: state.currentTrackId,
        sessionState,
        active,
        inactive,
      });

      // per-issue 1초 cooldown
      const nowRec = performance.now();
      const lastRec = healthLastRecoveryRef.current.get(issue) ?? 0;
      if (nowRec - lastRec < HEALTH_COOLDOWN_MS) continue;
      healthLastRecoveryRef.current.set(issue, nowRec);

      const action =
        issue === 'inactive-playing' || issue === 'both-playing' ? 'inactive.pause+volume=0' :
        issue === 'sink-mismatch' ? 'ensureSinkReady(health-monitor)' :
        issue === 'active-stalled' || issue === 'neither-playing-while-playing-state' ? 'active.play()' :
        issue === 'crossfade-stuck' ? 'forceCompleteCrossfade' :
        'noop';

      // Phase 4-1 — issue → recovery reason mapping · Recovery Manager 위임.
      // 기존 Phase 3-2 직접 액션은 제거 · recoverAudio 가 단일 진입점.
      // Recovery Manager 내부에 per-reason cooldown / escalation 이 있어 안전.
      const reasonMap: Record<string, RecoveryReason | undefined> = {
        'inactive-playing': 'inactive-playing',
        'both-playing': 'both-playing',
        'sink-mismatch': 'sink-mismatch',
        'active-stalled': 'stalled',
        'neither-playing-while-playing-state': 'neither-playing',
        'crossfade-stuck': 'crossfade-stuck',
      };
      const mappedReason = reasonMap[issue];
      if (mappedReason && recoverAudioRef.current) {
        void recoverAudioRef.current(mappedReason, { source: 'health-monitor', action });
        audioDebugWarn('[audio:health:recovery]', { issue, action, ok: true, delegated: mappedReason });
      } else {
        audioDebugWarn('[audio:health:recovery]', { issue, action, ok: false, error: 'recoverAudio unavailable' });
      }
    }
  }, []);

  // ============================================================
  // Phase 3-3 — Long-Run Playback Stability Test Harness
  // ============================================================
  // 매장 12h/24h 장시간 재생 관측용. 활성화 flag 가 켜졌을 때만 hook 내부에서
  // 30초 tick + 10분 summary interval 을 생성. flag OFF 일 때는 no-op — 새
  // polling / setInterval 0. 관찰 전용 · 재생 로직 변경 없음.
  //
  // 활성화: URL `?audioLongRun=1` 또는 localStorage 'deudda.audioLongRun'='1'
  const { getLongRunSummary } = useAudioLongRunDiagnostics({
    audioARef,
    audioBRef,
    getActiveIdx: () => activeIdx,
    getPlaying: () => playing,
    getCrossfading: () => crossfading,
    getSinkReady: () => sinkReady,
    getCurrentTrackId: () => current?.id ?? null,
  });

  // ============================================================
  // Phase 4-1 — Self-Healing Audio Recovery Manager
  // ============================================================
  // Phase 3-2 health monitor / onError / visibility·network 복귀 시 단계적
  // 자동 복구. reason 별 1s cooldown · 10s window 5회 → escalation 60s.
  // Phase 6-1 — Audio Session State Machine (관측 전용).
  // 재생 로직 변경 없음 · Recovery / Health / Dashboard 가 단일 상태 모델 참조.
  const {
    getCurrentSessionState,
    getSessionSummary,
    recordTransition: recordSessionTransition,
  } = useAudioSessionState({
    audioARef,
    audioBRef,
    getActiveIdx: () => activeIdx,
    getPlaying: () => playing,
    getCrossfading: () => crossfading,
    getCurrentTrackId: () => current?.id ?? null,
    getErrored: () => errored,
    getRecovering: () => isRecoveringLazyRef.current(),
  });
  // Lazy ref 로 Recovery ↔ Session cross-wiring.
  getSessionStateLazyRef.current = getCurrentSessionState;
  recordSessionTransitionRef.current = recordSessionTransition;

  // getForceCompleteCrossfade 는 closure — forceCompleteCrossfadeRef 는 line 1165
  // 근방 crossfade engine 섹션에서 선언되지만, 함수 호출 시점에는 이미 정의된 상태.
  const { recoverAudio, getRecoveryHistory, getRecoverySummary, isRecovering } = useAudioRecoveryManager({
    audioARef,
    audioBRef,
    getActiveIdx: () => activeIdx,
    getCrossfading: () => crossfading,
    getForceCompleteCrossfade: () => forceCompleteCrossfadeRef.current,
    ensureSinkReady,
    // Phase 4-1 autoplay hotfix — Recovery Manager 가 사용자 재생 의도 확인.
    // playing=false 이면 어떤 recovery 경로도 active.play() 호출 X + 이미 재생
    // 중이면 강제 pause. UI 와 DOM 상태 sync.
    getPlayingExpected: () => playing,
    // Phase 6-1 SessionState — 진입 시점 상태 스냅샷 (관측 전용).
    getSessionState: () => getSessionStateLazyRef.current(),
  });
  // Phase 6-1 — recoverAudio wrapper: Recovery 진입 시 sync 로 inProgressRef=true 가
  // 설정된 직후 recordSessionTransition 을 호출해 'recovering' state 를 기록.
  // 완료 후 다시 호출해 다음 state 로 전이 기록. Recovery priority · 실행 로직은
  // 무변경 (wrapper 는 pre/post 로그만 담당).
  const recoverAudioWithSession: (
    reason: RecoveryReason,
    detail?: Record<string, unknown>,
  ) => Promise<void> = async (reason, detail) => {
    // recoverAudio 는 첫 await 이전 sync 코드에서 inProgressRef 를 세팅한다.
    // Promise 참조를 먼저 확보한 뒤 transition 을 기록해야 최신 flag 반영됨.
    const promise = recoverAudio(reason, detail);
    recordSessionTransition(`recovery:${reason}`);
    try {
      await promise;
    } finally {
      recordSessionTransition(`recovery-end:${reason}`);
    }
  };
  // Phase 4-1 — 다른 handler 에서 recoverAudio 를 stable ref 로 접근
  recoverAudioRef.current = recoverAudioWithSession;
  // Phase 6-1 — Recovery 진행 flag 를 Session 이 참조.
  isRecoveringLazyRef.current = isRecovering;

  // Phase 6-2 — Invalid State Detector / State Consistency Guard.
  // 관측 + pause 계열 최소 보정만 담당. play() / load() / src / currentTime 무변경.
  // Recovery 진행 중이면 보정 skip 하여 Recovery Manager 와 경합 방지.
  const { runCheck: runInvalidStateCheck, getInvalidStateSummary } = useAudioInvalidStateGuard({
    audioARef,
    audioBRef,
    getActiveIdx: () => activeIdx,
    getPlaying: () => playing,
    getCrossfading: () => crossfading,
    getSinkReady: () => sinkReady,
    getDesiredSinkId: () => useAudioOutputStore.getState().sinkId,
    getSessionSummary,
    getIsRecovering: isRecovering,
  });
  // checkAudioHealth 에서 참조하는 lazy ref 에 연결.
  runInvalidStateCheckRef.current = runInvalidStateCheck;

  // Phase 5-1 — Memory Leak Detection & Lifecycle Audit.
  // flag ON (audioDebug 또는 audioLongRun) 이면 60초 tick 으로 snapshot + leak
  // warning. flag OFF 이면 no-op. Dashboard 폴링용 getLifecycleSummary 반환.
  const { getLifecycleSummary } = useAudioLifecycleAudit({
    audioARef,
    audioBRef,
    getActiveIdx: () => activeIdx,
    getCrossfading: () => crossfading,
    getCrossfadeStartedAtMs: () => crossfadeStartedAtRef.current,
    getLongRunActive: () => getLongRunSummary().active,
    getDashboardActive: () => document.querySelector('[data-audio-diagnostics-dashboard]') !== null,
    getRafActive: () => crossfadeRafRef.current !== null,
    getTimeoutActive: () => crossfadeTimeoutRef.current !== null,
    getListenerAttachCount: () => listenerAttachCountRef.current,
    getListenerDetachCount: () => listenerDetachCountRef.current,
  });

  // 메타데이터(loadedmetadata) 로딩 타임아웃 — duration 0:00 으로 멈춰있으면 재생 불가로 처리.
  const metaTimerRef = useRef<number | null>(null);
  // NETWORK(코드2) 오류 곡당 1회 자동 재시도 추적.
  // X6.62: 매장모드 신뢰성 — Set → Map (트랙별 retry 횟수). 매장 3회 / 일반 1회.
  const networkRetriedRef = useRef<Map<string, number>>(new Map());
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
            // X6.67 — 매장 무인환경에서는 무음 (사용자 보이지 않음) → Sentry alert.
            if (businessMode) {
              void captureBusinessError(new Error('META_TIMEOUT'), 'player.meta_timeout', {
                trackId, title: current.title,
                audioUrl: current.audio_url,
                readyState: a?.readyState, networkState: a?.networkState,
                queueLength: usePlayerStore.getState().queue.length,
              });
            }
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
    // Phase 3-1 — invariant: crossfade 아닌 상태에서 inactive audio 는 paused 여야 함.
    // completeSwap 은 old-active 를 이미 pause 하지만, cancelCrossfade / seek race /
    // browser 자체 resume 등으로 inactive 가 재생 중이면 이중 재생 발생.
    const a = audioARef.current;
    const b = audioBRef.current;
    const inactive = activeIdx === 0 ? b : a;
    if (inactive && !inactive.paused) {
      audioDebugWarn('[audio:engine:invariant]', {
        activeIdx,
        activePaused: (activeIdx === 0 ? a : b)?.paused,
        inactivePaused: inactive.paused,
        activeVolume: (activeIdx === 0 ? a : b)?.volume,
        inactiveVolume: inactive.volume,
        crossfadeInProgress: crossfading,
      });
      try { inactive.pause(); } catch { /* noop */ }
    }
  }, [volume, activeIdx, crossfading]);

  /* ============================================
   * X6.63 — visibility/online resume + 매장 heartbeat
   * ----------------------------------------------
   * iOS Safari / mobile background → 앱 복귀 시 HTMLAudioElement.paused=true
   * 인데 playerStore.playing=true 인 경우 자동 무음. 사용자 별도 클릭 필요.
   * → visibilitychange / online / pageshow / focus 시 active audio 자동 resume.
   *
   * 매장모드 추가 보호: 30초마다 heartbeat 로 playing=true 인데 audio.paused
   * 인 케이스 감지해 resume 시도. (이벤트가 안 발화되는 silent suspend 대비)
   * ============================================ */
  useEffect(() => {
    const tryResume = (reason: string) => {
      const audio = activeRef();
      if (!audio) return;
      const st = usePlayerStore.getState();
      if (!st.playing) return;            // 사용자 의도적 일시정지
      if (!audio.src) return;             // src 미설정 (track sync effect 가 처리)

      // X6.79 — 재생 중이지만 무음(volume=0 또는 muted) 케이스 자동 복원.
      // 매장 2-3곡 후 silent 버그 대응: crossfade swap race / OS background
      // suspend 후 volume 이 0 으로 남는 케이스 모두 흡수.
      const storeVol = st.volume;
      if (storeVol > 0) {
        if (audio.muted) {
          console.warn('[player] silent silence detected — unmute', { reason, id: st.queue[st.index]?.id });
          audio.muted = false;
        }
        if (audio.volume === 0 && !crossfading) {
          console.warn('[player] silent silence detected — restore volume', {
            reason, id: st.queue[st.index]?.id, restored: storeVol,
          });
          audio.volume = storeVol;
        }
      }

      if (!audio.paused) return;          // 이미 재생 중 (위 무음 복원만 수행)

      console.info('[player] auto-resume', { reason, id: st.queue[st.index]?.id });
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch((e) => {

          console.warn('[player] auto-resume failed', { reason, err: e instanceof Error ? e.message : String(e) });
        });
      }
    };
    // X6.88 — stuck crossfade 감지 + 강제 완료.
    // visibility/focus/pageshow/heartbeat 진입 시 양쪽 audio 동시 재생이면 즉시 swap.
    // rAF stall (hidden tab throttle) 로 fade 가 멈춰서 2곡 동시 들리는 케이스 차단.
    const recoverStuckCrossfade = (trigger: string) => {
      const a = audioARef.current;
      const b = audioBRef.current;
      const bothAudible = !!(a && !a.paused && b && !b.paused);
      if (bothAudible && forceCompleteCrossfadeRef.current) {
        console.warn('[player] stuck crossfade recovered', { trigger });
        forceCompleteCrossfadeRef.current(`stuck_${trigger}`);
      }
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        console.info('[player] visibility resume');
        recoverStuckCrossfade('visibility');
        tryResume('visibility');
        checkAudioHealth('visibilitychange');
        // Phase 4-1 — visibility 복귀 시 Recovery Manager 도 함께 진입.
        void recoverAudioRef.current?.('visibility-resume', { source: 'visibilitychange' });
      }
    };
    const onOnline = () => {
      tryResume('online');
      checkAudioHealth('online');
      // Phase 4-1 — network 복귀 시 Recovery Manager 진입.
      void recoverAudioRef.current?.('network-resume', { source: 'online' });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        recoverStuckCrossfade('pageshow');
        tryResume('pageshow');
        checkAudioHealth('pageshow');
        void recoverAudioRef.current?.('visibility-resume', { source: 'pageshow' });
      }
    };
    const onFocus = () => {
      recoverStuckCrossfade('focus');
      tryResume('focus');
      checkAudioHealth('focus');
      void recoverAudioRef.current?.('visibility-resume', { source: 'focus' });
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);

    // 매장모드 heartbeat — 30초마다 silent suspend 감지 + 복구 + stuck crossfade 감지
    let heartbeatId: number | null = null;
    if (businessMode) {
      heartbeatId = window.setInterval(() => {
        tryResume('heartbeat');
        recoverStuckCrossfade('heartbeat');
      }, 30_000);
    }

    // X6.66 — track-id 기반 Map/Set 1시간마다 prune (24h+ 매장 무중단 누적 차단).
    // 일반 사용자는 1세션이 짧아 불필요 → 매장 모드 한정.
    let pruneId: number | null = null;
    if (businessMode) {
      pruneId = window.setInterval(() => {
        const a = truncateMapOldest(pev2StartedTracksRef.current, MAX_TRACK_HISTORY);
        const b = truncateMapOldest(networkRetriedRef.current, MAX_TRACK_HISTORY);
        const c = truncateSetOldest(sessionFailedTrackIds, MAX_TRACK_HISTORY);
        if (a + b + c > 0) {
          console.info('[player] track-history prune', { started: a, network: b, failed: c });
        }
      }, 60 * 60 * 1000); // 1h
    }

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      if (pruneId !== null) window.clearInterval(pruneId);
    };
    // activeRef 는 ref function (안정), businessMode 변경 시만 heartbeat 재설정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessMode]);

  /* ============================================
   * Crossfade 엔진
   * ============================================ */
  const crossfadeRafRef = useRef<number | null>(null);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const triggeredAtTrackIdRef = useRef<string | null>(null);
  // X6.88 — 진행 중인 crossfade 의 force-complete 핸들 (idempotent).
  // visibility/heartbeat/onEnded 가 stuck crossfade 를 감지하면 이걸 호출.
  const forceCompleteCrossfadeRef = useRef<((reason: string) => void) | null>(null);

  function cancelCrossfade() {
    // Phase 3-1 — cancel 로그 (rAF/timeout 실제로 있었는지, force ref 있었는지 함께 기록)
    const hadRaf = crossfadeRafRef.current !== null;
    const hadTimeout = crossfadeTimeoutRef.current !== null;
    const hadForce = forceCompleteCrossfadeRef.current !== null;
    if (crossfadeRafRef.current !== null) {
      cancelAnimationFrame(crossfadeRafRef.current);
      crossfadeRafRef.current = null;
    }
    if (crossfadeTimeoutRef.current !== null) {
      window.clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }
    forceCompleteCrossfadeRef.current = null;  // X6.88
    setCrossfading(false);
    triggeredAtTrackIdRef.current = null;
    // Phase 3-2 — health monitor crossfade-stuck timestamp clear
    crossfadeStartedAtRef.current = 0;
    if (hadRaf || hadTimeout || hadForce) {
      audioDebugWarn('[audio:engine:crossfade-abort]', { hadRaf, hadTimeout, hadForce });
      checkAudioHealth('crossfade-abort');
    }
  }

  /** 트랙 종료 X초 전 도달 시 crossfade 시작 */
  const startCrossfade = useCallback(async () => {
    // X6.88.1 — 매장 모드 hard runtime guard. localStorage 상태/사용자 override 무관
    // 매장에서는 어떤 경우에도 crossfade 가 동작하지 않음 (rAF stall 회귀 절대 차단).
    if (businessMode) return;
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
    // Phase 3-2 — crossfade start timestamp (health monitor crossfade-stuck 감지 기준)
    crossfadeStartedAtRef.current = performance.now();

    // Phase 5-2 — src 재설정 idempotent guard.
    // preload effect 가 이미 nextAudio.src 를 세팅했으면 재설정 skip → 브라우저 재fetch 방지.
    const nextUrl = nextTrack.audio_url;
    const alreadyLoaded = nextAudio.src === nextUrl || nextAudio.currentSrc === nextUrl;
    // Phase 3-1 — crossfade 실제 시작 로그 (guard 통과 후)
    audioDebugWarn('[audio:engine:crossfade-start]', {
      fromTrackId: current.id,
      toTrackId: nextTrack.id,
      activeIdx,
      swapToIdx: activeIdx === 0 ? 1 : 0,
      crossfadeSeconds,
      currentTime,
      duration,
      preloadedSrcMatch: alreadyLoaded,
      readyStateBefore: nextAudio.readyState,
      networkStateBefore: nextAudio.networkState,
    });

    if (!alreadyLoaded) {
      nextAudio.src = nextUrl;
    }
    // 기존 setup 유지 — currentTime=0/volume=0 은 fresh src 상태에서 idempotent.
    nextAudio.currentTime = 0;
    nextAudio.volume = 0;

    // Phase 5-2 — readyState<HAVE_FUTURE_DATA 이면 canplay 최대 READINESS_TIMEOUT_MS 대기.
    // 이미 준비되어 있으면 즉시 resolve (waitedMs=0). 초과 시 fallback 하고 그대로 진행.
    const readiness = await awaitAudioReadiness(nextAudio, PHASE_5_2_READINESS_TIMEOUT_MS);
    if (readiness.waitedMs > PHASE_5_2_DECODE_SLOW_MS) {
      audioDebugWarn('[audio:decode:slow]', {
        toTrackId: nextTrack.id,
        waitedMs: Math.round(readiness.waitedMs),
        ready: readiness.ready,
        readyState: readiness.readyState,
      });
    }
    if (!readiness.ready && nextAudio.networkState === 2 /* NETWORK_LOADING */) {
      audioDebugWarn('[audio:network:waiting]', {
        toTrackId: nextTrack.id,
        waitedMs: Math.round(readiness.waitedMs),
        networkState: nextAudio.networkState,
        readyState: nextAudio.readyState,
      });
    }

    // Phase 5-2 — 대기 도중 사용자가 skip 하면 current.id 가 바뀐다. 그 경우 이 crossfade 는
    // 이미 무효 (진짜 다음 곡이 다른 트랙일 수 있음). 안전하게 abort.
    const stAfterWait = usePlayerStore.getState();
    if (stAfterWait.queue[stAfterWait.index]?.id !== current.id) {
      audioDebugWarn('[audio:crossfade:superseded]', {
        expectedFromId: current.id,
        actualCurrentId: stAfterWait.queue[stAfterWait.index]?.id ?? null,
        toTrackId: nextTrack.id,
      });
      triggeredAtTrackIdRef.current = null;
      crossfadeStartedAtRef.current = 0;
      return;
    }

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
    const swapToIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;

    // X6.88 — completeSwap: idempotent. rAF tick / setTimeout safety / 외부 force 가 모두 호출.
    // 첫 호출만 실행, 이후는 no-op. crossfade rAF stall (hidden tab) 에서도 swap 보장.
    let completed = false;
    const completeSwap = (reason: string) => {
      if (completed) return;
      completed = true;
      console.info('[player] crossfade complete', {
        reason, from: current.id, to: nextTrack.id, elapsedMs: Math.round(performance.now() - startedAt),
      });
      // Phase 3-1 — engine-scope crossfade complete 로그 (reason 별 종료 경로 추적)
      audioDebugWarn('[audio:engine:crossfade-complete]', {
        reason,
        fromTrackId: current.id,
        toTrackId: nextTrack.id,
        elapsedMs: Math.round(performance.now() - startedAt),
        swapToIdx,
      });
      // 양쪽 audio 안전 처리 — 어떤 reason 이든 active 즉시 pause
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio.volume = 0;
      }
      // X6.61 — jumpTo 이전에 lastTrackIdRef 설정 → track sync useEffect 가 nextAudio.src 재설정 안 함
      lastTrackIdRef.current = nextTrack.id;
      // X6.79 — stale targetVol 보정: 현재 store volume 으로 nextAudio 볼륨 설정
      const storeVol = usePlayerStore.getState().volume;
      if (nextAudio) {
        nextAudio.volume = storeVol;
        if (nextAudio.muted) nextAudio.muted = false;
      }
      setActiveIdx(swapToIdx);
      setCrossfading(false);
      if (crossfadeRafRef.current !== null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      if (crossfadeTimeoutRef.current !== null) {
        window.clearTimeout(crossfadeTimeoutRef.current);
        crossfadeTimeoutRef.current = null;
      }
      forceCompleteCrossfadeRef.current = null;
      // Phase 3-2 — health monitor crossfade-stuck 감지용 timestamp clear
      crossfadeStartedAtRef.current = 0;
      // playerStore 의 index 도 다음으로 (jumpTo 가 src 재설정하면 안 되니 단순 set)
      jumpTo(nextIdx);
      // Phase 3-2 — swap 직후 health check (invariant 확인)
      checkAudioHealth('crossfade-complete');
    };

    // 외부 (visibility / heartbeat / onEnded) 에서 호출 가능하게 expose
    forceCompleteCrossfadeRef.current = completeSwap;

    const tick = () => {
      if (completed) return;  // X6.88 — setTimeout/forceComplete 가 먼저 끝낸 경우 guard
      const now = performance.now();
      const t = Math.min(1, (now - startedAt) / durationMs);
      if (activeAudio) activeAudio.volume = Math.max(0, targetVol * (1 - t));
      if (nextAudio) nextAudio.volume = Math.min(1, targetVol * t);
      if (t < 1) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
      } else {
        completeSwap('raf');
      }
    };
    crossfadeRafRef.current = requestAnimationFrame(tick);

    // X6.88 — Safety net: rAF stall (탭 hidden / page throttle) 시에도 swap 보장.
    // setTimeout 은 background 에서도 fire (≥1초 throttle 가능, 정지 X).
    // 정상 케이스에서는 tick 이 먼저 completeSwap 호출 → 이 setTimeout 은 no-op.
    crossfadeTimeoutRef.current = window.setTimeout(
      () => completeSwap('safety_timeout'),
      durationMs + 1000,
    );
    // activeRef / nextRef 는 ref 객체 (안정) — deps 포함 시 끝없는 재등록
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    businessMode,
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
    // X6.88.1 — 매장 모드 hard guard (localStorage 와 무관)
    if (businessMode) return;
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!playing) return;
    if (crossfading) return;
    if (repeat === 'one') return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration <= crossfadeSeconds + 5) return; // 곡이 너무 짧으면 X (3초 튐 방지)
    if (currentTime <= 10) return; // 시작 10초 안에는 절대 금지
    const remaining = duration - currentTime;
    if (remaining <= crossfadeSeconds && remaining > 0.2) {
      // startCrossfade 는 async. 실패는 내부에서 처리, 여기서는 fire-and-forget.
      void startCrossfade();
    }
  }, [businessMode, currentTime, duration, crossfadeEnabled, crossfadeSeconds, crossfading, playing, repeat, startCrossfade]);

  /* ============================================
   * Phase 5-2 — Next Track Preload
   * ----------------------------------------------
   * 목적: crossfade 시점보다 lead time 만큼 이전에 nextAudio.src 를 세팅해
   *   fetch/decode 을 미리 시작. crossfade 시작 latency 를 최소화.
   *
   * 규칙:
   *   • businessMode / crossfade 비활성 / repeat=one / no next → skip.
   *   • current.id 당 1회만 실행 (preloadedNextIdRef idempotent guard).
   *   • nextAudio.src 이미 같은 URL 이면 재설정 X (currentSrc/src 매칭).
   *   • audio.load() 신규 호출 X · currentTime 초기화 X · play() X.
   *   • canplay/error 리스너 { once: true } + 단일 setTimeout — polling 없음.
   *   • 모든 로그는 audioDebugWarn (debug flag OFF 시 조용).
   *   • 실패해도 startCrossfade 는 기존 경로로 fallback.
   * ============================================ */
  const preloadNextTrack = useCallback(() => {
    if (businessMode) return;
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!playing) return;
    if (crossfading) return;
    if (repeat === 'one') return;
    if (!current) return;
    const nextIdx = computeNextIndex(queue.length, index, shuffle, shuffleOrder, repeat);
    if (nextIdx === null) return;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || !nextTrack.audio_url || !isPlayableUrl(nextTrack.audio_url)) return;
    if (preloadedNextIdRef.current === nextTrack.id) return; // idempotent
    const nextAudio = nextRef();
    if (!nextAudio) return;

    // 이미 같은 src 로 로드되어 있으면 재설정 skip (browser 재fetch 방지).
    const nextUrl = nextTrack.audio_url;
    const alreadyLoaded = nextAudio.src === nextUrl || nextAudio.currentSrc === nextUrl;
    if (alreadyLoaded) {
      preloadedNextIdRef.current = nextTrack.id;
      audioDebugWarn('[audio:preload:skip]', {
        fromTrackId: current.id,
        toTrackId: nextTrack.id,
        reason: 'already-loaded',
        readyState: nextAudio.readyState,
      });
      return;
    }

    preloadedNextIdRef.current = nextTrack.id;
    const startedAt = performance.now();

    audioDebugWarn('[audio:preload:start]', {
      fromTrackId: current.id,
      toTrackId: nextTrack.id,
      readyStateBefore: nextAudio.readyState,
      networkStateBefore: nextAudio.networkState,
      leadMs: PHASE_5_2_PRELOAD_LEAD_MS,
    });

    // src 재설정만 — load() / currentTime / play 모두 호출 안 함.
    // preload="metadata" 속성이 걸려 있으므로 브라우저가 자동으로 metadata fetch.
    nextAudio.src = nextUrl;

    // 이전 preload timer 정리 (다른 track 으로 preload 재시작한 경우)
    if (preloadTimeoutRef.current !== null) {
      window.clearTimeout(preloadTimeoutRef.current);
      preloadTimeoutRef.current = null;
    }

    let done = false;
    const cleanup = () => {
      nextAudio.removeEventListener('canplay', onReady);
      nextAudio.removeEventListener('error', onErrorEv);
      if (preloadTimeoutRef.current !== null) {
        window.clearTimeout(preloadTimeoutRef.current);
        preloadTimeoutRef.current = null;
      }
    };
    const onReady = () => {
      if (done) return;
      done = true;
      cleanup();
      audioDebugWarn('[audio:preload:ready]', {
        toTrackId: nextTrack.id,
        waitedMs: Math.round(performance.now() - startedAt),
        readyState: nextAudio.readyState,
        networkState: nextAudio.networkState,
      });
    };
    const onErrorEv = () => {
      if (done) return;
      done = true;
      cleanup();
      audioDebugWarn('[audio:preload:error]', {
        toTrackId: nextTrack.id,
        elapsedMs: Math.round(performance.now() - startedAt),
        errCode: nextAudio.error?.code ?? null,
      });
      // preload 실패 시 idempotent guard 해제 → 다음 preload trigger 에서 재시도 가능.
      // startCrossfade 는 나중에 자체 readiness 대기로 fallback.
      preloadedNextIdRef.current = null;
    };
    nextAudio.addEventListener('canplay', onReady, { once: true });
    nextAudio.addEventListener('error', onErrorEv, { once: true });
    preloadTimeoutRef.current = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      audioDebugWarn('[audio:preload:timeout]', {
        toTrackId: nextTrack.id,
        elapsedMs: PHASE_5_2_PRELOAD_LEAD_MS,
        readyState: nextAudio.readyState,
        networkState: nextAudio.networkState,
      });
      // timeout 은 poison 아님 — src 는 이미 세팅, 브라우저는 계속 로드 중.
      // startCrossfade 의 awaitAudioReadiness 가 최종 800ms 대기 후 fallback 처리.
    }, PHASE_5_2_PRELOAD_LEAD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessMode, crossfadeEnabled, crossfadeSeconds, playing, crossfading, repeat, current, queue, index, shuffle, shuffleOrder]);

  // Preload trigger — remaining ∈ [crossfadeSeconds+1, crossfadeSeconds+PRELOAD_LEAD_MS/1000] 창에서 실행.
  useEffect(() => {
    if (businessMode) return;
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!playing) return;
    if (crossfading) return;
    if (repeat === 'one') return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration <= crossfadeSeconds + 5) return;
    if (currentTime <= 10) return;
    const remaining = duration - currentTime;
    const preloadWindowEnd = crossfadeSeconds + PHASE_5_2_PRELOAD_LEAD_MS / 1000;
    const preloadWindowStart = crossfadeSeconds + 1; // crossfade 진입 직전 1초 buffer
    if (remaining <= preloadWindowEnd && remaining > preloadWindowStart) {
      preloadNextTrack();
    }
  }, [businessMode, crossfadeEnabled, crossfadeSeconds, playing, crossfading, repeat, currentTime, duration, preloadNextTrack]);

  // 트랙 변경 시 idempotent guard 리셋 · 진행 중 preload timer 정리.
  useEffect(() => {
    preloadedNextIdRef.current = null;
    if (preloadTimeoutRef.current !== null) {
      window.clearTimeout(preloadTimeoutRef.current);
      preloadTimeoutRef.current = null;
    }
  }, [current?.id]);

  // 언마운트 시 preload timer 정리.
  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current !== null) {
        window.clearTimeout(preloadTimeoutRef.current);
        preloadTimeoutRef.current = null;
      }
    };
  }, []);

  // 사용자 next/prev 시 fade 취소 (unmount 시 정리)
  // cancelCrossfade 는 매 렌더 재생성되지만 unmount 시점에 stale ref 를 참조해도
  // 실제 취소해야 할 rAF/timeout 은 이미 unmount 로 무의미해지므로 무해.
  useEffect(() => {
    return () => cancelCrossfade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 3-1 — audio element 진단 이벤트 listener.
  // stalled / waiting / suspend / emptied / playing / pause 는 React 이벤트 props 로
  // 노출 안 되거나 부수효과 있어 native addEventListener 로 감지 로그만 남긴다.
  // audio ref 가 remount 되면 audioMountRevision 이 오르므로 재부착.
  useEffect(() => {
    const a = audioARef.current;
    const b = audioBRef.current;
    const events = ['stalled', 'waiting', 'suspend', 'emptied', 'playing', 'pause'] as const;
    type Handler = { el: HTMLAudioElement; ev: string; fn: (e: Event) => void };
    const handlers: Handler[] = [];
    const attach = (el: HTMLAudioElement | null, slot: 'A' | 'B') => {
      if (!el) return;
      events.forEach((ev) => {
        const fn = () => {
          audioDebugWarn('[audio:engine:event]', {
            slot,
            event: ev,
            paused: el.paused,
            ended: el.ended,
            readyState: el.readyState,
            networkState: el.networkState,
            currentTime: el.currentTime,
            crossfadeInProgress: crossfading,
          });
          // Phase 3-2 — engine event 마다 health check
          checkAudioHealth(`event:${ev}`);
        };
        el.addEventListener(ev, fn);
        handlers.push({ el, ev, fn });
        // Phase 5-1 — attach counter
        listenerAttachCountRef.current += 1;
      });
    };
    attach(a, 'A');
    attach(b, 'B');
    return () => {
      handlers.forEach(({ el, ev, fn }) => {
        el.removeEventListener(ev, fn);
        // Phase 5-1 — detach counter
        listenerDetachCountRef.current += 1;
      });
      audioDebugWarn('[audio:engine:cleanup] event listeners removed', {
        count: handlers.length,
        audioMountRevision,
        totalAttach: listenerAttachCountRef.current,
        totalDetach: listenerDetachCountRef.current,
      });
    };
    // crossfading 은 log 안에서만 쓰이는 snapshot 이므로 deps 로 안 넣어도 됨.
    // audioMountRevision 은 A/B ref 실제 mount 시점 신호.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMountRevision]);

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

    // Phase 3-1 — stuck detection.
    // paused=false 인데 currentTime 이 2초 이상 진행 안 하면 recovery play 1회.
    // 1초 cooldown. play() 만 재호출, load()/src 재설정 X.
    const nowTs = performance.now();
    const nowTrackId = current?.id ?? null;
    const lastProgress = lastProgressRef.current;
    if (
      lastProgress.trackId === nowTrackId &&
      Math.abs(t - lastProgress.ct) < 0.01 &&
      !target.paused &&
      !target.ended &&
      nowTs - lastProgress.ts > 2000
    ) {
      if (nowTs - lastStuckRecoveryAtRef.current > 1000) {
        lastStuckRecoveryAtRef.current = nowTs;
        audioDebugWarn('[audio:engine:stuck]', {
          trackId: nowTrackId,
          currentTime: t,
          lastCT: lastProgress.ct,
          stallMs: Math.round(nowTs - lastProgress.ts),
          readyState: target.readyState,
          networkState: target.networkState,
          paused: target.paused,
        });
        const p = target.play();
        if (p && typeof p.catch === 'function') {
          p.then(() => {
            audioDebugWarn('[audio:engine:recovery-play] ok', { trackId: nowTrackId });
          }).catch((e) => {
            const err = e as { name?: string; message?: string };
            audioDebugWarn('[audio:engine:recovery-play] failed', {
              trackId: nowTrackId,
              err: err.name ?? err.message ?? String(e),
            });
            try {
              toast.warning('재생이 멈춘 것 같아요. 다시 재생해 주세요.');
            } catch { /* silent */ }
          });
        }
      }
    }
    if (Math.abs(t - lastProgress.ct) >= 0.01 || lastProgress.trackId !== nowTrackId) {
      lastProgressRef.current = { trackId: nowTrackId, ct: t, ts: nowTs };
    }

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
    // Phase 3-2 — health monitor hook (event-driven, cooldown-guarded)
    checkAudioHealth('timeupdate');
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
    checkAudioHealth('canplay');
  }

  // play() 호출 + 성공/실패 로그 + 일시적 실패 시 1회 재시도 (AbortError/NotAllowedError 제외)
  async function attemptPlay(audio: HTMLAudioElement, label: string) {
    // Phase 2-4 hotfix — 첫 play 이전에 audio.sinkId === desired 보장.
    //   • sinkReady=true 이면 즉시 skip (fast path, per-tag idempotent)
    //   • 실패해도 play 자체는 진행 (기본 출력 fallback)
    {
      const desiredSinkId = useAudioOutputStore.getState().sinkId;
      const activeAudio = activeRef() as (HTMLAudioElement & { sinkId?: string }) | null;
      const inactiveAudio = nextRef() as (HTMLAudioElement & { sinkId?: string }) | null;
      audioDebugWarn('[audio:sink:first-play-check]', {
        label,
        desiredSinkId,
        activeSinkId: activeAudio?.sinkId,
        inactiveSinkId: inactiveAudio?.sinkId,
        sinkReady,
        activeReadyState: activeAudio?.readyState,
        inactiveReadyState: inactiveAudio?.readyState,
      });
      // Phase 2-6 진단 로그 D — 실제 play 대상 audio 가 Guardian 이 sink 적용한 audio 와
      // 동일 객체인지 검증. activeRef/nextRef 매핑 오류, crossfade swap race, 다른 audio 에
      // play() 호출되는 경우 등을 판별.
      const audioObjectId = getAudioObjectId(audio);
      const activeAudioObjectId = activeAudio ? getAudioObjectId(activeAudio) : '<null>';
      const nextAudioObjectId = inactiveAudio ? getAudioObjectId(inactiveAudio) : '<null>';
      audioDebugWarn('[audio:sink:play-audit]', {
        label,
        desiredSinkId,
        sinkReady,
        activeRefSinkId: activeAudio?.sinkId,
        nextRefSinkId: inactiveAudio?.sinkId,
        playTargetSinkId: (audio as HTMLAudioElement & { sinkId?: string }).sinkId,
        playTargetMatchesActive: audio === activeAudio,
        playTargetMatchesNext: audio === inactiveAudio,
        playTargetSrc: audio.currentSrc,
        activeSrc: activeAudio?.currentSrc,
        nextSrc: inactiveAudio?.currentSrc,
        playTargetAudioObjectId: audioObjectId,
        activeAudioObjectId,
        nextAudioObjectId,
        activeIdx,
      });
      if (!sinkReady) {
        const ok = await ensureSinkReady(label);
        if (!ok) {
          audioDebugWarn(`[audio:sink:first-play-check] ensureSinkReady=false (${label}) — proceeding with default fallback`);
        }
      }
    }
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
    // X6.80 — 큐에 이미 있는 곡 제외 (중복 연속재생 차단)
    // 추천 결과에 현재 큐 트랙이 포함되면 그대로 [...queue, ...playable] 시 동일곡 재생됨.
    const queueIds = new Set(queue.map((t) => t.id));
    const fresh = playable.filter((r) => !queueIds.has(r.id));
    if (fresh.length === 0) {
      if (import.meta.env.DEV) console.debug('[Player] autoplay: 추천곡 모두 큐에 이미 있음 → skip');
      return false;
    }
    // 기존 큐에 이어 붙임 + 첫 추천곡으로 점프
    const newQueue = [...queue, ...fresh];
    usePlayerStore.setState({
      queue: newQueue,
      index: queue.length,
      playing: true,
      currentTime: 0,
      shuffleOrder: shuffle ? [...shuffleOrder, ...fresh.map((_, i) => queue.length + i)] : [],
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
    // active 가 ended 인 경우만 처리 (next-preload 가 어쩌다 끝난 경우 무시)
    if (e.currentTarget !== activeRef()) {
      console.debug('[player] ended ignored', { reason: 'not_active' });
      return;
    }

    // Phase 3-1 — onEnded 중복 발화 방지 (같은 트랙에서 500ms 이내 재발화 시 skip).
    // 일부 브라우저 (특히 iOS Safari · Chrome/Windows) 에서 seek/reset 후 ended 가
    // 두 번 fire 되어 next() 가 두 번 호출되는 케이스 차단.
    const nowMs = performance.now();
    const nowTrackId = current?.id ?? null;
    const lastEnded = lastEndedAtRef.current;
    if (lastEnded.trackId === nowTrackId && nowMs - lastEnded.ts < 500) {
      audioDebugWarn('[audio:engine:ended-lock] duplicate ended ignored', {
        trackId: nowTrackId,
        dtMs: Math.round(nowMs - lastEnded.ts),
      });
      return;
    }
    lastEndedAtRef.current = { trackId: nowTrackId, ts: nowMs };

    // 자연 종료 — 다음 트랙 변경 시 스킵으로 집계하지 않도록 표시.
    if (current) naturalEndRef.current = current.id;

    // 분석 이벤트는 crossfading 여부와 무관하게 항상 기록 (트랙 A 가 자연 종료한 사실은 동일)
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

    // X6.88 — crossfading=true 인데 active 가 ended 면 rAF tick 이 정지/stuck 가능.
    // 큐를 죽이지 않도록 force-complete 호출 → completeSwap 안에서 jumpTo 로 queue 진행.
    if (crossfading) {
      if (forceCompleteCrossfadeRef.current) {
        console.warn('[player] ended handled — forcing stuck crossfade swap');
        forceCompleteCrossfadeRef.current('active_ended');
        return; // completeSwap 이 jumpTo 호출. next() 별도 호출 X.
      }
      // forceCompleteRef 가 비어있는데 crossfading=true: state 불일치 (정상 swap 직후
      // setState 직전 race 등). fall through 해서 next() 가 처리.
      console.warn('[player] ended with crossfading=true but no force ref — falling through to next()');
    }
    console.debug('[player] ended handled — natural completion');

    // 자동 이어추천이 큐를 늘렸으면 next() 가 자연스럽게 동작 (마지막 → 새 곡)
    const endedId = current?.id ?? null;
    void maybeAutoplayRecommendations().then((added) => {
      if (added) return;
      // await 도중 사용자가 next/prev/트랙변경을 했으면 중복 진행 금지 (stale closure 방어)
      const st = usePlayerStore.getState();
      if (endedId !== null && st.queue[st.index]?.id !== endedId) return;
      next();
    });
    checkAudioHealth('ended');
  }

  function onError(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== activeRef()) return;
    if (!playable) return;
    const target = e.currentTarget;
    const err = target.error;
    const codeName = err ? (MEDIA_ERROR_CODES[err.code] ?? `code=${err.code}`) : 'UNKNOWN';
    // Phase 4-1 — Recovery Manager 위임 (Network 는 play retry · Decode/SrcNotSupported 는 log+toast).
    // 기존 재시도 로직 (아래) 은 유지 · Recovery Manager 는 병행 진입점.
    void recoverAudioRef.current?.('media-error', { errorCode: err?.code, codeName });
    // iOS Safari 실기기 원격 디버깅용 — 프로덕션에서도 항상 상세 로그(에러는 드물어 spam 아님).
    // codeName=SRC_NOT_SUPPORTED/DECODE 이면 코덱/컨테이너 문제(예: iOS 가 못 읽는 WAV).
     
    // iOS Safari 실기기 디버깅용 상세 로그 (track/src/code/networkState/readyState/시간/상태/UA)
    audioDebugWarn('[audio:error]', {
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

    // NETWORK(코드2): 스트리밍 중간 끊김 → 자동 재시도.
    // X6.62: 매장모드 3회 (지수 백오프), 일반 사용자 1회.
    // 자동 다음곡/토스트 없이 조용히 복구 시도. 한도 후에도 실패하면 아래 정지 로직.
    const maxRetries = businessMode ? 3 : 1;
    const retryCount = networkRetriedRef.current.get(current?.id ?? '') ?? 0;
    if (err?.code === 2 && current && playing && retryCount < maxRetries) {
      networkRetriedRef.current.set(current.id, retryCount + 1);
      const resumeAt = target.currentTime || currentTime || 0;
      const backoffMs = retryCount === 0 ? 0 : 1000 * Math.pow(2, retryCount - 1); // 0/1000/2000ms

      console.warn('[audio] NETWORK 오류 — 자동 재시도', { id: current.id, title: current.title, resumeAt, retry: retryCount + 1, max: maxRetries, backoffMs });
      const doRetry = () => {
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
      };
      if (backoffMs > 0) {
        window.setTimeout(doRetry, backoffMs);
      } else {
        doRetry();
      }
      return; // 정지/토스트 없이 재시도
    }

    // X6.67 — NETWORK 재시도 한도 초과 (code=2 인데 retry < max 분기에 안 들어옴 = 모두 소진).
    // 매장 무인환경에서 한 트랙이 maxRetries 만큼 실패 = 진짜 장애. Sentry alert.
    if (err?.code === 2 && businessMode && current && retryCount >= maxRetries) {
      void captureBusinessError(new Error('NETWORK_RETRY_EXHAUSTED'), 'player.network_retry_exhausted', {
        trackId: current.id, title: current.title,
        audioUrl: current.audio_url,
        retries: retryCount, max: maxRetries,
        readyState: target.readyState, networkState: target.networkState,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        queueLength: queue.length,
      });
    }

    // 디코딩/포맷 문제로 확정된 트랙 표시 (자동 스킵엔 쓰지 않고, 재시도 시 정리됨)
    const isPermanent = err?.code === 3 /* DECODE */ || err?.code === 4 /* SRC_NOT_SUPPORTED */;
    if (current && isPermanent) {
      sessionFailedTrackIds.add(current.id);
    }

    // X6.62: 매장모드 + 영구 오류 + 큐가 1곡 초과 시 자동 다음곡 (무인 운영 무음 방지).
    // 매장 사업자는 손가락 댈 수 없는 환경 — 곡 1개 손상되면 자동 skip 해서 음악 유지.
    // 일반 사용자는 기존 동작 (정지 + 에러 표시) 유지.
    if (current && isPermanent && playing && businessMode && queue.length > 1) {

      console.warn('[audio] 매장모드 영구 오류 — 자동 다음곡 시도 (3s 후)', { id: current.id });
      // X6.67 — 매장 자동 스킵된 트랙 = 검수자/아티스트가 인지 못함. Sentry 로 운영 알림.
      void captureBusinessError(new Error('PERMANENT_AUDIO_ERROR_AUTO_SKIPPED'), 'player.permanent_error_business', {
        trackId: current.id, title: current.title,
        audioUrl: current.audio_url,
        codeName, code: err?.code ?? null,
        queueLength: queue.length,
      });
      window.setTimeout(() => {
        // 여전히 같은 곡이 멈춰있고 매장모드면 next() 호출
        const st = usePlayerStore.getState();
        if (st.playing === false && st.queue[st.index]?.id === current.id) {
          st.next();
          // playing 다시 true 로 (next() 가 다음 트랙 set 후 자동 play 호출됨)
          usePlayerStore.setState({ playing: true });
        }
      }, 3000);
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
        ref={setAudioARef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />
      {/* Phase 4-2 — Debug-gated Diagnostics Dashboard. isAudioDebugEnabled() OFF 이면 null. */}
      <AudioDiagnosticsDashboard
        audioARef={audioARef}
        audioBRef={audioBRef}
        getActiveIdx={() => activeIdx}
        getPlaying={() => playing}
        getCrossfading={() => crossfading}
        getSinkReady={() => sinkReady}
        getCurrentTrackId={() => current?.id ?? null}
        getCurrentTrackTitle={() => current?.title ?? null}
        getRecoverySummary={getRecoverySummary}
        getRecoveryHistory={getRecoveryHistory}
        getLongRunSummary={getLongRunSummary}
        getLifecycleSummary={getLifecycleSummary}
        getSessionSummary={getSessionSummary}
        getInvalidStateSummary={getInvalidStateSummary}
      />
      <audio
        ref={setAudioBRef}
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
        {/* X6.79 — iOS/iPadOS Safari 는 audio.volume setter 를 무시 (WebKit 정책).
            매장 iPad 에서 슬라이더 안 먹힘 문제 안내. 데스크탑/안드로이드 정상. */}
        {volumePopover && isIOSSafari() && (
          <div className="px-3 py-1 text-[10px] leading-tight text-amber-700 dark:text-amber-300">
            ⚠️ iPhone/iPad 에서는 슬라이더가 작동하지 않습니다.
            기기 측면 <b>볼륨 ↑↓ 하드웨어 버튼</b> 으로 조절해주세요.
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
                {/* X6.72 — 매장 모드 1-click 제외 (business 플랜만, 클라이언트 가드는 컴포넌트 내부) */}
                <BusinessExcludeButton trackId={current.id} variant="expanded" />
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
                      {/* X6.74: 큐에서 직접 매장 제외 (현재 재생 외 트랙, business 한정 — 내부에서 가드) */}
                      {!isCurrent && (
                        <BusinessExcludeButton trackId={t.id} variant="compact" skipAfter={false} />
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
