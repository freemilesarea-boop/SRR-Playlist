// WEB-OPT-11 — Admin Runtime Telemetry (RUM) dashboard.
//   Pull-based: reads getTelemetrySnapshot() into local state (manual + optional auto refresh).
//   Data is THIS browser session only (client-side bounded ring buffers). Cross-user/historical
//   aggregation requires a server sink (DB/RPC/edge) which is out of scope this phase.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw, Trash2, Gauge, AlertTriangle, Cpu, Timer, Database, Send } from 'lucide-react';
import { AdminCard, AdminStatCard, AdminSection, AdminBadge, AdminButton, AdminEmpty, type AdminToneName } from '@/components/admin/ui';
import {
  getTelemetrySnapshot, clearTelemetry, isTelemetryReady, getTransportHealth, getTelemetryConfig,
  type TelemetrySnapshot,
} from '@/lib/telemetry';
import {
  durationStats, topSlowByKey, durationBuckets, classifyApiDuration, type Rating, type ApiSeverity,
} from '@/lib/telemetry/aggregate';
import RuntimeTelemetryServerHistory from '@/components/admin/RuntimeTelemetryServerHistory';

type DashMode = 'session' | 'server';

function ratingTone(r: Rating): AdminToneName {
  return r === 'good' ? 'success' : r === 'needs-improvement' ? 'warning' : 'danger';
}
function severityTone(s: ApiSeverity): AdminToneName {
  return s === 'safe' ? 'success' : s === 'warn' ? 'warning' : 'danger';
}
function ms(n: number | null): string {
  return n == null ? '—' : `${Math.round(n)}ms`;
}

export default function RuntimeTelemetryPanel() {
  const [mode, setMode] = useState<DashMode>('session');
  const [snap, setSnap] = useState<TelemetrySnapshot>(() => getTelemetrySnapshot());
  const [auto, setAuto] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(() => setSnap(getTelemetrySnapshot()), []);

  // auto-refresh (5s) while enabled; cleaned up on unmount / toggle (WEB-OPT-8 timer discipline).
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(refresh, 5000);
    timerRef.current = id;
    return () => { window.clearInterval(id); timerRef.current = null; };
  }, [auto, refresh]);

  const d = snap.device;
  const apiDurations = useMemo(() => snap.apis.map((a) => a.duration), [snap.apis]);
  const longTaskStats = useMemo(() => durationStats(snap.longTasks.map((t) => t.duration)), [snap.longTasks]);
  const interactionStats = useMemo(() => durationStats(snap.interactions.map((i) => i.duration)), [snap.interactions]);
  const apiBuckets = useMemo(() => durationBuckets(apiDurations), [apiDurations]);
  const slowRoutes = useMemo(
    () => topSlowByKey(snap.routes.filter((r) => r.duration != null), (r) => r.route, (r) => r.duration ?? 0, 8),
    [snap.routes],
  );
  const slowApis = useMemo(
    () => topSlowByKey(snap.apis, (a) => a.name, (a) => a.duration, 10),
    [snap.apis],
  );
  const errorsByKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of snap.errors) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [snap.errors]);
  const latestMem = snap.memory[snap.memory.length - 1] ?? null;
  const peakMem = useMemo(() => snap.memory.reduce((m, s) => Math.max(m, s.usedMb), 0), [snap.memory]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Activity size={20} className="text-accent" /> 런타임 텔레메트리 (RUM)
          </h1>
          <p className="text-xs text-ink-mute">
            네이티브 PerformanceObserver 기반 · <span className="font-semibold">현재 브라우저 세션</span> 수집분 ·
            build <span className="font-mono text-ink-dim">{snap.buildId}</span>
          </p>
        </div>
        {mode === 'session' && (
          <div className="flex items-center gap-2">
            <AdminButton tone="neutral" variant="subtle" size="sm" onClick={refresh} leftIcon={<RefreshCw size={13} />}>
              새로고침
            </AdminButton>
            <AdminButton tone={auto ? 'primary' : 'neutral'} variant={auto ? 'solid' : 'outline'} size="sm" onClick={() => setAuto((v) => !v)}>
              자동 {auto ? 'ON' : 'OFF'}
            </AdminButton>
            <AdminButton tone="danger" variant="subtle" size="sm" onClick={() => { clearTelemetry(); refresh(); }} leftIcon={<Trash2 size={13} />}>
              초기화
            </AdminButton>
          </div>
        )}
      </header>

      {/* Mode toggle — 현재 브라우저 세션(WEB-OPT-11) vs 서버 영속 히스토리(WEB-OBS-1) */}
      <div className="flex items-center gap-1.5">
        <AdminButton size="sm" tone={mode === 'session' ? 'primary' : 'neutral'} variant={mode === 'session' ? 'solid' : 'outline'}
          onClick={() => setMode('session')} leftIcon={<Activity size={13} />}>
          현재 세션
        </AdminButton>
        <AdminButton size="sm" tone={mode === 'server' ? 'primary' : 'neutral'} variant={mode === 'server' ? 'solid' : 'outline'}
          onClick={() => setMode('server')} leftIcon={<Database size={13} />}>
          서버 히스토리
        </AdminButton>
      </div>

      {mode === 'server' && <RuntimeTelemetryServerHistory />}

      {mode === 'session' && (<>
      <TransportHealthCard />

      {!isTelemetryReady() && (
        <AdminCard>
          <p className="text-xs text-ink-mute">텔레메트리가 초기화되지 않았습니다(브라우저 미지원 또는 SSR). 수집 데이터가 없습니다.</p>
        </AdminCard>
      )}

      {/* Web Vitals */}
      <AdminSection title="Web Vitals" description="표준 PerformanceEntry 값. LCP/CLS/INP는 세션 근사값(아래 주석 참고).">
        {snap.vitals.length === 0 ? (
          <AdminEmpty title="아직 수집된 Web Vitals 가 없습니다" description="화면을 조작하면 값이 채워집니다." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {snap.vitals.map((v) => (
              <AdminStatCard
                key={v.name}
                label={v.name}
                value={<span className="tabular-nums">{v.name === 'CLS' ? v.value.toFixed(3) : ms(v.value)}</span>}
                tone={ratingTone(v.rating)}
                hint={v.rating}
              />
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-ink-dim">
          * LCP=최신 후보, CLS=recent-input 제외 누적합, INP≈=Event Timing 최대 상호작용 지연(web-vitals 세션 알고리즘과 상이).
        </p>
      </AdminSection>

      {/* Long tasks / interactions / memory summary */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <AdminStatCard label="Long Tasks (≥50ms)" value={<span className="tabular-nums">{longTaskStats.count}</span>}
          icon={<Timer size={16} />} tone={longTaskStats.count > 0 ? 'warning' : 'success'}
          hint={`p95 ${ms(longTaskStats.p95)} · worst ${ms(longTaskStats.worst)}`} />
        <AdminStatCard label="Interaction 지연" value={<span className="tabular-nums">{ms(interactionStats.p75)}</span>}
          icon={<Gauge size={16} />} tone="neutral" hint={`p75 · worst ${ms(interactionStats.worst)} · n=${interactionStats.count}`} />
        <AdminStatCard label="JS Heap (used)" value={<span className="tabular-nums">{latestMem ? `${latestMem.usedMb}MB` : '미지원'}</span>}
          icon={<Cpu size={16} />} tone="neutral" hint={latestMem ? `peak ${peakMem}MB / limit ${latestMem.limitMb}MB` : 'performance.memory 미지원 브라우저'} />
      </div>

      {/* Slow routes */}
      <AdminCard title="Slow Routes (세션 dwell)" subtitle="이전 라우트 체류 시간 기준 상위. 라우트 id 는 익명화됨.">
        {slowRoutes.length === 0 ? <AdminEmpty title="라우트 이동 기록이 없습니다" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-2 py-1.5">Route</th><th className="px-2 py-1.5 text-right">count</th><th className="px-2 py-1.5 text-right">worst</th><th className="px-2 py-1.5 text-right">p95</th>
              </tr></thead>
              <tbody>
                {slowRoutes.map((r) => (
                  <tr key={r.key} className="border-t border-line/10">
                    <td className="px-2 py-1.5 font-mono text-xs">{r.key}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.worst)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{ms(r.p95)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {/* Slow APIs */}
      <AdminCard
        title="Slow APIs"
        subtitle="fetch/XHR resource-timing 기준. URL 은 host+path 만(쿼리·id 제거)."
        action={<div className="flex gap-1.5 text-[10px]">
          <AdminBadge tone="neutral">≥200ms: {apiBuckets.over200}</AdminBadge>
          <AdminBadge tone="warning">≥500ms: {apiBuckets.over500}</AdminBadge>
          <AdminBadge tone="danger">≥1s: {apiBuckets.over1000}</AdminBadge>
          <AdminBadge tone="danger">≥3s: {apiBuckets.over3000}</AdminBadge>
        </div>}
      >
        {slowApis.length === 0 ? <AdminEmpty title="API 호출 기록이 없습니다" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-2 py-1.5">Endpoint</th><th className="px-2 py-1.5 text-right">n</th><th className="px-2 py-1.5 text-right">worst</th><th className="px-2 py-1.5 text-right">p95</th><th className="px-2 py-1.5 text-right">sev</th>
              </tr></thead>
              <tbody>
                {slowApis.map((a) => (
                  <tr key={a.key} className="border-t border-line/10">
                    <td className="px-2 py-1.5 font-mono text-[11px] max-w-[280px] truncate" title={a.key}>{a.key}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{ms(a.worst)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{ms(a.p95)}</td>
                    <td className="px-2 py-1.5 text-right"><AdminBadge tone={severityTone(classifyApiDuration(a.worst))}>{classifyApiDuration(a.worst)}</AdminBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {/* Errors + Device */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AdminCard title="Errors" subtitle="메시지는 email/JWT/uuid/긴 숫자 redact 후 저장(샘플링 없음).">
          {snap.errors.length === 0 ? <AdminEmpty title="기록된 오류가 없습니다" /> : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {errorsByKind.map(([kind, count]) => (
                  <AdminBadge key={kind} tone={kind === 'react' || kind === 'chunk-load' ? 'danger' : 'warning'}>
                    {kind}: {count}
                  </AdminBadge>
                ))}
              </div>
              <ul className="space-y-1 text-[11px] text-ink-mute">
                {snap.errors.slice(-6).reverse().map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0 text-ink-dim" />
                    <span className="font-mono">[{e.kind}] {e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AdminCard>

        <AdminCard title="Device / Environment" subtitle="개인정보 없음 — 브라우저·OS·뷰포트·네트워크 등급만.">
          {!d ? <AdminEmpty title="디바이스 정보 없음" /> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {([
                ['Browser', d.browser], ['OS', d.os], ['Viewport', `${d.viewport} @${d.dpr}x`],
                ['CPU cores', d.hardwareConcurrency ?? '—'], ['Device memory', d.deviceMemoryGb ? `${d.deviceMemoryGb}GB` : '—'],
                ['Network', d.networkType ?? '—'], ['Language', d.language], ['Timezone', d.timezone],
                ['Touch', d.touch ? 'yes' : 'no'], ['Reduced motion', d.reducedMotion ? 'yes' : 'no'], ['Dark mode', d.darkMode ? 'yes' : 'no'],
              ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-line/5 py-0.5">
                  <dt className="text-ink-dim">{k}</dt><dd className="font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </AdminCard>
      </div>

      <p className="text-[10px] text-ink-dim">
        ⓘ <span className="font-semibold">현재 세션</span> 탭은 이 브라우저 세션의 클라이언트 측 bounded buffer 만 표시합니다.
        1h/24h/7d/30d 다중 사용자·릴리스·브라우저 집계와 p95/p99 히스토리는 <span className="font-semibold">서버 히스토리</span> 탭(영속 RUM)에서 확인하세요.
      </p>
      </>)}
    </div>
  );
}

/**
 * Transport health — shows whether persistent RUM transmission is on and healthy for THIS session.
 * Reads a cheap snapshot (no timers here; refreshes when the parent re-renders / auto is on). Never
 * re-emits telemetry about telemetry (no self-referential loop).
 */
function TransportHealthCard() {
  const cfg = getTelemetryConfig();
  const h = getTransportHealth();
  const off = !cfg.collectionEnabled || !cfg.transportEnabled;
  return (
    <AdminCard
      title="Telemetry Transport"
      subtitle="서버 영속 전송 상태(현재 세션) · sendBeacon 우선 · 실패는 앱에 전파되지 않음"
      action={
        <AdminBadge tone={off ? 'neutral' : 'success'}>
          {off ? 'OFF (kill switch)' : `ON · ${cfg.environment}`}
        </AdminBadge>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        {([
          ['queued', h.queued], ['sent', h.sent], ['accepted', h.accepted],
          ['rejected', h.rejected], ['dropped', h.dropped], ['retries', h.retries],
        ] as Array<[string, number]>).map(([k, v]) => (
          <div key={k} className="rounded-md bg-bg-deep/40 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-dim">{k}</div>
            <div className="tabular-nums text-ink">{v.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-dim">
        <AdminBadge tone="neutral"><Send size={10} className="mr-0.5" />{h.transportType}</AdminBadge>
        <AdminBadge tone="neutral">batch {cfg.batchSize}</AdminBadge>
        <AdminBadge tone="neutral">flush {Math.round(cfg.flushIntervalMs / 1000)}s</AdminBadge>
        <AdminBadge tone="neutral">buffer {h.bufferCapacity}</AdminBadge>
        <AdminBadge tone="neutral">sample {cfg.baseSampleRate}</AdminBadge>
        {h.lastErrorCategory && <AdminBadge tone="warning">last err: {h.lastErrorCategory}</AdminBadge>}
      </div>
    </AdminCard>
  );
}
