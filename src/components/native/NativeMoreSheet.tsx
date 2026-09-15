/**
 * NativeMoreSheet — 앱 전체 메뉴.
 *
 * 앱에는 사이드바가 없다(터치 기기에 맞지 않는다). 하단탭 5칸만으로는 모든 화면에
 * 닿을 수 없는데 기능을 뺄 수는 없으므로, 마지막 칸("더보기")이 이 시트를 연다.
 * 앱에서 어떤 화면으로든 갈 수 있는 유일한 전체 목록이다.
 *
 * 역할 판정 중 관리자/아티스트는 프로필만 보면 되지만(동기), 영업인·본사는 서버에
 * 물어야 한다. 시트를 열 때만 물어보고, 실패하면 그 항목만 빠진다(메뉴 자체는 뜬다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useEnterpriseSelfRole } from '@/hooks/useEnterpriseSelfRole';
import { nativeMenuSections, type NavItem } from '@/lib/appNav';
import { isStoreAccount } from '@/lib/nativeLanding';
import { NAV_ICONS } from '@/components/navIcons';
import { getRecentBrands } from '@/lib/brandSession';
import { COMPANY_INFO } from '@/lib/companyInfo';

interface Props {
  onClose: () => void;
}

function hasBoundBrand(): boolean {
  try {
    return getRecentBrands().length > 0;
  } catch {
    return false;
  }
}

export default function NativeMoreSheet({ onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalA11y(sheetRef, { onClose });

  // 영업인 여부는 서버에만 있다. 시트를 열 때 한 번 물어본다.
  const [isSalesAgent, setIsSalesAgent] = useState(false);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void import('@/lib/salespersonApi')
      .then((m) => m.fetchMySalespersonProfile())
      .then((s) => { if (alive) setIsSalesAgent(!!s.is_salesperson); })
      .catch(() => { /* 비영업인이거나 조회 실패 — 그 항목만 빠진다 */ });
    return () => { alive = false; };
  }, [userId]);

  const enterprise = useEnterpriseSelfRole(userId);

  const sections = useMemo(
    () =>
      nativeMenuSections({
        native: true,
        signedIn: !!userId,
        isCurator: profile?.is_curator ?? false,
        storeAccount: isStoreAccount({
          accountType: profile?.account_type ?? null,
          membershipTier: profile?.membership_tier ?? null,
          subscriptionType: profile?.subscription_type ?? null,
        }),
        hasBrand: hasBoundBrand(),
        isAdmin: profile?.role === 'admin',
        isArtist:
          profile?.account_type === 'artist' &&
          profile?.artist_approval_status === 'approved',
        isSalesAgent,
        isEnterpriseHq: !!enterprise.role.is_hq,
      }),
    [userId, profile, isSalesAgent, enterprise.role.is_hq],
  );

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="전체 메뉴"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-bg-soft pb-safe shadow-elevated ring-1 ring-line/15"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/10 bg-bg-soft/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">전체 메뉴</h2>
            {profile?.nickname && (
              <p className="truncate text-xs text-ink-mute">{profile.nickname}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1 rounded-full p-2.5 text-ink-mute hover:bg-ink/5 hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 px-4 py-5">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="px-1 pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">
                {section.title}
              </h3>
              <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
                {section.items.map((item: NavItem) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <li key={`${section.title}:${item.to}`} className="border-b border-line/10 last:border-0">
                      <Link
                        to={item.to}
                        onClick={onClose}
                        className="flex min-h-[60px] items-center gap-3.5 px-4 py-3 active:bg-bg-hover"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                          <Icon size={20} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-ink">{item.label}</span>
                          {item.desc && (
                            <span className="block truncate text-xs text-ink-mute">{item.desc}</span>
                          )}
                        </span>
                        <ChevronRight size={18} className="shrink-0 text-ink-dim" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {userId && (
            <button
              type="button"
              onClick={() => {
                onClose();
                void signOut();
              }}
              className="w-full rounded-2xl bg-bg-card px-4 py-4 text-sm font-semibold text-ink-mute ring-1 ring-line/10 active:bg-bg-hover"
            >
              로그아웃
            </button>
          )}

          {/* 사업자 정보 — 전자상거래법상 표시 의무. 웹은 푸터가 맡지만 앱에는 푸터가
              없으므로(터치 화면에서 매번 스크롤 끝까지 내리게 할 수 없다) 여기가 그 자리다. */}
          <section aria-labelledby="more-company">
            <h3 id="more-company" className="px-1 pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">
              사업자 정보
            </h3>
            <dl className="space-y-1.5 rounded-2xl bg-bg-card px-4 py-4 text-xs leading-relaxed ring-1 ring-line/10">
              {COMPANY_INFO.map((c) => (
                <div key={c.label} className="flex flex-wrap gap-x-2">
                  <dt className="shrink-0 text-ink-dim">{c.label}</dt>
                  <dd className="text-ink-mute">{c.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
