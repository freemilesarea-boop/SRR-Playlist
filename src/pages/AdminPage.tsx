import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import ArtistApprovalList from '@/components/admin/ArtistApprovalList';
import ArtistContractsList from '@/components/admin/ArtistContractsList';
import ArtistTrackManagementList from '@/components/admin/ArtistTrackManagementList';
import ArtistSettlementsList from '@/components/admin/ArtistSettlementsList';
import TrackReviewList from '@/components/admin/TrackReviewList';
import QcReviewQueuePanel from '@/components/admin/QcReviewQueuePanel';
import PayoutVerificationList from '@/components/admin/PayoutVerificationList';
import PaymentSyncTool from '@/components/admin/PaymentSyncTool';
import AdminOperationLogs from '@/components/admin/AdminOperationLogs';
import SalesAgentsList from '@/components/admin/SalesAgentsList';
import FreeTrialsPanel from '@/components/admin/FreeTrialsPanel';
import AdminUsersList from '@/components/admin/AdminUsersList';
import UploadIntegrityPanel from '@/components/admin/UploadIntegrityPanel';
import BrandSettingsPanel from '@/components/admin/BrandSettingsPanel';
import { fetchMyAdminPermissions, type AdminPermissions } from '@/lib/adminRbacApi';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import OnboardingChecklist from '@/components/admin/OnboardingChecklist';
import Dashboard from '@/components/admin/Dashboard';
import AdminNotificationsBell from '@/components/admin/AdminNotificationsBell';
import MembersList from '@/components/admin/MembersList';
import StreamingAnalytics from '@/components/admin/StreamingAnalytics';
import RevenueManagement from '@/components/admin/RevenueManagement';
import SubscriptionRequests from '@/components/admin/SubscriptionRequests';
import ContentManagement from '@/components/admin/ContentManagement';
import RecommendationTester from '@/components/admin/RecommendationTester';
import PromotionCodes from '@/components/admin/PromotionCodes';
import AutoPlaylistManager from '@/components/admin/AutoPlaylistManager';
import AdminErrorBoundary from '@/components/admin/AdminErrorBoundary';
import AudioReencodePanel from '@/components/admin/AudioReencodePanel';
import AudioDiagnosticPanel from '@/components/admin/AudioDiagnosticPanel';
import MetadataViolationsList from '@/components/admin/MetadataViolationsList';
import UploadAuditPanel from '@/components/admin/UploadAuditPanel';
import AiCurationPanel from '@/components/admin/AiCurationPanel';
import ClapRecommendationPanel from '@/components/admin/ClapRecommendationPanel';
import TrackAiMetadataPanel from '@/components/admin/TrackAiMetadataPanel';
import TaxonomyManagerPanel from '@/components/admin/TaxonomyManagerPanel';
import GenrePredictionPanel from '@/components/admin/GenrePredictionPanel';
import SiteSettingsPanel from '@/components/admin/SiteSettingsPanel';
import SiteNoticesManagerPanel from '@/components/admin/SiteNoticesManagerPanel';
import SalesPartnerApplications from '@/components/admin/SalesPartnerApplications';
import { supabaseProjectRef } from '@/lib/supabase';

type Tab =
  | 'dashboard'
  | 'members'
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
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
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
  { key: 'site-settings', label: '사이트 설정', icon: <ShieldCheck size={14} /> },
  { key: 'site-notices', label: '공지/팝업', icon: <Bell size={14} /> },
  { key: 'artist-settlements', label: '아티스트 정산', icon: <Wallet size={14} /> },
  { key: 'recommendation', label: '추천 테스트', icon: <Sparkles size={14} /> },
  { key: 'upload-integrity', label: '업로드 무결성', icon: <ShieldCheck size={14} /> },
  { key: 'brand', label: '브랜드 로고', icon: <ImageIcon size={14} /> },
  { key: 'admins', label: '관리자 설정', icon: <ShieldCheck size={14} />, superOnly: true },
];

/** 28개 탭을 의미 단위 6그룹으로 묶어 2-level 네비. 운영자가 평소 자주 가는 탭에 빠르게 도달. */
type Group = '운영' | '회원' | '매출/결제' | '아티스트' | '콘텐츠/오디오' | '설정';

const GROUPS: Array<{ key: Group; tabs: Tab[] }> = [
  { key: '운영', tabs: ['dashboard'] },
  { key: '회원', tabs: ['members', 'sales-agents', 'free-trials'] },
  { key: '매출/결제', tabs: ['streaming', 'revenue', 'subscriptions', 'promotions', 'payment-sync', 'operation-logs'] },
  {
    key: '아티스트',
    tabs: [
      'artists',
      'artist-contracts',
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
          resetKey=tab 로 탭 전환 시 직전 탭의 에러 상태를 자동 초기화. */}
      <AdminErrorBoundary resetKey={tab}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'members' && <MembersList />}
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
        {tab === 'site-settings' && <SiteSettingsPanel />}
        {tab === 'site-notices' && <SiteNoticesManagerPanel />}
        {tab === 'artist-settlements' && <ArtistSettlementsList />}
        {tab === 'recommendation' && <RecommendationTester />}
        {tab === 'upload-integrity' && <UploadIntegrityPanel />}
        {tab === 'brand' && <BrandSettingsPanel />}
        {tab === 'admins' && <AdminUsersList />}
      </AdminErrorBoundary>
    </div>
  );
}
