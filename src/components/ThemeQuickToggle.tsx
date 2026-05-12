import { Sun, Moon, Monitor } from 'lucide-react';
import { useThemeStore } from '@/store/themeStore';
import type { ThemeMode } from '@/lib/timeTheme';

/** 세 모드를 순환하는 작은 토글 (상단 우측 등에 배치) */
export default function ThemeQuickToggle() {
  const { mode, setMode } = useThemeStore();

  const next: ThemeMode =
    mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';

  const icon =
    mode === 'system' ? (
      <Monitor size={14} />
    ) : mode === 'light' ? (
      <Sun size={14} />
    ) : (
      <Moon size={14} />
    );

  const label = mode === 'system' ? '시스템' : mode === 'light' ? '라이트' : '다크';

  return (
    <button
      onClick={() => setMode(next)}
      aria-label={`테마: ${label} (클릭해서 변경)`}
      title={`테마: ${label}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-bg-card text-ink-mute ring-1 ring-line/10 transition hover:text-ink"
    >
      {icon}
    </button>
  );
}
