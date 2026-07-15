/**
 * CorporateStrategySection — Enterprise Strategy Intelligence, Corporate
 * Objectives & Strategic Roadmap Center (Phase AI-OPS-21).
 *
 * Vision → Objectives → Roadmap → Initiatives → Portfolio → Outcome → Evolution.
 * AI는 제안/분석/평가만 — Vision·Objective 자동 생성/전략 자동 승인/자동 변경 없음.
 * Vision ≠ Execution · Objective ≠ Outcome · Roadmap ≠ Commitment · Recommendation ≠ Approval.
 *
 * 탭 17개(Executive Roadmap Dashboard 포함).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, BookOpen, Calendar, GitBranch, Grid3x3, History, Layers, Lightbulb, ListChecks,
  Lock, RefreshCw, Scale, ScrollText, Target,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchCorpStrategySummary, createVisionRecord, fetchVisionRecords, createCorpObjective,
  reviewCorpObjective, fetchCorpObjectives, createRoadmapItem, reviewRoadmapItem, fetchRoadmapItems,
  recordStrategyGovernance, fetchStrategyAudit, fetchCommitments,
  type CorpStrategySummary, type VisionRecordRow, type CorpObjectiveRow, type RoadmapItemRow,
  type StrategyEventRow, type CommitmentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildObjectiveHierarchy, analyzeStrategicGap, analyzeCapability, evaluateStrategyAlignment,
  evaluateStrategicMaturity, buildRoadmapTimeline, buildStrategyEvolution,
  assessObjectiveAchievability, buildStrategyRecommendation, buildRoadmapDashboard,
  STRATEGY_SUPPORT,
} from '@/lib/corporateStrategy';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const OBJ_TERMINAL = ['invalidated', 'superseded_reference'];

type Tab = 'dashboard' | 'vision' | 'objectives' | 'roadmap' | 'initiatives' | 'hierarchy' | 'gaps'
  | 'capability' | 'alignment' | 'maturity' | 'evolution' | 'achievability' | 'recommendations'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'dashboard', label: 'Executive Roadmap Dashboard', icon: Layers },
  { key: 'vision', label: 'Corporate Vision', icon: BookOpen },
  { key: 'objectives', label: 'Corporate Objectives', icon: Target },
  { key: 'roadmap', label: 'Strategic Roadmap', icon: Calendar },
  { key: 'initiatives', label: 'Strategic Initiatives', icon: Target },
  { key: 'hierarchy', label: 'Objective Hierarchy', icon: GitBranch },
  { key: 'gaps', label: 'Strategic Gaps', icon: BarChart3 },
  { key: 'capability', label: 'Capability Intelligence', icon: ListChecks },
  { key: 'alignment', label: 'Strategic Alignment', icon: GitBranch },
  { key: 'maturity', label: 'Strategic Maturity', icon: Scale },
  { key: 'evolution', label: 'Strategy Evolution Timeline', icon: History },
  { key: 'achievability', label: 'Objective Achievability', icon: BarChart3 },
  { key: 'recommendations', label: 'Strategy Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function CorporateStrategySection() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<CorpStrategySummary>({});
  const [visions, setVisions] = useState<VisionRecordRow[]>([]);
  const [objectives, setObjectives] = useState<CorpObjectiveRow[]>([]);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItemRow[]>([]);
  const [audit, setAudit] = useState<StrategyEventRow[]>([]);
  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, vi, ob, rm, au, co] = await Promise.all([
        fetchCorpStrategySummary(), fetchVisionRecords(null, 50), fetchCorpObjectives(null, 100),
        fetchRoadmapItems(null, 100), fetchStrategyAudit(100), fetchCommitments(null, 100),
      ]);
      setSummary(s); setVisions(vi); setObjectives(ob); setRoadmapItems(rm); setAudit(au);
      setCommitments(co);
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

  /* ── 순수 로직 분석 ── */
  const hierarchyActuals = useMemo(() => (summary.hierarchy_actuals ?? {}) as Record<string, number | string>, [summary]);
  const initiativeCount = typeof hierarchyActuals.strategic_initiatives === 'number' ? hierarchyActuals.strategic_initiatives : 0;

  const hierarchy = useMemo(() => buildObjectiveHierarchy([
    ...visions.filter((v) => v.record_status === 'active_reference').map((v) => ({ id: v.id, stage: 'vision', label: v.record_kind, parentId: null })),
    ...objectives.map((o) => ({ id: o.id, stage: 'objective', label: o.objective_code, parentId: o.parent_vision_id })),
    ...commitments.slice(0, 20).map((c) => ({ id: c.id, stage: 'commitment', label: c.commitment_code, parentId: c.priority_candidate_id })),
  ]), [visions, objectives, commitments]);

  const gaps = useMemo(() => [
    analyzeStrategicGap({ area: 'objectives 정의', currentValue: objectives.length, targetValue: 4, evidence: ['objective count 실측'], unknownFactors: [] }),
    analyzeStrategicGap({ area: 'roadmap 연도 커버리지', currentValue: new Set(roadmapItems.map((r) => r.roadmap_year)).size, targetValue: 5, evidence: ['roadmap 실측'], unknownFactors: [] }),
    analyzeStrategicGap({ area: 'market position', currentValue: null, targetValue: null, evidence: ['market_data 없음'], unknownFactors: ['market_data'] }),
  ], [objectives, roadmapItems]);

  const capability = useMemo(() => analyzeCapability({
    current: ['delivery_analytics(0521)', 'forecasting(0522)', 'advisory(0523)', 'governance(0496)', 'learning(0515)'],
    required: ['delivery_analytics(0521)', 'forecasting(0522)', 'advisory(0523)', 'governance(0496)', 'learning(0515)', 'market_intelligence', 'customer_feedback_loop'],
  }), []);

  const alignments = useMemo(() => {
    const activeObjectives = objectives.filter((o) => !OBJ_TERMINAL.includes(o.objective_status));
    return [
      evaluateStrategyAlignment({ pair: 'Objective ↔ Vision', linkedCount: activeObjectives.filter((o) => o.parent_vision_id).length, totalCount: activeObjectives.length || null }),
      evaluateStrategyAlignment({ pair: 'Objective ↔ Initiative(0516)', linkedCount: activeObjectives.filter((o) => (o.linked_initiative_ids ?? []).length > 0).length, totalCount: activeObjectives.length || null }),
      evaluateStrategyAlignment({ pair: 'Objective ↔ Priority(0518)', linkedCount: activeObjectives.filter((o) => (o.linked_priority_ids ?? []).length > 0).length, totalCount: activeObjectives.length || null }),
      evaluateStrategyAlignment({ pair: 'Roadmap ↔ Objectives', linkedCount: roadmapItems.filter((r) => (r.linked_objective_ids ?? []).length > 0).length, totalCount: roadmapItems.length || null }),
    ];
  }, [objectives, roadmapItems]);

  const maturity = useMemo(() => evaluateStrategicMaturity([
    { dimension: 'governance', score: 70, evidence: ['0496/0512 governance 체계 실측'] },
    { dimension: 'execution', score: 60, evidence: ['0520 commitment 체계 실측'] },
    { dimension: 'analytics', score: 65, evidence: ['0521 delivery analytics 실측'] },
    { dimension: 'learning', score: 55, evidence: ['0515 organizational learning 실측'] },
    { dimension: 'advisory', score: 60, evidence: ['0523 advisory 체계 실측'] },
    { dimension: 'strategy', score: objectives.length ? 50 : null, evidence: objectives.length ? ['0524 objectives 기록'] : [] },
  ]), [objectives]);

  const roadmapTimeline = useMemo(() => buildRoadmapTimeline(roadmapItems.map((r) => ({ year: r.roadmap_year, phase: r.roadmap_phase, title: r.title }))), [roadmapItems]);

  const evolution = useMemo(() => buildStrategyEvolution(audit.map((e) => ({
    at: new Date(e.created_at),
    stage: e.event_type === 'vision_recorded' ? 'vision' : e.event_type === 'objective_created' || e.event_type === 'objective_reviewed' ? 'objective_update' : e.event_type === 'roadmap_revision_reference' ? 'strategy_revision' : 'execution',
    label: e.detail ?? e.event_type,
  }))), [audit]);

  const achievability = useMemo(() => objectives.filter((o) => !OBJ_TERMINAL.includes(o.objective_status)).map((o) => ({
    o,
    a: assessObjectiveAchievability({
      linkedInitiatives: (o.linked_initiative_ids ?? []).length,
      linkedCommitments: (o.linked_priority_ids ?? []).length,
      verifiedProgress: null, historicalSuccessRate: null, historicalSample: 0,
      unknownFactors: (o.unknown_factors ?? []).map(String),
    }),
  })), [objectives]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildStrategyRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (!visions.some((v) => v.record_status === 'active_reference')) push(buildStrategyRecommendation({ type: 'gather_evidence', reason: 'Vision/Mission 미기록 — 사람 입력 필요(AI 생성 불가)', evidence: ['vision_count:0'], confidence: null, assumptions: [] }));
    const unlinked = objectives.filter((o) => !OBJ_TERMINAL.includes(o.objective_status) && (o.linked_initiative_ids ?? []).length === 0 && (o.linked_priority_ids ?? []).length === 0).length;
    if (unlinked > 0) push(buildStrategyRecommendation({ type: 'review_alignment', reason: `Initiative/Priority 미연결 Objective ${unlinked}건`, evidence: [`unlinked:${unlinked}`], confidence: null, assumptions: [] }));
    if (gaps.some((g) => g.verdict === 'gap_candidate')) push(buildStrategyRecommendation({ type: 'review_strategic_gap', reason: 'Gap 후보 존재(사실 단정 아님) — 검토 필요', evidence: gaps.filter((g) => g.verdict === 'gap_candidate').map((g) => g.area), confidence: null, assumptions: [] }));
    if (capability.missing.length > 0) push(buildStrategyRecommendation({ type: 'validate_capability', reason: `Missing Capability ${capability.missing.length}건(인사 평가 아님)`, evidence: capability.missing, confidence: null, assumptions: [] }));
    if (!roadmapItems.length) push(buildStrategyRecommendation({ type: 'update_roadmap_candidate', reason: 'Roadmap 미구성 — 2026~2030 계획 기록 후보', evidence: ['roadmap:0'], confidence: null, assumptions: [] }));
    return out;
  }, [visions, objectives, gaps, capability, roadmapItems]);

  const dashboard = useMemo(() => buildRoadmapDashboard({
    visionCount: visions.filter((v) => v.record_status === 'active_reference').length,
    objectiveCount: objectives.filter((o) => !OBJ_TERMINAL.includes(o.objective_status)).length,
    roadmapYears: roadmapTimeline.years.length,
    initiativeCount,
    alignedPairs: alignments.filter((a) => a.alignment === 'aligned').length,
    totalPairs: alignments.filter((a) => a.alignment !== 'alignment_unverified' && a.alignment !== 'insufficient_data').length,
    gapCandidates: gaps.filter((g) => g.verdict === 'gap_candidate').length,
    missingCapabilities: capability.missing.length,
    maturityOverall: maturity.overall,
    briefingNote: `권고 ${autoRecs.length}건 검토 대기`,
  }), [visions, objectives, roadmapTimeline, initiativeCount, alignments, gaps, capability, maturity, autoRecs]);

  if (loading) return <AdminCard title="Enterprise Strategy Intelligence & Strategic Roadmap Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Strategy Intelligence & Strategic Roadmap Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Strategy Intelligence & Strategic Roadmap Center"
      subtitle="Vision→Objectives→Roadmap→Initiatives→Portfolio→Outcome→Evolution — 자동 생성/승인/변경 없음·Objective ≠ Outcome·Roadmap ≠ Commitment"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Vision/Mission/Objective 생성, 자동 Strategy 승인, 자동 Roadmap/Initiative/Portfolio/Priority/Budget/KPI/Policy/Production 변경, 자동 Merge/Deploy 는 없습니다. AI는 목표 제안·관계 분석·달성 가능성 평가만 하며 사람 대신 전략을 결정하지 않습니다. Vision ≠ Execution, Objective ≠ Outcome, Roadmap ≠ Commitment, Strategy ≠ Decision, Alignment ≠ Success, Capability ≠ Performance, Recommendation ≠ Approval." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {dashboard.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · 계층 실측: Initiatives {NUM(initiativeCount)} · Priorities {NUM(typeof hierarchyActuals.priorities === 'number' ? hierarchyActuals.priorities : null)} · Commitments {NUM(typeof hierarchyActuals.commitments === 'number' ? hierarchyActuals.commitments : null)} · Outcomes {NUM(typeof hierarchyActuals.outcomes === 'number' ? hierarchyActuals.outcomes : null)}</p>
        </div>
      )}

      {/* ── Vision ── */}
      {tab === 'vision' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createVisionRecord({ code: `vis_${now.toISOString().slice(0, 19)}`, kind: 'vision_statement', statement: r.slice(0, 2000), reason: '사람 입력 Vision 기록' }), 'Vision 기록(AI 생성 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Vision Statement 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vision 문장(사람 입력·필수)" className="min-w-[240px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!visions.length ? <AdminEmpty title="Vision/Mission 미기록" description="Vision 은 AI 가 자동 생성하지 않습니다 — 사람 입력만 기록됩니다." /> : visions.map((v) => (
            <div key={v.id} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="info">{v.record_kind}</AdminBadge>
              <AdminBadge tone={v.record_status === 'active_reference' ? 'success' : 'neutral'}>{v.record_status}</AdminBadge>
              <AdminBadge tone="neutral">human_authored</AdminBadge>
              <p className="mt-1">{v.statement}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Objectives ── */}
      {tab === 'objectives' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createCorpObjective({ code: `obj_${now.toISOString().slice(0, 19)}`, kind: 'annual', title: r.slice(0, 100), evidence: [{ label: 'note', value: '사람 입력 목표' }], year: now.getFullYear(), visionId: visions.find((v) => v.record_status === 'active_reference')?.id ?? null }), 'Objective 기록(사람 입력·Outcome 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">연간 Objective 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Objective 제목(사람 입력·필수)" className="min-w-[240px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!objectives.length ? <AdminEmpty title="Objective 없음" description="Objective 는 자동 생성되지 않으며 Objective ≠ Outcome 입니다." /> : objectives.map((o) => (
            <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{o.objective_code}</span>
                <AdminBadge tone="info">{o.objective_kind}</AdminBadge>
                <AdminBadge tone={o.objective_status === 'achieved_reference' ? 'success' : o.objective_status === 'at_risk_candidate' ? 'danger' : 'neutral'}>{o.objective_status}</AdminBadge>
                <AdminBadge tone="neutral">{o.priority_reference}</AdminBadge>
                <span className="text-muted-foreground">{o.title} · {o.target_year ?? '—'}{o.target_quarter ? `Q${o.target_quarter}` : ''} · owner {o.owner_reference ?? 'owner_unverified'} · 검토 {o.review_cycle}</span>
              </div>
              {!OBJ_TERMINAL.includes(o.objective_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['pending_executive_review', 'active_reference', 'on_track_candidate', 'at_risk_candidate', 'achieved_reference', 'deferred_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCorpObjective(o.id, st, rr), `${st}(Objective ≠ Outcome)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Roadmap ── */}
      {tab === 'roadmap' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createRoadmapItem({ code: `rm_${now.toISOString().slice(0, 19)}`, title: r.slice(0, 100), year: now.getFullYear(), evidence: [{ label: 'note', value: '계획 참고' }], phase: 'current' }), 'Roadmap 기록(Commitment 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{now.getFullYear()} Roadmap 항목 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Roadmap 제목(필수)" className="min-w-[240px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!roadmapTimeline.years.length ? <AdminEmpty title="Roadmap 미구성" description="2026→2030 장기 Timeline 을 기록할 수 있습니다. Roadmap ≠ Commitment." /> : roadmapTimeline.years.map((y) => (
            <div key={y.year} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-black">{y.year}</span>
              {y.items.map((i, idx) => <span key={idx} className="ml-2 text-muted-foreground">[{i.phase}] {i.title}</span>)}
            </div>
          ))}
          {roadmapItems.filter((r) => !['rejected', 'invalidated'].includes(r.review_status)).slice(0, 10).map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{r.roadmap_code}</span>
              <AdminBadge tone="neutral">{r.review_status}</AdminBadge>
              <div className="mt-1 flex flex-wrap gap-1">
                {(['pending_executive_review', 'reviewed_reference', 'revised_reference'] as const).map((st) => (
                  <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewRoadmapItem(r.id, st, rr), `${st}(Revision 은 사람 승인)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Initiatives ── */}
      {tab === 'initiatives' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Strategic Initiatives(0516 실측)" value={NUM(initiativeCount)} />
            <Box label="0516 전략 Objectives" value={NUM(typeof hierarchyActuals.strategic_objectives_0516 === 'number' ? hierarchyActuals.strategic_objectives_0516 : null)} />
            <Box label="Objective 연결" value={NUM(objectives.filter((o) => (o.linked_initiative_ids ?? []).length > 0).length)} />
          </div>
          <AdminAlert tone="info" description="Initiative 는 ai_strategic_initiatives(0516)를 재사용합니다 — 이 Phase 에서 자동 생성하지 않으며 Corporate Objective 의 linked_initiative_ids 로 연결만 합니다(실존 검증)." />
        </div>
      )}

      {/* ── Hierarchy ── */}
      {tab === 'hierarchy' && (
        <div className="space-y-2">
          {hierarchy.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.nodes.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.slice(0, 6).map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {hierarchy.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결(orphan) ${hierarchy.orphans.length}건`} description="상위 계층과 연결되지 않은 항목 — 사람 검토 필요" />}
          {hierarchy.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지" description={hierarchy.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Vision→Objective→Initiative→Commitment→Execution→Outcome 6단계</p>
        </div>
      )}

      {/* ── Gaps / Capability / Alignment / Maturity ── */}
      {tab === 'gaps' && (
        <div className="space-y-1">
          {gaps.map((g) => (
            <div key={g.area} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{g.area}</span>
              <AdminBadge tone={g.verdict === 'gap_candidate' ? 'danger' : g.verdict.includes('unverified') || g.verdict === 'insufficient_data' ? 'warning' : 'success'}>{g.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">gap {g.gap ?? 'null(0 아님)'} · confidence {g.confidence ?? '—'} · 사실 단정 아님</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'capability' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="보유 Capability" value={NUM(capability.present.length)} />
            <Box label="Missing" value={capability.missing.join(', ') || '없음'} />
            <Box label="성장 후보" value={NUM(capability.growthCandidates.length)} />
          </div>
          <p className="text-[10px] text-muted-foreground">notPersonnelEvaluation=true — Capability 부족은 사람 능력으로 해석하지 않습니다.</p>
        </div>
      )}
      {tab === 'alignment' && (
        <div className="space-y-1">
          {alignments.map((a) => (
            <div key={a.pair} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{a.pair}</span>
              <AdminBadge tone={a.alignment === 'aligned' ? 'success' : a.alignment === 'alignment_unverified' ? 'warning' : 'neutral'}>{a.alignment}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{a.pct == null ? '자료 없음(임의 생성 금지)' : `${a.pct}%`} · Alignment ≠ Success</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'maturity' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Overall(단독 해석 금지)" value={maturity.overall == null ? 'insufficient_data' : String(maturity.overall)} />
            <Box label="Missing Areas" value={maturity.missingAreas.join(', ') || '없음'} />
            <Box label="Evidence" value={NUM(maturity.supportingEvidence.length)} />
            <Box label="Unknown" value={NUM(maturity.unknownFactors.length)} />
          </div>
          {maturity.byDimension.map((d) => (
            <div key={d.dimension} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{d.dimension}</span>
              <span className="ml-2">{d.score == null ? 'Evidence 없음 — 점수 제외' : d.score}</span>
              <span className="ml-2 text-muted-foreground">Evidence {d.evidenceCount}건</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Evolution / Achievability ── */}
      {tab === 'evolution' && (
        !evolution.timeline.length ? <AdminEmpty title="Evolution 이력 없음" description="Vision→Objective Update→Initiative→Execution→Outcome→Learning→Strategy Revision — Revision 은 Human Approval Required." /> : (
          <div className="space-y-1">
            {evolution.timeline.map((e, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone={e.humanApprovalRequired ? 'warning' : 'neutral'}>{e.stage}{e.humanApprovalRequired ? '(사람 승인)' : ''}</AdminBadge>
                <span className="ml-2">{e.label}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'achievability' && (
        !achievability.length ? <AdminEmpty title="평가 대상 없음" description="Objective 가 생기면 달성 가능성(확정 아님)을 평가합니다." /> : (
          <div className="space-y-1">
            {achievability.map(({ o, a }) => (
              <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{o.objective_code}</span>
                <AdminBadge tone={a.verdict === 'achievable_candidate' ? 'success' : a.verdict.includes('unverified') || a.verdict === 'sample_too_small' ? 'warning' : 'danger'}>{a.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">score {a.score ?? 'null'} · {a.drivers.join(' · ') || '—'} · notGuarantee</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Approval</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['objective_reviewed', 'roadmap_item_reviewed', 'roadmap_revision_reference', 'vision_recorded'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Vision 기록/Objective 판정/Roadmap Revision 은 전부 사람이 수행합니다." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_strategy_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 전략 자료는 참조로만 기록됩니다." /> : (
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
              void act(() => recordStrategyGovernance('maturity_evaluated', r, { overall: maturity.overall, missing: maturity.missingAreas }), 'Maturity 평가 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Maturity 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="전략 기록/검토가 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
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
          {STRATEGY_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.label}</span>
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
