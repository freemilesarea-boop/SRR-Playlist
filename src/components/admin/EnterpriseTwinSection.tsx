/**
 * EnterpriseTwinSection — Enterprise Digital Twin, Scenario Intelligence &
 * Future State Prediction Center (Phase AI-OPS-37).
 *
 * Current State→Digital Twin→Scenario Injection→Multi-Agent Simulation→Future Prediction→
 * Risk/Opportunity/Capacity Projection→Human Review→Comparison→Executive Recommendation→
 * Knowledge Reference.
 * Twin ≠ Production · Prediction ≠ Future Fact · Projection ≠ Observation ·
 * Scenario ≠ Reality · Confidence ≠ Correctness · Recommendation ≠ Decision.
 * Production/Runtime/Connector/Automation/Rollout/Deploy/발송/청구/인프라/권한/정책 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Camera, ClipboardList, DollarSign,
  FlaskConical, Grid3x3, History, Layers, Lightbulb, ListOrdered, Lock, RefreshCw,
  Scale, Search, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseTwinSummary, fetchEnterpriseStateSnapshots, captureEnterpriseStateSnapshot,
  fetchEnterpriseTwinScenarios, createEnterpriseTwinScenario, reviewEnterpriseTwinScenario,
  fetchEnterpriseTwinRuns, recordEnterpriseTwinRun, recordEnterpriseTwinEvent, fetchEnterpriseTwinAudit,
  type EnterpriseTwinSummary, type EnterpriseStateSnapshotRow, type EnterpriseTwinScenarioRow,
  type EnterpriseTwinRunRow, type EnterpriseTwinEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  TWIN_SCENARIO_TYPES, TWIN_LAYERS, TWIN_RECOMMENDATION_TYPES,
  evaluateTwinCoverage, buildTwinTimeline, TWIN_COMPONENTS, ENTERPRISE_TWIN_SUPPORT,
} from '@/lib/enterpriseTwin';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'currentstate' | 'twin' | 'library' | 'builder' | 'prediction' | 'risk' | 'capacity'
  | 'cost' | 'queue' | 'incident' | 'comparison' | 'recommendation' | 'confidence' | 'timeline'
  | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'currentstate', label: 'Current State', icon: Camera },
  { key: 'twin', label: 'Digital Twin', icon: Layers },
  { key: 'library', label: 'Scenario Library', icon: BookOpen },
  { key: 'builder', label: 'Scenario Builder', icon: FlaskConical },
  { key: 'prediction', label: 'Future Prediction', icon: TrendingUp },
  { key: 'risk', label: 'Risk Projection', icon: AlertTriangle },
  { key: 'capacity', label: 'Capacity Projection', icon: Activity },
  { key: 'cost', label: 'Cost Projection', icon: DollarSign },
  { key: 'queue', label: 'Queue Projection', icon: ListOrdered },
  { key: 'incident', label: 'Incident Projection', icon: AlertTriangle },
  { key: 'comparison', label: 'Scenario Comparison', icon: Scale },
  { key: 'recommendation', label: 'Executive Recommendation', icon: Lightbulb },
  { key: 'confidence', label: 'Confidence', icon: Search },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Digital Twin ≠ Production — Twin 은 읽기 전용 count 복제 Reference 이며 어떤 원본도 변경하지 않습니다',
  'Prediction ≠ Future Fact — 예측은 선형 추정 참고치이며 prediction_unverified/confidence/limitations/assumptions 을 항상 동반 기록합니다',
  'Counterfactual/시뮬레이션 모델 엔진 없음 — Multi-Agent Simulation 은 Reference 모드만(실제 Agent 실행 없음)',
  'GPU 비용 피드 없음 — Cost Spike 는 partially_supported·cost_model_missing 유지(임의 추정 금지)',
  'Region 장애/Provider 상태/휴가 캘린더 피드 없음 — 해당 시나리오는 partially_supported 명시',
  '범용 Queue/Worker 없음 — Queue Projection 은 승인 대기 counts proxy 만',
  '부하 테스트 인프라 없음 — Throughput/Latency 는 선형 추정 Reference(Confidence 상한 강제)',
  '자동 실행/자동 승자 선택/자동 Knowledge Graph 변형 없음 — 모든 결정은 사람',
  'Migration 0472~0540 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

export default function EnterpriseTwinSection() {
  const [tab, setTab] = useState<Tab>('currentstate');
  const [summary, setSummary] = useState<EnterpriseTwinSummary>({});
  const [snapshots, setSnapshots] = useState<EnterpriseStateSnapshotRow[]>([]);
  const [scenarios, setScenarios] = useState<EnterpriseTwinScenarioRow[]>([]);
  const [runs, setRuns] = useState<EnterpriseTwinRunRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseTwinEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selSnap, setSelSnap] = useState('');
  const [selScn, setSelScn] = useState('');
  const [selRun, setSelRun] = useState('');
  const [selRun2, setSelRun2] = useState('');
  const [scnType, setScnType] = useState<string>('connector_timeout');
  const [recType, setRecType] = useState<string>('lowest_risk_candidate');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sn, sc, ru, au] = await Promise.all([
        fetchEnterpriseTwinSummary(), fetchEnterpriseStateSnapshots(null, 200), fetchEnterpriseTwinScenarios(null, 200),
        fetchEnterpriseTwinRuns(null, 200), fetchEnterpriseTwinAudit(200),
      ]);
      setSummary(s); setSnapshots(sn); setScenarios(sc); setRuns(ru); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const needScn = (): EnterpriseTwinScenarioRow | null => {
    const s = scenarios.find((x) => x.id === selScn);
    if (!s) { toast.error('Scenario 선택 필수'); return null; }
    return s;
  };
  const needSnap = (): EnterpriseStateSnapshotRow | null => {
    const s = snapshots.find((x) => x.id === selSnap);
    if (!s) { toast.error('Snapshot 선택 필수'); return null; }
    return s;
  };
  const scnReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const s = needScn();
    if (!r || !s) return;
    void act(() => reviewEnterpriseTwinScenario(s.id, action, r, payload), ok);
  };
  const twinEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { snap?: boolean; scn?: boolean; run?: boolean } = {}) => {
    const r = needReason();
    if (!r) return;
    const runRow = ids.run ? runs.find((x) => x.id === selRun) ?? null : null;
    if (ids.run && !runRow) { toast.error('Run 선택 필수'); return; }
    void act(() => recordEnterpriseTwinEvent(kind, r, payload, ids.snap ? (selSnap || null) : null, ids.scn ? (selScn || null) : null, runRow?.id ?? null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const latestSnap = snapshots[0] ?? null;
  const coverage = useMemo(() => evaluateTwinCoverage((TWIN_LAYERS as readonly string[]).map((layer) => {
    if (!latestSnap) return { layer, sourceAvailable: null, entityCount: null };
    const src: Record<string, Record<string, unknown>> = {
      runtime_twin: latestSnap.runtime_state, governance_twin: latestSnap.policy_state, connector_twin: latestSnap.connector_state,
      agent_twin: latestSnap.agent_state, decision_twin: latestSnap.decision_state, resource_twin: latestSnap.capacity_state,
      queue_twin: latestSnap.approval_state, policy_twin: latestSnap.policy_state,
    };
    const vals = Object.values(src[layer] ?? {}).filter((v): v is number => typeof v === 'number');
    return { layer, sourceAvailable: vals.length > 0, entityCount: vals.length ? vals.reduce((a, b) => a + b, 0) : null };
  })), [latestSnap]);

  const timeline = useMemo(() => buildTwinTimeline([
    { stage: 'snapshot', count: num('snapshots', 'total'), source: 'snapshots 실측' },
    { stage: 'twin_graph', count: audit.filter((e) => e.event_type === 'twin_graph_built_reference').length, source: 'events 실측' },
    { stage: 'scenario', count: num('scenarios', 'total'), source: 'scenarios 실측' },
    { stage: 'injection', count: audit.filter((e) => e.event_type === 'scenario_injection_recorded_reference').length, source: 'events 실측' },
    { stage: 'prediction', count: num('runs', 'total'), source: 'runs 실측' },
    { stage: 'projection_review', count: audit.filter((e) => e.event_type.endsWith('projection_reviewed')).length, source: 'events 실측' },
    { stage: 'comparison', count: num('twin_events', 'comparisons'), source: 'events 실측' },
    { stage: 'recommendation', count: num('twin_events', 'recommendations'), source: 'events 실측' },
    { stage: 'human_review', count: num('twin_events', 'human_reviews'), source: 'events 실측' },
  ]), [num, audit]);

  if (loading) return <AdminCard title="Enterprise Digital Twin & Future State Prediction"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Digital Twin & Future State Prediction">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const snapSelect = (
    <select value={selSnap} onChange={(e) => setSelSnap(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Snapshot 선택</option>
      {snapshots.map((s) => <option key={s.id} value={s.id}>{s.snapshot_code} · {s.snapshot_status}</option>)}
    </select>
  );
  const scnSelect = (
    <select value={selScn} onChange={(e) => setSelScn(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Scenario 선택</option>
      {scenarios.map((s) => <option key={s.id} value={s.id}>{s.scenario_code} · {s.scenario_type} · {s.scenario_status}</option>)}
    </select>
  );
  const runSelect = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">{label}</option>
      {runs.map((r) => <option key={r.id} value={r.id}>{r.run_code} · {r.run_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('captured') || s.includes('completed') || s.includes('modeled') || s === 'supported_reference' ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('failed') || s === 'unsupported' ? 'danger' as const : s.includes('pending') || s.includes('unverified') || s.includes('missing') || s.includes('partial') || s.includes('candidate') || s === 'draft' ? 'warning' as const : 'neutral' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseTwinEventRow[], emptyTitle: string, emptyDesc: string) => (
    !rows.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {rows.slice(0, 30).map((e) => (
          <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(String(e.payload?.result ?? e.event_type))}>{e.event_type}</AdminBadge>
            <span className="ml-2">{e.detail}</span>
            <span className="ml-2 text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const projectionTab = (kind: string, title: string, note: string) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {runSelect(selRun, setSelRun, 'Run 선택')}
        {reasonInput}
        {btn(`${title} 검토 기록`, () => twinEvent(kind, { note: 'projection_is_not_observation' }, `${title} 검토 기록됨`, { run: true }), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 검토 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Enterprise Digital Twin & Future State Prediction"
      subtitle="Current State→Digital Twin→Scenario Injection→Future Prediction→Risk/Capacity/Cost/Queue/Incident Projection→Comparison→Executive Recommendation — Twin ≠ Production·자동 실행 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Digital Twin 은 Production 과 완전히 분리된 읽기 전용 복제 Reference 입니다. 실제 Production/Runtime/Connector/Automation/Rollout/Deploy/Merge/Migration/Notification/비용 청구/인프라/권한/정책 변경은 수행하지 않습니다. Twin ≠ Production, Prediction ≠ Future Fact, Projection ≠ Observation, Scenario ≠ Reality, Confidence ≠ Correctness, Correlation ≠ Causality, Simulation ≠ Execution, Recommendation ≠ Decision. 실행하지 않은 Scenario 를 Completed 로 표시하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'currentstate' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {btn('Enterprise State Snapshot 캡처(읽기 전용)', () => void act(() => captureEnterpriseStateSnapshot({}), 'Snapshot 캡처됨(원본 미변경·Live 상태 아님)'), true)}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Franchises(0349)" value={NUM(num('twin_actuals', 'franchises_0349'))} />
            <Box label="Regions(0349)" value={NUM(num('twin_actuals', 'regions_0349'))} />
            <Box label="Stores(0349)" value={NUM(num('twin_actuals', 'stores_0349'))} />
            <Box label="Active Agents(0497)" value={NUM(num('twin_actuals', 'agents_active_0497'))} />
            <Box label="Connector Definitions(0536)" value={NUM(num('twin_actuals', 'connector_definitions_0536'))} />
            <Box label="Connector Instances(0536)" value={NUM(num('twin_actuals', 'connector_instances_0536'))} />
            <Box label="Runtime Sessions(0536)" value={NUM(num('twin_actuals', 'runtime_sessions_0536'))} />
            <Box label="Policy Versions(0512)" value={NUM(num('twin_actuals', 'policy_versions_0512'))} />
            <Box label="Incidents(0502)" value={NUM(num('twin_actuals', 'incidents_0502'))} />
            <Box label="Incident Candidates(0537)" value={NUM(num('twin_actuals', 'incident_candidates_0537'))} />
            <Box label="Knowledge Entities(0513)" value={NUM(num('twin_actuals', 'knowledge_entities_0513'))} />
            <Box label="Pending Approvals(0535+0539)" value={NUM(num('twin_actuals', 'pending_approvals_0535_0539'))} />
          </div>
          {!snapshots.length ? <AdminEmpty title="Snapshot 없음" description="캡처는 실제 테이블의 read-only count 집계만 수행합니다." /> : (
            <div className="space-y-1">
              {snapshots.slice(0, 20).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(s.snapshot_status)}>{s.snapshot_status}</AdminBadge>
                  <span className="ml-2 font-bold">{s.snapshot_code}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(s.captured_at).toLocaleString('ko-KR')} · 소스 {s.source_coverage.length}/11 · 결측 {s.missing_sources.length}종(피드 부재)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'twin' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {snapSelect}{reasonInput}
            {btn('Twin Graph 구축 기록', () => {
              if (!selSnap) { toast.error('Snapshot 선택 필수'); return; }
              twinEvent('twin_graph_built_reference', { layers: TWIN_LAYERS }, 'Twin Graph Reference 기록(Production 아님)', { snap: true });
            }, true)}
          </div>
          <AdminAlert tone="info" description="Twin 8계층은 원본 실존 소스에서만 복제 Reference 를 만듭니다 — 원본 없는 계층은 source_missing 으로 유지(임의 모델링 없음). Queue Twin 은 승인 대기 counts proxy 입니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {coverage.rows.map((r) => (
              <div key={r.layer} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{r.layer}</p>
                <AdminBadge tone={tone(r.result)}>{r.result}</AdminBadge>
              </div>
            ))}
          </div>
          {eventList(evByType('twin_graph_built_reference'), 'Twin Graph 기록 없음', 'Snapshot 기반 복제 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'library' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scnSelect}{reasonInput}
            {btn('검토 시작', () => scnReview('start_review', {}, '검토 시작'))}
            {btn('Evidence 요청', () => scnReview('request_evidence', {}, 'Evidence 요청'))}
            {btn('Twin 승인(Evidence)', () => scnReview('approve_for_twin', { evidence: [reason.trim()] }, 'Twin 주입 승인(실행 아님)'), true)}
            {btn('차단', () => scnReview('block', {}, 'blocked_reference'))}
            {btn('반려', () => scnReview('reject', {}, '반려'))}
            {btn('무효화', () => scnReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="초기 Library 17종 + custom. support 는 실측 판정 — Provider Down/Queue Explosion/Region Failure/Resource Shortage/Human Absence/Cost Spike 는 원본 피드 부재로 partially_supported 입니다. Scenario ≠ Reality." />
          {!scenarios.length ? <AdminEmpty title="Scenario 없음" description="Scenario Builder 에서 생성하세요 — 자동 실행 없음." /> : (
            <div className="space-y-1">
              {scenarios.slice(0, 30).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(s.scenario_status)}>{s.scenario_status}</AdminBadge>
                    <AdminBadge tone={tone(s.support_status)}>{s.support_status}</AdminBadge>
                    <span className="font-bold">{s.scenario_code}</span>
                    <span className="text-muted-foreground">{s.scenario_type} · horizon {NUM(s.horizon_days)}일</span>
                  </div>
                  <p className="mt-1">{s.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'builder' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={scnType} onChange={(e) => setScnType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TWIN_SCENARIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Scenario 생성(실행 아님)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseTwinScenario({ scenario_type: scnType, title: r, horizon_days: 30 }), 'Scenario 생성됨(draft — Scenario ≠ Reality)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Builder 는 주입 파라미터 정의만 수행합니다. 예: Connector 장애/승인자 부재/Agent 20개 확장/매장 10배/Incident 급증/Policy 5개 동시 적용/신규 Provider/GPU 비용 2배/Region 장애 — 전부 Twin 내부 분석 대상이며 실제 운영에 영향 없음. horizon 기본 30일." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {TWIN_SCENARIO_TYPES.map((t) => (
              <div key={t} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{t}</span>
                <span className="ml-2 text-muted-foreground">{scenarios.filter((s) => s.scenario_type === t).length}건 정의됨</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'prediction' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {snapSelect}{scnSelect}{reasonInput}
            {btn('Run 기록(draft — 미실행)', () => {
              const r = needReason(); const sn = needSnap(); const sc = needScn();
              if (!r || !sn || !sc) return;
              void act(() => recordEnterpriseTwinRun({ snapshot_id: sn.id, scenario_id: sc.id, run_status: 'draft', limitations: [r] }), 'Run draft 기록(미실행 — completed 아님)');
            })}
            {btn('완료 기록(Evidence 필수)', () => {
              const r = needReason(); const sn = needSnap(); const sc = needScn();
              if (!r || !sn || !sc) return;
              void act(() => recordEnterpriseTwinRun({ snapshot_id: sn.id, scenario_id: sc.id, run_status: 'completed_reference', evidence: [r], started_at: new Date().toISOString(), completed_at: new Date().toISOString() }), 'completed_reference 기록(Prediction ≠ Future Fact)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Run 은 Scenario 가 approved_for_twin_reference 상태여야 기록 가능합니다. 실행하지 않은 Run 을 completed 로 표시하는 것은 서버가 차단합니다(Evidence+started_at 필수). 예측은 항상 prediction_unverified/confidence/limitations/assumptions 과 함께 기록됩니다." />
          {!runs.length ? <AdminEmpty title="Twin Run 없음" description="승인된 Scenario + Snapshot 에 대해서만 기록 가능합니다." /> : (
            <div className="space-y-1">
              {runs.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(r.run_status)}>{r.run_status}</AdminBadge>
                  <span className="ml-2 font-bold">{r.run_code}</span>
                  <span className="ml-2 text-muted-foreground">{r.simulation_mode} · confidence {NUM(r.confidence)} · unknown {r.unknown_factors.length}건 유지</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'risk' && projectionTab('risk_projection_reviewed', 'Risk Projection', 'Risk 는 후보입니다 — Risk ≠ Fact. Recovery 이력 없으면 recovery_unverified 유지. 자동 대응 없음.')}
      {tab === 'capacity' && projectionTab('capacity_projection_reviewed', 'Capacity Projection', 'Capacity 는 추정입니다 — Estimate ≠ Guarantee. 부하 테스트 인프라 없음(선형 추정 Reference).')}
      {tab === 'cost' && projectionTab('cost_projection_reviewed', 'Cost Projection', '비용 모델(0508) 있을 때만 추정 — GPU 비용 피드 없음(cost_model_missing 유지). 실제 청구 없음.')}
      {tab === 'queue' && projectionTab('queue_projection_reviewed', 'Queue Projection', '범용 Queue/Worker 없음 — 승인 대기 counts proxy. Reviewer 0명이면 queue_unbounded 후보.')}
      {tab === 'incident' && projectionTab('incident_projection_reviewed', 'Incident Projection', '표본 부족 시 sample_too_small 유지(재정규화 없음). Correlation ≠ Causality.')}

      {tab === 'comparison' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run A 선택')}
            {runSelect(selRun2, setSelRun2, 'Run B 선택')}
            {reasonInput}
            {btn('Comparison 기록', () => {
              if (!selRun || !selRun2 || selRun === selRun2) { toast.error('서로 다른 Run 2개 필수'); return; }
              twinEvent('scenario_comparison_recorded', { run_ids: [selRun, selRun2] }, 'Comparison 기록됨(자동 승자 선택 없음)', { run: true });
            }, true)}
          </div>
          <AdminAlert tone="info" description="비교 8차원(Risk/Cost/Capacity/Human Workload/Approval Delay/Incident Probability/Recovery Difficulty/Confidence). 결측 차원은 dimension_unverified 로 유지하며 자동 승자를 선택하지 않습니다." />
          {eventList(evByType('scenario_comparison_recorded'), 'Comparison 없음', 'Run 2개 이상 비교 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}
            <select value={recType} onChange={(e) => setRecType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TWIN_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence)', () => twinEvent('executive_twin_recommendation_recorded', { recommendation: recType, evidence: [reason.trim()] }, 'Recommendation 기록(Recommendation ≠ Decision)', { run: true }), true)}
            {btn('Human Review 요청', () => twinEvent('human_review_requested', { note: 'human_decision_required' }, 'Human Review 요청됨', { run: true }))}
            {btn('Knowledge Reference 기록', () => twinEvent('knowledge_reference_recorded', { target: 'ai_knowledge_entities_0513', evidence: [reason.trim()] }, 'Knowledge Reference 기록(자동 변형 없음)', { run: true }))}
          </div>
          <AdminAlert tone="info" description="추천은 Best Option/Lowest Risk/Lowest Cost/Highest Capacity/Human Approval 후보 제안만 — Recommendation ≠ Decision. 실행은 하지 않습니다." />
          {eventList([...evByType('executive_twin_recommendation_recorded'), ...evByType('human_review_requested'), ...evByType('knowledge_reference_recorded')], 'Recommendation 없음', 'Evidence 기반 후보 제안이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'confidence' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Confidence ≠ Correctness. 표본 부족(상한 30)·장기 horizon(>90일 상한 40)·미검증 가정(건당 -10)은 상한/감점이 강제됩니다. Unknown Factor 는 유지됩니다(null→0 금지)." />
          {!runs.length ? <AdminEmpty title="Confidence 데이터 없음" description="Twin Run 기록 후 표시됩니다." /> : (
            <div className="space-y-1">
              {runs.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.run_code}</span>
                  <span className="ml-2">confidence {NUM(r.confidence)}</span>
                  <span className="ml-2 text-muted-foreground">assumptions {r.assumptions.length} · unknown_factors {r.unknown_factors.length} · limitations {r.limitations.length}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="측정 카운트 요약 — 완료 주장이 아닙니다. Unknown 은 insufficient_data 로 유지합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.status === 'measured' ? NUM(s.count) : 'insufficient_data'}</p>
                <p className="text-[10px] text-muted-foreground">{s.source}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '21종 Twin 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`실측 구성요소 — twin_unavailable: ${Array.isArray(summary.twin_unavailable) ? (summary.twin_unavailable as unknown[]).map(String).join(', ') : '—'}`} />
          <div className="space-y-1">
            {TWIN_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'warning'}>{c.available === true ? 'available' : c.available === false ? 'unavailable' : 'unverified'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
                <span className="ml-2 text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {ENTERPRISE_TWIN_SUPPORT.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.status === 'supported' ? 'success' : 'danger'}>{s.status}</AdminBadge>
                <span className="ml-2 font-bold">{s.key}</span>
                <span className="ml-2 text-muted-foreground">{s.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">limitation</AdminBadge>
              <span className="ml-2">{l}</span>
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
