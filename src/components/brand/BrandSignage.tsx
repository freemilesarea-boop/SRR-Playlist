// Phase BRAND-1 — 브랜드 이미지/동영상 사이니지.
//   UX-1: 전환 타이머 root-cause fix + presentation chrome.
//   UX-2: fade/crossfade 전환 + bounded preload + 도트/카운터.
//   UX-3: 동영상(mp4/webm/mov) 지원 — image 는 유지시간, video 는 종료까지 재생 후 다음.
// sort_order 순서대로: image → display_duration_seconds 후 다음 / video → onEnded 후 다음. 마지막→첫번째 loop.
// 오디오와 완전 독립된 DOM. video 는 muted → 음악에 영향 없음(오디오 출력 금지).
// 로드 실패 시 다음 슬라이드로 skip(전체 중단 금지). 0개면 브랜드 기본 화면 fallback.
//
// [핵심 분리] image 유지 시간(display_duration_seconds) ≠ 전환 애니메이션 시간(transition.durationMs)
//   ≠ video 재생 길이(자연 종료). video 는 길이를 억지로 자르지 않는다(타이머로 끊지 않음).
//
// [crossfade] 이전 미디어를 아래 레이어로 잠시 유지 + 새 미디어를 위에서 opacity 0→1 → 검은 깜빡임 없음.
// [DOM 상한] 화면 mount 미디어 = 위 1 + 아래 0~1 + 미리로드 1~2 = 최대 ~4. 100개여도 전부 렌더 안 함.
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveSlideDurationMs, nextSlideIndex, normalizeSlideIndex, shouldRunSlideshow } from '@/lib/brandSlideshow';
import { slidePreloadIndexes, slideProgressMode, DEFAULT_TRANSITION_MS } from '@/lib/brandSignageSettings';
import { isVideoAsset } from '@/lib/brandMediaType';
import type { SignageTransitionEffect, BrandMediaType } from '@/types/brand';

export interface SignageItem {
  id: string;
  title: string | null;
  image_url: string;
  display_duration_seconds: number;
  asset_type?: BrandMediaType;
  mime_type?: string | null;
}

interface Props {
  items: SignageItem[];
  brandName: string;
  className?: string;
  chromeHidden?: boolean;
  transition?: { effect: SignageTransitionEffect; durationMs: number };
  showSlideDots?: boolean;
  /**
   * BRAND-PLAYER-UX-4 — 런타임에 표시 가능한(로드 실패 제외) 미디어 수를 부모에 보고.
   * 부모(BrandVisualStage)가 이 값이 0 이 되면 로고/자켓 우선순위로 전환한다.
   */
  onUsableCountChange?: (count: number) => void;
}

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
  onUsableCountChange,
}: Props) {
  const [idx, setIdx] = useState(0);
  // 같은 인덱스로 재진입(단일 video 반복)해도 remount 되도록 하는 카운터
  const [cycle, setCycle] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());

  const usable = items.filter((it) => !broken.has(it.id));
  const count = usable.length;
  const safeIdx = normalizeSlideIndex(idx, count);
  const cur = count > 0 ? usable[safeIdx] : null;
  const curIsVideo = !!cur && isVideoAsset(cur.asset_type, cur.mime_type);
  // image 유지 시간(초) → ms. video 는 사용 안 함(자연 종료로 전환).
  const curDurMs = cur ? resolveSlideDurationMs(cur.display_duration_seconds) : 0;

  const reduceMotion = usePrefersReducedMotion();
  const effect = transition?.effect ?? 'fade';
  const rawFade = transition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const fadeMs = effect === 'fade' && !reduceMotion ? Math.max(0, rawFade) : 0;

  const [prevItem, setPrevItem] = useState<SignageItem | null>(null);
  const lastItemRef = useRef<SignageItem | null>(cur);
  const fadeClearRef = useRef<number | null>(null);

  // 다음 슬라이드로 전환(순환 + remount 보장)
  const advance = useCallback(() => {
    setIdx((i) => nextSlideIndex(i, count));
    setCycle((c) => c + 1);
  }, [count]);

  // items 변경 → 리셋
  useEffect(() => {
    setIdx(0); setCycle(0); setPrevItem(null); lastItemRef.current = null;
  }, [items]);

  // 현재 미디어 변경 시 직전 미디어를 아래 레이어로 유지(fadeMs 후 제거)
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

  // BRAND-PLAYER-UX-4 — 표시 가능한 미디어 수 보고(로드 실패 반영). 부모가 우선순위 재평가.
  useEffect(() => {
    onUsableCountChange?.(count);
  }, [count, onUsableCountChange]);

  // 유지 타이머: image 일 때만. video 는 onEnded 가 전환을 담당(길이를 자르지 않음).
  // 이미지 0·1장이면 타이머 없음. 단일 타이머.
  useEffect(() => {
    if (!cur || curIsVideo) return;
    if (!shouldRunSlideshow(count)) return;
    const id = window.setTimeout(() => advance(), curDurMs);
    return () => window.clearTimeout(id);
  }, [safeIdx, count, curDurMs, curIsVideo, cur, advance]);

  const handleError = useCallback((id: string) => {
    setBroken((prev) => {
      if (prev.has(id)) return prev;
      const nx = new Set(prev); nx.add(id); return nx;
    });
    // 깨진 미디어 → 다음으로(전체 중단 금지). 렌더에서 index 정규화.
    setIdx((i) => i + 1);
    setCycle((c) => c + 1);
  }, []);

  // BRAND-PLAYER-UX-4 — 표시 가능한 미디어가 없으면 안내 문구 대신 아무것도 렌더하지 않는다.
  // 상위(BrandVisualStage)가 이 경우 로고 → 자켓 → 기본 화면 우선순위로 전환한다.
  if (count === 0 || !cur) return null;

  const preloadIdx = slidePreloadIndexes(safeIdx, count, count > 2);
  const preloadItems = preloadIdx.map((i) => usable[i]).filter(Boolean) as SignageItem[];

  const progressMode = slideProgressMode(count);
  const showProgress = progressMode !== 'none' && (chromeHidden ? showSlideDots : true);

  const prevIsVideo = prevItem ? isVideoAsset(prevItem.asset_type, prevItem.mime_type) : false;

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ''}`}>
      {/* 아래 레이어: 직전 미디어(불투명 유지) — fadeMs 후 제거 */}
      {prevItem && prevItem.id !== cur.id && (
        prevIsVideo ? (
          <video
            key={`prev-${prevItem.id}`} src={prevItem.image_url}
            muted playsInline preload="metadata" aria-hidden
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <img
            key={`prev-${prevItem.id}`} src={prevItem.image_url} alt="" aria-hidden
            className="absolute inset-0 h-full w-full object-contain" draggable={false}
          />
        )
      )}

      {/* 위 레이어: 현재 미디어 — fade-in. video 는 종료 시 다음. */}
      <CrossfadeMedia
        key={`cur-${cur.id}-${cycle}`}
        item={cur}
        brandName={brandName}
        durationMs={fadeMs}
        isVideo={curIsVideo}
        onEnded={curIsVideo ? advance : undefined}
        onFailed={() => handleError(cur.id)}
      />

      {/* 미리로드(비가시): 다음 미디어 decode/metadata 만 유도 */}
      {preloadItems.map((p) => (
        isVideoAsset(p.asset_type, p.mime_type) ? (
          <video
            key={`pre-${p.id}`} src={p.image_url} muted preload="metadata" aria-hidden
            onError={() => handleError(p.id)}
            className="pointer-events-none absolute h-px w-px opacity-0"
          />
        ) : (
          <img
            key={`pre-${p.id}`} src={p.image_url} alt="" aria-hidden
            onError={() => handleError(p.id)}
            className="pointer-events-none absolute h-px w-px opacity-0" draggable={false}
          />
        )
      ))}

      {!chromeHidden && cur.title && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
          {cur.title}
        </div>
      )}

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

/** 현재 미디어 레이어(image/video). mount 다음 프레임에 opacity 1 로 fade-in. video 는 muted 자동재생 후 onEnded. */
function CrossfadeMedia({
  item, brandName, durationMs, isVideo, onEnded, onFailed,
}: {
  item: SignageItem;
  brandName: string;
  durationMs: number;
  isVideo: boolean;
  onEnded?: () => void;
  onFailed: () => void;
}) {
  const [shown, setShown] = useState(durationMs <= 0);
  useEffect(() => {
    if (durationMs <= 0) { setShown(true); return; }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [durationMs]);

  const style = {
    opacity: shown ? 1 : 0,
    transition: durationMs > 0 ? `opacity ${durationMs}ms ease-in-out` : 'none',
  } as const;

  if (isVideo) {
    return (
      <video
        src={item.image_url}
        autoPlay
        muted
        playsInline
        preload="metadata"
        onEnded={onEnded}
        onError={onFailed}
        onLoadedMetadata={(e) => {
          // muted 자동재생 보장 — 차단되면 skip(정지 방지). 길이는 자르지 않음.
          const v = e.currentTarget;
          const p = v.play();
          if (p && typeof p.catch === 'function') p.catch(() => onFailed());
        }}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        style={style}
      />
    );
  }
  return (
    <img
      src={item.image_url}
      alt={item.title ?? brandName}
      onError={onFailed}
      className="absolute inset-0 h-full w-full object-contain"
      draggable={false}
      style={style}
    />
  );
}
