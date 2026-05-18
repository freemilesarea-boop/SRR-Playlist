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
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
import { gradientStyle } from '@/lib/cover';
import { trackStream } from '@/lib/analytics';
import {
  pushRecentlyPlayed,
  saveContinueListening,
  clearContinueListening,
} from '@/lib/libraryApi';
import { recommendSimilarTracks } from '@/lib/recommendationApi';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import ShareButton from '@/components/ShareButton';
import { trackShareUrl } from '@/lib/shareApi';
import { toast } from '@/store/toastStore';

/** 재생 불가 트랙 연속 스킵 상한 — 이 횟수 초과 시 강제 정지하고 안내. */
const MAX_SKIP_ATTEMPTS = 5;

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

/**
 * 0077 — toast dedup: 같은 트랙+에러 코드 조합은 30초 내 1회만 표시.
 * 키 형식: `${trackId}:${errCode}`. 메인페이지 진입 시 preload 에러 폭주 방지.
 */
const recentErrorToasts = new Map<string, number>();
const TOAST_DEDUP_MS = 30_000;

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

  const skipChainRef = useRef(0);
  useEffect(() => {
    if (playable) skipChainRef.current = 0;
  }, [current?.id, playable]);

  useEffect(() => {
    setErrored(false);
  }, [current?.id]);

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
  }, [playing, toggle, prev, next, setCurrentTime]);

  // playbackState 동기화 — 잠금화면 play/pause 아이콘
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none';
    } catch { /* noop */ }
  }, [playing, current?.id]);

  /* ---------- analytics: start / 15s / 30s / complete ---------- */
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const startedTrackIdRef = useRef<string | null>(null);
  const milestoneSentRef = useRef(false);
  const recentSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!current || !playable || !playing) return;
    if (startedTrackIdRef.current === current.id) return;
    startedTrackIdRef.current = current.id;
    milestoneSentRef.current = false;
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
  }, [current?.id, playable, playing, userId, playlist?.id, current]);

  useEffect(() => {
    if (!current || milestoneSentRef.current) return;
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
  }, [currentTime, current, userId, playlist?.id]);

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

    // 세션 내 이미 SRC_NOT_SUPPORTED / DECODE 로 실패한 트랙 → 즉시 스킵
    if (playing && sessionFailedTrackIds.has(current.id)) {
      skipChainRef.current += 1;
      const cap = Math.min(MAX_SKIP_ATTEMPTS, queue.length);
      if (skipChainRef.current >= cap) {
        pause();
        toast.error('재생 가능한 음원이 없어요. 관리자에서 재업로드가 필요합니다.');
        skipChainRef.current = 0;
        return;
      }
      const t = window.setTimeout(() => next(), 300);
      return () => window.clearTimeout(t);
    }

    if (!playable) {
      if (playing) {
        skipChainRef.current += 1;
        // 무한 스킵 방지: queue.length 와 MAX_SKIP_ATTEMPTS 중 작은 값에서 정지
        const cap = Math.min(MAX_SKIP_ATTEMPTS, queue.length);
        if (skipChainRef.current >= cap) {
          pause();
          toast.error('재생 가능한 음원이 없어요. 관리자 페이지에서 음원을 업로드해주세요.');
          skipChainRef.current = 0;
          return;
        }
        // 첫 번째 스킵만 toast — 폭주 방지
        if (skipChainRef.current === 1) {
          toast.info('재생 불가 트랙은 건너뛸게요');
        }
        const t = window.setTimeout(() => next(), 600);
        return () => window.clearTimeout(t);
      }
      return;
    }

    const trackChanged = lastTrackIdRef.current !== current.id;
    if (trackChanged) {
      if (import.meta.env.DEV) {
        // 진단용 공식 포맷 ([audio] = 재생 직전 상태 스냅샷)
        // eslint-disable-next-line no-console
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
      audio.src = current.audio_url;
      // 3) load() 는 playing=true 일 때만 호출 — preload="metadata" 와 결합해
      //    사용자 의도 없는 자동 fetch / preload 에러 toast 폭주 차단 (0077-hotfix)
      if (playing) {
        try { audio.load(); } catch { /* noop */ }
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
        if (import.meta.env.DEV) console.debug('[Player] play() resume', { id: current.id });
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err: DOMException) => {
            if (err?.name === 'AbortError') return; // src 변경 등 — 무시
            if (err?.name === 'NotAllowedError') {
              pause();
              toast.info('재생 버튼을 한 번 눌러주세요. (모바일은 자동재생이 제한돼요)');
              return;
            }
            if (import.meta.env.DEV) console.debug('[Player] play() rejected', err?.name, err?.message);
            // 상태 꼬임 방지: pause 만 호출, auto-next 는 onError 에 위임
            pause();
            toast.error('재생 중 오류가 발생했어요.');
          });
        }
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

  /* ---------- MediaSession ---------- */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist ?? '',
        album: playlist?.title ?? '',
        artwork: current.cover_url
          ? [{ src: current.cover_url, sizes: '512x512', type: 'image/png' }]
          : undefined,
      });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', next);
    } catch {
      /* noop */
    }
  }, [current, playlist, play, pause, prev, next]);

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
    if (target !== activeRef()) return; // 다른 audio 이벤트 무시
    setCurrentTime(target.currentTime);
  }

  function onLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const target = e.currentTarget;
    if (target !== activeRef()) return;
    const d = target.duration;
    if (Number.isFinite(d)) setDuration(d);
    // 세션 복원 직후 한 번만 seek (queue/index 유지된 새로고침 케이스)
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

  function onCanPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== activeRef()) return;
    if (!playing) return;
    const audio = e.currentTarget;
    if (!audio.paused) return;
    if (import.meta.env.DEV) console.debug('[Player] canplay → auto-play', { id: current?.id });
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: DOMException) => {
        if (err?.name === 'AbortError') return;
        if (err?.name === 'NotAllowedError') {
          pause();
          toast.info('재생 버튼을 한 번 눌러주세요. (모바일은 자동재생이 제한돼요)');
          return;
        }
        if (import.meta.env.DEV) console.debug('[Player] onCanPlay play() rejected', err?.name, err?.message);
      });
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
      void clearContinueListening(current.id, userId);
    }
    // 자동 이어추천이 큐를 늘렸으면 next() 가 자연스럽게 동작 (마지막 → 새 곡)
    void maybeAutoplayRecommendations().then((added) => {
      if (!added) next();
    });
  }

  function onError(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== activeRef()) return;
    if (!playable) return;
    const target = e.currentTarget;
    const err = target.error;
    const codeName = err ? (MEDIA_ERROR_CODES[err.code] ?? `code=${err.code}`) : 'UNKNOWN';
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[audio] error', {
        id: current?.id, title: current?.title, audio_url: current?.audio_url,
        code: err?.code, codeName, message: err?.message,
        networkState: target.networkState, readyState: target.readyState, src: target.src,
        playing,
      });
    }

    // 디코딩/포맷 문제로 확정된 트랙은 세션 동안 재시도 금지
    const isPermanent = err?.code === 3 /* DECODE */ || err?.code === 4 /* SRC_NOT_SUPPORTED */;
    if (current && isPermanent) {
      sessionFailedTrackIds.add(current.id);
    }

    // 0077-hotfix — 사용자가 재생을 시도하지 않은 상태 (preload 에러) 면 silent skip.
    // 메인페이지 진입 시 preload 만으로 onError 가 발화되어 toast 폭주하는 문제를 차단.
    if (!playing) {
      setErrored(true);
      // 자동 next 도 호출하지 않음 — 사용자 의도 없이 큐를 진행시키지 않음.
      return;
    }

    setErrored(true);
    pause();

    // 0077-hotfix — 같은 트랙+코드 30초 dedup
    const dedupKey = `${current?.id ?? 'unknown'}:${err?.code ?? 0}`;
    const now = Date.now();
    const last = recentErrorToasts.get(dedupKey);
    if (!last || now - last >= TOAST_DEDUP_MS) {
      recentErrorToasts.set(dedupKey, now);
      // 0077 — route-aware 메시지: admin/artist 화면이면 운영자용 상세 / 그 외 public 은 짧게
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const isOperatorContext = /^\/(admin|artist)/.test(path);
      if (isPermanent) {
        if (isOperatorContext) {
          toast.error(
            `이 음원은 브라우저에서 재생할 수 없는 파일 형식이거나 업로드 중 문제가 발생했습니다. 재업로드 후 재검수가 필요합니다. [${codeName}]`,
          );
        } else {
          toast.error('이 음원을 재생할 수 없습니다. 다른 곡을 선택해주세요.');
        }
      } else {
        toast.error(`재생 실패 (${codeName})`);
      }
    }

    // 자동 next — 단 다음 트랙도 sessionFailedTrackIds 에 있으면 추가 스킵 (Player 메인 effect 가 처리)
    window.setTimeout(() => next(), 600);
  }

  function cycleRepeat() {
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');
  }

  function handlePlayBtn() {
    if (!playable) {
      toast.info('이 트랙은 음원이 등록되지 않았어요.');
      next();
      return;
    }
    toggle();
  }

  function handlePrev() {
    cancelCrossfade();
    prev();
  }
  function handleNext() {
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
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />

      {/* Mini player */}
      <div className="fixed inset-x-0 bottom-[5.25rem] z-20 mx-auto max-w-3xl px-3 sm:bottom-[5.5rem] sm:px-4 lg:left-60 lg:right-0 lg:bottom-3 lg:mx-auto">
        <button
          onClick={() => setExpanded(true)}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl glass-strong p-2.5 transition duration-smooth ease-emphasized hover:-translate-y-0.5"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={gradientStyle(playlist?.category || current.title)}
          />
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
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15 transition hover:scale-105 hover:bg-accent-soft disabled:opacity-50"
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
        <div className="fixed inset-0 z-40 flex flex-col bg-bg pt-safe pb-safe animate-slide-up">
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
