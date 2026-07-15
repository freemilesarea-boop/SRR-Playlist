/**
 * RiskResilienceSection — Enterprise Risk Intelligence, Business Resilience &
 * Continuity Center (Phase AI-OPS-25).
 *
 * Enterprise→Risk→Business Continuity→Operational Resilience→Recovery Readiness→Executive Risk Advisory.
 * 자동 Incident 생성/Risk 종료/서비스 중단/운영 정책 변경 없음 · Risk ≠ Incident ·
 * Likelihood ≠ Reality · Recovery Plan ≠ Recovery Success · Continuity ≠ Zero Downtime.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Flame, Gauge, GitBranch, Grid3x3, History, Layers, LifeBuoy, Lightbulb,
  ListChecks, Lock, RefreshCw, Scale, ScrollText, Shield, ShieldCheck,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchRiskSummary, createRiskRegisterEntry, reviewRiskRegisterEntry, fetchRiskRegister,
  recordRiskTimeline, recordRiskGovernance, fetchRiskAudit,
  type RiskSummary, type RiskRegisterRow, type RiskEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  computeRiskHeat, buildRiskDependencyGraph, buildRiskTimeline, evaluateContinuity,
  evaluateResilience, analyzeControlEffectiveness, evaluateRecoveryReadiness,
  buildRiskBriefing, buildRiskRecommendation, buildRiskCockpit,
  RISK_CATEGORIES, RISK_TIMELINE_STAGES, RISK_SUPPORT,
} from '@/lib/riskResilience';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'cockpit' | 'dashboard' | 'register' | 'heatmap' | 'dependency' | 'timeline' | 'continuity'
  | 'resilience' | 'controls' | 'recovery' | 'briefing' | 'recommendations' | 'humanreviews'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Risk & Resilience Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Risk Dashboard', icon: Gauge },
  { key: 'register', label: 'Risk Register', icon: ListChecks },
  { key: 'heatmap', label: 'Risk Heatmap', icon: Flame },
  { key: 'dependency', label: 'Risk Dependency', icon: GitBranch },
  { key: 'timeline', label: 'Risk Timeline', icon: History },
  { key: 'continuity', label: 'Business Continuity', icon: Activity },
  { key: 'resilience', label: 'Operational Resilience', icon: Shield },
  { key: 'controls', label: 'Control Effectiveness', icon: ShieldCheck },
  { key: 'recovery', label: 'Recovery Readiness', icon: LifeBuoy },
  { key: 'briefing', label: 'Executive Risk Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Risk Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function RiskResilienceSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<RiskSummary>({});
  const [risks, setRisks] = useState<RiskRegisterRow[]>([]);
  const [audit, setAudit] = useState<RiskEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ri, au] = await Promise.all([fetchRiskSummary(), fetchRiskRegister(null, 100), fetchRiskAudit(150)]);
      setSummary(s); setRisks(ri); setAudit(au);
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

  const actuals = useMemo(() => (typeof summary.resilience_actuals === 'object' && summary.resilience_actuals !== null && !Array.isArray(summary.resilience_actuals) ? summary.resilience_actuals as Record<string, unknown> : {}), [summary]);
  const anum = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);
  const openRisks = useMemo(() => risks.filter((r) => r.risk_status !== 'closed'), [risks]);

  const heats = useMemo(() => risks.map((r) => ({ r, h: computeRiskHeat({ likelihood: r.likelihood_reference, impact: r.impact_reference }) })), [risks]);

  const dependency = useMemo(() => buildRiskDependencyGraph(openRisks.map((r) => ({ id: r.id, code: r.risk_code, linkedRiskIds: r.linked_risk_ids ?? [] }))), [openRisks]);

  const timeline = useMemo(() => buildRiskTimeline(audit.filter((e) => e.event_type === 'risk_timeline_recorded' && e.stage).map((e) => ({
    stage: e.stage as string, at: new Date(e.created_at), note: e.detail ?? '',
  }))), [audit]);

  const continuity = useMemo(() => evaluateContinuity({
    playStarts: anum('play_starts_30d'), playerErrors: anum('player_errors_30d'),
    incidentsOpen: anum('incidents_open_0502'), storesActive: null,   // 매장 연속성 원본은 본 summary 에 없음 — null 유지
  }), [anum]);

  const resilience = useMemo(() => {
    const ind = anum('reliability_indicators_0507'); const obj = anum('reliability_objectives_0507'); const pb = anum('playbooks_reference_0502');
    return evaluateResilience([
      { component: 'detection_readiness', score: ind && ind > 0 ? 60 : null, evidence: ind && ind > 0 ? [`0507 indicators ${ind}건 실측`] : [] },
      { component: 'monitoring_coverage', score: obj && obj > 0 ? 55 : null, evidence: obj && obj > 0 ? [`0507 objectives ${obj}건 실측`] : [] },
      { component: 'recovery_readiness', score: pb && pb > 0 ? 50 : null, evidence: pb && pb > 0 ? [`0502 reference playbooks ${pb}건 실측`] : [] },
      { component: 'failover_readiness', score: null, evidence: [] },   // failover 구성 원본 없음
      { component: 'recovery_confidence', score: null, evidence: [] },  // 복구 훈련 로그 없음
    ]);
  }, [anum]);

  const controls = useMemo(() => analyzeControlEffectiveness({
    risks: openRisks.map((r) => ({ id: r.id, code: r.risk_code })),
    controls: openRisks.flatMap((r) => (r.controls ?? []).map((c) => ({
      name: String((c as Record<string, unknown>).name ?? 'control'), coveredRiskIds: [r.id],
      evidence: (r.evidence ?? []).length ? ['risk evidence'] : [],
    }))),
  }), [openRisks]);

  const recovery = useMemo(() => evaluateRecoveryReadiness({
    playbooksReference: anum('playbooks_reference_0502'), playbooksDraft: anum('playbooks_draft_0502'),
    recoveryCandidates: anum('recovery_candidates_0502'),
    validationEvidence: audit.filter((e) => e.event_type === 'recovery_readiness_evaluated').map((e) => e.detail ?? 'validation'),
  }), [anum, audit]);

  const briefing = useMemo(() => buildRiskBriefing({
    periodKind: 'weekly',
    newRisks: risks.slice(0, 5).map((r) => `${r.risk_code}(${r.risk_category}) ${r.risk_status}`),
    changedRisks: audit.filter((e) => ['risk_reviewed', 'risk_mitigation_recorded', 'risk_closed'].includes(e.event_type)).slice(0, 5).map((e) => e.detail ?? e.event_type),
    recoveryStatus: [`recovery: ${recovery.verdict}(Plan ≠ Success)`],
    unknownFactors: resilience.unknownFactors,
    recommendations: [],
  }), [risks, audit, recovery, resilience]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildRiskRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const unrated = openRisks.filter((r) => r.likelihood_reference == null || r.impact_reference == null).length;
    if (unrated > 0) push(buildRiskRecommendation({ type: 'review_risk', reason: `Likelihood/Impact 미평가 Risk ${unrated}건(risk_unverified)`, evidence: [`unrated:${unrated}`], confidence: null, assumptions: [] }));
    const noEv = risks.filter((r) => (r.evidence ?? []).length === 0).length;
    if (noEv > 0) push(buildRiskRecommendation({ type: 'validate_evidence', reason: `Evidence 없는 Risk ${noEv}건`, evidence: [`no_evidence:${noEv}`], confidence: null, assumptions: [] }));
    if (controls.uncontrolledRisks.length) push(buildRiskRecommendation({ type: 'review_controls', reason: `Control 없는 Risk ${controls.uncontrolledRisks.length}건(제거 보장 아님)`, evidence: controls.uncontrolledRisks, confidence: null, assumptions: [] }));
    if (resilience.missingComponents.length) push(buildRiskRecommendation({ type: 'improve_monitoring', reason: `Evidence 없는 복원력 컴포넌트 ${resilience.missingComponents.length}건`, evidence: resilience.missingComponents, confidence: null, assumptions: [] }));
    if (recovery.verdict !== 'readiness_candidate') push(buildRiskRecommendation({ type: 'prepare_recovery', reason: `Recovery ${recovery.verdict} — 검증 기록 필요(Plan ≠ Success)`, evidence: [recovery.verdict], confidence: null, assumptions: [] }));
    if (!risks.length) push(buildRiskRecommendation({ type: 'gather_more_evidence', reason: 'Risk Register 비어 있음 — 사람 등록 필요(자동 생성 불가)', evidence: ['register:0'], confidence: null, assumptions: [] }));
    return out;
  }, [openRisks, risks, controls, resilience, recovery]);

  const cockpit = useMemo(() => buildRiskCockpit({
    registerTotal: risks.length,
    heatCritical: heats.filter(({ h }) => h.heat === 'critical').length,
    dependencyEdges: dependency.edges.length,
    continuityVerdict: continuity.verdict,
    resilienceOverall: resilience.overall,
    recoveryVerdict: recovery.verdict,
    summaryNote: null,
  }), [risks, heats, dependency, continuity, resilience, recovery]);

  const byCategory = useMemo(() => (typeof summary.register_by_category === 'object' && summary.register_by_category !== null && !Array.isArray(summary.register_by_category) ? summary.register_by_category as Record<string, number> : {}), [summary]);

  if (loading) return <AdminCard title="Enterprise Risk Intelligence & Business Resilience Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Risk Intelligence & Business Resilience Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Risk Intelligence & Business Resilience Center"
      subtitle="Risk→Business Continuity→Operational Resilience→Recovery Readiness→Executive Risk Advisory — 자동 Incident 생성/Risk 종료/서비스 중단 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Incident 생성, 자동 Risk 종료, 자동 서비스 중단, 자동 운영 정책/계약/KPI/Production 변경, 자동 Merge/Deploy 는 없습니다. AI는 리스크 분석·관계 설명·복원력 평가·대응 후보 제안만 하며 사람 대신 위기 의사결정을 하지 않습니다. Risk ≠ Incident, Likelihood ≠ Reality, Recovery Plan ≠ Recovery Success, Continuity ≠ Zero Downtime, Correlation ≠ Causation, Recommendation ≠ Operational Decision." />
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
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · riskAutoResolved=false</p>
        </div>
      )}

      {/* ── Executive Risk Dashboard(카테고리 실측) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(['strategic', 'operational', 'financial', 'market', 'technology', 'compliance', 'security'] as const).map((cat) => (
              <Box key={cat} label={`${cat} risk`} value={NUM(byCategory[cat] ?? 0)} />
            ))}
            <Box label="Business Continuity" value={continuity.verdict} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Incidents(0502 실측)" value={NUM(anum('incidents_total_0502'))} />
            <Box label="Open Incidents" value={NUM(anum('incidents_open_0502'))} />
            <Box label="Playbooks(reference)" value={NUM(anum('playbooks_reference_0502'))} />
            <Box label="Reliability Indicators(0507)" value={NUM(anum('reliability_indicators_0507'))} />
          </div>
          <AdminAlert tone="info" description={`risk_unavailable: ${Array.isArray(summary.risk_unavailable) ? (summary.risk_unavailable as unknown[]).map(String).join(', ') : '—'} — 외부 리스크 피드/보험/감사 보고서 원본 없음(임의 생성 금지). Risk ≠ Incident — Incident 는 0502 실측 참조입니다.`} />
        </div>
      )}

      {/* ── Register ── */}
      {tab === 'register' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {RISK_CATEGORIES.slice(0, 4).map((cat) => (
              <button key={cat} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createRiskRegisterEntry({ code: `risk_${cat}_${now.toISOString().slice(0, 19)}`, category: cat, title: r.slice(0, 100), evidence: [{ label: 'note', value: '사람 등록 Risk' }] }), `${cat} risk 등록(Incident 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{cat} 등록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Risk 제목/사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!risks.length ? <AdminEmpty title="Risk 없음" description="Risk 는 AI 가 자동 생성하지 않습니다 — 사람 등록만 기록됩니다(open/monitoring/mitigated/closed 4상태)." /> : risks.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.risk_code}</span>
                <AdminBadge tone="info">{r.risk_category}</AdminBadge>
                <AdminBadge tone={r.risk_status === 'open' ? 'danger' : r.risk_status === 'monitoring' ? 'warning' : r.risk_status === 'mitigated' ? 'info' : 'neutral'}>{r.risk_status}</AdminBadge>
                <span className="text-muted-foreground">{r.title} · L{r.likelihood_reference ?? '—'}/I{r.impact_reference ?? '—'} · Risk ≠ Incident</span>
              </div>
              {r.risk_status !== 'closed' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['monitoring', 'mitigated'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewRiskRegisterEntry(r.id, st, rr), `${st}(Recovery Plan ≠ Success)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewRiskRegisterEntry(r.id, 'closed', rr, [{ label: 'closure', value: rr }]), 'closed(사람 종결 — Evidence 기록)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">closed(Evidence 필수)</button>
                  {RISK_TIMELINE_STAGES.map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordRiskTimeline(r.id, st, rr), `${st} 기록(완료 보장 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">TL:{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Heatmap / Dependency / Timeline ── */}
      {tab === 'heatmap' && (
        !heats.length ? <AdminEmpty title="Heatmap 대상 없음" description="Risk 에 Likelihood/Impact(1~5)가 기록되면 Low/Medium/High/Critical 로 계산합니다 — Likelihood ≠ Reality." /> : (
          <div className="space-y-1">
            {heats.map(({ r, h }) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.risk_code}</span>
                {h.verdict === 'rated' ? (
                  <AdminBadge tone={h.heat === 'critical' ? 'danger' : h.heat === 'high' ? 'warning' : h.heat === 'medium' ? 'info' : 'success'}>{h.heat}</AdminBadge>
                ) : <AdminBadge tone="warning">risk_unverified</AdminBadge>}
                <span className="ml-2 text-muted-foreground">L{r.likelihood_reference ?? 'null'} × I{r.impact_reference ?? 'null'} = {h.score ?? 'null(0 아님)'} · Likelihood ≠ Reality</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'dependency' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="의존 Edge" value={NUM(dependency.edges.length)} />
            <Box label="독립 Risk" value={dependency.isolated.join(', ') || '없음'} />
            <Box label="순환 감지" value={dependency.cycles.join(' · ') || '없음'} />
          </div>
          {!dependency.edges.length ? <AdminEmpty title="의존 관계 없음" description="linked_risk_ids 로 Risk A→B→C 연결 관계를 분석합니다 — 인과를 확정하지 않습니다." /> : (
            <div className="space-y-1">
              {dependency.edges.slice(0, 30).map((e, i) => {
                const from = risks.find((r) => r.id === e.from); const to = risks.find((r) => r.id === e.to);
                return <div key={i} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono">{from?.risk_code ?? e.from}</span><span className="mx-2 text-muted-foreground">→</span><span className="font-mono">{to?.risk_code ?? e.to}</span><span className="ml-2 text-muted-foreground">연결 참조(인과 확정 아님)</span></div>;
              })}
            </div>
          )}
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-2">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.entries.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.entries.length ? s.entries.slice(0, 4).map((e) => `${e.at.slice(0, 16).replace('T', ' ')} ${e.note}`).join(' · ') : '기록 없음'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Detection→Investigation→Mitigation→Recovery→Review — stageCompletionGuarantee=false(기록이며 완료 보장 아님)</p>
        </div>
      )}

      {/* ── Continuity / Resilience / Controls / Recovery ── */}
      {tab === 'continuity' && (
        <div className="space-y-2">
          {continuity.segments.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.key}</span>
              <AdminBadge tone={s.status === 'measured_proxy' ? 'info' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.value == null ? 'null(원본 없음 — 0 아님)' : NUM(s.value)}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Playback Continuity Proxy {continuity.availabilityProxyPct ?? '—'}% · Continuity ≠ Zero Downtime · 서비스 자동 중단 없음</p>
        </div>
      )}
      {tab === 'resilience' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Overall(단독 해석 금지)" value={resilience.overall == null ? 'insufficient_data' : String(resilience.overall)} />
            <Box label="Missing Components" value={resilience.missingComponents.join(', ') || '없음'} />
            <Box label="Unknown" value={NUM(resilience.unknownFactors.length)} />
          </div>
          {resilience.byComponent.map((c) => (
            <div key={c.component} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.component}</span>
              <span className="ml-2">{c.score == null ? 'Evidence 없음 — 점수 제외' : c.score}</span>
              <span className="ml-2 text-muted-foreground">Evidence {c.evidenceCount}건</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'controls' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Coverage(Evidence 있는 Control)" value={controls.coveragePct == null ? 'insufficient_data' : `${controls.coveragePct}%`} />
            <Box label="Control 없는 Risk" value={controls.uncontrolledRisks.join(', ') || '없음'} />
            <Box label="미검증 Control" value={controls.unverifiedControls.join(', ') || '없음'} />
          </div>
          <AdminAlert tone="info" description="controlIsNotElimination=true — Control 은 Risk 를 줄이는 참조이며 제거를 보장하지 않습니다. Coverage 는 Evidence 있는 Control 만 계산합니다." />
        </div>
      )}
      {tab === 'recovery' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {recovery.components.map((c) => (
              <Box key={c.key} label={c.key} value={c.value == null ? 'null(원본 없음)' : NUM(c.value)} />
            ))}
          </div>
          <AdminAlert tone={recovery.verdict === 'readiness_candidate' ? 'info' : 'warning'} description={`판정: ${recovery.verdict} — Recovery Plan ≠ Recovery Success. Backup Readiness 는 백업 검증 로그 원본이 없어 null 로 유지됩니다. 검증 기록(recovery_readiness_evaluated)이 없으면 validation_unverified 입니다.`} />
          <button disabled={busy} onClick={() => {
            const r = needReason(); if (!r) return;
            void act(() => recordRiskGovernance('recovery_readiness_evaluated', r, { verdict: recovery.verdict, components: recovery.components }), 'Recovery 검증 기록(Plan ≠ Success)');
          }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Recovery 검증 기록</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검증 내용(필수)" className="ml-2 min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordRiskGovernance('risk_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Risk Briefing 기록</button>
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
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Operational Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['risk_registered', 'risk_reviewed', 'risk_mitigation_recorded', 'risk_closed'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Risk 등록/판정/종결은 전부 사람이 수행합니다(자동 종료 없음)." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_risk_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 리스크 자료는 참조로만 기록됩니다." /> : (
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
              void act(() => recordRiskGovernance('risk_heatmap_evaluated', r, { rated: heats.filter(({ h }) => h.verdict === 'rated').length, critical: heats.filter(({ h }) => h.heat === 'critical').length }), 'Heatmap 평가 기록(Likelihood ≠ Reality)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Heatmap 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="리스크 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
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
          {RISK_SUPPORT.map((s) => (
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
