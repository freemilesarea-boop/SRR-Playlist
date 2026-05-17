/**
 * Alert — 안내/오류/경고/성공 박스 공통 컴포넌트.
 *
 * 라이트/다크 모드 양쪽에서 충분한 대비 보장. tone 별 색 토큰 통일.
 *
 *   tone='warning' : 노란 배경 + 진한 amber 텍스트 (어두운 글씨)
 *   tone='error'   : 빨간 배경 + 진한 red 텍스트
 *   tone='success' : 초록 배경 + 진한 emerald 텍스트
 *   tone='info'    : 파랑 배경 + 진한 sky 텍스트
 *
 * 사용 예:
 *   <Alert tone="warning">추천인 코드 미입력 시 ...</Alert>
 *   <Alert tone="error" title="조회 실패">{msg}</Alert>
 */
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AlertTone = 'warning' | 'error' | 'success' | 'info';

const tones: Record<AlertTone, { box: string; icon: LucideIcon; iconColor: string }> = {
  warning: {
    box: 'bg-amber-100 text-amber-900 ring-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30',
    icon: AlertTriangle,
    iconColor: 'text-amber-700 dark:text-amber-300',
  },
  error: {
    box: 'bg-red-100 text-red-900 ring-red-400/40 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-400/30',
    icon: AlertCircle,
    iconColor: 'text-red-700 dark:text-red-300',
  },
  success: {
    box: 'bg-emerald-100 text-emerald-900 ring-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-400/30',
    icon: CheckCircle2,
    iconColor: 'text-emerald-700 dark:text-emerald-300',
  },
  info: {
    box: 'bg-sky-100 text-sky-900 ring-sky-400/40 dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-400/30',
    icon: Info,
    iconColor: 'text-sky-700 dark:text-sky-300',
  },
};

interface Props {
  tone: AlertTone;
  children: React.ReactNode;
  title?: React.ReactNode;
  showIcon?: boolean;
  className?: string;
}

export default function Alert({
  tone,
  children,
  title,
  showIcon = true,
  className = '',
}: Props) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed ring-1 ${t.box} ${className}`}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    >
      {showIcon && <Icon size={14} className={`mt-0.5 shrink-0 ${t.iconColor}`} />}
      <div className="min-w-0 flex-1">
        {title && <p className="mb-0.5 font-bold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** 인라인 톤 클래스 — Alert 박스 안 쓰는 짧은 텍스트용 (예: 폼 validation message) */
export const inlineToneClass: Record<AlertTone, string> = {
  warning: 'text-amber-700 dark:text-amber-300',
  error: 'text-red-700 dark:text-red-300',
  success: 'text-emerald-700 dark:text-emerald-300',
  info: 'text-sky-700 dark:text-sky-300',
};
