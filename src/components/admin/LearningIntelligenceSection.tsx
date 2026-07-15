/**
 * LearningIntelligenceSection — Enterprise Learning Intelligence, Continuous Improvement &
 * Organizational Optimization Center (Phase AI-OPS-29).
 *
 * Enterprise→Knowledge→Learning→Continuous Improvement→Optimization→Organizational Intelligence→Executive Learning Advisory.
 * Improvement/Optimization 자동 적용/정책·조직 규칙 자동 변경 없음 · Learning ≠ Correctness ·
 * Improvement ≠ Adoption · Optimization ≠ Better Outcome · Maturity ≠ Organizational Success.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gauge, GitBranch, GraduationCap, Grid3x3, History, Layers, Lightbulb,
  ListChecks, Lock, RefreshCw, Repeat, Scale, ScrollText, TrendingUp, Wrench,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchLearningSummary, createLearningEntry, reviewLearningEntry, recordLearningAdoption,
  fetchLearningRegistry, recordLearningTimeline, recordLearningGovernance, fetchLearningAudit,
  type LearningSummary, type LearningRegistryRow, type LearningEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  assessOptimizationCandidates, analyzeOrganizationalEvolution, measureLearningEffectiveness,
  buildImprovementTimeline, evaluateOrganizationalMaturity, buildLearningGraph,
  buildLearningBriefing, buildLearningRecommendation, buildLearningCockpit,
  EVOLUTION_KINDS, IMPROVEMENT_TIMELINE_STAGES, LEARNING_SUPPORT,
} from '@/lib/learningIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const CREATE_KINDS = ['learning_record', 'improvement_candidate', 'optimization_candidate', 'lesson_learned'] as const;

type Tab = 'cockpit' | 'dashboard' | 'registry' | 'improvement' | 'optimization' | 'evolution'
  | 'effectiveness' | 'timeline' | 'maturity' | 'graph' | 'briefing' | 'recommendations'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Learning & Improvement Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Learning Dashboard', icon: Gauge },
  { key: 'registry', label: 'Learning Registry', icon: ListChecks },
  { key: 'improvement', label: 'Continuous Improvement', icon: Wrench },
  { key: 'optimization', label: 'Optimization Candidates', icon: TrendingUp },
  { key: 'evolution', label: 'Organizational Intelligence', icon: Repeat },
  { key: 'effectiveness', label: 'Learning Effectiveness', icon: GraduationCap },
  { key: 'timeline', label: 'Improvement Timeline', icon: History },
  { key: 'maturity', label: 'Organizational Maturity', icon: Scale },
  { key: 'graph', label: 'Learning Graph', icon: GitBranch },
  { key: 'briefing', label: 'Executive Learning Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Learning Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function LearningIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<LearningSummary>({});
  const [registry, setRegistry] = useState<LearningRegistryRow[]>([]);
  const [audit, setAudit] = useState<LearningEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, re, au] = await Promise.all([fetchLearningSummary(), fetchLearningRegistry(null, 100), fetchLearningAudit(150)]);
      setSummary(s); setRegistry(re); setAudit(au);
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

  const actuals = useMemo(() => (typeof summary.learning_actuals === 'object' && summary.learning_actuals !== null && !Array.isArray(summary.learning_actuals) ? summary.learning_actuals as Record<string, unknown> : {}), [summary]);
  const anum = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);

  const improvements = useMemo(() => registry.filter((r) => r.learning_kind === 'improvement_candidate'), [registry]);
  const optimizations = useMemo(() => assessOptimizationCandidates(registry.filter((r) => r.learning_kind === 'optimization_candidate').map((r) => ({
    code: r.learning_code, domain: r.optimization_domain, evidenceCount: (r.evidence ?? []).length,
  }))), [registry]);

  const evolution = useMemo(() => analyzeOrganizationalEvolution(EVOLUTION_KINDS.map((kind) => {
    const noted = audit.filter((e) => e.event_type === 'organizational_evolution_analyzed' && (e.detail ?? '').includes(kind)).length;
    return { kind, observations: noted, evidence: noted > 0 ? ['evolution 분석 기록 실측'] : [] };
  })), [audit]);

  const effectiveness = useMemo(() => measureLearningEffectiveness({
    learningsTotal: registry.length || null,
    learningsApproved: registry.filter((r) => r.learning_status === 'approved').length || (registry.length ? 0 : null),
    improvementsTotal: improvements.length || null,
    improvementsApproved: improvements.filter((r) => r.learning_status === 'approved').length || (improvements.length ? 0 : null),
    optimizationsTotal: optimizations.rows.length || null,
    adoptionsRecorded: registry.filter((r) => r.adoption_recorded).length || (registry.length ? 0 : null),
  }), [registry, improvements, optimizations]);

  const timeline = useMemo(() => buildImprovementTimeline(audit.filter((e) => ['improvement_timeline_recorded', 'adoption_recorded'].includes(e.event_type) && e.stage).map((e) => ({
    stage: e.stage as string, at: new Date(e.created_at), note: e.detail ?? '',
  }))), [audit]);

  const maturity = useMemo(() => {
    const policies = anum('enterprise_policies_0512'); const learnings = anum('org_learnings_0515'); const memory = anum('org_memory_0531');
    return evaluateOrganizationalMaturity([
      { dimension: 'process', score: policies && policies > 0 ? 55 : null, evidence: policies && policies > 0 ? [`0512 policies ${policies}건 실측`] : [] },
      { dimension: 'governance', score: 60, evidence: ['0496/0512 거버넌스 체계 실측'] },
      { dimension: 'learning', score: learnings && learnings > 0 ? 50 : null, evidence: learnings && learnings > 0 ? [`0515 learnings ${learnings}건 실측`] : [] },
      { dimension: 'optimization', score: optimizations.rows.length > 0 ? 45 : null, evidence: optimizations.rows.length > 0 ? ['optimization candidates 실측'] : [] },
      { dimension: 'collaboration', score: null, evidence: [] },   // 협업 도구 분석 원본 없음
      { dimension: 'knowledge', score: memory && memory > 0 ? 50 : null, evidence: memory && memory > 0 ? [`0531 memory ${memory}건 실측`] : [] },
    ]);
  }, [anum, optimizations]);

  const graph = useMemo(() => buildLearningGraph(registry.map((r) => ({
    id: r.id,
    stage: r.learning_kind === 'optimization_candidate' ? 'optimization'
      : r.learning_kind === 'improvement_candidate' ? 'improvement'
      : r.learning_kind === 'organizational_insight' ? 'outcome'
      : r.learning_kind === 'lesson_learned' || r.learning_kind === 'retrospective' ? 'learning' : 'knowledge',
    label: r.learning_code,
    parentId: (r.linked_learning_ids ?? [])[0] ?? null,
  }))), [registry]);

  const briefing = useMemo(() => buildLearningBriefing({
    periodKind: 'weekly',
    newLearnings: registry.slice(0, 5).map((r) => `${r.learning_code}(${r.learning_kind}) ${r.learning_status}`),
    improvementCandidates: improvements.slice(0, 5).map((r) => `${r.learning_code}(Improvement ≠ Adoption)`),
    optimizationCandidates: optimizations.rows.filter((r) => r.verdict === 'reviewable_candidate').map((r) => `${r.code}[${r.domain}]`),
    maturityNote: [`overall ${maturity.overall ?? 'insufficient_data'}(Success 아님) · missing ${maturity.missingAreas.join(',') || '없음'}`],
    recommendations: [],
  }), [registry, improvements, optimizations, maturity]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildLearningRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (!registry.length) push(buildLearningRecommendation({ type: 'review_learning', reason: 'Learning Registry 비어 있음 — 사람 기록 필요(자동 생성 불가)', evidence: ['registry:0'], confidence: null, assumptions: [] }));
    const unvalidated = improvements.filter((r) => r.learning_status === 'candidate').length;
    if (unvalidated > 0) push(buildLearningRecommendation({ type: 'validate_improvement', reason: `검증 대기 Improvement 후보 ${unvalidated}건(자동 적용 아님)`, evidence: [`candidates:${unvalidated}`], confidence: null, assumptions: [] }));
    if (optimizations.rows.some((r) => r.verdict === 'reviewable_candidate')) push(buildLearningRecommendation({ type: 'review_optimization', reason: 'Optimization 후보 존재 — 사람 검토 필요(Better Outcome 보장 아님)', evidence: ['optimization_candidates'], confidence: null, assumptions: [] }));
    const noEv = registry.filter((r) => (r.evidence ?? []).length === 0).length;
    if (noEv > 0 || maturity.missingAreas.length > 0) push(buildLearningRecommendation({ type: 'gather_more_evidence', reason: `Evidence 부족 항목 존재(learning ${noEv}건 · maturity missing ${maturity.missingAreas.length}건)`, evidence: ['evidence_gap'], confidence: null, assumptions: [] }));
    if (maturity.overall == null) push(buildLearningRecommendation({ type: 'review_maturity', reason: 'Maturity 산정 불가 차원 존재 — Evidence 확보 검토', evidence: maturity.missingAreas.length ? maturity.missingAreas : ['maturity'], confidence: null, assumptions: [] }));
    const approvedNoAdoption = registry.filter((r) => r.learning_status === 'approved' && !r.adoption_recorded).length;
    if (approvedNoAdoption > 0) push(buildLearningRecommendation({ type: 'review_adoption', reason: `승인 후 Adoption 미기록 ${approvedNoAdoption}건(Improvement ≠ Adoption)`, evidence: [`approved_no_adoption:${approvedNoAdoption}`], confidence: null, assumptions: [] }));
    return out;
  }, [registry, improvements, optimizations, maturity]);

  const cockpit = useMemo(() => buildLearningCockpit({
    registryTotal: registry.length,
    improvementCandidates: improvements.length,
    optimizationCandidates: optimizations.rows.length,
    evolutionCandidates: evolution.rows.filter((r) => r.verdict === 'evolution_candidate').length,
    maturityOverall: maturity.overall,
    graphOrphans: graph.orphans.length,
    summaryNote: null,
  }), [registry, improvements, optimizations, evolution, maturity, graph]);

  if (loading) return <AdminCard title="Enterprise Learning Intelligence & Continuous Improvement Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Learning Intelligence & Continuous Improvement Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Learning Intelligence & Continuous Improvement Center"
      subtitle="Knowledge→Learning→Continuous Improvement→Optimization→Organizational Intelligence→Executive Learning Advisory — 자동 적용/정책 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Improvement/Optimization 자동 적용, 정책/조직 규칙/전략 자동 변경, 자동 Production/Merge/Deploy 는 없습니다. Improvement 와 Optimization 은 Evidence 기반 후보로만 생성되며 모든 Adoption 은 사람 승인이 필요합니다. Learning ≠ Correctness, Improvement ≠ Adoption, Optimization ≠ Better Outcome, Maturity ≠ Organizational Success, Recommendation ≠ Organizational Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · organizationAutoOptimized=false</p>
        </div>
      )}

      {/* ── Dashboard(0515/0531/0514/0512 실측) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Org Learnings(0515)" value={NUM(anum('org_learnings_0515'))} />
            <Box label="Learning Patterns(0515)" value={NUM(anum('learning_patterns_0515'))} />
            <Box label="Policy Evolution 후보(0515)" value={NUM(anum('policy_evolution_candidates_0515'))} />
            <Box label="Org Memory(0531)" value={NUM(anum('org_memory_0531'))} />
            <Box label="Lessons/회고(0531)" value={NUM(anum('lessons_0531'))} />
            <Box label="Decision Outcomes(0514)" value={NUM(anum('decision_outcomes_0514'))} />
            <Box label="Enterprise Policies(0512)" value={NUM(anum('enterprise_policies_0512'))} />
            <Box label="Adoption 기록" value={NUM(typeof summary.adoption_recorded_count === 'number' ? summary.adoption_recorded_count : null)} />
          </div>
          <AdminAlert tone="info" description={`learning_unavailable: ${Array.isArray(summary.learning_unavailable) ? (summary.learning_unavailable as unknown[]).map(String).join(', ') : '—'} — 교육 플랫폼/HR 학습 기록/협업 도구 분석 원본 없음(임의 생성 금지). AI-OPS-1~28 데이터는 전부 읽기 전용 참조입니다.`} />
        </div>
      )}

      {/* ── Registry / Improvement / Optimization ── */}
      {tab === 'registry' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {CREATE_KINDS.map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createLearningEntry({ code: `lrn_${kind}_${now.toISOString().slice(0, 19)}`, kind, title: r.slice(0, 100), domain: kind === 'optimization_candidate' ? 'process' : null, evidence: [{ label: 'note', value: '사람 기록' }] }), `${kind} 기록(candidate 시작 — 자동 적용 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 기록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="제목/내용/사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!registry.length ? <AdminEmpty title="Learning 없음" description="학습/개선/최적화는 AI 가 자동 적용하지 않습니다 — 사람 기록만 candidate 상태로 저장됩니다(4상태)." /> : registry.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.learning_code}</span>
                <AdminBadge tone="info">{r.learning_kind}</AdminBadge>
                <AdminBadge tone={r.learning_status === 'approved' ? 'success' : r.learning_status === 'candidate' ? 'warning' : 'neutral'}>{r.learning_status}</AdminBadge>
                {r.adoption_recorded && <AdminBadge tone="success">adoption_recorded</AdminBadge>}
                <span className="text-muted-foreground">{r.title}{r.optimization_domain ? ` · [${r.optimization_domain}]` : ''} · Learning ≠ Correctness</span>
              </div>
              {r.learning_status !== 'archived' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewLearningEntry(r.id, 'approved', rr), 'approved(사람 승인 — 적용 보장 아님)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">approved(승인)</button>
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewLearningEntry(r.id, 'archived', rr), 'archive candidate(삭제 아님 — 보존)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">archived(보존)</button>
                  {r.learning_status === 'approved' && !r.adoption_recorded && (
                    <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordLearningAdoption(r.id, rr), 'Adoption 기록(Human Required — 결과 보장 아님)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Adoption 기록</button>
                  )}
                  {IMPROVEMENT_TIMELINE_STAGES.slice(0, 4).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordLearningTimeline(r.id, st, rr), `${st} 기록(완료 보장 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">TL:{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'improvement' && (
        !improvements.length ? <AdminEmpty title="Improvement 후보 없음" description="Proposal→Validation→Adoption→Review→Archive Candidate 를 추적하며 모든 Adoption 은 사람 승인이 필요합니다." /> : (
          <div className="space-y-1">
            {improvements.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.learning_code}</span>
                <AdminBadge tone={r.learning_status === 'approved' ? 'success' : 'warning'}>{r.learning_status}</AdminBadge>
                <AdminBadge tone={r.adoption_recorded ? 'success' : 'neutral'}>{r.adoption_recorded ? 'adopted(사람 승인)' : 'not_adopted'}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{r.title} · Improvement ≠ Adoption</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'optimization' && (
        !optimizations.rows.length ? <AdminEmpty title="Optimization 후보 없음" description="Process/Operational/Strategy/AI 후보만 생성되며 자동 적용하지 않습니다." /> : (
          <div className="space-y-1">
            {optimizations.rows.map((r) => (
              <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.code}</span>
                <AdminBadge tone="info">{r.domain ?? '—'}</AdminBadge>
                <AdminBadge tone={r.verdict === 'reviewable_candidate' ? 'success' : 'warning'}>{r.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">autoApplied=false · Optimization ≠ Better Outcome</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Evolution / Effectiveness / Timeline / Maturity / Graph ── */}
      {tab === 'evolution' && (
        <div className="space-y-1">
          {evolution.rows.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.kind}</span>
              <AdminBadge tone={r.verdict === 'evolution_candidate' ? 'info' : 'warning'}>{r.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Evolution ≠ 사실 단정{r.verdict === 'learning_unverified' ? ' · 분석 기록 없음 — unknown 유지' : ''}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Success/Failure/Recovery/Quality/Efficiency 5종 — 관찰&lt;3 은 sample_too_small.</p>
        </div>
      )}
      {tab === 'effectiveness' && (
        <div className="space-y-1">
          {effectiveness.coverages.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.key}</span>
              <AdminBadge tone={c.status === 'measured' ? 'info' : 'warning'}>{c.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{c.pct == null ? 'null(분모 없음 — 0 아님)' : `${c.pct}%`} · 실측만 사용</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">measuredOnly=true · adoptionIsNotOutcome=true — Adoption 기록이 성과를 보장하지 않습니다.</p>
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-2">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.entries.length ? 'info' : 'neutral'}>{s.stage}{s.humanRequired ? '(Human Required)' : ''}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.entries.length ? s.entries.slice(0, 3).map((e) => `${e.at.slice(0, 16).replace('T', ' ')} ${e.note}`).join(' · ') : '기록 없음'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Issue→Learning→Improvement→Validation→Approval→Adoption→Outcome — stageCompletionGuarantee=false</p>
        </div>
      )}
      {tab === 'maturity' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Overall(Success 아님)" value={maturity.overall == null ? 'insufficient_data' : String(maturity.overall)} />
            <Box label="Missing Areas" value={maturity.missingAreas.join(', ') || '없음'} />
            <Box label="Supporting Evidence" value={NUM(maturity.supportingEvidence.length)} />
            <Box label="Unknown" value={NUM(maturity.unknownFactors.length)} />
          </div>
          {maturity.byDimension.map((d) => (
            <div key={d.dimension} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{d.dimension}</span>
              <span className="ml-2">{d.score == null ? 'Evidence 없음 — 점수 제외' : d.score}</span>
              <span className="ml-2 text-muted-foreground">Evidence {d.evidenceCount}건 · Maturity ≠ Organizational Success</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'graph' && (
        <div className="space-y-2">
          {graph.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.nodes.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.slice(0, 6).map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {graph.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결 ${graph.orphans.length}건`} description="상위 단계와 연결되지 않은 항목 — 사람 검토 필요" />}
          {graph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지(인과 주장 없음)" description={graph.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Knowledge→Learning→Improvement→Optimization→Outcome 5단계 · causalityClaimed=false</p>
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordLearningGovernance('learning_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Learning Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음)</p>
        </div>
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Organizational Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['learning_recorded', 'learning_reviewed', 'learning_approved', 'adoption_recorded'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="학습 기록/승인/Adoption 은 전부 사람이 수행합니다(자동 적용 없음)." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_learning_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 학습 자료는 참조로만 기록됩니다." /> : (
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
              void act(() => recordLearningGovernance('organizational_maturity_evaluated', r, { overall: maturity.overall, missing: maturity.missingAreas }), 'Maturity 평가 기록(Success 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Maturity 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="학습 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              {e.stage && <AdminBadge tone="info">{e.stage}</AdminBadge>}
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {LEARNING_SUPPORT.map((s) => (
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
