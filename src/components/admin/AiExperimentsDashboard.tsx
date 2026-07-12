/**
 * AiExperimentsDashboard — AI-MUSIC-4 Controlled Playlist Experimentation & Pilot Rollout Intelligence
 * (Preview). Rule 기반(LLM/ML/통계 라이브러리 아님) 실험 *설계·분석·추천* 시스템. 실행 시스템이 아니다:
 * Pilot 시작 / Store 그룹 배정 / Playlist 배포 / 확장 / 중단 / 롤백을 자동 수행하지 않는다. 모든 결과는
 * Recommendation / Simulation / Draft. 운영자 기록용 Draft / Review / Audit 버튼만 제공한다. master flag +
 * 세부 flag 기본 OFF. Guardrail(Streaming/Incident) source 미적용 → NOT_AVAILABLE 로 정직히 표시한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, FlaskConical, ClipboardCheck, Users, ListChecks, Split, Gauge, ShieldCheck, BarChart3, Rocket, History, ScrollText, Save } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getExperimentDesign, getObservationalOutcome, getExperimentHistory, saveExperimentDraft, saveExperimentReview,
  type ExperimentDesignBundle, type OutcomeBundle, type ExperimentRow,
} from '@/lib/api/aiExperimentsApi';
import {
  getAiExperimentsConfig, METRIC_DEFS, PRIMARY_METRICS, SECONDARY_METRICS, GUARDRAIL_METRICS,
} from '@/lib/aiExperiments';

type Tab = 'overview' | 'eligibility' | 'pilot' | 'plans' | 'groups' | 'metrics' | 'guardrails' | 'outcomes' | 'rollout' | 'history' | 'explain';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <FlaskConical size={14} /> },
  { key: 'eligibility', label: 'Eligibility', icon: <ClipboardCheck size={14} /> },
  { key: 'pilot', label: 'Pilot Stores', icon: <Users size={14} /> },
  { key: 'plans', label: 'Plans', icon: <ListChecks size={14} /> },
  { key: 'groups', label: 'Control / Treatment', icon: <Split size={14} /> },
  { key: 'metrics', label: 'Metrics', icon: <Gauge size={14} /> },
  { key: 'guardrails', label: 'Guardrails', icon: <ShieldCheck size={14} /> },
  { key: 'outcomes', label: 'Outcomes', icon: <BarChart3 size={14} /> },
  { key: 'rollout', label: 'Rollout', icon: <Rocket size={14} /> },
  { key: 'history', label: 'History', icon: <History size={14} /> },
  { key: 'explain', label: 'Explainability', icon: <ScrollText size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'ELIGIBLE': case 'PASS': case 'BALANCED': case 'CLEAN': case 'TREATMENT_BETTER': case 'READY_FOR_MANUAL_ROLLOUT': case 'READY': return 'success';
    case 'REVIEW_REQUIRED': case 'WARNING': case 'ACCEPTABLE': case 'SUSPECTED': case 'CONTINUE_PILOT': case 'EXPAND_SMALL': case 'EXPAND_MEDIUM': case 'NO_MEANINGFUL_DIFFERENCE': return 'warning';
    case 'INELIGIBLE': case 'TEMPORARILY_EXCLUDED': case 'FAIL': case 'IMBALANCED': case 'CONTAMINATION_RISK': case 'CONTAMINATED': case 'GUARDRAIL_FAILED': case 'CONTROL_BETTER': case 'DO_NOT_ROLLOUT': case 'ROLLBACK_RECOMMENDED': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NO_DATA': case 'NOT_AVAILABLE': case 'UNKNOWN': return 'info';
    default: return 'neutral';
  }
}
function pct(n: number | null | undefined): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

export default function AiExperimentsDashboard() {
  const cfg = getAiExperimentsConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const [bundle, setBundle] = useState<ExperimentDesignBundle | null>(null);
  const [outcome, setOutcome] = useState<OutcomeBundle | null>(null);
  const [history, setHistory] = useState<ExperimentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cfg.masterEnabled) return;
    setLoading(true); setError(null); setNotice(null); setOutcome(null);
    try {
      const [b, h] = await Promise.allSettled([getExperimentDesign(days), getExperimentHistory(50)]);
      if (b.status === 'fulfilled') setBundle(b.value); else setError('실험 신호 조회 실패(마이그레이션 0464~0467 미적용 시 NO DATA).');
      if (h.status === 'fulfilled') setHistory(h.value);
    } catch { setError('실험 데이터 조회 실패.'); }
    finally { setLoading(false); }
  }, [days, cfg.masterEnabled]);
  useEffect(() => { void load(); }, [load]);

  const runOutcome = useCallback(async () => {
    if (!bundle || bundle.design.status === 'INSUFFICIENT_DATA') return;
    setNotice(null);
    const control = bundle.design.control.members.map((m) => m.storeId);
    const treatment = bundle.design.treatment.members.map((m) => m.storeId);
    try { setOutcome(await getObservationalOutcome(control, treatment, days)); }
    catch { setNotice('관측 Outcome 조회 실패.'); }
  }, [bundle, days]);
  useEffect(() => { if (tab === 'outcomes' || tab === 'rollout' || tab === 'explain') void runOutcome(); }, [tab, runOutcome]);

  const saveDraft = useCallback(async () => {
    if (!bundle || bundle.design.status === 'INSUFFICIENT_DATA') return; setNotice(null);
    try {
      const id = await saveExperimentDraft({
        name: `Pilot Draft ${new Date().toISOString().slice(0, 10)}`, hypothesis: 'Candidate가 Control 대비 Completion을 개선한다',
        candidatePlaylistId: null, candidateVersion: null, targetIndustry: bundle.pilot.recommendedStores[0]?.industry ?? null,
        primaryMetric: 'completion_rate', secondaryMetrics: ['skip_rate', 'like_ratio'], guardrailMetrics: [...GUARDRAIL_METRICS],
        confidence: bundle.pilot.confidence,
        controlStoreIds: bundle.design.control.members.map((m) => m.storeId),
        treatmentStoreIds: bundle.design.treatment.members.map((m) => m.storeId),
      });
      setNotice(id ? 'Draft 저장됨 (설계 초안 · 실행/배정/배포 없음, 운영자 승인 필요).' : 'Draft 저장 실패.');
      void getExperimentHistory(50).then(setHistory);
    } catch { setNotice('Draft 저장 실패(권한/마이그레이션 확인).'); }
  }, [bundle]);

  const review = useCallback(async (experimentId: string, action: string) => {
    setNotice(null);
    try { await saveExperimentReview(experimentId, action, `operator ${action}`); setNotice(`감사 기록: ${action} (자동 실행 없음).`); void getExperimentHistory(50).then(setHistory); }
    catch { setNotice('리뷰 기록 실패.'); }
  }, []);

  const overview = useMemo(() => {
    const elig = bundle?.eligibility ?? [];
    return {
      drafts: history.filter((h) => h.status === 'DRAFT').length,
      eligibleStores: elig.filter((e) => e.status === 'ELIGIBLE').length,
      activeManual: history.filter((h) => h.status === 'APPROVED_FOR_MANUAL_SETUP' || h.status === 'OBSERVING').length,
      analysisReady: history.filter((h) => h.status === 'ANALYSIS_READY').length,
      insufficient: elig.filter((e) => e.status === 'INSUFFICIENT_DATA').length,
      avgConfidence: elig.length ? Math.round(elig.reduce((s, e) => s + (e.confidence ?? 0), 0) / elig.length) : null,
    };
  }, [bundle, history]);

  if (!cfg.masterEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><FlaskConical size={18} /> AI Experiments <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-4 (Preview)</span></h2>
        <AdminAlert tone="info" title="AI Music 비활성 (기본 OFF · opt-in)">
          Rule 기반 Controlled Experiments는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_EXPERIMENTS_ENABLED</code> 를 켜면 (읽기 전용) 실험 설계/분석이 로드됩니다.
          AI는 실험 설계·분석·추천만 제공하며 Pilot 시작·Store 배정·Playlist 배포를 자동 수행하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><FlaskConical size={18} /> AI Experiments <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-4</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반(LLM/ML 아님) · 읽기 전용 · 설계·분석·추천 전용 · Pilot 시작/배정/배포 자동 없음 · Directional only</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-xs font-medium ${days === d ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{d}d</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}

      {!loading && tab === 'overview' && (
        <AdminCard title="Overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="Draft Experiments" value={n1(overview.drafts)} tone="info" />
            <AdminStatCard label="Eligible Stores" value={n1(overview.eligibleStores)} tone="success" />
            <AdminStatCard label="Active Manual Pilots" value={n1(overview.activeManual)} tone="info" />
            <AdminStatCard label="Analysis Ready" value={n1(overview.analysisReady)} tone="info" />
            <AdminStatCard label="Insufficient Data" value={n1(overview.insufficient)} tone="warning" />
            <AdminStatCard label="Avg Confidence" value={n1(overview.avgConfidence)} tone="info" />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">
            Guardrail(Streaming/Incident) source 미적용 → NOT_AVAILABLE. 실험 시작/배포/그룹배정 버튼은 제공하지 않습니다 — Draft/Review/Audit 기록만 가능합니다.
          </p>
        </AdminCard>
      )}

      {!loading && tab === 'eligibility' && (
        <AdminCard title="Experiment Eligibility (per store)">
          {!bundle || bundle.eligibility.length === 0 ? <AdminEmpty title="NO DATA" description="재생 이벤트가 있는 매장 없음(또는 마이그레이션 미적용)" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Store</th><th>Status</th><th>Playbacks</th><th>Sessions</th><th>Coverage</th><th>Conf</th><th>Reason</th></tr></thead>
                <tbody>
                  {bundle.eligibility.slice(0, 80).map((e) => (
                    <tr key={e.storeId} className="border-t border-border">
                      <td className="py-1 text-text-primary">{e.storeName ?? e.storeId.slice(0, 8)}</td>
                      <td><AdminBadge tone={tone(e.status)}>{e.status}</AdminBadge></td>
                      <td>{e.sampleSize.playbacks}</td><td>{e.sampleSize.sessions}</td><td>{pct(e.signalCoverage)}</td><td>{n1(e.confidence)}</td>
                      <td className="text-text-tertiary">{[...e.blockingReasons, ...e.reasons][0] ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-text-tertiary">Store / Session / Playback 은 별개 지표입니다. requiresApproval · automated=false.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'pilot' && (
        <AdminCard title="Pilot Store Recommendation (추천 · 배정 아님)">
          {!bundle ? <AdminEmpty title="NO DATA" />
            : bundle.pilot.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">{bundle.pilot.diversityCoverage.note}</AdminAlert>
            : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <AdminStatCard label="Recommended" value={n1(bundle.pilot.recommendedStores.length)} tone="success" />
                  <AdminStatCard label="Industries" value={n1(bundle.pilot.diversityCoverage.industries)} tone="info" />
                  <AdminStatCard label="Expected Sessions" value={n1(bundle.pilot.expectedSample.sessions)} tone="info" />
                  <AdminStatCard label="Risk" value={bundle.pilot.risk} tone={bundle.pilot.risk === 'LOW' ? 'success' : bundle.pilot.risk === 'HIGH' ? 'danger' : 'warning'} />
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-text-tertiary"><th className="py-1">Store</th><th>Industry</th><th>Browser</th><th>Device</th><th>Exp. Sessions</th></tr></thead>
                    <tbody>
                      {bundle.pilot.recommendedStores.map((p) => (
                        <tr key={p.storeId} className="border-t border-border"><td className="py-1 text-text-primary">{p.storeName ?? p.storeId.slice(0, 8)}</td><td>{p.industry ?? '—'}</td><td>{p.browser ?? '—'}</td><td>{p.device ?? '—'}</td><td>{p.expectedSessions}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bundle.pilot.excludedStores.length > 0 && <p className="text-[11px] text-text-tertiary">제외 {bundle.pilot.excludedStores.length}개: {bundle.pilot.excludedStores.slice(0, 3).map((x) => x.reason).join(' · ')}…</p>}
              </div>
            )}
        </AdminCard>
      )}

      {!loading && tab === 'plans' && (
        <AdminCard title="Experiment Plans (Draft)" action={<AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} disabled={!bundle || bundle.design.status === 'INSUFFICIENT_DATA'} onClick={() => void saveDraft()}>Draft 저장</AdminButton>}>
          {history.length === 0 ? <AdminEmpty title="Draft 없음" description="추천 그룹으로 Draft를 저장하면 여기에 표시됩니다 (자동 실행 없음)" /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Name</th><th>Status</th><th>Primary</th><th>Ctrl/Treat</th><th>Snapshots</th><th>Review</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="py-1 text-text-primary">{h.name}</td><td><AdminBadge tone={tone(h.status)}>{h.status}</AdminBadge></td>
                    <td>{h.primaryMetric ?? '—'}</td><td>{h.controlCount}/{h.treatmentCount}</td><td>{h.snapshots}</td>
                    <td className="flex gap-1">
                      <AdminButton size="sm" variant="ghost" onClick={() => void review(h.id, 'REVIEW')}>Review</AdminButton>
                      <AdminButton size="sm" variant="ghost" onClick={() => void review(h.id, 'APPROVE_FOR_MANUAL_SETUP')}>Approve(manual)</AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-text-tertiary">Approve는 수동 setup 승인 기록일 뿐, Playback/Playlist 에 자동 연결되지 않습니다.</p>
        </AdminCard>
      )}

      {!loading && tab === 'groups' && (
        <AdminCard title="Control / Treatment Design (추천 · 배정 아님)">
          {!bundle ? <AdminEmpty title="NO DATA" />
            : bundle.design.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">{bundle.design.reasons.join(' · ')}</AdminAlert>
            : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs"><AdminBadge tone={tone(bundle.design.status)}>{bundle.design.status}</AdminBadge><span className="text-text-secondary">balance {n1(bundle.design.balanceScore)} · {bundle.design.reasons[0]}</span></div>
                {bundle.design.contaminationRisk.length > 0 && <AdminAlert tone="warning" title="Contamination Risk">{bundle.design.contaminationRisk.join(' · ')}</AdminAlert>}
                <div className="grid gap-3 md:grid-cols-2">
                  {([['Control (기존 Playlist 유지)', bundle.design.control], ['Treatment (Candidate Preview only)', bundle.design.treatment]] as const).map(([label, arm]) => (
                    <div key={label} className="rounded-lg border border-border bg-bg-card p-3">
                      <div className="mb-2 text-xs font-semibold text-text-primary">{label}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-text-tertiary">
                        <div>Stores <span className="text-text-primary">{arm.stats.stores}</span></div>
                        <div>Sessions <span className="text-text-primary">{arm.stats.sessions}</span></div>
                        <div>Playbacks <span className="text-text-primary">{arm.stats.playbacks}</span></div>
                        <div>Skip <span className="text-text-primary">{pct(arm.stats.meanSkipRate)}</span></div>
                        <div>Compl <span className="text-text-primary">{pct(arm.stats.meanCompletionRate)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </AdminCard>
      )}

      {!loading && tab === 'metrics' && (
        <AdminCard title="Experiment Metrics (numerator / denominator documented)">
          <div className="space-y-3 text-xs">
            {([['Primary', PRIMARY_METRICS], ['Secondary', SECONDARY_METRICS], ['Guardrail', GUARDRAIL_METRICS]] as const).map(([group, keys]) => (
              <div key={group}>
                <div className="mb-1 font-semibold text-text-primary">{group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {keys.map((k) => { const d = METRIC_DEFS[k]; return <span key={k} className="rounded border border-border bg-bg-card px-2 py-1 text-text-secondary" title={`${d?.numerator} / ${d?.denominator}`}>{d?.label ?? k} <span className="text-text-tertiary">({d?.numerator}/{d?.denominator})</span></span>; })}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {!loading && tab === 'guardrails' && (
        <AdminCard title="Guardrail Evaluation">
          {!outcome ? <AdminAlert tone="info" title="분석 필요">Outcomes 탭에서 관측 분석을 실행하면 Guardrail 이 평가됩니다.</AdminAlert>
            : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs"><AdminBadge tone={tone(outcome.outcome.guardrail.status)}>{outcome.outcome.guardrail.status}</AdminBadge><span className="text-text-tertiary">{outcome.outcome.guardrail.notes.join(' · ')}</span></div>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-tertiary"><th className="py-1">Guardrail</th><th>Control</th><th>Treatment</th><th>Status</th></tr></thead>
                  <tbody>
                    {outcome.outcome.guardrail.checks.map((g) => (
                      <tr key={g.key} className="border-t border-border"><td className="py-1 text-text-primary">{g.label}</td><td>{n1(g.control)}</td><td>{n1(g.treatment)}</td><td><AdminBadge tone={tone(g.status)}>{g.status}</AdminBadge></td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-text-tertiary">Streaming/Incident source 미적용 → NOT_AVAILABLE (정직). Primary 개선만으로 확장하지 않습니다.</p>
              </div>
            )}
        </AdminCard>
      )}

      {!loading && tab === 'outcomes' && (
        <AdminCard title="Experiment Outcome (observational · directional only)">
          {!outcome ? <AdminEmpty title="분석 대기" description="추천 그룹의 관측 지표를 비교합니다 (실제 그룹 배정 아님)" />
            : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <AdminBadge tone={tone(outcome.outcome.classification)}>{outcome.outcome.classification}</AdminBadge>
                  <AdminBadge tone="info">{outcome.outcome.significance}</AdminBadge>
                  <span className="text-text-tertiary">confidence {n1(outcome.outcome.confidence)} · data {outcome.outcome.dataQuality}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <AdminStatCard label="Ctrl Sessions" value={n1(outcome.arms.control.sessions)} tone="info" />
                  <AdminStatCard label="Treat Sessions" value={n1(outcome.arms.treatment.sessions)} tone="info" />
                  <AdminStatCard label="Ctrl Playbacks" value={n1(outcome.arms.control.playbacks)} tone="info" />
                  <AdminStatCard label="Treat Playbacks" value={n1(outcome.arms.treatment.playbacks)} tone="info" />
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-tertiary"><th className="py-1">Metric</th><th>Control</th><th>Treatment</th><th>Abs Δ</th><th>Rel Δ</th></tr></thead>
                  <tbody>
                    {[outcome.outcome.primary, ...outcome.outcome.secondary].map((m) => (
                      <tr key={m.metric} className="border-t border-border"><td className="py-1 text-text-primary">{METRIC_DEFS[m.metric]?.label ?? m.metric}</td><td>{n1(m.control)}</td><td>{n1(m.treatment)}</td><td>{n1(m.absoluteDelta)}</td><td>{m.relativeDelta == null ? '—' : pct(m.relativeDelta)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-text-tertiary">{outcome.outcome.notes.join(' · ')}</p>
              </div>
            )}
        </AdminCard>
      )}

      {!loading && tab === 'rollout' && (
        <AdminCard title="Rollout Recommendation (추천 · 실행 없음)">
          {!outcome ? <AdminEmpty title="분석 대기" description="Outcomes 실행 후 Rollout 추천이 산출됩니다" />
            : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2"><AdminBadge tone={tone(outcome.rollout.recommendation)}>{outcome.rollout.recommendation}</AdminBadge><span className="text-text-tertiary">guardrail {outcome.rollout.guardrails} · confidence {n1(outcome.rollout.confidence)}</span></div>
                <div className="text-text-secondary">{outcome.rollout.reasons.join(' · ')}</div>
                {outcome.rollout.risks.length > 0 && <div className="text-text-tertiary">Risks: {outcome.rollout.risks.join(', ')}</div>}
                {outcome.rollout.suggestedNextSample && <div className="text-text-tertiary">Next: {outcome.rollout.suggestedNextSample.sessions} sessions / {outcome.rollout.suggestedNextSample.playbacks} playbacks · {outcome.rollout.suggestedNextDurationDays}d</div>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <AdminBadge tone="info">automated={String(outcome.rollout.automated)}</AdminBadge>
                  <AdminBadge tone="info">requiresApproval={String(outcome.rollout.requiresApproval)}</AdminBadge>
                  <AdminBadge tone="info">remoteControl={String(outcome.rollout.remoteControl)}</AdminBadge>
                  <AdminBadge tone="info">actualDeployment={String(outcome.rollout.actualDeployment)}</AdminBadge>
                </div>
                {outcome.feedback.length > 0 && <div className="pt-1 text-text-tertiary">Learning Feedback (권고): {outcome.feedback.map((f) => f.kind).join(', ')} — applied=false</div>}
              </div>
            )}
        </AdminCard>
      )}

      {!loading && tab === 'history' && (
        <AdminCard title="Pilot History / Audit">
          {history.length === 0 ? <AdminEmpty title="이력 없음" /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Name</th><th>Status</th><th>Ctrl/Treat</th><th>Snapshots</th><th>When</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border"><td className="py-1 text-text-primary">{h.name}</td><td><AdminBadge tone={tone(h.status)}>{h.status}</AdminBadge></td><td>{h.controlCount}/{h.treatmentCount}</td><td>{h.snapshots}</td><td className="text-text-tertiary">{h.createdAt.slice(0, 16).replace('T', ' ')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'explain' && (
        <AdminCard title="Explainability v3">
          {!outcome ? <AdminEmpty title="분석 대기" description="Outcomes 실행 후 근거가 표시됩니다" />
            : (
              <div className="space-y-2 text-xs">
                <div className="text-text-secondary">{outcome.explain.summary}</div>
                {outcome.explain.items.map((it, i) => (
                  <div key={i} className="rounded border border-border bg-bg-card p-2"><div className="font-medium text-text-primary">{it.question}</div><div className="text-text-tertiary">{it.answer}</div></div>
                ))}
                {outcome.explain.missingSignals.length > 0 && <div className="text-text-tertiary">부족 신호: {outcome.explain.missingSignals.join(', ')}</div>}
              </div>
            )}
        </AdminCard>
      )}

      <p className="text-[11px] text-text-tertiary">
        모든 결과는 규칙 기반 실험 설계·분석·추천입니다. AI는 Pilot을 시작하거나 Store를 그룹에 배정하거나 Playlist를 배포·확장·중단·롤백하지 않으며, Player/Playback/Queue/Playlist/Ranking/Settlement/Streaming/Governance/Store·Track 원본 데이터를 변경하지 않습니다(운영자 승인 필요).
      </p>
    </div>
  );
}
