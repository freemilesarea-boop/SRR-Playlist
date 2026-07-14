/**
 * SelfHealingSection — Self-Healing AI Music OS & Resilience Intelligence (Phase AI-MUSIC-15).
 *
 * 실측 Telemetry 로 장애 감지 → RCA(상관 후보) → 복구 전략 제안 → Digital Twin 검증(게이트)
 * → Risk Assessment → Governance 승인용 Recovery Candidate. **자동 Production 복구/Rollback/
 * 실행 없음 — Evidence Only.** Twin 검증 실패 시 Governance 제출 금지(서버 게이트).
 *
 * 탭: Incident Overview · Active Incidents · Root Cause · Recovery Candidates · Twin Validation ·
 *     Risk Assessment · Recovery Knowledge · Playbooks · Timeline · Self-Healing Score ·
 *     Governance Evidence · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Siren, SearchCode, Wrench, FlaskConical, Gauge, BookOpen, ListOrdered,
  HeartPulse, Scale, Grid3x3, Lock, RefreshCw, ScanLine,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchSelfHealingSummary, fetchIncidentScan, saveIncident, fetchIncidents, fetchIncidentDetail,
  updateIncidentStatus, saveRecoveryCandidate, fetchRecoveryCandidates, linkRecoveryTwin,
  setRecoveryStatus, savePlaybook, fetchPlaybooks, fetchTwinSimulationRuns, fetchGovernanceSummary,
  type SelfHealingSummaryResp, type IncidentScanResp, type IncidentRow, type RecoveryCandidateRow,
  type PlaybookRow, type TwinSimRunRow, type GovernanceSummaryResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SELF_HEALING_SOURCE_VERSION, INCIDENT_TYPES, HEAL_SUPPORT,
  detectIncidents, analyzeRootCause, generateRecoveryStrategies, canSubmitToGovernance,
  assessRecoveryRisk, knowledgeSuccessRate, derivePlaybook, calculateSelfHealingScore, selfHealingInputHash,
  SEVERITY_TONE, INCIDENT_STATUS_LABEL, INCIDENT_STATUS_TONE, VALIDATION_LABEL, VALIDATION_TONE, STRATEGY_LABEL,
  type IncidentSeverity, type ValidationStatus, type RecoveryStrategy, type IncidentType, type DetectedIncident,
} from '@/lib/selfHealing';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'active' | 'rootcause' | 'candidates' | 'twin' | 'risk' | 'knowledge' | 'playbooks'
  | 'timeline' | 'score' | 'governance' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'overview', label: 'Incident Overview', icon: Activity },
  { key: 'active', label: 'Active Incidents', icon: Siren },
  { key: 'rootcause', label: 'Root Cause', icon: SearchCode },
  { key: 'candidates', label: 'Recovery Candidates', icon: Wrench },
  { key: 'twin', label: 'Twin Validation', icon: FlaskConical },
  { key: 'risk', label: 'Risk Assessment', icon: Gauge },
  { key: 'knowledge', label: 'Recovery Knowledge', icon: BookOpen },
  { key: 'playbooks', label: 'Playbooks', icon: ListOrdered },
  { key: 'timeline', label: 'Timeline', icon: ListOrdered },
  { key: 'score', label: 'Self-Healing Score', icon: HeartPulse },
  { key: 'governance', label: 'Governance Evidence', icon: Scale },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function SelfHealingSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<SelfHealingSummaryResp | null>(null);
  const [scan, setScan] = useState<IncidentScanResp | null>(null);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [selIncident, setSelIncident] = useState<IncidentRow | null>(null);
  const [candidates, setCandidates] = useState<RecoveryCandidateRow[]>([]);
  const [allCandidates, setAllCandidates] = useState<RecoveryCandidateRow[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [twinRuns, setTwinRuns] = useState<TwinSimRunRow[]>([]);
  const [gov, setGov] = useState<GovernanceSummaryResp | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sc, inc, ac, pb, tr, gs] = await Promise.all([
        fetchSelfHealingSummary(), fetchIncidentScan('7d'), fetchIncidents(null, null, 100),
        fetchRecoveryCandidates(null, null, 100), fetchPlaybooks(null, null, 100),
        fetchTwinSimulationRuns(null, 'completed', 50).catch(() => [] as TwinSimRunRow[]),
        fetchGovernanceSummary().catch(() => null),
      ]);
      setSummary(s); setScan(sc); setIncidents(inc); setAllCandidates(ac); setPlaybooks(pb); setTwinRuns(tr); setGov(gs);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 실측 telemetry 기반 감지(클라이언트 결정적 판정 — 저장은 명시적).
  const detected = useMemo<DetectedIncident[]>(() => {
    if (!scan?.global) return [];
    const g = scan.global;
    const global = detectIncidents({
      prevEvents: g.prev_events, currEvents: g.curr_events,
      prevErrorRate: g.prev_error_rate, currErrorRate: g.curr_error_rate,
      prevSkipRate: g.prev_skip_rate, currSkipRate: g.curr_skip_rate,
      prevCompletion: g.prev_completion, currCompletion: g.curr_completion,
    }, 'global', null);
    const byIndustry = (scan.by_industry ?? []).flatMap((r) => detectIncidents({
      prevEvents: num(r.prev_events), currEvents: num(r.curr_events),
      prevErrorRate: num(r.prev_error_rate), currErrorRate: num(r.curr_error_rate),
      prevSkipRate: num(r.prev_skip_rate), currSkipRate: num(r.curr_skip_rate),
      prevCompletion: null, currCompletion: null,
    }, 'industry', String(r.store_type ?? '')));
    return [...global, ...byIndustry];
  }, [scan]);

  const persistIncident = async (d: DetectedIncident) => {
    setBusy(true);
    try {
      const hash = selfHealingInputHash([d.incidentType, d.scope, d.scopeKey, JSON.stringify(d.kpi)]);
      const res = await saveIncident({
        incident_code: `inc_${d.incidentType}_${hash.slice(5)}`, incident_type: d.incidentType, severity: d.severity,
        scope: d.scope, scope_key: d.scopeKey, kpi_snapshot: d.kpi, baseline_snapshot: d.baseline,
        root_cause_candidates: analyzeRootCause(d), evidence: d.evidence, limitations: d.limitations,
        source_version: SELF_HEALING_SOURCE_VERSION, input_hash: hash,
      });
      toast.success(res.idempotent ? '이미 기록된 Incident(중복 방지)' : 'Incident 기록됨(자동 복구 없음)');
      setIncidents(await fetchIncidents(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const openIncident = async (i: IncidentRow) => {
    setSelIncident(i); setBusy(true);
    try { const d = await fetchIncidentDetail(i.id); if (d.found && d.incident) { setSelIncident(d.incident); setCandidates(d.candidates); } }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const proposeRecoveries = async () => {
    if (!selIncident) return;
    const causes = (selIncident.root_cause_candidates as Array<{ cause: string; confidence: number }>).map((c) => ({ cause: c.cause, confidence: c.confidence, chain: [], note: '' }));
    const proposals = generateRecoveryStrategies(causes);
    if (!proposals.length) { toast.error('제안 가능한 전략 없음(insufficient_data)'); return; }
    setBusy(true);
    try {
      for (const p of proposals) {
        const hash = selfHealingInputHash([selIncident.id, p.strategyType]);
        const risk = assessRecoveryRisk({
          knowledgeSuccessRate: knowledgeSuccessRate(
            allCandidates.map((c) => ({ strategyType: c.strategy_type, incidentType: selIncident.incident_type, outcome: c.outcome as 'pending' | 'succeeded' | 'failed' | 'not_applied' })),
            p.strategyType, selIncident.incident_type),
          twinConfidence: null, blastRadius: selIncident.scope === 'global' ? 'fleet' : 'industry',
        });
        await saveRecoveryCandidate({
          recovery_code: `rec_${p.strategyType}_${hash.slice(5)}`, incident_id: selIncident.id, strategy_type: p.strategyType,
          description: p.description, preconditions: p.preconditions,
          success_probability: risk.successProbability, blast_radius: selIncident.scope === 'global' ? 'fleet' : 'industry',
          business_impact: risk.businessImpact, confidence: risk.confidence,
          evidence: [{ label: 'incident', value: selIncident.incident_code }, { label: 'strategy', value: p.strategyType }],
          limitations: p.limitations, source_version: SELF_HEALING_SOURCE_VERSION, input_hash: hash,
        }).catch(() => undefined);
      }
      toast.success(`${proposals.length}개 복구 전략 제안 저장(자동 실행 없음)`);
      const d = await fetchIncidentDetail(selIncident.id); setCandidates(d.candidates);
      setAllCandidates(await fetchRecoveryCandidates(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const linkTwin = async (c: RecoveryCandidateRow, passed: boolean) => {
    if (!twinRuns.length) { toast.error('완료된 Twin Run 없음 — Digital Twin Lab 에서 먼저 검증하세요.'); return; }
    setBusy(true);
    try {
      await linkRecoveryTwin(c.id, twinRuns[0].id, passed, passed ? 'Twin 시뮬레이션 통과' : 'Twin 시뮬레이션 실패');
      toast.success(passed ? 'Twin 검증 통과 기록' : 'Twin 검증 실패 기록(Governance 제출 차단)');
      if (selIncident) { const d = await fetchIncidentDetail(selIncident.id); setCandidates(d.candidates); }
      setAllCandidates(await fetchRecoveryCandidates(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const submitGovernance = async (c: RecoveryCandidateRow) => {
    const gate = canSubmitToGovernance(c.validation_status as ValidationStatus);
    if (!gate.allowed) { toast.error(gate.reason); return; }
    setBusy(true);
    try {
      await setRecoveryStatus(c.id, 'governance_review', 'Twin 검증 통과 — Governance Review 요청');
      toast.success('Governance Review 제출(사람 승인 대기)');
      setAllCandidates(await fetchRecoveryCandidates(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const createPlaybook = async () => {
    if (!selIncident) { toast.error('Incident 를 먼저 선택하세요.'); return; }
    const causes = (selIncident.root_cause_candidates as Array<{ cause: string; confidence: number }>).map((c) => ({ cause: c.cause, confidence: c.confidence, chain: [], note: '' }));
    const pb = derivePlaybook(selIncident.incident_type as IncidentType, generateRecoveryStrategies(causes), 1);
    if (!pb) { toast.error('Playbook 파생 불가(전략 없음)'); return; }
    setBusy(true);
    try {
      const hash = selfHealingInputHash([pb.playbookCode, pb.steps.length]);
      const res = await savePlaybook({
        playbook_code: pb.playbookCode, incident_type: pb.incidentType, title: pb.title, steps: pb.steps,
        source_incident_ids: [selIncident.id], evidence: pb.evidence,
        source_version: SELF_HEALING_SOURCE_VERSION, input_hash: hash,
      });
      toast.success(res.idempotent ? '동일 Playbook 존재' : 'Playbook 저장(사람 실행용 참고 절차)');
      setPlaybooks(await fetchPlaybooks(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const inc = summary?.incidents ?? null; const rec = summary?.recovery ?? null;
  const score = useMemo(() => calculateSelfHealingScore({
    detectionSpeedScore: null,
    rcaAccuracy: null,
    recoveryAccuracy: rec && (Number(rec.succeeded) + Number(rec.failed)) >= 2 ? Math.round((Number(rec.succeeded) / (Number(rec.succeeded) + Number(rec.failed))) * 100) : null,
    falsePositiveRate: inc && Number(inc.total) > 0 ? Math.round((Number(inc.false_positive) / Number(inc.total)) * 100) : null,
    mttrHours: inc?.avg_resolution_hours != null ? Number(inc.avg_resolution_hours) : null,
  }), [inc, rec]);

  if (loading) return <AdminCard title="AI Self-Healing Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Self-Healing Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Self-Healing Center"
      subtitle="장애 감지 → RCA → Twin 검증 → Governance 복구안 (자동 복구 없음 · Evidence Only)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="AI 는 장애 감지·원인 분석·복구 전략 제안·Twin 검증까지만 수행합니다. 자동 Recovery/Rollback/Migration 실행/Production Apply/Queue·Playback·Scheduler 변경은 없으며, Twin 검증 실패 시 Governance 제출이 서버 게이트로 차단됩니다. 모든 복구는 사람 승인 후 수동 실행입니다." />
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
            <Box label="Total Incidents" value={NUM(inc?.total)} />
            <Box label="Active" value={NUM(inc?.active)} />
            <Box label="Resolved" value={NUM(inc?.resolved)} />
            <Box label="False Positive" value={NUM(inc?.false_positive)} />
            <Box label="Critical" value={NUM(inc?.critical)} />
            <Box label="Recovery Candidates" value={NUM(rec?.total)} />
            <Box label="Twin 통과/실패" value={`${NUM(rec?.twin_validated)} / ${NUM(rec?.twin_failed)}`} />
            <Box label="Playbooks" value={NUM(summary?.playbooks)} />
          </div>
          <AdminCard title="실시간 감지(실측 telemetry — 최근 7일 반기 비교)">
            {!detected.length ? <AdminEmpty icon={<ScanLine size={20} />} title="감지된 이상 없음" description="이전 구간 대비 유의한 악화가 없거나 데이터가 부족합니다(가짜 장애 생성 없음)." /> : (
              <div className="space-y-1.5">
                {detected.map((d, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone={SEVERITY_TONE[d.severity as IncidentSeverity]}>{d.severity}</AdminBadge>
                    <AdminBadge tone="neutral">{d.incidentType}</AdminBadge>
                    <span className="font-semibold">{d.scope === 'industry' ? `[${d.scopeKey}] ` : ''}{d.summary}</span>
                    <button disabled={busy} onClick={() => void persistIncident(d)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Incident 기록</button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </div>
      )}

      {/* ── Active Incidents ── */}
      {tab === 'active' && (
        <div className="space-y-2">
          {!incidents.length ? <AdminEmpty icon={<Siren size={20} />} title="Incident 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Incident</th><th className="px-2">Type</th><th className="px-2">Severity</th><th className="px-2">Scope</th><th className="px-2">Status</th><th className="px-2">감지</th><th className="px-2" /></tr></thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><code className="text-[10px]">{i.incident_code.slice(0, 24)}</code></td>
                      <td className="px-2 text-[10px]">{i.incident_type}</td>
                      <td className="px-2"><AdminBadge tone={SEVERITY_TONE[i.severity as IncidentSeverity]}>{i.severity}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{i.scope}{i.scope_key ? `:${i.scope_key}` : ''}</td>
                      <td className="px-2"><AdminBadge tone={INCIDENT_STATUS_TONE[i.status] ?? 'neutral'}>{INCIDENT_STATUS_LABEL[i.status] ?? i.status}</AdminBadge></td>
                      <td className="px-2 text-[10px] text-muted-foreground">{i.detected_at.slice(0, 16)}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => void openIncident(i)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">상세</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selIncident && (
            <AdminCard title={`Incident — ${selIncident.incident_code}`} action={<button onClick={() => setSelIncident(null)} className="text-[11px] font-bold underline">닫기</button>}>
              <div className="flex flex-wrap gap-1.5">
                <button disabled={busy} onClick={() => void proposeRecoveries()} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">복구 전략 제안(자동 실행 없음)</button>
                <button disabled={busy} onClick={() => void createPlaybook()} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">Playbook 파생</button>
                <button disabled={busy} onClick={() => { void updateIncidentStatus(selIncident.id, 'false_positive', '오탐 판정(사람)').then(() => load()); }} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">False Positive</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                <Box label="KPI" value={JSON.stringify(selIncident.kpi_snapshot).slice(0, 40)} />
                <Box label="Baseline" value={JSON.stringify(selIncident.baseline_snapshot ?? {}).slice(0, 40)} />
                <Box label="RCA 후보" value={`${(selIncident.root_cause_candidates ?? []).length}개`} />
                <Box label="복구 후보" value={`${candidates.length}개`} />
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Root Cause ── */}
      {tab === 'rootcause' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Root Cause Analysis (상관 기반 후보 — 단정 아님)" description="예: Playback Failure → Error 증가 → CDN 응답 저하 가능성. CDN/Buffer telemetry 미수집으로 확정 불가한 원인은 후보와 한계를 함께 표시합니다." />
          {!selIncident ? <AdminEmpty icon={<SearchCode size={20} />} title="Incident 선택 필요" description="Active Incidents 탭에서 상세를 여세요." /> : (
            <div className="space-y-1.5">
              {(selIncident.root_cause_candidates as Array<{ cause: string; confidence: number; chain?: string[]; note?: string }>).map((c, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={c.confidence >= 50 ? 'warning' : 'neutral'}>confidence {c.confidence}</AdminBadge>
                    <span className="font-semibold">{c.cause}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{(c.chain ?? []).join(' → ')} · {c.note ?? ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recovery Candidates ── */}
      {tab === 'candidates' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Recovery Candidates (제안만)" description="Queue Rebuild/Playlist Reload 는 기존 Draft/승인 흐름으로만 이어지며, 어떤 전략도 자동 실행되지 않습니다." />
          {!allCandidates.length ? <AdminEmpty icon={<Wrench size={20} />} title="복구 후보 없음" /> : (
            <div className="space-y-1.5">
              {allCandidates.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="neutral">{STRATEGY_LABEL[c.strategy_type as RecoveryStrategy] ?? c.strategy_type}</AdminBadge>
                  <AdminBadge tone={VALIDATION_TONE[c.validation_status as ValidationStatus]}>{VALIDATION_LABEL[c.validation_status as ValidationStatus]}</AdminBadge>
                  <AdminBadge tone={c.status === 'governance_review' ? 'warning' : c.status === 'approved_candidate' ? 'success' : 'neutral'}>{c.status}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{c.description?.slice(0, 40)}</span>
                  <div className="ml-auto flex gap-1">
                    <button disabled={busy} onClick={() => void linkTwin(c, true)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Twin 통과 기록</button>
                    <button disabled={busy} onClick={() => void linkTwin(c, false)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Twin 실패 기록</button>
                    <button disabled={busy || c.validation_status !== 'twin_validated'} onClick={() => void submitGovernance(c)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-40">Governance 제출</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Twin Validation ── */}
      {tab === 'twin' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Digital Twin Validation (0499 재사용 · 게이트)" description="모든 Recovery 는 Digital Twin 에서만 검증하며, 검증 실패/미검증 후보는 Governance 제출이 서버에서 차단됩니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Twin 통과" value={NUM(rec?.twin_validated)} />
            <Box label="Twin 실패" value={NUM(rec?.twin_failed)} />
            <Box label="Governance Review" value={NUM(rec?.governance_review)} />
            <Box label="사용 가능 Twin Run" value={NUM(twinRuns.length)} />
          </div>
          {!twinRuns.length && <AdminAlert tone="warning" title="완료된 Twin Run 없음" description="Digital Twin Lab 에서 Recovery Scenario 를 먼저 시뮬레이션하세요." />}
        </div>
      )}

      {/* ── Risk ── */}
      {tab === 'risk' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Recovery Risk Assessment" description="Success Probability 는 Knowledge 성공률(실제 Outcome)+Twin confidence 재정규화 − Blast Radius penalty 로 계산합니다. 근거 성분이 없으면 null 유지(가짜 확률 없음)." />
          {!allCandidates.length ? <AdminEmpty icon={<Gauge size={20} />} title="후보 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">전략</th><th className="px-2">Success Prob</th><th className="px-2">Blast Radius</th><th className="px-2">Impact</th><th className="px-2">Confidence</th><th className="px-2">Recovery Time</th></tr></thead>
                <tbody>
                  {allCandidates.map((c) => (
                    <tr key={c.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{STRATEGY_LABEL[c.strategy_type as RecoveryStrategy] ?? c.strategy_type}</td>
                      <td className="px-2">{c.success_probability ?? '—'}</td>
                      <td className="px-2">{c.blast_radius ?? '—'}</td>
                      <td className="px-2">{c.business_impact ?? '—'}</td>
                      <td className="px-2">{c.confidence ?? '—'}</td>
                      <td className="px-2">{c.recovery_time_estimate_min == null ? '—' : `${c.recovery_time_estimate_min}분`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Knowledge ── */}
      {tab === 'knowledge' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Recovery Knowledge Base (실제 Outcome 만)" description="Incident→Cause→Recovery→Outcome 사례를 축적합니다. 실제 Outcome 2건 미만이면 성공률을 계산하지 않습니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="성공 사례" value={NUM(rec?.succeeded)} />
            <Box label="실패 사례" value={NUM(rec?.failed)} />
            <Box label="Outcome 대기" value={NUM(rec?.pending_outcome)} />
            <Box label="총 후보" value={NUM(rec?.total)} />
          </div>
          {(Number(rec?.succeeded ?? 0) + Number(rec?.failed ?? 0)) === 0 && (
            <AdminEmpty icon={<BookOpen size={20} />} title="실제 Outcome 없음" description="복구 실행(사람) 후 결과를 기록하면 Knowledge Base 가 축적됩니다(insufficient_data — 0 조작 없음)." />
          )}
        </div>
      )}

      {/* ── Playbooks ── */}
      {tab === 'playbooks' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Autonomous Playbook (자동 실행 금지)" description="Playbook 은 사람이 읽고 실행하는 참고 절차입니다. 자동 실행 메커니즘/필드 자체가 없습니다." />
          {!playbooks.length ? <AdminEmpty icon={<ListOrdered size={20} />} title="Playbook 없음" description="Incident 상세에서 파생할 수 있습니다." /> : (
            playbooks.map((p) => (
              <AdminCard key={p.id} title={p.title}>
                <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <AdminBadge tone="neutral">{p.incident_type}</AdminBadge>
                  <span>성공 {p.success_count} / 실패 {p.fail_count} · {p.status}</span>
                </div>
                <ol className="space-y-0.5 text-[11px]">
                  {p.steps.map((s) => <li key={s.order}><b>{s.order}.</b> {s.action} <span className="text-[10px] text-muted-foreground">— {s.note}</span></li>)}
                </ol>
              </AdminCard>
            ))
          )}
        </div>
      )}

      {/* ── Timeline ── */}
      {tab === 'timeline' && (
        <div className="space-y-3">
          {!selIncident ? <AdminEmpty icon={<ListOrdered size={20} />} title="Incident 선택 필요" description="Active Incidents 탭에서 상세를 여세요." /> : (
            <div className="space-y-1">
              {(selIncident.timeline ?? []).map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="text-[10px] text-muted-foreground">{String(t.at).slice(0, 16)}</span>
                  <AdminBadge tone={INCIDENT_STATUS_TONE[t.event] ?? 'neutral'}>{INCIDENT_STATUS_LABEL[t.event] ?? t.event}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{t.detail ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Score ── */}
      {tab === 'score' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Self-Healing Score (실측 성분만)" description="Detection Speed/RCA Accuracy/Recovery Accuracy/False Positive/MTTR 성분을 재정규화합니다. Outcome 축적 전 성분은 null 로 유지되며 0 으로 조작하지 않습니다." />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black">{score.score ?? '—'}</span>
            <AdminBadge tone={score.grade === 'strong' ? 'success' : score.grade === 'developing' ? 'info' : score.grade === 'weak' ? 'danger' : 'neutral'}>{score.grade}</AdminBadge>
          </div>
          {score.missing.length > 0 && <p className="text-[10px] text-muted-foreground">미계산 성분(null): {score.missing.join(', ')}</p>}
        </div>
      )}

      {/* ── Governance ── */}
      {tab === 'governance' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Governance Evidence (읽기 전용 · 기존 흐름 무변경)" description="Twin 검증 통과 후보만 Governance Review 로 제출됩니다. 승인/실행은 전부 사람이 수행합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Review 대기 후보" value={NUM(rec?.governance_review)} />
            <Box label="Governance Violations" value={NUM(gov?.events?.violations)} />
            <Box label="Overrides" value={NUM(gov?.events?.overrides)} />
            <Box label="Twin 실패(제출 차단)" value={NUM(rec?.twin_failed)} />
          </div>
        </div>
      )}

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">감지 대상</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {INCIDENT_TYPES.map((t) => (
                  <tr key={t.type} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{t.label}</td>
                    <td className="px-2"><AdminBadge tone={t.support === 'supported' ? 'success' : t.support === 'unsupported' ? 'danger' : 'warning'}>{t.support}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {HEAL_SUPPORT.map((s) => (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                    <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminCard>
  );
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
