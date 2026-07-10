// Phase BRAND-1 — 브랜드 이미지 사이니지.
//   BRAND-PLAYER-UX-1: 전환 타이머 root-cause fix + presentation chrome.
//   BRAND-PLAYER-UX-2: fade/crossfade 전환 + bounded preload(현재+다음) + 도트/카운터.
// sort_order 순서대로 각 display_duration_seconds(초) 만큼 노출 후 다음, 마지막→첫번째 loop.
// 오디오와 완전 독립된 DOM (audio element remount 유발 안 함).
// 이미지 로드 실패 시 다음 이미지로 skip. 0개면 브랜드 기본 화면 fallback.
//
// [핵심 분리] "이미지 유지 시간"(display_duration_seconds, 언제 넘길지)과
//   "전환 애니메이션 시간"(transition.durationMs, 어떻게 넘길지)은 완전히 별개의 개념/타이머다.
//
// [crossfade 방식] 이전 이미지를 아래 레이어(불투명)로 유지한 채, 새 이미지를 위에서 opacity 0→1 로
//   fade-in 시키고 durationMs 후 아래 레이어 제거 → 검은 화면 깜빡임/레이아웃 이동 없음.
//   effect='none' 또는 prefers-reduced-motion 이면 durationMs=0(즉시 전환).
//
// [DOM 이미지 개수 상한] 화면에 mount 되는 <img> 는 (위 1 + 아래 0~1 + 미리로드 1~2) = 최대 4개.
//   이미지가 100장이어도 전부 DOM 에 렌더하지 않는다(메모리 증가 방지).
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Sparkles } from 'lucide-react';
import { resolveSlideDurationMs, nextSlideIndex, normalizeSlideIndex, shouldRunSlideshow } from '@/lib/brandSlideshow';
import { slidePreloadIndexes, slideProgressMode, DEFAULT_TRANSITION_MS } from '@/lib/brandSignageSettings';
import type { SignageTransitionEffect } from '@/types/brand';

export interface SignageItem {
  id: string;
  title: string | null;
  image_url: string;
  display_duration_seconds: number;
}

interface Props {
  items: SignageItem[];
  brandName: string;
  className?: string;
  /** presentation(전체화면) 모드: 이미지 외 chrome(캡션) 숨김 + 도트는 옵션에 따름 */
  chromeHidden?: boolean;
  /** 전환 효과/시간 (미지정 시 fade/500ms). */
  transition?: { effect: SignageTransitionEffect; durationMs: number };
  /** presentation 진행표시 opt-in. 일반 모드에서는 항상 표시(기존 UX 유지). */
  showSlideDots?: boolean;
}

/** 접근성: prefers-reduced-motion 이면 전환 애니메이션을 끈다(즉시 전환). */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

export default function BrandSignage({
  items, brandName, className, chromeHidden = false, transition, showSlideDots = false,
}: Props) {
  const [idx, setIdx] = useState(0);
  // 로드 실패로 영구 제외된 이미지 id 집합
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<number | null>(null);

  const usable = items.filter((it) => !broken.has(it.id));
  const count = usable.length;
  const safeIdx = normalizeSlideIndex(idx, count);
  const cur = count > 0 ? usable[safeIdx] : null;
  // 이미지 유지 시간(초, 관리자 저장값) → ms. 잘못된 값에만 안전 fallback. (전환 애니메이션 시간과 별개)
  const curDurMs = cur ? resolveSlideDurationMs(cur.display_duration_seconds) : 0;

  const reduceMotion = usePrefersReducedMotion();
  const effect = transition?.effect ?? 'fade';
  const rawFade = transition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const fadeMs = effect === 'fade' && !reduceMotion ? Math.max(0, rawFade) : 0;

  // crossfade: 직전 이미지를 아래 레이어로 잠시 유지(위 레이어 fade-in 동안 검은 배경 노출 방지)
  const [prevItem, setPrevItem] = useState<SignageItem | null>(null);
  const lastItemRef = useRef<SignageItem | null>(cur);
  const fadeClearRef = useRef<number | null>(null);

  // items 목록이 바뀌면 index 리셋(out-of-range 정규화) + 진행 중 fade 정리
  useEffect(() => {
    setIdx(0);
    setPrevItem(null);
    lastItemRef.current = null;
  }, [items]);

  // 현재 이미지가 바뀌면 직전 이미지를 아래 레이어로 유지 후 fadeMs 뒤 제거(crossfade 완료).
  useEffect(() => {
    if (!cur) { lastItemRef.current = null; return; }
    const last = lastItemRef.current;
    if (last && last.id !== cur.id && fadeMs > 0) {
      setPrevItem(last);
      if (fadeClearRef.current) window.clearTimeout(fadeClearRef.current);
      fadeClearRef.current = window.setTimeout(() => setPrevItem(null), fadeMs);
    }
    lastItemRef.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, fadeMs]);

  useEffect(() => () => { if (fadeClearRef.current) window.clearTimeout(fadeClearRef.current); }, []);

  // 현재 이미지 유지 시간(display_duration_seconds) 후 다음으로 전환.
  // dependency 는 primitive(safeIdx/count/curDurMs)만 — 부모 리렌더로 인한 타이머 재생성 방지.
  // 이미지 0·1장이면 타이머를 만들지 않는다(2장 이상에서만 순환). 단일 타이머.
  useEffect(() => {
    if (!shouldRunSlideshow(count)) return;
    const id = window.setTimeout(() => {
      setIdx((i) => nextSlideIndex(i, count));
    }, curDurMs);
    timerRef.current = id;
    return () => {
      window.clearTimeout(id);
      if (timerRef.current === id) timerRef.current = null;
    };
  }, [safeIdx, count, curDurMs]);

  function handleError(id: string) {
    setBroken((prev) => {
      if (prev.has(id)) return prev;
      const nx = new Set(prev);
      nx.add(id);
      return nx;
    });
    // 깨진 이미지 → 다음으로 이동(전체 slideshow 중단 금지). 렌더에서 index 정규화됨.
    setIdx((i) => i + 1);
  }

  // fallback: 사용할 이미지가 없음
  if (count === 0 || !cur) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-900 to-black text-white/80 ${className ?? ''}`}>
        {items.length === 0 ? (
          <>
            <Sparkles size={48} className="text-accent" />
            <p className="text-2xl font-extrabold tracking-tight">{brandName}</p>
            <p className="text-sm text-white/50">브랜드 사이니지 이미지가 아직 등록되지 않았어요.</p>
          </>
        ) : (
          <>
            <ImageOff size={44} className="text-white/40" />
            <p className="text-lg font-bold">이미지를 불러올 수 없어요</p>
            <p className="text-sm text-white/50">{brandName}</p>
          </>
        )}
      </div>
    );
  }

  // bounded preload: 현재 + 다음 1(장수 많으면 다음+1까지). URL 중복 제거는 인덱스 dedupe 로 보장.
  const preloadIdx = slidePreloadIndexes(safeIdx, count, count > 2);
  const preloadItems = preloadIdx.map((i) => usable[i]).filter(Boolean) as SignageItem[];

  const progressMode = slideProgressMode(count); // 'none' | 'dots' | 'counter'
  // 일반 모드: 기존 UX 대로 항상 진행표시. presentation: showSlideDots opt-in 일 때만.
  const showProgress = progressMode !== 'none' && (chromeHidden ? showSlideDots : true);

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ''}`}>
      {/* 아래 레이어: 직전 이미지(불투명) — 위 레이어 fade-in 동안 검은 배경 방지. fadeMs 후 제거. */}
      {prevItem && prevItem.id !== cur.id && (
        <img
          key={`prev-${prevItem.id}`}
          src={prevItem.image_url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      )}
      {/* 위 레이어: 현재 이미지 — mount 시 opacity 0→1 로 fade-in(effect/duration 반영). */}
      <CrossfadeImage
        key={`cur-${cur.id}`}
        item={cur}
        brandName={brandName}
        durationMs={fadeMs}
        onError={() => handleError(cur.id)}
      />
      {/* 미리로드(비가시): 다음 이미지 decode 만 유도. 화면에 보이지 않음. */}
      {preloadItems.map((p) => (
        <img
          key={`pre-${p.id}`}
          src={p.image_url}
          alt=""
          aria-hidden
          onError={() => handleError(p.id)}
          className="pointer-events-none absolute h-px w-px opacity-0"
          draggable={false}
        />
      ))}

      {!chromeHidden && cur.title && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
          {cur.title}
        </div>
      )}

      {/* 진행표시: 2~19장 도트, 20장 이상 현재/전체 카운터. */}
      {showProgress && progressMode === 'dots' && (
        <div className="absolute bottom-4 right-4 flex gap-1.5">
          {usable.map((it, i) => (
            <span
              key={it.id}
              className={`h-1.5 rounded-full transition-all ${i === safeIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      )}
      {showProgress && progressMode === 'counter' && (
        <div className="absolute bottom-4 right-4 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
          {safeIdx + 1} / {count}
        </div>
      )}
    </div>
  );
}

/** 현재 이미지 레이어 — mount 다음 프레임에 opacity 1 로 전환하여 fade-in. durationMs=0 이면 즉시. */
function CrossfadeImage({
  item, brandName, durationMs, onError,
}: {
  item: SignageItem;
  brandName: string;
  durationMs: number;
  onError: () => void;
}) {
  const [shown, setShown] = useState(durationMs <= 0);
  useEffect(() => {
    if (durationMs <= 0) { setShown(true); return; }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [durationMs]);
  return (
    <img
      src={item.image_url}
      alt={item.title ?? brandName}
      onError={onError}
      className="absolute inset-0 h-full w-full object-contain"
      draggable={false}
      style={{
        opacity: shown ? 1 : 0,
        transition: durationMs > 0 ? `opacity ${durationMs}ms ease-in-out` : 'none',
      }}
    />
  );
}
