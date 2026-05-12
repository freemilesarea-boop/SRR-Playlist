import { gradientStyle } from '@/lib/cover';

interface Props {
  title: string;
  category?: string | null;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showInitial?: boolean;
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

export default function AutoCover({
  title,
  category,
  imageUrl,
  size = 'md',
  className = '',
  showInitial = true,
}: Props) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={title}
        loading="lazy"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  const seed = category || title;
  const initial = pickInitial(title);
  const sz = SIZE[size];

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
