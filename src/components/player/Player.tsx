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
  AlertCircle,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
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
    setShuffle,
    setRepeat,
    setVolume,
    setCurrentTime,
    setDuration,
  } = usePlayerStore();

  const current = queue[index];
  const playable = isPlayableUrl(current?.audio_url);
  const [expanded, setExpanded] = useState(false);
  const [errored, setErrored] = useState(false);

  // 모두 재생 불가일 때 무한 next() 루프 방지
  const skipChainRef = useRef(0);
  useEffect(() => {
    if (playable) skipChainRef.current = 0;
  }, [current?.id, playable]);

  // 새 트랙으로 바뀌면 에러 상태 리셋
  useEffect(() => {
    setErrored(false);
  }, [current?.id]);

  // play/pause 동기화 — 재생 불가 트랙은 자동으로 다음 곡으로
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;

    if (!playable) {
      // 재생 불가 트랙: 한 번만 안내 후 자동 스킵 시도
      if (playing) {
        skipChainRef.current += 1;
        if (skipChainRef.current >= queue.length) {
          // 큐 전체가 재생 불가 — 멈추고 안내
          pause();
          toast.error('재생 가능한 음원이 없어요. 관리자 페이지에서 음원을 업로드해주세요.');
          skipChainRef.current = 0;
          return;
        }
        toast.info(`샘플 음원이 없어 다음 곡으로 넘어갑니다: ${current.title}`);
        const t = window.setTimeout(() => next(), 600);
        return () => window.clearTimeout(t);
      }
      return;
    }

    if (playing) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: DOMException) => {
          // NotAllowedError = 자동재생 차단 (사용자 제스처 필요)
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

  // Media Session API (백그라운드 컨트롤) — 일부 브라우저는 미지원
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
    next();
  }
  function onError() {
    if (!playable) return; // 이미 처리
    setErrored(true);
    pause();
    toast.error('재생 중 오류가 발생했어요. 다음 곡으로 넘어갑니다.');
    window.setTimeout(() => next(), 600);
  }
  function cycleRepeat() {
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');
  }

  return (
    <>
      {/* 재생 가능한 URL 일 때만 audio element 마운트 */}
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
            <p className="flex items-center gap-1 truncate text-sm font-medium">
              {!playable && <AlertCircle size={11} className="shrink-0 text-yellow-300" />}
              {current.title}
            </p>
            <p className="truncate text-xs text-ink-mute">
              {!playable ? '샘플 음원 없음' : (current.artist ?? '—')}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!playable) {
                toast.info('이 트랙은 음원이 등록되지 않았어요.');
                next();
                return;
              }
              toggle();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black disabled:opacity-50"
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
              {!playable && (
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-200">
                  <AlertCircle size={11} /> 샘플 음원 없음 — 관리자 페이지에서 업로드하세요
                </p>
              )}
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
                disabled={!playable || !duration}
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
                onClick={() => {
                  if (!playable) {
                    toast.info('이 트랙은 음원이 등록되지 않았어요.');
                    next();
                    return;
                  }
                  toggle();
                }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black disabled:opacity-50"
                aria-label={playing ? '일시정지' : '재생'}
                disabled={errored}
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
