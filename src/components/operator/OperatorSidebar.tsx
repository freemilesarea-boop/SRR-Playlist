import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Store, Building2, Music, Activity, Wallet, Mic2, BarChart3, Sparkles,
  Settings, KeyRound, ChevronDown, LogOut, ArrowLeft, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  filterNavSections, activeNavItemId, type OperatorNavSection, type OperatorAccessContext,
} from '@/lib/operatorNavigation';

/** 설정에 저장된 문자열 아이콘 이름 → lucide 컴포넌트. 미매핑은 안전한 기본값. */
const ICONS: Record<string, LucideIcon> = {
  Home, Store, Building2, Music, Activity, Wallet, Mic2, BarChart3, Sparkles, Settings, KeyRound,
};
function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Home;
}

const ROLE_BADGES: Array<{ key: keyof OperatorAccessContext; label: string }> = [
  { key: 'isSuperAdmin', label: '슈퍼관리자' },
  { key: 'isPlatformAdmin', label: '관리자' },
  { key: 'isHq', label: '본사' },
];

export interface OperatorSidebarProps {
  ctx: OperatorAccessContext;
  /** 링크 클릭 시 호출 (모바일 드로어 닫기 등). */
  onNavigate?: () => void;
}

/**
 * 운영자 셸 사이드바 — 역할 인지(role-aware) 네비게이션 콘텐츠.
 * 위치/반응형 처리는 OperatorLayout 이 담당하고, 이 컴포넌트는 순수 콘텐츠만 렌더한다.
 */
export default function OperatorSidebar({ ctx, onNavigate }: OperatorSidebarProps) {
  const location = useLocation();
  const signOut = useAuthStore((s) => s.signOut);

  const sections = useMemo<OperatorNavSection[]>(() => filterNavSections(ctx), [ctx]);
  const activeId = useMemo(
    () => activeNavItemId(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const activeSectionId = useMemo(
    () => sections.find((s) => s.items.some((it) => it.id === activeId))?.id ?? sections[0]?.id ?? null,
    [sections, activeId],
  );

  // 접힘 상태: 기본은 활성 섹션만 펼침. 사용자가 토글하면 override.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (sectionId: string) => {
    if (sectionId in collapsed) return !collapsed[sectionId];
    return sectionId === activeSectionId; // 기본: 활성 섹션만 열림
  };
  const toggle = (sectionId: string) =>
    setCollapsed((prev) => ({ ...prev, [sectionId]: sectionId in prev ? !prev[sectionId] : sectionId !== activeSectionId ? false : true }));

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Brand / title */}
      <div className="px-5 pb-4 pt-5">
        <Link to="/ops" onClick={onNavigate} className="group inline-flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Home size={16} strokeWidth={2.4} />
          </span>
          <span className="text-[15px] font-extrabold tracking-tight text-ink">운영 콘솔</span>
        </Link>
        <div className="mt-2 flex flex-wrap gap-1">
          {ROLE_BADGES.filter((b) => ctx[b.key]).map((b) => (
            <span key={b.label} className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] font-semibold text-ink-mute">
              {b.label}
            </span>
          ))}
        </div>
      </div>

      <p className="px-5 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">Navigate</p>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="운영 메뉴">
        {sections.map((section) => {
          const SectionIcon = iconFor(section.icon);
          const open = isOpen(section.id);
          const panelId = `ops-section-${section.id}`;
          return (
            <div key={section.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={open}
                aria-controls={panelId}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-bold text-ink-mute transition-colors hover:bg-bg-hover hover:text-ink"
              >
                <SectionIcon size={16} strokeWidth={2} />
                <span className="flex-1">{section.label}</span>
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <ul id={panelId} className="mb-1 mt-0.5 space-y-0.5 pl-2">
                  {section.items.map((item) => {
                    const active = item.id === activeId;
                    return (
                      <li key={item.id}>
                        <Link
                          to={item.href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          title={item.helpText ?? item.description}
                          className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                            active
                              ? 'bg-accent/15 font-semibold text-accent'
                              : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
                          }`}
                        >
                          {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-accent" />}
                          <span className="flex-1 truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — 소비자 화면으로 / 로그아웃 */}
      <div className="mt-auto space-y-0.5 border-t border-line/10 px-3 py-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-mute transition-colors hover:bg-bg-hover hover:text-ink"
        >
          <ArrowLeft size={16} strokeWidth={2} />
          <span>소비자 화면으로</span>
        </Link>
        <button
          type="button"
          onClick={() => { void signOut(); }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-mute transition-colors hover:bg-bg-hover hover:text-ink"
        >
          <LogOut size={16} strokeWidth={2} />
          <span>로그아웃</span>
        </button>
      </div>
    </div>
  );
}
