import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import {
  LayoutDashboard,
  Users,
  Headphones,
  Wallet,
  CreditCard,
  Settings,
  Sparkles,
  Mic2,
  Music,
  Trash2,
  ScrollText,
  Handshake,
  Store as StoreIcon,
  Building2,
  FileSignature,
  Ticket,
  Smartphone,
  Stethoscope,
  AlertTriangle,
  HardDrive,
  ShieldCheck,
  Gift,
  Bell,
  Activity,
  MessageSquare,
  Compass,
  Mail,
} from 'lucide-react';
// X6.39 — Eager (초기 admin 진입 시 표시)
import OnboardingChecklist from '@/components/admin/OnboardingChecklist';
import Dashboard from '@/components/admin/Dashboard';
import AdminWorkQueueBar from '@/components/admin/AdminWorkQueueBar';
import AdminNotificationsBell from '@/components/admin/AdminNotificationsBell';
import AdminErrorBoundary from '@/components/admin/AdminErrorBoundary';
import { fetchMyAdminPermissions, type AdminPermissions } from '@/lib/adminRbacApi';
import { AdminAlert } from '@/components/admin/ui';
import { adminPendingSettlementAlert, type PendingSettlementAlert } from '@/lib/artistSettlementApi';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { supabaseProjectRef } from '@/lib/supabase';
import type { ControlCenterView } from '@/components/admin/EnterpriseControlCenterPanel';
import {
  type AdminGroup,
  ADMIN_GROUPS,
  groupOfTab,
  subgroupOfTab,
  subgroupsOf,
  groupHint,
  isAdvancedTab,
  labelForTab,
  breadcrumbFor,
  resolveMergedTab,
} from '@/lib/adminNav';

// X6.39 — Lazy split — 41개 admin 탭 (탭 클릭 시 chunk 로드)
const ArtistApprovalList = lazy(() => import('@/components/admin/ArtistApprovalList'));
const ArtistContractsList = lazy(() => import('@/components/admin/ArtistContractsList'));
const ArtistTrackManagementList = lazy(() => import('@/components/admin/ArtistTrackManagementList'));
const ArtistSettlementsList = lazy(() => import('@/components/admin/ArtistSettlementsList'));
const TrackReviewList = lazy(() => import('@/components/admin/TrackReviewList'));
const QcReviewQueuePanel = lazy(() => import('@/components/admin/QcReviewQueuePanel'));
// '계좌 확인' + '정산 정보 신청' → '정산 계좌' 한 화면(PayoutAccountsPanel).
// 두 패널은 그 안에서 뷰별로 lazy 로드된다.
const PayoutAccountsPanel = lazy(() => import('@/components/admin/PayoutAccountsPanel'));
// 병합된 통합 탭 — 안의 개별 패널들은 각자 뷰로 lazy 로드된다(adminNav.MERGED_TABS).
const AiClassificationPanel = lazy(() => import('@/components/admin/AiClassificationPanel'));
const StoreStatusPanel = lazy(() => import('@/components/admin/StoreStatusPanel'));
const UploadChecksPanel = lazy(() => import('@/components/admin/UploadChecksPanel'));
const ShadowV2Panel = lazy(() => import('@/components/admin/ShadowV2Panel'));
const SiteConfigPanel = lazy(() => import('@/components/admin/SiteConfigPanel'));
const PaymentSyncTool = lazy(() => import('@/components/admin/PaymentSyncTool'));
const AdminOperationLogs = lazy(() => import('@/components/admin/AdminOperationLogs'));
const SalesAgentsList = lazy(() => import('@/components/admin/SalesAgentsList'));
const FreeTrialsPanel = lazy(() => import('@/components/admin/FreeTrialsPanel'));
const AdminUsersList = lazy(() => import('@/components/admin/AdminUsersList'));
const MembersList = lazy(() => import('@/components/admin/MembersList'));
const MemberBroadcastPanel = lazy(() => import('@/components/admin/MemberBroadcastPanel'));
const StreamingAnalytics = lazy(() => import('@/components/admin/StreamingAnalytics'));
const RevenueManagement = lazy(() => import('@/components/admin/RevenueManagement'));
const SubscriptionRequests = lazy(() => import('@/components/admin/SubscriptionRequests'));
const ContentManagement = lazy(() => import('@/components/admin/ContentManagement'));
const RecommendationTester = lazy(() => import('@/components/admin/RecommendationTester'));
const PromotionCodes = lazy(() => import('@/components/admin/PromotionCodes'));
const AutoPlaylistManager = lazy(() => import('@/components/admin/AutoPlaylistManager'));
const AudioReencodePanel = lazy(() => import('@/components/admin/AudioReencodePanel'));
const AudioDiagnosticPanel = lazy(() => import('@/components/admin/AudioDiagnosticPanel'));
const AudioEngineDiagnosticsPanel = lazy(() => import('@/components/admin/AudioEngineDiagnosticsPanel'));
const MetadataViolationsList = lazy(() => import('@/components/admin/MetadataViolationsList'));
const AiCurationPanel = lazy(() => import('@/components/admin/AiCurationPanel'));
const ClapRecommendationPanel = lazy(() => import('@/components/admin/ClapRecommendationPanel'));
const TrackAiMetadataPanel = lazy(() => import('@/components/admin/TrackAiMetadataPanel'));
const TaxonomyManagerPanel = lazy(() => import('@/components/admin/TaxonomyManagerPanel'));
const PlacementAuditPanel = lazy(() => import('@/components/admin/PlacementAuditPanel'));
const SiteNoticesManagerPanel = lazy(() => import('@/components/admin/SiteNoticesManagerPanel'));
const SalesPartnerApplications = lazy(() => import('@/components/admin/SalesPartnerApplications'));
const FranchiseManagementPanel = lazy(() => import('@/components/admin/FranchiseManagementPanel'));
// 관제 4화면(프랜차이즈 현황 / 매장 NOC / 시스템 운영 / 사업 현황) → '통합 관제' 한 탭.
// 네 패널은 EnterpriseControlCenterPanel 안에서 뷰별로 lazy 로드된다.
const EnterpriseControlCenterPanel = lazy(() => import('@/components/admin/EnterpriseControlCenterPanel'));
const EnterpriseAccountsPanel = lazy(() => import('@/components/admin/EnterpriseAccountsPanel'));
const EnterpriseRegionsPanel = lazy(() => import('@/components/admin/EnterpriseRegionsPanel'));
const EnterpriseMonthlySettlementsPanel = lazy(() => import('@/components/admin/EnterpriseMonthlySettlementsPanel'));
const PolicyDeploymentPanel = lazy(() => import('@/components/admin/PolicyDeploymentPanel'));
const PolicyAutomationPanel = lazy(() => import('@/components/admin/PolicyAutomationPanel'));
const EnterpriseAnnouncementsPanel = lazy(() => import('@/components/admin/EnterpriseAnnouncementsPanel'));
const EnterpriseBillingPanel = lazy(() => import('@/components/admin/EnterpriseBillingPanel'));
const EnterpriseContractsPanel = lazy(() => import('@/components/admin/EnterpriseContractsPanel'));
const EnterpriseEmergencyBroadcastPanel = lazy(() => import('@/components/admin/EnterpriseEmergencyBroadcastPanel'));
const EnterpriseSettlementCenterPanel = lazy(() => import('@/components/admin/EnterpriseSettlementCenterPanel'));
const BrandRegistryPanel = lazy(() => import('@/components/admin/BrandRegistryPanel'));
const SupportInquiriesPanel = lazy(() => import('@/components/admin/SupportInquiriesPanel'));
const CuratorsAdminPanel = lazy(() => import('@/components/admin/CuratorsAdminPanel'));
const BrandPlayerPanel = lazy(() => import('@/components/admin/BrandPlayerPanel'));

// X6.39 — lazy chunk 로드 중 표시할 fallback
function TabSkeleton() {
  return (
    <div className="space-y-3 p-1" aria-live="polite" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded bg-bg-card" />
      <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />
      <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />
    </div>
  );
}

type Tab =
  | 'dashboard'
  | 'business-live'
  | 'support-inquiries'
  | 'members'
  | 'member-broadcast'
  | 'curators'
  | 'enterprise-overview'
  | 'enterprise-accounts'
  | 'enterprise-regions'
  | 'enterprise-monthly-settlements'
  | 'store-monitoring'
  | 'store-now-playing'
  | 'policy-deployment'
  | 'policy-automation'
  | 'enterprise-announcements'
  | 'enterprise-billing'
  | 'enterprise-contracts'
  | 'enterprise-emergency'
  | 'enterprise-noc'
  | 'enterprise-operations'
  | 'enterprise-settlement-center'
  | 'brand-registry'
  | 'enterprise-command-center'
  | 'franchise'
  | 'sales-agents'
  | 'sales-partners'
  | 'free-trials'
  | 'streaming'
  | 'streaming-v2'
  | 'settlement-v2'
  | 'revenue'
  | 'subscriptions'
  | 'promotions'
  | 'payment-sync'
  | 'content'
  | 'auto-playlists'
  | 'artists'
  | 'artist-contracts'
  | 'payout-verification'
  | 'payout-intake'
  | 'track-review'
  | 'qc-review'
  | 'artist-tracks'
  | 'deleted-tracks'
  | 'audio-reencode'
  | 'audio-diagnostics'
  | 'audio-engine-diagnostics'
  | 'metadata-violations'
  | 'upload-audit'
  | 'ai-curation'
  | 'clap-curation'
  | 'ai-metadata'
  | 'ai-taxonomy'
  | 'ai-genre'
  | 'ai-mood'
  | 'ai-storetype'
  | 'placement-audit'
  | 'site-settings'
  | 'site-notices'
  | 'artist-settlements'
  | 'operation-logs'
  | 'admins'
  | 'upload-integrity'
  | 'recommendation'
  | 'brand'
  | 'brand-player';

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode; superOnly?: boolean }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'brand-player', label: '브랜드 플레이어', icon: <StoreIcon size={14} />, superOnly: true },
  { key: 'support-inquiries', label: '문의관리', icon: <MessageSquare size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
  { key: 'member-broadcast', label: '회원 메일 발송', icon: <Mail size={14} /> },
  { key: 'curators', label: '큐레이터 관리', icon: <Users size={14} /> },
  // enterprise-noc / -operations / -command-center 가 여기로 병합됨(adminNav.MERGED_TABS).
  // 구 딥링크는 계속 동작하며 통합 화면의 해당 뷰로 열린다.
  { key: 'enterprise-overview', label: '통합 관제', icon: <Compass size={14} /> },
  { key: 'enterprise-accounts', label: '본사 계정', icon: <Building2 size={14} /> },
  { key: 'enterprise-regions', label: '지역 관리', icon: <Building2 size={14} /> },
  { key: 'enterprise-monthly-settlements', label: '본사 월 정산', icon: <Wallet size={14} /> },
  // business-live / store-now-playing 병합 (adminNav.MERGED_TABS) — 구 딥링크 유지.
  { key: 'store-monitoring', label: '매장 상태', icon: <Activity size={14} /> },
  { key: 'policy-deployment', label: '음악 배포 현황', icon: <ShieldCheck size={14} /> },
  { key: 'policy-automation', label: '자동 음악 스케줄', icon: <ShieldCheck size={14} /> },
  { key: 'enterprise-announcements', label: '안내/광고 음원', icon: <Music size={14} /> },
  { key: 'enterprise-emergency', label: '긴급 방송', icon: <Music size={14} /> },
  { key: 'enterprise-settlement-center', label: '정산·청구 통합', icon: <Wallet size={14} />, superOnly: true },
  { key: 'brand-registry', label: '브랜드 관리', icon: <Building2 size={14} />, superOnly: true },
  { key: 'enterprise-billing', label: '본사 청구', icon: <Wallet size={14} /> },
  { key: 'enterprise-contracts', label: '계약 관리', icon: <ShieldCheck size={14} /> },
  { key: 'franchise', label: '프랜차이즈 관리', icon: <StoreIcon size={14} /> },
  { key: 'sales-agents', label: '영업인 관리', icon: <Handshake size={14} /> },
  { key: 'sales-partners', label: '영업 파트너 신청', icon: <Handshake size={14} /> },
  { key: 'free-trials', label: '무료 체험', icon: <Gift size={14} /> },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} /> },
  // settlement-v2 병합.
  { key: 'streaming-v2', label: 'v2 관측 (Shadow)', icon: <Headphones size={14} />, superOnly: true },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} /> },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} /> },
  { key: 'promotions', label: '프로모션', icon: <Ticket size={14} /> },
  { key: 'payment-sync', label: '결제 동기화', icon: <CreditCard size={14} /> },
  { key: 'operation-logs', label: '운영 로그', icon: <ScrollText size={14} /> },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} /> },
  { key: 'auto-playlists', label: '자동 플리/배치', icon: <Sparkles size={14} /> },
  { key: 'artists', label: '아티스트 승인', icon: <Mic2 size={14} /> },
  { key: 'artist-contracts', label: '아티스트 계약', icon: <FileSignature size={14} /> },
  // payout-verification 은 이 탭으로 병합됨(adminNav.MERGED_TABS) — 구 딥링크는 계속 동작.
  { key: 'payout-intake', label: '정산 계좌', icon: <Wallet size={14} /> },
  { key: 'track-review', label: '음원 검수', icon: <Mic2 size={14} /> },
  { key: 'qc-review', label: 'AI QC 검수', icon: <Sparkles size={14} /> },
  { key: 'artist-tracks', label: '음원 관리', icon: <Music size={14} /> },
  { key: 'deleted-tracks', label: '삭제 음원', icon: <Trash2 size={14} /> },
  { key: 'audio-reencode', label: '오디오 변환(iOS)', icon: <Smartphone size={14} /> },
  { key: 'audio-diagnostics', label: '오디오 진단', icon: <Stethoscope size={14} /> },
  { key: 'audio-engine-diagnostics', label: '오디오 엔진 진단', icon: <Activity size={14} />, superOnly: true },
  { key: 'metadata-violations', label: '메타데이터 위반 의심', icon: <AlertTriangle size={14} /> },
  // upload-integrity 병합.
  { key: 'upload-audit', label: '업로드 점검', icon: <HardDrive size={14} /> },
  { key: 'ai-curation', label: 'AI 큐레이션', icon: <Sparkles size={14} /> },
  { key: 'clap-curation', label: 'CLAP 추천', icon: <Sparkles size={14} /> },
  { key: 'ai-metadata', label: 'AI 메타데이터', icon: <Sparkles size={14} /> },
  { key: 'ai-taxonomy', label: 'AI 분류 체계', icon: <Sparkles size={14} /> },
  // ai-mood / ai-storetype 병합.
  { key: 'ai-genre', label: 'AI 분류', icon: <Sparkles size={14} /> },
  { key: 'placement-audit', label: 'AI 배치 진단', icon: <ShieldCheck size={14} /> },
  // brand(로고) 병합.
  { key: 'site-settings', label: '사이트 설정', icon: <ShieldCheck size={14} /> },
  { key: 'site-notices', label: '공지/팝업', icon: <Bell size={14} /> },
  { key: 'artist-settlements', label: '아티스트 정산', icon: <Wallet size={14} /> },
  { key: 'recommendation', label: '추천 테스트', icon: <Sparkles size={14} /> },
  { key: 'admins', label: '관리자 설정', icon: <ShieldCheck size={14} />, superOnly: true },
];

/**
 * IA (ADMIN-IA-SIMPLIFICATION-1) — 업무 중심 1차 메뉴(8) → 2차(subgroup) → 페이지(tab).
 * 매핑/라벨/고급 노출은 @/lib/adminNav 단일 소스. 탭 key 는 불변 → 기존 딥링크 ?tab=X 전부 보존.
 * 이전의 7개 기술 그룹 + Enterprise 전용 subgroup 을 8개 업무 그룹의 일반 subgroup 으로 통합.
 */
type Group = AdminGroup;

function groupOf(tab: Tab): Group {
  return groupOfTab(tab);
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [group, setGroup] = useState<Group>(groupOf('dashboard'));
  // IA — 활성 그룹의 2차 서브그룹 선택 상태(모든 그룹 공통).
  const [subgroup, setSubgroup] = useState<string>(subgroupOfTab('dashboard'));
  // Progressive Disclosure — 고급/기술 탭 기본 숨김, 토글 시 노출.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 병합된 탭의 구 딥링크(?tab=<구 key>)로 들어왔을 때 통합 화면이 열어야 할 뷰.
  // 일반 진입은 null → 통합 화면의 기본 뷰.
  const [mergedView, setMergedView] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [perms, setPerms] = useState<AdminPermissions | null>(null);
  const [settlementAlert, setSettlementAlert] = useState<PendingSettlementAlert | null>(null);

  // Phase 1-5.1 — cross-탭 deep link: 정책 적용률 → 프랜차이즈 관리 (정책 탭) → 정책 생성 후 자동 복귀.
  // pendingFranchiseDeepLink: 한 번 자동 진입 후 consume.
  // pendingFranchiseReturnTo: 정책 생성 성공 시 복귀할 탭. 사용자가 수동으로 다른 탭으로 가면 자동 클리어.
  const [pendingFranchiseDeepLink, setPendingFranchiseDeepLink] =
    useState<'stores' | 'policies' | 'schedule' | 'sync' | null>(null);
  const [pendingFranchiseReturnTo, setPendingFranchiseReturnTo] = useState<Tab | null>(null);

  useEffect(() => { fetchMyAdminPermissions().then(setPerms).catch(() => {}); }, []);
  useEffect(() => { adminPendingSettlementAlert().then(setSettlementAlert).catch(() => {}); }, []);

  // URL param ?tab=X 지원 — Command Center Quick Actions / 외부 딥링크가 탭 이동을 트리거할 수 있게.
  // 초기 진입 + popstate 이벤트 모두 처리. 유효한 Tab key 인 경우만 반영.
  useEffect(() => {
    const isValidTab = (v: string | null): v is Tab => {
      if (!v) return false;
      return TABS.some((t) => t.key === v);
    };
    const applyFromUrl = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('tab');
        // 병합으로 없어진 탭 key 로 들어온 링크는 통합 탭 + 해당 뷰로 보낸다.
        // (구 딥링크를 깨지 않기 위한 것 — isValidTab 검사보다 먼저 풀어야 한다.)
        const merged = raw ? resolveMergedTab(raw) : null;
        const t = merged ? merged.tab : raw;
        if (isValidTab(t)) {
          setTab(t);
          setGroup(groupOf(t));
          setSubgroup(subgroupOfTab(t));
          setMergedView(merged?.view ?? null);
        }
      } catch { /* silent */ }
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.superOnly || perms?.is_super_admin),
    [perms],
  );

  /**
   * '통합 관제' 안의 뷰 권한. 병합 전 각 탭의 노출 규칙을 그대로 옮긴 것 —
   * 시스템 운영(구 enterprise-operations)과 사업 현황(구 enterprise-command-center)은
   * superOnly 탭이었다. 화면을 합쳤다고 접근 범위가 넓어지면 안 된다.
   */
  const allowedControlViews = useMemo<ControlCenterView[]>(
    () => (perms?.is_super_admin
      ? ['franchises', 'stores', 'system', 'business']
      : ['franchises', 'stores']),
    [perms],
  );
  const controlCenterView = (mergedView ?? 'franchises') as ControlCenterView;
  const visibleKeys = useMemo(() => new Set(visibleTabs.map((t) => t.key)), [visibleTabs]);

  // 활성 그룹의 서브그룹 목록(가시 탭이 하나라도 있는 서브그룹만).
  const groupSubgroups = useMemo(
    () => subgroupsOf(group).filter((s) => s.tabs.some((k) => visibleKeys.has(k as Tab))),
    [group, visibleKeys],
  );
  const hasSubNav = groupSubgroups.length > 1;

  // 현재 서브그룹의 탭(가시). 서브그룹이 하나뿐이면 그룹 전체.
  const subgroupTabKeys = useMemo(() => {
    if (!hasSubNav) return groupSubgroups.flatMap((s) => s.tabs);
    const active = groupSubgroups.find((s) => s.name === subgroup) ?? groupSubgroups[0];
    return active.tabs;
  }, [groupSubgroups, hasSubNav, subgroup]);

  // 고급 탭은 기본 숨김. 단, 현재 활성 탭은 항상 노출(딥링크 진입 대비).
  const displayTabs = useMemo(() => {
    const keys = new Set(subgroupTabKeys);
    return visibleTabs.filter(
      (t) => keys.has(t.key) && (!isAdvancedTab(t.key) || showAdvanced || t.key === tab),
    );
  }, [subgroupTabKeys, visibleTabs, showAdvanced, tab]);

  const hiddenAdvancedCount = useMemo(
    () => (showAdvanced ? 0 : subgroupTabKeys.filter((k) => isAdvancedTab(k) && k !== tab && visibleKeys.has(k as Tab)).length),
    [subgroupTabKeys, showAdvanced, tab, visibleKeys],
  );

  // group 변경 시 subgroup 이 유효하지 않으면 첫 서브그룹으로 리셋.
  useEffect(() => {
    if (groupSubgroups.length > 0 && !groupSubgroups.some((s) => s.name === subgroup)) {
      setSubgroup(groupSubgroups[0].name);
    }
  }, [group, groupSubgroups, subgroup]);

  // 탭 직접 클릭(예: 외부 링크) 시 그룹 + 서브그룹 자동 동기화.
  // 병합된 구 key 가 들어와도 통합 탭으로 풀어준다.
  function selectTab(next: Tab, viewOverride?: string) {
    const merged = resolveMergedTab(next);
    const target = (merged ? merged.tab : next) as Tab;
    setTab(target);
    setGroup(groupOf(target));
    setSubgroup(subgroupOfTab(target));
    // 일반 클릭은 통합 화면의 기본 뷰로 — 이전 딥링크의 뷰가 남아 있으면 안 된다.
    // viewOverride 는 호출측이 특정 뷰를 지목한 경우(홈 처리 대기 줄)에만 쓴다.
    setMergedView(viewOverride ?? merged?.view ?? null);
  }

  // franchise 탭에서 벗어나면 deep-link / return 상태 클리어 (재진입 시 재발화 방지)
  useEffect(() => {
    if (tab !== 'franchise') {
      setPendingFranchiseDeepLink(null);
      setPendingFranchiseReturnTo(null);
    }
  }, [tab]);

  const requestFranchisePolicyNav = useCallback((returnTo: Tab = 'policy-deployment') => {
    setPendingFranchiseDeepLink('policies');
    setPendingFranchiseReturnTo(returnTo);
    setTab('franchise');
    setGroup(groupOf('franchise'));
    setSubgroup(subgroupOfTab('franchise'));
  }, []);

  const consumeFranchiseDeepLink = useCallback(() => {
    setPendingFranchiseDeepLink(null);
  }, []);

  const returnFromFranchiseAfterPolicy = useCallback(() => {
    const target = pendingFranchiseReturnTo;
    setPendingFranchiseReturnTo(null);
    if (target) {
      setTab(target);
      setGroup(groupOf(target));
      setSubgroup(subgroupOfTab(target));
    }
  }, [pendingFranchiseReturnTo]);

  // 그룹의 첫 가시 탭(서브그룹 순서 유지). 빈 panel 회피용.
  const firstVisibleInGroup = useCallback(
    (g: Group): Tab | null => {
      for (const s of subgroupsOf(g)) {
        for (const k of s.tabs) {
          if (visibleKeys.has(k as Tab)) return k as Tab;
        }
      }
      return null;
    },
    [visibleKeys],
  );

  // 그룹 클릭 시 첫 서브그룹 + 그 그룹의 첫 가시 탭으로 진입.
  function selectGroup(next: Group) {
    setGroup(next);
    setShowAdvanced(false);
    const subs = subgroupsOf(next).filter((s) => s.tabs.some((k) => visibleKeys.has(k as Tab)));
    setSubgroup(subs[0]?.name ?? '');
    const first = firstVisibleInGroup(next);
    if (first) setTab(first);
  }

  // 서브그룹 클릭 시 그 서브그룹의 첫 가시 탭으로 진입.
  function selectSubgroup(next: string) {
    setSubgroup(next);
    const sg = subgroupsOf(group).find((s) => s.name === next);
    const first = sg?.tabs.find((k) => visibleKeys.has(k as Tab)) as Tab | undefined;
    if (first) setTab(first);
  }

  // OnboardingChecklist 용
  useEffect(() => {
    Promise.all([fetchPlaylists(), fetchTracks()])
      .then(([pls, trs]) => {
        setPlaylists(pls);
        setTracks(trs);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight">관리자</h1>
          <p className="text-xs text-ink-mute">
            홈 · 회원 · 음원 · 플레이리스트 · 매장 · 본사·브랜드 · 정산 · 운영·설정
          </p>
          <p className="text-[10px] font-mono text-ink-dim">
            Connected Supabase: <span className="text-accent">{supabaseProjectRef}</span>
          </p>
        </div>
        <AdminNotificationsBell />
      </header>

      <OnboardingChecklist tracks={tracks} playlists={playlists} />

      {/* 매월 1일 자동 생성된 정산 지급 검토 알람 (관리자 전용, 지급 대기 있을 때만).
          홈에서는 처리 대기 줄의 '정산 지급' 카드가 같은 내용을 보여주므로 배너를 생략한다
          (같은 숫자를 한 화면에 두 번 띄우지 않기 위함). 다른 탭에서는 그대로 뜬다. */}
      {tab !== 'dashboard' && settlementAlert?.has_pending && (
        <AdminAlert
          tone="warning"
          title="정산 지급 검토 필요"
          description={
            `${settlementAlert.settlement_month ? Number(settlementAlert.settlement_month.slice(5, 7)) + '월' : '최근'} 아티스트 정산이 생성되어 지급 대기 중입니다 · ` +
            `지급대상 ${settlementAlert.pending_count}건` +
            (settlementAlert.held_count > 0 ? ` · 계좌 미인증 보류 ${settlementAlert.held_count}건` : '') +
            ` · 대기 금액 ${settlementAlert.total_amount.toLocaleString()}원`
          }
          action={
            <button
              type="button"
              onClick={() => selectTab('artist-settlements')}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              정산 탭으로 이동
            </button>
          }
        />
      )}

      {/* 업무 중심 2-level nav — 1차: 업무 그룹(8), 2차: 서브그룹, 페이지: 탭. 딥링크 key 불변. */}
      <nav className="space-y-2" aria-label="관리자 메뉴">
        {/* 1차: 업무 그룹 */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex gap-1.5 pb-1 no-scrollbar">
            {ADMIN_GROUPS.map((g) => {
              const tabs = subgroupsOf(g).flatMap((s) => s.tabs);
              const hasVisible = tabs.some((k) => visibleKeys.has(k as Tab));
              if (!hasVisible) return null;
              const isActive = group === g;
              return (
                <button
                  key={g}
                  onClick={() => selectGroup(g)}
                  aria-current={isActive ? 'page' : undefined}
                  title={groupHint(g)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold tracking-wider transition ${
                    isActive
                      ? 'bg-ink text-bg ring-1 ring-ink'
                      : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink hover:ring-line/20'
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>
        {/* 2차: 서브그룹(서브그룹이 2개 이상인 그룹만) */}
        {hasSubNav && (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <div className="flex gap-1.5 pb-1 no-scrollbar">
              {groupSubgroups.map((sg) => {
                const isActive = subgroup === sg.name;
                return (
                  <button
                    key={sg.name}
                    onClick={() => selectSubgroup(sg.name)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                      isActive
                        ? 'bg-violet-500/25 text-slate-900 dark:text-violet-100 ring-1 ring-violet-400/50'
                        : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink hover:ring-line/20'
                    }`}
                  >
                    {sg.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* 페이지: 탭(현재 서브그룹, 고급 탭은 기본 숨김) */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex items-center gap-1.5 pb-1 no-scrollbar">
            {displayTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => selectTab(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                  tab === t.key
                    ? 'bg-accent text-black'
                    : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
                }`}
              >
                {t.icon}
                {labelForTab(t.key, t.label)}
              </button>
            ))}
            {(hiddenAdvancedCount > 0 || showAdvanced) && (
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-ink-mute ring-1 ring-line/15 transition hover:text-ink hover:ring-line/25"
                aria-expanded={showAdvanced}
              >
                {showAdvanced ? '간단히' : `고급 ${hiddenAdvancedCount}`}
              </button>
            )}
          </div>
        </div>
        {/* Breadcrumb — 현재 위치(그룹 > 서브그룹 > 페이지) */}
        <ol className="flex flex-wrap items-center gap-1 px-0.5 text-[11px] text-ink-dim" aria-label="현재 위치">
          {breadcrumbFor(tab, TABS.find((t) => t.key === tab)?.label ?? tab).map((c, i, arr) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.tab && i < arr.length - 1 ? (
                <button className="hover:text-ink" onClick={() => selectTab(c.tab as Tab)}>
                  {c.label}
                </button>
              ) : (
                <span className={i === arr.length - 1 ? 'text-ink-mute' : ''}>{c.label}</span>
              )}
              {i < arr.length - 1 && <span aria-hidden>›</span>}
            </li>
          ))}
        </ol>
      </nav>

      {/* 홈 — 처리 대기(실시간 건수). 정적 바로가기(QUICK_TASKS)의 상위 호환이라 그것을 대체한다:
          같은 업무 진입점이면서 "지금 몇 건 밀려 있는지"까지 보여준다. */}
      {tab === 'dashboard' && (
        <AdminWorkQueueBar
          // 병합된 구 key 로 가리킬 수 있으므로 가시성도 통합 탭 기준으로 본다.
          isTabVisible={(t) => visibleKeys.has(((resolveMergedTab(t)?.tab ?? t) as Tab))}
          onNavigate={(t, view) => selectTab(t as Tab, view)}
        />
      )}

      {/* 한 탭 패널의 렌더 throw 가 관리자 페이지 전체를 화이트스크린시키지 않도록 격리.
          resetKey=tab 로 탭 전환 시 직전 탭의 에러 상태를 자동 초기화.
          X6.39: lazy chunk 로드 중 fallback skeleton 표시. */}
      <AdminErrorBoundary resetKey={tab}>
        {/* dashboard 는 eager 라 Suspense 밖에서 즉시 렌더 */}
        {tab === 'dashboard' && <Dashboard />}
        <Suspense fallback={<TabSkeleton />}>
          {tab === 'brand-player' && <BrandPlayerPanel />}
          {tab === 'support-inquiries' && <SupportInquiriesPanel />}
          {tab === 'members' && <MembersList />}
          {tab === 'member-broadcast' && <MemberBroadcastPanel />}
          {tab === 'curators' && <CuratorsAdminPanel />}
          {tab === 'enterprise-overview' && (
            <EnterpriseControlCenterPanel
              initialView={controlCenterView}
              allowedViews={allowedControlViews}
            />
          )}
          {tab === 'enterprise-accounts' && <EnterpriseAccountsPanel />}
          {tab === 'enterprise-regions' && <EnterpriseRegionsPanel />}
          {tab === 'enterprise-monthly-settlements' && <EnterpriseMonthlySettlementsPanel />}
          {tab === 'store-monitoring' && <StoreStatusPanel initialView={mergedView ?? undefined} />}
          {tab === 'policy-deployment' && (
            <PolicyDeploymentPanel
              onRequestFranchisePolicyNav={requestFranchisePolicyNav}
            />
          )}
          {tab === 'policy-automation' && (
            <PolicyAutomationPanel
              onRequestFranchisePolicyNav={() => requestFranchisePolicyNav('policy-automation')}
            />
          )}
          {tab === 'enterprise-announcements' && <EnterpriseAnnouncementsPanel />}
          {tab === 'enterprise-billing' && <EnterpriseBillingPanel />}
          {tab === 'enterprise-contracts' && <EnterpriseContractsPanel />}
          {tab === 'enterprise-emergency' && <EnterpriseEmergencyBroadcastPanel />}
          {tab === 'enterprise-settlement-center' && <EnterpriseSettlementCenterPanel />}
          {tab === 'brand-registry' && <BrandRegistryPanel />}
          {tab === 'franchise' && (
            <FranchiseManagementPanel
              initialDetailTab={pendingFranchiseDeepLink ?? undefined}
              onConsumedDeepLink={consumeFranchiseDeepLink}
              onPolicyCreatedReturn={
                pendingFranchiseReturnTo ? returnFromFranchiseAfterPolicy : undefined
              }
            />
          )}
          {tab === 'sales-agents' && <SalesAgentsList />}
          {tab === 'sales-partners' && <SalesPartnerApplications />}
          {tab === 'free-trials' && <FreeTrialsPanel />}
          {tab === 'streaming' && <StreamingAnalytics />}
          {tab === 'streaming-v2' && <ShadowV2Panel initialView={mergedView ?? undefined} />}
          {tab === 'revenue' && <RevenueManagement />}
          {tab === 'subscriptions' && <SubscriptionRequests />}
          {tab === 'promotions' && <PromotionCodes />}
          {tab === 'payment-sync' && <PaymentSyncTool />}
          {tab === 'operation-logs' && <AdminOperationLogs />}
          {tab === 'content' && <ContentManagement />}
          {tab === 'auto-playlists' && <AutoPlaylistManager />}
          {tab === 'artists' && <ArtistApprovalList />}
          {tab === 'artist-contracts' && <ArtistContractsList />}
          {tab === 'payout-intake' && (
            <PayoutAccountsPanel initialView={mergedView === 'accounts' || mergedView === 'changes' ? mergedView : 'intake'} />
          )}
          {tab === 'track-review' && <TrackReviewList />}
          {tab === 'qc-review' && <QcReviewQueuePanel />}
          {tab === 'artist-tracks' && <ArtistTrackManagementList />}
          {tab === 'deleted-tracks' && <ArtistTrackManagementList removedView />}
          {tab === 'audio-reencode' && <AudioReencodePanel />}
          {tab === 'audio-diagnostics' && <AudioDiagnosticPanel />}
          {tab === 'audio-engine-diagnostics' && <AudioEngineDiagnosticsPanel />}
          {tab === 'metadata-violations' && <MetadataViolationsList />}
          {tab === 'upload-audit' && <UploadChecksPanel initialView={mergedView ?? undefined} />}
          {tab === 'ai-curation' && <AiCurationPanel />}
          {tab === 'clap-curation' && <ClapRecommendationPanel />}
          {tab === 'ai-metadata' && <TrackAiMetadataPanel />}
          {tab === 'ai-taxonomy' && <TaxonomyManagerPanel />}
          {tab === 'ai-genre' && <AiClassificationPanel initialView={mergedView ?? undefined} />}
          {tab === 'placement-audit' && <PlacementAuditPanel />}
          {tab === 'site-settings' && <SiteConfigPanel initialView={mergedView ?? undefined} />}
          {tab === 'site-notices' && <SiteNoticesManagerPanel />}
          {tab === 'artist-settlements' && <ArtistSettlementsList />}
          {tab === 'recommendation' && <RecommendationTester />}
          {tab === 'admins' && <AdminUsersList />}
        </Suspense>
      </AdminErrorBoundary>
    </div>
  );
}
