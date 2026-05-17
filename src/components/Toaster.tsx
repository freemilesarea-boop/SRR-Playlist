import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useToastStore } from '@/store/toastStore';

const styles: Record<string, string> = {
  info: 'bg-bg-card text-ink ring-line/15',
  success:
    'bg-emerald-100 text-emerald-900 ring-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-50 dark:ring-emerald-400/30',
  error:
    'bg-red-100 text-red-900 ring-red-400/40 dark:bg-red-500/15 dark:text-red-50 dark:ring-red-400/30',
};

const Icons = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 pt-safe">
      {toasts.map((t) => {
        const Icon = Icons[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs shadow-2xl ring-1 backdrop-blur ${styles[t.type]} animate-fade-in`}
            role="status"
          >
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
