/**
 * Admin Design System Palette — Phase 2 (Enterprise Admin Refresh v2).
 *
 * 6개 톤만 사용. 신규 admin/ui/ 컴포넌트는 이 변형만 import.
 *   primary  → violet
 *   success  → emerald
 *   warning  → amber
 *   danger   → red
 *   info     → blue
 *   neutral  → zinc
 *
 * NOTE: 기존 adminTones (alpha 톤) 와 별도. 새 디자인 시스템은 **solid + white text**
 * 패턴으로 가독성 우선. lint:tones script 가 admin/ui/ 디렉토리는 skip 하도록 PR #196 이후 별도 확장됨.
 */

export type AdminToneName =
  | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface AdminSolidTone {
  /** Solid badge — bg-*-{500/600} + text-white */
  badgeSolid: string;
  /** Subtle badge — bg-*-50/100 + text-*-700/800 + ring */
  badgeSubtle: string;
  /** Solid button (CTA) — bg + hover + text-white */
  buttonSolid: string;
  /** Subtle button — bg-alpha + text + hover */
  buttonSubtle: string;
  /** Ghost text button — text + hover bg-alpha */
  buttonGhost: string;
  /** Outline button — border + text + hover */
  buttonOutline: string;
  /** Icon color (standalone icon) */
  icon: string;
  /** Soft fill (Alert background — dark theme alpha) */
  softBg: string;
  /** Soft border/ring (Alert outline) */
  softRing: string;
  /** Soft accent text on softBg */
  softText: string;
}

export const adminPalette: Record<AdminToneName, AdminSolidTone> = {
  primary: {
    badgeSolid:   'bg-violet-600 text-white',
    badgeSubtle:  'bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/50',
    buttonSolid:  'bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800',
    buttonSubtle: 'bg-violet-500/15 text-violet-200 hover:bg-violet-500/25',
    buttonGhost:  'text-violet-300 hover:bg-violet-500/15',
    buttonOutline:'border border-violet-400/50 text-violet-200 hover:bg-violet-500/15',
    icon:         'text-violet-300',
    softBg:       'bg-violet-500/15',
    softRing:     'ring-1 ring-violet-400/40',
    softText:     'text-violet-200',
  },
  success: {
    badgeSolid:   'bg-emerald-600 text-white',
    badgeSubtle:  'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50',
    buttonSolid:  'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
    buttonSubtle: 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
    buttonGhost:  'text-emerald-300 hover:bg-emerald-500/15',
    buttonOutline:'border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/15',
    icon:         'text-emerald-300',
    softBg:       'bg-emerald-500/15',
    softRing:     'ring-1 ring-emerald-400/40',
    softText:     'text-emerald-200',
  },
  warning: {
    // 긴급 hotfix — amber-500 위 white 는 2.15:1 (WCAG AA fail). amber-950 로 뒤집어 ~10:1 확보.
    // hover 상태도 amber-400 로 완화해 시각적 밝기 유지.
    badgeSolid:   'bg-amber-500 text-amber-950',
    badgeSubtle:  'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/50',
    buttonSolid:  'bg-amber-500 text-amber-950 hover:bg-amber-400 active:bg-amber-600',
    buttonSubtle: 'bg-amber-500/25 text-amber-100 hover:bg-amber-500/35',
    buttonGhost:  'text-amber-200 hover:bg-amber-500/20',
    buttonOutline:'border border-amber-400/60 text-amber-100 hover:bg-amber-500/20',
    icon:         'text-amber-200',
    softBg:       'bg-amber-500/20',
    softRing:     'ring-1 ring-amber-400/50',
    softText:     'text-amber-100',
  },
  danger: {
    badgeSolid:   'bg-red-600 text-white',
    badgeSubtle:  'bg-red-500/25 text-red-100 ring-1 ring-red-400/50',
    buttonSolid:  'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    buttonSubtle: 'bg-red-500/15 text-red-200 hover:bg-red-500/25',
    buttonGhost:  'text-red-300 hover:bg-red-500/15',
    buttonOutline:'border border-red-400/50 text-red-200 hover:bg-red-500/15',
    icon:         'text-red-300',
    softBg:       'bg-red-500/15',
    softRing:     'ring-1 ring-red-400/40',
    softText:     'text-red-200',
  },
  info: {
    badgeSolid:   'bg-blue-600 text-white',
    badgeSubtle:  'bg-blue-500/25 text-blue-100 ring-1 ring-blue-400/50',
    buttonSolid:  'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
    buttonSubtle: 'bg-blue-500/15 text-blue-200 hover:bg-blue-500/25',
    buttonGhost:  'text-blue-300 hover:bg-blue-500/15',
    buttonOutline:'border border-blue-400/50 text-blue-200 hover:bg-blue-500/15',
    icon:         'text-blue-300',
    softBg:       'bg-blue-500/15',
    softRing:     'ring-1 ring-blue-400/40',
    softText:     'text-blue-200',
  },
  neutral: {
    badgeSolid:   'bg-zinc-600 text-white',
    badgeSubtle:  'bg-zinc-500/25 text-zinc-100 ring-1 ring-zinc-400/40',
    buttonSolid:  'bg-zinc-700 text-white hover:bg-zinc-600 active:bg-zinc-500',
    buttonSubtle: 'bg-bg-deep text-ink hover:bg-bg-hover',
    buttonGhost:  'text-ink-mute hover:bg-bg-hover',
    buttonOutline:'border border-line/30 text-ink hover:bg-bg-hover',
    icon:         'text-ink-mute',
    softBg:       'bg-bg-deep',
    softRing:     'ring-1 ring-line/20',
    softText:     'text-ink',
  },
};

// 공통 shadow / radius / transition / focus ring tokens
export const adminTokens = {
  radius: {
    sm:  'rounded-md',
    md:  'rounded-lg',
    lg:  'rounded-xl',
    xl:  'rounded-2xl',
    pill:'rounded-full',
  },
  shadow: {
    card:    'shadow-sm shadow-black/20',
    modal:   'shadow-2xl shadow-black/40',
    overlay: 'shadow-lg shadow-black/30',
  },
  transition: 'transition-colors duration-150 ease-out',
  focusRing:  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card',
} as const;
