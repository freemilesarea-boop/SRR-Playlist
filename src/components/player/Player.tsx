import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
import { gradientStyle } from '@/lib/cover';
import { trackStream } from '@/lib/analytics';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';

export default function Player() {
  const audioRef = useRef<HTMLAudioElement>(null);
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

  const current = queue[index];
  const playable = isPlayableUrl(current?.audio_url);
  const [expanded, setExpanded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [errored, setErrored] = useState(false);

  const skipChainRef = useRef(0);
  useEffect(() => {
    if (playable) skipChainRef.current = 0;
  }, [current?.id, playable]);

  useEffect(() => {
    setErrored(false);
  }, [current?.id]);

  // ----- analytics: start / 30s milestone / complete -----
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const startedTrackIdRef = useRef<string | null>(null);
  const milestoneSentRef = useRef(false);

  // 트랙이 바뀌고 재생 시도가 시작되면 'start' 1회
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

  // 30초 도달 시 milestone_30s
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
    const audio = audioRef.current;
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
    }
  }, [playing, current?.id, playable, queue.length, next, pause, current]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
  }, [current?.id, setCurrentTime, setDuration]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

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
      /* 무시 */
    }
  }, [current, playlist, play, pause, prev, next]);

  if (!current) return null;

  function onTimeUpdate() {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  }
  function onLoadedMetadata() {
    if (!audioRef.current) return;
    const d = audioRef.current.duration;
    if (Number.isFinite(d)) setDuration(d);
  }
  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
      audioRef.current.currentTime = v;
    }
    setCurrentTime(v);
  }
  function onEnded() {
    if (current) {
      void trackStream({
        user_id: userId,
        track_id: current.id,
        playlist_id: playlist?.id ?? null,
        listened_seconds: Math.floor(duration || currentTime || 0),
        completed: true,
        event_type: 'complete',
      });
    }
    next();
  }
  function onError() {
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

  return (
    <>
      {playable && (
        <audio
          ref={audioRef}
          src={current.audio_url}
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          onError={onError}
          playsInline
        />
      )}

      {/* Mini player */}
      <div className="fixed inset-x-0 bottom-14 z-20 mx-auto max-w-3xl px-2 pb-1 sm:bottom-16">
        <button
          onClick={() => setExpanded(true)}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-bg-card/90 p-2.5 shadow-2xl ring-1 ring-line/15 backdrop-blur-2xl transition hover:bg-bg-card"
        >
          {/* 미세한 그라데이션 배경 */}
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
              next();
            }}
            className="relative hidden h-10 w-10 items-center justify-center text-ink-mute hover:text-ink sm:flex"
            aria-label="다음 곡"
          >
            <SkipForward size={18} />
          </button>
          <ChevronUp size={18} className="relative mr-1 text-ink-dim sm:hidden" />
        </button>
        {/* 진행 바 */}
        <div className="mx-2 mt-1 h-0.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{
              width: duration ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%',
            }}
          />
        </div>
      </div>

      {/* Expanded player overlay */}
      {expanded && (
        <div className="fixed inset-0 z-40 flex flex-col bg-bg pt-safe pb-safe animate-slide-up">
          {/* 백그라운드 그라데이션 */}
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
            <div className="text-center text-[11px] uppercase tracking-wider text-white/60">
              {playlist?.title ?? '재생 중'}
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
            {/* 큰 커버 */}
            <div className="aspect-square w-full max-w-xs overflow-hidden rounded-3xl shadow-2xl ring-1 ring-line/15">
              <AutoCover
                title={current.title}
                category={playlist?.category}
                imageUrl={current.cover_url}
                size="xl"
              />
            </div>

            <div className="w-full max-w-xs text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                {current.title}
              </h2>
              <p className="mt-1 text-sm text-white/70">{current.artist ?? '—'}</p>
              {!playable && (
                <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] text-yellow-200 ring-1 ring-yellow-300/30">
                  <AlertCircle size={11} /> 음원 준비중 — 관리자 페이지에서 업로드
                </p>
              )}
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
              <button onClick={prev} className="p-2 text-white" aria-label="이전 곡">
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
              <button onClick={next} className="p-2 text-white" aria-label="다음 곡">
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

          {/* Queue drawer */}
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
