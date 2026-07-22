// Phase BRAND-PLAYER-UX-5 — 전체화면 진행바 + 시간(현재/전체) + 안전한 Seek.
// currentTime/duration 을 이 컴포넌트에서만 구독 → 매 tick 재렌더가 Control/Visual Stage 로 번지지 않음.
// Seek 는 store.seekTo() (Owner 가 적용) 만 호출. audio DOM 직접 접근 없음.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { formatPlaybackTime, isDurationPending, playbackProgress, progressToSeconds } from '@/lib/playbackTime';

interface Props {
  /** drag/keyboard 조작 중 auto-hide 억제. */
  onHold?: (held: boolean) => void;
  /** 조작 발생 시 auto-hide 타이머 리셋. */
  onActivity?: () => void;
}

export default function BrandPlaybackProgress({ onHold, onActivity }: Props) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const pending = isDurationPending(duration);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const liveRatio = dragRatio ?? playbackProgress(currentTime, duration);
  const shownSec = dragRatio != null ? progressToSeconds(dragRatio, duration) : currentTime;

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const scheduleDrag = useCallback((clientX: number) => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setDragRatio(ratioFromClientX(clientX));
    });
  }, [ratioFromClientX]);

  const endDrag = useCallback((commit: boolean, ratio: number | null) => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (commit && ratio != null) seekTo(progressToSeconds(ratio, duration));
    setDragRatio(null);
    onHold?.(false);
    onActivity?.();
  }, [seekTo, duration, onHold, onActivity]);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pending) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onHold?.(true);
    onActivity?.();
    setDragRatio(ratioFromClientX(e.clientX));
  }, [pending, onHold, onActivity, ratioFromClientX]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pending || dragRatio == null) return;
    scheduleDrag(e.clientX);
  }, [pending, dragRatio, scheduleDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pending) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    endDrag(true, ratioFromClientX(e.clientX));
  }, [pending, endDrag, ratioFromClientX]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (pending) return;
    let target: number;
    switch (e.key) {
      case 'ArrowRight': target = Math.min(duration, currentTime + 5); break;
      case 'ArrowLeft': target = Math.max(0, currentTime - 5); break;
      case 'Home': target = 0; break;
      case 'End': target = Math.max(0, duration - 1); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation(); // 슬라이더 focus 중 Arrow → 트랙 이동과 충돌 방지
    seekTo(target);
    onActivity?.();
  }, [pending, duration, currentTime, seekTo, onActivity]);

  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/70">
        {pending ? '--:--' : formatPlaybackTime(shownSec)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={pending ? 0 : Math.floor(duration)}
        aria-valuenow={pending ? 0 : Math.floor(shownSec)}
        aria-valuetext={pending ? '재생 시간 준비 중' : formatPlaybackTime(shownSec)}
        aria-disabled={pending || undefined}
        tabIndex={pending ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => endDrag(false, null)}
        onKeyDown={onKeyDown}
        className={`group relative h-6 flex-1 ${pending ? 'cursor-not-allowed' : 'cursor-pointer'} touch-none select-none focus-visible:outline-none`}
      >
        {/* 트랙 */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-accent" style={{ width: `${liveRatio * 100}%` }} />
        </div>
        {/* thumb */}
        {!pending && (
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow ring-2 ring-accent transition-transform group-focus-visible:scale-125"
            style={{ left: `${liveRatio * 100}%` }}
          />
        )}
      </div>
      <span className="w-12 shrink-0 text-left text-xs tabular-nums text-white/70">
        {pending ? '--:--' : formatPlaybackTime(duration)}
      </span>
    </div>
  );
}
