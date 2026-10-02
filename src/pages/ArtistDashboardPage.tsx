/**
 * /artist — 아티스트 대시보드 셸.
 *
 * 예전에는 이 파일 하나가 1,958줄이었고, 플랜 배지부터 정산 계좌 입력 폼(250줄),
 * 업로드 폼, 스트리밍 차트, 음원 목록까지 전부 세로로 쌓여 있었다. 원하는 걸 찾으려면
 * 스크롤로 훑어야 했고, 정작 정산 화면은 링크가 없어 들어가지도 못했다.
 *
 * 이제 이 파일은 셸만 맡는다 — 데이터 로드, 탭 전환, 라우트 가드.
 * 화면은 네 탭이 나눠 그린다. 조각 컴포넌트는 dashboard/parts 로 옮겼을 뿐
 * 로직은 그대로다(업로드 게이트, QC, 정산 계좌, 스트리밍 집계 전부 동일).
 *
 * 데이터는 여기서 한 번만 불러 탭에 내려준다. 탭마다 각자 fetch 하면 탭을 옮길 때마다
 * 같은 쿼리가 다시 나간다.
 */
import { useCallback, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Mic2, ArrowLeft, Wallet, LayoutDashboard, Music, BarChart3 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { fetchMyTrackQcReport, type MyTrackQcRow } from '@/lib/audioQcGuideApi';
import TrackQcDetailModal from '@/components/artist/TrackQcDetailModal';
import {
  fetchMyArtistProfile,
  fetchMyArtistTracks,
  fetchArtistStreamingSummary,
  fetchArtistDailyStreams,
  fetchArtistUploadEligibility,
  fetchMyPayoutAccount,
  fetchMyPayoutAccountMasked,
  fetchMySettlementHoldStatus,
  type ArtistProfile,
  type MyArtistTrackRow,
  type ArtistStreamingSummaryRow,
  type ArtistDailyStreamRow,
  type UploadEligibility,
  type PayoutAccount,
  type PayoutAccountMasked,
  type SettlementHoldStatus,
} from '@/lib/artistApi';
import { getMySettlements, type MySettlementRow } from '@/lib/artistSettlementApi';
import { ALLOWED_ARTIST_STATUSES } from '@/components/artist/settlementDisplay';
import { useArtistBillingAccess } from '@/hooks/useArtistBillingAccess';
import { fetchMyArtistPlan, type ArtistPlanInfo } from '@/lib/artistPlanApi';
import SupportInquiryButton from '@/components/SupportInquiryButton';
import TabNav, { type TabItem } from '@/components/ui/TabNav';
import OverviewTab from '@/components/artist/tabs/OverviewTab';
import TracksTab from '@/components/artist/tabs/TracksTab';
import StreamingTab from '@/components/artist/tabs/StreamingTab';
import SettlementTab from '@/components/artist/tabs/SettlementTab';
import type { ArtistTabKey } from '@/components/artist/tabs/types';

const TAB_KEYS: ReadonlySet<string> = new Set<ArtistTabKey>([
  'overview', 'tracks', 'streaming', 'settlement',
]);

export default function ArtistDashboardPage() {
  const { user, profile, loading: authLoading } = useAuthStore();
  // RESUME-PAUSED-SUBSCRIPTION-1 — 정지(해지) 상태면 결제 카드 문구를 '재개' 로 바꾼다.
  const { access: billingAccess } = useArtistBillingAccess(true);
  // ARTIST-BILLING-ACCESS-ENFORCEMENT — 결제 제한 배너는 공통 ArtistLayout 최상단에서
  // 렌더된다. 업로드/유통 신청 클릭 시 서버 pre-check(uploadArtistTrack)가 billing_required
  // 를 반환하면 ArtistUploadForm 의 handleSubmit 에서 결제 페이지로 안내한다.
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [tracks, setTracks] = useState<MyArtistTrackRow[]>([]);
  // X6.36 — 본인 트랙 QC 리포트 (track_id → row)
  const [qcMap, setQcMap] = useState<Map<string, MyTrackQcRow>>(new Map());
  // X6.37 — QC 상세 모달 (선택된 트랙)
  const [qcDetailTrack, setQcDetailTrack] = useState<{ id: string; title: string } | null>(null);
  const [summary, setSummary] = useState<ArtistStreamingSummaryRow[]>([]);
  const [daily, setDaily] = useState<ArtistDailyStreamRow[]>([]);
  const [eligibility, setEligibility] = useState<UploadEligibility | null>(null);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  // X6.14 — RRN 등 PII 포함된 마스킹 정보 (본인 화면용)
  const [payoutMasked, setPayoutMasked] = useState<PayoutAccountMasked | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTrack, setEditingTrack] = useState<MyArtistTrackRow | null>(null);
  const [plan, setPlan] = useState<ArtistPlanInfo | null>(null);
  // X6.16 — 정산 보류 상태
  const [holdStatus, setHoldStatus] = useState<SettlementHoldStatus | null>(null);
  // 정산 내역 — 개요의 '최근 확정 정산액' 과 정산 탭이 같이 쓴다.
  const [settlements, setSettlements] = useState<MySettlementRow[]>([]);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') ?? '';
  const tab: ArtistTabKey = (TAB_KEYS.has(rawTab) ? rawTab : 'overview') as ArtistTabKey;
  // 탭은 URL 에 둔다 — 뒤로가기가 동작하고, 특정 탭 링크를 공유할 수 있다.
  const goTab = useCallback((k: ArtistTabKey) => {
    setSearchParams(k === 'overview' ? {} : { tab: k }, { replace: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [ap, ts, sm, dl, el, po, pom, pl, hs, qc, st] = await Promise.all([
        fetchMyArtistProfile(user.id),
        fetchMyArtistTracks(),
        fetchArtistStreamingSummary(),
        fetchArtistDailyStreams(30),
        fetchArtistUploadEligibility(),
        fetchMyPayoutAccount(user.id),
        fetchMyPayoutAccountMasked(),
        fetchMyArtistPlan(),
        fetchMySettlementHoldStatus(),
        // X6.36 — QC report fetch 실패해도 다른 데이터 영향 없음
        fetchMyTrackQcReport(100).catch(() => [] as MyTrackQcRow[]),
        // 정산 조회 실패가 대시보드 전체를 막지 않도록 분리해서 받는다.
        getMySettlements()
          .then((r) => { setSettlementsError(null); return r; })
          .catch((e) => {
            setSettlementsError(e instanceof Error ? e.message : String(e));
            return [] as MySettlementRow[];
          }),
      ]);
      setArtist(ap);
      setTracks(ts);
      setQcMap(new Map(qc.map((r) => [r.track_id, r])));
      setSummary(sm);
      setDaily(dl);
      setEligibility(el);
      setPayout(po);
      setPayoutMasked(pom);
      setPlan(pl);
      setHoldStatus(hs);
      // 0388 — 2중 방어선: 서버 RPC + RLS 가 pending 차단하지만, 만일을 위해 client 도 필터.
      setSettlements(st.filter((row) => ALLOWED_ARTIST_STATUSES.has(row.status)));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFreshFetch(load, [user?.id]);

  // 로그인 안 됨
  if (!authLoading && !user) return <Navigate to="/login" replace />;
  // source of truth = artist_profiles. account_type 은 미러일 뿐이므로 단독으로 차단하지 않는다.
  // 프로필 로딩이 끝났는데도 아티스트 프로필이 없고 account_type 도 artist 가 아닐 때만 차단
  // (미러가 깨진 승인 아티스트가 대시보드에서 튕기지 않도록 보호).
  if (!authLoading && !loading && !artist && profile && profile.account_type !== 'artist') {
    return <Navigate to="/" replace />;
  }

  const isApproved = artist?.approval_status === 'approved';

  // 처리할 게 남은 탭에 숫자를 띄운다 — 탭을 열어보지 않아도 할 일이 보이게.
  const needsAttentionTracks =
    tracks.filter((t) => t.visibility_status === 'rejected').length;
  const needsAttentionSettlement =
    (holdStatus?.is_held ? 1 : 0) +
    (isApproved && payout?.verification_status !== 'verified' ? 1 : 0);

  const tabs: ReadonlyArray<TabItem<ArtistTabKey>> = [
    { key: 'overview', label: '개요', icon: <LayoutDashboard size={14} /> },
    { key: 'tracks', label: '음원 관리', icon: <Music size={14} />, badge: needsAttentionTracks },
    { key: 'streaming', label: '스트리밍', icon: <BarChart3 size={14} /> },
    { key: 'settlement', label: '정산', icon: <Wallet size={14} />, badge: needsAttentionSettlement },
  ];

  return (
    <div className="space-y-4 px-4 pb-12 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link to="/profile" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
            <Mic2 size={20} className="text-accent" /> 아티스트 대시보드
          </h1>
          <p className="truncate text-xs text-ink-mute">{artist?.artist_name ?? '—'}</p>
        </div>
        <div className="ml-auto shrink-0">
          <SupportInquiryButton variant="chip" defaultType="음원 등록 문의" />
        </div>
      </header>

      <TabNav items={tabs} value={tab} onChange={goTab} ariaLabel="아티스트 대시보드" />

      {tab === 'overview' && (
        <OverviewTab
          artist={artist}
          tracks={tracks}
          summary={summary}
          settlements={settlements}
          plan={plan}
          holdStatus={holdStatus}
          payout={payout}
          loading={loading}
          isApproved={isApproved}
          goTab={goTab}
        />
      )}

      {tab === 'tracks' && (
        <TracksTab
          isApproved={isApproved}
          tracks={tracks}
          qcMap={qcMap}
          loading={loading}
          eligibility={eligibility}
          payout={payout}
          payoutMasked={payoutMasked}
          billingPaused={billingAccess?.reason === 'cancelled'}
          userEmail={user?.email ?? ''}
          plan={plan}
          editingTrack={editingTrack}
          onCancelEdit={() => setEditingTrack(null)}
          onUploaded={() => {
            setEditingTrack(null);
            void load();
          }}
          onPayoutSubmitted={load}
          onEdit={(t) => {
            setEditingTrack(t);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenQcDetail={(t) => setQcDetailTrack({ id: t.track_id, title: t.title })}
          onChanged={load}
        />
      )}

      {tab === 'streaming' && (
        <StreamingTab summary={summary} daily={daily} loading={loading} hasTracks={tracks.length > 0} />
      )}

      {tab === 'settlement' && (
        <SettlementTab
          settlements={settlements}
          settlementsLoading={loading}
          settlementsError={settlementsError}
          payout={payout}
          payoutMasked={payoutMasked}
          holdStatus={holdStatus}
          eligibility={eligibility}
          loading={loading}
          onPayoutSubmitted={load}
        />
      )}

      {/* X6.37 — QC 상세 모달 */}
      {qcDetailTrack && (
        <TrackQcDetailModal
          trackId={qcDetailTrack.id}
          trackTitle={qcDetailTrack.title}
          onClose={() => setQcDetailTrack(null)}
        />
      )}
    </div>
  );
}
