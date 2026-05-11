import { NavLink } from 'react-router-dom';
import { Home, Heart, Store, User } from 'lucide-react';

const items = [
  { to: '/', label: '홈', Icon: Home, end: true },
  { to: '/library', label: '보관함', Icon: Heart, end: false },
  { to: '/business', label: '사업자', Icon: Store, end: false },
  { to: '/profile', label: '내 정보', Icon: User, end: false },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-bg/90 pb-safe backdrop-blur-xl">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-xs transition ${
                  isActive ? 'text-accent' : 'text-ink-mute hover:text-ink'
                }`
              }
            >
              <Icon size={20} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
