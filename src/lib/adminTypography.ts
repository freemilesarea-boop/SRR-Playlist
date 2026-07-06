/**
 * Admin UI Typography tokens — dark theme 기준.
 *
 * 사용 예:
 *   <h1 className={adminTypography.heading.h1}>본사 계정 관리</h1>
 *   <p className={adminTypography.description}>설명 문구</p>
 *
 * 직접 text-slate-500 dark:text-zinc-300 / text-slate-500 dark:text-gray-400 등 hardcode 금지.
 * 신규 admin 컴포넌트는 이 객체에서 골라 쓰기.
 */

export const adminTypography = {
  heading: {
    h1:    'text-base font-extrabold text-ink tracking-tight',
    h2:    'text-sm font-bold text-ink',
    h3:    'text-xs font-bold uppercase tracking-wider text-ink',
  },
  body:        'text-xs text-ink',                  // 본문
  bodyStrong:  'text-xs font-semibold text-ink',
  description: 'text-[11px] text-ink-mute',         // 보조 설명
  muted:       'text-[11px] text-ink-mute',         // 일반 muted
  caption:     'text-[10px] uppercase tracking-wider text-ink-dim',
  hint:        'text-[10px] text-ink-dim',          // 작은 도움말
  number: {
    large:  'text-2xl font-extrabold text-ink tabular-nums',
    medium: 'text-lg font-bold text-ink tabular-nums',
    small:  'text-sm font-semibold text-ink tabular-nums',
  },
  mono: {
    small:  'font-mono text-[11px] text-ink-mute',
    medium: 'font-mono text-xs text-ink',
  },
} as const;
