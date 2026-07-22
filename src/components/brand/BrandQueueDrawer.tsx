// Phase BRAND-PLAYER-UX-4 — 전체화면 재생목록 Viewer (오른쪽 Side Drawer).
// 현재 Queue 를 그대로 표시(별도 큐 생성 없음). 곡 선택은 공식 command jumpTo 재사용.
// 민감정보(트랙 UUID/Storage Path/Signed URL/User ID/AI 점수/내부 상태)는 표시하지 않는다.
import { useEffect, useRef } from 'react';
import { X, Music, Volume2 } from 'lucide-react';
import type { TrackRow } from '@/types/db';

interface Props {
  open: boolean;
  queue: TrackRow[];
  index: number;
  onSelect: (i: number) => void;
  onClose: () => void;
  /** 닫힐 때 focus 를 되돌릴 요소(재생목록 버튼). */
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export default function BrandQueueDrawer({ open, queue, index, onSelect, onClose, returnFocusRef }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentItemRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // 열릴 때: 현재 곡으로 스크롤 + 닫기 버튼에 focus. 닫힐 때: 호출 버튼으로 focus 복귀.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      currentItemRef.current?.scrollIntoView({ block: 'center' });
      closeBtnRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open) return;
    returnFocusRef?.current?.focus?.();
  }, [open, returnFocusRef]);

  // Focus trap (Tab 순환) + Escape 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  return (
    <>
      {/* backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 z-[121] bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="재생목록"
        className={`absolute right-0 top-0 z-[122] flex h-full w-[min(92vw,380px)] flex-col border-l border-white/10 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Music size={16} className="text-accent" /> 재생목록
            <span className="text-white/40">· {queue.length}곡</span>
          </h2>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="재생목록 닫기"
            className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto overscroll-contain py-2">
          {queue.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-white/50">재생 가능한 곡이 없어요.</li>
          )}
          {queue.map((t, i) => {
            const isCurrent = i === index;
            return (
              <li key={t.id}>
                <button
                  ref={isCurrent ? currentItemRef : undefined}
                  onClick={() => onSelect(i)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isCurrent ? 'bg-accent/15' : 'hover:bg-white/5'}`}
                >
                  <span className="w-5 shrink-0 text-center text-xs tabular-nums text-white/40">
                    {isCurrent ? <Volume2 size={14} className="mx-auto text-accent" /> : i + 1}
                  </span>
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/10">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" className="h-full w-full object-cover" draggable={false}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center"><Music size={16} className="text-white/30" /></span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${isCurrent ? 'font-bold text-accent' : 'font-semibold text-white'}`}>{t.title}</span>
                    <span className="block truncate text-xs text-white/50">{t.artist ?? '—'}</span>
                  </span>
                  {isCurrent && <span className="shrink-0 text-[10px] font-bold text-accent">재생 중</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
