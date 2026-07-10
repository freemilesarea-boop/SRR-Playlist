// WEB-OBS-1 — Admin Runtime Telemetry: Server History view.
//   Cross-session/user/release/browser/route aggregation from the persistent RUM store, via the
//   super-admin-only `admin_query_runtime_telemetry` RPC (parameterized, allow-list filters).
//   All numbers are server-computed; this component only renders. No raw PII is ever surfaced.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle, Clock, Filter } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, type AdminToneName,
} from '@/components/admin/ui';
import {
  adminQueryRuntimeTelemetry, type TelemetryQueryResult, type TelemetryWindow,
} from '@/lib/api/runtimeTelemetryApi';

const WINDOWS: Array<{ key: TelemetryWindow; label: string }> = [
  { key: '1h', label: '최근 1시간' },
  { key: '24h', label: '최근 24시간' },
  { key: '7d', label: '최근 7일' },
  { key: '30d', label: '최근 30일' },
];

const POLL_MS = 60_000;

function ms(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n)}ms`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`;
}
function fmtTime(d: Date): string {
  try { return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return d.toISOString(); }
}

export default function RuntimeTelemetryServerHistory() {
  const [win, setWin] = useState<TelemetryWindow>('24h');
  const [eventType, setEventType] = useState<string>('');
  const [browser, setBrowser] = useState<string>('');
  const [data, setData] = useState<TelemetryQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const timerRef = useRef<number | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const myReq = ++reqSeq.current;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await adminQueryRuntimeTelemetry({
        window: win,
        eventType: eventType || null,
        browser: browser || null,
        limit: 50,
      });
      if (myReq !== reqSeq.current) return; // a newer request superseded this one
      setData(res);
      setFetchedAt(new Date());
      setStale(false);
    } catch (e) {
      if (myReq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : '조회에 실패했습니다.');
      setStale(true);
    } finally {
      if (myReq === reqSeq.current && !opts?.silent) setLoading(false);
    }
  }, [win, eventType, browser]);

  // Load on filter change.
  useEffect(() => { void load(); }, [load]);

  // Poll only while the tab is visible; pause in background; always clean up.
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState !== 'visible') return;
      setStale(true);
      void load({ silent: true });
    };
    const id = window.setInterval(tick, POLL_MS);
    timerRef.current = id;
    return () => { window.clearInterval(id); timerRef.current = null; };
  }, [load]);

  const s = data?.summary;
  const total = data?.total ?? 0;
  const errorCount = s?.by_type?.error ?? 0;
  const chunkFailures = (s?.errors ?? []).filter((e) => e.kind === 'chunk-load').reduce((n, e) => n + e.count, 0);
  const errorRate = total > 0 ? errorCount / total : 0;
  const slowestRoute = (s?.routes ?? []).reduce<{ route: string; v: number } | null>((m, r) => {
    const v = r.avg_duration ?? 0;
    return !m || v > m.v ? { route: r.route, v } : m;
  }, null);
  const slowestApi = (s?.apis ?? [])[0] ?? null;
  const worstLongTask = (s?.long_tasks ?? [])[0] ?? null;
  const vital = (name: string) => s?.vitals?.[name];

  const errorTone: AdminToneName = errorRate >= 0.05 ? 'danger' : errorRate >= 0.01 ? 'warning' : 'success';

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((w) => (
            <AdminButton
              key={w.key}
              size="sm"
              tone={win === w.key ? 'primary' : 'neutral'}
              variant={win === w.key ? 'solid' : 'outline'}
              onClick={() => setWin(w.key)}
            >
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
          <AdminButton size="sm" tone="neutral" variant="subtle" leftIcon={<RefreshCw size={13} />} onClick={() => void load()}>
            새로고침
          </AdminButton>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-ink-dim"><Filter size={12} /> 필터</span>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="rounded-md border border-line/20 bg-surface px-2 py-1 text-ink"
          aria-label="이벤트 타입"
        >
          <option value="">모든 이벤트</option>
          {['vital', 'route', 'api', 'longtask', 'interaction', 'error', 'memory'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={browser}
          onChange={(e) => setBrowser(e.target.value)}
          className="rounded-md border border-line/20 bg-surface px-2 py-1 text-ink"
          aria-label="브라우저"
        >
          <option value="">모든 브라우저</option>
          {['Chrome', 'Safari', 'Firefox', 'Edge', 'Other'].map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {error && (
        <AdminCard>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-ink-mute">
              <AlertTriangle size={14} /> {error}
            </p>
            <AdminButton size="sm" tone="neutral" variant="outline" onClick={() => void load()}>재시도</AdminButton>
          </div>
        </AdminCard>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <AdminSkeleton key={i} className="h-20" />)}
        </div>
      ) : !data || total === 0 ? (
        <AdminEmpty
          title="수집된 서버 텔레메트리가 없습니다"
          description="선택한 기간·필터에 해당하는 이벤트가 아직 없습니다. Preview 환경에서 앱을 사용하면 데이터가 쌓입니다."
        />
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="총 이벤트" value={<span className="tabular-nums">{total.toLocaleString()}</span>} tone="neutral" />
            <AdminStatCard label="에러" value={<span className="tabular-nums">{errorCount.toLocaleString()}</span>}
              tone={errorTone} hint={`error rate ${pct(errorRate)}`} />
            <AdminStatCard label="Chunk 실패" value={<span className="tabular-nums">{chunkFailures}</span>}
              tone={chunkFailures > 0 ? 'danger' : 'success'} />
            <AdminStatCard label="Slow Route" value={<span className="tabular-nums">{ms(slowestRoute?.v ?? null)}</span>}
              tone="neutral" hint={slowestRoute?.route ?? '—'} />
            <AdminStatCard label="Slow API" value={<span className="tabular-nums">{ms(slowestApi?.worst ?? null)}</span>}
              tone={(slowestApi?.worst ?? 0) >= 1000 ? 'danger' : (slowestApi?.worst ?? 0) >= 500 ? 'warning' : 'success'} />
            <AdminStatCard label="Long Task worst" value={<span className="tabular-nums">{ms(worstLongTask?.worst ?? null)}</span>}
              tone={(worstLongTask?.worst ?? 0) >= 200 ? 'warning' : 'success'} />
          </div>

          {/* Web Vitals (server percentiles) */}
          <AdminCard title="Web Vitals (서버 p50/p75/p95)" subtitle="여러 세션 집계값 · payload 값 기반">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].map((name) => {
                const v = vital(name);
                const isCls = name === 'CLS';
                const p75 = v?.p75 ?? null;
                return (
                  <AdminStatCard
                    key={name}
                    label={name}
                    value={<span className="tabular-nums">{v ? (isCls ? (p75 ?? 0).toFixed(3) : ms(p75)) : '—'}</span>}
                    tone={v && v.poor > 0 ? 'warning' : 'neutral'}
                    hint={v ? `n=${v.count} · p95 ${isCls ? (v.p95 ?? 0).toFixed(3) : ms(v.p95)}` : '데이터 없음'}
                  />
                );
              })}
            </div>
          </AdminCard>

          {/* Slow routes + Slow APIs */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <AdminCard title="Slow Routes" subtitle="평균 dwell 기준 상위">
              <MiniTable
                head={['Route', 'count', 'avg']}
                rows={(s?.routes ?? []).slice(0, 20).map((r) => [r.route, String(r.count), ms(r.avg_duration)])}
                empty="라우트 데이터 없음"
              />
            </AdminCard>
            <AdminCard title="Slow APIs" subtitle="worst duration 기준 상위 · host+path만">
              <MiniTable
                head={['Endpoint', 'n', 'worst', 'p95']}
                rows={(s?.apis ?? []).slice(0, 20).map((a) => [a.name, String(a.count), ms(a.worst), ms(a.p95)])}
                empty="API 데이터 없음"
              />
            </AdminCard>
          </div>

          {/* Errors + Long tasks */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <AdminCard title="Errors Top 20" subtitle="sanitized 메시지 기준(개인정보 제거됨)">
              <MiniTable
                head={['kind', 'message', 'count']}
                rows={(s?.errors ?? []).slice(0, 20).map((e) => [e.kind, e.message, String(e.count)])}
                empty="오류 없음"
              />
            </AdminCard>
            <AdminCard title="Long Tasks Top 20" subtitle="route 별 worst">
              <MiniTable
                head={['Route', 'count', 'worst', 'p95']}
                rows={(s?.long_tasks ?? []).slice(0, 20).map((l) => [l.route, String(l.count), ms(l.worst), ms(l.p95)])}
                empty="Long Task 없음"
              />
            </AdminCard>
          </div>

          {/* Breakdown chips */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <BreakdownCard title="Browser 분포" data={s?.browsers ?? {}} />
            <BreakdownCard title="Device 분포" data={s?.devices ?? {}} />
            <BreakdownCard title="Release 분포" data={s?.releases ?? {}} mono />
          </div>

          <p className="text-[10px] text-ink-dim">
            ⓘ 서버 영속 RUM · 30일 원시 보존 · 저카디널리티 버킷 차원만 저장(토큰·이메일·쿼리스트링·원문 없음).
            폴링 60초(탭 활성 시)로 갱신됩니다.
          </p>
        </>
      )}
    </div>
  );
}

function MiniTable({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <AdminEmpty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
            {head.map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i === 0 ? '' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line/10">
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-2 py-1.5 ${ci === 0 ? 'font-mono text-[11px] max-w-[280px] truncate' : 'text-right tabular-nums'}`}
                  title={ci === 0 ? cell : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownCard({ title, data, mono }: { title: string; data: Record<string, number>; mono?: boolean }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <AdminCard title={title}>
      {entries.length === 0 ? (
        <AdminEmpty title="데이터 없음" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => (
            <AdminBadge key={k} tone="neutral">
              <span className={mono ? 'font-mono' : ''}>{k}</span>: {v.toLocaleString()}
            </AdminBadge>
          ))}
        </div>
      )}
    </AdminCard>
  );
}
