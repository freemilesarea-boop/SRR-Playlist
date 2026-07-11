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
  Image as ImageIcon,
  Bell,
  Activity,
  MessageSquare,
  Compass,
} from 'lucide-react';
// X6.39 — Eager (초기 admin 진입 시 표시)
import OnboardingChecklist from '@/components/admin/OnboardingChecklist';
import Dashboard from '@/components/admin/Dashboard';
import AdminNotificationsBell from '@/components/admin/AdminNotificationsBell';
import AdminErrorBoundary from '@/components/admin/AdminErrorBoundary';
import { fetchMyAdminPermissions, type AdminPermissions } from '@/lib/adminRbacApi';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { supabaseProjectRef } from '@/lib/supabase';

// X6.39 — Lazy split — 41개 admin 탭 (탭 클릭 시 chunk 로드)
const ArtistApprovalList = lazy(() => import('@/components/admin/ArtistApprovalList'));
const ArtistContractsList = lazy(() => import('@/components/admin/ArtistContractsList'));
const ArtistTrackManagementList = lazy(() => import('@/components/admin/ArtistTrackManagementList'));
const ArtistSettlementsList = lazy(() => import('@/components/admin/ArtistSettlementsList'));
const TrackReviewList = lazy(() => import('@/components/admin/TrackReviewList'));
const QcReviewQueuePanel = lazy(() => import('@/components/admin/QcReviewQueuePanel'));
const PayoutVerificationList = lazy(() => import('@/components/admin/PayoutVerificationList'));
const PayoutIntakeAdminPanel = lazy(() => import('@/components/admin/PayoutIntakeAdminPanel'));
const PaymentSyncTool = lazy(() => import('@/components/admin/PaymentSyncTool'));
const AdminOperationLogs = lazy(() => import('@/components/admin/AdminOperationLogs'));
const SalesAgentsList = lazy(() => import('@/components/admin/SalesAgentsList'));
const FreeTrialsPanel = lazy(() => import('@/components/admin/FreeTrialsPanel'));
const AdminUsersList = lazy(() => import('@/components/admin/AdminUsersList'));
const UploadIntegrityPanel = lazy(() => import('@/components/admin/UploadIntegrityPanel'));
const BrandSettingsPanel = lazy(() => import('@/components/admin/BrandSettingsPanel'));
const MembersList = lazy(() => import('@/components/admin/MembersList'));
const StreamingAnalytics = lazy(() => import('@/components/admin/StreamingAnalytics'));
const StreamingV2Panel = lazy(() => import('@/components/admin/StreamingV2Panel'));
const SettlementV2Panel = lazy(() => import('@/components/admin/SettlementV2Panel'));
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
const UploadAuditPanel = lazy(() => import('@/components/admin/UploadAuditPanel'));
const AiCurationPanel = lazy(() => import('@/components/admin/AiCurationPanel'));
const ClapRecommendationPanel = lazy(() => import('@/components/admin/ClapRecommendationPanel'));
const TrackAiMetadataPanel = lazy(() => import('@/components/admin/TrackAiMetadataPanel'));
const TaxonomyManagerPanel = lazy(() => import('@/components/admin/TaxonomyManagerPanel'));
const GenrePredictionPanel = lazy(() => import('@/components/admin/GenrePredictionPanel'));
const MoodPredictionPanel = lazy(() => import('@/components/admin/MoodPredictionPanel'));
const StoreTypePredictionPanel = lazy(() => import('@/components/admin/StoreTypePredictionPanel'));
const PlacementAuditPanel = lazy(() => import('@/components/admin/PlacementAuditPanel'));
const SiteSettingsPanel = lazy(() => import('@/components/admin/SiteSettingsPanel'));
const SiteNoticesManagerPanel = lazy(() => import('@/components/admin/SiteNoticesManagerPanel'));
const SalesPartnerApplications = lazy(() => import('@/components/admin/SalesPartnerApplications'));
const FranchiseManagementPanel = lazy(() => import('@/components/admin/FranchiseManagementPanel'));
const EnterpriseOverviewPanel = lazy(() => import('@/components/admin/EnterpriseOverviewPanel'));
const EnterpriseAccountsPanel = lazy(() => import('@/components/admin/EnterpriseAccountsPanel'));
const EnterpriseRegionsPanel = lazy(() => import('@/components/admin/EnterpriseRegionsPanel'));
const EnterpriseMonthlySettlementsPanel = lazy(() => import('@/components/admin/EnterpriseMonthlySettlementsPanel'));
const StoreMonitoringPanel = lazy(() => import('@/components/admin/StoreMonitoringPanel'));
const StoreNowPlayingPanel = lazy(() => import('@/components/admin/StoreNowPlayingPanel'));
const PolicyDeploymentPanel = lazy(() => import('@/components/admin/PolicyDeploymentPanel'));
const PolicyAutomationPanel = lazy(() => import('@/components/admin/PolicyAutomationPanel'));
const EnterpriseAnnouncementsPanel = lazy(() => import('@/components/admin/EnterpriseAnnouncementsPanel'));
const EnterpriseBillingPanel = lazy(() => import('@/components/admin/EnterpriseBillingPanel'));
const EnterpriseContractsPanel = lazy(() => import('@/components/admin/EnterpriseContractsPanel'));
const EnterpriseEmergencyBroadcastPanel = lazy(() => import('@/components/admin/EnterpriseEmergencyBroadcastPanel'));
const EnterpriseNocPanel = lazy(() => import('@/components/admin/EnterpriseNocPanel'));
const EnterpriseOperationsPanel = lazy(() => import('@/components/admin/EnterpriseOperationsPanel'));
const EnterpriseSettlementCenterPanel = lazy(() => import('@/components/admin/EnterpriseSettlementCenterPanel'));
const BrandRegistryPanel = lazy(() => import('@/components/admin/BrandRegistryPanel'));
const EnterpriseCommandCenterPanel = lazy(() => import('@/components/admin/EnterpriseCommandCenterPanel'));
const BusinessLivePanel = lazy(() => import('@/components/admin/BusinessLivePanel'));
const SupportInquiriesPanel = lazy(() => import('@/components/admin/SupportInquiriesPanel'));
const CuratorsAdminPanel = lazy(() => import('@/components/admin/CuratorsAdminPanel'));
const BrandPlayerPanel = lazy(() => import('@/components/admin/BrandPlayerPanel'));
const RuntimeTelemetryPanel = lazy(() => import('@/components/admin/RuntimeTelemetryPanel'));
const StoreFleetDashboard = lazy(() => import('@/components/admin/StoreFleetDashboard'));
const StreamingQualityDashboard = lazy(() => import('@/components/admin/StreamingQualityDashboard'));
const OperationsDashboardV2 = lazy(() => import('@/components/admin/OperationsDashboardV2'));
const OperationsGovernanceCenter = lazy(() => import('@/components/admin/OperationsGovernanceCenter'));
const UnifiedOperationsCenter = lazy(() => import('@/components/admin/UnifiedOperationsCenter'));

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
  | 'brand-player'
  | 'runtime-telemetry'
  | 'store-fleet'
  | 'streaming-quality'
  | 'ops-intelligence'
  | 'ops-governance'
  | 'ops-center';

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode; superOnly?: boolean }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'business-live', label: '매장 실시간', icon: <Activity size={14} /> },
  { key: 'brand-player', label: '브랜드 플레이어', icon: <StoreIcon size={14} />, superOnly: true },
  { key: 'support-inquiries', label: '문의관리', icon: <MessageSquare size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
  { key: 'curators', label: '큐레이터 관리', icon: <Users size={14} /> },
  { key: 'enterprise-overview', label: '엔터프라이즈 현황', icon: <Building2 size={14} /> },
  { key: 'enterprise-accounts', label: '본사 계정', icon: <Building2 size={14} /> },
  { key: 'enterprise-regions', label: '지역 관리', icon: <Building2 size={14} /> },
  { key: 'enterprise-monthly-settlements', label: '본사 월 정산', icon: <Wallet size={14} /> },
  { key: 'store-monitoring', label: '매장 상태', icon: <Activity size={14} /> },
  { key: 'store-now-playing', label: '실시간 재생', icon: <Music size={14} /> },
  { key: 'policy-deployment', label: '음악 배포 현황', icon: <ShieldCheck size={14} /> },
  { key: 'policy-automation', label: '자동 음악 스케줄', icon: <ShieldCheck size={14} /> },
  { key: 'enterprise-announcements', label: '안내/광고 음원', icon: <Music size={14} /> },
  { key: 'enterprise-emergency', label: '긴급 방송', icon: <Music size={14} /> },
  { key: 'enterprise-noc', label: '운영센터', icon: <Activity size={14} /> },
  { key: 'enterprise-command-center', label: '엔터프라이즈 Command Center', icon: <Compass size={14} />, superOnly: true },
  { key: 'enterprise-operations', label: '운영 관제', icon: <Activity size={14} />, superOnly: true },
  { key: 'enterprise-settlement-center', label: '정산·청구 통합', icon: <Wallet size={14} />, superOnly: true },
  { key: 'brand-registry', label: '브랜드 관리', icon: <Building2 size={14} />, superOnly: true },
  { key: 'enterprise-billing', label: '본사 청구', icon: <Wallet size={14} /> },
  { key: 'enterprise-contracts', label: '계약 관리', icon: <ShieldCheck size={14} /> },
  { key: 'franchise', label: '프랜차이즈 관리', icon: <StoreIcon size={14} /> },
  { key: 'sales-agents', label: '영업인 관리', icon: <Handshake size={14} /> },
  { key: 'sales-partners', label: '영업 파트너 신청', icon: <Handshake size={14} /> },
  { key: 'free-trials', label: '무료 체험', icon: <Gift size={14} /> },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} /> },
  { key: 'streaming-v2', label: '스트리밍 v2 (Shadow)', icon: <Headphones size={14} />, superOnly: true },
  { key: 'settlement-v2', label: '정산 v2 (Shadow)', icon: <Wallet size={14} />, superOnly: true },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} /> },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} /> },
  { key: 'promotions', label: '프로모션', icon: <Ticket size={14} /> },
  { key: 'payment-sync', label: '결제 동기화', icon: <CreditCard size={14} /> },
  { key: 'operation-logs', label: '운영 로그', icon: <ScrollText size={14} /> },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} /> },
  { key: 'auto-playlists', label: '자동 플리/배치', icon: <Sparkles size={14} /> },
  { key: 'artists', label: '아티스트 승인', icon: <Mic2 size={14} /> },
  { key: 'artist-contracts', label: '아티스트 계약', icon: <FileSignature size={14} /> },
  { key: 'payout-verification', label: '계좌 확인', icon: <Wallet size={14} /> },
  { key: 'payout-intake', label: '정산 정보 신청', icon: <Wallet size={14} /> },
  { key: 'track-review', label: '음원 검수', icon: <Mic2 size={14} /> },
  { key: 'qc-review', label: 'AI QC 검수', icon: <Sparkles size={14} /> },
  { key: 'artist-tracks', label: '음원 관리', icon: <Music size={14} /> },
  { key: 'deleted-tracks', label: '삭제 음원', icon: <Trash2 size={14} /> },
  { key: 'audio-reencode', label: '오디오 변환(iOS)', icon: <Smartphone size={14} /> },
  { key: 'audio-diagnostics', label: '오디오 진단', icon: <Stethoscope size={14} /> },
  { key: 'audio-engine-diagnostics', label: '오디오 엔진 진단', icon: <Activity size={14} />, superOnly: true },
  { key: 'metadata-violations', label: '메타데이터 위반 의심', icon: <AlertTriangle size={14} /> },
  { key: 'upload-audit', label: '업로드/스토리지 점검', icon: <HardDrive size={14} /> },
  { key: 'ai-curation', label: 'AI 큐레이션', icon: <Sparkles size={14} /> },
  { key: 'clap-curation', label: 'CLAP 추천', icon: <Sparkles size={14} /> },
  { key: 'ai-metadata', label: 'AI 메타데이터', icon: <Sparkles size={14} /> },
  { key: 'ai-taxonomy', label: 'AI 분류 체계', icon: <Sparkles size={14} /> },
  { key: 'ai-genre', label: 'AI 장르 분류', icon: <Sparkles size={14} /> },
  { key: 'ai-mood', label: 'AI 무드 분류', icon: <Sparkles size={14} /> },
  { key: 'ai-storetype', label: 'AI 매장 유형', icon: <Sparkles size={14} /> },
  { key: 'placement-audit', label: 'AI 배치 진단', icon: <ShieldCheck size={14} /> },
  { key: 'site-settings', label: '사이트 설정', icon: <ShieldCheck size={14} /> },
  { key: 'site-notices', label: '공지/팝업', icon: <Bell size={14} /> },
  { key: 'artist-settlements', label: '아티스트 정산', icon: <Wallet size={14} /> },
  { key: 'recommendation', label: '추천 테스트', icon: <Sparkles size={14} /> },
  { key: 'upload-integrity', label: '업로드 무결성', icon: <ShieldCheck size={14} /> },
  { key: 'brand', label: '브랜드 로고', icon: <ImageIcon size={14} /> },
  { key: 'admins', label: '관리자 설정', icon: <ShieldCheck size={14} />, superOnly: true },
  { key: 'runtime-telemetry', label: '런타임 텔레메트리', icon: <Activity size={14} />, superOnly: true },
  { key: 'store-fleet', label: '매장 Fleet 관제', icon: <Activity size={14} />, superOnly: true },
  { key: 'streaming-quality', label: '스트리밍 품질', icon: <Activity size={14} />, superOnly: true },
  { key: 'ops-intelligence', label: '운영 인텔리전스', icon: <Activity size={14} />, superOnly: true },
  { key: 'ops-governance', label: '운영 거버넌스', icon: <ShieldCheck size={14} />, superOnly: true },
  { key: 'ops-center', label: '통합 운영 센터', icon: <LayoutDashboard size={14} />, superOnly: true },
];

/** 28개 탭을 의미 단위 6그룹으로 묶어 2-level 네비. 운영자가 평소 자주 가는 탭에 빠르게 도달. */
type Group = '운영' | '회원' | '엔터프라이즈' | '매출/결제' | '아티스트' | '콘텐츠/오디오' | '설정';

const GROUPS: Array<{ key: Group; tabs: Tab[] }> = [
  { key: '운영', tabs: ['dashboard', 'business-live', 'brand-player', 'support-inquiries'] },
  { key: '회원', tabs: ['members', 'curators', 'sales-agents', 'free-trials'] },
  { key: '엔터프라이즈', tabs: ['enterprise-command-center', 'enterprise-operations', 'enterprise-settlement-center', 'brand-registry', 'enterprise-noc', 'enterprise-overview', 'enterprise-accounts', 'enterprise-regions', 'enterprise-contracts', 'enterprise-monthly-settlements', 'enterprise-billing', 'store-monitoring', 'store-now-playing', 'policy-deployment', 'policy-automation', 'enterprise-announcements', 'enterprise-emergency', 'franchise'] },
  { key: '매출/결제', tabs: ['streaming', 'streaming-v2', 'settlement-v2', 'revenue', 'subscriptions', 'promotions', 'payment-sync', 'operation-logs'] },
  {
    key: '아티스트',
    tabs: [
      'artists',
      'artist-contracts',
      'payout-intake',
      'payout-verification',
      'track-review',
      'qc-review',
      'artist-tracks',
      'deleted-tracks',
      'artist-settlements',
    ],
  },
  {
    key: '콘텐츠/오디오',
    tabs: [
      'content',
      'auto-playlists',
      'audio-reencode',
      'audio-diagnostics',
      'audio-engine-diagnostics',
      'metadata-violations',
      'upload-audit',
      'ai-curation',
      'clap-curation',
      'ai-metadata',
      'ai-taxonomy',
      'ai-genre',
      'ai-mood',
      'ai-storetype',
      'placement-audit',
      'recommendation',
      'upload-integrity',
    ],
  },
  { key: '설정', tabs: ['site-settings', 'site-notices', 'brand', 'admins', 'runtime-telemetry', 'store-fleet', 'streaming-quality', 'ops-intelligence', 'ops-governance', 'ops-center'] },
];

function groupOf(tab: Tab): Group {
  for (const g of GROUPS) {
    if (g.tabs.includes(tab)) return g.key;
  }
  return '운영';
}

/**
 * IA/Nav 정리 — Enterprise 그룹 내 서브그룹 (2단계 nav, 기존 구조 무영향).
 *   • 기존 GROUPS['엔터프라이즈'].tabs 전체가 covered 되어야 함.
 *   • 기존 URL param ?tab=X 접근은 그대로 유지 (subgroup 자동 동기화).
 *   • 기존 Panel/RPC/API 무영향.
 */
type EnterpriseSubgroup = '종합' | '브랜드·본사' | '매장 운영' | '음악·정책' | '청구·정산' | '시스템 관제';

const ENTERPRISE_SUBGROUPS: Array<{ key: EnterpriseSubgroup; tabs: Tab[] }> = [
  { key: '종합',       tabs: ['enterprise-command-center', 'enterprise-overview'] },
  { key: '브랜드·본사', tabs: ['brand-registry', 'enterprise-accounts', 'enterprise-regions', 'franchise'] },
  { key: '매장 운영',   tabs: ['store-monitoring', 'store-now-playing'] },
  { key: '음악·정책',   tabs: ['policy-deployment', 'policy-automation', 'enterprise-announcements', 'enterprise-emergency'] },
  { key: '청구·정산',   tabs: ['enterprise-contracts', 'enterprise-billing', 'enterprise-monthly-settlements', 'enterprise-settlement-center'] },
  { key: '시스템 관제', tabs: ['enterprise-noc', 'enterprise-operations'] },
];

function enterpriseSubgroupOf(tab: Tab): EnterpriseSubgroup {
  for (const sg of ENTERPRISE_SUBGROUPS) {
    if (sg.tabs.includes(tab)) return sg.key;
  }
  return '종합';
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [group, setGroup] = useState<Group>(groupOf('dashboard'));
  // IA/Nav — Enterprise 그룹 내 서브그룹 선택 상태 (기존 로직 무영향)
  const [enterpriseSubgroup, setEnterpriseSubgroup] = useState<EnterpriseSubgroup>('종합');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [perms, setPerms] = useState<AdminPermissions | null>(null);

  // Phase 1-5.1 — cross-탭 deep link: 정책 적용률 → 프랜차이즈 관리 (정책 탭) → 정책 생성 후 자동 복귀.
  // pendingFranchiseDeepLink: 한 번 자동 진입 후 consume.
  // pendingFranchiseReturnTo: 정책 생성 성공 시 복귀할 탭. 사용자가 수동으로 다른 탭으로 가면 자동 클리어.
  const [pendingFranchiseDeepLink, setPendingFranchiseDeepLink] =
    useState<'stores' | 'policies' | 'schedule' | 'sync' | null>(null);
  const [pendingFranchiseReturnTo, setPendingFranchiseReturnTo] = useState<Tab | null>(null);

  useEffect(() => { fetchMyAdminPermissions().then(setPerms).catch(() => {}); }, []);

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
        const t = params.get('tab');
        if (isValidTab(t)) {
          setTab(t);
          setGroup(groupOf(t));
          if (groupOf(t) === '엔터프라이즈') setEnterpriseSubgroup(enterpriseSubgroupOf(t));
        }
      } catch { /* silent */ }
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  const visibleTabs = TABS.filter((t) => !t.superOnly || perms?.is_super_admin);
  const enterpriseTabs = visibleTabs.filter((t) =>
    (GROUPS.find((g) => g.key === '엔터프라이즈')?.tabs ?? []).includes(t.key),
  );

  // 방탄 filtering — useMemo 로 안정화. 엔터프라이즈 그룹일 때는 반드시 서브그룹 필터만 적용.
  // 원본 GROUPS['엔터프라이즈'] 전체 리스트가 실수로 노출되는 경로 없음.
  const displayTabs = useMemo(() => {
    if (group === '엔터프라이즈') {
      const subgroupTabKeys = ENTERPRISE_SUBGROUPS.find((s) => s.key === enterpriseSubgroup)?.tabs ?? [];
      const filtered = enterpriseTabs.filter((t) => subgroupTabKeys.includes(t.key));
      // 서브그룹에 해당하는 탭이 하나도 없으면 (권한 등) '종합' 로 fallback — 빈 nav 방지
      if (filtered.length === 0 && enterpriseSubgroup !== '종합') {
        const jonghapKeys = ENTERPRISE_SUBGROUPS.find((s) => s.key === '종합')?.tabs ?? [];
        return enterpriseTabs.filter((t) => jonghapKeys.includes(t.key));
      }
      return filtered;
    }
    // 다른 그룹은 기존 동작 그대로
    return visibleTabs.filter((t) =>
      (GROUPS.find((g) => g.key === group)?.tabs ?? []).includes(t.key),
    );
  }, [group, enterpriseSubgroup, enterpriseTabs, visibleTabs]);

  // group 변경 시 enterpriseSubgroup 이 유효한지 확인. 엔터프라이즈로 이동했는데 서브그룹이
  // 다른 그룹의 잔재라면 '종합' 으로 리셋. 반대로 다른 그룹이면 subgroup 무영향.
  useEffect(() => {
    if (group === '엔터프라이즈') {
      const valid = ENTERPRISE_SUBGROUPS.some((s) => s.key === enterpriseSubgroup);
      if (!valid) setEnterpriseSubgroup('종합');
    }
  }, [group, enterpriseSubgroup]);

  // 탭 직접 클릭(예: 외부 링크) 시 그룹 + 서브그룹 자동 동기화
  function selectTab(next: Tab) {
    setTab(next);
    setGroup(groupOf(next));
    if (groupOf(next) === '엔터프라이즈') setEnterpriseSubgroup(enterpriseSubgroupOf(next));
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
    }
  }, [pendingFranchiseReturnTo]);

  // 그룹 클릭 시 그 그룹의 첫 가시 탭으로 자동 진입 — 빈 panel 회피
  function selectGroup(next: Group) {
    setGroup(next);
    // 엔터프라이즈 그룹은 서브그룹 '종합' + 그 서브그룹의 첫 가시 탭으로 고정 진입
    if (next === '엔터프라이즈') {
      setEnterpriseSubgroup('종합');
      const first = visibleTabs.find((t) =>
        (ENTERPRISE_SUBGROUPS.find((s) => s.key === '종합')?.tabs ?? []).includes(t.key),
      );
      if (first) setTab(first.key);
      return;
    }
    const firstInGroup = visibleTabs.find((t) =>
      (GROUPS.find((g) => g.key === next)?.tabs ?? []).includes(t.key),
    );
    if (firstInGroup) setTab(firstInGroup.key);
  }

  // 엔터프라이즈 서브그룹 클릭 시 그 서브그룹의 첫 가시 탭으로 자동 진입
  function selectEnterpriseSubgroup(next: EnterpriseSubgroup) {
    setEnterpriseSubgroup(next);
    const first = visibleTabs.find((t) =>
      (ENTERPRISE_SUBGROUPS.find((s) => s.key === next)?.tabs ?? []).includes(t.key),
    );
    if (first) setTab(first.key);
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
            대시보드 · 회원 · 스트리밍 · 매출 · 구독 · 콘텐츠
          </p>
          <p className="text-[10px] font-mono text-ink-dim">
            Connected Supabase: <span className="text-accent">{supabaseProjectRef}</span>
          </p>
        </div>
        <AdminNotificationsBell />
      </header>

      <OnboardingChecklist tracks={tracks} playlists={playlists} />

      {/* 2-level nav — 1열: 그룹, 2열: 그룹 내 탭. 28개 한 줄 스크롤 → 의미 단위 묶음. */}
      <nav className="space-y-2">
        {/* 그룹 nav */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex gap-1.5 pb-1 no-scrollbar">
            {GROUPS.map((g) => {
              const hasVisible = visibleTabs.some((t) => g.tabs.includes(t.key));
              if (!hasVisible) return null;
              const isActive = group === g.key;
              return (
                <button
                  key={g.key}
                  onClick={() => selectGroup(g.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
                    isActive
                      ? 'bg-ink text-bg ring-1 ring-ink'
                      : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink hover:ring-line/20'
                  }`}
                >
                  {g.key}
                </button>
              );
            })}
          </div>
        </div>
        {/* IA/Nav — 엔터프라이즈 그룹만 서브그룹 chip row 노출. 다른 그룹은 기존 그대로. */}
        {group === '엔터프라이즈' && (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <div className="flex gap-1.5 pb-1 no-scrollbar">
              {ENTERPRISE_SUBGROUPS.map((sg) => {
                const hasVisible = enterpriseTabs.some((t) => sg.tabs.includes(t.key));
                if (!hasVisible) return null;
                const isActive = enterpriseSubgroup === sg.key;
                return (
                  <button
                    key={sg.key}
                    onClick={() => selectEnterpriseSubgroup(sg.key)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                      isActive
                        ? 'bg-violet-500/25 text-slate-900 dark:text-violet-100 ring-1 ring-violet-400/50'
                        : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink hover:ring-line/20'
                    }`}
                  >
                    {sg.key}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* 탭 nav (선택 그룹 내, 엔터프라이즈면 서브그룹 필터 적용) */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex gap-1.5 pb-1 no-scrollbar">
            {displayTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => selectTab(t.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                  tab === t.key
                    ? 'bg-accent text-black'
                    : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* 한 탭 패널의 렌더 throw 가 관리자 페이지 전체를 화이트스크린시키지 않도록 격리.
          resetKey=tab 로 탭 전환 시 직전 탭의 에러 상태를 자동 초기화.
          X6.39: lazy chunk 로드 중 fallback skeleton 표시. */}
      <AdminErrorBoundary resetKey={tab}>
        {/* dashboard 는 eager 라 Suspense 밖에서 즉시 렌더 */}
        {tab === 'dashboard' && <Dashboard />}
        <Suspense fallback={<TabSkeleton />}>
          {tab === 'business-live' && <BusinessLivePanel />}
          {tab === 'brand-player' && <BrandPlayerPanel />}
          {tab === 'support-inquiries' && <SupportInquiriesPanel />}
          {tab === 'members' && <MembersList />}
          {tab === 'curators' && <CuratorsAdminPanel />}
          {tab === 'enterprise-overview' && <EnterpriseOverviewPanel />}
          {tab === 'enterprise-accounts' && <EnterpriseAccountsPanel />}
          {tab === 'enterprise-regions' && <EnterpriseRegionsPanel />}
          {tab === 'enterprise-monthly-settlements' && <EnterpriseMonthlySettlementsPanel />}
          {tab === 'store-monitoring' && <StoreMonitoringPanel />}
          {tab === 'store-now-playing' && <StoreNowPlayingPanel />}
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
          {tab === 'enterprise-noc' && <EnterpriseNocPanel />}
          {tab === 'enterprise-command-center' && <EnterpriseCommandCenterPanel />}
          {tab === 'enterprise-operations' && <EnterpriseOperationsPanel />}
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
          {tab === 'streaming-v2' && <StreamingV2Panel />}
          {tab === 'settlement-v2' && <SettlementV2Panel />}
          {tab === 'revenue' && <RevenueManagement />}
          {tab === 'subscriptions' && <SubscriptionRequests />}
          {tab === 'promotions' && <PromotionCodes />}
          {tab === 'payment-sync' && <PaymentSyncTool />}
          {tab === 'operation-logs' && <AdminOperationLogs />}
          {tab === 'content' && <ContentManagement />}
          {tab === 'auto-playlists' && <AutoPlaylistManager />}
          {tab === 'artists' && <ArtistApprovalList />}
          {tab === 'artist-contracts' && <ArtistContractsList />}
          {tab === 'payout-verification' && <PayoutVerificationList />}
          {tab === 'payout-intake' && <PayoutIntakeAdminPanel />}
          {tab === 'track-review' && <TrackReviewList />}
          {tab === 'qc-review' && <QcReviewQueuePanel />}
          {tab === 'artist-tracks' && <ArtistTrackManagementList />}
          {tab === 'deleted-tracks' && <ArtistTrackManagementList removedView />}
          {tab === 'audio-reencode' && <AudioReencodePanel />}
          {tab === 'audio-diagnostics' && <AudioDiagnosticPanel />}
          {tab === 'audio-engine-diagnostics' && <AudioEngineDiagnosticsPanel />}
          {tab === 'metadata-violations' && <MetadataViolationsList />}
          {tab === 'upload-audit' && <UploadAuditPanel />}
          {tab === 'ai-curation' && <AiCurationPanel />}
          {tab === 'clap-curation' && <ClapRecommendationPanel />}
          {tab === 'ai-metadata' && <TrackAiMetadataPanel />}
          {tab === 'ai-taxonomy' && <TaxonomyManagerPanel />}
          {tab === 'ai-genre' && <GenrePredictionPanel />}
          {tab === 'ai-mood' && <MoodPredictionPanel />}
          {tab === 'ai-storetype' && <StoreTypePredictionPanel />}
          {tab === 'placement-audit' && <PlacementAuditPanel />}
          {tab === 'site-settings' && <SiteSettingsPanel />}
          {tab === 'site-notices' && <SiteNoticesManagerPanel />}
          {tab === 'artist-settlements' && <ArtistSettlementsList />}
          {tab === 'recommendation' && <RecommendationTester />}
          {tab === 'upload-integrity' && <UploadIntegrityPanel />}
          {tab === 'brand' && <BrandSettingsPanel />}
          {tab === 'admins' && <AdminUsersList />}
          {tab === 'runtime-telemetry' && <RuntimeTelemetryPanel />}
          {tab === 'store-fleet' && <StoreFleetDashboard />}
          {tab === 'streaming-quality' && <StreamingQualityDashboard />}
          {tab === 'ops-intelligence' && <OperationsDashboardV2 />}
          {tab === 'ops-governance' && <OperationsGovernanceCenter />}
          {tab === 'ops-center' && <UnifiedOperationsCenter />}
        </Suspense>
      </AdminErrorBoundary>
    </div>
  );
}
