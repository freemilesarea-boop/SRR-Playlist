type MarkProps = { size?: number; className?: string };

/**
 * DEUDDA 듣다 브랜드 마크 — SIDE A (Logo Print spec 정확 일치)
 *
 * Spec (Construction Sheet 05/14):
 *   GRID         10 × 10 units
 *   CANVAS       220 × 200 u
 *   D RADIUS     85 u (8.5 grid)
 *   STROKE       16 u (1 grid unit) · CAP Round · JOIN Round
 *   PILL EXT.    6.5 u — top/bottom pill 길이 (65 user units)
 *   PILL (MID)   3.6 u — middle pill 길이 (36 user units, 가장 짧음)
 *   PILL GAP     2.6 u — pill 사이 수직 gap (26 user units, edge-to-edge)
 *   CENTER       100, 100 — D 원의 중심
 *   OPTICAL BAL. +2 u right (반영됨)
 *
 *  - D 브래킷: (100,100) 중심 반경 85 의 우측 반원 (M 100,15 → A 85,85 → 100,185)
 *  - 3 pills: top/bottom 길이 65u, middle 길이 36u, 모두 우측 끝 x=92 (round cap 으로 D spine x=100 접촉)
 *  - 수직 위치: top y=58, mid y=100, bottom y=142 (gap 26u edge-to-edge)
 *
 * stroke 는 currentColor — 부모 text-* 색상으로 3 변형 모두 지원.
 * MIN SIZE: 24px (digital) / 12mm (print).
 */
export function LogoMark({ size = 24, className = '' }: MarkProps) {
  return (
    <svg
      width={size}
      height={(size * 200) / 220}
      viewBox="0 0 220 200"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* D bracket — 중심 (100,100), 반경 85, 우측 반원 (open left) */}
        <path d="M 100 15 A 85 85 0 0 1 100 185" />
        {/* Top pill — PILL EXT 65u, 우측 끝 x=92, y=58 */}
        <path d="M 27 58 H 92" />
        {/* Middle pill — PILL (MID) 36u, 우측 끝 x=92, y=100 (가장 짧음) */}
        <path d="M 56 100 H 92" />
        {/* Bottom pill — PILL EXT 65u, 우측 끝 x=92, y=142 */}
        <path d="M 27 142 H 92" />
      </g>
    </svg>
  );
}

/**
 * 흰색 라운드 타일 + 보라색 마크 — Footer / LoginPage 등 라이트 컨텍스트용.
 * Sidebar 같은 dark "On Ink" 컨텍스트에서는 LogoMark 를 직접 text-white 로 쓰는 게 가이드 준수.
 */
export default function Logo({ size = 36, className = '' }: MarkProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size, boxShadow: '0 6px 20px rgb(var(--color-accent) / 0.35)' }}
    >
      <LogoMark size={Math.round(size * 0.82)} className="text-accent" />
    </span>
  );
}
