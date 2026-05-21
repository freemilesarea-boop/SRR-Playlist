type MarkProps = { size?: number; className?: string };

/**
 * 듣다 브랜드 마크 (보라색 D + 스피드 라인).
 * stroke 는 currentColor 사용 → 부모 text-* 색상으로 제어.
 */
export function LogoMark({ size = 24, className = '' }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M31 35 H61 C86 35 102 47 102 62 C102 78 86 90 61 90" />
        <path d="M31 54 H55" />
        <path d="M31 73 H52 C62 73 57 90 68 90" />
        <path d="M69 48 V79" />
      </g>
    </svg>
  );
}

/**
 * 흰색 라운드 타일 + 보라색 마크 (공식 로고 타일).
 * Sidebar / Footer / LoginPage 등 공통 브랜딩 위치에 사용.
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
