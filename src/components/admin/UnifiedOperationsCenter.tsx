/**
 * UnifiedOperationsCenter — WEB-OPS-10 통합 운영 플랫폼 (Final). WEB-OBS 전 Phase의 운영 Dashboard를
 * 하나의 Command Center로 수렴한다. 새로운 Player/Streaming 기능은 없다 — 기존 super-admin API 위에서
 * 조합한 읽기 전용 뷰 + 운영자별 Workspace(위젯 레이아웃) 저장.
 *
 * 어떤 요소도 릴리스/롤백/Release 차단/원격 Player 제어를 실행하지 않는다. 기존 Dashboard/RPC/운영 데이터는
 * READ-only. 신호가 없으면 NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA 로 표시한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, LayoutGrid, Server, Building2, Store, Radio, AlertTriangle, ShieldCheck, BarChart3, Search, GripVertical, Star, Save } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import {
  getPlatformCenter, getWorkspace, saveWorkspace, savePreferences, searchLocal, searchGovernanceDecisions,
  type SqWindow, type PlatformCenter,
} from '@/lib/api/platformApi';
import { getStoreReplay } from '@/lib/api/streamingOpsApi';
import {
  getPlatformConfig, defaultLayout, normalizeLayout, reorderWidget, updateWidget, WIDGET_CATALOG,
  type WorkspaceLayout, type SearchResult, type StoreDigitalTwin,
} from '@/lib/platform';

const WINDOWS: SqWindow[] = ['1h', '24h', '7d', '30d'];
type Tab = 'overview' | 'fleet' | 'enterprise' | 'stores' | 'streaming' | 'incidents' | 'governance' | 'executive' | 'workspace';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <LayoutGrid size={14} /> },
  { key: 'fleet', label: 'Fleet', icon: <Server size={14} /> },
  { key: 'enterprise', label: 'Enterprise', icon: <Building2 size={14} /> },
  { key: 'stores', label: 'Stores', icon: <Store size={14} /> },
  { key: 'streaming', label: 'Streaming', icon: <Radio size={14} /> },
  { key: 'incidents', label: 'Incidents', icon: <AlertTriangle size={14} /> },
  { key: 'governance', label: 'Governance', icon: <ShieldCheck size={14} /> },
  { key: 'executive', label: 'Executive', icon: <BarChart3 size={14} /> },
  { key: 'workspace', label: 'Workspace', icon: <LayoutGrid size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'HEALTHY': case 'READY': case 'OK': case 'good': return 'success';
    case 'WATCH': case 'DEGRADED': case 'REVIEW_REQUIRED': case 'AT_RISK': case 'watch': return 'warning';
    case 'CRITICAL': case 'BLOCK_RECOMMENDED': case 'HIGH_RISK': case 'BREACHED': case 'bad': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NOT_AVAILABLE': case 'info': return 'info';
    default: return 'neutral';
  }
}
function n1(v: number | null | undefined): string { return v == null ? '—' : `${v}`; }
function sevTone(s: string): AdminToneName { return s === 'error' ? 'danger' : s === 'warn' ? 'warning' : s === 'good' ? 'success' : 'neutral'; }

export default function UnifiedOperationsCenter() {
  const cfg = getPlatformConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [win, setWin] = useState<SqWindow>('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlatformCenter | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [layout, setLayout] = useState<WorkspaceLayout>(defaultLayout());
  const [wsNotice, setWsNotice] = useState<string | null>(null);
  const [storeId, setStoreId] = useState('');
  const [twin, setTwin] = useState<StoreDigitalTwin | null>(null);
  const [twinErr, setTwinErr] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const c = await getPlatformCenter(win);
      if (myReq !== reqSeq.current) return;
      setData(c);
      if (!c) setError('통합 운영 데이터를 불러오지 못했습니다(마이그레이션 0460~0463 미적용 시 NO DATA).');
      setFetchedAt(new Date());
    } catch { if (myReq === reqSeq.current) setError('통합 운영 데이터를 불러오지 못했습니다.'); }
    finally { if (myReq === reqSeq.current) setLoading(false); }
  }, [win]);

  useEffect(() => { void load(); }, [load]);

  // load saved workspace once
  useEffect(() => {
    if (!cfg.widgetLayoutEnabled) return;
    (async () => {
      try {
        const ws = await getWorkspace();
        const def = ws.workspaces.find((w) => w.isDefault) ?? ws.workspaces[0];
        if (def) setLayout(def.layout);
      } catch { /* fail-open: keep default */ }
    })();
  }, [cfg.widgetLayoutEnabled]);

  // unified search (local corpus + governance RPC)
  useEffect(() => {
    if (query.trim().length < 2 || !data) { setResults([]); return; }
    const local = searchLocal(query, data.searchable);
    setResults(local);
    (async () => { try { const gov = await searchGovernanceDecisions(query); setResults((prev) => [...prev, ...gov].slice(0, 50)); } catch { /* noop */ } })();
  }, [query, data]);

  const runTwin = useCallback(async () => {
    const id = storeId.trim(); setTwin(null); setTwinErr(null);
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) { setTwinErr('store UUID 형식이 아닙니다.'); return; }
    try {
      const r = await getStoreReplay(id, null, win);
      if (!r) { setTwinErr('데이터 없음.'); return; }
      const cat = (kinds: string[]) => r.replay.steps.filter((s) => kinds.includes(s.kind)).map((s) => ({ at: s.at, label: s.label, detail: s.detail, severity: s.severity }));
      setTwin({
        store: id,
        timelines: [
          { key: 'playback', label: 'Playback Timeline', steps: cat(['request', 'playing', 'progress']) },
          { key: 'streaming', label: 'Streaming Timeline', steps: cat(['crossfade', 'preload']) },
          { key: 'recovery', label: 'Recovery Timeline', steps: cat(['recovery', 'recovered']) },
          { key: 'incident', label: 'Incident Timeline', steps: cat(['error']) },
        ],
      });
    } catch { setTwinErr('Digital Twin 조회 실패.'); }
  }, [storeId, win]);

  const saveLayout = useCallback(async () => {
    setWsNotice(null);
    try { await saveWorkspace(layout.name || 'My Layout', layout, true, null); await savePreferences(win, {}); setWsNotice('레이아웃 저장됨.'); }
    catch { setWsNotice('저장 실패(권한/마이그레이션 확인).'); }
  }, [layout, win]);

  if (loading && !data) {
    return <div className="space-y-3"><AdminSkeleton className="h-8 w-64" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <AdminSkeleton key={i} className="h-24" />)}</div></div>;
  }

  const gh = data?.globalHealth;
  const ps = data?.platformScore;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><LayoutGrid size={18} /> 통합 운영 센터 <span className="text-xs font-normal text-text-tertiary">Command Center</span></h2>
          <p className="text-xs text-text-tertiary">모든 운영 Dashboard 수렴 · 읽기 전용 · 자동 실행/Rollback/원격 Player 제어 없음</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {WINDOWS.map((w) => <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>
      {fetchedAt && <p className="text-[11px] text-text-tertiary">조회: {fetchedAt.toLocaleTimeString()} · window {win}</p>}
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}

      {/* Unified search */}
      <div className="relative">
        <div className="flex items-center gap-2"><Search size={14} className="text-text-tertiary" /><AdminSearch value={query} onChange={setQuery} placeholder="통합 검색: store / release / incident / recommendation / decision …" /></div>
        {results.length > 0 && (
          <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-bg-card p-2">
            {results.map((r, i) => (
              <div key={`${r.kind}-${r.id}-${i}`} className="flex items-center gap-2 border-b border-border py-1 text-xs last:border-0">
                <AdminBadge tone="neutral">{r.kind}</AdminBadge><span className="text-text-primary">{r.label}</span><span className="text-text-tertiary">{r.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Global Health KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <AdminStatCard label="Platform Availability" value={n1(gh?.platformAvailability)} tone="info" />
        <AdminStatCard label="Streaming Reliability" value={n1(gh?.streamingReliability)} tone="info" />
        <AdminStatCard label="Enterprise Health" value={n1(gh?.enterpriseHealth)} tone="info" />
        <AdminStatCard label="Store Availability" value={n1(gh?.storeAvailability)} tone="info" />
        <AdminStatCard label="Critical Incidents" value={n1(gh?.criticalIncidents)} tone={gh && gh.criticalIncidents > 0 ? 'danger' : 'success'} />
        <AdminStatCard label="Open Recommendations" value={n1(gh?.openRecommendations)} tone={gh && gh.openRecommendations > 0 ? 'warning' : 'neutral'} />
        <AdminStatCard label="Release Readiness" value={gh?.releaseReadiness ?? '—'} tone={tone(gh?.releaseReadiness ?? 'INSUFFICIENT_DATA')} />
        <AdminStatCard label="Governance Queue" value={n1(gh?.governanceQueue)} tone={gh && gh.governanceQueue > 0 ? 'warning' : 'neutral'} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {cfg.platformScoreEnabled && ps && (
            <AdminCard title="Platform Score">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-3xl font-bold text-text-primary">{ps.score == null ? 'NO DATA' : ps.score}</div>
                <AdminBadge tone={tone(ps.band)}>{ps.band}</AdminBadge>
                <span className="text-[11px] text-text-tertiary">coverage {Math.round(ps.coverage * 100)}% · {ps.sessions} sessions</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ps.components.map((c) => (
                  <div key={c.key} className="rounded-lg border border-border bg-bg-card px-2 py-1 text-[11px]">
                    <span className="text-text-tertiary">{c.label}: </span><span className="font-semibold text-text-primary">{c.score == null ? 'N/A' : c.score}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}
          <ExecutiveSummaryCard data={data} />
          <CommandTimelineCard data={data} enabled={cfg.timelineEnabled} />
        </div>
      )}

      {/* Fleet */}
      {tab === 'fleet' && (
        <AdminCard title="Fleet Command (시간순 매장 상태)">
          {!data?.fleet || data.fleet.steps.length === 0 ? <AdminEmpty title="NO DATA" description="fleet 관측 없음" /> : (
            <div className="max-h-96 space-y-1 overflow-y-auto text-xs">
              {data.fleet.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2"><span className="w-32 shrink-0 text-text-tertiary">{s.at}</span><AdminBadge tone={sevTone(s.severity)}>{s.label}</AdminBadge><span className="text-text-secondary">{s.detail}</span></div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {/* Enterprise */}
      {tab === 'enterprise' && (
        <AdminCard title="Enterprise Command (브랜드별)">
          {!data?.enterprise ? <AdminSkeleton className="h-16" /> : !data.enterprise.available ? <AdminAlert tone="info" title="NOT_AVAILABLE">{data.enterprise.reason}</AdminAlert> : data.enterprise.rows.length === 0 ? <AdminEmpty title="NO DATA" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">브랜드</th><th>매장</th><th>Sess</th><th>Score</th><th>Media</th><th>Recov</th><th>Avail</th></tr></thead>
                <tbody>
                  {data.enterprise.rows.map((r) => (
                    <tr key={r.brand} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.brand}</td><td>{r.stores}</td><td>{r.sessions}</td>
                      <td><AdminBadge tone={tone(r.status)}>{r.score ?? '—'}</AdminBadge></td>
                      <td>{r.mediaErrorRate == null ? '—' : `${(r.mediaErrorRate * 100).toFixed(1)}%`}</td>
                      <td>{r.recoverySuccessRate == null ? '—' : `${(r.recoverySuccessRate * 100).toFixed(0)}%`}</td>
                      <td>{r.availability == null ? '—' : `${r.availability}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* Stores — Digital Twin */}
      {tab === 'stores' && (
        <AdminCard title="Store Digital Twin (읽기 전용 · store UUID)">
          {!cfg.digitalTwinEnabled ? <AdminAlert tone="info" title="비활성">digital twin flag off</AdminAlert> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AdminSearch value={storeId} onChange={setStoreId} placeholder="store UUID (auth.uid())" />
                <AdminButton size="sm" variant="outline" onClick={() => void runTwin()}>조회</AdminButton>
              </div>
              {twinErr && <AdminAlert tone="warning" title="조회">{twinErr}</AdminAlert>}
              {twin && (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {twin.timelines.map((tl) => (
                    <div key={tl.key}>
                      <div className="mb-1 text-xs font-semibold text-text-secondary">{tl.label}</div>
                      {tl.steps.length === 0 ? <AdminEmpty title="NO DATA" /> : (
                        <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
                          {tl.steps.map((s, i) => (<div key={i} className="flex items-center gap-2"><span className="w-40 shrink-0 text-text-tertiary">{s.at}</span><AdminBadge tone={sevTone(s.severity)}>{s.label}</AdminBadge><span className="text-text-secondary">{s.detail}</span></div>))}
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="text-[11px] text-text-tertiary lg:col-span-2">Governance/Release History per-store: NOT_AVAILABLE (매장 단위 미보유 — Governance 탭에서 전체 이력 확인).</p>
                </div>
              )}
            </>
          )}
        </AdminCard>
      )}

      {/* Streaming */}
      {tab === 'streaming' && data?.overview && (
        <div className="grid gap-3 md:grid-cols-2">
          <AdminStatCard label="Streaming Quality" value={n1(data.overview.overall.score)} tone={tone(data.overview.overall.status)} hint={data.overview.overall.status} />
          <AdminStatCard label="Reliability Index" value={n1(data.overview.reliability.index)} tone={tone(data.overview.reliability.band)} hint={data.overview.reliability.band} />
          <AdminStatCard label="Signal Coverage" value={data.overview.coverage.overall == null ? '—' : `${Math.round(data.overview.coverage.overall * 100)}%`} tone="info" />
          <AdminStatCard label="Sessions" value={n1(data.overview.overall.sessions)} tone="neutral" />
        </div>
      )}

      {/* Incidents */}
      {tab === 'incidents' && (
        <AdminCard title="Incidents & Recommendations">
          {!data?.readiness || data.readiness.recommendations.length === 0 ? <AdminEmpty title="권고/incident 없음" /> : (
            <div className="space-y-1.5">
              {data.readiness.recommendations.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <AdminBadge tone={tone(r.urgency)}>{r.urgency}</AdminBadge><AdminBadge tone={tone(r.action)}>{r.action}</AdminBadge>
                  <span className="font-medium text-text-primary">{r.scope}</span><span className="text-text-secondary">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {/* Governance */}
      {tab === 'governance' && (
        <AdminCard title="Governance (요약 · 상세는 운영 거버넌스 탭)">
          {!data?.governance ? <AdminEmpty title="NO DATA" /> : (
            <div className="max-h-96 space-y-1 overflow-y-auto text-xs">
              {data.governance.timeline.length === 0 ? <AdminEmpty title="이벤트 없음" /> : data.governance.timeline.map((t, i) => (
                <div key={i} className="flex items-center gap-2"><span className="w-40 shrink-0 text-text-tertiary">{t.at}</span><AdminBadge tone="neutral">{t.stage}</AdminBadge><span className="text-text-secondary">{t.label}</span></div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {/* Executive */}
      {tab === 'executive' && cfg.executiveDashboardEnabled && (
        <div className="space-y-4">
          <ExecutiveSummaryCard data={data} />
          {cfg.slaDashboardEnabled && data?.sla && (
            <AdminCard title="SLA Dashboard">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <AdminStatCard label="Availability" value={n1(data.sla.availability)} tone="info" />
                <AdminStatCard label="Recovery Rate" value={data.sla.recoveryRate == null ? '—' : `${(data.sla.recoveryRate * 100).toFixed(0)}%`} tone="info" />
                <AdminStatCard label="Incident Rate /1k" value={n1(data.sla.incidentRate)} tone="info" />
                <AdminStatCard label="Error Budget Left" value={data.sla.errorBudgetRemaining == null ? '—' : `${Math.round(data.sla.errorBudgetRemaining * 100)}%`} tone={tone(data.sla.status)} />
                <AdminStatCard label="MTTR (min)" value={data.sla.mttrMinutes == null ? 'INSUF' : `${data.sla.mttrMinutes}`} tone="neutral" />
                <AdminStatCard label="MTBF (h)" value={data.sla.mtbfHours == null ? 'INSUF' : `${data.sla.mtbfHours}`} tone="neutral" />
              </div>
              <p className="mt-2 text-[11px] text-text-tertiary">{data.sla.notes.join(' · ')}</p>
            </AdminCard>
          )}
          {data?.overview && (
            <AdminCard title="Reliability Dashboard">
              <div className="flex flex-wrap gap-2">
                {data.overview.reliability.subs.map((s) => (
                  <div key={s.key} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs"><div className="text-text-tertiary">{s.label}</div><div className="font-semibold text-text-primary">{s.score == null ? 'N/A' : s.score}</div></div>
                ))}
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* Workspace */}
      {tab === 'workspace' && cfg.widgetLayoutEnabled && (
        <AdminCard title="Operations Workspace (위젯 레이아웃 · 드래그 재정렬)">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {WIDGET_CATALOG.map((w) => (
              <AdminButton key={w.type} size="sm" variant="outline" disabled={layout.widgets.some((x) => x.type === w.type)} onClick={() => setLayout((l) => normalizeLayout({ ...l, widgets: [...l.widgets, { id: `w-${w.type}-${l.widgets.length}`, type: w.type, size: 'M', collapsed: false, favorite: false }] }))}>+ {w.label}</AdminButton>
            ))}
            <AdminButton size="sm" variant="solid" leftIcon={<Save size={14} />} onClick={() => void saveLayout()}>저장</AdminButton>
          </div>
          {wsNotice && <AdminAlert tone="info" title="Workspace">{wsNotice}</AdminAlert>}
          <div className="space-y-1.5">
            {layout.widgets.map((w) => (
              <div key={w.id} draggable onDragStart={() => { dragId.current = w.id; }} onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId.current && dragId.current !== w.id) setLayout((l) => reorderWidget(l, dragId.current as string, w.id)); dragId.current = null; }}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg-card p-2 text-xs">
                <GripVertical size={14} className="cursor-grab text-text-tertiary" />
                <span className="font-medium text-text-primary">{WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? w.type}</span>
                <div className="ml-auto flex items-center gap-1">
                  {(['S', 'M', 'L'] as const).map((sz) => (
                    <button key={sz} onClick={() => setLayout((l) => updateWidget(l, w.id, { size: sz }))} className={`rounded px-1.5 py-0.5 ${w.size === sz ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{sz}</button>
                  ))}
                  <button onClick={() => setLayout((l) => updateWidget(l, w.id, { collapsed: !w.collapsed }))} className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-hover">{w.collapsed ? '펼침' : '접기'}</button>
                  <button onClick={() => setLayout((l) => updateWidget(l, w.id, { favorite: !w.favorite }))} className="rounded px-1 py-0.5 text-text-secondary hover:bg-bg-hover" aria-label="favorite"><Star size={13} className={w.favorite ? 'fill-current text-accent' : ''} /></button>
                  <button onClick={() => setLayout((l) => ({ ...l, widgets: l.widgets.filter((x) => x.id !== w.id) }))} className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-hover">제거</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">레이아웃은 운영자별 UI 상태로 저장됩니다(운영 데이터 아님). 저장에는 마이그레이션 0463 적용이 필요합니다.</p>
        </AdminCard>
      )}
    </div>
  );
}

function ExecutiveSummaryCard({ data }: { data: PlatformCenter | null }) {
  const es = data?.executiveSummary;
  if (!es) return null;
  return (
    <AdminCard title={`Executive Summary (${es.window})`}>
      {!es.dataSufficient && <AdminAlert tone="info" title="INSUFFICIENT_DATA">{es.headline}</AdminAlert>}
      {es.dataSufficient && <div className="mb-2 text-sm font-semibold text-text-primary">{es.headline}</div>}
      <ul className="space-y-1">
        {es.lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2 text-xs"><AdminBadge tone={l.tone === 'good' ? 'success' : l.tone === 'bad' ? 'danger' : l.tone === 'watch' ? 'warning' : 'info'}>{l.tone}</AdminBadge><span className="text-text-secondary">{l.text}</span></li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-text-tertiary">규칙 기반 요약(AI 아님) · 관측 데이터에서만 산출.</p>
    </AdminCard>
  );
}

function CommandTimelineCard({ data, enabled }: { data: PlatformCenter | null; enabled: boolean }) {
  if (!enabled) return null;
  const tl = data?.commandTimeline ?? [];
  return (
    <AdminCard title="Command Timeline (전체 운영 이벤트)">
      {tl.length === 0 ? <AdminEmpty title="이벤트 없음" description="관측된 운영 이벤트 없음" /> : (
        <div className="max-h-72 space-y-1 overflow-y-auto text-xs">
          {tl.map((e, i) => (
            <div key={i} className="flex items-center gap-2"><span className="w-40 shrink-0 text-text-tertiary">{e.at}</span><AdminBadge tone="neutral">{e.stage}</AdminBadge><span className="text-text-secondary">{e.label} · {e.detail}</span></div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}
