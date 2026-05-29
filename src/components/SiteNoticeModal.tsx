/**
 * SiteNoticeModal — 사이트 공지 모달.
 *
 * 다중 공지 지원: site_notices 테이블의 활성 공지를 우선순위 순으로 한 번에 노출.
 *   - 각 공지마다 "오늘 하루 보지 않기" 개별 localStorage 키
 *   - 우선순위가 높은 순서대로 한 개씩 표시 (사용자가 닫으면 다음 표시)
 *
 * legacy 호환: site_settings.notice_enabled/title/body 도 첫 진입 시 active 공지로 변환 표시.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Bell } from 'lucide-react';
import { fetchSiteSettings, type SiteSettings } from '@/lib/siteSettingsApi';
import { listActiveSiteNotices, type ActiveSiteNotice } from '@/lib/siteNoticesApi';

const HIDE_PREFIX = 'site_notice_hide_until_';
const LEGACY_KEY = 'site_notice_hide_until';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isHiddenToday(noticeId: string): boolean {
  try {
    return localStorage.getItem(HIDE_PREFIX + noticeId) === todayStr();
  } catch { return false; }
}

function hideToday(noticeId: string) {
  try { localStorage.setItem(HIDE_PREFIX + noticeId, todayStr()); } catch { /* ignore */ }
}

function isLegacyHiddenToday(): boolean {
  try { return localStorage.getItem(LEGACY_KEY) === todayStr(); } catch { return false; }
}

function hideLegacyToday() {
  try { localStorage.setItem(LEGACY_KEY, todayStr()); } catch { /* ignore */ }
}

interface DisplayNotice {
  id: string;
  title: string;
  body: string;
  dismissible: boolean;
  isLegacy: boolean;
}

export default function SiteNoticeModal() {
  const [notices, setNotices] = useState<DisplayNotice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hideTodayChecked, setHideTodayChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [multi, legacy] = await Promise.all([
        listActiveSiteNotices(),
        fetchSiteSettings(),
      ]);
      if (!mounted) return;
      const list: DisplayNotice[] = [];

      // 신규 다중 공지 (이미 audience 필터링됨, location='home' 또는 'all_pages' 만 노출)
      const filteredMulti = (multi as ActiveSiteNotice[])
        .filter((n) => n.display_location === 'home' || n.display_location === 'all_pages')
        .filter((n) => !isHiddenToday(n.id));
      filteredMulti.forEach((n) => list.push({
        id: n.id, title: n.title, body: n.body, dismissible: n.dismissible, isLegacy: false,
      }));

      // legacy 단일 공지 (site_settings) — 활성이고 오늘 안 본 경우만
      const s = legacy as SiteSettings | null;
      if (s && s.notice_enabled && !isLegacyHiddenToday()) {
        list.push({
          id: 'legacy', title: s.notice_title, body: s.notice_body, dismissible: true, isLegacy: true,
        });
      }

      setNotices(list);
      setLoaded(true);
    })();
    return () => { mounted = false; };
  }, []);

  const current = useMemo(() => notices[currentIdx] ?? null, [notices, currentIdx]);

  function next() {
    if (!current) return;
    if (hideTodayChecked && current.dismissible) {
      if (current.isLegacy) hideLegacyToday();
      else hideToday(current.id);
    }
    setHideTodayChecked(false);
    setCurrentIdx((i) => i + 1);
  }

  if (!loaded || !current) return null;

  const totalActive = notices.length;
  const positionLabel = totalActive > 1 ? `${currentIdx + 1}/${totalActive}` : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={current.dismissible ? next : undefined}
      role="dialog" aria-modal="true" aria-labelledby="site-notice-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl bg-bg-card ring-1 ring-line/20 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-accent" />
            <h2 id="site-notice-title" className="text-sm font-bold tracking-tight">
              {current.title}
            </h2>
            {positionLabel && (
              <span className="ml-1 rounded-full bg-bg-soft px-1.5 py-0.5 text-[9px] font-bold text-ink-mute">
                {positionLabel}
              </span>
            )}
          </div>
          {current.dismissible && (
            <button onClick={next} aria-label="닫기" className="rounded-lg p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink">
              <X size={16} />
            </button>
          )}
        </header>

        <div className="px-5 py-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{current.body}</p>
        </div>

        {current.dismissible && (
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
              onClick={next}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/90"
            >
              {currentIdx + 1 < totalActive ? '다음' : '확인했습니다'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
