/**
 * MemberFunnelSection — 회원 전환 퍼널 인텔리전스 (Phase ADMIN-MEMBER-FUNNEL-1).
 *
 * PR #362(스냅샷)·#363(성장) 위에 이어, 회원이 가입→인증→로그인→무료→유료→
 * 사업자→매장 중 어디서 이탈하는지 분석한다. 4개 내부 탭:
 *   퍼널     — 전체 퍼널(기간 선택) + 이탈 TOP5 + 참여지표 + 최종 전환율
 *   유형별   — 아티스트/사업자/일반 서브 퍼널
 *   전환 변화 — 이번달 vs 지난달 코호트 step 전환율 증감
 *   Revenue  — 무료→시도→성공→구독유지 (+ 유지 코호트 미지원 명시)
 *
 * 자체 fetch·오류 격리 → 0473 미적용 시에도 기존 대시보드 정상. 실제 데이터가
 * 없는 step 은 "미지원"으로 표기하고 추정하지 않는다. 전환율 0~100 clamp,
 * NaN/Infinity 없음. 비단조(정합성 위반) 구간은 비차단 경고.
 */
import { useEffect, useState } from 'react';
import { Filter, TrendingDown, RefreshCw, Inbox, Ban, AlertTriangle } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchMemberFunnel, fetchMemberFunnelBreakdown, fetchMemberFunnelHistory,
  type MemberFunnel, type MemberFunnelRange, type MemberFunnelBreakdown,
  type MemberFunnelHistory, type FunnelStep,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  computeFunnel, finalConversion, topDropSteps, monotonicWarnings,
  computeHistoryDeltas, formatDelta, funnelSupportSummary,
  type ComputedStep,
} from '@/lib/memberFunnel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

const TONE_HEX: Record<ComputedStep['tone'], string> = {
  success: '#10b981', warning: '#f59e0b', danger: '#ef4444', neutral: '#737373',
};

const RANGES: { key: MemberFunnelRange; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: '90d', label: '90일' },
  { key: '12m', label: '12개월' },
];

type Tab = 'funnel' | 'segments' | 'history' | 'revenue';
const TABS: { key: Tab; label: string }[] = [
  { key: 'funnel', label: '퍼널' },
  { key: 'segments', label: '유형별' },
  { key: 'history', label: '전환 변화' },
  { key: 'revenue', label: 'Revenue' },
];

export default function MemberFunnelSection() {
  const [tab, setTab] = useState<Tab>('funnel');

  const [range, setRange] = useState<MemberFunnelRange>('all');
  const [funnel, setFunnel] = useState<MemberFunnel | null>(null);
  const [funnelErr, setFunnelErr] = useState<AdminError | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);

  const [breakdown, setBreakdown] = useState<MemberFunnelBreakdown | null>(null);
  const [breakdownErr, setBreakdownErr] = useState<AdminError | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const [history, setHistory] = useState<MemberFunnelHistory | null>(null);
  const [historyErr, setHistoryErr] = useState<AdminError | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function loadFunnel(r: MemberFunnelRange) {
    setFunnelLoading(true); setFunnelErr(null);
    try { setFunnel(await fetchMemberFunnel(r)); }
    catch (e) { setFunnelErr(classifyAdminError(e)); }
    finally { setFunnelLoading(false); }
  }
  async function loadBreakdown() {
    setBreakdownLoading(true); setBreakdownErr(null);
    try { setBreakdown(await fetchMemberFunnelBreakdown()); }
    catch (e) { setBreakdownErr(classifyAdminError(e)); }
    finally { setBreakdownLoading(false); }
  }
  async function loadHistory() {
    setHistoryLoading(true); setHistoryErr(null);
    try { setHistory(await fetchMemberFunnelHistory()); }
    catch (e) { setHistoryErr(classifyAdminError(e)); }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => { void loadFunnel(range); }, [range]);
  useEffect(() => {
    if ((tab === 'segments' || tab === 'revenue') && !breakdown) void loadBreakdown();
    if (tab === 'history' && !history) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title="회원 전환 퍼널"
      subtitle="가입 → 인증 → 무료 → 유료 → 사업자 이탈 분석 (KST 기준)"
      action={
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {tab === 'funnel' && (
        <FunnelTab
          funnel={funnel} loading={funnelLoading} error={funnelErr}
          range={range} onRange={setRange} onRetry={() => loadFunnel(range)}
        />
      )}
      {tab === 'segments' && (
        <SegmentsTab breakdown={breakdown} loading={breakdownLoading} error={breakdownErr} onRetry={loadBreakdown} />
      )}
      {tab === 'history' && (
        <HistoryTab history={history} loading={historyLoading} error={historyErr} onRetry={loadHistory} />
      )}
      {tab === 'revenue' && (
        <RevenueTab breakdown={breakdown} loading={breakdownLoading} error={breakdownErr} onRetry={loadBreakdown} />
      )}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() {
  return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />;
}
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert
      tone="warning"
      title="퍼널 데이터를 불러오지 못했어요"
      description={error.message}
      action={
        <button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover">
          <RefreshCw size={12} /> 다시 시도
        </button>
      }
    />
  );
}

/**
 * FunnelBars — step 배열(단조 체인)을 세로 막대 퍼널로 렌더.
 * 막대 너비 = count / base. 색상 = 전환율 톤. 미지원 step 은 회색 "미지원" 배지.
 */
function FunnelBars({ steps }: { steps: FunnelStep[] }) {
  const computed = computeFunnel(steps);
  const base = computed.find((s) => s.count != null)?.count ?? 0;

  return (
    <div className="space-y-1.5">
      {computed.map((s, i) => {
        const supported = s.supported && s.count != null;
        const width = supported && base > 0 ? Math.max(2, ((s.count as number) / base) * 100) : 0;
        return (
          <div key={s.key}>
            {i > 0 && supported && s.convFromPrev != null && (
              <div className="flex items-center gap-2 py-0.5 pl-1 text-[10px] text-ink-dim">
                <span>↓</span>
                <span style={{ color: TONE_HEX[s.tone] }} className="font-semibold">{PCT(s.convFromPrev)}</span>
                <span>전환</span>
                {s.dropCount != null && s.dropCount > 0 && (
                  <span className="text-ink-dim">· {NUM(s.dropCount)}명 이탈 ({PCT(s.dropFromPrev)})</span>
                )}
                {s.nonMonotonic && <AlertTriangle size={11} style={{ color: TONE_HEX.warning }} aria-label="비단조" />}
              </div>
            )}
            <div
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: supported ? `${TONE_HEX[s.tone]}22` : 'rgba(115,115,115,0.12)' }}
              title={s.note ?? undefined}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold text-ink">{s.label}</span>
                {!supported && <AdminBadge tone="neutral" size="sm">미지원</AdminBadge>}
              </div>
              <div className="flex items-center gap-2">
                {supported ? (
                  <>
                    <div className="hidden h-2 rounded-full sm:block" style={{ width: `${width}%`, minWidth: 8, maxWidth: 180, background: TONE_HEX[s.tone] }} />
                    <span className="text-sm font-bold tabular-nums text-ink">{NUM(s.count)}</span>
                  </>
                ) : (
                  <span className="text-[10px] text-ink-dim">{s.note}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 퍼널 탭 ───────────────────────────────────────────── */
function FunnelTab({
  funnel, loading, error, range, onRange, onRetry,
}: {
  funnel: MemberFunnel | null; loading: boolean; error: AdminError | null;
  range: MemberFunnelRange; onRange: (r: MemberFunnelRange) => void; onRetry: () => void;
}) {
  const rangeButtons = (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onRange(r.key)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
            range === r.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingBlock />;
  } else if (error || !funnel) {
    body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  } else if (funnel.cohort_total === 0) {
    body = <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" description="선택한 기간에 가입 회원이 없어요." />;
  } else {
    const final = finalConversion(funnel.steps);
    const drops = topDropSteps(funnel.steps, 5);
    const warnings = monotonicWarnings([...funnel.steps, ...funnel.engagement]);
    const support = funnelSupportSummary(funnel);

    body = (
      <div className="space-y-4">
        {warnings.length > 0 && (
          <AdminAlert tone="warning" title="퍼널 정합성 경고" description={warnings.join(' · ')} />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl bg-bg-deep px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">최종 전환율 (가입→매장)</p>
            <p className="text-lg font-extrabold tabular-nums text-ink">{PCT(final)}</p>
          </div>
          <div className="rounded-xl bg-bg-deep px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">코호트</p>
            <p className="text-lg font-extrabold tabular-nums text-ink">{NUM(funnel.cohort_total)}명</p>
          </div>
        </div>

        <FunnelBars steps={funnel.steps} />

        {/* 이탈 TOP5 */}
        {drops.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><TrendingDown size={13} /> 이탈 TOP {drops.length}</p>
            <div className="space-y-1">
              {drops.map((d, i) => (
                <div key={d.key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-right text-ink-dim">{i + 1}</span>
                    <span className="font-semibold text-ink">{d.label}</span>
                  </span>
                  <span className="tabular-nums text-ink-mute">{NUM(d.dropCount)}명 이탈 · <span style={{ color: TONE_HEX.danger }} className="font-bold">{PCT(d.dropRate)}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 참여/운영 지표 (subset 아님/미지원) */}
        <div>
          <p className="mb-1.5 text-xs font-bold">참여 · 운영 지표</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {funnel.engagement.map((s) => (
              <div key={s.key} className="rounded-lg bg-bg-deep px-3 py-2" title={s.note ?? undefined}>
                <p className="text-[10px] text-ink-dim">{s.label}</p>
                {s.supported && s.count != null ? (
                  <p className="text-sm font-bold tabular-nums text-ink">{NUM(s.count)}명</p>
                ) : (
                  <p className="mt-0.5"><AdminBadge tone="neutral" size="sm">미지원</AdminBadge></p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">
            첫 음악 재생은 회원 subset 이 아니라 메인 전환 체인에서 분리했습니다(아티스트/사업자는
            재생 없이 결제). Player/Streaming 은 회원 매칭 데이터가 없어 미지원입니다.
          </p>
        </div>

        <p className="text-[10px] text-ink-dim">
          지원 {support.supported}/{support.total} step · 색상: 전환율 90%+ 초록 · 70~90 노랑 · 70 미만 빨강.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-bold"><Filter size={13} /> 전체 회원 퍼널</span>
        {rangeButtons}
      </div>
      {body}
    </div>
  );
}

/* ── 유형별 탭 ─────────────────────────────────────────── */
function SegmentsTab({
  breakdown, loading, error, onRetry,
}: { breakdown: MemberFunnelBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !breakdown) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const segs: { key: string; label: string; steps: FunnelStep[] }[] = [
    { key: 'artist', label: '아티스트', steps: breakdown.segments.artist },
    { key: 'business', label: '사업자', steps: breakdown.segments.business },
    { key: 'general', label: '일반', steps: breakdown.segments.general },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {segs.map((s) => (
        <div key={s.key}>
          <p className="mb-2 text-xs font-bold tracking-tight">{s.label} 퍼널</p>
          {s.steps.length === 0
            ? <AdminEmpty icon={<Inbox size={20} />} title="데이터 없음" />
            : <FunnelBars steps={s.steps} />}
        </div>
      ))}
    </div>
  );
}

/* ── 전환 변화 탭 ──────────────────────────────────────── */
function HistoryTab({
  history, loading, error, onRetry,
}: { history: MemberFunnelHistory | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !history) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  if (history.steps.length === 0) {
    return <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" description="이번달/지난달 코호트가 없어요." />;
  }

  const deltas = computeHistoryDeltas(history.steps);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">이번달 코호트 vs 지난달 코호트 · 가입 대비 각 단계 전환율(증감 pp)</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
              <th className="px-2 py-2 font-semibold">단계</th>
              <th className="px-2 py-2 text-right font-semibold">이번달</th>
              <th className="px-2 py-2 text-right font-semibold">지난달</th>
              <th className="px-2 py-2 text-right font-semibold">증감</th>
            </tr>
          </thead>
          <tbody>
            {deltas.map((d) => {
              const tone = d.deltaPct == null ? 'neutral' : d.deltaPct > 0 ? 'success' : d.deltaPct < 0 ? 'danger' : 'neutral';
              return (
                <tr key={d.key} className="border-b border-line/5 last:border-0">
                  <td className="px-2 py-2 font-semibold text-ink">{d.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{PCT(d.thisConv)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{PCT(d.prevConv)}</td>
                  <td className="px-2 py-2 text-right">
                    <AdminBadge tone={tone} size="sm">{formatDelta(d.deltaPct)}</AdminBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Revenue 탭 ────────────────────────────────────────── */
function RevenueTab({
  breakdown, loading, error, onRetry,
}: { breakdown: MemberFunnelBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !breakdown) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  if (breakdown.revenue.length === 0) {
    return <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" />;
  }

  const unsupported = breakdown.revenue.filter((s) => !s.supported).map((s) => s.label);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-mute">무료 → 결제 시도 → 결제 성공 → 구독 유지</p>
      <FunnelBars steps={breakdown.revenue} />
      {unsupported.length > 0 && (
        <AdminAlert
          tone="info"
          icon={<Ban size={16} />}
          title="유지 코호트 미지원"
          description={`${unsupported.join(' · ')} — 월별 구독 유지(리텐션) 이력 테이블이 없어 정확 산출이 불가합니다. 임의 추정하지 않으며, 필요 시 후속 마이그레이션에서 subscription_retention 코호트 스냅샷 도입이 필요합니다.`}
        />
      )}
    </div>
  );
}
