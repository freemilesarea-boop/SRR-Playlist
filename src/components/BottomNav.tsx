import { NavLink } from 'react-router-dom';
import { Home, BarChart3, Heart, Store, User } from 'lucide-react';

const items = [
  { to: '/', label: '홈', Icon: Home, end: true },
  { to: '/charts', label: '차트', Icon: BarChart3, end: false },
  { to: '/library', label: '보관함', Icon: Heart, end: false },
  { to: '/business', label: '매장', Icon: Store, end: false },
  { to: '/profile', label: '내 정보', Icon: User, end: false },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/10 bg-bg/90 pb-safe backdrop-blur-xl">
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {items.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] transition ${
                  isActive ? 'text-accent' : 'text-ink-mute hover:text-ink'
                }`
              }
            >
              <Icon size={20} strokeWidth={2} />
              <span className="leading-none">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
