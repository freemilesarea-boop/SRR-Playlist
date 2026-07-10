import { useState, useEffect } from 'react';
import { gradientStyle } from '@/lib/cover';
import AbstractCover, { type CoverTone } from './AbstractCover';

interface Props {
  title: string;
  category?: string | null;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showInitial?: boolean;
  /** 이미지가 없을 때 DEUDDA AbstractCover 로 대체 (opt-in). 기본은 기존 gradient fallback. */
  useAbstract?: boolean;
}

const SIZE: Record<string, { font: string; padding: string }> = {
  sm: { font: 'text-xl', padding: 'p-2' },
  md: { font: 'text-3xl', padding: 'p-3' },
  lg: { font: 'text-5xl', padding: 'p-4' },
  xl: { font: 'text-7xl', padding: 'p-6' },
};

function pickInitial(s: string): string {
  const trimmed = s?.trim() ?? '';
  if (!trimmed) return '♪';
  // 한글 첫 글자 또는 영문 첫 글자
  return trimmed.slice(0, 1).toUpperCase();
}

const ABSTRACT_TONES: CoverTone[] = ['violet', 'teal', 'amber', 'blackberry', 'carbon', 'deep'];
function pickToneFromSeed(seed: string): CoverTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ABSTRACT_TONES[h % ABSTRACT_TONES.length];
}

export default function AutoCover({
  title,
  category,
  imageUrl,
  size = 'md',
  className = '',
  showInitial = true,
  useAbstract = false,
}: Props) {
  // 이미지 로드 실패(403/404/깨진 URL) 시 그라데이션 fallback 으로 전환
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [imageUrl]);

  const hasImage = !!imageUrl && !errored;

  if (hasImage) {
    return (
      <img
        src={imageUrl as string}
        alt={`${title} 앨범 커버`}
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
        onError={() => {
          if (import.meta.env.DEV) {
            console.warn('[AutoCover] 커버 이미지 로드 실패 → fallback:', { title, imageUrl });
          }
          setErrored(true);
        }}
      />
    );
  }

  const seed = category || title;
  const initial = pickInitial(title);
  const sz = SIZE[size];

  // DEUDDA AbstractCover fallback (opt-in)
  if (useAbstract) {
    const tone = pickToneFromSeed(seed);
    const firstChar = (title || '').trim().slice(0, 1);
    // 한글이면 글리프로 사용, 아니면 글리프 생략(추상 패턴만)
    const isHangul = firstChar
      ? (firstChar.charCodeAt(0) >= 0xac00 && firstChar.charCodeAt(0) <= 0xd7a3)
      : false;
    const glyph = isHangul ? firstChar : null;
    const mini = size === 'sm';
    return (
      <div className={`relative h-full w-full overflow-hidden ${className}`}>
        <AbstractCover tone={tone} glyph={glyph} mini={mini} />
        {/* 한글이 아니면 기존 initial 을 작게 한 번 노출 (브랜드 가독성) */}
        {!isHangul && showInitial && !mini && (
          <div className={`absolute inset-0 flex items-end ${sz.padding} font-black tracking-tight text-white/85 drop-shadow-lg pointer-events-none`}>
            <span className={sz.font}>{initial}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={gradientStyle(seed)}
    >
      {/* 노이즈 / 라이트 효과 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 15%, rgba(255,255,255,0.5), transparent 45%), radial-gradient(circle at 80% 90%, rgba(0,0,0,0.45), transparent 50%)',
        }}
      />
      {showInitial && (
        <div
          className={`absolute inset-0 flex items-end ${sz.padding} font-black tracking-tight text-white/90 drop-shadow-lg`}
        >
          <span className={sz.font}>{initial}</span>
        </div>
      )}
    </div>
  );
}
