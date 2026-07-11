// WEB-OBS-2 — Admin Observability Dashboard.
//   Turns the persistent RUM store (WEB-OBS-1) into operational answers: health, release regression,
//   route/API risk, error fingerprints, browser anomalies and incident candidates. All verdicts are
//   computed client-side from server aggregates against shared, unit-tested thresholds; no raw
//   telemetry payloads are surfaced. Failure-isolated: a query error renders an inline retry — it
//   never reaches the global ErrorBoundary or app boot, and polling never retries infinitely.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, AlertTriangle, Clock, Filter, Activity, GitCompareArrows, Route as RouteIcon,
  Server, Bug, MonitorSmartphone, Siren, ShieldAlert, ShieldCheck, Search, Undo2, GitBranch, Network,
  ClipboardList, Target, HeartPulse, ArrowUpRight,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getObservabilityOverview, getReleaseComparison, getObservabilityErrors, getReleaseGate, getRootCause,
  getIncidentRecovery, composeOperationalIntel, deriveIncidents,
  type OverviewResult, type ReleaseCompareResult, type ErrorsResult, type ReleaseGateBundle, type RootCauseBundle,
  type OperationalIntelBundle, type IncidentRecovery, type ObsWindow,
} from '@/lib/api/observabilityApi';
import {
  getObservabilityConfig, type HealthStatus, type MetricClassification, type Confidence,
  type IncidentSeverity, type Priority, type IncidentCandidate,
  type GateVerdict, type DeploymentReadiness, type QualityStatus, type GateReason, type BudgetItem,
  type CorrStrength, type RollbackStatus, type TimelineHealth,
  type ActionCategory, type Urgency, type BlastRadiusLevel, type RecoveryStatus,
  type EscalationTarget, type LifecycleStatus, type PlaybookStepStatus,
} from '@/lib/observability';

type ObsTab = 'overview' | 'gate' | 'rootcause' | 'operations' | 'releases' | 'routes' | 'apis' | 'errors' | 'devices' | 'incidents';

const TABS: Array<{ key: ObsTab; label: string; icon: JSX.Element }> = [
  { key: 'overview', label: 'Overview', icon: <Activity size={13} /> },
  { key: 'gate', label: 'Release Gate', icon: <ShieldCheck size={13} /> },
  { key: 'rootcause', label: 'Root Cause', icon: <Search size={13} /> },
  { key: 'operations', label: 'Operations', icon: <ClipboardList size={13} /> },
  { key: 'releases', label: 'Releases', icon: <GitCompareArrows size={13} /> },
  { key: 'routes', label: 'Routes', icon: <RouteIcon size={13} /> },
  { key: 'apis', label: 'APIs', icon: <Server size={13} /> },
  { key: 'errors', label: 'Errors', icon: <Bug size={13} /> },
  { key: 'devices', label: 'Devices', icon: <MonitorSmartphone size={13} /> },
  { key: 'incidents', label: 'Incidents', icon: <Siren size={13} /> },
];

const WINDOWS: Array<{ key: ObsWindow; label: string }> = [
  { key: '1h', label: '1시간' }, { key: '24h', label: '24시간' }, { key: '7d', label: '7일' }, { key: '30d', label: '30일' },
];

// ── formatting ──────────────────────────────────────────────────────────────
function ms(n: number | null | undefined): string { return n == null ? '—' : `${Math.round(n)}ms`; }
function pct(n: number | null | undefined, dp = 1): string { return n == null ? '—' : `${(n * 100).toFixed(dp)}%`; }
function num(n: number | null | undefined): string { return n == null ? '—' : Math.round(n).toLocaleString(); }
function fmtTime(d: Date): string {
  try { return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return d.toISOString(); }
}
function healthTone(s: HealthStatus): AdminToneName {
  return s === 'HEALTHY' ? 'success' : s === 'WATCH' ? 'info' : s === 'DEGRADED' ? 'warning' : s === 'CRITICAL' ? 'danger' : 'neutral';
}
function classTone(c: MetricClassification): AdminToneName {
  return c === 'IMPROVED' ? 'success' : c === 'REGRESSED' ? 'danger' : c === 'STABLE' ? 'neutral' : 'info';
}
function confTone(c: Confidence): AdminToneName {
  return c === 'HIGH' ? 'success' : c === 'MEDIUM' ? 'info' : c === 'LOW' ? 'warning' : 'neutral';
}
function sevTone(s: IncidentSeverity): AdminToneName {
  return s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'neutral';
}
function prioTone(p: Priority): AdminToneName {
  return p === 'P0' ? 'danger' : p === 'P1' ? 'warning' : p === 'P2' ? 'info' : p === 'P3' ? 'neutral' : 'neutral';
}
function verdictTone(v: GateVerdict): AdminToneName {
  return v === 'PASS' ? 'success' : v === 'PASS_WITH_WARNING' ? 'warning' : v === 'BLOCK' ? 'danger' : 'neutral';
}
function readinessTone(r: DeploymentReadiness): AdminToneName {
  return r === 'READY' ? 'success' : r === 'WATCH' ? 'warning' : r === 'BLOCKED' ? 'danger' : 'neutral';
}
function qualityTone(q: QualityStatus): AdminToneName {
  return q === 'EXCELLENT' ? 'success' : q === 'GOOD' ? 'info' : q === 'RISKY' ? 'warning' : q === 'POOR' ? 'danger' : 'neutral';
}
function budgetVal(i: BudgetItem): string {
  if (i.value == null) return '—';
  if (i.unit === 'ms') return `${Math.round(i.value)}ms`;
  if (i.unit === 'ratio') return `${(i.value * 100).toFixed(2)}%`;
  return String(Math.round(i.value * 1000) / 1000);
}
function budgetLimit(i: BudgetItem): string {
  if (i.unit === 'ms') return `${i.budget}ms`;
  if (i.unit === 'ratio') return `${(i.budget * 100).toFixed(1)}%`;
  return String(i.budget);
}
function corrTone(s: CorrStrength): AdminToneName {
  return s === 'STRONG' ? 'danger' : s === 'MODERATE' ? 'warning' : s === 'WEAK' ? 'info' : 'neutral';
}
function rollbackTone(s: RollbackStatus): AdminToneName {
  return s === 'NO_ACTION' ? 'success' : s === 'WATCH' ? 'warning' : s === 'ROLLBACK_RECOMMENDED' ? 'danger' : s === 'BLOCK_RELEASE' ? 'danger' : 'neutral';
}
function tlHealthTone(h: TimelineHealth): AdminToneName {
  return h === 'healthy' ? 'success' : h === 'degraded' ? 'warning' : h === 'critical' ? 'danger' : 'neutral';
}
function urgencyTone(u: Urgency): AdminToneName {
  return u === 'CRITICAL' ? 'danger' : u === 'HIGH' ? 'warning' : u === 'MEDIUM' ? 'info' : 'neutral';
}
function actionTone(c: ActionCategory): AdminToneName {
  if (c === 'ROLLBACK_RECOMMENDED' || c === 'PREPARE_ROLLBACK') return 'danger';
  if (c === 'PAUSE_RELEASE' || c === 'HOLD_PROMOTION' || c.startsWith('ESCALATE')) return 'warning';
  if (c === 'OBSERVE') return 'neutral';
  return 'info';
}
function blastTone(l: BlastRadiusLevel): AdminToneName {
  return l === 'CRITICAL' || l === 'WIDESPREAD' ? 'danger' : l === 'MODERATE' ? 'warning' : l === 'LIMITED' ? 'info' : 'neutral';
}
function recoveryTone(s: RecoveryStatus): AdminToneName {
  return s === 'RECOVERED' ? 'success' : s === 'IMPROVING' ? 'info' : s === 'STABLE' ? 'warning' : s === 'REGRESSED' ? 'danger' : 'neutral';
}
function escalationTone(t: EscalationTarget): AdminToneName {
  return t === 'NONE' ? 'neutral' : t === 'EXECUTIVE' || t === 'SECURITY' ? 'danger' : t === 'OPERATOR' ? 'info' : 'warning';
}
function lifecycleTone(s: LifecycleStatus): AdminToneName {
  return s === 'RESOLVED' ? 'success' : s === 'MONITORING' ? 'info' : s === 'FALSE_POSITIVE' ? 'neutral' : s === 'MITIGATING' ? 'warning' : s === 'DETECTED' ? 'danger' : 'warning';
}
function stepTone(s: PlaybookStepStatus): AdminToneName {
  return s === 'COMPLETED' ? 'success' : s === 'IN_PROGRESS' ? 'info' : s === 'BLOCKED' ? 'danger' : s === 'SKIPPED' ? 'warning' : 'neutral';
}

interface LoadState {
  overview: OverviewResult | null;
  release: ReleaseCompareResult | null;
  errors: ErrorsResult | null;
  incidents: IncidentCandidate[];
  gate: ReleaseGateBundle | null;
  rootCause: RootCauseBundle | null;
  operations: OperationalIntelBundle | null;
}

export default function ObservabilityDashboard() {
  const cfg = getObservabilityConfig();
  const [tab, setTab] = useState<ObsTab>('overview');
  const [win, setWin] = useState<ObsWindow>('24h');
  const [release, setRelease] = useState('');
  const [environment, setEnvironment] = useState('');
  const [browser, setBrowser] = useState('');
  const [auto, setAuto] = useState(false);

  const [state, setState] = useState<LoadState>({ overview: null, release: null, errors: null, incidents: [], gate: null, rootCause: null, operations: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const reqSeq = useRef(0);
  const failStreak = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const myReq = ++reqSeq.current;
    if (!opts?.silent) setLoading(true);
    setError(null);
    const filters = { window: win, release: release || null, environment: environment || null, browser: browser || null };
    // Fail-open per source: allSettled so one RPC error doesn't blank the whole dashboard.
    const [ov, rel, err, gt, rc] = await Promise.allSettled([
      getObservabilityOverview(filters),
      cfg.releaseComparisonEnabled ? getReleaseComparison({ window: win, environment: environment || null }) : Promise.resolve(null),
      getObservabilityErrors(filters),
      cfg.releaseQualityEnabled ? getReleaseGate({ window: win, environment: environment || null }) : Promise.resolve(null),
      cfg.rootCauseEnabled ? getRootCause({ window: win, environment: environment || null }) : Promise.resolve(null),
    ]);
    if (myReq !== reqSeq.current) return; // superseded

    const overview = ov.status === 'fulfilled' ? ov.value : null;
    const releaseRes = rel.status === 'fulfilled' ? rel.value : null;
    const errorsRes = err.status === 'fulfilled' ? err.value : null;
    const gateRes = gt.status === 'fulfilled' ? gt.value : null;
    const rootCauseRes = rc.status === 'fulfilled' ? rc.value : null;
    const anyFail = ov.status === 'rejected' || err.status === 'rejected';

    if (!overview && anyFail) {
      failStreak.current += 1;
      setError('옵저버빌리티 데이터를 불러오지 못했습니다.');
      setStale(true);
      if (!opts?.silent) setLoading(false);
      return;
    }
    failStreak.current = 0;
    const incidents = overview && cfg.incidentDetectionEnabled
      ? deriveIncidents(overview, errorsRes ?? { window: win, groups: [], byBrowser: [], browserAnomalies: [] }, releaseRes)
      : [];

    // WEB-OBS-5: operational intel needs the candidate release from root cause → sequential recovery fetch.
    let operations: OperationalIntelBundle | null = null;
    if (cfg.operationalAdvisorEnabled && rootCauseRes?.candidate) {
      let recovery: IncidentRecovery | null = null;
      try { recovery = await getIncidentRecovery(rootCauseRes.candidate, win === '1h' ? '24h' : win, environment || null); }
      catch { /* fail-open: advisor still composes without recovery */ }
      if (myReq !== reqSeq.current) return;
      operations = composeOperationalIntel(rootCauseRes, overview, gateRes, recovery);
    }
    setState({ overview, release: releaseRes, errors: errorsRes, incidents, gate: gateRes, rootCause: rootCauseRes, operations });
    setFetchedAt(new Date());
    setStale(false);
    if (anyFail) setError('일부 위젯을 불러오지 못했습니다(부분 표시).');
    if (!opts?.silent) setLoading(false);
  }, [win, release, environment, browser, cfg.releaseComparisonEnabled, cfg.incidentDetectionEnabled, cfg.releaseQualityEnabled, cfg.rootCauseEnabled, cfg.operationalAdvisorEnabled]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh: opt-in, tab-visible only, bounded backoff after repeated failures, always cleaned up.
  useEffect(() => {
    if (!auto || !cfg.autoRefreshEnabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (failStreak.current >= 3) return; // stop hammering a failing endpoint
      setStale(true);
      void load({ silent: true });
    }, cfg.autoRefreshMs);
    return () => window.clearInterval(id);
  }, [auto, cfg.autoRefreshEnabled, cfg.autoRefreshMs, load]);

  // Kill switch: whole dashboard disabled via env.
  if (!cfg.dashboardEnabled) {
    return (
      <AdminAlert tone="info" title="옵저버빌리티 대시보드 비활성화됨">
        <code className="font-mono text-[11px]">VITE_OBSERVABILITY_ENABLED=false</code> 로 비활성화되어 있습니다.
        텔레메트리 수집·전송은 영향받지 않습니다.
      </AdminAlert>
    );
  }

  const { overview } = state;
  const totalEvents = overview?.totals.total_events ?? 0;

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <AdminButton key={t.key} size="sm" tone={tab === t.key ? 'primary' : 'neutral'} variant={tab === t.key ? 'solid' : 'outline'}
            onClick={() => setTab(t.key)} leftIcon={t.icon}>
            {t.label}
            {t.key === 'incidents' && state.incidents.length > 0 && (
              <span className="ml-1"><AdminBadge tone="danger">{state.incidents.length}</AdminBadge></span>
            )}
          </AdminButton>
        ))}
      </div>

      {/* Controls: window + refresh + last-updated */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((w) => (
            <AdminButton key={w.key} size="sm" tone={win === w.key ? 'primary' : 'neutral'} variant={win === w.key ? 'solid' : 'outline'} onClick={() => setWin(w.key)}>
              {w.label}
            </AdminButton>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="flex items-center gap-1 text-[10px] text-ink-dim">
              <Clock size={11} /> {fmtTime(fetchedAt)} 기준{stale && ' · 갱신 중…'}
            </span>
          )}
          {cfg.autoRefreshEnabled && (
            <AdminButton size="sm" tone={auto ? 'primary' : 'neutral'} variant={auto ? 'solid' : 'outline'} onClick={() => setAuto((v) => !v)}>
              자동 {auto ? 'ON' : 'OFF'}
            </AdminButton>
          )}
          <AdminButton size="sm" tone="neutral" variant="subtle" leftIcon={<RefreshCw size={13} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-ink-dim"><Filter size={12} /> 필터</span>
        <input value={release} onChange={(e) => setRelease(e.target.value.slice(0, 64))} placeholder="release (build id)"
          className="w-40 rounded-md border border-line/20 bg-surface px-2 py-1 font-mono text-ink" aria-label="release" />
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-md border border-line/20 bg-surface px-2 py-1 text-ink" aria-label="environment">
          <option value="">모든 환경</option>{['production', 'preview', 'development', 'unknown'].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={browser} onChange={(e) => setBrowser(e.target.value)} className="rounded-md border border-line/20 bg-surface px-2 py-1 text-ink" aria-label="browser">
          <option value="">모든 브라우저</option>{['Chrome', 'Safari', 'Firefox', 'Edge', 'Other'].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {error && (
        <AdminCard>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-ink-mute"><AlertTriangle size={14} /> {error}</p>
            <AdminButton size="sm" tone="neutral" variant="outline" onClick={() => void load()}>재시도</AdminButton>
          </div>
        </AdminCard>
      )}

      {loading && !overview ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <AdminSkeleton key={i} className="h-20" />)}
        </div>
      ) : !overview || totalEvents === 0 ? (
        <AdminEmpty title="수집된 서버 텔레메트리가 없습니다"
          description="선택한 기간·필터에 해당하는 이벤트가 아직 없습니다. Preview에서 앱을 사용하면 데이터가 쌓입니다." />
      ) : (
        <>
          {tab === 'overview' && <OverviewTab data={state} />}
          {tab === 'gate' && <GateTab data={state} enabled={cfg.releaseQualityEnabled} gateEnabled={cfg.deploymentGateEnabled} budgetEnabled={cfg.performanceBudgetEnabled} enforce={cfg.budgetEnforcementEnabled} />}
          {tab === 'rootcause' && <RootCauseTab data={state} enabled={cfg.rootCauseEnabled} rollbackEnabled={cfg.rollbackAdvisorEnabled} timelineEnabled={cfg.timelineEnabled} correlationEnabled={cfg.correlationEnabled} graphEnabled={cfg.serviceGraphEnabled} />}
          {tab === 'operations' && <OperationsTab data={state} cfg={cfg} />}
          {tab === 'releases' && <ReleasesTab data={state} enabled={cfg.releaseComparisonEnabled} />}
          {tab === 'routes' && <RoutesTab data={state} />}
          {tab === 'apis' && <ApisTab data={state} />}
          {tab === 'errors' && <ErrorsTab data={state} />}
          {tab === 'devices' && <DevicesTab data={state} />}
          {tab === 'incidents' && <IncidentsTab data={state} enabled={cfg.incidentDetectionEnabled} />}
        </>
      )}

      <p className="text-[10px] text-ink-dim">
        ⓘ 서버 영속 RUM 집계 · 모든 점수/회귀/인시던트 판정은 공유 임계값(단위 테스트) 기반 · 저카디널리티 버킷만 저장(토큰·이메일·쿼리스트링·원문 없음).
        Health Score는 운영 우선순위 지표이며 SLA 보장 지표가 아닙니다. Boot Recovery는 관측 전용(수집 채널 미도입 → NO DATA).
      </p>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: LoadState }) {
  const o = data.overview!;
  const t = o.totals;
  const h = o.health;
  const errorRate = t.total_events > 0 ? t.error_count / t.total_events : 0;
  const chunkRate = t.sessions > 0 ? t.chunk_error_sessions / t.sessions : 0;
  const v = (name: string) => o.vitals[name];
  return (
    <div className="space-y-5">
      {/* Health headline */}
      <AdminCard title="Health Score" subtitle="가중 구성요소 기반 운영 우선순위 지표(SLA 아님)"
        action={<AdminBadge tone={healthTone(h.status)}>{h.status}{h.score != null ? ` · ${h.score}` : ''}</AdminBadge>}>
        {h.status === 'INSUFFICIENT_DATA' ? (
          <AdminEmpty title="표본 부족 — INSUFFICIENT_DATA" description={h.reasons.join(' · ')} />
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {h.components.filter((c) => c.score != null).map((c) => (
                <AdminBadge key={c.key} tone={c.score! >= 0.8 ? 'success' : c.score! >= 0.5 ? 'warning' : 'danger'}>
                  {c.key} {Math.round((c.score ?? 0) * 100)}
                </AdminBadge>
              ))}
            </div>
            {h.reasons.length > 0 && <ul className="text-[11px] text-ink-mute">{h.reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>}
          </div>
        )}
      </AdminCard>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <AdminStatCard label="세션" value={num(t.sessions)} tone="neutral" />
        <AdminStatCard label="총 이벤트" value={num(t.total_events)} tone="neutral" />
        <AdminStatCard label="Error Rate" value={pct(errorRate)} tone={errorRate >= 0.05 ? 'danger' : errorRate >= 0.01 ? 'warning' : 'success'} hint={`${num(t.error_count)}건`} />
        <AdminStatCard label="Critical" value={num(t.critical_error_count)} tone={t.critical_error_count > 0 ? 'danger' : 'success'} />
        <AdminStatCard label="Chunk 실패(세션)" value={num(t.chunk_error_sessions)} tone={chunkRate >= 0.05 ? 'danger' : t.chunk_error_sessions > 0 ? 'warning' : 'success'} hint={pct(chunkRate)} />
        <AdminStatCard label="Hydration(세션)" value={num(t.hydration_error_sessions)} tone={t.hydration_error_sessions > 0 ? 'warning' : 'success'} />
        <AdminStatCard label="Slow API" value={num(t.slow_api_count)} tone={t.slow_api_count > 0 ? 'warning' : 'success'} hint="≥1s" />
        <AdminStatCard label="Slow Route" value={num(t.slow_route_count)} tone={t.slow_route_count > 0 ? 'warning' : 'success'} hint="≥3s" />
        <AdminStatCard label="Long Task" value={num(t.long_task_count)} tone={t.long_task_count > 0 ? 'warning' : 'success'} />
        <AdminStatCard label="Memory Risk(세션)" value={num(t.memory_risk_sessions)} tone={t.memory_risk_sessions > 0 ? 'warning' : 'success'} hint="used/limit ≥90%" />
        <AdminStatCard label="LCP p75" value={ms(v('LCP')?.p75)} tone={(v('LCP')?.p75 ?? 0) > 4000 ? 'danger' : (v('LCP')?.p75 ?? 0) > 2500 ? 'warning' : 'success'} hint={v('LCP') ? `n=${v('LCP')!.count}` : 'NO DATA'} />
        <AdminStatCard label="INP p75" value={ms(v('INP')?.p75)} tone={(v('INP')?.p75 ?? 0) > 500 ? 'danger' : (v('INP')?.p75 ?? 0) > 200 ? 'warning' : 'success'} hint={v('INP') ? `n=${v('INP')!.count}` : 'NO DATA'} />
      </div>

      {/* Web Vitals detail */}
      <AdminCard title="Web Vitals (서버 p50/p75/p95)" subtitle="여러 세션 집계 · CLS/INP는 세션 근사(web-vitals 세션 알고리즘과 상이)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].map((name) => {
            const s = v(name); const isCls = name === 'CLS';
            return (
              <AdminStatCard key={name} label={name}
                value={s ? (isCls ? (s.p75 ?? 0).toFixed(3) : ms(s.p75)) : '—'}
                tone={s && s.poor > 0 ? 'warning' : 'neutral'}
                hint={s ? `p50 ${isCls ? (s.p50 ?? 0).toFixed(3) : ms(s.p50)} · p95 ${isCls ? (s.p95 ?? 0).toFixed(3) : ms(s.p95)} · n=${s.count}` : 'NO DATA'} />
            );
          })}
        </div>
      </AdminCard>
    </div>
  );
}

// ── Releases ────────────────────────────────────────────────────────────────
function ReleasesTab({ data, enabled }: { data: LoadState; enabled: boolean }) {
  if (!enabled) return <AdminAlert tone="info" title="Release 비교 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_RELEASE_COMPARE_ENABLED=false</code></AdminAlert>;
  const r = data.release;
  if (!r || !r.comparison) return <AdminEmpty title="비교할 릴리스가 부족합니다" description="최근 기간에 서로 다른 두 릴리스의 이벤트가 필요합니다(자동 선택 실패 → INSUFFICIENT_DATA)." />;
  const c = r.comparison;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AdminBadge tone="neutral">A(baseline): <span className="font-mono">{c.releaseA}</span></AdminBadge>
        <AdminBadge tone="primary">B(current): <span className="font-mono">{c.releaseB}</span></AdminBadge>
        <AdminBadge tone={c.regressed > 0 ? 'danger' : 'success'}>회귀 {c.regressed}</AdminBadge>
        <AdminBadge tone={c.improved > 0 ? 'success' : 'neutral'}>개선 {c.improved}</AdminBadge>
        <span className="text-ink-dim">A: {num(c.sessionsA)} 세션 / {num(c.eventsA)} 이벤트 · B: {num(c.sessionsB)} 세션 / {num(c.eventsB)} 이벤트</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
            {['Metric', 'A', 'B', 'Δ abs', 'Δ rel', 'n(A/B)', '분류', 'confidence'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {c.rows.map((row) => {
              const fmt = (val: number | null) => {
                if (val == null) return '—';
                if (row.unit === 'ms') return ms(val);
                if (row.unit === 'ratio') return pct(val, 2);
                return String(Math.round(val * 1000) / 1000);
              };
              return (
                <tr key={row.key} className="border-t border-line/10">
                  <td className="px-2 py-1.5">{row.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.valueA)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.valueB)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.absDelta == null ? '—' : fmt(row.absDelta)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.relDelta == null ? '—' : `${(row.relDelta * 100).toFixed(0)}%`}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">{row.sampleA}/{row.sampleB}</td>
                  <td className="px-2 py-1.5 text-right"><AdminBadge tone={classTone(row.classification)}>{row.classification}</AdminBadge></td>
                  <td className="px-2 py-1.5 text-right"><AdminBadge tone={confTone(row.confidence)}>{row.confidence}</AdminBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Routes ──────────────────────────────────────────────────────────────────
function RoutesTab({ data }: { data: LoadState }) {
  const rows = data.overview?.slowRoutes ?? [];
  if (rows.length === 0) return <AdminEmpty title="라우트 데이터 없음" />;
  return (
    <AdminCard title="Slow Routes (dwell) · Top 20" subtitle="p95 dwell 기준 · risk = 지연·오류·도달범위·회귀 가중">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
            {['Route', 'sessions', 'n', 'p50', 'p75', 'p95', 'worst', 'risk', 'priority'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>))}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.route} className="border-t border-line/10">
                <td className="px-2 py-1.5 font-mono text-[11px] max-w-[240px] truncate" title={r.route}>{r.route}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.sessions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.p50)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.p75)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.p95)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.worst)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.risk.score}</td>
                <td className="px-2 py-1.5 text-right"><AdminBadge tone={prioTone(r.risk.priority)}>{r.risk.priority}</AdminBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}

// ── APIs ────────────────────────────────────────────────────────────────────
function ApisTab({ data }: { data: LoadState }) {
  const rows = data.overview?.slowApis ?? [];
  if (rows.length === 0) return <AdminEmpty title="API 데이터 없음" />;
  return (
    <AdminCard title="Slow APIs · Top 20" subtitle="p95 기준 · host+path만(쿼리·id 제거) · risk = 지연·실패·도달범위 가중">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
            {['Endpoint', 'kind', 'sessions', 'n', 'p50', 'p95', 'worst', 'risk', 'priority'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>))}
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={`${a.name}:${a.kind}`} className="border-t border-line/10">
                <td className="px-2 py-1.5 font-mono text-[11px] max-w-[240px] truncate" title={a.name}>{a.name}</td>
                <td className="px-2 py-1.5 text-right text-ink-dim">{a.kind}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{a.sessions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{a.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(a.p50)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(a.p95)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ms(a.worst)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{a.risk.score}</td>
                <td className="px-2 py-1.5 text-right"><AdminBadge tone={prioTone(a.risk.priority)}>{a.risk.priority}</AdminBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}

// ── Errors ──────────────────────────────────────────────────────────────────
function ErrorsTab({ data }: { data: LoadState }) {
  const groups = data.errors?.groups ?? [];
  if (groups.length === 0) return <AdminEmpty title="오류 그룹 없음" />;
  const classToneMap: Record<string, AdminToneName> = { chunk: 'danger', hydration: 'danger', react: 'warning', runtime: 'warning', rejection: 'warning', resource: 'info', other: 'neutral' };
  return (
    <AdminCard title="Error Fingerprints · Top 20" subtitle="kind+정규화 메시지+route 로 그룹핑(비가역 해시) · 원문 stack 미노출">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
            {['fp', 'class', 'message', 'count', 'sessions', 'routes', 'browsers', 'releases', 'last seen'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i <= 2 ? '' : 'text-right'}`}>{h}</th>))}
          </tr></thead>
          <tbody>
            {groups.slice(0, 20).map((g) => (
              <tr key={g.fingerprint} className="border-t border-line/10">
                <td className="px-2 py-1.5 font-mono text-[10px] text-ink-dim">{g.fingerprint}</td>
                <td className="px-2 py-1.5"><AdminBadge tone={classToneMap[g.groupClass] ?? 'neutral'}>{g.groupClass}</AdminBadge></td>
                <td className="px-2 py-1.5 font-mono text-[11px] max-w-[320px] truncate" title={g.normalizedMessage}>{g.normalizedMessage}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{g.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{g.sessions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim" title={g.routes.join(', ')}>{g.routes.length}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim" title={g.browsers.join(', ')}>{g.browsers.join(',')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim" title={g.releases.join(', ')}>{g.releases.length}</td>
                <td className="px-2 py-1.5 text-right text-[10px] text-ink-dim">{g.lastSeen ? new Date(g.lastSeen).toLocaleString('ko-KR') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}

// ── Devices ─────────────────────────────────────────────────────────────────
function DevicesTab({ data }: { data: LoadState }) {
  const anomalies = data.errors?.browserAnomalies ?? [];
  const byBrowser = data.errors?.byBrowser ?? [];
  return (
    <div className="space-y-4">
      <AdminCard title="브라우저별 오류 편중" subtitle="표본 게이트 통과 그룹만 · 전체 평균 대비 2배↑ error rate">
        {anomalies.length === 0 ? <AdminEmpty title="편중 이상 없음" description="특정 브라우저에 오류가 몰리는 신호가 없습니다(또는 표본 부족)." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                {['Browser', 'error rate', '전체 평균', '영향 세션'].map((h, i) => <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {anomalies.map((a) => (
                  <tr key={a.browser} className="border-t border-line/10">
                    <td className="px-2 py-1.5">{a.browser}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums"><AdminBadge tone="danger">{pct(a.errorRate, 1)}</AdminBadge></td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">{pct(a.baselineRate, 1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
      <AdminCard title="브라우저 트래픽 분포" subtitle="error/total 이벤트 · 세션 수(UA 원문 미노출)">
        {byBrowser.length === 0 ? <AdminEmpty title="데이터 없음" /> : (
          <div className="flex flex-wrap gap-1.5">
            {byBrowser.map((b) => (
              <AdminBadge key={b.browser} tone="neutral">
                {b.browser}: {b.total_sessions}세션 · err {b.error_events}/{b.total_events}
              </AdminBadge>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────────
function IncidentsTab({ data, enabled }: { data: LoadState; enabled: boolean }) {
  if (!enabled) return <AdminAlert tone="info" title="Incident 탐지 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_INCIDENTS_ENABLED=false</code></AdminAlert>;
  const incidents = data.incidents;
  if (incidents.length === 0) return <AdminEmpty title="Incident 후보 없음" description="현재 기간·필터에서 규칙을 넘는 이상 신호가 없습니다." />;
  return (
    <div className="space-y-3">
      {incidents.map((i) => (
        <AdminCard key={i.incidentKey}
          title={<span className="flex items-center gap-2"><ShieldAlert size={15} /> {i.title}</span>}
          action={<div className="flex items-center gap-1.5"><AdminBadge tone={sevTone(i.severity)}>{i.severity}</AdminBadge><AdminBadge tone="neutral">{i.type}</AdminBadge></div>}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
            <Field k="affected sessions" v={num(i.affectedSessions)} />
            <Field k="event count" v={num(i.eventCount)} />
            <Field k="baseline" v={i.baselineValue == null ? '—' : String(i.baselineValue)} />
            <Field k="current" v={i.currentValue == null ? '—' : String(i.currentValue)} />
            <Field k="release" v={i.release ?? '—'} mono />
            <Field k="route" v={i.route ?? '—'} mono />
            <Field k="browser" v={i.browser ?? '—'} />
            <Field k="last seen" v={i.lastSeen ? new Date(i.lastSeen).toLocaleString('ko-KR') : '—'} />
          </div>
          <div className="mt-2 space-y-1 text-[11px]">
            <p className="text-ink-mute"><span className="text-ink-dim">threshold:</span> {i.threshold}</p>
            <p className="text-ink-mute"><span className="text-ink-dim">evidence:</span> {i.evidence}</p>
            <p className="text-ink"><span className="text-ink-dim">조치:</span> {i.suggestedAction}</p>
          </div>
        </AdminCard>
      ))}
    </div>
  );
}

// ── Release Gate (WEB-OBS-3) ─────────────────────────────────────────────────
function GateTab({ data, enabled, gateEnabled, budgetEnabled, enforce }: {
  data: LoadState; enabled: boolean; gateEnabled: boolean; budgetEnabled: boolean; enforce: boolean;
}) {
  if (!enabled) return <AdminAlert tone="info" title="Release Quality 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_RELEASE_QUALITY_ENABLED=false</code></AdminAlert>;
  const g = data.gate;
  if (!g || !g.gate || !g.signals || !g.quality || !g.budget) {
    return <AdminEmpty title="Release Gate 판정 불가 — INSUFFICIENT_DATA / NO DATA"
      description={g?.candidate ? `후보 릴리스 ${g.candidate}의 측정 데이터가 부족합니다.` : '최근 기간에 판정할 릴리스가 없습니다. Preview에서 앱을 사용하면 데이터가 쌓입니다.'} />;
  }
  const sig = g.signals;
  const quality = g.quality;
  const budget = g.budget;

  // Budget-enforcement kill switch: when OFF, budget failures are advisory (warnings), not hard blocks.
  const budgetBlocks = g.gate.blockingReasons.filter((r) => r.code === 'BUDGET_EXCEEDED');
  const nonBudgetBlocks = g.gate.blockingReasons.filter((r) => r.code !== 'BUDGET_EXCEEDED');
  const effectiveBlocks: GateReason[] = enforce ? g.gate.blockingReasons : nonBudgetBlocks;
  const advisoryWarnings: GateReason[] = enforce ? g.gate.warnings : [...g.gate.warnings, ...budgetBlocks];
  const displayVerdict: GateVerdict =
    g.gate.verdict === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA'
      : effectiveBlocks.length > 0 ? 'BLOCK'
        : (g.gate.verdict === 'BLOCK' && effectiveBlocks.length === 0) || advisoryWarnings.length > 0 ? 'PASS_WITH_WARNING'
          : g.gate.verdict;

  return (
    <div className="space-y-5">
      {/* Release selector context */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AdminBadge tone="primary">후보(candidate): <span className="font-mono">{g.candidate ?? '—'}</span></AdminBadge>
        <AdminBadge tone="neutral">기준(baseline): <span className="font-mono">{g.baseline ?? '—'}</span></AdminBadge>
        <span className="text-ink-dim">최근 릴리스 {g.releaseList.length}개 · 자동 선택(최신 트래픽 순)</span>
      </div>

      {/* Verdict headline */}
      {gateEnabled ? (
        <AdminCard title={<span className="flex items-center gap-2"><ShieldCheck size={16} /> Release Gate 판정</span>}
          subtitle="Rule 기반 · 설명 가능 · 표본 부족 시 INSUFFICIENT_DATA"
          action={<AdminBadge tone={verdictTone(displayVerdict)}>{displayVerdict}</AdminBadge>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AdminStatCard label="Deployment Readiness" value={<AdminBadge tone={readinessTone(g.gate.readiness)}>{g.gate.readiness}</AdminBadge>} tone="neutral" />
            <AdminStatCard label="Quality Score" value={quality.score == null ? '—' : String(quality.score)} tone={qualityTone(quality.status)} hint={quality.status} />
            <AdminStatCard label="Confidence" value={<AdminBadge tone={confTone(g.confidence ?? 'INSUFFICIENT')}>{g.confidence}</AdminBadge>} tone="neutral" hint={`${num(sig.sessions)} 세션 · ${sig.browsers} 브라우저`} />
            <AdminStatCard label="Budget" value={<AdminBadge tone={budget.overall === 'PASS' ? 'success' : budget.overall === 'FAIL' ? (enforce ? 'danger' : 'warning') : 'neutral'}>{budget.overall}</AdminBadge>} tone="neutral" hint={`${budget.failed} FAIL / ${budget.passed} PASS`} />
          </div>

          {effectiveBlocks.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-ink">Blocking Reasons</p>
              <ul className="space-y-1 text-[11px]">
                {effectiveBlocks.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-ink-mute">
                    <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                    <span><span className="font-mono text-ink">{r.metric}</span> — {r.threshold} · <span className="text-ink-dim">현재</span> {r.evidence} <span className="text-ink-dim">[{r.code}]</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {advisoryWarnings.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-ink">Warnings{!enforce && budgetBlocks.length > 0 ? ' (budget 미강제 → 권고)' : ''}</p>
              <ul className="space-y-1 text-[11px]">
                {advisoryWarnings.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-ink-mute">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span><span className="font-mono text-ink">{r.metric}</span> — {r.threshold} · {r.evidence} <span className="text-ink-dim">[{r.code}]</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {effectiveBlocks.length === 0 && advisoryWarnings.length === 0 && (
            <p className="mt-3 text-[11px] text-ink-mute">차단·경고 사유 없음 — 예산 이내, 유의미한 회귀 없음.</p>
          )}
        </AdminCard>
      ) : (
        <AdminAlert tone="info" title="Deployment Gate 비활성화됨(판정 숨김)"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_DEPLOYMENT_GATE_ENABLED=false</code> · 아래 Quality/Budget는 계속 표시됩니다.</AdminAlert>
      )}

      {/* Performance Budget */}
      {budgetEnabled ? (
        <AdminCard title="Performance Budget" subtitle={`절대 상한 · 초과 시 FAIL${enforce ? '(BLOCK)' : '(권고)'} · Web Vital 예산은 web.dev NI 상한`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                {['Metric', 'value', 'budget', 'result'].map((h, i) => <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {budget.items.map((it) => (
                  <tr key={it.key} className="border-t border-line/10">
                    <td className="px-2 py-1.5">{it.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{budgetVal(it)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">≤ {budgetLimit(it)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <AdminBadge tone={it.pass == null ? 'neutral' : it.pass ? 'success' : (enforce ? 'danger' : 'warning')}>
                        {it.pass == null ? 'NO DATA' : it.pass ? 'PASS' : 'FAIL'}
                      </AdminBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-ink-dim">ⓘ Initial/Lazy JS 번들 예산은 빌드 시 측정값(텔레메트리 아님) — 문서 참조.</p>
        </AdminCard>
      ) : (
        <AdminAlert tone="info" title="Performance Budget 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_PERF_BUDGET_ENABLED=false</code></AdminAlert>
      )}

      {/* Quality components + Regression summary */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AdminCard title="Release Quality 구성요소" subtitle="가중 0..100 · 데이터 없는 항목은 무패널티">
          <div className="flex flex-wrap gap-1.5">
            {quality.components.filter((c) => c.score != null).map((c) => (
              <AdminBadge key={c.key} tone={c.score! >= 0.8 ? 'success' : c.score! >= 0.5 ? 'warning' : 'danger'}>
                {c.key} {Math.round((c.score ?? 0) * 100)}
              </AdminBadge>
            ))}
          </div>
          {quality.reasons.length > 0 && <ul className="mt-2 text-[11px] text-ink-mute">{quality.reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>}
        </AdminCard>

        <AdminCard title="Regression Budget (후보 vs 기준)" subtitle="abs+rel 임계 · confidence 포함">
          {!g.regression ? <AdminEmpty title="비교 기준 릴리스 없음" description="baseline 릴리스가 없어 회귀를 계산할 수 없습니다." /> : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <AdminBadge tone={g.regression.regressed > 0 ? 'danger' : 'success'}>회귀 {g.regression.regressed}</AdminBadge>
                <AdminBadge tone={g.regression.improved > 0 ? 'success' : 'neutral'}>개선 {g.regression.improved}</AdminBadge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                    {['Metric', 'Δ abs', 'Δ rel', 'class', 'conf'].map((h, i) => <th key={h} className={`px-2 py-1 ${i === 0 ? '' : 'text-right'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {g.regression.rows.filter((r) => r.classification !== 'INSUFFICIENT_DATA').slice(0, 12).map((r) => (
                      <tr key={r.key} className="border-t border-line/10">
                        <td className="px-2 py-1 text-[11px]">{r.label}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px]">{r.absDelta == null ? '—' : (r.unit === 'ratio' ? `${(r.absDelta * 100).toFixed(2)}%` : Math.round(r.absDelta * 1000) / 1000)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px]">{r.relDelta == null ? '—' : `${(r.relDelta * 100).toFixed(0)}%`}</td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={classTone(r.classification)}>{r.classification}</AdminBadge></td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={confTone(r.confidence)}>{r.confidence}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}

// ── Root Cause (WEB-OBS-4) ───────────────────────────────────────────────────
function RootCauseTab({ data, enabled, rollbackEnabled, timelineEnabled, correlationEnabled, graphEnabled }: {
  data: LoadState; enabled: boolean; rollbackEnabled: boolean; timelineEnabled: boolean; correlationEnabled: boolean; graphEnabled: boolean;
}) {
  if (!enabled) return <AdminAlert tone="info" title="Root Cause 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_ROOT_CAUSE_ENABLED=false</code></AdminAlert>;
  const rc = data.rootCause;
  if (!rc || !rc.candidate) return <AdminEmpty title="분석할 릴리스가 없습니다 — NO DATA" description="최근 기간에 원인 분석 대상 릴리스가 없습니다." />;
  const insufficient = rc.confidence === 'INSUFFICIENT' || rc.causes.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AdminBadge tone="primary">대상: <span className="font-mono">{rc.candidate}</span></AdminBadge>
        <AdminBadge tone="neutral">기준: <span className="font-mono">{rc.baseline ?? '—'}</span></AdminBadge>
        <AdminBadge tone={confTone(rc.confidence ?? 'INSUFFICIENT')}>confidence {rc.confidence}</AdminBadge>
      </div>

      {/* Incident explanation */}
      <AdminCard title={<span className="flex items-center gap-2"><Search size={16} /> Incident Explanation</span>} subtitle="Rule 기반 자동 설명 · 추측 없음">
        <ul className="space-y-1 text-xs text-ink-mute">
          {rc.explanation.map((line, i) => <li key={i}>• {line}</li>)}
        </ul>
      </AdminCard>

      {/* Rollback advisor */}
      {rollbackEnabled && rc.rollback && (
        <AdminCard title={<span className="flex items-center gap-2"><Undo2 size={16} /> Rollback Advisor</span>}
          subtitle="권고만 표시 — 실제 롤백은 수행되지 않습니다"
          action={<AdminBadge tone={rollbackTone(rc.rollback.status)}>{rc.rollback.status}</AdminBadge>}>
          <ul className="space-y-1 text-[11px] text-ink-mute">
            {rc.rollback.reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
          <p className="mt-2 text-[10px] text-ink-dim">confidence {rc.rollback.confidence} · 근거: Error Rate / Chunk Failure / Critical / Regression / Confidence</p>
        </AdminCard>
      )}

      {/* Root cause candidates */}
      <AdminCard title="가장 가능성 높은 원인" subtitle="score 내림차순 · 각 원인은 evidence 포함">
        {insufficient ? (
          <AdminEmpty title="INSUFFICIENT_DATA" description="표본이 부족하거나 특정 원인이 집중되지 않아 단정할 수 없습니다." />
        ) : (
          <div className="space-y-2">
            {rc.causes.map((c) => (
              <div key={c.code} className="rounded-md border border-line/10 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{c.title}</span>
                  <div className="flex items-center gap-1.5">
                    <AdminBadge tone={c.score >= 70 ? 'danger' : c.score >= 50 ? 'warning' : 'neutral'}>score {c.score}</AdminBadge>
                    <AdminBadge tone={confTone(c.confidence)}>{c.confidence}</AdminBadge>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                  {c.release && <AdminBadge tone="neutral">release <span className="font-mono">{c.release}</span></AdminBadge>}
                  {c.route && <AdminBadge tone="neutral">route <span className="font-mono">{c.route}</span></AdminBadge>}
                  {c.browser && <AdminBadge tone="neutral">browser {c.browser}</AdminBadge>}
                  <AdminBadge tone="neutral">affected {num(c.affectedSessions)} 세션</AdminBadge>
                </div>
                <ul className="mt-1 text-[11px] text-ink-mute">{c.evidence.map((e, i) => <li key={i}>— {e}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Evidence correlation */}
      {correlationEnabled && (
        <AdminCard title="Evidence Correlation" subtitle="규칙 기반 상관 강도(STRONG/MODERATE/WEAK/NONE)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                {['Pair', 'strength', 'score', 'evidence'].map((h, i) => <th key={h} className={`px-2 py-1.5 ${i === 3 ? '' : i === 0 ? '' : 'text-right'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rc.correlations.map((c) => (
                  <tr key={c.pair} className="border-t border-line/10">
                    <td className="px-2 py-1.5">{c.pair}</td>
                    <td className="px-2 py-1.5 text-right"><AdminBadge tone={corrTone(c.strength)}>{c.strength}</AdminBadge></td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">{c.scoreValue == null ? '—' : c.scoreValue}</td>
                    <td className="px-2 py-1.5 text-[11px] text-ink-mute">{c.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Release timeline + commit correlation */}
      {timelineEnabled && (
        <AdminCard title={<span className="flex items-center gap-2"><GitBranch size={15} /> Release Timeline</span>} subtitle="Deploy → Health → Error(commit=build id, 내용 미조회)">
          {rc.timeline.length === 0 ? <AdminEmpty title="타임라인 데이터 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                  {['Release', 'deploy', 'sessions', 'events', 'error rate', 'chunk', 'Δ vs prev', 'health'].map((h, i) => <th key={h} className={`px-2 py-1.5 ${i === 0 || i === 1 ? '' : 'text-right'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rc.timeline.map((t) => {
                    const cc = rc.commitCorrelation.find((c) => c.release === t.release);
                    return (
                      <tr key={t.release} className="border-t border-line/10">
                        <td className="px-2 py-1.5 font-mono text-[11px]">{t.release}</td>
                        <td className="px-2 py-1.5 text-[10px] text-ink-dim">{t.deployAt ? new Date(t.deployAt).toLocaleString('ko-KR') : '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(t.sessions)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(t.events)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(t.errorRate, 2)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{t.chunkSessions}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">{cc?.errorRateDeltaVsPrev == null ? '—' : `${(cc.errorRateDeltaVsPrev * 100).toFixed(2)}pp`}</td>
                        <td className="px-2 py-1.5 text-right"><AdminBadge tone={tlHealthTone(t.health)}>{t.health}</AdminBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* Service dependency graph */}
      {graphEnabled && (
        <AdminCard title={<span className="flex items-center gap-2"><Network size={15} /> Service Dependency Graph</span>} subtitle="정적 토폴로지 · 영향 노드 강조(표시 전용, 서비스 변경 없음)">
          <div className="flex flex-wrap gap-1.5">
            {rc.serviceGraph.nodes.map((n) => (
              <AdminBadge key={n.id} tone={n.impacted ? 'danger' : 'neutral'}>{n.label}{n.impacted ? ' ⚠' : ''}</AdminBadge>
            ))}
          </div>
          <p className="mt-2 font-mono text-[10px] text-ink-dim">
            {rc.serviceGraph.edges.map((e) => `${e.from}→${e.to}`).join(' · ')}
          </p>
        </AdminCard>
      )}
    </div>
  );
}

// ── Operations (WEB-OBS-5) ───────────────────────────────────────────────────
function OperationsTab({ data, cfg }: { data: LoadState; cfg: ReturnType<typeof getObservabilityConfig> }) {
  if (!cfg.operationalAdvisorEnabled) return <AdminAlert tone="info" title="Operational Advisor 비활성화됨"><code className="font-mono text-[11px]">VITE_OBSERVABILITY_OPERATIONAL_ADVISOR_ENABLED=false</code></AdminAlert>;
  const op = data.operations;
  if (!op || !op.advice) {
    return <AdminEmpty title="운영 권고 불가 — NO DATA / INSUFFICIENT_DATA" description={op?.release ? `${op.release}의 분석 데이터가 부족합니다.` : '분석 대상 릴리스가 없습니다.'} />;
  }
  const a = op.advice;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AdminBadge tone="primary">대상: <span className="font-mono">{op.release}</span></AdminBadge>
        {op.incidentType && <AdminBadge tone="neutral">{op.incidentType}</AdminBadge>}
        <AdminBadge tone={confTone(a.confidence)}>confidence {a.confidence}</AdminBadge>
        <AdminBadge tone="warning">권고 전용 · 자동 실행 없음</AdminBadge>
      </div>

      {/* Advisor headline */}
      <AdminCard title={<span className="flex items-center gap-2"><ClipboardList size={16} /> 권장 조치(Operational Advisor)</span>}
        subtitle="Rule 기반 · 승인 필요 · Production 조치는 수행되지 않습니다"
        action={<div className="flex items-center gap-1.5"><AdminBadge tone={actionTone(a.recommendedAction)}>{a.recommendedAction}</AdminBadge><AdminBadge tone={urgencyTone(a.urgency)}>{a.urgency} · {a.actionPriority}</AdminBadge></div>}>
        <p className="text-sm text-ink">{a.reason}</p>
        {a.evidence.length > 0 && <ul className="mt-1 text-[11px] text-ink-mute">{a.evidence.map((e, i) => <li key={i}>— {e}</li>)}</ul>}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <AdminBadge tone={a.safety.readOnly ? 'success' : 'warning'}>{a.safety.readOnly ? 'read-only' : 'production effect'}</AdminBadge>
          <AdminBadge tone="neutral">approval required</AdminBadge>
          <AdminBadge tone="neutral">automated: false</AdminBadge>
          <AdminBadge tone={a.safety.riskLevel === 'high' ? 'danger' : a.safety.riskLevel === 'medium' ? 'warning' : 'neutral'}>risk {a.safety.riskLevel}</AdminBadge>
          {a.escalationTarget !== 'NONE' && <AdminBadge tone={escalationTone(a.escalationTarget)}>escalate: {a.escalationTarget}</AdminBadge>}
        </div>
        {a.insufficientDataReason && <p className="mt-2 text-[11px] text-ink-mute">ⓘ {a.insufficientDataReason}</p>}
        <p className="mt-2 text-[10px] text-ink-dim">{a.safetyWarning}</p>
        {a.verificationSteps.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-ink">Verification Checklist</p>
            <ul className="space-y-0.5 text-[11px] text-ink-mute">{a.verificationSteps.map((s, i) => <li key={i}>☐ {s}</li>)}</ul>
          </div>
        )}
      </AdminCard>

      {/* Blast radius + Escalation + Lifecycle */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {cfg.blastRadiusEnabled && op.blastRadius && (
          <AdminCard title={<span className="flex items-center gap-2"><Target size={15} /> Blast Radius</span>}
            action={<AdminBadge tone={blastTone(op.blastRadius.level)}>{op.blastRadius.level}</AdminBadge>}>
            <div className="space-y-1 text-xs">
              <Field k="affected sessions" v={num(op.blastRadius.affectedSessions)} />
              <Field k="total sessions" v={op.blastRadius.totalSessions == null ? '—' : num(op.blastRadius.totalSessions)} />
              <Field k="impact rate" v={op.blastRadius.affectedSessionRate == null ? '— (denominator 없음)' : pct(op.blastRadius.affectedSessionRate, 2)} />
              <Field k="affected routes" v={num(op.blastRadius.affectedRoutes)} />
              <Field k="affected browsers" v={num(op.blastRadius.affectedBrowsers)} />
              <Field k="affected releases" v={num(op.blastRadius.affectedReleases)} />
              <Field k="primary scope" v={op.blastRadius.primaryScope ?? '—'} mono />
              <Field k="confidence" v={op.blastRadius.confidence} />
            </div>
            <p className="mt-1 text-[10px] text-ink-dim">ⓘ Session ≠ 사용자 수(익명 세션).</p>
          </AdminCard>
        )}
        {cfg.escalationEnabled && op.escalation && (
          <AdminCard title={<span className="flex items-center gap-2"><ArrowUpRight size={15} /> Escalation</span>}
            action={<AdminBadge tone={escalationTone(op.escalation.target)}>{op.escalation.target}</AdminBadge>}>
            <ul className="space-y-0.5 text-[11px] text-ink-mute">{op.escalation.reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>
            <p className="mt-2 text-[10px] text-ink-dim">SECURITY/EXECUTIVE는 실제 증거·광범위 장애에서만 사용.</p>
          </AdminCard>
        )}
        {cfg.incidentLifecycleEnabled && op.lifecycle && (
          <AdminCard title="Incident Lifecycle(제안)" action={<AdminBadge tone={lifecycleTone(op.lifecycle.suggestedStatus)}>{op.lifecycle.suggestedStatus}</AdminBadge>}>
            <p className="text-[11px] text-ink-mute">{op.lifecycle.note}</p>
            <p className="mt-2 text-[10px] text-ink-dim">상태는 운영자 소유 — 자동 RESOLVED/종료 없음(영속화는 다음 Phase).</p>
          </AdminCard>
        )}
      </div>

      {/* Impact */}
      {cfg.blastRadiusEnabled && op.impact && (
        <AdminCard title="Impact Analysis" subtitle="기술 영향 + 세션/라우트/브라우저/릴리스 · 비즈니스 영향 없음">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="error events" value={num(op.impact.technical.errorEvents)} tone="neutral" />
            <AdminStatCard label="critical" value={num(op.impact.technical.criticalErrors)} tone={op.impact.technical.criticalErrors > 0 ? 'danger' : 'success'} />
            <AdminStatCard label="chunk fail" value={num(op.impact.technical.chunkFailures)} tone={op.impact.technical.chunkFailures > 0 ? 'warning' : 'success'} />
            <AdminStatCard label="hydration" value={num(op.impact.technical.hydrationErrors)} tone={op.impact.technical.hydrationErrors > 0 ? 'warning' : 'success'} />
            <AdminStatCard label="memory risk" value={num(op.impact.technical.memoryRiskSessions)} tone={op.impact.technical.memoryRiskSessions > 0 ? 'warning' : 'success'} />
            <AdminStatCard label="session impact" value={op.impact.sessionImpact.rate == null ? '—' : pct(op.impact.sessionImpact.rate, 2)} tone="neutral" hint={`${num(op.impact.sessionImpact.affected)} 세션`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <AdminBadge tone={op.impact.routeImpact.playerRouteAffected ? 'warning' : 'neutral'}>Player route {op.impact.routeImpact.playerRouteAffected ? '영향' : '정상'}</AdminBadge>
            <AdminBadge tone={op.impact.routeImpact.adminRouteAffected ? 'warning' : 'neutral'}>Admin route {op.impact.routeImpact.adminRouteAffected ? '영향' : '정상'}</AdminBadge>
            {cfg.businessImpactEnabled && <AdminBadge tone="neutral">{op.impact.businessImpact}</AdminBadge>}
          </div>
          {cfg.businessImpactEnabled && <p className="mt-1 text-[10px] text-ink-dim">ⓘ {op.impact.businessImpactNote}</p>}
        </AdminCard>
      )}

      {/* Recovery */}
      {cfg.recoveryTrackingEnabled && (
        <AdminCard title={<span className="flex items-center gap-2"><HeartPulse size={15} /> Recovery Tracking</span>}
          action={op.recovery ? <AdminBadge tone={recoveryTone(op.recovery.status)}>{op.recovery.status}</AdminBadge> : <AdminBadge tone="neutral">NO DATA</AdminBadge>}>
          {!op.recovery ? <AdminEmpty title="복구 데이터 없음" description="관측 창/표본이 부족하거나 recovery RPC 응답이 없습니다." /> : (
            <div className="space-y-1 text-xs">
              <Field k="baseline error rate (incident)" v={op.recovery.baselineErrorRate == null ? '—' : pct(op.recovery.baselineErrorRate, 2)} />
              <Field k="current error rate (recent)" v={op.recovery.currentErrorRate == null ? '—' : pct(op.recovery.currentErrorRate, 2)} />
              <Field k="target" v={op.recovery.targetErrorRate == null ? '—' : pct(op.recovery.targetErrorRate, 2)} />
              <Field k="observation window" v={`${op.recovery.observationWindowMinutes}분`} />
              <Field k="recurrence" v={op.recovery.recurrence ? 'YES(재발)' : 'no'} />
              <Field k="confidence" v={op.recovery.confidence} />
              <Field k="operator close required" v={op.recovery.operatorCloseRequired ? 'YES' : 'no'} />
              {op.recovery.reasons.map((r, i) => <p key={i} className="text-[11px] text-ink-mute">• {r}</p>)}
              <p className="text-[10px] text-ink-dim">자동 복구 판정과 Incident 종료는 분리 — 실제 종료는 운영자 확인 필요.</p>
            </div>
          )}
        </AdminCard>
      )}

      {/* Playbook */}
      {cfg.playbookEnabled && op.playbook && (
        <AdminCard title={<span className="flex items-center gap-2"><ClipboardList size={15} /> Incident Playbook — {op.playbook.title}</span>}
          subtitle="표시 전용 체크리스트 · 모든 단계 destructive=false, automated=false">
          <div className="space-y-2">
            {op.playbook.steps.map((s) => (
              <div key={s.stepOrder} className="rounded-md border border-line/10 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{s.stepOrder}. {s.title}</span>
                  <AdminBadge tone={stepTone(s.status)}>{s.status}</AdminBadge>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-mute">{s.description}</p>
                <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[10px] text-ink-dim sm:grid-cols-2">
                  <span><b>목적:</b> {s.purpose}</span>
                  <span><b>evidence:</b> {s.requiredEvidence}</span>
                  <span><b>expected:</b> {s.expectedResult}</span>
                  <span><b>stop:</b> {s.stopCondition || '—'}</span>
                  <span><b>escalate:</b> {s.escalationCondition || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <p className="text-[10px] text-ink-dim">
        ⓘ 모든 조치는 권고이며 자동 실행되지 않습니다. 실제 Rollback/Deploy 중단/Release Block/DB 변경/외부 알림은 수행되지 않습니다.
      </p>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/5 py-0.5">
      <span className="text-ink-dim">{k}</span>
      <span className={mono ? 'font-mono text-ink' : 'text-ink'}>{v}</span>
    </div>
  );
}
