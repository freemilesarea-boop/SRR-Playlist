import { useEffect, useState, lazy, Suspense } from 'react';
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
const RevenueManagement = lazy(() => import('@/components/admin/RevenueManagement'));
const SubscriptionRequests = lazy(() => import('@/components/admin/SubscriptionRequests'));
const ContentManagement = lazy(() => import('@/components/admin/ContentManagement'));
const RecommendationTester = lazy(() => import('@/components/admin/RecommendationTester'));
const PromotionCodes = lazy(() => import('@/components/admin/PromotionCodes'));
const AutoPlaylistManager = lazy(() => import('@/components/admin/AutoPlaylistManager'));
const AudioReencodePanel = lazy(() => import('@/components/admin/AudioReencodePanel'));
const AudioDiagnosticPanel = lazy(() => import('@/components/admin/AudioDiagnosticPanel'));
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
const StoreMonitoringPanel = lazy(() => import('@/components/admin/StoreMonitoringPanel'));
const StoreNowPlayingPanel = lazy(() => import('@/components/admin/StoreNowPlayingPanel'));
const PolicyDeploymentPanel = lazy(() => import('@/components/admin/PolicyDeploymentPanel'));
const BusinessLivePanel = lazy(() => import('@/components/admin/BusinessLivePanel'));
const SupportInquiriesPanel = lazy(() => import('@/components/admin/SupportInquiriesPanel'));
const CuratorsAdminPanel = lazy(() => import('@/components/admin/CuratorsAdminPanel'));

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
  | 'store-monitoring'
  | 'store-now-playing'
  | 'policy-deployment'
  | 'franchise'
  | 'sales-agents'
  | 'sales-partners'
  | 'free-trials'
  | 'streaming'
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
  | 'brand';

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode; superOnly?: boolean }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'business-live', label: '매장 실시간', icon: <Activity size={14} /> },
  { key: 'support-inquiries', label: '문의관리', icon: <MessageSquare size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
  { key: 'curators', label: '큐레이터 관리', icon: <Users size={14} /> },
  { key: 'enterprise-overview', label: '엔터프라이즈 종합', icon: <Building2 size={14} /> },
  { key: 'enterprise-accounts', label: '본사 계정', icon: <Building2 size={14} /> },
  { key: 'enterprise-regions', label: '지역 관리', icon: <Building2 size={14} /> },
  { key: 'store-monitoring', label: '매장 상태', icon: <Activity size={14} /> },
  { key: 'store-now-playing', label: '실시간 재생', icon: <Music size={14} /> },
  { key: 'policy-deployment', label: '정책 적용률', icon: <ShieldCheck size={14} /> },
  { key: 'franchise', label: '프랜차이즈 관리', icon: <StoreIcon size={14} /> },
  { key: 'sales-agents', label: '영업인 관리', icon: <Handshake size={14} /> },
  { key: 'sales-partners', label: '영업 파트너 신청', icon: <Handshake size={14} /> },
  { key: 'free-trials', label: '무료 체험', icon: <Gift size={14} /> },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} /> },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} /> },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} /> },
  { key: 'promotions', label: '프로모션', icon: <Ticket size={14} /> },
  { key: 'payment-sync', label: '결제 동기화', icon: <CreditCard size={14} /> },
  { key: 'operation-logs', label: '운영 로그', icon: <ScrollText size={14} /> },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} /> },
  { key: 'auto-playlists', label: '자동 플리/배치', icon: <Sparkles size={14} /> },
  { key: 'artists', label: '아티스트 승인', icon: <Mic2 size={14} /> },
  { key: 'artist-contracts', label: '계약 관리', icon: <FileSignature size={14} /> },
  { key: 'payout-verification', label: '계좌 확인', icon: <Wallet size={14} /> },
  { key: 'payout-intake', label: '정산 정보 신청', icon: <Wallet size={14} /> },
  { key: 'track-review', label: '음원 검수', icon: <Mic2 size={14} /> },
  { key: 'qc-review', label: 'AI QC 검수', icon: <Sparkles size={14} /> },
  { key: 'artist-tracks', label: '음원 관리', icon: <Music size={14} /> },
  { key: 'deleted-tracks', label: '삭제 음원', icon: <Trash2 size={14} /> },
  { key: 'audio-reencode', label: '오디오 변환(iOS)', icon: <Smartphone size={14} /> },
  { key: 'audio-diagnostics', label: '오디오 진단', icon: <Stethoscope size={14} /> },
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
];

/** 28개 탭을 의미 단위 6그룹으로 묶어 2-level 네비. 운영자가 평소 자주 가는 탭에 빠르게 도달. */
type Group = '운영' | '회원' | '엔터프라이즈' | '매출/결제' | '아티스트' | '콘텐츠/오디오' | '설정';

const GROUPS: Array<{ key: Group; tabs: Tab[] }> = [
  { key: '운영', tabs: ['dashboard', 'business-live', 'support-inquiries'] },
  { key: '회원', tabs: ['members', 'curators', 'sales-agents', 'free-trials'] },
  { key: '엔터프라이즈', tabs: ['enterprise-overview', 'enterprise-accounts', 'enterprise-regions', 'store-monitoring', 'store-now-playing', 'policy-deployment', 'franchise'] },
  { key: '매출/결제', tabs: ['streaming', 'revenue', 'subscriptions', 'promotions', 'payment-sync', 'operation-logs'] },
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
  { key: '설정', tabs: ['site-settings', 'site-notices', 'brand', 'admins'] },
];

function groupOf(tab: Tab): Group {
  for (const g of GROUPS) {
    if (g.tabs.includes(tab)) return g.key;
  }
  return '운영';
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [group, setGroup] = useState<Group>(groupOf('dashboard'));
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [perms, setPerms] = useState<AdminPermissions | null>(null);

  useEffect(() => { fetchMyAdminPermissions().then(setPerms).catch(() => {}); }, []);
  const visibleTabs = TABS.filter((t) => !t.superOnly || perms?.is_super_admin);
  const tabsInGroup = visibleTabs.filter((t) =>
    (GROUPS.find((g) => g.key === group)?.tabs ?? []).includes(t.key),
  );

  // 탭 직접 클릭(예: 외부 링크) 시 그룹도 자동 동기화
  function selectTab(next: Tab) {
    setTab(next);
    setGroup(groupOf(next));
  }

  // 그룹 클릭 시 그 그룹의 첫 가시 탭으로 자동 진입 — 빈 panel 회피
  function selectGroup(next: Group) {
    setGroup(next);
    const firstInGroup = visibleTabs.find((t) =>
      (GROUPS.find((g) => g.key === next)?.tabs ?? []).includes(t.key),
    );
    if (firstInGroup) setTab(firstInGroup.key);
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
        {/* 탭 nav (선택 그룹 내) */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex gap-1.5 pb-1 no-scrollbar">
            {tabsInGroup.map((t) => (
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
          {tab === 'support-inquiries' && <SupportInquiriesPanel />}
          {tab === 'members' && <MembersList />}
          {tab === 'curators' && <CuratorsAdminPanel />}
          {tab === 'enterprise-overview' && <EnterpriseOverviewPanel />}
          {tab === 'enterprise-accounts' && <EnterpriseAccountsPanel />}
          {tab === 'enterprise-regions' && <EnterpriseRegionsPanel />}
          {tab === 'store-monitoring' && <StoreMonitoringPanel />}
          {tab === 'store-now-playing' && <StoreNowPlayingPanel />}
          {tab === 'policy-deployment' && (
            <PolicyDeploymentPanel onNavigateToTab={(k) => selectTab(k as Tab)} />
          )}
          {tab === 'franchise' && <FranchiseManagementPanel />}
          {tab === 'sales-agents' && <SalesAgentsList />}
          {tab === 'sales-partners' && <SalesPartnerApplications />}
          {tab === 'free-trials' && <FreeTrialsPanel />}
          {tab === 'streaming' && <StreamingAnalytics />}
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
        </Suspense>
      </AdminErrorBoundary>
    </div>
  );
}
