import { useState } from 'react';
import { Navigate, Outlet, Link } from 'react-router-dom';
import { Menu, X, Home } from 'lucide-react';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import OperatorSidebar from './OperatorSidebar';
import OperatorCommandPalette from './OperatorCommandPalette';
import type { OperatorAccessContext } from '@/lib/operatorNavigation';

/**
 * OperatorLayout — Phase ADMIN-UX-IMPLEMENT-1
 *
 * 운영자 전용 셸. 소비자 AppShell 과 완전히 분리된다 (소비자 Sidebar/Player/BottomNav 없음).
 *   • 데스크톱: 좌측 고정 사이드바(w-64) + 우측 콘텐츠.
 *   • 모바일: 햄버거로 여는 드로어(오버레이) + 상단바.
 *   • 게이트: 운영자(super/admin/hq) 가 아니면 소비자 홈으로 리다이렉트.
 *     실제 화면별 접근 권한은 대상 라우트의 서버 RPC / RequireAdmin / RLS 가 최종 판정한다.
 */
export default function OperatorLayout() {
  const access = useOperatorAccess();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 역할 신호 로딩 중에는 게이트 판단 보류 (깜빡임/오리다이렉트 방지).
  if (access.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-ink-mute">
        <span className="text-sm">운영 콘솔 불러오는 중…</span>
      </div>
    );
  }

  // 운영자가 아니면 소비자 홈으로.
  if (!access.isOperator) {
    return <Navigate to="/" replace />;
  }

  const ctx: OperatorAccessContext = {
    isSuperAdmin: access.isSuperAdmin,
    isPlatformAdmin: access.isPlatformAdmin,
    isHq: access.isHq,
  };

  return (
    <div className="min-h-screen bg-bg pt-safe">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/10 bg-bg/95 pt-safe lg:flex">
        <OperatorSidebar ctx={ctx} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line/10 bg-bg/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="운영 메뉴 열기"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-mute hover:bg-bg-hover hover:text-ink"
        >
          <Menu size={20} />
        </button>
        <Link to="/ops" className="inline-flex items-center gap-2 text-sm font-extrabold text-ink">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Home size={14} strokeWidth={2.4} />
          </span>
          운영 콘솔
        </Link>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="운영 메뉴"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line/10 bg-bg shadow-xl"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="운영 메뉴 닫기"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute hover:bg-bg-hover hover:text-ink"
            >
              <X size={18} />
            </button>
            <OperatorSidebar ctx={ctx} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>

      {/* Command Palette (Cmd/Ctrl+K) — 셸 전역 1회 마운트 */}
      <OperatorCommandPalette ctx={ctx} />
    </div>
  );
}
