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
  Music,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/format';

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
    setShuffle,
    setRepeat,
    setVolume,
    setCurrentTime,
    setDuration,
  } = usePlayerStore();

  const current = queue[index];
  const [expanded, setExpanded] = useState(false);

  // Sync play/pause to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // 모바일 자동재생 정책 등 - 일시정지로 폴백
          pause();
        });
      }
    } else {
      audio.pause();
    }
  }, [playing, current?.id, pause]);

  // Reset time when track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
  }, [current?.id, setCurrentTime, setDuration]);

  // Volume sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Media Session API (백그라운드 컨트롤)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist ?? '',
      album: playlist?.title ?? '',
      artwork: current.cover_url
        ? [
            { src: current.cover_url, sizes: '512x512', type: 'image/png' },
          ]
        : undefined,
    });
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }, [current, playlist, play, pause, prev, next]);

  if (!current) return null;

  function onTimeUpdate() {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  }
  function onLoadedMetadata() {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  }
  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = v;
    setCurrentTime(v);
  }
  function onEnded() {
    next();
  }
  function cycleRepeat() {
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={current.audio_url}
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        playsInline
      />

      {/* Mini player */}
      <div className="fixed inset-x-0 bottom-14 z-20 mx-auto max-w-md px-2 pb-1 sm:bottom-16">
        <button
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 rounded-xl bg-bg-card/95 p-2.5 shadow-2xl backdrop-blur-xl ring-1 ring-white/5"
        >
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-hover">
            {current.cover_url ? (
              <img src={current.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-dim">
                <Music size={14} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium">{current.title}</p>
            <p className="truncate text-xs text-ink-mute">{current.artist ?? '—'}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black"
            aria-label={playing ? '일시정지' : '재생'}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="hidden h-9 w-9 items-center justify-center text-ink-mute hover:text-ink sm:flex"
            aria-label="다음 곡"
          >
            <SkipForward size={18} />
          </button>
          <ChevronUp size={18} className="mr-1 text-ink-dim sm:hidden" />
        </button>
        {/* Tiny progress under mini player */}
        <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
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
          <div className="flex items-center justify-between px-5 py-3">
            <button
              onClick={() => setExpanded(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
              aria-label="닫기"
            >
              <ChevronDown size={20} />
            </button>
            <div className="text-center text-xs text-ink-mute">
              {playlist?.title ?? '재생 중'}
            </div>
            <div className="w-9" />
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <div className="aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-bg-card shadow-2xl">
              {current.cover_url ? (
                <img src={current.cover_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-dim">
                  <Music size={48} />
                </div>
              )}
            </div>

            <div className="w-full max-w-xs text-center">
              <h2 className="text-xl font-bold">{current.title}</h2>
              <p className="mt-1 text-sm text-ink-mute">{current.artist ?? '—'}</p>
            </div>

            <div className="w-full max-w-xs space-y-2">
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={onSeek}
                step={0.1}
                aria-label="재생 위치"
              />
              <div className="flex justify-between text-[11px] text-ink-mute">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <button
                onClick={() => setShuffle(!shuffle)}
                className={`p-2 ${shuffle ? 'text-accent' : 'text-ink-mute'}`}
                aria-label="셔플"
              >
                <Shuffle size={20} />
              </button>
              <button onClick={prev} className="p-2 text-ink" aria-label="이전 곡">
                <SkipBack size={26} fill="currentColor" />
              </button>
              <button
                onClick={toggle}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black"
                aria-label={playing ? '일시정지' : '재생'}
              >
                {playing ? (
                  <Pause size={22} fill="currentColor" />
                ) : (
                  <Play size={22} fill="currentColor" />
                )}
              </button>
              <button onClick={next} className="p-2 text-ink" aria-label="다음 곡">
                <SkipForward size={26} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeat}
                className={`p-2 ${repeat !== 'off' ? 'text-accent' : 'text-ink-mute'}`}
                aria-label="반복"
              >
                {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>

            <div className="flex w-full max-w-xs items-center gap-2 text-ink-mute">
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
        </div>
      )}
    </>
  );
}
