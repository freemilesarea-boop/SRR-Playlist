/**
 * EnterpriseHqContentPage — 본사 브랜드 콘텐츠 관리 (/enterprise/content, 0541).
 *
 * 본사가 브랜드 음악 기준·재생 시간, 매장 화면(TV) 이미지·영상, 안내 음원·방송 일정을
 * 직접 바꾼다. 바로 반영되지 않고 운영사 검수(관리자 > 본사 콘텐츠 검수) 후 반영된다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Clapperboard, Info, Loader2, Megaphone, Music, ListChecks } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import EnterpriseHqNotificationBell from '@/components/enterprise/EnterpriseHqNotificationBell';
import { cancelContentRequest, getMyBrandContent, type HqBrandContent } from '@/lib/api/hqContentApi';
import MusicTab from '@/components/enterprise/content/MusicTab';
import ScreenTab from '@/components/enterprise/content/ScreenTab';
import AnnounceTab from '@/components/enterprise/content/AnnounceTab';
import RequestsTab from '@/components/enterprise/content/RequestsTab';

type Tab = 'music' | 'screen' | 'announce' | 'requests';

const TABS: { id: Tab; label: string; icon: typeof Music }[] = [
  { id: 'music', label: '브랜드 음악', icon: Music },
  { id: 'screen', label: '매장 화면·광고', icon: Clapperboard },
  { id: 'announce', label: '안내방송', icon: Megaphone },
  { id: 'requests', label: '요청 내역', icon: ListChecks },
];

export default function EnterpriseHqContentPage() {
  const { user, loading: authLoading } = useAuthStore();
  const [tab, setTab] = useState<Tab>('music');
  const [data, setData] = useState<HqBrandContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 탭 안의 입력 상태를 서버 값으로 다시 맞출 때 쓴다(요청 후 새로 불러오면 증가).
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await getMyBrandContent());
      setError(null);
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user) void load(); }, [user, load]);

  const reload = useCallback(() => { void load().then(() => setVersion((v) => v + 1)); }, [load]);

  const cancel = useCallback(async (id: string) => {
    if (!window.confirm('이 요청을 취소할까요?')) return;
    try {
      await cancelContentRequest(id);
      toast.success('요청을 취소했어요.');
      reload();
    } catch (e) {
      toast.error(friendlyError(e, '취소하지 못했어요'));
    }
  }, [reload]);

  if (!authLoading && !user) return <Navigate to="/login" replace />;

  const pendingCount = data?.requests.filter((r) => r.status === 'pending').length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <header className="flex items-center gap-3">
        <Link to="/enterprise/me" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="본사 대시보드로">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">브랜드 콘텐츠 관리</h1>
          <p className="truncate text-xs text-ink-mute">
            {data?.enterprise.name ?? '본사'} · 음악·매장 화면·안내방송을 직접 바꿔요
          </p>
        </div>
        <EnterpriseHqNotificationBell className="bg-bg-card hover:bg-bg-hover" />
      </header>

      <p className="flex items-start gap-2 rounded-2xl bg-sky-50 p-3 text-[12px] leading-relaxed text-sky-900 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-400/30">
        <Info size={15} className="mt-0.5 shrink-0" />
        <span>
          바꾼 내용은 <b>운영사 확인 후</b> 전 가맹점에 반영돼요. 반영되거나 반려되면 알림센터로 알려드려요.
          확인 전에는 언제든 요청을 취소할 수 있어요.
        </span>
      </p>

      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="콘텐츠 종류">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
              tab === id ? 'bg-accent text-bg' : 'bg-bg-card text-ink-mute hover:text-ink'
            }`}
          >
            <Icon size={14} /> {label}
            {id === 'requests' && pendingCount > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] ${tab === id ? 'bg-bg/25' : 'bg-amber-500 text-white'}`}>{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex justify-center py-16 text-ink-mute"><Loader2 className="animate-spin" /></div>
      ) : error || !data ? (
        <div className="rounded-2xl bg-bg-card p-6 text-center ring-1 ring-line/10">
          <p className="text-sm font-semibold">본사 계정에서만 쓸 수 있어요</p>
          <p className="mt-1 text-[12px] text-ink-mute">{error}</p>
          <Link to="/enterprise/me" className="mt-3 inline-block text-[12px] font-semibold text-accent underline">본사 대시보드로</Link>
        </div>
      ) : (
        <div key={version}>
          {tab === 'music' && <MusicTab data={data} onChanged={reload} onCancel={(id) => void cancel(id)} />}
          {tab === 'screen' && <ScreenTab data={data} onChanged={reload} onCancel={(id) => void cancel(id)} />}
          {tab === 'announce' && <AnnounceTab data={data} onChanged={reload} onCancel={(id) => void cancel(id)} />}
          {tab === 'requests' && <RequestsTab data={data} onCancel={(id) => void cancel(id)} />}
        </div>
      )}
    </div>
  );
}
