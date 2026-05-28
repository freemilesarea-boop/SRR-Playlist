type MarkProps = { size?: number; className?: string };

/**
 * DEUDDA 듣다 브랜드 마크 (Logo Print v0.2 — 2026)
 *
 * 구성 (canvas 220×200, stroke 16u, round caps, 10×10 grid):
 *  - 반-D 브래킷: 수직 spine + 오른쪽 반원호
 *  - 3개 좌측 horizontal speed line (사운드/모션 시그널)
 *
 * stroke 는 currentColor — 부모 text-* 색상으로 제어:
 *  - On Ink (검정 배경) → text-white
 *  - On Bone (크림 배경) → text-ink (또는 black)
 *  - On Sonic Violet (#7B3FF2 배경) → text-white
 *
 * MIN SIZE: 24px (digital) / 12mm (print) — 가이드 준수.
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
        {/* D bracket: vertical spine */}
        <path d="M120 32 V168" />
        {/* D bracket: right semicircular arc (반원호, 반경 68) */}
        <path d="M120 32 A 68 68 0 0 1 120 168" />
        {/* 3 speed lines — 좌측에서 spine 으로 진입, round-cap stub */}
        <path d="M52 72 H108" />
        <path d="M28 100 H108" />
        <path d="M52 128 H108" />
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
