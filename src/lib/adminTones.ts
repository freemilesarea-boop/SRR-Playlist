/**
 * Admin UI standardized status tones — dark theme (admin layout).
 *
 * 모든 status badge / button / 안내 텍스트에서 재사용하여 일관된 색상 대비 유지.
 * dark bg (#0a0a0a, bg-bg-card) 위에서 WCAG AA contrast >= 4.5 기준.
 *
 * 사용 예:
 *   <span className={adminTones.success.badge}>지급완료</span>
 *   <button className={adminTones.danger.buttonSolid}>취소</button>
 *
 * 신규 admin 컴포넌트는 반드시 이 객체에서 골라쓰기 (직접 text-emerald-500 등 사용 금지).
 */

interface AdminToneSet {
  /** 상태 칩 — bg + text + ring */
  badge: string;
  /** 본문 텍스트 (높은 대비) */
  text: string;
  /** 보조 텍스트 (약간 낮은 대비) */
  textMute: string;
  /** 아이콘 색상 */
  icon: string;
  /** 강조 버튼 (CTA, 확정 액션) */
  buttonSolid: string;
  /** 보조 버튼 (취소, 보조 액션) */
  buttonGhost: string;
}

export const adminTones: Record<
  'success' | 'warning' | 'danger' | 'info' | 'neutral',
  AdminToneSet
> = {
  success: {
    // 지급완료 / 활성 / 포함 / 승인됨 등 긍정 상태
    badge:       'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50',
    text:        'text-emerald-200',
    textMute:    'text-emerald-300',
    icon:        'text-emerald-300',
    buttonSolid: 'bg-emerald-500/30 text-emerald-100 hover:bg-emerald-500/40',
    buttonGhost: 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
  },
  warning: {
    // 대기 / 검토중 / 미등록 / 주의
    badge:       'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/50',
    text:        'text-amber-200',
    textMute:    'text-amber-300',
    icon:        'text-amber-300',
    buttonSolid: 'bg-amber-500/30 text-amber-100 hover:bg-amber-500/40',
    buttonGhost: 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
  },
  danger: {
    // 취소 / 반려 / 정지 / 위험
    badge:       'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/50',
    text:        'text-rose-200',
    textMute:    'text-rose-300',
    icon:        'text-rose-300',
    buttonSolid: 'bg-rose-500/30 text-rose-100 hover:bg-rose-500/40',
    buttonGhost: 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
  },
  info: {
    // 안내 / approved (paid 직전) / 정보
    badge:       'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50',
    text:        'text-sky-200',
    textMute:    'text-sky-300',
    icon:        'text-sky-300',
    buttonSolid: 'bg-sky-500/30 text-sky-100 hover:bg-sky-500/40',
    buttonGhost: 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25',
  },
  neutral: {
    // unregistered / 비활성 / placeholder
    badge:       'bg-ink/15 text-ink ring-1 ring-line/20',
    text:        'text-ink',
    textMute:    'text-ink-mute',
    icon:        'text-ink-mute',
    buttonSolid: 'bg-bg-deep text-ink hover:bg-bg-hover',
    buttonGhost: 'bg-bg-deep text-ink-mute hover:bg-bg-hover',
  },
};

export type AdminTone = keyof typeof adminTones;
