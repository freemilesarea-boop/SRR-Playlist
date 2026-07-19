/**
 * LearningSignalsSection — Continuous Learning Signal Foundation & Safe Feedback Loop
 * (Phase AI-LEARNING-1).
 *
 * 수집(Exposure Ledger)·검증·Attribution·집계·Bias·v1/v2 비교·Shadow Weight
 * Proposal·Backtest·Human Review 까지만. Production Weight/v1·v2/Playlist/Queue/
 * Scheduler/Player 는 불변 — Apply/Deploy/Publish 버튼은 존재하지 않는다.
 *
 * 탭: Overview · Exposures · Events · Aggregates · Proposals · Limitations.
 * 시각화는 HTML Funnel/Bar + 수치 표 병행(외부 라이브러리 없음).
 */
import { useCallback, useEffect, useState } from 'react';
import { Brain, Radio, ListChecks, Layers, Scale, ShieldAlert, RefreshCw, Inbox } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  buildAiLearnAggregates, createAiLearnProposal, fetchAiLearnAggregates, fetchAiLearnEvents,
  fetchAiLearnExposures, fetchAiLearnOverview, fetchAiLearnProposalDetail, fetchAiLearnProposals,
  recordAiLearnBacktest, setAiLearnProposalStatus,
  type AiLearnAggregateRow, type AiLearnEventRow, type AiLearnExposureRow, type AiLearnOverview,
  type AiLearnProposalDetail, type AiLearnProposalRow, type AiLearnProposalStatus,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  FIXED_LEARNING_WARNING, SAMPLE_THRESHOLDS, WEIGHT_DELTA_CAP,
  backtestProposal, buildLearningExplanation, generateWeightProposal,
  type BacktestCandidate,
} from '@/lib/learningSignals';
import { REC_WEIGHTS } from '@/lib/recommendIntelV2';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'exposures' | 'events' | 'aggregates' | 'proposals' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof Brain }[] = [
  { key: 'overview', label: 'Overview', icon: Brain },
  { key: 'exposures', label: 'Exposures', icon: Radio },
  { key: 'events', label: 'Events', icon: ListChecks },
  { key: 'aggregates', label: 'Aggregates', icon: Layers },
  { key: 'proposals', label: 'Proposals', icon: Scale },
  { key: 'limits', label: 'Limitations', icon: ShieldAlert },
];

const STATUS_TONE: Record<AiLearnProposalStatus, 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral', ready_for_review: 'info', approved: 'success', rejected: 'danger', archived: 'neutral',
};

const KNOWN_LIMITATIONS = [
  '승인된 Learning Proposal은 실제 Production Recommendation Weight에 자동 반영되지 않습니다(Apply RPC 자체가 없음).',
  '이번 Phase는 Player에 Event Emission을 배선하지 않았습니다 — 수집 RPC만 준비된 상태이며, 원장이 비어 있으면 데이터가 없다는 뜻입니다(가상 생성 없음).',
  'Recommendation v2 Shadow Preview 노출은 is_shadow=true로 분리되며 Production Exposure로 집계되지 않습니다.',
  '30일 재생 이벤트는 Exposure Proxy일 뿐 정식 노출 원장이 아닙니다(혼용 표기 금지).',
  'Reaction은 Production 0행 실측 — 수집 경로는 연결돼 있으며(0345), 0행 원인은 사용 부재 유력/저장 실패 여부 unknown으로 구분 보고합니다.',
  'Sample 기준(Track: 노출20/재생10 · Algorithm: 노출100/유효결과30) 미달은 기준 완화 없이 insufficient_data로 표시합니다.',
  'v1/v2 비교에서 v2는 Offline Estimated Outcome이며 실제 A/B 결과가 아닙니다 — 우열을 단정하지 않습니다.',
  'Weight Proposal은 Δ≤5·총합 100·Hard Policy(policyCompliance) 불변이며, Backtest 없이 ready_for_review로 승격할 수 없습니다.',
  '상관 관계는 인과가 아니며, Bias 감지는 자동 보정 없이 경고만 기록합니다.',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다. Migration 0565~0568은 Production 미적용입니다.',
];

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {hint ? <div className="text-[10px] text-ink-mute">{hint}</div> : null}
    </div>
  );
}

/** Exposure→Playback→Outcome Funnel — HTML Bar + 수치 병행. */
function Funnel({ overview }: { overview: AiLearnOverview }) {
  const steps = [
    { label: 'Exposure(원장)', value: overview.exposures_total },
    { label: 'Event 전체', value: overview.events_total },
    { label: 'Valid Signal', value: overview.events_valid },
    { label: 'Attributed', value: overview.attributed },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-1">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-[10px]">
          <span className="w-28 shrink-0 text-ink-mute">{s.label}</span>
          <div className="h-2 flex-1 rounded bg-black/30">
            <div className="h-2 rounded bg-accent" style={{ width: `${(s.value / max) * 100}%` }} />
          </div>
          <span className="w-14 text-right text-ink">{NUM(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LearningSignalsSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AiLearnOverview | null>(null);
  const [exposures, setExposures] = useState<AiLearnExposureRow[] | null>(null);
  const [events, setEvents] = useState<AiLearnEventRow[] | null>(null);
  const [aggregates, setAggregates] = useState<AiLearnAggregateRow[] | null>(null);
  const [proposals, setProposals] = useState<AiLearnProposalRow[] | null>(null);
  const [detail, setDetail] = useState<AiLearnProposalDetail | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [deltaKey, setDeltaKey] = useState<string>('sequenceCompatibility');
  const [deltaVal, setDeltaVal] = useState(2);
  const [nowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [o, x, e, a, p] = await Promise.all([
        fetchAiLearnOverview(), fetchAiLearnExposures(50, 0), fetchAiLearnEvents(null, 50),
        fetchAiLearnAggregates('track', '7d', 100), fetchAiLearnProposals(null, 50),
      ]);
      setOverview(o); setExposures(x); setEvents(e); setAggregates(a); setProposals(p);
    } catch (e) { setErr(classifyAdminError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const runAggregate = useCallback(async (window: 'daily' | '7d' | '28d') => {
    setBusy(true);
    try { const r = await buildAiLearnAggregates(window); toast.success(`${window} 집계 ${r.rows}행 갱신`); await load(); }
    catch (e) { toast.error(`집계 실패: ${friendlyError(e, '0568 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }, [load]);

  const createProposal = useCallback(async () => {
    setBusy(true);
    try {
      const validOutcomes = overview?.events_valid ?? 0;
      const gen = generateWeightProposal({ desiredDeltas: { [deltaKey]: deltaVal }, sampleValidOutcomes: validOutcomes });
      if (!gen.ok) { toast.error(`Proposal 생성 불가: ${gen.reason}`); return; }
      // Backtest 는 집계된 Track 신호로 Offline 재점수화(서버가 게이트 재검증).
      const cands: BacktestCandidate[] = (aggregates ?? []).map((a) => ({
        trackId: a.entity_id, artistKey: null, genre: null,
        signals: {
          storeFit: null, trackQuality: null,
          sequenceCompatibility: null, novelty: null,
          reactionSignal: a.metrics.completion_rate == null ? null : Number(a.metrics.completion_rate) * 100,
          fatigueControl: a.metrics.skip_rate == null ? null : (1 - Number(a.metrics.skip_rate)) * 100,
        },
        hardViolation: false,
      }));
      const backtest = backtestProposal(cands, gen.currentWeights ?? {}, gen.proposedWeights ?? {}, 20);
      const explanation = buildLearningExplanation({
        windowLabel: '최근 7일', storeCount: overview?.store_coverage ?? 0,
        playCount: events?.filter((e) => e.event_type === 'playback_started').length ?? 0,
        attributionRate: overview && overview.events_total > 0 ? overview.attributed / overview.events_total : null,
        v1AttributedPlays: 0, reactionCount: 0, proposal: gen, backtest,
      });
      const saved = await createAiLearnProposal({
        scope_type: 'global',
        algorithm_version: 'rec-v2', base_weight_version: 'rec-v2-w1', proposed_weight_version: 'rec-v2-w2-proposal',
        current_weights: gen.currentWeights, proposed_weights: gen.proposedWeights, deltas: gen.deltas,
        evidence_window: { window: '7d' }, sample_count: validOutcomes,
        confidence: overview && overview.events_total > 0 ? overview.events_valid / overview.events_total : 0,
        backtest_result: { ...backtest, hard_gate_violations: backtest.hardGateViolations, verdict: backtest.verdict },
        explanation, insufficient_data: backtest.verdict === 'insufficient_data' ? ['backtest_insufficient'] : [],
      });
      toast.success(saved.duplicate ? '동일 조건 Proposal이 이미 있습니다.' : 'Shadow Proposal 저장(Production 미적용).');
      setDetail(saved); await load();
    } catch (e) { toast.error(`Proposal 실패: ${friendlyError(e, 'Sample/Δ/합계 게이트에서 서버가 거부할 수 있습니다')}`); }
    finally { setBusy(false); }
  }, [overview, aggregates, events, deltaKey, deltaVal, load]);

  const openDetail = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await fetchAiLearnProposalDetail(id)); }
    catch (e) { toast.error(friendlyError(e, '')); }
    finally { setBusy(false); }
  }, []);

  const changeStatus = useCallback(async (id: string, status: AiLearnProposalStatus) => {
    if (status === 'rejected' && !rejectReason.trim()) { toast.error('거절 사유를 입력하세요.'); return; }
    setBusy(true);
    try {
      const d = await setAiLearnProposalStatus(id, status, status === 'rejected' ? rejectReason.trim() : undefined);
      setDetail(d); setRejectReason('');
      toast.success(status === 'approved' ? '검토 승인 기록(Production Weight 적용 아님)' : `상태 변경: ${status}`);
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${friendlyError(e, 'Sample/Backtest 게이트로 승격이 차단될 수 있습니다')}`); }
    finally { setBusy(false); }
  }, [rejectReason, load]);

  const rerunBacktest = useCallback(async (d: AiLearnProposalDetail) => {
    setBusy(true);
    try {
      const cands: BacktestCandidate[] = (aggregates ?? []).map((a) => ({
        trackId: a.entity_id, artistKey: null, genre: null,
        signals: {
          reactionSignal: a.metrics.completion_rate == null ? null : Number(a.metrics.completion_rate) * 100,
          fatigueControl: a.metrics.skip_rate == null ? null : (1 - Number(a.metrics.skip_rate)) * 100,
        },
        hardViolation: false,
      }));
      const backtest = backtestProposal(cands, d.proposal.current_weights, d.proposal.proposed_weights, 20);
      const saved = await recordAiLearnBacktest(d.proposal.id, { ...backtest, hard_gate_violations: backtest.hardGateViolations, verdict: backtest.verdict });
      setDetail(saved);
      toast.success(`Backtest ${backtest.verdict}(Offline — 실제 성과 아님)`);
    } catch (e) { toast.error(friendlyError(e, '')); }
    finally { setBusy(false); }
  }, [aggregates]);

  return (
    <AdminCard title="Learning Signal Foundation" subtitle="AI-LEARNING-1 — Safe Feedback Loop (Shadow · Weight 자동 반영 없음)">
      <AdminAlert tone="info">{FIXED_LEARNING_WARNING}</AdminAlert>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
            <t.icon className="mr-1 inline h-3 w-3" />{t.label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={loading || busy}
          className="ml-auto rounded-full bg-bg-deep px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-50">
          <RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>

      {err ? (
        <div className="mt-3">
          <AdminAlert tone="danger">불러오기 실패: {err.message}</AdminAlert>
          <button type="button" onClick={() => void load()} className="mt-2 rounded bg-bg-deep px-3 py-1.5 text-xs text-ink">다시 시도</button>
        </div>
      ) : null}

      {tab === 'overview' ? (
        overview ? (
          <div className="mt-3 space-y-3 text-[11px]">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Exposure(원장)" value={NUM(overview.exposures_total)} hint={`Shadow ${NUM(overview.exposures_shadow)} 별도`} />
              <Box label="Event" value={NUM(overview.events_total)} hint={`valid ${NUM(overview.events_valid)} · invalid ${NUM(overview.events_invalid)} · excluded ${NUM(overview.events_excluded)}`} />
              <Box label="Attribution" value={`${NUM(overview.attributed)} / ${NUM(overview.unattributed)}`} hint="attributed / unattributed" />
              <Box label="Coverage" value={`${NUM(overview.track_coverage)} 곡 · ${NUM(overview.store_coverage)} 매장`} />
              <Box label="Proposal" value={NUM(overview.proposals)} hint={`Aggregate ${NUM(overview.aggregates)}`} />
            </div>
            <Funnel overview={overview} />
            {overview.exposures_total === 0 ? (
              <AdminAlert tone="warning">Exposure 원장이 비어 있습니다 — Player Emission 미배선 상태(이번 Phase 범위 밖)이며, 가상의 노출을 생성하지 않습니다. Learning Readiness: insufficient_data.</AdminAlert>
            ) : null}
            <div className="flex gap-2">
              {(['daily', '7d', '28d'] as const).map((w) => (
                <button key={w} type="button" onClick={() => void runAggregate(w)} disabled={busy}
                  className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">{w} 집계 실행</button>
              ))}
            </div>
          </div>
        ) : <p className="mt-3 text-[11px] text-ink-mute">불러오는 중…</p>
      ) : null}

      {tab === 'exposures' ? (
        <div className="mt-3 space-y-1 text-[11px]">
          {!loading && exposures && exposures.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Exposure 없음" description="원장이 비어 있습니다(Emission 미배선 · 가상 생성 없음). 0568 미적용 환경에서도 비어 있습니다." />
          ) : null}
          {exposures?.map((x) => (
            <div key={x.id} className="flex justify-between rounded bg-bg-deep px-3 py-1.5">
              <span className="text-ink">{x.title ?? x.track_id} <span className="text-ink-mute">{x.source}{x.is_shadow ? ' · shadow' : ''}{x.recommendation_rank != null ? ` · #${x.recommendation_rank + 1}` : ''}</span></span>
              <span className="text-ink-mute">{relativeTimeKo(x.exposed_at, nowMs)} · {x.playback_started_at ? '재생됨' : x.selected_at ? '선택됨' : '노출만'}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'events' ? (
        <div className="mt-3 space-y-1 text-[11px]">
          {!loading && events && events.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Event 없음" description="수집된 학습 이벤트가 없습니다(가상 생성 없음)." />
          ) : null}
          {events?.map((e) => (
            <div key={e.id} className="flex justify-between rounded bg-bg-deep px-3 py-1.5">
              <span className="text-ink">{e.event_type} · {e.title ?? e.track_id}
                <span className="text-ink-mute"> · {e.signal_type} {e.normalized_value ?? ''} · conf {e.confidence}</span></span>
              <span className="text-ink-mute">{e.signal_status} · {e.attribution_status} · {relativeTimeKo(e.occurred_at, nowMs)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'aggregates' ? (
        <div className="mt-3 space-y-1 text-[11px]">
          {!loading && aggregates && aggregates.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Aggregate 없음" description="Overview 탭에서 집계를 실행하세요(데이터가 없으면 0행)." />
          ) : null}
          {aggregates?.map((a) => (
            <div key={`${a.entity_type}-${a.entity_id}-${a.window_start}`} className="flex justify-between rounded bg-bg-deep px-3 py-1.5">
              <span className="text-ink">{a.title ?? a.entity_id}
                <span className="text-ink-mute"> · 재생 {String(a.metrics.play_count ?? 0)} · 완청률 {a.metrics.completion_rate == null ? '—' : String(a.metrics.completion_rate)} · 스킵률 {a.metrics.skip_rate == null ? '—' : String(a.metrics.skip_rate)}</span></span>
              <span className="text-ink-mute">{a.sample_status === 'sufficient' ? <AdminBadge tone="success">sufficient</AdminBadge> : <AdminBadge tone="warning">insufficient</AdminBadge>} conf {a.confidence}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'proposals' ? (
        <div className="mt-3 space-y-3 text-[11px]">
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-bg-deep p-3">
            <label className="text-ink-mute">가중치
              <select value={deltaKey} onChange={(e) => setDeltaKey(e.target.value)} className="mt-1 block rounded bg-black/30 px-2 py-1.5 text-xs text-ink">
                {Object.keys(REC_WEIGHTS).filter((k) => k !== 'policyCompliance').map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="text-ink-mute">Δ (±{WEIGHT_DELTA_CAP})
              <input type="number" min={-WEIGHT_DELTA_CAP} max={WEIGHT_DELTA_CAP} value={deltaVal}
                onChange={(e) => setDeltaVal(Math.max(-WEIGHT_DELTA_CAP, Math.min(WEIGHT_DELTA_CAP, Number(e.target.value) || 0)))}
                className="mt-1 block w-20 rounded bg-black/30 px-2 py-1.5 text-xs text-ink" />
            </label>
            <button type="button" onClick={() => void createProposal()} disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
              Shadow Proposal 생성(+Backtest)
            </button>
            <span className="text-ink-mute">유효 결과 {NUM(overview?.events_valid)}건 — {SAMPLE_THRESHOLDS.algorithm.validOutcome}건 미만이면 서버가 생성을 거부합니다.</span>
          </div>

          {proposals?.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2">
              <div>
                <div className="font-semibold text-ink">{p.base_weight_version} → {p.proposed_weight_version} <AdminBadge tone={STATUS_TONE[p.status]}>{p.status}</AdminBadge></div>
                <div className="text-ink-mute">{p.scope_type} · Sample {NUM(p.sample_count)} · conf {p.confidence} · {relativeTimeKo(p.created_at, nowMs)} · {p.created_by_name ?? '?'}</div>
              </div>
              <button type="button" onClick={() => void openDetail(p.id)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink hover:text-white disabled:opacity-50">상세</button>
            </div>
          ))}
          {!loading && proposals && proposals.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Proposal 없음" description="Sample 충족 후 생성하세요(0568 미적용 환경에서는 비어 있습니다)." />
          ) : null}

          {detail ? (
            <div className="space-y-2 rounded-lg bg-bg-deep p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{detail.proposal.proposed_weight_version}</span>
                <AdminBadge tone={STATUS_TONE[detail.proposal.status]}>{detail.proposal.status}</AdminBadge>
                <span className="text-ink-mute">Backtest: {String(detail.proposal.backtest_result.verdict ?? '미실행')}</span>
              </div>
              <div className="text-ink-mute">
                Δ: {Object.entries(detail.proposal.deltas).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') || '—'}
              </div>
              <div className="leading-5 text-ink">
                {detail.proposal.explanation.map((l, i) => <div key={i}>{l}</div>)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void rerunBacktest(detail)} disabled={busy} className="rounded bg-black/20 px-2.5 py-1 text-ink disabled:opacity-50">Backtest 재실행</button>
                {detail.proposal.status === 'draft' ? (
                  <button type="button" onClick={() => void changeStatus(detail.proposal.id, 'ready_for_review')} disabled={busy} className="rounded bg-black/20 px-2.5 py-1 text-ink disabled:opacity-50">Review Ready</button>
                ) : null}
                {detail.proposal.status === 'ready_for_review' ? (
                  <>
                    <button type="button" onClick={() => void changeStatus(detail.proposal.id, 'approved')} disabled={busy} className="rounded bg-black/20 px-2.5 py-1 text-emerald-300 disabled:opacity-50">Approve(실험 후보 기록)</button>
                    <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="거절 사유(필수)" className="rounded bg-black/30 px-2 py-1 text-ink" />
                    <button type="button" onClick={() => void changeStatus(detail.proposal.id, 'rejected')} disabled={busy} className="rounded bg-black/20 px-2.5 py-1 text-red-300 disabled:opacity-50">Reject</button>
                  </>
                ) : null}
                {detail.proposal.status !== 'archived' ? (
                  <button type="button" onClick={() => void changeStatus(detail.proposal.id, 'archived')} disabled={busy} className="rounded bg-black/20 px-2.5 py-1 text-ink-mute disabled:opacity-50">Archive</button>
                ) : null}
              </div>
              <div>
                <div className="mb-1 font-semibold text-ink">Audit</div>
                {detail.events.map((e, i) => (
                  <div key={i} className="text-ink-mute">
                    {relativeTimeKo(e.created_at, nowMs)} · {e.event_type}{e.previous_status ? ` (${e.previous_status}→${e.next_status})` : ''} · {e.actor_name ?? 'system'}{e.reason ? ` · ${e.reason}` : ''}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'limits' ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </AdminCard>
  );
}
