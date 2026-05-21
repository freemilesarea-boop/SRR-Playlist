import { Link, NavLink } from 'react-router-dom';
import { Home, Search, BarChart3, Heart, Store, User, Wand2, ListMusic, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import Logo from '@/components/Logo';

const items: Array<{ to: string; label: string; Icon: LucideIcon; end: boolean }> = [
  { to: '/', label: '홈', Icon: Home, end: true },
  { to: '/search', label: '검색', Icon: Search, end: false },
  { to: '/charts', label: '차트', Icon: BarChart3, end: false },
  { to: '/library', label: '보관함', Icon: Heart, end: false },
  { to: '/my/playlists', label: '내 플레이리스트', Icon: ListMusic, end: false },
  { to: '/business', label: '매장', Icon: Store, end: false },
  { to: '/profile', label: '내 정보', Icon: User, end: false },
];

export default function Sidebar() {
  const isCurator = useAuthStore((s) => s.profile?.is_curator ?? false);
  const navItems = isCurator
    ? [...items, { to: '/curator/studio', label: '스튜디오', Icon: Wand2, end: false }]
    : items;
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/10 bg-bg-soft/70 backdrop-blur-xl pt-safe lg:flex">
      <div className="px-5 pt-5 pb-3">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <Logo size={36} className="transition-transform group-hover:scale-105" />
          <span className="text-base font-extrabold tracking-tight">듣다</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {navItems.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            {({ isActive }) => (
              <span
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-smooth ${
                  isActive
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/25'
                    : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                <span>{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line/10 px-5 py-4 text-[10px] leading-relaxed text-ink-dim">
        <p>듣다 · v0.1.0 MVP</p>
        <p className="mt-1 text-ink-dim/70">© 루베르 콘텐츠 스튜디오</p>
      </div>
    </aside>
  );
}
