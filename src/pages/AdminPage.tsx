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
  ScrollText,
  Handshake,
  FileSignature,
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

type Tab =
  | 'dashboard'
  | 'members'
  | 'sales-agents'
  | 'streaming'
  | 'revenue'
  | 'subscriptions'
  | 'payment-sync'
  | 'content'
  | 'artists'
  | 'artist-contracts'
  | 'payout-verification'
  | 'track-review'
  | 'artist-tracks'
  | 'artist-settlements'
  | 'operation-logs'
  | 'recommendation';

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
  { key: 'sales-agents', label: '영업인 관리', icon: <Handshake size={14} /> },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} /> },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} /> },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} /> },
  { key: 'payment-sync', label: '결제 동기화', icon: <CreditCard size={14} /> },
  { key: 'operation-logs', label: '운영 로그', icon: <ScrollText size={14} /> },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} /> },
  { key: 'artists', label: '아티스트 승인', icon: <Mic2 size={14} /> },
  { key: 'artist-contracts', label: '계약 관리', icon: <FileSignature size={14} /> },
  { key: 'payout-verification', label: '계좌 확인', icon: <Wallet size={14} /> },
  { key: 'track-review', label: '음원 검수', icon: <Mic2 size={14} /> },
  { key: 'artist-tracks', label: '음원 관리', icon: <Music size={14} /> },
  { key: 'artist-settlements', label: '아티스트 정산', icon: <Wallet size={14} /> },
  { key: 'recommendation', label: '추천 테스트', icon: <Sparkles size={14} /> },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);

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
        </div>
        <AdminNotificationsBell />
      </header>

      <OnboardingChecklist tracks={tracks} playlists={playlists} />

      <nav className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-1.5 pb-1 no-scrollbar">
          {TABS.map((t) => (
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

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'members' && <MembersList />}
      {tab === 'sales-agents' && <SalesAgentsList />}
      {tab === 'streaming' && <StreamingAnalytics />}
      {tab === 'revenue' && <RevenueManagement />}
      {tab === 'subscriptions' && <SubscriptionRequests />}
      {tab === 'payment-sync' && <PaymentSyncTool />}
      {tab === 'operation-logs' && <AdminOperationLogs />}
      {tab === 'content' && <ContentManagement />}
      {tab === 'artists' && <ArtistApprovalList />}
      {tab === 'artist-contracts' && <ArtistContractsList />}
      {tab === 'payout-verification' && <PayoutVerificationList />}
      {tab === 'track-review' && <TrackReviewList />}
      {tab === 'artist-tracks' && <ArtistTrackManagementList />}
      {tab === 'artist-settlements' && <ArtistSettlementsList />}
      {tab === 'recommendation' && <RecommendationTester />}
    </div>
  );
}
