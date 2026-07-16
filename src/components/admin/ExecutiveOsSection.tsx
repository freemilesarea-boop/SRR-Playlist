/**
 * ExecutiveOsSection — Enterprise Executive AI Operating System, Unified Intelligence &
 * Autonomous Advisory Center (Phase AI-OPS-30 — 최종 통합 레이어).
 *
 * Enterprise→Unified Intelligence→Executive Operating System→Cross-Domain Reasoning→Executive Advisory→Human Decision.
 * AI-OPS-1~29 데이터를 읽기 전용 통합 조회 — 기존 모듈 대체 없음 ·
 * Executive View ≠ Executive Decision · Enterprise Health ≠ Business Success ·
 * Cross-domain Correlation ≠ Causation · Recommendation ≠ Approval.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, ClipboardList, GitBranch, Grid3x3, HeartPulse, History, Layers,
  Lightbulb, Lock, Radar, RefreshCw, Scale, ScrollText,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecutiveOsSummary, recordExecutiveOsGovernance, fetchExecutiveOsAudit,
  type ExecutiveOsSummary, type ExecutiveOsEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildUnifiedIntelligence, evaluateEnterpriseHealth, correlateCrossDomain,
  buildUnifiedTimeline, buildExecutiveGraph, buildOperatingScorecard,
  buildUnifiedBriefing, buildExecutiveAdvisory, buildExecutiveCockpitOS,
  ENTERPRISE_DOMAINS, EXECUTIVE_OS_SUPPORT,
} from '@/lib/executiveOS';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'cockpit' | 'situationroom' | 'unified' | 'health' | 'crossdomain' | 'timeline' | 'graph'
  | 'scorecard' | 'advisory' | 'briefing' | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Executive AI Operating Cockpit', icon: Layers },
  { key: 'situationroom', label: 'Executive Situation Room', icon: Radar },
  { key: 'unified', label: 'Unified Enterprise Intelligence', icon: Boxes },
  { key: 'health', label: 'Enterprise Health', icon: HeartPulse },
  { key: 'crossdomain', label: 'Cross-Domain Intelligence', icon: GitBranch },
  { key: 'timeline', label: 'Unified Executive Timeline', icon: History },
  { key: 'graph', label: 'Executive Intelligence Graph', icon: GitBranch },
  { key: 'scorecard', label: 'Operating Scorecard', icon: ClipboardList },
  { key: 'advisory', label: 'Executive Advisory Hub', icon: Lightbulb },
  { key: 'briefing', label: 'Unified Executive Briefing', icon: ScrollText },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const DOMAIN_PRIMARY: Record<string, { key: string; note: string }> = {
  strategy: { key: 'objectives_0524', note: 'Corporate Objectives(0524)' },
  execution: { key: 'commitments_0520', note: 'Execution Commitments(0520)' },
  performance: { key: 'kpi_definitions_0525', note: 'KPI Definitions(0525)' },
  finance: { key: 'financial_records_0526', note: 'Financial Records(0526)' },
  market: { key: 'signals_0527', note: 'Market Signals(0527)' },
  risk: { key: 'risks_0528', note: 'Risk Register(0528)' },
  resources: { key: 'resources_0529', note: 'Resource Registry(0529)' },
  ecosystem: { key: 'dependencies_0508', note: 'Dependencies(0508/0530)' },
  knowledge: { key: 'org_memory_0531', note: 'Organizational Memory(0531)' },
  learning: { key: 'learning_registry_0532', note: 'Learning Registry(0532)' },
};

export default function ExecutiveOsSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<ExecutiveOsSummary>({});
  const [audit, setAudit] = useState<ExecutiveOsEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, au] = await Promise.all([fetchExecutiveOsSummary(), fetchExecutiveOsAudit(150)]);
      setSummary(s); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  const core = useMemo(() => (typeof summary.core_actuals === 'object' && summary.core_actuals !== null && !Array.isArray(summary.core_actuals) ? summary.core_actuals as Record<string, unknown> : {}), [summary]);
  const domainActuals = useMemo(() => (typeof summary.domain_actuals === 'object' && summary.domain_actuals !== null && !Array.isArray(summary.domain_actuals) ? summary.domain_actuals as Record<string, Record<string, unknown>> : {}), [summary]);
  const cnum = useCallback((k: string): number | null => (typeof core[k] === 'number' ? core[k] as number : null), [core]);
  const dnum = useCallback((domain: string, k: string): number | null => {
    const d = domainActuals[domain];
    return d && typeof d[k] === 'number' ? d[k] as number : null;
  }, [domainActuals]);

  const domainCounts = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const d of ENTERPRISE_DOMAINS) out[d] = dnum(d, DOMAIN_PRIMARY[d].key);
    return out;
  }, [dnum]);

  const unified = useMemo(() => buildUnifiedIntelligence(ENTERPRISE_DOMAINS.map((d) => ({
    domain: d, itemCount: domainCounts[d], note: DOMAIN_PRIMARY[d].note,
  }))), [domainCounts]);

  const health = useMemo(() => evaluateEnterpriseHealth(ENTERPRISE_DOMAINS.map((d) => {
    const count = domainCounts[d];
    let signal: number | null = count != null ? 60 : null;
    if (d === 'risk') {
      const open = dnum('risk', 'risks_open_0528'); const incidents = dnum('risk', 'incidents_open_0502');
      signal = open == null && incidents == null ? null : ((open ?? 0) + (incidents ?? 0) > 0 ? 40 : 60);
    }
    return { domain: d, signal, evidence: count != null ? [`${DOMAIN_PRIMARY[d].note} 실측`] : [] };
  })), [domainCounts, dnum]);

  const crossDomain = useMemo(() => correlateCrossDomain([
    { label: 'Strategy ↔ Execution', strategySignal: null, kpiSignal: null, sample: 0 },   // 도메인 간 시계열 원본 없음
    { label: 'Execution ↔ Performance', strategySignal: null, kpiSignal: null, sample: 0 },
    { label: 'Finance ↔ Market', strategySignal: null, kpiSignal: null, sample: 0 },
  ]), []);

  const timeline = useMemo(() => buildUnifiedTimeline([
    { stage: 'decision', count: null, source: 'decision 시계열 요약 미포함 — 0514 모듈 참조' },
    { stage: 'commitment', count: dnum('execution', 'commitments_0520'), source: '0520 실측' },
    { stage: 'execution', count: cnum('play_starts_30d'), source: 'playback 30d 실측' },
    { stage: 'outcome', count: dnum('execution', 'outcomes_0514'), source: '0514 실측' },
    { stage: 'learning', count: dnum('learning', 'org_learnings_0515'), source: '0515 실측' },
    { stage: 'improvement', count: dnum('learning', 'learning_registry_0532'), source: '0532 실측' },
    { stage: 'current_status', count: unified.measuredDomains, source: '실측 도메인 수' },
  ]), [dnum, cnum, unified]);

  const graph = useMemo(() => {
    const stagesData: { stage: string; count: number | null }[] = [
      { stage: 'vision', count: dnum('strategy', 'visions_0524') },
      { stage: 'strategy', count: dnum('strategy', 'objectives_0524') },
      { stage: 'decision', count: null },
      { stage: 'commitment', count: dnum('execution', 'commitments_0520') },
      { stage: 'execution', count: cnum('play_starts_30d') },
      { stage: 'outcome', count: dnum('execution', 'outcomes_0514') },
      { stage: 'knowledge', count: dnum('knowledge', 'org_memory_0531') },
      { stage: 'learning', count: dnum('learning', 'org_learnings_0515') },
      { stage: 'improvement', count: dnum('learning', 'learning_registry_0532') },
    ];
    const nodes: { id: string; stage: string; label: string; parentId: string | null }[] = [];
    let prev: string | null = null;
    for (const s of stagesData) {
      if (s.count != null && s.count > 0) {
        nodes.push({ id: s.stage, stage: s.stage, label: `${s.stage}(${s.count})`, parentId: prev });
        prev = s.stage;
      }
    }
    return buildExecutiveGraph(nodes);
  }, [dnum, cnum]);

  const scorecard = useMemo(() => buildOperatingScorecard([
    { indicator: 'strategic_progress', value: dnum('strategy', 'objectives_0524'), evidence: dnum('strategy', 'objectives_0524') != null ? ['0524 objectives 실측'] : [], missingAreas: ['목표 달성률 원본 없음'], unknownFactors: ['외부 요인'] },
    { indicator: 'execution_readiness', value: dnum('execution', 'commitments_0520'), evidence: dnum('execution', 'commitments_0520') != null ? ['0520 commitments 실측'] : [], missingAreas: ['인력/시간 원본 없음'], unknownFactors: [] },
    { indicator: 'financial_stability', value: cnum('mrr'), evidence: cnum('mrr') != null ? ['subscriptions MRR 실측'] : [], missingAreas: ['회계 원장/Cash Position 없음'], unknownFactors: ['외부 시장'] },
    { indicator: 'resource_readiness', value: dnum('resources', 'capacity_snapshots_0508'), evidence: dnum('resources', 'capacity_snapshots_0508') != null ? ['0508 capacity 실측'] : [], missingAreas: ['APM 원본 없음'], unknownFactors: [] },
    { indicator: 'organizational_learning', value: dnum('learning', 'learning_registry_0532'), evidence: dnum('learning', 'learning_registry_0532') != null ? ['0532 registry 실측'] : [], missingAreas: ['교육 기록 없음'], unknownFactors: [] },
    { indicator: 'enterprise_resilience', value: dnum('risk', 'incidents_open_0502'), evidence: dnum('risk', 'incidents_open_0502') != null ? ['0502 incidents 실측'] : [], missingAreas: ['DR 훈련 로그 없음'], unknownFactors: ['외부 리스크'] },
  ]), [dnum, cnum]);

  const advisories = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildExecutiveAdvisory>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const openRisks = dnum('risk', 'risks_open_0528');
    if (openRisks != null && openRisks > 0) push(buildExecutiveAdvisory({ type: 'review_strategic_priority', reason: `open Risk ${openRisks}건 — 우선순위 재검토 후보(결정 아님)`, evidence: ['0528 실측'], confidence: null, assumptions: [] }));
    if (crossDomain.pairs.every((p) => p.verdict === 'insufficient_data')) push(buildExecutiveAdvisory({ type: 'validate_cross_domain_impact', reason: '도메인 간 시계열 원본 부족 — 상관 검증 불가(인과 아님)', evidence: ['cross_domain'], confidence: null, assumptions: [] }));
    if (dnum('finance', 'financial_records_0526') === 0 || dnum('finance', 'financial_records_0526') == null) push(buildExecutiveAdvisory({ type: 'review_financial_exposure', reason: '재무 기록 부족 — Exposure 검토 근거 확보 필요', evidence: ['0526 실측'], confidence: null, assumptions: [] }));
    const incidents = dnum('risk', 'incidents_open_0502');
    if (incidents != null && incidents > 0) push(buildExecutiveAdvisory({ type: 'review_operational_readiness', reason: `open Incident ${incidents}건(0502) — 운영 준비 검토`, evidence: ['0502 실측'], confidence: null, assumptions: [] }));
    if (health.rows.some((r) => r.verdict === 'executive_unverified' || r.verdict === 'unknown')) push(buildExecutiveAdvisory({ type: 'gather_additional_evidence', reason: 'unknown/unverified 도메인 존재 — 근거 확보 전 해석 금지', evidence: ['health rows'], confidence: null, assumptions: [] }));
    if ((dnum('learning', 'learning_registry_0532') ?? 0) === 0) push(buildExecutiveAdvisory({ type: 'review_organizational_learning', reason: 'Learning Registry 비어 있음 — 조직 학습 기록 검토', evidence: ['0532 실측'], confidence: null, assumptions: [] }));
    return out;
  }, [dnum, crossDomain, health]);

  const briefing = useMemo(() => buildUnifiedBriefing({
    periodKind: 'weekly',
    keyChanges: [`실측 도메인 ${unified.measuredDomains}/10`],
    keyResults: cnum('mrr') != null ? [`MRR ${NUM(cnum('mrr'))}(실측 — Revenue ≠ Profit)`] : [],
    keyRisks: health.rows.filter((r) => r.verdict === 'watch_candidate').map((r) => `${r.domain}: watch(성공/실패 단정 아님)`),
    keyOpportunities: [],
    unknownFactors: health.rows.filter((r) => r.verdict === 'unknown' || r.verdict === 'executive_unverified').map((r) => `${r.domain}: 근거/신호 부족`),
    recommendations: advisories.slice(0, 5).map((a) => a.type),
  }), [unified, cnum, health, advisories]);

  const cockpit = useMemo(() => buildExecutiveCockpitOS({
    domainCounts,
    healthUnknowns: health.rows.filter((r) => r.verdict === 'unknown' || r.verdict === 'executive_unverified').length,
    advisoriesOpen: advisories.length,
    summaryNote: null,
  }), [domainCounts, health, advisories]);

  if (loading) return <AdminCard title="Enterprise Executive AI Operating System"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Executive AI Operating System">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Executive AI Operating System"
      subtitle="Unified Intelligence→Executive OS→Cross-Domain Reasoning→Executive Advisory→Human Decision — AI-OPS-1~29 읽기 전용 통합(모듈 대체 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Executive Decision, 자동 Strategy/KPI/Budget/Policy/계약/Production 변경, 자동 Merge/Deploy 는 없습니다. 이 레이어는 기존 모듈을 대체하지 않는 통합 관제/의사결정 지원 계층이며, 전략·예산·정책·운영 변경은 항상 사람이 승인합니다. Executive View ≠ Executive Decision, Enterprise Health ≠ Business Success, Cross-domain Correlation ≠ Causation, Recommendation ≠ Approval, Confidence ≠ Correctness, Unified Intelligence ≠ Complete Knowledge." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Executive AI Operating Cockpit(12영역) ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · executiveDecisionMade=false</p>
        </div>
      )}

      {/* ── Situation Room ── */}
      {tab === 'situationroom' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="MRR 실측" value={NUM(cnum('mrr'))} />
            <Box label="Members" value={NUM(cnum('members_total'))} />
            <Box label="Play Starts(30d)" value={NUM(cnum('play_starts_30d'))} />
            <Box label="Player Errors(30d)" value={NUM(cnum('player_errors_30d'))} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {ENTERPRISE_DOMAINS.map((d) => (
              <Box key={d} label={`${d} status`} value={domainCounts[d] == null ? 'insufficient_data' : NUM(domainCounts[d])} />
            ))}
          </div>
          <AdminAlert tone="info" description={`executive_unavailable: ${Array.isArray(summary.executive_unavailable) ? (summary.executive_unavailable as unknown[]).map(String).join(', ') : '—'} — 외부 ERP/BI/이사회 시스템/실시간 스트림 원본 없음. Situation Room 은 조회 시점 실측 기준이며 실시간 스트림이 아닙니다.`} />
        </div>
      )}

      {/* ── Unified / Health / Cross-Domain ── */}
      {tab === 'unified' && (
        <div className="space-y-1">
          {unified.rows.map((r) => (
            <div key={r.domain} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.domain}</span>
              <AdminBadge tone={r.status === 'measured' ? 'info' : 'warning'}>{r.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{r.itemCount == null ? 'null(0 아님)' : NUM(r.itemCount)} · {r.note} · 읽기 전용</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">실측 도메인 {unified.measuredDomains}/10 · unifiedIsNotCompleteKnowledge=true — 통합 View 가 완전한 지식을 의미하지 않습니다.</p>
        </div>
      )}
      {tab === 'health' && (
        <div className="space-y-1">
          {health.rows.map((r) => (
            <div key={r.domain} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.domain}</span>
              <AdminBadge tone={r.verdict === 'healthy_candidate' ? 'success' : r.verdict === 'watch_candidate' ? 'warning' : 'neutral'}>{r.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">독립 평가 · Enterprise Health ≠ Business Success</span>
            </div>
          ))}
          <AdminAlert tone="info" description="각 영역은 독립적으로 평가하며 전체 점수를 하나로 단순 합산하지 않습니다(noAggregateScore=true). Risk 도메인은 open Risk/Incident 실측 기반 watch 판정만 수행합니다." />
        </div>
      )}
      {tab === 'crossdomain' && (
        <div className="space-y-1">
          {crossDomain.pairs.map((p) => (
            <div key={p.label} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{p.label}</span>
              <AdminBadge tone={p.verdict === 'correlation_candidate' ? 'info' : 'warning'}>{p.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Correlation ≠ Causation(인과 주장 없음)</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Strategy→Execution→Performance→Finance→Market→Risk→Resources→Knowledge→Learning 체인 — 도메인 간 시계열 원본이 없어 insufficient_data 로 정직 유지됩니다.</p>
        </div>
      )}

      {/* ── Timeline / Graph / Scorecard ── */}
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'measured' ? 'info' : 'warning'}>{s.stage}</AdminBadge>
              <span className="ml-2">{s.count == null ? 'null(원본 없음)' : NUM(s.count)}</span>
              <span className="ml-2 text-muted-foreground">{s.source} · timelineIsNotCompletionClaim</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Decision→Commitment→Execution→Outcome→Learning→Improvement→Current Status 7단계 실측 집계</p>
        </div>
      )}
      {tab === 'graph' && (
        <div className="space-y-2">
          {graph.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.nodes.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '실측 없음'}</span>
            </div>
          ))}
          {graph.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결 ${graph.orphans.length}건`} description="상위 단계 실측이 없어 연결되지 않은 단계 — 사람 검토 필요" />}
          {graph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지(인과 주장 없음)" description={graph.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Vision→Strategy→Decision→Commitment→Execution→Outcome→Knowledge→Learning→Improvement 9단계 · causalityClaimed=false</p>
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-1">
          {scorecard.rows.map((r) => (
            <div key={r.indicator} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.indicator}</span>
              <AdminBadge tone={r.verdict === 'referenced' ? 'info' : 'warning'}>{r.verdict}</AdminBadge>
              <span className="ml-2">{r.value == null ? 'null(근거 없음)' : NUM(typeof r.value === 'number' ? r.value : null) === '—' ? String(r.value) : NUM(typeof r.value === 'number' ? r.value : null)}</span>
              <p className="mt-1 text-[10px] text-muted-foreground">Evidence: {r.evidence.join(', ') || '없음'} · Missing: {r.missingAreas.join(', ') || '없음'} · Unknown: {r.unknownFactors.join(', ') || '없음'}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">참고 지표 — scorecardIsNotSuccess=true · Evidence/Missing/Unknown 동반 제공(단독 점수 반환 없음)</p>
        </div>
      )}

      {/* ── Advisory / Briefing ── */}
      {tab === 'advisory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !advisories.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordExecutiveOsGovernance('executive_advisory_created', r, { advisories: advisories.map((a) => a.type) }), 'Advisory 기록(Recommendation ≠ Approval)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Advisory 검토 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!advisories.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다 — 도메인을 넘는 권고만 생성합니다." /> : (
            <div className="space-y-1">
              {advisories.map((a, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="info">{a.type}</AdminBadge>
                  <span className="ml-2">{a.reason}</span>
                  <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Approval · Confidence ≠ Correctness</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordExecutiveOsGovernance('unified_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Executive Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음) · executiveViewIsNotDecision=true</p>
        </div>
      )}

      {/* ── Reviews / External / Audit / Support ── */}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['unified_view_reviewed', 'executive_review_noted', 'operating_scorecard_evaluated', 'enterprise_health_evaluated'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Executive 판단/검토는 전부 사람이 수행합니다(자동 결정 없음)." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_executive_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 경영 자료는 참조로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordExecutiveOsGovernance('enterprise_health_evaluated', r, { rows: health.rows }), 'Health 평가 기록(단일 합산 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Health 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="Executive OS 검토/기록이 이벤트로 남습니다(12종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {EXECUTIVE_OS_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
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
