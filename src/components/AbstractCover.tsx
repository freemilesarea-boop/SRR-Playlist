/**
 * AbstractCover — DEUDDA Design System §5
 * 실제 앨범 커버 이미지가 없는 경우 fallback 으로 사용하는 deterministic 추상 커버.
 * 같은 입력 → 같은 결과.
 *
 * 사용:
 *   <div className="relative aspect-square">
 *     <AbstractCover tone="violet" glyph="와" pattern={2} />
 *   </div>
 *
 * 부모는 반드시 `position: relative` + 명시적 크기를 가져야 함.
 */

export type CoverTone = 'violet' | 'teal' | 'amber' | 'blackberry' | 'carbon' | 'deep';

interface ToneSet {
  top: string;
  mid: string;
  accent: string;
}

const TONES: Record<CoverTone, ToneSet> = {
  violet:     { top: '#3A1782', mid: '#160545', accent: '#7B3FF2' },
  teal:       { top: '#0C4744', mid: '#04201E', accent: '#2EBFA7' },
  amber:      { top: '#3A2208', mid: '#180D02', accent: '#D89446' },
  blackberry: { top: '#3A0E26', mid: '#1A0410', accent: '#D54B86' },
  carbon:     { top: '#2A2A2A', mid: '#0E0E0E', accent: '#999999' },
  deep:       { top: '#1A0B40', mid: '#0A0418', accent: '#4E1FB8' },
};

interface Props {
  tone?: CoverTone;
  /** 0~3 — glyph charCode 로 결정 (생략 시 자동) */
  pattern?: 0 | 1 | 2 | 3;
  /** 한글 1자 (Latin 등 비한글이면 글리프 생략) */
  glyph?: string | null;
  /** mini: 작은 썸네일용 (글리프/그레인 생략) */
  mini?: boolean;
  className?: string;
}

/** glyph 가 한글 음절(가-힣)인지 */
function isHangul(ch: string | null | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3;
}

/** 결정적 패턴 인덱스 (글리프 → 0~3) */
function pickPattern(glyph: string | null | undefined, override?: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  if (override != null) return override;
  if (!glyph) return 0;
  return (glyph.charCodeAt(0) % 4) as 0 | 1 | 2 | 3;
}

function PatternSvg({ kind, accent }: { kind: 0 | 1 | 2 | 3; accent: string }) {
  const a30 = accent + '4D'; // ~30%
  const a55 = accent + '8C'; // ~55%
  switch (kind) {
    case 0: // Concentric orbits
      return (
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full mix-blend-screen" aria-hidden>
          {[60, 110, 165, 220, 280].map((r, i) => (
            <circle key={r} cx="120" cy="280" r={r} fill="none" stroke={i < 2 ? a55 : a30} strokeWidth={i < 2 ? 1.4 : 0.8} />
          ))}
        </svg>
      );
    case 1: // Soft horizon ellipses
      return (
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full mix-blend-screen" aria-hidden>
          <ellipse cx="200" cy="260" rx="260" ry="50" fill={a55} opacity="0.7" />
          <ellipse cx="200" cy="290" rx="320" ry="32" fill={a30} opacity="0.6" />
          <ellipse cx="200" cy="330" rx="380" ry="22" fill={a30} opacity="0.4" />
        </svg>
      );
    case 2: // Diagonal light leak
      return (
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full mix-blend-screen" aria-hidden>
          <polygon points="0,80 220,0 400,140 400,200 60,360 0,320" fill={a30} />
          <polygon points="120,0 400,0 400,80 280,120" fill={a55} opacity="0.6" />
        </svg>
      );
    case 3: // Scattered constellation
      return (
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full mix-blend-screen" aria-hidden>
          {[
            [60, 90], [140, 70], [200, 130], [310, 90], [350, 220],
            [80, 250], [250, 280], [180, 340], [320, 330],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 2 ? 3 : 2} fill={a55} />
          ))}
          <path d="M60 90 L140 70 L200 130 L310 90" stroke={a30} strokeWidth="0.8" fill="none" />
          <path d="M80 250 L180 340 L320 330" stroke={a30} strokeWidth="0.8" fill="none" />
        </svg>
      );
  }
}

export default function AbstractCover({
  tone = 'violet',
  pattern,
  glyph = null,
  mini = false,
  className = '',
}: Props) {
  const t = TONES[tone];
  const kind = pickPattern(glyph, pattern);
  const showGlyph = !mini && isHangul(glyph);
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`}
      aria-hidden={!showGlyph}
      style={{
        background: `radial-gradient(ellipse at 30% 25%, ${t.top} 0%, ${t.mid} 60%, #050505 100%)`,
      }}
    >
      {/* Highlight (액센트 톤) */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 75% 80%, ${t.accent}55 0%, transparent 55%)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* 패턴 오버레이 */}
      <PatternSvg kind={kind} accent={t.accent} />
      {/* 그레인 (mini 제외) */}
      {!mini && (
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>\")",
          }}
        />
      )}
      {/* 한글 글리프 (mini 제외) */}
      {showGlyph && (
        <div className="absolute bottom-2 right-3 select-none text-white/95" style={{ fontWeight: 100, fontSize: 'clamp(48px, 30%, 104px)', textShadow: '0 4px 18px rgba(0,0,0,0.45)' }}>
          {glyph}
        </div>
      )}
    </div>
  );
}
