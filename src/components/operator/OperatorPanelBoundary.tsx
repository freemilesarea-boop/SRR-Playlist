import { Suspense, type ReactNode } from 'react';
import AdminErrorBoundary from '@/components/admin/AdminErrorBoundary';

/**
 * OperatorPanelBoundary — Phase ADMIN-UX-IMPLEMENT-2
 *
 * /ops 라우트에 마운트되는 기존 패널을 안전하게 감싼다:
 *   • 렌더/Lazy-chunk 로드 실패를 격리(AdminErrorBoundary 재사용) — 운영 콘솔 전체 화이트스크린 방지.
 *   • Suspense 로딩 스켈레톤.
 * resetKey(현재 경로) 가 바뀌면 직전 라우트의 에러 상태를 자동 초기화.
 */
export default function OperatorPanelBoundary({
  resetKey,
  children,
}: {
  resetKey?: string | number;
  children: ReactNode;
}) {
  return (
    <AdminErrorBoundary resetKey={resetKey}>
      <Suspense fallback={<PanelSkeleton />}>{children}</Suspense>
    </AdminErrorBoundary>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">불러오는 중…</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-bg-hover" />
      <div className="h-32 animate-pulse rounded-2xl bg-bg-hover" />
      <div className="h-32 animate-pulse rounded-2xl bg-bg-hover" />
    </div>
  );
}
