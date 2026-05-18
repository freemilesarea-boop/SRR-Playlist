import { NavLink } from 'react-router-dom';
import { Home, BarChart3, Heart, Store, User, type LucideIcon } from 'lucide-react';

const items: Array<{ to: string; label: string; Icon: LucideIcon; end: boolean }> = [
  { to: '/', label: '홈', Icon: Home, end: true },
  { to: '/charts', label: '차트', Icon: BarChart3, end: false },
  { to: '/library', label: '보관함', Icon: Heart, end: false },
  { to: '/business', label: '매장', Icon: Store, end: false },
  { to: '/profile', label: '내 정보', Icon: User, end: false },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 pb-safe lg:hidden">
      <div className="mx-auto mb-2 max-w-3xl px-3 sm:mb-3 sm:px-4">
        <div className="glass-strong relative rounded-3xl px-1.5 py-1.5">
          {/* 상단 미세 하이라이트 */}
          <div className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-line/30 to-transparent" />
          <ul className="grid grid-cols-5 gap-0.5">
            {items.map(({ to, label, Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="block">
                  {({ isActive }) => (
                    <span
                      className={`relative flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] transition-[color,transform] duration-smooth ease-emphasized ${
                        isActive
                          ? 'text-accent'
                          : 'text-ink-mute hover:text-ink active:scale-[0.97]'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-0 rounded-2xl bg-accent/10 ring-1 ring-accent/20" />
                      )}
                      <Icon
                        size={20}
                        strokeWidth={isActive ? 2.25 : 2}
                        className="relative z-10"
                      />
                      <span className="relative z-10 leading-none">{label}</span>
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
