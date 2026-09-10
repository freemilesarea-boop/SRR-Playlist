import { NavLink } from 'react-router-dom';
import { Home, BarChart3, Heart, Store, User, Search, Tag, ListMusic, CreditCard, Wand2, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { isNativeApp } from '@/lib/native';
import { bottomNavItems, type NavIconKey } from '@/lib/appNav';
import { isStoreAccount } from '@/lib/nativeLanding';
import { getRecentBrands } from '@/lib/brandSession';

const ICONS: Record<NavIconKey, LucideIcon> = {
  home: Home,
  search: Search,
  chart: BarChart3,
  library: Heart,
  playlists: ListMusic,
  pricing: CreditCard,
  store: Store,
  brand: Tag,
  profile: User,
  studio: Wand2,
};

function hasBoundBrand(): boolean {
  try {
    return getRecentBrands().length > 0;
  } catch {
    return false;
  }
}

export default function BottomNav() {
  const profile = useAuthStore((s) => s.profile);
  const items = bottomNavItems({
    native: isNativeApp(),
    isCurator: profile?.is_curator ?? false,
    storeAccount: isStoreAccount({
      accountType: profile?.account_type ?? null,
      membershipTier: profile?.membership_tier ?? null,
      subscriptionType: profile?.subscription_type ?? null,
    }),
    hasBrand: hasBoundBrand(),
  });

  return (
    // X6.40: aria-label + pl-safe/pr-safe 추가 (노치 좌우 잘림 방지)
    // app-bottom-nav — 앱에서는 index.css 가 lg:hidden 을 되돌려 항상 띄운다.
    <nav
      className="app-bottom-nav fixed inset-x-0 bottom-0 z-30 pb-safe pl-safe pr-safe lg:hidden"
      aria-label="주요 메뉴"
    >
      <div className="mx-auto mb-2 max-w-3xl px-3 sm:mb-3 sm:px-4">
        <div className="glass-strong relative rounded-3xl px-1.5 py-1.5">
          {/* 상단 미세 하이라이트 */}
          <div className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-line/30 to-transparent" />
          <ul
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
          >
            {items.map(({ to, label, icon, end }) => {
              const Icon = ICONS[icon];
              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className="block"
                    aria-label={label}
                  >
                    {({ isActive }) => (
                      <span
                        className={`relative flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] transition-[color,transform] duration-smooth ease-emphasized ${
                          isActive
                            ? 'text-accent'
                            : 'text-ink-mute hover:text-ink active:scale-[0.97]'
                        }`}
                        // X6.40: 활성 탭 명시적 aria-current — 스크린리더 안내
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {isActive && (
                          <span className="absolute inset-0 rounded-2xl bg-accent/10 ring-1 ring-accent/20" />
                        )}
                        <Icon
                          size={20}
                          strokeWidth={isActive ? 2.25 : 2}
                          className="relative z-10"
                          aria-hidden="true"
                        />
                        <span className="relative z-10 leading-none">{label}</span>
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
