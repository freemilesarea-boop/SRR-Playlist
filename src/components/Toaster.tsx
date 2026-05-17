/**
 * Toaster — 사이트 전역 toast.
 *
 * 디자인 원칙:
 *  - 라이트: 흰 배경 + 진한 텍스트 + 컬러 굵은 border (2px)
 *  - 다크  : zinc-950 + 흰 텍스트 + 컬러 굵은 border
 *  - 강한 그림자(shadow-2xl) + 컬러 아이콘 + 라벨(오류/경고/완료/안내)
 *  - 위치  : 상단 중앙 고정. z-[200] 으로 모든 모달 위
 *  - 너비  : 모바일은 화면 패딩 고려, 데스크탑은 max-w-md
 *  - 수동 닫기 가능 (X 버튼)
 */
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useToastStore, type ToastType } from '@/store/toastStore';

const VARIANTS: Record<
  ToastType,
  {
    box: string;
    iconColor: string;
    labelColor: string;
    icon: LucideIcon;
    role: 'alert' | 'status';
    label: string;
  }
> = {
  error: {
    box: 'bg-white text-red-900 border-red-500 dark:bg-zinc-950 dark:text-white dark:border-red-500',
    iconColor: 'text-red-600 dark:text-red-400',
    labelColor: 'text-red-700 dark:text-red-300',
    icon: AlertCircle,
    role: 'alert',
    label: '오류',
  },
  warning: {
    box: 'bg-white text-amber-950 border-amber-500 dark:bg-zinc-950 dark:text-white dark:border-amber-500',
    iconColor: 'text-amber-600 dark:text-amber-400',
    labelColor: 'text-amber-700 dark:text-amber-300',
    icon: AlertTriangle,
    role: 'alert',
    label: '경고',
  },
  success: {
    box: 'bg-white text-emerald-900 border-emerald-500 dark:bg-zinc-950 dark:text-white dark:border-emerald-500',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    labelColor: 'text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
    role: 'status',
    label: '완료',
  },
  info: {
    box: 'bg-white text-sky-900 border-sky-500 dark:bg-zinc-950 dark:text-white dark:border-sky-500',
    iconColor: 'text-sky-600 dark:text-sky-400',
    labelColor: 'text-sky-700 dark:text-sky-300',
    icon: Info,
    role: 'status',
    label: '안내',
  },
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex flex-col items-center gap-2 px-3 pt-safe">
      {toasts.map((t) => {
        const v = VARIANTS[t.type];
        const Icon = v.icon;
        return (
          <div
            key={t.id}
            role={v.role}
            aria-live={v.role === 'alert' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex w-[calc(100%-1.5rem)] max-w-md items-start gap-2.5 rounded-xl border-2 px-4 py-3 text-sm font-medium leading-relaxed shadow-2xl ${v.box} animate-fade-in`}
          >
            <Icon size={18} className={`mt-0.5 shrink-0 ${v.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className={`mb-0.5 text-[11px] font-bold uppercase tracking-wider ${v.labelColor}`}>
                {v.label}
              </p>
              <p className="break-words">{t.message}</p>
            </div>
            <button
              onClick={() => remove(t.id)}
              aria-label="닫기"
              className={`-mr-1 -mt-1 shrink-0 rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10 ${v.iconColor}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
