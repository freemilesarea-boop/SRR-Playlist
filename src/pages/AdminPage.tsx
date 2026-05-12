import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Headphones,
  Wallet,
  CreditCard,
  Settings,
} from 'lucide-react';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import OnboardingChecklist from '@/components/admin/OnboardingChecklist';
import Dashboard from '@/components/admin/Dashboard';
import MembersList from '@/components/admin/MembersList';
import StreamingAnalytics from '@/components/admin/StreamingAnalytics';
import RevenueManagement from '@/components/admin/RevenueManagement';
import SubscriptionRequests from '@/components/admin/SubscriptionRequests';
import ContentManagement from '@/components/admin/ContentManagement';

type Tab =
  | 'dashboard'
  | 'members'
  | 'streaming'
  | 'revenue'
  | 'subscriptions'
  | 'content';

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={14} /> },
  { key: 'members', label: '회원관리', icon: <Users size={14} /> },
  { key: 'streaming', label: '스트리밍', icon: <Headphones size={14} /> },
  { key: 'revenue', label: '매출', icon: <Wallet size={14} /> },
  { key: 'subscriptions', label: '구독신청', icon: <CreditCard size={14} /> },
  { key: 'content', label: '콘텐츠관리', icon: <Settings size={14} /> },
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
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">관리자</h1>
        <p className="text-xs text-ink-mute">
          대시보드 · 회원 · 스트리밍 · 매출 · 구독 · 콘텐츠
        </p>
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
      {tab === 'streaming' && <StreamingAnalytics />}
      {tab === 'revenue' && <RevenueManagement />}
      {tab === 'subscriptions' && <SubscriptionRequests />}
      {tab === 'content' && <ContentManagement />}
    </div>
  );
}
