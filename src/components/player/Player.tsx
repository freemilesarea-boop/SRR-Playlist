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
    play,
    pause,
    toggle,
    next,
    prev,
    jumpTo,
    setShuffle,
    setRepeat,
    setVolume,
    setCurrentTime,
    setDuration,
  } = usePlayerStore();

  const { crossfadeEnabled, crossfadeSeconds, autoplayRecommendations } = usePlaybackSettingsStore();

  const current = queue[index];
  const playable = isPlayableUrl(current?.audio_url);
  const [expanded, setExpanded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [errored, setErrored] = useState(false);
  const [crossfading, setCrossfading] = useState(false);

  const skipChainRef = useRef(0);
  useEffect(() => {
    if (playable) skipChainRef.current = 0;
  }, [current?.id, playable]);

  useEffect(() => {
    setErrored(false);
  }, [current?.id]);

  /* ---------- analytics: start / 15s / 30s / complete ---------- */
  const userId = useAuthStore((s) => s.user?.id ?? null);
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

  /* ---------- 자동 스킵 / play 동기화 (active audio 기준) ---------- */
  useEffect(() => {
    const audio = activeRef();
    if (!audio || !current) return;

    if (!playable) {
      if (playing) {
        skipChainRef.current += 1;
        if (skipChainRef.current >= queue.length) {
          pause();
          toast.error('재생 가능한 음원이 없어요. 관리자 페이지에서 음원을 업로드해주세요.');
          skipChainRef.current = 0;
          return;
        }
        toast.info(`샘플 음원 없음 — 다음 곡으로 넘어갑니다`);
        const t = window.setTimeout(() => next(), 600);
        return () => window.clearTimeout(t);
      }
      return;
    }

    // src 가 안 맞으면 동기화 (트랙 변경 직후)
    if (audio.src !== current.audio_url) {
      audio.src = current.audio_url;
      audio.currentTime = 0;
      audio.volume = volume;
    }

    if (playing) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: DOMException) => {
          if (err?.name === 'NotAllowedError') {
            pause();
            toast.info('재생 버튼을 한 번 눌러주세요. (모바일은 자동재생이 제한돼요)');
          } else {
            setErrored(true);
            pause();
            toast.error('이 곡을 재생할 수 없어요. 다음 곡으로 넘어갈게요.');
            window.setTimeout(() => next(), 800);
          }
        });
      }
    } else {
      audio.pause();
      // 크로스페이드 중에 pause 면 둘 다 정지
      const other = nextRef();
      if (other && !other.paused) other.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current?.id, playable, queue.length, activeIdx]);

  /* ---------- 트랙 변경 시 active audio 리셋 + crossfade 상태 청소 ---------- */
  const lastTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    if (lastTrackIdRef.current === current.id) return;
    lastTrackIdRef.current = current.id;

    cancelCrossfade();
    setCurrentTime(0);
    setDuration(0);

    const audio = activeRef();
    if (!audio) return;
    if (playable) {
      audio.src = current.audio_url;
      audio.currentTime = 0;
      audio.volume = volume;
    }
    // 다른 audio 는 정지
    const other = nextRef();
    if (other) {
      other.pause();
      other.removeAttribute('src');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

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
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (crossfading) return;
    if (!current || !Number.isFinite(duration) || duration <= 0) return;
    if (repeat === 'one') return;
    if (triggeredAtTrackIdRef.current === current.id) return;

    const nextIdx = computeNextIndex(queue.length, index, shuffle, shuffleOrder, repeat);
    if (nextIdx === null) return;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || !isPlayableUrl(nextTrack.audio_url)) return;

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
    current,
    duration,
    repeat,
    queue,
    index,
    shuffle,
    shuffleOrder,
    volume,
    activeIdx,
    jumpTo,
  ]);

  // duration - crossfadeSeconds 도달 감지
  useEffect(() => {
    if (!crossfadeEnabled || crossfadeSeconds <= 0) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration < crossfadeSeconds + 0.5) return; // 너무 짧은 곡은 crossfade X
    const remaining = duration - currentTime;
    if (remaining <= crossfadeSeconds && remaining > 0.2 && !crossfading) {
      startCrossfade();
    }
  }, [currentTime, duration, crossfadeEnabled, crossfadeSeconds, crossfading, startCrossfade]);

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
    toast.success('비슷한 분위기의 곡을 이어서 추천했어요');
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
    setErrored(true);
    pause();
    toast.error('재생 중 오류가 발생했어요. 다음 곡으로 넘어갑니다.');
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
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />
      <audio
        ref={audioBRef}
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onError={onError}
        playsInline
      />

      {/* Mini player */}
      <div className="fixed inset-x-0 bottom-[5.25rem] z-20 mx-auto max-w-3xl px-3 sm:bottom-[5.5rem] sm:px-4">
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
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 disabled:opacity-50"
            aria-label={playing ? '일시정지' : '재생'}
            disabled={errored}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
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
        <div className="mx-2 mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{
              width: duration ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%',
              boxShadow: '0 0 12px rgb(var(--color-accent) / 0.5)',
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
                  title={`스르륵 플리 — ${current.title}`}
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
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-2xl transition hover:scale-105 disabled:opacity-50"
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
              <button onClick={() => setVolume(volume > 0 ? 0 : 1)} aria-label="음소거">
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
