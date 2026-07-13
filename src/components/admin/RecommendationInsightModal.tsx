/**
 * RecommendationInsightModal — Explainability 상세 (Phase AI-RECOMMENDATION-2).
 *
 * 추천 상세: ① Recommendation ② 핵심 Evidence ③ Root Cause Candidates ④ Conflicting
 * Evidence ⑤ Suggested Action ⑥ Estimated Impact ⑦ Previous Outcomes ⑧ Learning Signal.
 *
 * Root Cause 는 **기존 시계열(admin_revenue_trend·admin_member_growth_series·
 * admin_streaming_timeline)을 재사용**해 상관/시간정렬로 "원인 후보"만 계산한다.
 * **상관관계를 인과관계로 표현하지 않는다.** 시계열이 없는 지표는 '분석 불충분/미지원'.
 * 기존 Recommendation Rule/KPI/실행 로직은 변경하지 않는다(계산은 순수 로직 재사용).
 */
import { useCallback, useEffect, useState } from 'react';
import { Info, GitBranch, Target, Activity, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AdminModal, AdminBadge, AdminAlert, AdminEmpty } from '@/components/admin/ui';
import {
  fetchRevenueTrend, fetchMemberGrowthSeries, fetchStreamingTimeline,
  registerOutcome, evaluateOutcome, fetchOutcomes, fetchLearningSignals, saveRootCauseSnapshot,
  type OutcomeRow, type LearningSignalRow,
} from '@/lib/adminApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import type { Recommendation } from '@/lib/aiRecommendation';
import {
  rankRootCauses, computeImpact, classifyOutcome, correlationPhrase,
  ANALYSIS_LABEL, ANALYSIS_TONE, OUTCOME_LABEL, OUTCOME_TONE,
  type CandidateInput, type RootCauseCandidate, type ImpactType, type ImpactResult, type Direction,
} from '@/lib/rootCauseIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

/** 추천별 lower/higher-better 방향(Outcome 판정용). 문제 지표는 대부분 lower_better. */
const DIRECTION: Record<string, Direction> = {
  revenue_drop: 'higher_better', signup_drop: 'higher_better', business_stall: 'higher_better',
  streaming_health: 'higher_better',
  payment_failure: 'lower_better', qc_backlog: 'lower_better', settlement_pending: 'lower_better',
  store_offline: 'lower_better', player_offline: 'lower_better', playback_error: 'lower_better', incident_up: 'lower_better',
};

export default function RecommendationInsightModal({ rec, onClose }: { rec: Recommendation; onClose: () => void }) {
  const [causes, setCauses] = useState<ReturnType<typeof rankRootCauses> | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [learning, setLearning] = useState<LearningSignalRow | null>(null);
  const [busy, setBusy] = useState(false);

  const primaryMetric = rec.evidence[0];
  const primaryValue = primaryMetric?.current ?? null;
  const impact = buildImpact(rec);

  const loadCauses = useCallback(async () => {
    setLoading(true);
    try {
      const settle = async <T,>(p: Promise<T>) => p.catch(() => null);
      const [revenue, member, streaming] = await Promise.all([
        settle(fetchRevenueTrend('30d')), settle(fetchMemberGrowthSeries('30d')), settle(fetchStreamingTimeline('30d')),
      ]);
      const inputs = buildCandidates(rec.ruleKey, {
        revenue: revenue?.points ?? [], member: member?.points ?? [], streaming: streaming?.points ?? [],
      });
      setCauses(rankRootCauses(inputs));
    } catch { setCauses(rankRootCauses([])); } finally { setLoading(false); }
  }, [rec.ruleKey]);

  const loadOutcomes = useCallback(async () => {
    try {
      const [o, ls] = await Promise.all([
        fetchOutcomes({ recommendationKey: rec.ruleKey, limit: 10 }).catch(() => [] as OutcomeRow[]),
        fetchLearningSignals().catch(() => [] as LearningSignalRow[]),
      ]);
      setOutcomes(o);
      setLearning(ls.find((x) => x.recommendation_key === rec.ruleKey) ?? null);
    } catch { /* degrade */ }
  }, [rec.ruleKey]);

  useEffect(() => { void loadCauses(); void loadOutcomes(); }, [loadCauses, loadOutcomes]);

  async function saveSnapshot() {
    if (!causes) return;
    setBusy(true);
    try {
      await saveRootCauseSnapshot({
        recommendationKey: rec.ruleKey, analysisStatus: causes.overallStatus,
        candidates: causes.candidates, conflicting: causes.conflicting, timeWindow: '30d',
      });
      toast.success('Root Cause 스냅샷 저장');
    } catch (e) { toast.error(`저장 실패: ${friendlyError(e, '0482 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  async function registerBefore() {
    if (primaryValue == null) { toast.error('Before Snapshot 값(현재 KPI)이 없습니다.'); return; }
    setBusy(true);
    try {
      await registerOutcome({
        recommendationKey: rec.ruleKey, metricKey: primaryMetric?.kpi ?? rec.ruleKey, beforeValue: primaryValue,
        actionType: rec.suggestedAction.ref, direction: DIRECTION[rec.ruleKey] ?? 'lower_better',
        measurementWindow: rec.ruleKey === 'qc_backlog' ? '24h' : '1h',
      });
      toast.success('Before Snapshot 기록 (측정 대기)');
      await loadOutcomes();
    } catch (e) { toast.error(`기록 실패: ${friendlyError(e, '중복이거나 0482 미적용')}`); }
    finally { setBusy(false); }
  }

  async function measureAfter(o: OutcomeRow) {
    if (primaryValue == null) { toast.error('After 측정값(현재 KPI)이 없습니다.'); return; }
    const status = classifyOutcome(o.before_value, primaryValue, (o.direction as Direction) ?? 'lower_better');
    if (status === 'pending' || status === 'insufficient_data') { toast.error('측정 불가(값 부족)'); return; }
    setBusy(true);
    try {
      await evaluateOutcome(o.id, primaryValue, status);
      toast.success(`Outcome: ${OUTCOME_LABEL[status]}`);
      await loadOutcomes();
    } catch (e) { toast.error(`측정 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  return (
    <AdminModal open onClose={onClose} title={<span className="flex items-center gap-1.5"><Info size={16} /> 추천 상세 · Root Cause & Impact</span>}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-xs">
        {/* ① Recommendation */}
        <section>
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminBadge tone="info" size="sm">{rec.category}</AdminBadge>
            <span className="font-bold text-ink">{rec.title}</span>
          </div>
          <p className="mt-1 text-ink-mute">{rec.reason} {rec.message}</p>
          <p className="mt-0.5 text-[10px] text-ink-dim">Confidence(데이터 충족률) {rec.confidence}% · Score {rec.score}</p>
        </section>

        {/* ② 핵심 Evidence */}
        <Section icon={<Activity size={13} />} title="핵심 Evidence">
          <div className="space-y-1">
            {rec.evidence.map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-bg-deep px-2 py-1.5">
                <span className="text-ink">{e.label}</span>
                <span className="text-ink-dim">{NUM(e.current)}{e.baseline != null ? ` / 기준 ${NUM(e.baseline)}` : ''}{e.changeRate != null ? ` (${e.changeRate}%)` : ''} · {e.source}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ③ Root Cause Candidates */}
        <Section icon={<GitBranch size={13} />} title="Root Cause 후보 (상관 분석 · 인과 아님)"
          action={causes && causes.candidates.length > 0 ? <button disabled={busy} onClick={() => void saveSnapshot()} className="rounded-full bg-bg-card px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink disabled:opacity-40">스냅샷 저장</button> : undefined}>
          {loading ? <div className="h-16 animate-pulse rounded-lg bg-bg-deep" />
            : !causes || causes.candidates.length === 0
              ? <AdminAlert tone="info" title="분석 가능한 원인 후보 없음" description="현재 데이터(시계열)로 분석 가능한 원인 후보가 없습니다. 상관관계로 인과를 확정할 수 없습니다." />
              : <div className="space-y-1.5">
                {causes.candidates.map((c, i) => <CauseCard key={c.metricKey} rank={i + 1} c={c} />)}
              </div>}
        </Section>

        {/* ④ Conflicting Evidence */}
        {causes && causes.conflicting.length > 0 && (
          <Section icon={<AlertTriangle size={13} />} title="충돌 근거 (숨기지 않음)">
            <AdminAlert tone="warning" title="일반적 원인 후보와 일치하지 않는 데이터" description="아래 지표는 예상과 반대로 움직였습니다. 하나의 원인으로 단정하지 않습니다." />
            <div className="mt-1.5 space-y-1">
              {causes.conflicting.map((c) => (
                <div key={c.metricKey} className="rounded-lg bg-bg-deep px-2 py-1.5">
                  <span className="text-ink">{c.metricLabel}</span> <span className="text-ink-dim">— {correlationPhrase(c)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ⑤ Suggested Action */}
        <Section icon={<Target size={13} />} title="Suggested Action (기존 Action Center/Dashboard 재사용)">
          <div className="rounded-lg bg-bg-deep px-2 py-1.5 text-ink">
            {rec.suggestedAction.label} <span className="text-ink-dim">· {rec.suggestedAction.kind === 'action' ? `Action Center · ${rec.suggestedAction.ref}` : `Dashboard · ${rec.suggestedAction.ref}`}</span>
          </div>
        </Section>

        {/* ⑥ Estimated Impact */}
        <Section icon={<TrendingUp size={13} />} title="Estimated Impact (계산식 명시)">
          {impact
            ? <div className="rounded-lg bg-bg-deep p-2">
              {impact.supported
                ? <>
                  <p className="text-ink">{impact.impactType} · 현재 {NUM(impact.currentValue)} · 대상 {NUM(impact.targetCount)} · 예상 잔여 {NUM(impact.estimatedRemaining)}{impact.coverageRate != null ? ` · 처리 범위 ${impact.coverageRate}%` : ''}</p>
                  <p className="mt-0.5 text-[10px] text-ink-dim">계산식: {impact.calculationMethod} · 가정: {impact.assumptions}</p>
                </>
                : <p className="text-ink-dim">Impact 계산 미지원: {impact.unsupportedReason}</p>}
            </div>
            : <p className="text-ink-dim">이 추천은 정량 Impact 계산식이 정의되지 않았습니다(임의 예측 금지).</p>}
        </Section>

        {/* ⑦ Previous Outcomes */}
        <Section icon={<CheckCircle2 size={13} />} title="Previous Outcomes (Before/After 측정)"
          action={<button disabled={busy || primaryValue == null} onClick={() => void registerBefore()} className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-40">Before 기록</button>}>
          {outcomes.length === 0
            ? <AdminEmpty icon={<CheckCircle2 size={20} />} title="측정 이력 없음" description="추천 실행 전 Before 를 기록하면 측정할 수 있습니다 (0482 미적용 시 비활성)." />
            : <div className="space-y-1">
              {outcomes.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-lg bg-bg-deep px-2 py-1.5">
                  <span className="text-ink-mute">Before {NUM(o.before_value)}{o.after_value != null ? ` → After ${NUM(o.after_value)} (Δ${NUM(o.delta)})` : ''} · {o.measurement_window}</span>
                  <span className="flex items-center gap-1">
                    <AdminBadge tone={OUTCOME_TONE[o.outcome_status as keyof typeof OUTCOME_TONE] ?? 'neutral'} size="sm">{OUTCOME_LABEL[o.outcome_status as keyof typeof OUTCOME_LABEL] ?? o.outcome_status}</AdminBadge>
                    {o.outcome_status === 'pending' && <button disabled={busy} onClick={() => void measureAfter(o)} className="rounded-full bg-bg-card px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink disabled:opacity-40">After 측정</button>}
                  </span>
                </div>
              ))}
            </div>}
        </Section>

        {/* ⑧ Learning Signal */}
        <Section icon={<Activity size={13} />} title="Learning Signal (참고용 · 자동 가중치 변경 없음)">
          {learning
            ? <div className="rounded-lg bg-bg-deep p-2 text-ink-mute">
              실행 {NUM(learning.times_executed)}회 · 개선 {NUM(learning.improved_count)} · 변화없음 {NUM(learning.unchanged_count)} · 악화 {NUM(learning.worsened_count)}
              {learning.success_rate != null ? ` · 성공률 ${learning.success_rate}%` : ''}{learning.average_delta != null ? ` · 평균 Δ ${learning.average_delta}` : ''}
            </div>
            : <p className="text-ink-dim">아직 집계된 학습 신호가 없습니다.</p>}
        </Section>

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-full bg-bg-deep px-3 py-1.5 text-ink-mute hover:text-ink">닫기</button>
        </div>
      </div>
    </AdminModal>
  );
}

function Section({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-bold text-ink">{icon} {title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function CauseCard({ rank, c }: { rank: number; c: RootCauseCandidate }) {
  return (
    <div className="rounded-lg bg-bg-deep p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-ink-dim">#{rank}</span>
          <span className="font-semibold text-ink">{c.metricLabel}</span>
          <AdminBadge tone={ANALYSIS_TONE[c.analysisStatus]} size="sm">{ANALYSIS_LABEL[c.analysisStatus]}</AdminBadge>
        </span>
        <span className="tabular-nums font-bold text-ink">{c.finalScore}점</span>
      </div>
      <p className="mt-0.5 text-[10px] text-ink-dim">
        현재 {NUM(c.currentValue)} / 기준 {NUM(c.baselineValue)}{c.deltaRate != null ? ` (${c.deltaRate}%)` : ''} · 상관 {c.correlationScore} · 시간정렬 {Math.round(c.temporalAlignmentScore * 100)}%{c.bestLag > 0 ? ` (선행 ${c.bestLag}버킷)` : ''} · 충족률 {Math.round(c.dataCoverageScore * 100)}%
      </p>
      <p className="mt-0.5 text-[10px] text-ink-mute">{correlationPhrase(c)} · {c.sourceDashboard}</p>
    </div>
  );
}

/* ── 추천별 원인 후보 시계열 구성 (기존 시계열 재사용; 없으면 빈 배열=미지원) ─── */
interface SeriesBags {
  revenue: { revenue: number; new_payments: number; renewal_payments: number; active_subs: number; refunds: number; cancels: number }[];
  member: { new_total: number; new_general: number; new_business: number }[];
  streaming: { completes: number; errors: number; skips: number; starts: number }[];
}
function buildCandidates(ruleKey: string, s: SeriesBags): CandidateInput[] {
  const neg = (arr: number[]) => arr.map((v) => -v); // 증가=악화 지표는 부호 반전 → 동반 악화가 양의 상관
  const last = <T,>(a: T[]) => (a.length ? a[a.length - 1] : null);
  const first = <T,>(a: T[]) => (a.length ? a[0] : null);
  const cand = (metricKey: string, label: string, target: number[], series: number[], cur: number | null, base: number | null, dash: string, rpc: string): CandidateInput => ({
    metricKey, label, targetSeries: target, candidateSeries: series, currentValue: cur, baselineValue: base, sourceDashboard: dash, sourceRpc: rpc, timeWindow: '30d',
  });

  if (ruleKey === 'revenue_drop') {
    const rev = s.revenue.map((p) => p.revenue);
    return [
      cand('new_payments', '신규 결제', rev, s.revenue.map((p) => p.new_payments), last(s.revenue)?.new_payments ?? null, first(s.revenue)?.new_payments ?? null, 'Revenue Trend', 'admin_revenue_trend'),
      cand('renewal_payments', '갱신 결제', rev, s.revenue.map((p) => p.renewal_payments), last(s.revenue)?.renewal_payments ?? null, first(s.revenue)?.renewal_payments ?? null, 'Revenue Trend', 'admin_revenue_trend'),
      cand('active_subs', '활성 구독', rev, s.revenue.map((p) => p.active_subs), last(s.revenue)?.active_subs ?? null, first(s.revenue)?.active_subs ?? null, 'Revenue Trend', 'admin_revenue_trend'),
      cand('refunds', '환불(악화)', rev, neg(s.revenue.map((p) => p.refunds)), last(s.revenue)?.refunds ?? null, first(s.revenue)?.refunds ?? null, 'Revenue Trend', 'admin_revenue_trend'),
      cand('cancels', '구독 취소(악화)', rev, neg(s.revenue.map((p) => p.cancels)), last(s.revenue)?.cancels ?? null, first(s.revenue)?.cancels ?? null, 'Revenue Trend', 'admin_revenue_trend'),
      cand('new_business', '신규 사업자', rev, s.member.map((p) => p.new_business), last(s.member)?.new_business ?? null, first(s.member)?.new_business ?? null, 'Member Growth', 'admin_member_growth_series'),
    ];
  }
  if (ruleKey === 'signup_drop') {
    const total = s.member.map((p) => p.new_total);
    return [
      cand('new_general', '일반 가입', total, s.member.map((p) => p.new_general), last(s.member)?.new_general ?? null, first(s.member)?.new_general ?? null, 'Member Growth', 'admin_member_growth_series'),
      cand('new_business', '사업자 가입', total, s.member.map((p) => p.new_business), last(s.member)?.new_business ?? null, first(s.member)?.new_business ?? null, 'Member Growth', 'admin_member_growth_series'),
    ];
  }
  if (ruleKey === 'business_stall') {
    const biz = s.member.map((p) => p.new_business);
    return [cand('new_total', '전체 신규 가입', biz, s.member.map((p) => p.new_total), last(s.member)?.new_total ?? null, first(s.member)?.new_total ?? null, 'Member Growth', 'admin_member_growth_series')];
  }
  if (ruleKey === 'streaming_health' || ruleKey === 'playback_error') {
    const target = ruleKey === 'playback_error' ? neg(s.streaming.map((p) => p.errors)) : s.streaming.map((p) => p.completes);
    return [
      cand('errors', 'Playback 오류(악화)', target, neg(s.streaming.map((p) => p.errors)), last(s.streaming)?.errors ?? null, first(s.streaming)?.errors ?? null, 'Streaming Timeline', 'admin_streaming_timeline'),
      cand('skips', 'Skip(악화)', target, neg(s.streaming.map((p) => p.skips)), last(s.streaming)?.skips ?? null, first(s.streaming)?.skips ?? null, 'Streaming Timeline', 'admin_streaming_timeline'),
      cand('starts', '재생 시작', target, s.streaming.map((p) => p.starts), last(s.streaming)?.starts ?? null, first(s.streaming)?.starts ?? null, 'Streaming Timeline', 'admin_streaming_timeline'),
    ];
  }
  // 시계열 미지원 추천(QC/정산/오프라인/Incident/결제실패 스냅샷) → 후보 없음(미지원)
  return [];
}

/* ── 추천별 Impact (계산식 명시; 없으면 null) ──────────────────────────── */
function buildImpact(rec: Recommendation): ImpactResult | null {
  const val = (kpi: string) => rec.evidence.find((e) => e.kpi === kpi)?.current ?? rec.evidence[0]?.current ?? null;
  const map: Record<string, () => ImpactResult> = {
    qc_backlog: () => computeImpact('backlog_reduction', { current: val('qc_pending'), target: 50 }),
    payment_failure: () => { const f = val('failed_payments'); return computeImpact('payment_recovery', { current: f, target: f }); },
    store_offline: () => { const o = val('offline_stores'); return computeImpact('recovery_coverage', { current: o, target: o }); },
    player_offline: () => { const o = val('offline_players'); return computeImpact('recovery_coverage', { current: o, target: o }); },
  };
  const fn = map[rec.ruleKey as ImpactType extends never ? string : string];
  return fn ? fn() : null;
}
