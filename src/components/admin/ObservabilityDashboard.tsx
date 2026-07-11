// WEB-OBS-2 — Admin Observability Dashboard.
//   Turns the persistent RUM store (WEB-OBS-1) into operational answers: health, release regression,
//   route/API risk, error fingerprints, browser anomalies and incident candidates. All verdicts are
//   computed client-side from server aggregates against shared, unit-tested thresholds; no raw
//   telemetry payloads are surfaced. Failure-isolated: a query error renders an inline retry — it
//   never reaches the global ErrorBoundary or app boot, and polling never retries infinitely.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, AlertTriangle, Clock, Filter, Activity, GitCompareArrows, Route as RouteIcon,
  Server, Bug, MonitorSmartphone, Siren, ShieldAlert,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getObservabilityOverview, getReleaseComparison, getObservabilityErrors, deriveIncidents,
  type OverviewResult, type ReleaseCompareResult, type ErrorsResult, type ObsWindow,
} from '@/lib/api/observabilityApi';
import {
  getObservabilityConfig, type HealthStatus, type MetricClassification, type Confidence,
  type IncidentSeverity, type Priority, type IncidentCandidate,
} from '@/lib/observability';

type ObsTab = 'overview' | 'releases' | 'routes' | 'apis' | 'errors' | 'devices' | 'incidents';

const TABS: Array<{ key: ObsTab; label: string; icon: JSX.Element }> = [
  { key: 'overview', label: 'Overview', icon: <Activity size={13} /> },
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

interface LoadState {
  overview: OverviewResult | null;
  release: ReleaseCompareResult | null;
  errors: ErrorsResult | null;
  incidents: IncidentCandidate[];
}

export default function ObservabilityDashboard() {
  const cfg = getObservabilityConfig();
  const [tab, setTab] = useState<ObsTab>('overview');
  const [win, setWin] = useState<ObsWindow>('24h');
  const [release, setRelease] = useState('');
  const [environment, setEnvironment] = useState('');
  const [browser, setBrowser] = useState('');
  const [auto, setAuto] = useState(false);

  const [state, setState] = useState<LoadState>({ overview: null, release: null, errors: null, incidents: [] });
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
    const [ov, rel, err] = await Promise.allSettled([
      getObservabilityOverview(filters),
      cfg.releaseComparisonEnabled ? getReleaseComparison({ window: win, environment: environment || null }) : Promise.resolve(null),
      getObservabilityErrors(filters),
    ]);
    if (myReq !== reqSeq.current) return; // superseded

    const overview = ov.status === 'fulfilled' ? ov.value : null;
    const releaseRes = rel.status === 'fulfilled' ? rel.value : null;
    const errorsRes = err.status === 'fulfilled' ? err.value : null;
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
    setState({ overview, release: releaseRes, errors: errorsRes, incidents });
    setFetchedAt(new Date());
    setStale(false);
    if (anyFail) setError('일부 위젯을 불러오지 못했습니다(부분 표시).');
    if (!opts?.silent) setLoading(false);
  }, [win, release, environment, browser, cfg.releaseComparisonEnabled, cfg.incidentDetectionEnabled]);

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

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/5 py-0.5">
      <span className="text-ink-dim">{k}</span>
      <span className={mono ? 'font-mono text-ink' : 'text-ink'}>{v}</span>
    </div>
  );
}
