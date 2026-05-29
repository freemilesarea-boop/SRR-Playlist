/**
 * SiteNoticeModal — 사이트 공지 모달 (메인 페이지 진입 시 표시).
 *
 * 표시 조건:
 *   - site_settings.notice_enabled = true
 *   - localStorage 에 "오늘 하루 보지 않기" 키가 오늘 날짜가 아닐 때
 *
 * 닫기 옵션:
 *   - 확인 버튼 → 일반 닫기
 *   - 체크박스 → 오늘 하루 더 안 보이기
 */
import { useEffect, useState } from 'react';
import { X, Bell } from 'lucide-react';
import { fetchSiteSettings, type SiteSettings } from '@/lib/siteSettingsApi';

const HIDE_KEY = 'site_notice_hide_until';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isHiddenToday(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === todayStr();
  } catch {
    return false;
  }
}

function hideToday() {
  try {
    localStorage.setItem(HIDE_KEY, todayStr());
  } catch { /* private mode 등 무시 */ }
}

export default function SiteNoticeModal() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [hideTodayChecked, setHideTodayChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await fetchSiteSettings();
      if (!mounted || !s) return;
      setSettings(s);
      if (s.notice_enabled && !isHiddenToday()) {
        setOpen(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function close() {
    if (hideTodayChecked) hideToday();
    setOpen(false);
  }

  if (!open || !settings) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-notice-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl bg-bg-card ring-1 ring-line/20 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-accent" />
            <h2 id="site-notice-title" className="text-sm font-bold tracking-tight">
              {settings.notice_title}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="닫기"
            className="rounded-lg p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">
            {settings.notice_body}
          </p>
        </div>

        <footer className="flex flex-col gap-3 border-t border-line/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs text-ink-mute">
            <input
              type="checkbox"
              checked={hideTodayChecked}
              onChange={(e) => setHideTodayChecked(e.target.checked)}
              className="h-4 w-4 rounded border-line/30 bg-bg-soft accent-accent"
            />
            오늘 하루 보지 않기
          </label>
          <button
            onClick={close}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/90"
          >
            확인했습니다
          </button>
        </footer>
      </div>
    </div>
  );
}
