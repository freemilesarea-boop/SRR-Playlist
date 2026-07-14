/**
 * DecisionOutcomeSection — Enterprise Decision Memory, Outcome Intelligence &
 * Institutional Learning Center (Phase AI-OPS-11).
 *
 * Recommendation → Human Decision → Execution Reference → Observation → Outcome →
 * Expected vs Actual → Quality/Accuracy/Calibration → Patterns → Lessons → Retrieval → Audit.
 * 승인 ≠ 성공 · 실행 Reference ≠ 실제 실행 검증 · 상관 ≠ 인과 · 자동 실행/학습 없음.
 *
 * 탭 25개: Overview · Decision Memory · Recommendations · Human Decisions ·
 * Execution References · Observation Windows · Baselines · Expected Outcomes ·
 * Actual Outcomes · Expected vs Actual · Outcome Evaluation · Decision Quality ·
 * Recommendation Accuracy · Confidence Calibration · Decision Patterns ·
 * Positive/Negative/Inconclusive Outcomes · Lessons Learned · Institutional Memory ·
 * Similar Decisions · Decision Timeline · External Outcome References · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Brain, Eye, FileText, Grid3x3, History, Layers, Lightbulb,
  Link2, Lock, RefreshCw, Scale, ScrollText, Search, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchDMSummary, fetchDMRecords, fetchDMDetail, createDMRecord, decideDMRecord,
  addDMExecutionRef, updateDMExecutionVerification, createDMObservation, updateDMObservation,
  recordDMOutcome, reviewDMOutcome, recordDMExternalOutcome,
  fetchDMExecutionRefs, fetchDMObservations, fetchDMOutcomes, fetchDMAudit,
  type DMSummary, type DMRecordRow, type DMExecutionRefRow, type DMObservationRow,
  type DMOutcomeRow, type DMEventRow, type DMDetail,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  decisionStatusFacts, classifyExecutionVerification, canCloseObservation,
  classifyBaselineAvailability, calculateActualOutcome, evaluateExpectedVsActual,
  classifyOutcomeStatus, calculateDecisionQuality, evaluateRecommendationAccuracy,
  calculateConfidenceCalibration, detectDecisionPatterns, buildLessonsLearned,
  calculateAdoptionRate, calculateObservationRate, findSimilarDecisions, buildDecisionTimeline,
  DM_SUPPORT, DECISION_DOMAINS,
  type DecisionStatus, type OutcomeStatus, type MetricVerdict, type ExecutionVerification,
  type RepeatabilityStatus, type AccuracyVerdict, type DecisionPatternRecord,
} from '@/lib/decisionOutcomeIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'decisions' | 'recommendations' | 'humandecisions' | 'execrefs' | 'observations'
  | 'baselines' | 'expected' | 'actual' | 'expvsact' | 'evaluation' | 'quality' | 'accuracy' | 'calibration'
  | 'patterns' | 'positive' | 'negative' | 'inconclusive' | 'lessons' | 'memory' | 'similar' | 'timeline'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'decisions', label: 'Decision Memory', icon: BookOpen },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'humandecisions', label: 'Human Decisions', icon: Scale },
  { key: 'execrefs', label: 'Execution References', icon: Link2 },
  { key: 'observations', label: 'Observation Windows', icon: Eye },
  { key: 'baselines', label: 'Baselines', icon: History },
  { key: 'expected', label: 'Expected Outcomes', icon: Target },
  { key: 'actual', label: 'Actual Outcomes', icon: TrendingUp },
  { key: 'expvsact', label: 'Expected vs Actual', icon: Scale },
  { key: 'evaluation', label: 'Outcome Evaluation', icon: FileText },
  { key: 'quality', label: 'Decision Quality', icon: Scale },
  { key: 'accuracy', label: 'Recommendation Accuracy', icon: Target },
  { key: 'calibration', label: 'Confidence Calibration', icon: Brain },
  { key: 'patterns', label: 'Decision Patterns', icon: Search },
  { key: 'positive', label: 'Positive Outcomes', icon: TrendingUp },
  { key: 'negative', label: 'Negative Outcomes', icon: AlertTriangle },
  { key: 'inconclusive', label: 'Inconclusive Outcomes', icon: AlertTriangle },
  { key: 'lessons', label: 'Lessons Learned', icon: Lightbulb },
  { key: 'memory', label: 'Institutional Memory', icon: BookOpen },
  { key: 'similar', label: 'Similar Decisions', icon: Search },
  { key: 'timeline', label: 'Decision Timeline', icon: History },
  { key: 'external', label: 'External Outcome References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_OUTCOME_ACTIONS = ['execution_completed_reference', 'execution_failed_reference', 'metric_verified_reference', 'revenue_confirmed_reference', 'contract_outcome_reference', 'settlement_outcome_reference', 'deployment_outcome_reference', 'rollback_outcome_reference', 'security_outcome_reference', 'privacy_outcome_reference', 'manual_outcome_reference'];

export default function DecisionOutcomeSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<DMSummary>({});
  const [records, setRecords] = useState<DMRecordRow[]>([]);
  const [execRefs, setExecRefs] = useState<DMExecutionRefRow[]>([]);
  const [observations, setObservations] = useState<DMObservationRow[]>([]);
  const [outcomes, setOutcomes] = useState<DMOutcomeRow[]>([]);
  const [audit, setAudit] = useState<DMEventRow[]>([]);
  const [detail, setDetail] = useState<DMDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState(EXT_OUTCOME_ACTIONS[0]);
  const [memDomain, setMemDomain] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, e, o, out, au] = await Promise.all([
        fetchDMSummary(), fetchDMRecords(null, null, 100), fetchDMExecutionRefs(100),
        fetchDMObservations(null, 100), fetchDMOutcomes(null, 100), fetchDMAudit(100),
      ]);
      setSummary(s); setRecords(r); setExecRefs(e); setObservations(o); setOutcomes(out); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수(Human Decision)'); return null; }
    return reason.trim();
  };
  const loadDetail = async (id: string) => {
    setSelectedId(id);
    try { setDetail(await fetchDMDetail(id)); }
    catch (e) { toast.error(classifyAdminError(e).message); }
  };

  /* ── 순수 로직 분석(inventory 기반) ── */
  const decisionsByStatus = (summary.decisions_by_status ?? {}) as Record<string, number>;
  const outcomesByStatus = (summary.outcomes_by_status ?? {}) as Record<string, number>;
  const sourceCounts = (summary.source_counts ?? {}) as Record<string, number>;

  const adoptionRate = useMemo(() => {
    const accepted = records.filter((r) => r.decision_type === 'accept_recommendation' && r.decision_status !== 'draft').length;
    const rejected = records.filter((r) => r.decision_type === 'reject_recommendation' && r.decision_status !== 'draft').length;
    return calculateAdoptionRate({ accepted, rejected });
  }, [records]);
  const observationRate = useMemo(() => {
    const decided = records.filter((r) => ['decided', 'observation_pending', 'outcome_review_pending', 'evaluated'].includes(r.decision_status)).length;
    const observed = new Set(observations.map((o) => o.decision_memory_id)).size;
    return calculateObservationRate({ decided: decided || null, observed });
  }, [records, observations]);

  const patterns = useMemo(() => detectDecisionPatterns(records.map((r): DecisionPatternRecord => ({
    domain: r.decision_domain, type: r.decision_type, status: r.decision_status as DecisionStatus,
    approverId: r.approver_id, hasExecutionRef: execRefs.some((e) => e.decision_memory_id === r.id),
    hasOutcome: outcomes.some((o) => o.decision_memory_id === r.id),
  }))), [records, execRefs, outcomes]);

  const accuracySamples = useMemo(() => records.map((r) => {
    const approved = r.decision_type === 'accept_recommendation' && ['decided', 'observation_pending', 'outcome_review_pending', 'evaluated'].includes(r.decision_status);
    const referenced = execRefs.some((e) => e.decision_memory_id === r.id);
    const outcome = outcomes.find((o) => o.decision_memory_id === r.id);
    const metricVerdict: MetricVerdict | null = outcome
      ? outcome.outcome_status === 'positive' ? 'met_expectation'
        : outcome.outcome_status === 'negative' ? 'missed_expectation'
        : outcome.outcome_status === 'mixed' ? 'partially_met'
        : outcome.outcome_status === 'pending' || outcome.outcome_status === 'observation_incomplete' ? 'outcome_pending'
        : 'insufficient_data'
      : null;
    return { record: r, verdict: evaluateRecommendationAccuracy({ approved, executionReferenced: referenced, metricVerdict, riskPredicted: null, riskRealized: null }) };
  }), [records, execRefs, outcomes]);

  const calibration = useMemo(() => calculateConfidenceCalibration(accuracySamples.map((s) => ({ confidence: s.record.confidence_at_decision, verdict: s.verdict as AccuracyVerdict }))), [accuracySamples]);

  const filteredMemory = useMemo(() => (memDomain ? records.filter((r) => r.decision_domain === memDomain) : records), [records, memDomain]);

  const similar = useMemo(() => {
    const cur = records.find((r) => r.id === selectedId);
    if (!cur) return [];
    return findSimilarDecisions(
      { domain: cur.decision_domain, type: cur.decision_type, sourceSystem: cur.source_system },
      records.filter((r) => r.id !== cur.id).map((r) => ({
        id: r.decision_code, domain: r.decision_domain, type: r.decision_type, sourceSystem: r.source_system,
        outcomeStatus: (outcomes.find((o) => o.decision_memory_id === r.id)?.outcome_status ?? null) as OutcomeStatus | null,
        repeatability: (outcomes.find((o) => o.decision_memory_id === r.id)?.repeatability_status ?? null) as RepeatabilityStatus | null,
      })),
    );
  }, [records, outcomes, selectedId]);

  if (loading) return <AdminCard title="Enterprise Decision Memory & Outcome Intelligence Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Decision Memory & Outcome Intelligence Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const outcomeList = (statuses: string[], emptyTitle: string) => {
    const list = outcomes.filter((o) => statuses.includes(o.outcome_status));
    if (!list.length) return <AdminEmpty title={emptyTitle} description="결과 데이터 없음 — 성공/실패로 분류하지 않음(insufficient_data)." />;
    return (
      <div className="space-y-1">
        {list.map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <AdminBadge tone={o.outcome_status === 'positive' ? 'success' : o.outcome_status === 'negative' ? 'danger' : 'warning'}>{o.outcome_status}</AdminBadge>
              <AdminBadge tone="neutral">causality: {o.causality_status}</AdminBadge>
              <AdminBadge tone="neutral">repeat: {o.repeatability_status}</AdminBadge>
            </div>
            {o.benefit_summary && <p className="mt-1">{o.benefit_summary}</p>}
            <p className="text-muted-foreground">positive ≠ 인과 확정 · 단일 성공 ≠ 재현 보장</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AdminCard
      title="Enterprise Decision Memory & Outcome Intelligence Center"
      subtitle="추천→사람 결정→실행 Reference→관찰→결과→사후 평가→Lesson — 승인≠성공·실행 Reference≠검증·상관≠인과(자동 실행/학습 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 의사결정/승인/거절, 자동 실행/Rollback, 자동 모델 학습/Weight/Prompt/Trust 변경, 자동 정책/계약/정산/가격/플레이리스트 변경, Production Apply/Merge/Deploy 는 없습니다. decided 는 실행 완료가 아니고 evaluated 는 인과 확정이 아닙니다. 외부 성공 보고는 내부 검증 완료가 아니며, 관찰 기간 종료 전 결과를 확정하지 않습니다(서버 차단). Decision Quality/Outcome Score 는 인사 평가 용도가 아닙니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Total Decisions" value={NUM(summary.decisions_total as number)} />
            <Box label="Pending Review" value={NUM(decisionsByStatus.pending_review ?? 0)} />
            <Box label="Waiting Evidence" value={NUM(decisionsByStatus.waiting_evidence ?? 0)} />
            <Box label="실행 Ref 없는 결정" value={NUM(summary.decisions_without_execution_ref as number)} />
            <Box label="관찰 없는 결정" value={NUM(summary.decisions_without_observation as number)} />
            <Box label="Observations" value={NUM(observations.length)} />
            <Box label="Positive" value={NUM(outcomesByStatus.positive ?? 0)} />
            <Box label="Mixed" value={NUM(outcomesByStatus.mixed ?? 0)} />
            <Box label="Negative" value={NUM(outcomesByStatus.negative ?? 0)} />
            <Box label="Inconclusive" value={NUM(outcomesByStatus.inconclusive ?? 0)} />
            <Box label="채택률" value={adoptionRate == null ? 'insufficient_data' : `${adoptionRate}%`} />
            <Box label="결과 관측률" value={observationRate == null ? 'insufficient_data' : `${observationRate}%`} />
            <Box label="Confidence Calibration" value={calibration.verdict} />
            <Box label="자동 실행/학습" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 결정 소스 실측: ai_operations {NUM(sourceCounts.ai_operations)}(결정 {NUM(sourceCounts.ai_operations_decided)}) · executive {NUM(sourceCounts.ai_executive_decisions)} · policy rec {NUM(sourceCounts.ai_policy_recommendations)} · kg reviews {NUM(sourceCounts.ai_knowledge_reviews)} · reliability {NUM(sourceCounts.ai_reliability_decisions)} · post-change obs {NUM(sourceCounts.ai_post_change_observations)} · incidents {NUM(sourceCounts.ai_incidents)}</p>
        </div>
      )}

      {/* ── Decision Memory ── */}
      {tab === 'decisions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createDMRecord({
                code: `dm_manual_${now.toISOString().slice(0, 19)}`, domain: 'manual', type: 'manual',
                sourceSystem: 'manual_decision', decisionSummary: r,
                evidence: [{ label: 'manual_entry', value: r.slice(0, 200) }],
              }), 'Decision Memory 기록(pending_review — 실행 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Manual Decision 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 요약/사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!records.length ? <AdminEmpty title="Decision 없음" description="Manual Decision 기록 또는 원본 추천 연결로 시작하세요. 데이터 없음 ≠ 결정 없음 단정." /> : (
            <div className="space-y-1">
              {records.slice(0, 50).map((r) => {
                const facts = decisionStatusFacts(r.decision_status as DecisionStatus);
                return (
                  <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold">{r.decision_code}</span>
                      <AdminBadge tone={r.decision_status === 'evaluated' ? 'success' : facts.terminal ? 'neutral' : 'info'}>{r.decision_status}</AdminBadge>
                      <AdminBadge tone="neutral">{r.decision_domain}/{r.decision_type}</AdminBadge>
                      {r.self_approval_warning && <AdminBadge tone="warning">self-approval 경고</AdminBadge>}
                      <span className="text-muted-foreground">{r.source_system}</span>
                    </div>
                    <p className="mt-1">{r.decision_summary}</p>
                    <button onClick={() => { void loadDetail(r.id); setTab('timeline'); }} className="mt-1 font-bold underline">Timeline/Detail 보기</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Recommendations(연결된 추천) ── */}
      {tab === 'recommendations' && (
        !records.filter((r) => r.source_system !== 'manual_decision').length
          ? <AdminEmpty title="연결된 추천 없음" description="추천 Source 없는 결정은 manual_decision 으로 명시됩니다. ID 동일만으로 자동 연결하지 않습니다." />
          : (
            <div className="space-y-1">
              {records.filter((r) => r.source_system !== 'manual_decision').map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="info">{r.source_system}</AdminBadge>
                    {r.confidence_at_decision != null && <span className="text-muted-foreground">AI confidence {r.confidence_at_decision}</span>}
                    <AdminBadge tone="neutral">{r.decision_type}</AdminBadge>
                  </div>
                  <p className="mt-1">{r.recommendation_summary || r.decision_summary}</p>
                  <p className="text-muted-foreground">AI Confidence ≠ 실제 정확도(Calibration 탭 참조)</p>
                </div>
              ))}
            </div>
          )
      )}

      {/* ── Human Decisions ── */}
      {tab === 'humandecisions' && (
        <div className="space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          {!records.length ? <AdminEmpty title="Decision 없음" /> : records.filter((r) => !decisionStatusFacts(r.decision_status as DecisionStatus).terminal).slice(0, 30).map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.decision_code}</span>
                <AdminBadge tone="info">{r.decision_status}</AdminBadge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(['waiting_evidence', 'decided', 'observation_pending', 'outcome_review_pending', 'evaluated', 'invalidated', 'cancelled'] as const).map((t) => (
                  <button key={t} disabled={busy} onClick={() => {
                    const rr = needReason(); if (!rr) return;
                    void act(() => decideDMRecord(r.id, t, rr), `${t} 처리(사람 결정 — decided ≠ 실행)`);
                  }} className={`rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${t === 'decided' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Execution References ── */}
      {tab === 'execrefs' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부 실행 참고 기록만 — 시스템이 실행하지 않습니다. 외부 성공 보고는 내부 검증 완료가 아닙니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">Decision 선택</option>
              {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="실행 내용/사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !selectedId} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => addDMExecutionRef({ code: `dmexec_${now.toISOString().slice(0, 19)}`, decisionId: selectedId, actionType: 'manual_external_action', executionSystem: 'external', reportedResult: rr, evidence: [{ label: 'manual_report', value: rr.slice(0, 200) }] }), 'Execution Reference 기록(reference_recorded — 검증 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Reference 추가</button>
          </div>
          {!execRefs.length ? <AdminEmpty title="Execution Reference 없음" description="Reference 없으면 실제 실행됐다고 단정하지 않습니다(execution_unverified)." /> : execRefs.map((e) => {
            const v = classifyExecutionVerification(e.verification_status as ExecutionVerification);
            return (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{e.action_type}</span>
                  <AdminBadge tone={v.internallyVerified ? 'success' : 'warning'}>{e.verification_status}</AdminBadge>
                  <span className="text-muted-foreground">{e.execution_system}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{v.note}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['verification_pending', 'externally_reported_success', 'externally_reported_failure', 'internally_observed_effect', 'partially_verified', 'execution_unverified'] as const).map((t) => (
                    <button key={t} disabled={busy} onClick={() => {
                      const rr = needReason(); if (!rr) return;
                      void act(() => updateDMExecutionVerification(e.id, t, rr), `검증 상태 ${t}`);
                    }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{t}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Observation Windows ── */}
      {tab === 'observations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">Decision 선택</option>
              {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
            </select>
            <button disabled={busy || !selectedId} onClick={() => {
              void act(() => createDMObservation({
                decisionId: selectedId, observationType: 'post_decision_7d',
                startAt: now.toISOString(), endAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
                metricDefinitions: [{ metric: 'revenue', direction: 'no_regression' }, { metric: 'incident_count', direction: 'no_regression' }],
              }), 'Observation Window 생성(7d — 운영 설정 미변경)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">7일 관찰 계획</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="상태 변경 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!observations.length ? <AdminEmpty title="Observation 없음" description="관찰 기간이 끝나지 않으면 결과를 확정하지 않습니다." /> : observations.map((o) => {
            const closable = canCloseObservation(new Date(o.observation_end_at), now);
            return (
              <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{o.observation_type}</span>
                  <AdminBadge tone={o.observation_status === 'closed' ? 'success' : o.observation_status === 'invalidated' ? 'danger' : 'info'}>{o.observation_status}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(o.observation_start_at).toLocaleDateString('ko-KR')} ~ {new Date(o.observation_end_at).toLocaleDateString('ko-KR')}</span>
                  {o.data_coverage != null && <span className="text-muted-foreground">coverage {o.data_coverage}%</span>}
                </div>
                {!['closed', 'invalidated'].includes(o.observation_status) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(['observing', 'observation_incomplete', 'ready_for_review'] as const).map((t) => (
                      <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => updateDMObservation(o.id, t, rr), t); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{t}</button>
                    ))}
                    <button disabled={busy || !closable} title={closable ? '' : '관찰 기간 종료 전 closed 금지(서버 차단)'} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => updateDMObservation(o.id, 'closed', rr), 'closed'); }} className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50">closed{!closable && ' (기간 미종료)'}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Baselines ── */}
      {tab === 'baselines' && (
        !observations.length ? <AdminEmpty title="Baseline 없음" description="baseline 없으면 개선률을 계산하지 않습니다(baseline_unavailable — 0 대체 금지)." /> : (
          <div className="space-y-1">
            {observations.map((o) => {
              const metrics = (o.metric_definitions ?? []).map((m) => String((m as Record<string, unknown>).metric ?? ''));
              const avail = classifyBaselineAvailability({ values: (o.baseline_values ?? null) as Record<string, number | null> | null, expectedMetrics: metrics, comparable: true });
              return (
                <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{o.observation_type}</span>
                    <AdminBadge tone={avail === 'baseline_available' ? 'success' : avail === 'baseline_partial' ? 'warning' : 'neutral'}>{avail}</AdminBadge>
                  </div>
                  <p className="mt-1 text-muted-foreground">metrics: {metrics.join(', ') || '—'} · 서로 다른 조건의 데이터를 동일 baseline 으로 강제 비교하지 않음</p>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Expected Outcomes ── */}
      {tab === 'expected' && (
        !records.filter((r) => r.expected_outcome).length ? <AdminEmpty title="Expected Outcome 없음" description="예상값 없으면 expected_outcome_unavailable — 예상 대비 오차를 계산하지 않습니다." /> : (
          <div className="space-y-1">
            {records.filter((r) => r.expected_outcome).map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.decision_code}</span>
                <p className="mt-1 break-all text-muted-foreground">{JSON.stringify(r.expected_outcome).slice(0, 300)}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Actual Outcomes ── */}
      {tab === 'actual' && (
        !observations.filter((o) => o.actual_values).length ? <AdminEmpty title="Actual 값 없음" description="Actual 없으면 계산하지 않습니다(0 대체 금지)." /> : (
          <div className="space-y-1">
            {observations.filter((o) => o.actual_values).map((o) => {
              const base = (o.baseline_values ?? {}) as Record<string, number | null>;
              const act2 = (o.actual_values ?? {}) as Record<string, number | null>;
              return Object.keys(act2).slice(0, 10).map((m) => {
                const r = calculateActualOutcome({ metric: m, baseline: base[m] ?? null, actual: act2[m] ?? null });
                return (
                  <div key={o.id + m} className="rounded-lg border border-border p-2 text-[11px]">
                    <span className="font-mono font-bold">{m}</span>
                    <span className="ml-2">{r.status === 'computed' ? `${NUM(r.baseline)} → ${NUM(r.actual)} (Δ ${NUM(r.absoluteChange)}${r.percentageChange != null ? ` / ${r.percentageChange}%` : ' / baseline 0 — % 미계산'})` : r.status}</span>
                  </div>
                );
              });
            })}
          </div>
        )
      )}

      {/* ── Expected vs Actual ── */}
      {tab === 'expvsact' && (
        <div className="space-y-2">
          {(() => {
            const demo = observations.filter((o) => o.actual_values && o.expected_values);
            if (!demo.length) return <AdminEmpty title="판정 대상 없음" description="expected/actual 둘 다 있어야 판정합니다. 관찰 미종료 → outcome_pending, baseline 없음 → baseline_unavailable, 임의 threshold 없음." />;
            return demo.map((o) => {
              const exp = (o.expected_values ?? {}) as Record<string, { direction?: string; target?: number | null }>;
              const base = (o.baseline_values ?? {}) as Record<string, number | null>;
              const act2 = (o.actual_values ?? {}) as Record<string, number | null>;
              const verdicts = Object.keys(exp).map((m) => evaluateExpectedVsActual({
                direction: (exp[m]?.direction ?? 'unknown') as 'increase' | 'decrease' | 'maintain' | 'no_regression' | 'range' | 'unknown',
                target: exp[m]?.target ?? null, acceptableRange: null,
                baseline: base[m] ?? null, actual: act2[m] ?? null,
                observationClosed: o.observation_status === 'closed',
              }));
              const agg = classifyOutcomeStatus(verdicts);
              return (
                <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{o.observation_type}</span>
                    <AdminBadge tone={agg.status === 'positive' ? 'success' : agg.status === 'negative' ? 'danger' : 'info'}>{agg.status}</AdminBadge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{Object.keys(exp).map((m, i) => `${m}: ${verdicts[i]}`).join(' · ')}</p>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ── Outcome Evaluation ── */}
      {tab === 'evaluation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">Decision 선택</option>
              {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Outcome 근거(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !selectedId} onClick={() => {
              const rr = needReason(); if (!rr) return;
              const closedObs = observations.find((o) => o.decision_memory_id === selectedId && o.observation_status === 'closed');
              void act(() => recordDMOutcome({
                code: `dmout_${selectedId.slice(0, 8)}_${now.toISOString().slice(0, 10)}`, decisionId: selectedId,
                outcomeStatus: closedObs ? 'inconclusive' : 'pending', observationId: closedObs?.id ?? null,
                evidence: [{ label: 'manual_review', value: rr.slice(0, 200) }],
                causality: 'not_evaluated', repeatability: closedObs ? 'single_observation' : 'not_evaluated',
              }), 'Outcome 기록(인과 미확정)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Outcome Review 시작</button>
          </div>
          {!outcomes.length ? <AdminEmpty title="Outcome 없음" description="관찰 종료(closed) 없이 positive/negative 확정은 서버가 차단합니다." /> : outcomes.map((o) => (
            <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={o.outcome_status === 'positive' ? 'success' : o.outcome_status === 'negative' ? 'danger' : 'info'}>{o.outcome_status}</AdminBadge>
                <AdminBadge tone="neutral">review: {o.outcome_review_status}</AdminBadge>
                <AdminBadge tone="neutral">lesson: {o.lesson_status}</AdminBadge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(['waiting_observation', 'waiting_evidence', 'reviewed', 'accepted_reference', 'rejected'] as const).map((t) => (
                  <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewDMOutcome(o.id, t, rr), t); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{t}</button>
                ))}
                <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewDMOutcome(o.id, 'reviewed', rr, 'validated_reference'), 'Lesson validated_reference'); }} className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50">Lesson 검토 Reference</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Decision Quality ── */}
      {tab === 'quality' && (
        !records.length ? <AdminEmpty title="Decision 없음" /> : (
          <div className="space-y-1">
            {records.slice(0, 30).map((r) => {
              const q = calculateDecisionQuality({
                evidenceCount: r.evidence?.length ?? null,
                alternativesConsidered: r.alternatives?.length ? true : false,
                riskDisclosed: r.risk_at_decision != null,
                preconditionsRecorded: r.preconditions?.length ? true : false,
                limitationsDisclosed: r.limitations?.length ? true : false,
                humanReviewed: r.decision_at != null,
                segregationOfDuties: r.self_approval_warning ? false : null,
                baselineAvailable: observations.some((o) => o.decision_memory_id === r.id && o.baseline_values != null) ? true : null,
                outcomeMeasurable: r.expected_outcome != null,
                auditRecorded: true,
              });
              return (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{r.decision_code}</span>
                    <AdminBadge tone={q.quality === 'well_supported' ? 'success' : q.quality === 'unsupported' ? 'danger' : 'info'}>{q.quality}</AdminBadge>
                    {q.score != null && <span className="text-muted-foreground">{q.score}</span>}
                  </div>
                  <p className="mt-1 text-muted-foreground">절차·근거 품질만(결과와 독립) — 인사 평가 용도 아님{q.missing.length ? ` · 누락 성분 제외: ${q.missing.join(', ')}` : ''}</p>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Recommendation Accuracy ── */}
      {tab === 'accuracy' && (
        !accuracySamples.length ? <AdminEmpty title="추천 없음" /> : (
          <div className="space-y-1">
            {accuracySamples.slice(0, 30).map((s) => (
              <div key={s.record.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{s.record.decision_code}</span>
                  <AdminBadge tone={s.verdict === 'direction_correct' ? 'success' : s.verdict === 'direction_incorrect' ? 'danger' : 'neutral'}>{s.verdict}</AdminBadge>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">미승인/미실행 추천은 not_executed — 실패로 계산하지 않음. Accuracy 는 모델 성능 전체가 아님(인과 미확인 포함).</p>
          </div>
        )
      )}

      {/* ── Confidence Calibration ── */}
      {tab === 'calibration' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="판정" value={calibration.verdict} />
            <Box label="평가 표본" value={NUM(calibration.sampleSize)} />
            <Box label="평균 Confidence" value={calibration.avgConfidence == null ? '—' : String(calibration.avgConfidence)} />
            <Box label="실제 성공률(관측)" value={calibration.successRate == null ? '—' : `${calibration.successRate}%`} />
          </div>
          <AdminAlert tone="info" description="표본 5건 미만 → sample_too_small(일반화 금지). AI Confidence 와 실제 정확도를 동일하게 보지 않으며, 인과 미확인 데이터를 모델 정확도로 단정하지 않습니다. over/underconfident 는 candidate 표기입니다." />
        </div>
      )}

      {/* ── Decision Patterns ── */}
      {tab === 'patterns' && (
        !patterns.length ? <AdminEmpty title="패턴 없음" description="기록이 쌓이면 경향이 표시됩니다 — 원인 단정 없음." /> : (
          <div className="space-y-1">
            {patterns.map((p) => (
              <div key={p.pattern} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2"><AdminBadge tone="info">{p.count}건</AdminBadge><span className="font-bold">{p.pattern}</span></div>
                <p className="mt-1 text-muted-foreground">{p.note}</p>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'positive' && outcomeList(['positive'], 'Positive Outcome 없음')}
      {tab === 'negative' && outcomeList(['negative'], 'Negative Outcome 없음')}
      {tab === 'inconclusive' && outcomeList(['inconclusive', 'mixed', 'neutral', 'pending', 'observation_incomplete', 'insufficient_data'], 'Inconclusive Outcome 없음')}

      {/* ── Lessons Learned ── */}
      {tab === 'lessons' && (
        <div className="space-y-2">
          {(() => {
            const evaluated = outcomes.filter((o) => ['positive', 'mixed', 'neutral', 'negative', 'inconclusive'].includes(o.outcome_status));
            if (!evaluated.length) return <AdminEmpty title="Lesson 대상 없음" description="결과 미확정이면 Lesson 을 확정하지 않습니다. 과거 결정 없으면 best practice 를 임의 생성하지 않습니다." />;
            return evaluated.map((o) => {
              const rec = records.find((r) => r.id === o.decision_memory_id);
              const draft = buildLessonsLearned({
                context: rec?.decision_domain ?? '', decisionSummary: rec?.decision_summary ?? '',
                expected: JSON.stringify(rec?.expected_outcome ?? 'expected_outcome_unavailable').slice(0, 100),
                actual: o.outcome_status, outcomeStatus: o.outcome_status as OutcomeStatus,
                repeatability: o.repeatability_status as RepeatabilityStatus,
                priorSimilarCount: records.filter((r) => r.decision_domain === rec?.decision_domain).length - 1,
              });
              if ('insufficient' in draft) return null;
              return (
                <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{rec?.decision_code}</span>
                    <AdminBadge tone="neutral">lesson: {o.lesson_status}</AdminBadge>
                    <AdminBadge tone="warning">사람 검토 필수</AdminBadge>
                  </div>
                  {draft.whatWorked.length > 0 && <p className="mt-1">What Worked: {draft.whatWorked.join(' · ')}</p>}
                  {draft.whatDidNotWork.length > 0 && <p>What Did Not Work: {draft.whatDidNotWork.join(' · ')}</p>}
                  <p className="text-muted-foreground">Unknown: {draft.unknownFactors.join(' · ')} · Reusable: {draft.reusableInsight ?? '없음(보장 불가)'} · 자동 best practice 확정 없음</p>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ── Institutional Memory ── */}
      {tab === 'memory' && (
        <div className="space-y-2">
          <select value={memDomain} onChange={(e) => setMemDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            <option value="">전체 Domain</option>
            {DECISION_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {!filteredMemory.length ? <AdminEmpty title="기록 없음" description="구조화 필드 기반 검색 — Vector/Embedding 미도입(정직 표기)." /> : (
            <div className="space-y-1">
              {filteredMemory.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{r.decision_code}</span>
                    <AdminBadge tone="neutral">{r.decision_domain}</AdminBadge>
                    <AdminBadge tone="info">{r.decision_status}</AdminBadge>
                    <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <p className="mt-1">{r.decision_summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Similar Decisions ── */}
      {tab === 'similar' && (
        <div className="space-y-2">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            <option value="">기준 Decision 선택</option>
            {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
          </select>
          {!similar.length ? <AdminEmpty title="유사 결정 없음" description="과거 결정이 없으면 best practice 를 임의 생성하지 않습니다." /> : similar.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.id}</span>
                <AdminBadge tone={s.verdict === 'highly_relevant' ? 'success' : s.verdict === 'not_comparable' ? 'neutral' : 'info'}>{s.verdict}</AdminBadge>
                {s.priorOutcome && <AdminBadge tone="neutral">prior: {s.priorOutcome}</AdminBadge>}
              </div>
              <p className="mt-1 text-muted-foreground">공유: {s.sharedContext.join(', ') || '—'} · <span className="font-bold">차이: {s.differentContext.join(', ') || '—'}</span></p>
              <p className="text-muted-foreground">{s.applicabilityNote}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Decision Timeline ── */}
      {tab === 'timeline' && (
        <div className="space-y-2">
          <select value={selectedId} onChange={(e) => void loadDetail(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            <option value="">Decision 선택</option>
            {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
          </select>
          {!detail ? <AdminEmpty title="Decision 을 선택하세요" /> : (
            <div className="space-y-1 text-[11px]">
              <div className="rounded-lg border border-border p-2">
                <p className="font-bold">{detail.decision.decision_code} — {detail.decision.decision_summary}</p>
                <p className="text-muted-foreground">refs {detail.execution_references.length} · windows {detail.observation_windows.length} · outcomes {detail.outcomes.length}</p>
              </div>
              {buildDecisionTimeline(detail.timeline.map((t) => ({ eventType: t.event_type, detail: t.detail, actorId: t.actor_id, createdAt: t.created_at }))).map((t, i) => (
                <div key={i} className="border-l-2 border-border pl-2">
                  <p><span className="font-mono font-bold">{t.eventType}</span> <span className="text-muted-foreground">{new Date(t.createdAt).toLocaleString('ko-KR')}</span></p>
                  {t.detail && <p className="text-muted-foreground">{t.detail}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── External Outcome References ── */}
      {tab === 'external' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부 시스템에서 결과를 확인한 경우의 참고 기록만 — 결과 수집 시스템을 직접 변경하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">Decision 선택</option>
              {records.map((r) => <option key={r.id} value={r.id}>{r.decision_code}</option>)}
            </select>
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXT_OUTCOME_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="확인 내용(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !selectedId} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => recordDMExternalOutcome(selectedId, extAction, rr, [{ label: 'manual_report', value: rr.slice(0, 200) }]), '참고 기록 저장(reference only)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">참고 기록</button>
          </div>
          {audit.filter((e) => e.event_type === 'external_outcome_reference').length === 0 ? <AdminEmpty title="참고 기록 없음" /> : audit.filter((e) => e.event_type === 'external_outcome_reference').map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
              <p className="mt-1">{e.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{e.event_type}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {e.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-1">
          {DM_SUPPORT.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'info'}>{s.status}</AdminBadge>
              <span className="font-bold">{s.label}</span>
              <span className="text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
