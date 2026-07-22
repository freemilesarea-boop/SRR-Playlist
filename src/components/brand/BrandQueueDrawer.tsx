// Phase BRAND-PLAYER-UX-5 — 전체화면 재생목록 Viewer (오른쪽 Side Drawer).
//   · 현재 Queue 를 그대로 표시(별도 큐 생성 없음). 곡 선택은 공식 command jumpTo(originalIndex).
//   · 섹션: 현재 재생 / 다음 재생. "최근 재생"은 Player 에 History 가 없으므로 표시하지 않는다.
//   · 검색: 현재 Queue 범위 client-side. 결과 선택 시 반드시 원본 Queue Index 로 이동.
//   · 민감정보(UUID/Storage Path/Signed URL/User ID/AI 점수/내부 상태)는 표시하지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Music, Volume2 } from 'lucide-react';
import type { TrackRow } from '@/types/db';
import { searchQueue, buildQueueSections, type QueueSearchItem } from '@/lib/queueSearch';
import BrandQueueSearch from '@/components/brand/BrandQueueSearch';

interface Props {
  open: boolean;
  queue: TrackRow[];
  index: number;
  shuffle: boolean;
  shuffleOrder: number[];
  /** 원본 Queue Index 로 이동. */
  onSelect: (originalIndex: number) => void;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement>;
  /** 검색 입력 focus 중 auto-hide 억제. */
  onSearchFocusChange?: (focused: boolean) => void;
}

export default function BrandQueueDrawer({
  open, queue, index, shuffle, shuffleOrder, onSelect, onClose, returnFocusRef, onSearchFocusChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentItemRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [term, setTerm] = useState('');

  const searching = term.trim() !== '';
  const results = useMemo(() => (searching ? searchQueue(queue, term) : []), [searching, queue, term]);
  const sections = useMemo(
    () => buildQueueSections(queue, index, shuffle, shuffleOrder),
    [queue, index, shuffle, shuffleOrder],
  );

  // 열릴 때: 현재 곡으로 스크롤 + 닫기 버튼 focus. 닫힐 때: 검색 초기화 + focus 복귀.
  useEffect(() => {
    if (!open) { setTerm(''); return; }
    const t = window.setTimeout(() => {
      if (!searching) currentItemRef.current?.scrollIntoView({ block: 'center' });
      closeBtnRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) return;
    returnFocusRef?.current?.focus?.();
  }, [open, returnFocusRef]);

  // Focus trap + Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])');
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  return (
    <>
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
        className={`absolute right-0 top-0 z-[122] flex h-full w-[min(92vw,400px)] flex-col border-l border-white/10 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
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

        <div className="pt-2">
          <BrandQueueSearch
            value={term}
            onChange={setTerm}
            onFocus={() => onSearchFocusChange?.(true)}
            onBlur={() => onSearchFocusChange?.(false)}
            resultCount={results.length}
            total={queue.length}
          />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-2">
          {queue.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-white/50">재생 가능한 곡이 없어요.</p>
          )}

          {/* 검색 모드: 평면 결과(원본 index 보존) */}
          {searching ? (
            results.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-white/50">“{term.trim()}” 검색 결과가 없어요.</p>
            ) : (
              <ul>
                {results.map((it) => (
                  <QueueRow key={it.track.id} item={it} isCurrent={it.originalIndex === index}
                    onSelect={onSelect}
                    rowRef={it.originalIndex === index ? currentItemRef : undefined} />
                ))}
              </ul>
            )
          ) : (
            <>
              {/* 현재 재생 중 */}
              {sections.current && (
                <Section title="현재 재생 중">
                  <QueueRow item={sections.current} isCurrent onSelect={onSelect} rowRef={currentItemRef} />
                </Section>
              )}
              {/* 다음 재생 */}
              {sections.upcoming.length > 0 && (
                <Section title={`다음 재생 · ${sections.upcoming.length}곡`}>
                  <ul>
                    {sections.upcoming.map((it, i) => (
                      <QueueRow key={it.track.id} item={it} onSelect={onSelect} order={i + 1} />
                    ))}
                  </ul>
                </Section>
              )}
              {/* "최근 재생"은 Player History 부재로 표시하지 않음(임의 생성 금지). */}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="sticky top-0 z-[1] bg-neutral-950/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40 backdrop-blur">
        {title}
      </h3>
      {children}
    </section>
  );
}

function QueueRow({
  item, isCurrent = false, onSelect, order, rowRef,
}: {
  item: QueueSearchItem;
  isCurrent?: boolean;
  onSelect: (originalIndex: number) => void;
  order?: number;
  rowRef?: React.RefObject<HTMLButtonElement>;
}) {
  const { track } = item;
  return (
    <button
      ref={rowRef}
      onClick={() => onSelect(item.originalIndex)}
      aria-current={isCurrent ? 'true' : undefined}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isCurrent ? 'bg-accent/15' : 'hover:bg-white/5'}`}
    >
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-white/40">
        {isCurrent ? <Volume2 size={14} className="mx-auto text-accent" /> : (order ?? '')}
      </span>
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/10">
        {track.cover_url ? (
          <img src={track.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center"><Music size={16} className="text-white/30" /></span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${isCurrent ? 'font-bold text-accent' : 'font-semibold text-white'}`}>{track.title}</span>
        <span className="block truncate text-xs text-white/50">{track.artist ?? '—'}</span>
      </span>
      {isCurrent && <span className="shrink-0 text-[10px] font-bold text-accent">재생 중</span>}
    </button>
  );
}
