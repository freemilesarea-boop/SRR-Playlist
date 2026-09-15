import { lazy, Suspense, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { isNativeApp } from '@/lib/native';
import { bottomNavItems, type NavItem } from '@/lib/appNav';
import { isStoreAccount } from '@/lib/nativeLanding';
import { getRecentBrands } from '@/lib/brandSession';
import { NAV_ICONS } from '@/components/navIcons';

// 전체 메뉴는 열기 전까지 필요 없다 — 역할 조회까지 딸려오므로 지연 로드.
const NativeMoreSheet = lazy(() => import('@/components/native/NativeMoreSheet'));

function hasBoundBrand(): boolean {
  try {
    return getRecentBrands().length > 0;
  } catch {
    return false;
  }
}

/** 탭 하나의 안쪽 모양. 링크와 버튼이 같은 모양을 쓰도록 분리. */
function TabInner({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.icon];
  return (
    <span
      className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] transition-[color,transform] duration-smooth ease-emphasized ${
        active ? 'text-accent' : 'text-ink-mute hover:text-ink active:scale-[0.97]'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {active && (
        <span className="absolute inset-0 rounded-2xl bg-accent/10 ring-1 ring-accent/20" />
      )}
      <Icon size={20} strokeWidth={active ? 2.25 : 2} className="relative z-10" aria-hidden="true" />
      <span className="relative z-10 leading-none">{item.label}</span>
    </span>
  );
}

export default function BottomNav() {
  const profile = useAuthStore((s) => s.profile);
  const [moreOpen, setMoreOpen] = useState(false);

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
    <>
      {/* X6.40: aria-label + pl-safe/pr-safe 추가 (노치 좌우 잘림 방지)
          app-bottom-nav — 앱에서는 index.css 가 lg:hidden 을 되돌려 항상 띄운다. */}
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
              {items.map((item) => (
                <li key={item.to}>
                  {item.action === 'more' ? (
                    <button
                      type="button"
                      onClick={() => setMoreOpen(true)}
                      className="block w-full"
                      aria-label={item.label}
                      aria-haspopup="dialog"
                      aria-expanded={moreOpen}
                    >
                      <TabInner item={item} active={moreOpen} />
                    </button>
                  ) : (
                    <NavLink to={item.to} end={item.end} className="block" aria-label={item.label}>
                      {({ isActive }) => <TabInner item={item} active={isActive} />}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      {moreOpen && (
        <Suspense fallback={null}>
          <NativeMoreSheet onClose={() => setMoreOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
