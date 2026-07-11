/**
 * StreamingQualityDashboard — WEB-OBS-7 스트리밍 품질 인텔리전스 (읽기 전용).
 *
 * 실제 재생 경험 품질(playback start / TTFA_APPROX / crossfade / stall / media error / preload /
 * recovery)을 요약·분석한다. 모든 판정은 클라이언트 순수 engine(src/lib/streamingQuality)에서 계산되며,
 * 자동 재생 제어/Reload/Rollback/원격 Player 제어 버튼은 존재하지 않는다(관측·권고 전용).
 * 실제 Signal이 없으면 NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA 로 표시하고 가짜 수치를 만들지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Gauge, PlayCircle, Timer, Shuffle, AlertTriangle, Wifi, ArrowUpRight } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getStreamingQualityOverview, getStreamingQualityErrors,
  type SqWindow, type StreamingQualityBundle, type StreamingQualityErrors,
} from '@/lib/api/streamingQualityApi';
import { getStreamingQualityConfig } from '@/lib/streamingQuality/config';

const WINDOWS: SqWindow[] = ['1h', '24h', '7d', '30d'];
const MEDIA_CODE_LABEL: Record<string, string> = { '0': 'UNKNOWN', '1': 'ABORTED', '2': 'NETWORK', '3': 'DECODE', '4': 'SRC_NOT_SUPPORTED' };

function qtone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'HEALTHY': case 'SUCCESS': case 'SEAMLESS': case 'STABLE': case 'GOOD': return 'success';
    case 'WATCH': case 'DEGRADED': case 'ACCEPTABLE': case 'ELEVATED': case 'LOW': case 'OK': case 'GAP_WARNING': case 'OVERLAP_WARNING': case 'RECOVERING': return 'warning';
    case 'CRITICAL': case 'FAILING': case 'HIGH': case 'GAP_CRITICAL': case 'FAILED': case 'INTERRUPTED': case 'SLOW': return 'danger';
    case 'NOT_AVAILABLE': case 'NOT_ATTEMPTED': case 'NO_DATA': case 'PLAYBACK_PROGRESSING': return 'info';
    default: return 'neutral';
  }
}
function sevTone(s: string): AdminToneName { return s === 'CRITICAL' || s === 'HIGH' ? 'danger' : s === 'MEDIUM' ? 'warning' : 'info'; }
function urgTone(u: string): AdminToneName { return u === 'CRITICAL' ? 'danger' : u === 'HIGH' ? 'warning' : u === 'MEDIUM' ? 'info' : 'neutral'; }
function pct(n: number | null): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function ms(n: number | null): string { return n == null ? 'NO DATA' : `${n}ms`; }

export default function StreamingQualityDashboard() {
  const cfg = getStreamingQualityConfig();
  const [win, setWin] = useState<SqWindow>('24h');
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StreamingQualityBundle | null>(null);
  const [errors, setErrors] = useState<StreamingQualityErrors | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const reqSeq = useRef(0);
  const failStreak = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!cfg.dashboardEnabled) return;
    const myReq = ++reqSeq.current;
    if (!opts?.silent) { setLoading(true); setError(null); }
    try {
      const [ov, err] = await Promise.allSettled([getStreamingQualityOverview(win), getStreamingQualityErrors(win)]);
      if (myReq !== reqSeq.current) return;
      failStreak.current = 0;
      setData(ov.status === 'fulfilled' ? ov.value : null);
      setErrors(err.status === 'fulfilled' ? err.value : null);
      if (ov.status === 'rejected' && err.status === 'rejected') { setError('스트리밍 품질 데이터를 불러오지 못했습니다(마이그레이션 미적용 시 NO DATA).'); setStale(true); }
      else setStale(false);
      setFetchedAt(new Date());
    } catch {
      if (myReq !== reqSeq.current) return;
      failStreak.current += 1;
      setError('스트리밍 품질 데이터를 불러오지 못했습니다.'); setStale(true);
    } finally {
      if (myReq === reqSeq.current && !opts?.silent) setLoading(false);
    }
  }, [win, cfg.dashboardEnabled]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto || !cfg.autoRefreshEnabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (failStreak.current >= 3) return;
      setStale(true); void load({ silent: true });
    }, cfg.autoRefreshMs);
    return () => window.clearInterval(id);
  }, [auto, cfg.autoRefreshEnabled, cfg.autoRefreshMs, load]);

  if (!cfg.dashboardEnabled) {
    return <AdminAlert tone="info" title="스트리밍 품질 대시보드 비활성" description="VITE_SQ_DASHBOARD_ENABLED=false 로 비활성화되어 있습니다." />;
  }

  const o = data?.overall;
  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => <AdminButton key={w} size="sm" variant={w === win ? 'solid' : 'ghost'} tone={w === win ? 'primary' : 'neutral'} onClick={() => setWin(w)}>{w}</AdminButton>)}
        </div>
        <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<RefreshCw size={13} />} onClick={() => void load()}>새로고침</AdminButton>
        <AdminButton size="sm" variant={auto ? 'solid' : 'ghost'} tone={auto ? 'primary' : 'neutral'} onClick={() => setAuto((v) => !v)}>{auto ? '자동 새로고침 ON' : '자동 새로고침 OFF'}</AdminButton>
        {fetchedAt && <span className="text-caption text-fg-muted">업데이트 {fetchedAt.toLocaleTimeString()}{stale ? ' · stale' : ''}</span>}
        {!cfg.telemetryEnabled && <AdminBadge tone="neutral">emit OFF(opt-in)</AdminBadge>}
      </div>

      {error && <AdminAlert tone="warning" title="로드 실패" description={error} action={<AdminButton size="sm" tone="warning" onClick={() => void load()}>재시도</AdminButton>} />}

      {loading && !data ? (
        <AdminSkeleton className="h-40" />
      ) : !o || (o.status === 'INSUFFICIENT_DATA' && o.sessions === 0) ? (
        <AdminEmpty icon={<Gauge size={20} />} title="스트리밍 품질 데이터 없음" description="아직 품질 이벤트가 없습니다. emit flag(VITE_SQ_TELEMETRY_ENABLED) 활성 + 재생 시 수집됩니다(migration 미적용 시 NO DATA)." />
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="Quality Score" value={o.score ?? '—'} icon={<Gauge size={14} />} tone={qtone(o.status)} hint={o.status} />
            <AdminStatCard label="Signal Coverage" value={`${Math.round(o.signalCoverage * 100)}%`} tone={o.signalCoverage >= 0.7 ? 'success' : 'warning'} hint="측정 신호 범위" />
            <AdminStatCard label="Sessions" value={o.sessions} tone="primary" />
            <AdminStatCard label="Start Success" value={pct(o.start.successRate)} icon={<PlayCircle size={14} />} tone={qtone(o.start.status)} />
            <AdminStatCard label="TTFA_APPROX p75" value={ms(o.ttfa.p75)} icon={<Timer size={14} />} tone={o.ttfa.p75 == null ? 'neutral' : o.ttfa.p75 <= 1000 ? 'success' : o.ttfa.p75 <= 2500 ? 'warning' : 'danger'} hint="요청→최초 진행(근사)" />
            <AdminStatCard label="Crossfade 완료" value={o.crossfade.status === 'NOT_AVAILABLE' ? 'N/A' : pct(o.crossfade.completionRate)} icon={<Shuffle size={14} />} tone={qtone(o.crossfade.status)} />
            <AdminStatCard label="Stall 세션" value={o.stall.status === 'NO_DATA' ? 'NO DATA' : pct(o.stall.sessionRate)} tone={qtone(o.stall.status)} />
            <AdminStatCard label="Media Error 세션" value={o.mediaError.status === 'NO_DATA' ? 'NO DATA' : pct(o.mediaError.sessionRate)} icon={<AlertTriangle size={14} />} tone={qtone(o.mediaError.status)} />
            <AdminStatCard label="Preload Ready" value={o.preload.status === 'NOT_AVAILABLE' ? 'N/A' : pct(o.preload.readyRate)} tone={qtone(o.preload.status)} />
            <AdminStatCard label="Recovery 성공" value={o.recovery.status === 'NOT_ATTEMPTED' ? 'N/A' : pct(o.recovery.successRate)} icon={<Wifi size={14} />} tone={qtone(o.recovery.status)} />
            <AdminStatCard label="Critical Incidents" value={(data?.incidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length) ?? 0} tone={(data?.incidents.length ?? 0) > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Start Requests(pev2)" value={data?.startFunnel?.requests ?? '—'} tone="neutral" hint="기존 재생 funnel(창 단위)" />
          </div>

          {/* Per-dimension status strip */}
          <AdminCard title="품질 신호 상태 (신호 없으면 NO_DATA / NOT_AVAILABLE)">
            <div className="flex flex-wrap gap-2">
              <AdminBadge tone={qtone(o.start.status)}>Start {o.start.status}</AdminBadge>
              <AdminBadge tone={o.ttfa.p75 == null ? 'info' : 'neutral'}>TTFA {o.ttfa.p75 == null ? 'NO_DATA' : `${o.ttfa.p75}ms`}</AdminBadge>
              <AdminBadge tone={qtone(o.transition.status)}>Transition {o.transition.status}</AdminBadge>
              <AdminBadge tone={qtone(o.crossfade.status)}>Crossfade {o.crossfade.status}</AdminBadge>
              <AdminBadge tone={qtone(o.stall.status)}>Stall {o.stall.status}</AdminBadge>
              <AdminBadge tone={qtone(o.mediaError.status)}>MediaErr {o.mediaError.status}</AdminBadge>
              <AdminBadge tone={qtone(o.preload.status)}>Preload {o.preload.status}</AdminBadge>
              <AdminBadge tone={qtone(o.recovery.status)}>Recovery {o.recovery.status}</AdminBadge>
              <AdminBadge tone={qtone(o.continuity.status)}>Continuity {o.continuity.status}</AdminBadge>
            </div>
            <p className="mt-2 text-caption text-fg-muted">{o.ttfa.approxDisclaimer}</p>
            <p className="mt-1 text-caption text-fg-muted">Transition/Continuity 는 이번 Phase 미수집(NOT_AVAILABLE). Crossfade/Preload 는 매장(business) 모드에서 비활성 → NOT_AVAILABLE.</p>
          </AdminCard>

          {/* Advisor */}
          {cfg.advisorEnabled && data?.advice && (
            <AdminCard title="품질 권고 (자동 실행 없음)" subtitle="모든 조치는 권고이며 원격/자동 제어를 수행하지 않습니다.">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={urgTone(data.advice.urgency)} variant="solid">{data.advice.recommendedAction}</AdminBadge>
                <AdminBadge tone={urgTone(data.advice.urgency)}>{data.advice.urgency}</AdminBadge>
                <AdminBadge tone="neutral">automated: false</AdminBadge>
                <AdminBadge tone="neutral">remote-control: false</AdminBadge>
              </div>
              <p className="mt-2 text-body-sm text-fg">{data.advice.reason}</p>
              {data.advice.verificationSteps.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-caption text-fg-muted">{data.advice.verificationSteps.map((v, i) => <li key={i}>☐ {v}</li>)}</ul>
              )}
              <p className="mt-2 text-caption text-fg-muted">{data.advice.safetyWarning}</p>
            </AdminCard>
          )}

          {/* Media error breakdown */}
          {errors && errors.total > 0 && (
            <AdminCard title={`Media / Decoder Errors (${errors.total})`}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-caption text-fg-muted">by code</p>
                  {Object.entries(errors.byCode).map(([k, v]) => <div key={k} className="flex justify-between text-body-sm text-fg"><span>{MEDIA_CODE_LABEL[k] ?? k}</span><span>{v}</span></div>)}
                </div>
                <div>
                  <p className="text-caption text-fg-muted">by browser</p>
                  {Object.entries(errors.byBrowser).map(([k, v]) => <div key={k} className="flex justify-between text-body-sm text-fg"><span>{k}</span><span>{v}</span></div>)}
                </div>
                <div>
                  <p className="text-caption text-fg-muted">by release</p>
                  {Object.entries(errors.byRelease).map(([k, v]) => <div key={k} className="flex justify-between text-body-sm text-fg"><span>{k.slice(0, 10)}</span><span>{v}</span></div>)}
                </div>
              </div>
              <p className="mt-2 text-caption text-fg-muted">코드만 저장(URL/제목 미포함). media error ≠ 네트워크 장애 단정 금지 — 코드 분포로 판별.</p>
            </AdminCard>
          )}

          {/* Release comparison + regression */}
          {(data?.byRelease.length ?? 0) > 0 && (
            <AdminCard title="Release 품질 비교">
              {data?.releaseRegression && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-caption text-fg-muted">Regression:</span>
                  <AdminBadge tone={data.releaseRegression.overall === 'REGRESSED' ? 'danger' : data.releaseRegression.overall === 'IMPROVED' ? 'success' : 'neutral'}>{data.releaseRegression.overall}</AdminBadge>
                  <span className="text-caption text-fg-muted">회귀 {data.releaseRegression.regressedCount} · 개선 {data.releaseRegression.improvedCount} · score Δ {data.releaseRegression.scoreDelta ?? '—'}</span>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-body-sm">
                  <thead><tr className="text-left text-caption text-fg-muted"><th className="px-2 py-1.5">Release</th><th className="px-2 py-1.5">Sessions</th><th className="px-2 py-1.5">Score</th><th className="px-2 py-1.5">Start</th><th className="px-2 py-1.5">TTFA p75</th><th className="px-2 py-1.5">Media Err</th><th className="px-2 py-1.5">Coverage</th></tr></thead>
                  <tbody>
                    {data?.byRelease.map((r) => (
                      <tr key={r.scope} className="border-t border-line/10">
                        <td className="px-2 py-1.5 text-fg">{r.scope.slice(0, 12)}</td>
                        <td className="px-2 py-1.5 text-fg-muted">{r.sessions}</td>
                        <td className="px-2 py-1.5"><AdminBadge tone={qtone(r.status)}>{r.score ?? '—'}</AdminBadge></td>
                        <td className="px-2 py-1.5 text-fg-muted">{pct(r.start.successRate)}</td>
                        <td className="px-2 py-1.5 text-fg-muted">{ms(r.ttfa.p75)}</td>
                        <td className="px-2 py-1.5 text-fg-muted">{r.mediaError.status === 'NO_DATA' ? 'NO DATA' : pct(r.mediaError.sessionRate)}</td>
                        <td className="px-2 py-1.5 text-fg-muted">{Math.round(r.signalCoverage * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-caption text-fg-muted">작은 표본은 INSUFFICIENT_DATA — Release Regression 확정 금지.</p>
            </AdminCard>
          )}

          {/* Incidents */}
          {cfg.incidentsEnabled && (data?.incidents.length ?? 0) > 0 && (
            <AdminCard title={`Streaming Quality Incidents (${data!.incidents.length})`}>
              <ul className="space-y-2">
                {data!.incidents.slice(0, 30).map((inc) => (
                  <li key={inc.incidentKey} className="flex flex-wrap items-center gap-2 border-b border-line/10 pb-2 last:border-0">
                    <AdminBadge tone={sevTone(inc.severity)} variant="solid">{inc.severity}</AdminBadge>
                    <AdminBadge tone="neutral">{inc.type}</AdminBadge>
                    <span className="text-caption text-fg-muted">{inc.evidence.join(' · ')}</span>
                    <AdminBadge tone="neutral">{inc.confidence}</AdminBadge>
                    <span className="text-caption text-fg-muted">→ {inc.suggestedAction}</span>
                  </li>
                ))}
              </ul>
            </AdminCard>
          )}

          <p className="text-caption text-fg-muted flex items-center gap-1"><ArrowUpRight size={12} /> currentTime 진행 ≠ 실제 스피커 출력. play event ≠ 최초 Audio Output. 모든 값은 관측 근사이며 자동 제어를 수행하지 않습니다.</p>
        </>
      )}
    </div>
  );
}
