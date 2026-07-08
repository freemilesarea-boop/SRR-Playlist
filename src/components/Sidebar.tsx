import { Link, NavLink } from 'react-router-dom';
import { Home, Search, BarChart3, Heart, Store, User, Wand2, ListMusic, Tag, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import BrandLogo from '@/components/BrandLogo';
import SidebarLibrarySection from '@/components/SidebarLibrarySection';

const items: Array<{ to: string; label: string; Icon: LucideIcon; end: boolean }> = [
  { to: '/', label: '홈', Icon: Home, end: true },
  { to: '/search', label: '검색', Icon: Search, end: false },
  { to: '/charts', label: '차트', Icon: BarChart3, end: false },
  { to: '/library', label: '보관함', Icon: Heart, end: false },
  { to: '/my/playlists', label: '내 플레이리스트', Icon: ListMusic, end: false },
  { to: '/business', label: '매장', Icon: Store, end: false },
  { to: '/brand', label: '브랜드', Icon: Tag, end: false },
  { to: '/profile', label: '내 정보', Icon: User, end: false },
];

/** mono 2자리 인덱스 — DEUDDA Product spec p02/p07 sidebar 의 NAV 01/02/.. 표기 */
function navNo(i: number): string {
  return String(i + 1).padStart(2, '0');
}

export default function Sidebar() {
  const isCurator = useAuthStore((s) => s.profile?.is_curator ?? false);
  const navItems = isCurator
    ? [...items, { to: '/curator/studio', label: '스튜디오', Icon: Wand2, end: false }]
    : items;
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/10 bg-bg/85 backdrop-blur-xl pt-safe lg:flex">
      {/* Brand — DEUDDA Product spec: 로고 마크 + "DEUDDA." (영문 wordmark, period 포함) */}
      <div className="px-5 pt-5 pb-4">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <BrandLogo size={28} className="transition-transform group-hover:scale-105" fallbackColorClass="text-white" />
          <span className="text-[17px] font-extrabold tracking-tight text-black">DEUDDA<span className="text-accent">.</span></span>
        </Link>
      </div>

      {/* NAVIGATE eyebrow — DEUDDA spec mono caps */}
      <p className="px-5 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">
        Navigate
      </p>

      <div className="flex-1 overflow-y-auto">
        <nav className="space-y-0.5 px-3 py-1">
          {navItems.map(({ to, label, Icon, end }, idx) => (
            <NavLink key={to} to={to} end={end}>
              {({ isActive }) => (
                <span
                  className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-smooth ${
                    isActive
                      ? 'bg-accent/15 text-accent'
                      : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-accent" />
                  )}
                  <Icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                  <span className="flex-1">{label}</span>
                  <span className={`font-mono text-[10px] tracking-wider ${isActive ? 'text-accent' : 'text-ink-dim'}`}>
                    {navNo(idx)}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* 내 라이브러리 — 좋아요한 곡 + 팔로우 플리 (사용자 어디서든 빠른 접근) */}
        <SidebarLibrarySection />
      </div>

      <div className="border-t border-line/10 px-5 py-4 font-mono text-[10px] leading-relaxed text-ink-dim">
        <p>DEUDDA · v0.2 PRO</p>
        <p className="mt-0.5 text-ink-dim/70">© Louver Studio · 2026</p>
      </div>
    </aside>
  );
}
