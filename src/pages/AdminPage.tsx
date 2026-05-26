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
} from 'lucide-react';
import ArtistApprovalList from '@/components/admin/ArtistApprovalList';
import ArtistContractsList from '@/components/admin/ArtistContractsList';
import ArtistTrackManagementList from '@/components/admin/ArtistTrackManagementList';
import ArtistSettlementsList from '@/components/admin/ArtistSettlementsList';
import TrackReviewList from '@/components/admin/TrackReviewList';
import PayoutVerificationList from '@/components/admin/PayoutVerificationList';
import PaymentSyncTool from '@/components/admin/PaymentSyncTool';
import AdminOperationLogs from '@/components/admin/AdminOperationLogs';
import SalesAgentsList from '@/components/admin/SalesAgentsList';
import AdminUsersList from '@/components/admin/AdminUsersList';
import AdminActionLog from '@/components/admin/AdminActionLog';
import { ADMIN_ROLE_LABELS, type AdminPermissions } from '@/lib/adminRbacApi';
import { useAdminPermsStore } from '@/store/adminPermsStore';
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
import { supabaseProjectRef } from '@/lib/supabase';

type Tab =
  | 'dashboard'
  | 'members'
  | 'sales-agents'
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
  | 'artist-tracks'
  | 'deleted-tracks'
  | 'audio-reencode'
  | 'audio-diagnostics'
  | 'metadata-violations'
  | 'upload-audit'
  | 'ai-curation'
  | 'artist-settlements'
  | 'operation-logs'
  | 'action-log'
  | 'admins'
  | 'recommendation';

// 역할별 탭 노출 규칙. super_admin 은 모든 can_* 가 true 이므로 전체 노출.
//  · can_manage_tracks  = content/super   (검수·메타·재검수·음원관리)
//  · can_review_tracks  = reviewer/content/super (승인·검수)
//  · can_manage_curation= curator/super   (플레이리스트·Flow·자동재배치·추천)
//  · can_manage_sales   = sales/super     (영업·매출·구독·프로모션)
//  · is_super_admin     = super 전용 (정산·결제·회원·로그·관리자설정)
const requireTracks = (p: AdminPermissions) => p.can_manage_tracks;
const requireReview = (p: AdminPermissions) => p.can_review_tracks;
const requireCuration = (p: AdminPermissions) => p.can_manage_curation;
const requireSales = (p: AdminPermissions) => p.can_manage_sales;
const requireSuper = (p: AdminPermissions) => p.is_super_admin;

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode; requires?: (p: AdminPermissions) => boolean }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} />, requires: requireSuper },
  { key: 'sales-agents', label: '영업인 관리', icon: <Handshake size={14} />, requires: requireSales },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} />, requires: requireSales },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} />, requires: requireSales },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} />, requires: requireSales },
  { key: 'promotions', label: '프로모션', icon: <Ticket size={14} />, requires: requireSales },
  { key: 'payment-sync', label: '결제 동기화', icon: <CreditCard size={14} />, requires: requireSuper },
  { key: 'operation-logs', label: '운영 로그', icon: <ScrollText size={14} />, requires: requireSuper },
  { key: 'action-log', label: '관리자 액션 로그', icon: <ScrollText size={14} />, requires: requireSuper },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} />, requires: requireTracks },
  { key: 'auto-playlists', label: '자동 플리/배치', icon: <Sparkles size={14} />, requires: requireCuration },
  { key: 'artists', label: '아티스트 승인', icon: <Mic2 size={14} />, requires: requireReview },
  { key: 'artist-contracts', label: '계약 관리', icon: <FileSignature size={14} />, requires: requireSuper },
  { key: 'payout-verification', label: '계좌 확인', icon: <Wallet size={14} />, requires: requireSuper },
  { key: 'track-review', label: '음원 검수', icon: <Mic2 size={14} />, requires: requireReview },
  { key: 'artist-tracks', label: '음원 관리', icon: <Music size={14} />, requires: requireTracks },
  { key: 'deleted-tracks', label: '삭제 음원', icon: <Trash2 size={14} />, requires: requireTracks },
  { key: 'audio-reencode', label: '오디오 변환(iOS)', icon: <Smartphone size={14} />, requires: requireTracks },
  { key: 'audio-diagnostics', label: '오디오 진단', icon: <Stethoscope size={14} />, requires: requireTracks },
  { key: 'metadata-violations', label: '메타데이터 위반 의심', icon: <AlertTriangle size={14} />, requires: requireTracks },
  { key: 'upload-audit', label: '업로드/스토리지 점검', icon: <HardDrive size={14} />, requires: requireTracks },
  { key: 'ai-curation', label: 'AI 큐레이션', icon: <Sparkles size={14} />, requires: (p) => p.can_manage_tracks || p.can_manage_curation },
  { key: 'artist-settlements', label: '아티스트 정산', icon: <Wallet size={14} />, requires: requireSuper },
  { key: 'recommendation', label: '추천 테스트', icon: <Sparkles size={14} />, requires: requireCuration },
  { key: 'admins', label: '관리자 설정', icon: <ShieldCheck size={14} />, requires: requireSuper },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const perms = useAdminPermsStore((s) => s.perms);
  const permsLoaded = useAdminPermsStore((s) => s.loaded);
  const loadPerms = useAdminPermsStore((s) => s.load);

  useEffect(() => { void loadPerms(); }, [loadPerms]);
  // 권한 로드 전에는 dashboard 만 보여 깜빡임/노출 누수를 막는다.
  const visibleTabs = TABS.filter((t) => !t.requires || (perms ? t.requires(perms) : false));

  // 현재 탭이 권한상 숨겨졌다면 보이는 첫 탭으로 보정 (직접 접근 차단의 클라이언트 측).
  useEffect(() => {
    if (!permsLoaded) return;
    if (!visibleTabs.some((t) => t.key === tab)) setTab(visibleTabs[0]?.key ?? 'dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoaded, perms]);

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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight">관리자</h1>
            {perms?.role && (
              <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                {ADMIN_ROLE_LABELS[perms.role]}
              </span>
            )}
          </div>
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

      <nav className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-1.5 pb-1 no-scrollbar">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
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
      </nav>

      {/* 한 탭 패널의 렌더 throw 가 관리자 페이지 전체를 화이트스크린시키지 않도록 격리.
          resetKey=tab 로 탭 전환 시 직전 탭의 에러 상태를 자동 초기화. */}
      <AdminErrorBoundary resetKey={tab}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'members' && <MembersList />}
        {tab === 'sales-agents' && <SalesAgentsList />}
        {tab === 'streaming' && <StreamingAnalytics />}
        {tab === 'revenue' && <RevenueManagement />}
        {tab === 'subscriptions' && <SubscriptionRequests />}
        {tab === 'promotions' && <PromotionCodes />}
        {tab === 'payment-sync' && <PaymentSyncTool />}
        {tab === 'operation-logs' && <AdminOperationLogs />}
        {tab === 'action-log' && <AdminActionLog />}
        {tab === 'content' && <ContentManagement />}
        {tab === 'auto-playlists' && <AutoPlaylistManager />}
        {tab === 'artists' && <ArtistApprovalList />}
        {tab === 'artist-contracts' && <ArtistContractsList />}
        {tab === 'payout-verification' && <PayoutVerificationList />}
        {tab === 'track-review' && <TrackReviewList />}
        {tab === 'artist-tracks' && <ArtistTrackManagementList />}
        {tab === 'deleted-tracks' && <ArtistTrackManagementList removedView />}
        {tab === 'audio-reencode' && <AudioReencodePanel />}
        {tab === 'audio-diagnostics' && <AudioDiagnosticPanel />}
        {tab === 'metadata-violations' && <MetadataViolationsList />}
        {tab === 'upload-audit' && <UploadAuditPanel />}
        {tab === 'ai-curation' && <AiCurationPanel />}
        {tab === 'artist-settlements' && <ArtistSettlementsList />}
        {tab === 'recommendation' && <RecommendationTester />}
        {tab === 'admins' && <AdminUsersList />}
      </AdminErrorBoundary>
    </div>
  );
}
