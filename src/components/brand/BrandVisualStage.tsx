// Phase BRAND-PLAYER-UX-4 — 브랜드 플레이어 시각 콘텐츠 스테이지.
// 표시 우선순위(brandDisplayMode)를 단일 지점에서 결정하고 렌더한다.
//   BRAND_MEDIA   → BrandSignage(기존 순환 재생 로직 그대로)
//   BRAND_LOGO    → 브랜드 로고 중앙 지속 표시(object-contain, 과대확대/깨짐 방지)
//   TRACK_ARTWORK → 현재곡 자켓(곡 변경 시 자동 교체 + 짧은 fade, 다음 자켓 preload)
//   DEFAULT_FALLBACK → 서비스 기본 로고 + 안전한 gradient 배경(안내 문구 없음)
// 오디오/큐에는 절대 관여하지 않는다 — 시각 표시 전환일 뿐.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogoMark } from '@/components/Logo';
import BrandSignage, { type SignageItem } from '@/components/brand/BrandSignage';
import {
  filterValidSignageItems,
  resolveBrandDisplayMode,
  type BrandPlayerDisplayMode,
} from '@/lib/brandDisplayMode';
import type { SignageTransitionEffect } from '@/types/brand';

export interface BrandVisualStageProps {
  media: SignageItem[];
  brandName: string;
  /** 서비스/브랜드 로고 URL (없으면 null). */
  logoUrl: string | null;
  /** 현재 재생곡 자켓 URL. */
  artworkUrl: string | null;
  /** 다음 곡 자켓 URL(preload용, 선택). */
  nextArtworkUrl?: string | null;
  className?: string;
  chromeHidden?: boolean;
  transition?: { effect: SignageTransitionEffect; durationMs: number };
  showSlideDots?: boolean;
  /** 결정된 표시 모드를 상위에 알림(디버그/오버레이 판단용, 선택). */
  onModeChange?: (mode: BrandPlayerDisplayMode) => void;
}

export default function BrandVisualStage({
  media, brandName, logoUrl, artworkUrl, nextArtworkUrl, className,
  chromeHidden = false, transition, showSlideDots = false, onModeChange,
}: BrandVisualStageProps) {
  // 정적 유효 미디어(빈 URL/미지원 형식 제외). 배열 길이만으로 빈 상태를 판정하지 않는다.
  const validMedia = useMemo(() => filterValidSignageItems(media), [media]);
  // 런타임 표시 가능 수(로드 실패 반영) — BrandSignage 가 보고. 초기값 = 유효 미디어 수.
  const [usableMediaCount, setUsableMediaCount] = useState(validMedia.length);
  useEffect(() => { setUsableMediaCount(validMedia.length); }, [validMedia]);

  // 자켓 로드 실패 URL 집합(무한 재시도 방지 + 우선순위 하향).
  const [failedArtwork, setFailedArtwork] = useState<Set<string>>(() => new Set());
  const artworkFailed = artworkUrl ? failedArtwork.has(artworkUrl) : true;

  const mode = resolveBrandDisplayMode({
    usableMediaCount: validMedia.length > 0 ? usableMediaCount : 0,
    logoUrl,
    artworkUrl,
    artworkFailed,
  });

  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);

  const handleArtworkError = useCallback((url: string) => {
    setFailedArtwork((prev) => {
      if (prev.has(url)) return prev;
      const nx = new Set(prev); nx.add(url); return nx;
    });
  }, []);

  const base = `absolute inset-0 h-full w-full ${className ?? ''}`;

  if (mode === 'BRAND_MEDIA') {
    return (
      <BrandSignage
        items={validMedia}
        brandName={brandName}
        className={base}
        chromeHidden={chromeHidden}
        transition={transition}
        showSlideDots={showSlideDots}
        onUsableCountChange={setUsableMediaCount}
      />
    );
  }

  if (mode === 'BRAND_LOGO' && logoUrl) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-slate-900 to-black ${base}`}>
        <img
          src={logoUrl}
          alt={brandName}
          draggable={false}
          // 원본 비율 유지 + 잘림 방지 + 과대확대 제한(최대 ~40v/화면), 저해상도 깨짐 방지.
          className="max-h-[40%] max-w-[55%] object-contain [image-rendering:auto]"
          onError={() => handleArtworkError(logoUrl)}
        />
      </div>
    );
  }

  if (mode === 'TRACK_ARTWORK' && artworkUrl) {
    return (
      <ArtworkStage
        artworkUrl={artworkUrl}
        nextArtworkUrl={nextArtworkUrl ?? null}
        brandName={brandName}
        className={base}
        onError={handleArtworkError}
      />
    );
  }

  // DEFAULT_FALLBACK — 안전한 기본 화면(안내 문구 없음).
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-slate-900 to-black ${base}`}>
      <LogoMark size={96} className="text-white/70" />
      <span className="sr-only">{brandName}</span>
    </div>
  );
}

/**
 * 자켓 표시 레이어. 곡(자켓 URL) 변경 시 짧은 fade 로 교체 — 기존 Crossfade 와 독립.
 * 다음 자켓은 비가시 img 로 미리 로드. URL 은 콘솔에 출력하지 않는다.
 */
function ArtworkStage({
  artworkUrl, nextArtworkUrl, brandName, className, onError,
}: {
  artworkUrl: string;
  nextArtworkUrl: string | null;
  brandName: string;
  className: string;
  onError: (url: string) => void;
}) {
  return (
    <div className={`flex items-center justify-center overflow-hidden bg-black ${className}`}>
      {/* 배경: 자켓을 흐리게 확대해 레터박스 여백을 자연스럽게 채움(과도한 잘림 없음) */}
      <img
        key={`bg-${artworkUrl}`}
        src={artworkUrl}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl motion-safe:transition-opacity motion-safe:duration-500"
        onError={() => onError(artworkUrl)}
      />
      {/* 전경: 원본 비율 유지(object-contain). key 변경으로 fade-in 재생. */}
      <img
        key={`fg-${artworkUrl}`}
        src={artworkUrl}
        alt={`${brandName} — 현재 재생 자켓`}
        draggable={false}
        className="relative max-h-[86%] max-w-[86%] object-contain shadow-2xl motion-safe:animate-[fadeIn_400ms_ease-in-out]"
        onError={() => onError(artworkUrl)}
      />
      {/* 다음 자켓 preload(비가시) */}
      {nextArtworkUrl && nextArtworkUrl !== artworkUrl && (
        <img
          key={`pre-${nextArtworkUrl}`}
          src={nextArtworkUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute h-px w-px opacity-0"
          onError={() => onError(nextArtworkUrl)}
        />
      )}
    </div>
  );
}
