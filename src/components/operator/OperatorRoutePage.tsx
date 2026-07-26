import { useEffect } from 'react';
import { useLocation, useParams, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import {
  matchOpsRoute, canAccessRoute, breadcrumbFor, type OperatorAccessContext,
} from '@/lib/operatorRouteRegistry';
import { pushRecent } from '@/lib/operatorRecent';
import { getOperatorPanel } from './operatorPanels';
import OperatorBreadcrumb from './OperatorBreadcrumb';
import OperatorPageHeader from './OperatorPageHeader';
import OperatorPanelBoundary from './OperatorPanelBoundary';

/**
 * OperatorRoutePage — Phase ADMIN-UX-IMPLEMENT-2
 *
 * /ops 하위 라우트의 제네릭 페이지 셸. 현재 경로를 레지스트리에 매칭한 뒤:
 *   • Breadcrumb + PageHeader(+ 기존 화면 링크) + ErrorBoundary + Suspense + 기존 패널 마운트.
 *   • 권한 미달이면 소비자 홈이 아니라 콘솔 안에서 안전한 안내(운영자는 셸 안에 머문다).
 *   • 진입 시 "최근 사용"에 기록.
 * 각 라우트마다 마크업을 반복하지 않고 이 컴포넌트 하나로 처리한다.
 */
export default function OperatorRoutePage() {
  const location = useLocation();
  const params = useParams();
  const profile = useAuthStore((s) => s.profile);
  const access = useOperatorAccess();
  const entry = matchOpsRoute(location.pathname);

  const ctx: OperatorAccessContext = {
    isSuperAdmin: access.isSuperAdmin,
    isPlatformAdmin: access.isPlatformAdmin,
    isHq: access.isHq,
  };

  const allowed = !!entry && canAccessRoute(entry, ctx);

  // 최근 사용 기록 — 접근 가능한 정적(비동적) 라우트만.
  useEffect(() => {
    if (access.loading || !entry || !allowed) return;
    if (entry.canonicalPath.includes(':')) return; // 동적 상세는 기록 생략(식별자 저장 방지)
    pushRecent(profile?.id, { id: entry.id, label: entry.label, path: entry.canonicalPath });
  }, [access.loading, entry, allowed, profile?.id]);

  // 알 수 없는 /ops 경로 → 콘솔 홈으로 안전 복귀(소비자 홈으로 내보내지 않음).
  if (!entry) return <Navigate to="/ops" replace />;

  const Panel = getOperatorPanel(entry.componentKey);
  const breadcrumb = breadcrumbFor(entry); // 동적 이름 미확보 시 fallback 라벨(가짜 이름 없음)

  return (
    <div className="space-y-4">
      <OperatorBreadcrumb segments={breadcrumb} />
      <OperatorPageHeader title={entry.label} description={entry.description} legacyTab={entry.legacyTab} />

      {access.loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-bg-hover" aria-busy="true" />
      ) : !allowed ? (
        <div className="rounded-2xl border border-line/10 bg-bg-card p-6 text-sm text-ink-dim">
          이 화면에 접근할 권한이 없습니다. 접근이 필요하면 관리자에게 문의하세요.
        </div>
      ) : !Panel ? (
        <div className="rounded-2xl border border-line/10 bg-bg-card p-6 text-sm text-ink-dim">
          이 화면은 준비 중입니다.
        </div>
      ) : (
        <OperatorPanelBoundary resetKey={location.pathname}>
          {/* 동적 상세(:storeId)는 useParams 로 기존 페이지가 직접 읽는다. key 로 재마운트 보장. */}
          <Panel key={JSON.stringify(params)} />
        </OperatorPanelBoundary>
      )}
    </div>
  );
}
