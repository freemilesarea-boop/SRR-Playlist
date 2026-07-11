/**
 * StoreFleetDashboard — WEB-OBS-6 매장 Fleet 관제 (읽기 전용).
 *
 * 매장 단위 플레이어 운영 상태를 요약/조회한다. 모든 판정은 클라이언트 순수 engine(src/lib/fleet)에서
 * 계산되며, 원격 재생/정지/새로고침/재부팅/장치변경/알림전송 버튼은 존재하지 않는다(관측·권고 전용).
 * 데이터가 없으면 NO DATA / INSUFFICIENT_DATA 로 표시하고 가짜 수치를 만들지 않는다. fail-open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Store, HeartPulse, Volume2, ListMusic, Wifi, ArrowUpRight, Radio } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getStoreFleetIntel, getStorePlayerHealthDetail,
  type FleetWindow, type FleetIntelBundle, type StoreDetail,
} from '@/lib/api/fleetApi';
import { getFleetConfig } from '@/lib/fleet/config';
import type { StoreHealthResult } from '@/lib/fleet';

const WINDOWS: FleetWindow[] = ['1h', '24h', '7d', '30d'];

function statusTone(s: string): AdminToneName {
  switch (s) { case 'HEALTHY': return 'success'; case 'ONLINE': return 'success'; case 'PLAYING': return 'success';
    case 'WATCH': case 'DEGRADED': case 'STALE': case 'LOW': case 'RECOVERED': return 'warning';
    case 'CRITICAL': case 'OFFLINE': case 'STALLED': case 'SILENCE_SUSPECTED': case 'EMPTY': case 'DISCONNECTED': case 'REPEAT_ANOMALY': return 'danger';
    case 'PAUSED_EXPECTED': case 'PLAYBACK_PROGRESSING': return 'info';
    default: return 'neutral'; }
}
function sevTone(s: string): AdminToneName { return s === 'CRITICAL' || s === 'HIGH' ? 'danger' : s === 'MEDIUM' ? 'warning' : 'info'; }
function urgencyTone(u: string): AdminToneName { return u === 'CRITICAL' ? 'danger' : u === 'HIGH' ? 'warning' : u === 'MEDIUM' ? 'info' : 'neutral'; }
function confTone(c: string): AdminToneName { return c === 'HIGH' ? 'success' : c === 'MEDIUM' ? 'info' : c === 'LOW' ? 'warning' : 'neutral'; }

function ageLabel(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 90) return `${Math.round(sec)}초 전`;
  if (sec < 5400) return `${Math.round(sec / 60)}분 전`;
  if (sec < 172800) return `${Math.round(sec / 3600)}시간 전`;
  return `${Math.round(sec / 86400)}일 전`;
}

export default function StoreFleetDashboard() {
  const cfg = getFleetConfig();
  const [win, setWin] = useState<FleetWindow>('24h');
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FleetIntelBundle | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<StoreHealthResult | null>(null);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('');
  const [healthFilter, setHealthFilter] = useState<string>('');
  const reqSeq = useRef(0);
  const failStreak = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!cfg.dashboardEnabled) return;
    const myReq = ++reqSeq.current;
    if (!opts?.silent) { setLoading(true); setError(null); }
    try {
      const res = await getStoreFleetIntel(win);
      if (myReq !== reqSeq.current) return;
      failStreak.current = 0;
      setData(res);
      setFetchedAt(new Date());
      setStale(false);
    } catch {
      if (myReq !== reqSeq.current) return;
      failStreak.current += 1;
      setError('Fleet 데이터를 불러오지 못했습니다(마이그레이션 미적용 시 NO DATA).');
      setStale(true);
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

  const openDetail = useCallback(async (store: StoreHealthResult) => {
    setSelected(store); setDetail(null);
    try { setDetail(await getStorePlayerHealthDetail(store.storeId, store, win)); } catch { setDetail(null); }
  }, [win]);

  if (!cfg.dashboardEnabled) {
    return <AdminAlert tone="info" title="Fleet 관제 비활성" description="VITE_FLEET_DASHBOARD_ENABLED=false 로 비활성화되어 있습니다." />;
  }

  const o = data?.overview;
  const stores = (data?.stores ?? []).filter((s) =>
    (!brandFilter || (s.brandName ?? s.brandId ?? '') === brandFilter) &&
    (!healthFilter || s.status === healthFilter));
  const brands = Array.from(new Set((data?.stores ?? []).map((s) => s.brandName ?? s.brandId).filter(Boolean))) as string[];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <AdminButton key={w} size="sm" variant={w === win ? 'solid' : 'ghost'} tone={w === win ? 'primary' : 'neutral'} onClick={() => setWin(w)}>{w}</AdminButton>
          ))}
        </div>
        <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<RefreshCw size={13} />} onClick={() => void load()}>새로고침</AdminButton>
        <AdminButton size="sm" variant={auto ? 'solid' : 'ghost'} tone={auto ? 'primary' : 'neutral'} onClick={() => setAuto((v) => !v)}>{auto ? '자동 새로고침 ON' : '자동 새로고침 OFF'}</AdminButton>
        {fetchedAt && <span className="text-caption text-fg-muted">업데이트 {fetchedAt.toLocaleTimeString()}{stale ? ' · stale' : ''}</span>}
        {!cfg.telemetryEnabled && <AdminBadge tone="neutral">emit OFF(opt-in)</AdminBadge>}
      </div>

      {error && <AdminAlert tone="warning" title="일부/전체 로드 실패" description={error} action={<AdminButton size="sm" tone="warning" onClick={() => void load()}>재시도</AdminButton>} />}

      {loading && !data ? (
        <AdminSkeleton className="h-40" />
      ) : !o || o.totalStores === 0 ? (
        <AdminEmpty icon={<Store size={20} />} title="Fleet 텔레메트리 없음" description="아직 매장 플레이어 헬스 이벤트가 없습니다. emit flag(VITE_FLEET_TELEMETRY_ENABLED) 활성 + 매장 재생 시 수집됩니다." />
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="텔레메트리 매장" value={o.totalStores} icon={<Store size={14} />} tone="primary" />
            <AdminStatCard label="Online" value={o.online} tone="success" />
            <AdminStatCard label="Stale" value={o.stale} tone="warning" />
            <AdminStatCard label="Offline" value={o.offline} icon={<Radio size={14} />} tone={o.offline > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Stalled" value={o.stalled} tone={o.stalled > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Silence 의심" value={o.silenceSuspected} icon={<Volume2 size={14} />} tone={o.silenceSuspected > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Queue Empty" value={o.queueEmpty} icon={<ListMusic size={14} />} tone={o.queueEmpty > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Scheduler Stale" value={o.schedulerStale} tone={o.schedulerStale > 0 ? 'warning' : 'neutral'} hint="약한 신호(대부분 NO DATA)" />
            <AdminStatCard label="Net 이상" value={o.networkDegraded + o.networkDisconnected} icon={<Wifi size={14} />} tone={(o.networkDegraded + o.networkDisconnected) > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="반복 이상" value={o.repetitionAnomaly} tone={o.repetitionAnomaly > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Fleet Health" value={o.healthScore ?? '—'} icon={<HeartPulse size={14} />} tone={statusTone(o.status)} hint={o.status} />
            <AdminStatCard label="Playing" value={o.playing} tone="success" />
          </div>

          {/* Fleet advisor + blast radius */}
          {data?.advice && (
            <AdminCard title="Fleet 권고 (자동 실행 없음)" subtitle="모든 조치는 권고이며 원격 제어를 수행하지 않습니다.">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={urgencyTone(data.advice.urgency)} variant="solid">{data.advice.recommendedAction}</AdminBadge>
                <AdminBadge tone={urgencyTone(data.advice.urgency)}>{data.advice.urgency}</AdminBadge>
                <AdminBadge tone="neutral">read-only</AdminBadge>
                <AdminBadge tone="neutral">automated: false</AdminBadge>
                <AdminBadge tone="neutral">remote-control: false</AdminBadge>
                <AdminBadge tone={confTone(data.advice.confidence)}>conf {data.advice.confidence}</AdminBadge>
              </div>
              <p className="mt-2 text-body-sm text-fg">{data.advice.reason}</p>
              {data.blastRadius && (
                <p className="mt-1 text-caption text-fg-muted">Blast: {data.blastRadius.level} · {data.blastRadius.reason}</p>
              )}
              <p className="mt-2 text-caption text-fg-muted">{data.advice.safetyWarning}</p>
            </AdminCard>
          )}

          {/* Incidents */}
          {cfg.incidentsEnabled && (data?.incidents.length ?? 0) > 0 && (
            <AdminCard title={`Store Incidents (${data!.incidents.length})`}>
              <ul className="space-y-2">
                {data!.incidents.slice(0, 30).map((inc) => (
                  <li key={inc.incidentKey} className="flex flex-wrap items-center gap-2 border-b border-line/10 pb-2 last:border-0">
                    <AdminBadge tone={sevTone(inc.severity)} variant="solid">{inc.severity}</AdminBadge>
                    <AdminBadge tone="neutral">{inc.type}</AdminBadge>
                    <span className="text-body-sm text-fg">{inc.scope === 'store' ? (inc.storeName ?? inc.storeId?.slice(0, 8)) : inc.scope === 'brand' ? (inc.brandName ?? 'brand') : inc.release}</span>
                    <span className="text-caption text-fg-muted">{inc.evidence.join(' · ')}</span>
                    <AdminBadge tone={confTone(inc.confidence)}>{inc.confidence}</AdminBadge>
                    <span className="text-caption text-fg-muted">→ {inc.suggestedAction}</span>
                  </li>
                ))}
              </ul>
            </AdminCard>
          )}

          {/* Store table */}
          <AdminCard
            title="매장 목록"
            action={
              <div className="flex items-center gap-1">
                <select className="rounded-md bg-bg-card text-caption text-fg ring-1 ring-line/20 px-1.5 py-1" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
                  <option value="">모든 브랜드</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <select className="rounded-md bg-bg-card text-caption text-fg ring-1 ring-line/20 px-1.5 py-1" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
                  <option value="">모든 상태</option>
                  {['HEALTHY', 'WATCH', 'DEGRADED', 'CRITICAL', 'OFFLINE', 'INSUFFICIENT_DATA'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-body-sm">
                <thead>
                  <tr className="text-left text-caption text-fg-muted">
                    <th className="px-2 py-1.5">매장</th><th className="px-2 py-1.5">브랜드/지역</th><th className="px-2 py-1.5">Last Seen</th>
                    <th className="px-2 py-1.5">Liveness</th><th className="px-2 py-1.5">Playback</th><th className="px-2 py-1.5">Queue</th>
                    <th className="px-2 py-1.5">Network</th><th className="px-2 py-1.5">Release</th><th className="px-2 py-1.5">Browser</th><th className="px-2 py-1.5">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.storeId} className="cursor-pointer border-t border-line/10 hover:bg-bg-hover/40" onClick={() => void openDetail(s)}>
                      <td className="px-2 py-1.5 text-fg">{s.storeName ?? s.storeId.slice(0, 8)}{s.hidden && <AdminBadge tone="neutral" className="ml-1">hidden</AdminBadge>}</td>
                      <td className="px-2 py-1.5 text-fg-muted">{[s.brandName, s.regionName].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-2 py-1.5 text-fg-muted">{ageLabel(s.lastSeenAgeSec)}</td>
                      <td className="px-2 py-1.5"><AdminBadge tone={statusTone(s.liveness)}>{s.liveness}</AdminBadge></td>
                      <td className="px-2 py-1.5"><AdminBadge tone={statusTone(s.playback)}>{s.playback}</AdminBadge></td>
                      <td className="px-2 py-1.5"><AdminBadge tone={statusTone(s.queue)}>{s.queue}</AdminBadge></td>
                      <td className="px-2 py-1.5"><AdminBadge tone={statusTone(s.network)}>{s.network}</AdminBadge></td>
                      <td className="px-2 py-1.5 text-fg-muted">{s.release.slice(0, 8)}</td>
                      <td className="px-2 py-1.5 text-fg-muted">{s.browserFamily}</td>
                      <td className="px-2 py-1.5"><AdminBadge tone={statusTone(s.status)}>{s.healthScore ?? '—'}</AdminBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-caption text-fg-muted">Session ≠ 매장 수. 매장 수는 store_id(=auth.uid()) 기준 고유 집계입니다. 행 클릭 → 상세.</p>
          </AdminCard>

          {/* Store detail */}
          {selected && (
            <AdminCard
              title={`매장 상세 — ${selected.storeName ?? selected.storeId.slice(0, 8)}`}
              action={<AdminButton size="sm" variant="ghost" tone="neutral" onClick={() => { setSelected(null); setDetail(null); }}>닫기</AdminButton>}
            >
              <div className="flex flex-wrap gap-2">
                <AdminBadge tone={statusTone(selected.liveness)}>Liveness {selected.liveness}</AdminBadge>
                <AdminBadge tone={statusTone(selected.playback)}>Playback {selected.playback}</AdminBadge>
                <AdminBadge tone={statusTone(selected.silence)}>Silence {selected.silence}</AdminBadge>
                <AdminBadge tone={statusTone(selected.queue)}>Queue {selected.queue}</AdminBadge>
                <AdminBadge tone="neutral">Scheduler {selected.scheduler}</AdminBadge>
                <AdminBadge tone={statusTone(selected.network)}>Network {selected.network}</AdminBadge>
                <AdminBadge tone={statusTone(selected.repetition)}>Repetition {selected.repetition}</AdminBadge>
                <AdminBadge tone={confTone(selected.confidence)}>conf {selected.confidence}</AdminBadge>
              </div>
              {selected.reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-caption text-fg-muted">{selected.reasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
              )}
              {!detail ? <AdminSkeleton className="mt-3 h-16" /> : (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-fg-muted">복구:</span>
                    <AdminBadge tone={statusTone(detail.recovery.status)} variant="solid">{detail.recovery.status}</AdminBadge>
                    {detail.recovery.recurrence && <AdminBadge tone="danger">재발</AdminBadge>}
                    <AdminBadge tone="neutral">운영자 종료 필요</AdminBadge>
                    <span className="text-caption text-fg-muted">{detail.recovery.reasons.join(' · ')}</span>
                  </div>
                  {detail.advice && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-caption text-fg-muted">권고:</span>
                      <AdminBadge tone={urgencyTone(detail.advice.urgency)} variant="solid">{detail.advice.recommendedAction}</AdminBadge>
                      <span className="text-body-sm text-fg">{detail.advice.reason}</span>
                    </div>
                  )}
                  {detail.advice && detail.advice.verificationSteps.length > 0 && (
                    <div>
                      <span className="text-caption text-fg-muted">검증 체크리스트(관측/안내 전용):</span>
                      <ul className="mt-1 space-y-0.5 text-caption text-fg-muted">{detail.advice.verificationSteps.map((v, i) => <li key={i}>☐ {v}</li>)}</ul>
                    </div>
                  )}
                  <p className="text-caption text-fg-muted">이벤트: {Object.entries(detail.eventCounts).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'}</p>
                </div>
              )}
              <p className="mt-2 text-caption text-fg-muted">모든 조치는 권고이며 원격 재생/정지/새로고침/재부팅/장치변경은 수행되지 않습니다.</p>
            </AdminCard>
          )}

          <p className="text-caption text-fg-muted flex items-center gap-1"><ArrowUpRight size={12} /> Audio 실제 출력/내부 상태(readyState·error·recovery·sinkId)는 이 채널에서 미수집 — NO DATA(Player.tsx 변경 금지). Silence 는 확정이 아닌 의심(SUSPECTED)만 제공합니다.</p>
        </>
      )}
    </div>
  );
}
