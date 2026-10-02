/**
 * 개요 탭 — "지금 내 상태" 를 3초 안에 파악시키는 화면.
 *
 * 상세는 전부 다른 탭에 있다. 여기서는 수치 네 개와, 사용자가 실제로 **처리해야 하는**
 * 항목만 보여준다. 정상 상태면 경고 영역 자체를 그리지 않는다 — 아무 문제 없는
 * 사람에게 노란 카드를 띄워 두면 진짜 경고가 묻힌다.
 *
 * '이번 달 예상 정산액' 은 두지 않는다. 정산은 월 1회 배치라 진행 중인 달에는 행이
 * 없고, 아티스트용 추정 API 도 없다. 프론트에서 계산해 만들면 틀린 금액을 보여주게 된다.
 */
import { Link } from 'react-router-dom';
import { Music, Play, Wallet, Clock, XCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import type { MyArtistTrackRow, ArtistStreamingSummaryRow, ArtistProfile,
  SettlementHoldStatus, PayoutAccount } from '@/lib/artistApi';
import type { ArtistPlanInfo } from '@/lib/artistPlanApi';
import type { MySettlementRow } from '@/lib/artistSettlementApi';
import SummaryCard from '@/components/ui/SummaryCard';
import SectionHeader from '@/components/ui/SectionHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { latestSettlement, payoutOrCarry, fmtKrw, fmtMonth } from '@/components/artist/settlementDisplay';
import { ArtistPlanCard, ApprovalStatusCard } from '@/components/artist/dashboard/parts';
import { STATUS_LABEL } from '@/components/artist/dashboard/constants';
import type { ArtistTabKey } from '@/components/artist/tabs/types';

export default function OverviewTab({
  artist, tracks, summary, settlements, plan, holdStatus, payout, loading, isApproved, goTab,
}: {
  artist: ArtistProfile | null;
  tracks: MyArtistTrackRow[];
  summary: ArtistStreamingSummaryRow[];
  settlements: MySettlementRow[];
  plan: ArtistPlanInfo | null;
  holdStatus: SettlementHoldStatus | null;
  payout: PayoutAccount | null;
  loading: boolean;
  isApproved: boolean;
  goTab: (k: ArtistTabKey) => void;
}) {
  const approved = tracks.filter((t) => t.visibility_status === 'approved');
  const pending = tracks.filter((t) => t.visibility_status === 'pending_review');
  const rejected = tracks.filter((t) => t.visibility_status === 'rejected');

  const totalStreams = summary.reduce((a, r) => a + r.total_streams, 0);
  const todayStreams = summary.reduce((a, r) => a + r.today_streams, 0);

  const latest = latestSettlement(settlements);
  const latestPayout = latest ? payoutOrCarry(latest) : null;

  // 사용자가 실제로 손을 써야 하는 것만 모은다.
  const todos: Array<{
    key: string; icon: React.ReactNode; title: string; desc: string;
    tone: 'warning' | 'danger' | 'progress';
    action: { label: string; onClick: () => void };
  }> = [];

  if (holdStatus?.is_held) {
    todos.push({
      key: 'hold', icon: <AlertTriangle size={15} />, tone: 'danger',
      title: '정산이 보류 중입니다',
      desc: '정산 탭에서 보류 사유와 해결 방법을 확인하세요.',
      action: { label: '정산으로', onClick: () => goTab('settlement') },
    });
  }
  if (isApproved && payout?.verification_status !== 'verified') {
    todos.push({
      key: 'payout', icon: <Wallet size={15} />, tone: 'warning',
      title: '정산 계좌가 등록되지 않았습니다',
      desc: '계좌와 세금 정보를 등록해야 정산금을 받을 수 있습니다.',
      action: { label: '등록하기', onClick: () => goTab('settlement') },
    });
  }
  if (rejected.length > 0) {
    todos.push({
      key: 'rejected', icon: <XCircle size={15} />, tone: 'danger',
      title: `반려된 음원 ${rejected.length}곡`,
      desc: '사유를 확인하고 수정해 다시 등록할 수 있습니다.',
      action: { label: '확인하기', onClick: () => goTab('tracks') },
    });
  }
  if (pending.length > 0) {
    todos.push({
      key: 'pending', icon: <Clock size={15} />, tone: 'progress',
      title: `심사 중인 음원 ${pending.length}곡`,
      desc: '관리자 검토 중입니다. 별도로 하실 일은 없습니다.',
      action: { label: '보기', onClick: () => goTab('tracks') },
    });
  }

  const recent = [...tracks].slice(0, 3);

  return (
    <div className="space-y-5">
      {/* 수치 — 가로 4칸, 모바일 2칸 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <SummaryCard
          label="등록 음원" icon={<Music size={12} />} loading={loading}
          value={`${approved.length}곡`}
          hint={tracks.length !== approved.length ? `전체 ${tracks.length}곡` : undefined}
        />
        <SummaryCard
          label="전체 스트리밍" icon={<Play size={12} />} loading={loading}
          value={totalStreams.toLocaleString()}
        />
        <SummaryCard
          label="오늘 스트리밍" icon={<Play size={12} />} loading={loading}
          value={todayStreams.toLocaleString()}
        />
        <SummaryCard
          label={latestPayout?.label ?? '최근 정산'} icon={<Wallet size={12} />} loading={loading}
          value={latestPayout ? fmtKrw(latestPayout.amount) : '—'}
          hint={latest ? `${fmtMonth(latest.settlement_month)} 확정` : '정산 내역 없음'}
        />
      </div>

      {/* 승인 전이면 승인 상태가 가장 중요하다 */}
      {!loading && !isApproved && <ApprovalStatusCard artist={artist} />}

      {plan && <ArtistPlanCard plan={plan} />}

      {/* 처리 필요 — 없으면 영역 자체를 그리지 않는다 */}
      {todos.length > 0 && (
        <section className="space-y-2">
          <SectionHeader title="처리가 필요해요" />
          {todos.map((t) => (
            <div
              key={t.key}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg-card p-3.5 ring-1 ring-line/10"
            >
              <span className="text-ink-mute">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{t.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-mute">{t.desc}</p>
              </div>
              <button
                type="button"
                onClick={t.action.onClick}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-bg hover:opacity-90"
              >
                {t.action.label}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* 최근 음원 — 전체는 음원 관리 탭에서 */}
      <section className="space-y-2">
        <SectionHeader
          title="최근 음원"
          action={
            tracks.length > 0 ? (
              <button
                type="button"
                onClick={() => goTab('tracks')}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:underline"
              >
                음원 관리에서 전체 보기 <ChevronRight size={13} />
              </button>
            ) : undefined
          }
        />
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-card" />)}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<Music size={22} />}
            title="아직 업로드한 음원이 없어요"
            desc={isApproved ? '음원 관리 탭에서 첫 음원을 올려보세요.' : '관리자 승인 후 업로드할 수 있습니다.'}
            action={isApproved ? (
              <button
                type="button"
                onClick={() => goTab('tracks')}
                className="rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-bg hover:opacity-90"
              >
                음원 업로드
              </button>
            ) : undefined}
          />
        ) : (
          <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            {recent.map((t) => {
              const s = STATUS_LABEL[t.visibility_status];
              return (
                <li key={t.track_id} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</p>
                  <StatusBadge
                    tone={
                      t.visibility_status === 'approved' ? 'success'
                        : t.visibility_status === 'rejected' ? 'danger'
                          : t.visibility_status === 'pending_review' ? 'progress' : 'neutral'
                    }
                  >
                    {s?.label ?? t.visibility_status}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 정산은 별도 라우트로도 들어갈 수 있다(기존 링크 보존) */}
      <Link
        to="/artist/settlements"
        className="flex items-center justify-center gap-1.5 rounded-xl bg-bg-soft py-2.5 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-accent"
      >
        <Wallet size={13} /> 정산 내역 전체 보기 <ChevronRight size={12} />
      </Link>
    </div>
  );
}
