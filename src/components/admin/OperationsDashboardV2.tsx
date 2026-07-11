/**
 * OperationsDashboardV2 — WEB-OBS-8 지능형 운영 & 예측 스트리밍 분석 (읽기 전용).
 *
 * WEB-OBS-7 품질 텔레메트리 위에서 Reliability Index, Signal Coverage, 예측 경고(Predictive Warning),
 * Release Risk, Quality Trend, Browser/Device Matrix, Release/Enterprise Heatmap, Fleet Replay,
 * Store Replay + Root-Cause 근거를 규칙 기반(ML/LLM 아님)으로 요약한다.
 * 모든 판정은 클라이언트 순수 engine(src/lib/streamingOps)에서 계산되며, 자동 재생 제어/Reload/Rollback/
 * Release 차단/원격 Player 제어 버튼은 존재하지 않는다(관측·분석·권고 전용).
 * 실제 Signal이 없으면 NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA 로 표시하고 가짜 수치를 만들지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Gauge, Activity, TrendingUp, AlertTriangle, Layers, Building2, PlayCircle, Search } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import {
  getOpsOverview, getQualityMatrix, getOpsTimeseries, getEnterpriseHeatmap, getFleetReplay, getStoreReplay,
  type SqWindow, type OpsOverview, type OpsTimeseries, type StoreReplayBundle,
} from '@/lib/api/streamingOpsApi';
import type { QualityMatrix, EnterpriseHeatmap, FleetReplay } from '@/lib/streamingOps';

const WINDOWS: SqWindow[] = ['1h', '24h', '7d', '30d'];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'HEALTHY': case 'IMPROVING': case 'STABLE': case 'GOOD': case 'LOW': case 'NONE': return 'success';
    case 'WATCH': case 'DEGRADED': case 'ELEVATED': case 'RECURRING': case 'recovering': return 'warning';
    case 'CRITICAL': case 'DEGRADING': case 'HIGH': case 'MAJOR': case 'REGRESSED': case 'error': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NOT_AVAILABLE': case 'NONE_': return 'info';
    default: return 'neutral';
  }
}
function sevSeverity(s: string): AdminToneName { return s === 'error' ? 'danger' : s === 'warn' ? 'warning' : s === 'good' ? 'success' : 'neutral'; }
function pct(n: number | null | undefined): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function ms(n: number | null | undefined): string { return n == null ? 'NO DATA' : `${Math.round(n)}ms`; }
function num(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

export default function OperationsDashboardV2() {
  const [win, setWin] = useState<SqWindow>('24h');
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ov, setOv] = useState<OpsOverview | null>(null);
  const [browser, setBrowser] = useState<QualityMatrix | null>(null);
  const [device, setDevice] = useState<QualityMatrix | null>(null);
  const [ts, setTs] = useState<OpsTimeseries | null>(null);
  const [ent, setEnt] = useState<EnterpriseHeatmap | null>(null);
  const [fleet, setFleet] = useState<FleetReplay | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [storeId, setStoreId] = useState('');
  const [replay, setReplay] = useState<StoreReplayBundle | null>(null);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const reqSeq = useRef(0);
  const failStreak = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const myReq = ++reqSeq.current;
    if (!opts?.silent) { setLoading(true); setError(null); }
    try {
      const [o, b, d, t, e, f] = await Promise.allSettled([
        getOpsOverview(win), getQualityMatrix('browser', win), getQualityMatrix('device', win),
        getOpsTimeseries(win, win === '1h' ? 5 : 60), getEnterpriseHeatmap(win), getFleetReplay(win, 5),
      ]);
      if (myReq !== reqSeq.current) return;
      failStreak.current = 0;
      setOv(o.status === 'fulfilled' ? o.value : null);
      setBrowser(b.status === 'fulfilled' ? b.value : null);
      setDevice(d.status === 'fulfilled' ? d.value : null);
      setTs(t.status === 'fulfilled' ? t.value : null);
      setEnt(e.status === 'fulfilled' ? e.value : null);
      setFleet(f.status === 'fulfilled' ? f.value : null);
      if ([o, b, d, t, e, f].every((r) => r.status === 'rejected')) { setError('운영 인텔리전스 데이터를 불러오지 못했습니다(마이그레이션 0461 미적용 시 NO DATA).'); setStale(true); }
      else setStale(false);
      setFetchedAt(new Date());
    } catch {
      if (myReq !== reqSeq.current) return;
      failStreak.current += 1;
      setError('운영 인텔리전스 데이터를 불러오지 못했습니다.'); setStale(true);
    } finally {
      if (myReq === reqSeq.current && !opts?.silent) setLoading(false);
    }
  }, [win]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || failStreak.current >= 3) return;
      setStale(true); void load({ silent: true });
    }, 30000);
    return () => window.clearInterval(id);
  }, [auto, load]);

  const runReplay = useCallback(async () => {
    const id = storeId.trim();
    setReplay(null); setReplayErr(null);
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) { setReplayErr('store UUID 형식이 아닙니다.'); return; }
    try {
      const r = await getStoreReplay(id, null, win);
      if (!r) { setReplayErr('데이터 없음.'); return; }
      setReplay(r);
    } catch { setReplayErr('Replay 조회 실패.'); }
  }, [storeId, win]);

  if (loading && !ov && !browser && !ts) {
    return <div className="space-y-3"><AdminSkeleton className="h-8 w-64" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <AdminSkeleton key={i} className="h-24" />)}</div></div>;
  }

  const rel = ov?.reliability;
  const pred = ts?.predictive;
  const risk = ov?.releaseRisk;

  return (
    <div className="space-y-5">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Activity size={18} /> 지능형 운영 & 예측 분석 <span className="text-xs font-normal text-text-tertiary">v2</span></h2>
          <p className="text-xs text-text-tertiary">규칙 기반(ML/LLM 아님) · 읽기 전용 · 자동 제어/Rollback/원격 Player 제어 없음</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium transition-colors ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>
            ))}
          </div>
          <AdminButton size="sm" variant={auto ? 'solid' : 'outline'} onClick={() => setAuto((v) => !v)}>{auto ? 'Auto ON' : 'Auto OFF'}</AdminButton>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>

      {fetchedAt && <p className="text-[11px] text-text-tertiary">{stale ? '갱신 중… ' : ''}조회: {fetchedAt.toLocaleTimeString()} · window {win}</p>}
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}

      {/* Top stat row: reliability + coverage + predictive + release risk */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <AdminStatCard label="Streaming Reliability" value={rel?.index != null ? `${rel.index}` : 'NO DATA'} tone={tone(rel?.band ?? 'INSUFFICIENT_DATA')} hint={rel?.band ?? 'INSUFFICIENT_DATA'} icon={<Gauge size={16} />} />
        <AdminStatCard label="Signal Coverage" value={ov ? pct(ov.coverage.overall) : '—'} tone={ov && (ov.coverage.overall ?? 0) >= 0.9 ? 'success' : ov && (ov.coverage.overall ?? 0) >= 0.6 ? 'warning' : 'info'} hint="관측 신호 비율" icon={<Layers size={16} />} />
        <AdminStatCard label="예측 경고" value={pred?.likelihood ?? '—'} tone={tone(pred?.likelihood ?? 'INSUFFICIENT_DATA')} hint={`상승 신호 ${pred?.risingCount ?? 0}개`} icon={<AlertTriangle size={16} />} />
        <AdminStatCard label="Release Risk" value={risk?.band ?? 'N/A'} tone={tone(risk?.band ?? 'INSUFFICIENT_DATA')} hint={risk?.baseline ? `vs ${risk.baseline}` : 'canary 없음'} icon={<TrendingUp size={16} />} />
      </div>

      {/* Reliability sub-components */}
      {rel && (
        <AdminCard title="Streaming Reliability Index — 세부">
          <div className="flex flex-wrap gap-2">
            {rel.subs.map((s) => (
              <div key={s.key} className="rounded-lg border border-border bg-bg-card px-3 py-2">
                <div className="text-[11px] text-text-tertiary">{s.label}</div>
                <div className="text-sm font-semibold text-text-primary">{s.score == null ? <AdminBadge tone="info">N/A</AdminBadge> : s.score}</div>
                <div className="text-[10px] text-text-tertiary">{s.detail}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">N/A = 해당 모드에서 관측 불가(business 모드 crossfade/continuity 등). TTFA는 요청→최초 진행 근사(TTFA_APPROX) — 실제 스피커 출력 증명 아님.</p>
        </AdminCard>
      )}

      {/* Predictive warning + release risk detail */}
      <div className="grid gap-3 md:grid-cols-2">
        {pred && (
          <AdminCard title="Predictive Warning (규칙 기반 추세)">
            <div className="mb-2 flex items-center gap-2"><AdminBadge tone={tone(pred.likelihood)}>{pred.likelihood}</AdminBadge><span className="text-xs text-text-tertiary">{pred.horizon}</span></div>
            <div className="space-y-1">
              {pred.signals.map((s) => (
                <div key={s.signal} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">{s.label}</span>
                  <span className={s.rising ? 'font-semibold text-text-primary' : 'text-text-tertiary'}>{num(s.from)} → {num(s.to)} {s.rising && <AdminBadge tone="warning">상승</AdminBadge>}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">{pred.recommendation}</p>
          </AdminCard>
        )}
        {risk && (
          <AdminCard title="Release Risk (canary vs baseline)">
            <div className="mb-2 flex items-center gap-2"><AdminBadge tone={tone(risk.band)}>{risk.band}</AdminBadge>{risk.canaryFraction != null && <span className="text-xs text-text-tertiary">canary {(risk.canaryFraction * 100).toFixed(1)}%</span>}</div>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-text-secondary">{risk.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            <p className="mt-2 text-[11px] text-text-tertiary">{risk.recommendation}</p>
          </AdminCard>
        )}
      </div>

      {/* Quality trend */}
      {ts && (
        <AdminCard title={`Quality Trend (${ts.granularity})`}>
          <div className="mb-2 flex items-center gap-2"><AdminBadge tone={tone(ts.trend.direction)}>{ts.trend.direction}</AdminBadge>{ts.trend.delta != null && <span className="text-xs text-text-tertiary">Δ{ts.trend.delta} ({num(ts.trend.firstScore)} → {num(ts.trend.lastScore)})</span>}</div>
          <div className="flex items-end gap-0.5 overflow-x-auto">
            {ts.buckets.map((b, i) => (
              <div key={i} title={`${b.bucketStart}: score ${b.score ?? 'NO DATA'} · ${b.sessions} sess`}
                className="w-2 shrink-0 rounded-t bg-accent/60" style={{ height: `${b.score == null ? 2 : Math.max(2, b.score)}px` }} />
            ))}
          </div>
        </AdminCard>
      )}

      {/* Browser + Device matrix */}
      <div className="grid gap-3 lg:grid-cols-2">
        {[{ m: browser, t: 'Browser Quality Matrix' }, { m: device, t: 'Device Quality Matrix' }].map(({ m, t }) => (
          <AdminCard key={t} title={t}>
            {!m || m.cells.length === 0 ? <AdminEmpty title="NO DATA" description="해당 차원 관측 없음" /> : (
              <div className="overflow-x-auto">
                {m.concentration && <AdminAlert tone="warning" title="집중 감지">{`media_error의 ${(m.concentration.share * 100).toFixed(0)}%가 '${m.concentration.value}'에 집중`}</AdminAlert>}
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-text-tertiary"><th className="py-1">값</th><th>Sess</th><th>Score</th><th>TTFA</th><th>Media</th><th>Stall</th><th>Recov</th></tr></thead>
                  <tbody>
                    {m.cells.map((c) => (
                      <tr key={c.value} className={`border-t border-border ${c.value === m.worstCell ? 'font-semibold' : ''}`}>
                        <td className="py-1 text-text-primary">{c.value}{c.value === m.worstCell && <AdminBadge tone="danger">worst</AdminBadge>}</td>
                        <td>{c.sessions}</td>
                        <td>{c.insufficient ? <AdminBadge tone="info">INSUF</AdminBadge> : <AdminBadge tone={tone(c.status)}>{c.score ?? '—'}</AdminBadge>}</td>
                        <td>{ms(c.ttfaP75)}</td><td>{pct(c.mediaErrorRate)}</td><td>{pct(c.stallRate)}</td><td>{pct(c.recoverySuccessRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        ))}
      </div>

      {/* Release heatmap */}
      {ov && (
        <AdminCard title="Release Heatmap">
          {ov.releaseHeatmap.rows.length === 0 ? <AdminEmpty title="NO DATA" description="release 관측 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Release</th><th>Sess</th><th>Stores</th><th>Score</th><th>Δ vs base</th><th>회귀</th><th>Incidents</th></tr></thead>
                <tbody>
                  {ov.releaseHeatmap.rows.map((r) => (
                    <tr key={r.release} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.release}{r.release === ov.releaseHeatmap.baseline && <AdminBadge tone="info">base</AdminBadge>}</td>
                      <td>{r.sessions}</td><td>{r.stores || '—'}</td>
                      <td><AdminBadge tone={tone(r.status)}>{r.score ?? '—'}</AdminBadge></td>
                      <td>{r.scoreDelta == null ? '—' : r.scoreDelta}</td>
                      <td><AdminBadge tone={tone(r.regression)}>{r.regression}</AdminBadge></td>
                      <td>{r.incidents > 0 ? <AdminBadge tone="danger">{r.incidents}</AdminBadge> : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* Enterprise heatmap */}
      <AdminCard title={<span className="flex items-center gap-1.5"><Building2 size={15} /> Enterprise Heatmap (브랜드 → 매장)</span>}>
        {!ent ? <AdminSkeleton className="h-16" /> : !ent.available ? <AdminAlert tone="info" title="NOT_AVAILABLE">{ent.reason}</AdminAlert> : ent.rows.length === 0 ? <AdminEmpty title="NO DATA" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">브랜드</th><th>매장</th><th>Sess</th><th>Score</th><th>Media</th><th>Recov</th><th>Availability</th></tr></thead>
              <tbody>
                {ent.rows.map((r) => (
                  <tr key={r.brand} className="border-t border-border">
                    <td className="py-1 text-text-primary">{r.brand}</td><td>{r.stores}</td><td>{r.sessions}</td>
                    <td><AdminBadge tone={tone(r.status)}>{r.score ?? '—'}</AdminBadge></td>
                    <td>{pct(r.mediaErrorRate)}</td><td>{pct(r.recoverySuccessRate)}</td><td>{r.availability == null ? '—' : `${r.availability}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {/* Fleet replay */}
      <AdminCard title="Fleet Replay (시간순 매장 상태)">
        {!fleet || fleet.steps.length === 0 ? <AdminEmpty title="NO DATA" description="fleet 관측 없음" /> : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {fleet.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 text-text-tertiary">{s.at}</span>
                <AdminBadge tone={sevSeverity(s.severity)}>{s.label}</AdminBadge>
                <span className="text-text-secondary">{s.detail}</span>
              </div>
            ))}
            {fleet.truncated && <p className="text-[11px] text-text-tertiary">(상한 도달 — 일부 생략)</p>}
          </div>
        )}
      </AdminCard>

      {/* Store replay + root cause (on-demand) */}
      <AdminCard title={<span className="flex items-center gap-1.5"><PlayCircle size={15} /> Store Replay + Root-Cause (store UUID 입력)</span>}>
        <div className="flex flex-wrap items-center gap-2">
          <AdminSearch value={storeId} onChange={setStoreId} placeholder="store UUID (auth.uid())" />
          <AdminButton size="sm" variant="outline" leftIcon={<Search size={14} />} onClick={() => void runReplay()}>Replay</AdminButton>
        </div>
        {replayErr && <AdminAlert tone="warning" title="조회">{replayErr}</AdminAlert>}
        {replay && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-text-secondary">Playback Replay</div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {replay.replay.steps.length === 0 ? <AdminEmpty title="NO DATA" /> : replay.replay.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 text-text-tertiary">{s.at}</span>
                    <AdminBadge tone={sevSeverity(s.severity)}>{s.label}</AdminBadge>
                    <span className="text-text-secondary">{s.detail}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-text-secondary">Root-Cause Evidence</div>
              <div className="flex items-center gap-2"><AdminBadge tone={replay.rootCause.verdict === 'UNKNOWN' ? 'info' : 'warning'}>{replay.rootCause.verdict}</AdminBadge><span className="text-xs text-text-tertiary">confidence {replay.rootCause.confidence == null ? 'INSUFFICIENT' : `${replay.rootCause.confidence}%`}</span></div>
              <ol className="mt-2 list-inside list-decimal space-y-0.5 text-xs text-text-secondary">{replay.rootCause.chain.map((c, i) => <li key={i}>{c.signal}: {c.observed}</li>)}</ol>
              <p className="mt-2 text-[11px] text-text-primary">{replay.rootCause.summary}</p>
              <p className="mt-1 text-[10px] text-text-tertiary">{replay.rootCause.caveat}</p>
            </div>
          </div>
        )}
      </AdminCard>

      <p className="text-[11px] text-text-tertiary">
        모든 수치는 관측된 실제 이벤트에서만 산출됩니다. 신호가 없으면 NO_DATA/NOT_AVAILABLE/INSUFFICIENT_DATA로 표기하며,
        예측·위험·근거는 규칙 기반 추정으로 운영자 확인이 필요합니다(자동 실행 없음).
      </p>
    </div>
  );
}
