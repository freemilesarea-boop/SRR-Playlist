// Phase BRAND-PLAYER-UX-5 — 전체화면 하단 Control Bar (최종 레이아웃) + Queue Viewer.
// 진행바/시간 · 볼륨/Mute · Shuffle/Repeat 상태 · Queue 검색/섹션 · Auto-hide 보강.
// 기존 Player command(play/pause/next/prev/jumpTo/seekTo/setVolume/toggleMute)만 호출.
//   별도 Audio/Engine/Queue 생성 없음 — Scheduler/Crossfade/Analytics/Heartbeat 불변.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, ListMusic, Minimize2, Music, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import BrandQueueDrawer from '@/components/brand/BrandQueueDrawer';
import BrandPlaybackProgress from '@/components/brand/BrandPlaybackProgress';
import BrandVolumeControl from '@/components/brand/BrandVolumeControl';

const AUTO_HIDE_MS = 3000;
const NAV_THROTTLE_MS = 400;

interface Props {
  active: boolean;
  onExit: () => void;
}

export default function BrandFullscreenControls({ active, onExit }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playing = usePlayerStore((s) => s.playing);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const jumpTo = usePlayerStore((s) => s.jumpTo);

  const current = queue[index] ?? null;
  const hasQueue = queue.length > 0;

  const [visible, setVisible] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [held, setHeld] = useState(false);          // progress/volume drag 중
  const [searchFocused, setSearchFocused] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const holdCountRef = useRef(0);
  const searchFocusRef = useRef(false);
  const navLockRef = useRef(0);
  const queueBtnRef = useRef<HTMLButtonElement | null>(null);

  const suppressHide = () =>
    !playing || queueOpen || hoveringRef.current || holdCountRef.current > 0 || searchFocusRef.current;
  const forceVisible = !playing || queueOpen || hoveringRef.current || held || searchFocused;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (suppressHide()) return;
    hideTimerRef.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearHideTimer, playing, queueOpen]);

  const reveal = useCallback(() => { setVisible(true); scheduleHide(); }, [scheduleHide]);

  const setHold = useCallback((h: boolean) => {
    holdCountRef.current = Math.max(0, holdCountRef.current + (h ? 1 : -1));
    setHeld(holdCountRef.current > 0);
    if (h) { clearHideTimer(); setVisible(true); } else { scheduleHide(); }
  }, [clearHideTimer, scheduleHide]);

  const onSearchFocusChange = useCallback((f: boolean) => {
    searchFocusRef.current = f;
    setSearchFocused(f);
    if (f) { clearHideTimer(); setVisible(true); } else { scheduleHide(); }
  }, [clearHideTimer, scheduleHide]);

  useEffect(() => {
    if (!active) { clearHideTimer(); setQueueOpen(false); setVisible(true); return; }
    reveal();
    return clearHideTimer;
  }, [active, reveal, clearHideTimer]);

  useEffect(() => { if (active) reveal(); }, [active, index, playing, queueOpen, reveal]);

  useEffect(() => {
    if (!active) return;
    const onMove = () => reveal();
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [active, reveal]);

  const navGuard = useCallback((fn: () => void) => {
    const now = Date.now();
    if (now - navLockRef.current < NAV_THROTTLE_MS) return;
    navLockRef.current = now;
    fn();
  }, []);
  const doNext = useCallback(() => navGuard(next), [navGuard, next]);
  const doPrev = useCallback(() => navGuard(prev), [navGuard, prev]);
  const togglePlay = useCallback(() => { if (playing) pause(); else play(); }, [playing, play, pause]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const isFormish = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
      if (isFormish) return; // Search/Volume 입력 중 단축키 억제 (F 는 page 에서 처리)
      switch (e.key) {
        case ' ':
          if (tag === 'BUTTON') return;
          e.preventDefault(); togglePlay(); reveal(); break;
        case 'ArrowRight': e.preventDefault(); doNext(); reveal(); break;
        case 'ArrowLeft': e.preventDefault(); doPrev(); reveal(); break;
        case 'q': case 'Q': e.preventDefault(); setQueueOpen((v) => !v); reveal(); break;
        case 'Escape': if (queueOpen) setQueueOpen(false); else onExit(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, togglePlay, doNext, doPrev, queueOpen, onExit, reveal]);

  if (!active) return null;
  const shown = visible || forceVisible;

  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;
  const repeatActive = repeat !== 'off';

  return (
    <div className="pointer-events-none absolute inset-0 z-[120]">
      {!queueOpen && (
        <button
          type="button"
          aria-label={shown ? '컨트롤 숨기기' : '컨트롤 표시'}
          onClick={() => { if (shown && playing) { clearHideTimer(); setVisible(false); } else { reveal(); } }}
          className="pointer-events-auto absolute inset-0 h-full w-full cursor-default bg-transparent"
          tabIndex={-1}
        />
      )}

      <div
        aria-hidden
        onMouseEnter={reveal}
        onMouseMove={reveal}
        className="pointer-events-auto absolute inset-x-0 bottom-0 h-[20%]"
        style={{ pointerEvents: shown ? 'none' : 'auto' }}
      />

      <div
        onMouseEnter={() => { hoveringRef.current = true; clearHideTimer(); setVisible(true); }}
        onMouseLeave={() => { hoveringRef.current = false; scheduleHide(); }}
        onFocus={() => { clearHideTimer(); setVisible(true); }}
        onBlur={() => scheduleHide()}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 z-[121] flex flex-col gap-2 border-t border-white/10 bg-gradient-to-t from-black/95 via-black/80 to-black/30 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:px-6 ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}
      >
        {/* 1행: 곡 정보(좌) + 볼륨/큐/종료(우) */}
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-white/10">
            {current?.cover_url ? (
              <img src={current.cover_url} alt="" className="h-full w-full object-cover" draggable={false}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
            ) : (
              <span className="flex h-full w-full items-center justify-center"><Music size={18} className="text-white/40" /></span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-white">{current?.title ?? '재생 대기'}</span>
            <span className="block truncate text-xs text-white/55">{current?.artist ?? '—'}</span>
          </span>
          <div className="hidden sm:block"><BrandVolumeControl onHold={setHold} onActivity={reveal} /></div>
          <div className="sm:hidden"><BrandVolumeControl onHold={setHold} onActivity={reveal} compact /></div>
          <button ref={queueBtnRef} onClick={() => setQueueOpen((v) => !v)} aria-label="재생목록 열기" aria-expanded={queueOpen} aria-haspopup="dialog"
            className={`shrink-0 rounded-full p-2.5 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent ${queueOpen ? 'bg-accent/25 text-accent' : 'bg-white/10 text-white'}`}>
            <ListMusic size={18} />
          </button>
          <button onClick={onExit} aria-label="전체화면 종료 (F/ESC)"
            className="shrink-0 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent">
            <Minimize2 size={18} />
          </button>
        </div>

        {/* 2행: 진행바 + 시간 */}
        <BrandPlaybackProgress onHold={setHold} onActivity={reveal} />

        {/* 3행: Shuffle 상태 · 이전/재생/다음 · Repeat 상태 (상태 표시 read-only) */}
        <div className="flex items-center justify-center gap-3">
          <span title={shuffle ? '셔플 켜짐' : '셔플 꺼짐'} aria-label={shuffle ? '셔플 켜짐' : '셔플 꺼짐'}
            className={`rounded-full p-2 ${shuffle ? 'text-accent' : 'text-white/35'}`}>
            <Shuffle size={17} />
          </span>
          <button onClick={doPrev} disabled={!hasQueue} aria-label="이전 곡"
            className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button onClick={togglePlay} disabled={!hasQueue} aria-label={playing ? '일시정지' : '재생'}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40">
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={doNext} disabled={!hasQueue} aria-label="다음 곡"
            className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <span title={repeat === 'one' ? '한 곡 반복' : repeat === 'all' ? '전체 반복' : '반복 꺼짐'}
            aria-label={repeat === 'one' ? '한 곡 반복' : repeat === 'all' ? '전체 반복' : '반복 꺼짐'}
            className={`rounded-full p-2 ${repeatActive ? 'text-accent' : 'text-white/35'}`}>
            <RepeatIcon size={17} />
          </span>
        </div>
      </div>

      <BrandQueueDrawer
        open={queueOpen}
        queue={queue}
        index={index}
        shuffle={shuffle}
        shuffleOrder={shuffleOrder}
        onSelect={(originalIndex) => { jumpTo(originalIndex); }}
        onClose={() => setQueueOpen(false)}
        returnFocusRef={queueBtnRef}
        onSearchFocusChange={onSearchFocusChange}
      />
    </div>
  );
}
