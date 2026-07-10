// Phase BRAND-1 — 브랜드 이미지 사이니지. (BRAND-PLAYER-UX-1: 전환 타이머 root-cause fix + presentation chrome)
// sort_order 순서대로 각 display_duration_seconds(초) 만큼 노출 후 다음, 마지막→첫번째 loop.
// 오디오와 완전 독립된 DOM (audio element remount 유발 안 함).
// 이미지 로드 실패 시 다음 이미지로 skip. 0개면 브랜드 기본 화면 fallback.
//
// [root-cause fix] 이전에는 전환 useEffect 가 `usable`(items.filter → 매 렌더 새 배열)에 의존하여,
//   부모(BrandPlayerPage)가 currentTime tick 마다 리렌더 → usable 참조 변경 → setTimeout 이 durMs 도달 전
//   매번 clear/재생성 → 이미지가 고정되는 문제가 있었다. 이제 primitive dep(safeIdx, count, curDurMs)만 사용한다.
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Sparkles } from 'lucide-react';
import { resolveSlideDurationMs, nextSlideIndex, normalizeSlideIndex, shouldRunSlideshow } from '@/lib/brandSlideshow';

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
  /** presentation(전체화면) 모드: 이미지 외 chrome(캡션·도트) 숨김 */
  chromeHidden?: boolean;
}

export default function BrandSignage({ items, brandName, className, chromeHidden = false }: Props) {
  const [idx, setIdx] = useState(0);
  // 로드 실패로 영구 제외된 이미지 id 집합
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<number | null>(null);

  const usable = items.filter((it) => !broken.has(it.id));
  const count = usable.length;
  const safeIdx = normalizeSlideIndex(idx, count);
  const cur = count > 0 ? usable[safeIdx] : null;
  // 관리자 저장값(초) → ms. 단일 source of truth(공통 함수). 잘못된 값에만 안전 fallback.
  const curDurMs = cur ? resolveSlideDurationMs(cur.display_duration_seconds) : 0;

  // items 목록이 바뀌면 index 리셋(out-of-range 정규화)
  useEffect(() => { setIdx(0); }, [items]);

  // 현재 이미지 duration 후 다음으로 전환.
  // dependency 는 primitive(safeIdx/count/curDurMs)만 — 부모 리렌더로 인한 타이머 재생성 방지.
  // 이미지 0·1장이면 타이머를 만들지 않는다(2장 이상에서만 순환).
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
  if (count === 0) {
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

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ''}`}>
      {/* key 로 각 이미지 개별 노드 — 전환 시 img 만 교체, 컨테이너 유지 */}
      <img
        key={cur!.id}
        src={cur!.image_url}
        alt={cur!.title ?? brandName}
        onError={() => handleError(cur!.id)}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      {!chromeHidden && cur!.title && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
          {cur!.title}
        </div>
      )}
      {/* 진행 도트 (presentation 모드에서는 숨김) */}
      {!chromeHidden && count > 1 && (
        <div className="absolute bottom-4 right-4 flex gap-1.5">
          {usable.map((it, i) => (
            <span
              key={it.id}
              className={`h-1.5 rounded-full transition-all ${i === safeIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
