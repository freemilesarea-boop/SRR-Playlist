/**
 * operatorPanels.ts — Phase ADMIN-UX-IMPLEMENT-2
 *
 * componentKey → 기존 Admin 패널/페이지의 Lazy 매핑.
 *   • 기존 컴포넌트를 **복제하지 않고 재사용**한다(직접 Lazy Import → Route 진입 시에만 로드).
 *   • 모든 대상 패널은 무-props 로 렌더 가능(AdminPage 에서도 props 없이/옵션 props 로 렌더됨).
 *   • 62개 패널 전체를 import 하지 않는다 — /ops 라우트에서 실제로 쓰는 대표 패널만.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type OperatorPanel = LazyExoticComponent<ComponentType>;

/** componentKey('home' 제외) → Lazy 컴포넌트. 'home' 은 App.tsx 에서 OperatorHomePage 로 직접 마운트. */
export const OPERATOR_PANELS: Record<string, OperatorPanel> = {
  // stores / monitoring
  'store-monitoring': lazy(() => import('@/components/admin/StoreMonitoringPanel')),
  'store-now-playing': lazy(() => import('@/components/admin/StoreNowPlayingPanel')),
  'store-detail': lazy(() => import('@/pages/EnterpriseOpsStoreDetailPage')),
  'enterprise-noc': lazy(() => import('@/components/admin/EnterpriseNocPanel')),
  'audio-diagnostics': lazy(() => import('@/components/admin/AudioDiagnosticPanel')),
  // enterprise
  'enterprise-overview': lazy(() => import('@/components/admin/EnterpriseOverviewPanel')),
  'enterprise-accounts': lazy(() => import('@/components/admin/EnterpriseAccountsPanel')),
  'franchise': lazy(() => import('@/components/admin/FranchiseManagementPanel')),
  'brand-registry': lazy(() => import('@/components/admin/BrandRegistryPanel')),
  // music
  'policy-deployment': lazy(() => import('@/components/admin/PolicyDeploymentPanel')),
  'content': lazy(() => import('@/components/admin/ContentManagement')),
  // finance
  'enterprise-settlement-center': lazy(() => import('@/components/admin/EnterpriseSettlementCenterPanel')),
  'enterprise-billing': lazy(() => import('@/components/admin/EnterpriseBillingPanel')),
  'enterprise-monthly-settlements': lazy(() => import('@/components/admin/EnterpriseMonthlySettlementsPanel')),
  'enterprise-contracts': lazy(() => import('@/components/admin/EnterpriseContractsPanel')),
  // remaining
  'artists': lazy(() => import('@/components/admin/ArtistApprovalList')),
  'dashboard': lazy(() => import('@/components/admin/Dashboard')),
  'ai-curation': lazy(() => import('@/components/admin/AiCurationPanel')),
  'site-settings': lazy(() => import('@/components/admin/SiteSettingsPanel')),
};

export function getOperatorPanel(componentKey: string): OperatorPanel | undefined {
  return OPERATOR_PANELS[componentKey];
}
