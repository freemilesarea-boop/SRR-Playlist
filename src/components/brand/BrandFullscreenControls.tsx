// Phase BRAND-PLAYER-UX-4 — 전체화면 하단 Playback Control Bar + Queue Viewer.
// 기존 Player 의 공식 command(play/pause/next/prev/jumpTo)만 호출한다.
//   · 별도 Audio Element / Playback Engine / Queue 를 만들지 않는다.
//   · 시각 컨트롤일 뿐 — Scheduler/Crossfade/Analytics/Heartbeat 경로 불변.
// 표시/자동숨김: 마우스 이동·하단 진입·터치 탭·포커스·일시정지·큐열림 시 표시, 재생 중 무조작 3초 후 숨김.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, ListMusic, Minimize2, Music } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import BrandQueueDrawer from '@/components/brand/BrandQueueDrawer';

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
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const jumpTo = usePlayerStore((s) => s.jumpTo);

  const current = queue[index] ?? null;
  const hasQueue = queue.length > 0;

  const [visible, setVisible] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);
  const navLockRef = useRef(0);
  const queueBtnRef = useRef<HTMLButtonElement | null>(null);

  // 자동숨김을 억제해야 하는 상태(일시정지/큐열림/hover)면 항상 표시.
  const forceVisible = !playing || queueOpen || hoveringRef.current;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!playing || queueOpen || hoveringRef.current) return; // 억제 조건이면 숨기지 않음
    hideTimerRef.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, [clearHideTimer, playing, queueOpen]);

  const reveal = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // active 아닐 때 정리. active 진입 시 표시 + 타이머 시작.
  useEffect(() => {
    if (!active) { clearHideTimer(); setQueueOpen(false); setVisible(true); return; }
    reveal();
    return clearHideTimer;
  }, [active, reveal, clearHideTimer]);

  // 곡 변경/일시정지/큐열림 → 표시 갱신.
  useEffect(() => { if (active) reveal(); }, [active, index, playing, queueOpen, reveal]);

  // 전역 마우스 이동 → 표시(감지 영역 = 화면 어디든 움직임). 하단 zone 은 아래 별도 catcher.
  useEffect(() => {
    if (!active) return;
    const onMove = () => reveal();
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [active, reveal]);

  // 빠른 연속 이동 방어 + 공식 command.
  const navGuard = useCallback((fn: () => void) => {
    const now = Date.now();
    if (now - navLockRef.current < NAV_THROTTLE_MS) return;
    navLockRef.current = now;
    fn();
  }, []);
  const doNext = useCallback(() => navGuard(next), [navGuard, next]);
  const doPrev = useCallback(() => navGuard(prev), [navGuard, prev]);
  const togglePlay = useCallback(() => { if (playing) pause(); else play(); }, [playing, play, pause]);

  // 키보드 (전체화면 한정). Input/Button focus 시 Space 중복 방지.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const isFormish = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
      if (isFormish) return;
      switch (e.key) {
        case ' ': // Space: 재생/일시정지 (button focus 시 중복 방지)
          if (tag === 'BUTTON') return;
          e.preventDefault(); togglePlay(); reveal(); break;
        case 'ArrowRight': e.preventDefault(); doNext(); reveal(); break;
        case 'ArrowLeft': e.preventDefault(); doPrev(); reveal(); break;
        case 'q': case 'Q': e.preventDefault(); setQueueOpen((v) => !v); reveal(); break;
        case 'Escape':
          if (queueOpen) { setQueueOpen(false); } else { onExit(); }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, togglePlay, doNext, doPrev, queueOpen, onExit, reveal]);

  if (!active) return null;

  const shown = visible || forceVisible;

  return (
    <div className="pointer-events-none absolute inset-0 z-[120]">
      {/* 터치/클릭 토글 catcher — 컨트롤이 숨겨졌을 땐 탭으로 표시, 보일 땐 탭으로 숨김.
          큐 열림 시엔 drawer backdrop 이 처리하므로 비활성. */}
      {!queueOpen && (
        <button
          type="button"
          aria-label={shown ? '컨트롤 숨기기' : '컨트롤 표시'}
          onClick={() => { if (shown && playing) { clearHideTimer(); setVisible(false); } else { reveal(); } }}
          className="pointer-events-auto absolute inset-0 h-full w-full cursor-default bg-transparent"
          tabIndex={-1}
        />
      )}

      {/* 하단 감지 영역(화면 하단 ~20%) — 진입/이동 시 표시 유지 */}
      <div
        aria-hidden
        onMouseEnter={reveal}
        onMouseMove={reveal}
        className="pointer-events-auto absolute inset-x-0 bottom-0 h-[20%]"
        style={{ pointerEvents: shown ? 'none' : 'auto' }}
      />

      {/* Control Bar */}
      <div
        onMouseEnter={() => { hoveringRef.current = true; clearHideTimer(); setVisible(true); }}
        onMouseLeave={() => { hoveringRef.current = false; scheduleHide(); }}
        onFocus={() => { clearHideTimer(); setVisible(true); }}
        onBlur={() => scheduleHide()}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 z-[121] flex items-center gap-4 border-t border-white/10 bg-gradient-to-t from-black/90 to-black/40 px-5 py-4 backdrop-blur transition-[opacity,transform] duration-300 motion-reduce:transition-none [padding-bottom:env(safe-area-inset-bottom)] ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}
      >
        {/* 현재 곡 정보 */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/10">
            {current?.cover_url ? (
              <img src={current.cover_url} alt="" className="h-full w-full object-cover" draggable={false}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
            ) : (
              <span className="flex h-full w-full items-center justify-center"><Music size={18} className="text-white/40" /></span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-white">{current?.title ?? '재생 대기'}</span>
            <span className="block truncate text-xs text-white/55">{current?.artist ?? '—'}</span>
          </span>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-2">
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
        </div>

        {/* Queue + Exit */}
        <div className="flex items-center gap-2">
          <button ref={queueBtnRef} onClick={() => setQueueOpen((v) => !v)} aria-label="재생목록 열기" aria-expanded={queueOpen} aria-haspopup="dialog"
            className={`rounded-full p-3 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent ${queueOpen ? 'bg-accent/25 text-accent' : 'bg-white/10 text-white'}`}>
            <ListMusic size={20} />
          </button>
          <button onClick={onExit} aria-label="전체화면 종료"
            className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent">
            <Minimize2 size={20} />
          </button>
        </div>
      </div>

      <BrandQueueDrawer
        open={queueOpen}
        queue={queue}
        index={index}
        onSelect={(i) => { jumpTo(i); /* 선택 후 현재곡 즉시 갱신; drawer 는 유지(연속 선택 편의) */ }}
        onClose={() => setQueueOpen(false)}
        returnFocusRef={queueBtnRef}
      />
    </div>
  );
}
