/**
 * EnterpriseNocPanel — Phase 8 (Network Operations Center V1).
 *
 * 단일 화면 실시간 관제센터. Aggregation only — 기존 도메인 로직 무수정.
 * 5초 polling (V1) — Realtime subscribe 는 V2.
 *
 * SQL: supabase/migrations/0385_enterprise_noc_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Activity, Wifi, WifiOff, AlertCircle, Megaphone, Volume2,
  ShieldCheck, History, Heart, Bell, Settings, MapPin, Plus, Trash2,
  CheckCircle2, AlertTriangle, Info, Server,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminStatCard, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  getNocKpi, getNocRegionSummary, getNocActiveAlerts, getNocRecentEvents,
  getNocStoreHealthList, getNocStoreDetail,
  getNocSettings, setNocSetting,
  listNotificationChannels, upsertNotificationChannel, deleteNotificationChannel,
  type NocKpi, type NocRegionRow, type NocAlert, type NocRecentEvent,
  type NocStoreHealth, type NocStoreDetail, type NocNotificationChannel,
  type NocSeverity, type NocChannelType,
} from '@/lib/api/nocApi';

const POLL_INTERVAL_MS = 7_000;

const SEVERITY_META: Record<NocSeverity, { ko: string; tone: AdminToneName; icon: React.ReactNode }> = {
  critical: { ko: 'CRITICAL', tone: 'danger',  icon: <AlertCircle size={11} /> },
  major:    { ko: 'MAJOR',    tone: 'warning', icon: <AlertTriangle size={11} /> },
  minor:    { ko: 'MINOR',    tone: 'info',    icon: <Info size={11} /> },
  info:     { ko: 'INFO',     tone: 'success', icon: <CheckCircle2 size={11} /> },
};

const HEALTH_TONE: Record<NocStoreHealth['health_tone'], string> = {
  green:  'bg-emerald-500/25 text-slate-900 dark:text-emerald-200 ring-emerald-400/50',
  yellow: 'bg-amber-500/25  text-slate-900 dark:text-amber-200    ring-amber-400/50',
  orange: 'bg-orange-500/25 text-slate-900 dark:text-orange-200   ring-orange-400/50',
  red:    'bg-rose-500/25   text-slate-900 dark:text-rose-200     ring-rose-400/50',
};

const fmtDt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export default function EnterpriseNocPanel() {
  const [kpi, setKpi]               = useState<NocKpi | null>(null);
  const [regions, setRegions]       = useState<NocRegionRow[]>([]);
  const [alerts, setAlerts]         = useState<NocAlert[]>([]);
  const [events, setEvents]         = useState<NocRecentEvent[]>([]);
  const [healthList, setHealthList] = useState<NocStoreHealth[]>([]);
  const [settings, setSettings]     = useState<Record<string, unknown>>({});
  const [channels, setChannels]     = useState<NocNotificationChannel[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastTick, setLastTick]     = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<NocSeverity | ''>('');
  const [healthSearch, setHealthSearch]     = useState('');

  // modals
  const [storeDetail, setStoreDetail]       = useState<NocStoreDetail | null>(null);
  const [storeDetailLoading, setStoreDetailLoading] = useState(false);
  const [showChannels, setShowChannels]     = useState(false);
  const [editingChannel, setEditingChannel] = useState<NocNotificationChannel | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string } | null>(null);

  const autoRecovery = (settings['auto_recovery_enabled'] as boolean | undefined) ?? false;

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [k, r, a, e, h, s, c] = await Promise.all([
        getNocKpi(),
        getNocRegionSummary(),
        getNocActiveAlerts(50, severityFilter || null),
        getNocRecentEvents(100),
        getNocStoreHealthList({ limit: 100 }),
        getNocSettings(),
        listNotificationChannels(),
      ]);
      setKpi(k); setRegions(r); setAlerts(a); setEvents(e);
      setHealthList(h); setSettings(s); setChannels(c);
      setLastTick(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [severityFilter]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // 7초 polling (page visible 일 때만)
  useEffect(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const id = window.setInterval(() => void loadAll(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await loadAll(true); } finally { setRefreshing(false); }
  }, [loadAll]);

  const onToggleAutoRecovery = useCallback(async () => {
    try {
      await setNocSetting('auto_recovery_enabled', !autoRecovery);
      setToast({ tone: !autoRecovery ? 'success' : 'warning',
        title: `자동 복구 ${!autoRecovery ? '활성화' : '비활성화'}`,
        body: 'V1: 설정만 저장됩니다. 실제 자동 복구 트리거는 V2 Edge Function에서.' });
      await loadAll(true);
    } catch (e) { setToast({ tone: 'danger', title: '설정 저장 실패', body: (e as Error).message }); }
  }, [autoRecovery, loadAll]);

  const onOpenStoreDetail = useCallback(async (storeId: string) => {
    setStoreDetailLoading(true);
    try { setStoreDetail(await getNocStoreDetail(storeId)); }
    catch (e) { setToast({ tone: 'danger', title: '상세 조회 실패', body: (e as Error).message }); }
    finally { setStoreDetailLoading(false); }
  }, []);

  const filteredHealth = useMemo(() => {
    if (!healthSearch.trim()) return healthList;
    const q = healthSearch.toLowerCase();
    return healthList.filter((h) =>
      (h.store_name?.toLowerCase().includes(q)) ||
      (h.franchise_name?.toLowerCase().includes(q)) ||
      (h.region_name?.toLowerCase().includes(q))
    );
  }, [healthList, healthSearch]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Server size={16} /> 운영센터 (NOC)</span>}
      description="모든 매장을 실시간 관제합니다. 7초 폴링."
      badge={
        <span className="flex items-center gap-2">
          <AdminBadge tone="primary" variant="subtle">Phase 8 · V1</AdminBadge>
          {lastTick && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {fmtTime(lastTick)}
            </span>
          )}
        </span>
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-md bg-bg-deep px-2 py-1 text-[11px] font-semibold ring-1 ring-line/10">
            <input type="checkbox" checked={autoRecovery} onChange={onToggleAutoRecovery} />
            <span className={autoRecovery ? 'text-emerald-300' : 'text-ink-mute'}>자동 복구 {autoRecovery ? 'ON' : 'OFF'}</span>
          </label>
          <AdminButton tone="info" variant="subtle" size="sm" leftIcon={<Bell size={12} />}
            onClick={() => setShowChannels(true)}>알림 채널 ({channels.length})</AdminButton>
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>새로고침</AdminButton>
        </div>
      }
    >
      {/* 12 KPI */}
      {loading && !kpi ? (
        <AdminSkeleton variant="kpi" />
      ) : kpi ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <AdminStatCard label="총 매장"          value={kpi.total_stores}        tone="neutral" icon={<Activity size={14} />} />
          <AdminStatCard label="온라인"          value={kpi.online_stores}       tone="success" icon={<Wifi size={14} />} />
          <AdminStatCard label="오프라인"        value={kpi.offline_stores}      tone="danger"  icon={<WifiOff size={14} />} />
          <AdminStatCard label="긴급방송 송출중" value={kpi.emergency_active}    tone="danger"  icon={<Megaphone size={14} />} />
          <AdminStatCard label="광고 송출중"     value={kpi.announcement_active} tone="info"    icon={<Volume2 size={14} />} />
          <AdminStatCard label="정책 적용중"    value={kpi.policy_active}       tone="primary" icon={<ShieldCheck size={14} />} />
          <AdminStatCard label="정책 실패"      value={kpi.policy_failed}       tone="danger"  icon={<AlertCircle size={14} />} />
          <AdminStatCard label="24시간 미접속"  value={kpi.idle_24h}            tone="warning" icon={<Heart size={14} />} />
          <AdminStatCard label="Heartbeat 오류" value={kpi.heartbeat_errors}    tone="warning" icon={<Heart size={14} />} />
          <AdminStatCard label="Player 오류"   value={kpi.player_errors}       tone="danger"  icon={<AlertCircle size={14} />} />
          <AdminStatCard label="오늘 장애"      value={kpi.today_incidents}     tone="warning" icon={<History size={14} />} />
          <AdminStatCard label="오늘 자동복구"  value={kpi.today_recovered}     tone="success" icon={<CheckCircle2 size={14} />} />
        </div>
      ) : null}

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void loadAll()}>재시도</AdminButton>} />
      )}

      {/* 2-column layout: regions + alerts */}
      <div className="grid gap-3 lg:grid-cols-3">
        <AdminCard title={<span className="flex items-center gap-2"><MapPin size={13} /> 지역별 현황</span>} className="lg:col-span-1">
          {regions.length === 0 ? (
            <div className="text-[11px] text-ink-mute">표시할 지역이 없습니다.</div>
          ) : (
            <div className="space-y-1">
              {regions.map((r) => (
                <div key={r.region_code + r.region_name}
                  className="flex items-center justify-between rounded bg-bg-deep/40 px-2 py-1.5 text-xs ring-1 ring-line/10">
                  <div>
                    <div className="font-semibold text-ink">{r.region_name}</div>
                    <div className="text-[10px] text-ink-mute font-mono">{r.region_code}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] tabular-nums">
                    <span className="text-emerald-300">{r.online}</span>
                    <span className="text-ink-dim">/</span>
                    <span className="text-rose-300">{r.offline}</span>
                    {r.errors > 0 && <span className="rounded bg-rose-500/20 px-1.5 text-rose-300">!{r.errors}</span>}
                    {r.warnings > 0 && <span className="rounded bg-amber-500/20 px-1.5 text-amber-300">⚠{r.warnings}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard
          title={<span className="flex items-center gap-2"><AlertCircle size={13} /> 실시간 장애 ({alerts.length})</span>}
          className="lg:col-span-2"
          action={
            <select value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as NocSeverity | '')}
              className="rounded-md bg-bg-deep px-2 py-1 text-[11px]">
              <option value="">전체 severity</option>
              {(Object.keys(SEVERITY_META) as NocSeverity[]).map((s) => (
                <option key={s} value={s}>{SEVERITY_META[s].ko}</option>
              ))}
            </select>
          }
        >
          {alerts.length === 0 ? (
            <div className="text-[11px] text-ink-mute">활성 장애가 없습니다. 모든 매장이 정상입니다.</div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {alerts.slice(0, 50).map((a, i) => (
                <button key={`${a.store_id}-${a.category}-${i}`}
                  type="button"
                  onClick={() => void onOpenStoreDetail(a.store_id)}
                  className="flex w-full items-start justify-between gap-2 rounded bg-bg-deep/40 px-2 py-1.5 text-left text-xs ring-1 ring-line/10 hover:ring-line/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <AdminBadge tone={SEVERITY_META[a.severity].tone} icon={SEVERITY_META[a.severity].icon}>
                        {SEVERITY_META[a.severity].ko}
                      </AdminBadge>
                      <span className="font-semibold text-ink truncate">{a.store_name ?? a.store_id.slice(0, 8)}</span>
                      {a.franchise_name && <span className="text-[10px] text-ink-mute">· {a.franchise_name}</span>}
                      {a.region_name && <span className="text-[10px] text-ink-mute">· {a.region_name}</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-mute">{a.message}</div>
                    {a.error_message && (
                      <div className="mt-0.5 truncate text-[10px] text-ink-dim">{a.error_message}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-ink-dim tabular-nums">{fmtTime(a.event_at)}</span>
                </button>
              ))}
            </div>
          )}
        </AdminCard>
      </div>

      {/* Store Health + Live Timeline */}
      <div className="grid gap-3 lg:grid-cols-2">
        <AdminCard
          title={<span className="flex items-center gap-2"><Heart size={13} /> Store Health ({filteredHealth.length}/{healthList.length})</span>}
          action={
            <input type="text" value={healthSearch} onChange={(e) => setHealthSearch(e.target.value)}
              placeholder="매장/본사/지역 검색"
              className="rounded-md bg-bg-deep px-2 py-1 text-[11px] w-40" />
          }
        >
          {filteredHealth.length === 0 ? (
            <div className="text-[11px] text-ink-mute">표시할 매장이 없습니다.</div>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {filteredHealth.slice(0, 100).map((h) => (
                <button key={h.store_id}
                  type="button"
                  onClick={() => void onOpenStoreDetail(h.store_id)}
                  className="flex w-full items-center justify-between gap-2 rounded bg-bg-deep/40 px-2 py-1.5 text-left text-xs ring-1 ring-line/10 hover:ring-line/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${HEALTH_TONE[h.health_tone]}`}>
                        {h.score}
                      </span>
                      <span className="font-semibold text-ink truncate">{h.store_name ?? '—'}</span>
                      {h.is_online
                        ? <Wifi size={10} className="text-emerald-300" />
                        : <WifiOff size={10} className="text-rose-300" />}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-ink-mute">
                      {h.franchise_name}{h.region_name ? ` · ${h.region_name}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-ink-dim tabular-nums">{fmtTime(h.last_heartbeat_at)}</span>
                </button>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard title={<span className="flex items-center gap-2"><History size={13} /> Live Timeline (최근 24h)</span>}>
          {events.length === 0 ? (
            <div className="text-[11px] text-ink-mute">최근 이벤트가 없습니다.</div>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {events.slice(0, 100).map((e) => (
                <div key={e.id}
                  className="flex items-start gap-2 rounded bg-bg-deep/40 px-2 py-1.5 text-xs ring-1 ring-line/10">
                  <AdminBadge tone={SEVERITY_META[e.severity].tone} size="sm">{SEVERITY_META[e.severity].ko}</AdminBadge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-ink-mute">{e.category}</span>
                      <span className="ml-auto text-[10px] text-ink-dim tabular-nums">{fmtTime(e.created_at)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink">{e.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone={toast.tone} title={toast.title} description={toast.body} />
        </div>
      )}

      {/* Store detail modal */}
      {(storeDetail || storeDetailLoading) && (
        <StoreDetailModal
          detail={storeDetail}
          loading={storeDetailLoading}
          onClose={() => setStoreDetail(null)}
        />
      )}

      {/* Notification channels modal */}
      {showChannels && (
        <ChannelsModal
          channels={channels}
          onClose={() => setShowChannels(false)}
          onCreate={() => setShowCreateChannel(true)}
          onEdit={setEditingChannel}
          onChanged={async () => { await loadAll(true); }}
        />
      )}
      {(showCreateChannel || editingChannel) && (
        <ChannelFormModal
          channel={editingChannel}
          onClose={() => { setShowCreateChannel(false); setEditingChannel(null); }}
          onSaved={async (msg) => {
            setShowCreateChannel(false); setEditingChannel(null);
            setToast({ tone: 'success', title: '알림 채널 저장됨', body: msg });
            await loadAll(true);
          }}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// StoreDetailModal
// =============================================================================

function StoreDetailModal({
  detail, loading, onClose,
}: { detail: NocStoreDetail | null; loading: boolean; onClose: () => void }) {
  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2"><Server size={14} /> 매장 상세</span>}
      headerExtra={detail && (
        <AdminBadge tone={
          detail.health.score >= 90 ? 'success' :
          detail.health.score >= 70 ? 'warning' :
          detail.health.score >= 50 ? 'info' : 'danger'
        }>Score {detail.health.score}</AdminBadge>
      )}
      footer={<AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>}>
      {loading ? (
        <AdminSkeleton variant="block" rows={8} />
      ) : detail ? (
        <div className="space-y-3 text-xs">
          {/* Now Playing */}
          <Section title="현재 재생 / 매장 정보">
            {detail.now_playing ? (() => {
              const np = detail.now_playing as Record<string, unknown>;
              const s = (k: string) => (np[k] as string | number | boolean | null | undefined);
              return (
                <div className="grid gap-2 md:grid-cols-2">
                  <KV label="매장명" value={s('store_name') ?? '—'} />
                  <KV label="본사" value={s('franchise_name') ?? '—'} />
                  <KV label="지역" value={s('region_name') ?? '—'} />
                  <KV label="플레이어 상태" value={s('player_status') ?? '—'} />
                  <KV label="현재 곡" value={s('track_title') ?? '—'} />
                  <KV label="아티스트" value={s('artist_name') ?? '—'} />
                  <KV label="볼륨" value={`${s('volume') ?? '—'}%`} />
                  <KV label="앱 버전" value={s('app_version') ?? '—'} />
                  <KV label="온라인" value={s('is_online') ? '예' : '아니오'} />
                  <KV label="마지막 heartbeat" value={fmtDt(s('last_heartbeat_at') as string | null)} />
                </div>
              );
            })() : <div className="text-ink-mute">정보 없음</div>}
          </Section>

          {/* Health breakdown */}
          <Section title={`Health Breakdown (Score ${detail.health.score})`}>
            {Object.keys(detail.health.breakdown).length === 0 ? (
              <div className="text-emerald-300">모두 정상 — 감점 없음</div>
            ) : (
              <ul className="space-y-1">
                {Object.entries(detail.health.breakdown).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between rounded bg-bg-deep/40 px-2 py-1">
                    <span className="text-ink">{k}</span>
                    <span className="font-mono tabular-nums text-rose-300">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Recent emergency */}
          {detail.recent_emergency.length > 0 && (
            <Section title="최근 긴급방송">
              <ul className="space-y-1">
                {detail.recent_emergency.map((raw, i) => {
                  const e = raw as Record<string, string | number | null>;
                  return (
                    <li key={i} className="rounded bg-bg-deep/40 px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">{e.title}</span>
                        <AdminBadge tone={e.status === 'played' ? 'success' : e.status === 'failed' ? 'danger' : 'neutral'}>{e.status}</AdminBadge>
                      </div>
                      <div className="text-[10px] text-ink-mute">{fmtDt((e.played_at ?? e.failed_at) as string | null)}</div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {detail.recent_announcement.length > 0 && (
            <Section title="최근 안내음원">
              <ul className="space-y-1">
                {detail.recent_announcement.slice(0, 5).map((raw, i) => {
                  const a = raw as Record<string, string | null>;
                  return (
                    <li key={i} className="flex items-center justify-between rounded bg-bg-deep/40 px-2 py-1">
                      <span className="text-ink">{a.status}</span>
                      <span className="text-[10px] text-ink-mute">{fmtDt(a.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {detail.recent_policy.length > 0 && (
            <Section title="최근 정책 배포">
              <ul className="space-y-1">
                {detail.recent_policy.slice(0, 5).map((raw, i) => {
                  const p = raw as Record<string, string | null>;
                  return (
                    <li key={i} className="rounded bg-bg-deep/40 px-2 py-1">
                      <div className="flex items-center justify-between">
                        <AdminBadge tone={p.status === 'success' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>{p.status}</AdminBadge>
                        <span className="text-[10px] text-ink-mute">{fmtDt(p.updated_at)}</span>
                      </div>
                      {p.failure_reason && <div className="text-[10px] text-rose-300">{p.failure_reason}</div>}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {detail.recent_logs.length > 0 && (
            <Section title="최근 audit 로그 (top 20)">
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {detail.recent_logs.map((raw) => {
                  const l = raw as Record<string, string>;
                  return (
                    <li key={l.id} className="rounded bg-bg-deep/40 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-ink-mute truncate">{l.category}</span>
                        <span className="text-[10px] text-ink-dim tabular-nums">{fmtDt(l.created_at)}</span>
                      </div>
                      <div className="truncate text-[11px] text-ink">{l.message}</div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      ) : null}
    </AdminModal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-bg-deep px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

// =============================================================================
// ChannelsModal + ChannelFormModal
// =============================================================================

function ChannelsModal({
  channels, onClose, onCreate, onEdit, onChanged,
}: {
  channels: NocNotificationChannel[];
  onClose: () => void;
  onCreate: () => void;
  onEdit: (c: NocNotificationChannel) => void;
  onChanged: () => void | Promise<void>;
}) {
  const onDelete = async (c: NocNotificationChannel) => {
    if (!window.confirm(`"${c.name}" 알림 채널을 삭제하시겠습니까?`)) return;
    try {
      await deleteNotificationChannel(c.id);
      await onChanged();
    } catch (e) { window.alert(`삭제 실패: ${(e as Error).message}`); }
  };

  return (
    <AdminModal open onClose={onClose} size="lg"
      title={<span className="flex items-center gap-2"><Bell size={14} /> 알림 채널 관리</span>}
      footer={
        <>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={11} />} onClick={onCreate}>새 채널</AdminButton>
          <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
        </>
      }>
      <AdminAlert tone="info" title="V1 알림 정책"
        description="채널 설정만 저장됩니다. 실제 송신은 V2 Edge Function 에서 구현 예정입니다." />
      {channels.length === 0 ? (
        <AdminEmpty icon={<Bell size={24} />} title="등록된 알림 채널이 없습니다." description="'새 채널' 버튼으로 시작하세요." />
      ) : (
        <ul className="mt-3 space-y-2">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-xl bg-bg-deep/40 p-2 text-xs ring-1 ring-line/10">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AdminBadge tone={c.enabled ? 'success' : 'neutral'}>{c.channel_type}</AdminBadge>
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-[10px] text-ink-mute">severity≥{c.severity_filter}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-dim truncate">{JSON.stringify(c.config)}</div>
              </div>
              <div className="flex items-center gap-1">
                <AdminButton tone="primary" variant="ghost" size="sm" onClick={() => onEdit(c)}>편집</AdminButton>
                <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                  onClick={() => void onDelete(c)}>—</AdminButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminModal>
  );
}

function ChannelFormModal({
  channel, onClose, onSaved,
}: {
  channel: NocNotificationChannel | null;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const isEdit = !!channel;
  const [name, setName] = useState(channel?.name ?? '');
  const [type, setType] = useState<NocChannelType>(channel?.channel_type ?? 'slack');
  const [configText, setConfigText] = useState(channel ? JSON.stringify(channel.config, null, 2) : '{\n  "webhook_url": ""\n}');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [severity, setSeverity] = useState<NocSeverity | 'all'>(channel?.severity_filter ?? 'critical');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('이름을 입력해 주세요.'); return; }
    let parsedConfig: Record<string, unknown>;
    try { parsedConfig = JSON.parse(configText) as Record<string, unknown>; }
    catch (e) { setErr(`config JSON 파싱 실패: ${(e as Error).message}`); return; }
    setBusy(true);
    try {
      await upsertNotificationChannel({
        id: channel?.id ?? null, name, channelType: type,
        config: parsedConfig, enabled, severityFilter: severity,
      });
      await onSaved(`${name} [${type}]`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><Bell size={14} /> {isEdit ? '알림 채널 수정' : '새 알림 채널'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>저장</AdminButton>
        </>
      }>
      <div className="space-y-3 text-xs">
        <label className="block">
          <span className="text-ink-dim">이름 *</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="예) 운영팀 Slack #ops-alerts"
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-ink-dim">채널 유형 *</span>
            <select value={type} onChange={(e) => setType(e.target.value as NocChannelType)}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label className="block">
            <span className="text-ink-dim">최소 severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as NocSeverity | 'all')}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="critical">critical only</option>
              <option value="major">major+</option>
              <option value="minor">minor+</option>
              <option value="info">info+</option>
              <option value="all">all</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-ink-dim">config (JSON)</span>
          <textarea rows={5} value={configText} onChange={(e) => setConfigText(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
          <p className="mt-1 text-[10px] text-ink-dim">예: Slack/Discord = {`{ "webhook_url": "..." }`}, Email = {`{ "to": "ops@example.com" }`}</p>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-[11px]">활성화</span>
        </label>
        {err && <AdminAlert tone="danger" title="저장 실패" description={err} />}
      </div>
    </AdminModal>
  );
}

// Reserved
void AdminTooltip; void Settings;
