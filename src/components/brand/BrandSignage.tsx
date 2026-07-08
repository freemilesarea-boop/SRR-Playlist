// Phase BRAND-1 — 브랜드 이미지 사이니지.
// sort_order 순서대로 각 display_duration_seconds 만큼 노출 후 다음, 마지막→첫번째 loop.
// 오디오와 완전 독립된 DOM (audio element remount 유발 안 함).
// 이미지 로드 실패 시 다음 이미지로 skip. 0개면 브랜드 기본 화면 fallback.
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Sparkles } from 'lucide-react';

export interface SignageItem {
  id: string;
  title: string | null;
  image_url: string;
  display_duration_seconds: number;
}

interface Props {
  items: SignageItem[];
  brandName: string;
  /** 로드 실패로 모든 이미지가 skip 된 경우 fallback 표시 */
  className?: string;
}

export default function BrandSignage({ items, brandName, className }: Props) {
  const [idx, setIdx] = useState(0);
  // 로드 실패로 영구 제외된 이미지 id 집합
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<number | null>(null);

  const usable = items.filter((it) => !broken.has(it.id));

  // items 가 바뀌면 index 리셋
  useEffect(() => { setIdx(0); }, [items]);

  // 현재 이미지 duration 후 다음으로 전환
  useEffect(() => {
    if (usable.length === 0) return;
    const safeIdx = idx % usable.length;
    const cur = usable[safeIdx];
    const durMs = Math.max(1, Math.min(cur.display_duration_seconds || 10, 600)) * 1000;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setIdx((i) => (i + 1) % Math.max(usable.length, 1));
    }, durMs);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [idx, usable]);

  function handleError(id: string) {
    setBroken((prev) => {
      const nx = new Set(prev);
      nx.add(id);
      return nx;
    });
    // 다음 이미지로 즉시 이동
    setIdx((i) => i + 1);
  }

  // fallback: 사용할 이미지가 없음
  if (usable.length === 0) {
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

  const safeIdx = idx % usable.length;
  const cur = usable[safeIdx];

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ''}`}>
      {/* key 로 각 이미지 개별 노드 — 전환 시 img 만 교체, 컨테이너 유지 */}
      <img
        key={cur.id}
        src={cur.image_url}
        alt={cur.title ?? brandName}
        onError={() => handleError(cur.id)}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      {cur.title && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
          {cur.title}
        </div>
      )}
      {/* 진행 도트 */}
      {usable.length > 1 && (
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
