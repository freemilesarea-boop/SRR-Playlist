/**
 * EnterpriseHqOpsPage — Phase 3-3
 *
 * 본사 (HQ) 운영 관제 화면. `/enterprise/ops`.
 * super admin 관제 (Command Center / NOC / Store Monitoring) 는 그대로 유지하고
 * HQ 는 이 화면에서 자기 브랜드 소속 매장만 조회/조치한다.
 *
 * SQL: supabase/migrations/0401_enterprise_hq_ops_center.sql
 * API: src/lib/api/enterpriseHqOpsApi.ts
 *
 * 섹션:
 *   1) Hero KPI 6 카드
 *   2) 매장 리스트 (검색/필터/정렬 + 개별/일괄 강제 동기화)
 *   3) Now Playing 요약
 *   4) Active Alerts (severity 정렬)
 *   5) Activity Feed (최근 감사 로그)
 *
 * 절대 원칙:
 *   - HQ 는 자기 소속 매장만 조회 (0401 RPC 게이트)
 *   - 강제 동기화는 last_policy_sync_at=null 로 리셋 (매장 다음 폴에서 재수신)
 *   - Bulk 상한 100개 (클라 사전 차단 + 서버 validation)
 *   - HF1~GC UI contrast 정책 유지 (라이트/다크 이중 테마)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity, RefreshCw, AlertCircle, ArrowLeft, Wifi, WifiOff, Music, ShieldAlert,
  ScrollText, Radio, Zap, CheckCircle2, PlayCircle, Search, X,
  ChevronLeft, ChevronRight, Clock as ClockIcon, MapPin, Store as StoreIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import EnterpriseHqNotificationBell from '@/components/enterprise/EnterpriseHqNotificationBell';
import {
  getMyEnterpriseOpsKpi,
  getMyEnterpriseOpsStores,
  getMyEnterpriseOpsNowPlaying,
  getMyEnterpriseOpsAlerts,
  getMyEnterpriseOpsActivityFeed,
  hqForceStoreResync,
  hqBulkForceResync,
  storeState,
  HQ_OPS_STATE_LABEL,
  HQ_OPS_STATUS_FILTER_LABEL,
  type HqOpsKpi,
  type HqOpsStore,
  type HqOpsStoreState,
  type HqOpsStatusFilter,
  type HqOpsNowPlayingRow,
  type HqOpsAlert,
  type HqOpsActivityRow,
} from '@/lib/api/enterpriseHqOpsApi';

const KPI_POLL_MS = 15_000;
const STORES_POLL_MS = 15_000;
const ALERTS_POLL_MS = 10_000;
const NOW_PLAYING_POLL_MS = 15_000;
const ACTIVITY_POLL_MS = 30_000;
const PAGE_SIZE = 50;
const BULK_LIMIT = 100;

export default function EnterpriseHqOpsPage() {
  const { user, loading: authLoading } = useAuthStore();

  if (!authLoading && !user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
      <PageHeader />
      <HeroKpiSection />
      <StoresSection />
      <div className="grid gap-4 lg:grid-cols-2">
        <NowPlayingSection />
        <AlertsSection />
      </div>
      <ActivityFeedSection />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

function PageHeader() {
  return (
    <header className="flex items-center gap-3">
      <Link
        to="/enterprise/me"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
        aria-label="본사 대시보드로"
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="flex-1 min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Radio size={20} className="text-accent" /> 운영 관제
        </h1>
        <p className="text-xs text-ink-mute">
          자기 브랜드 매장의 실시간 상태를 확인하고 정책 재동기화까지 즉시 조치할 수 있어요.
        </p>
      </div>
      <EnterpriseHqNotificationBell className="bg-bg-card hover:bg-bg-hover" />
    </header>
  );
}

// -----------------------------------------------------------------------------
// 1) Hero KPI
// -----------------------------------------------------------------------------

function HeroKpiSection() {
  const [kpi, setKpi] = useState<HqOpsKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKpi(await getMyEnterpriseOpsKpi());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), KPI_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  if (loading && !kpi) {
    return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  }
  if (error) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40">
        <p className="text-sm text-slate-900 dark:text-rose-100">
          <AlertCircle size={12} className="mr-1 inline" /> {error}
        </p>
        <button
          onClick={() => void load()}
          className="mt-2 rounded bg-white/70 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-900 dark:bg-rose-500/30 dark:border-transparent dark:text-rose-50"
        >
          재시도
        </button>
      </div>
    );
  }
  if (!kpi) return null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard icon={<StoreIcon size={14} />} label="전체" value={kpi.total} tone="neutral" />
      <KpiCard icon={<Wifi size={14} />} label="온라인" value={kpi.online} tone="emerald" />
      <KpiCard icon={<ClockIcon size={14} />} label="유휴 (1h~24h)" value={kpi.idle_24h} tone="amber" />
      <KpiCard icon={<WifiOff size={14} />} label="오프라인 (24h+)" value={kpi.offline} tone="rose" />
      <KpiCard icon={<Music size={14} />} label="정책 지연" value={kpi.policy_outdated} tone="amber" />
      <KpiCard icon={<ShieldAlert size={14} />} label="재생 오류" value={kpi.playback_errors} tone="rose" />
    </section>
  );
}

function KpiCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: number;
  tone: 'neutral' | 'emerald' | 'amber' | 'rose';
}) {
  const toneCls =
    tone === 'emerald'
      ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40'
    : tone === 'amber'
      ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/25 dark:border-transparent dark:ring-1 dark:ring-amber-400/40'
    : tone === 'rose'
      ? 'bg-rose-50 border-rose-200 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40'
      : 'bg-bg-card border-line/10 dark:border-transparent';
  const iconCls =
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-100'
    : tone === 'amber' ? 'text-amber-700 dark:text-amber-100'
    : tone === 'rose'  ? 'text-rose-700 dark:text-rose-100'
    : 'text-ink';
  return (
    <div className={`rounded-2xl border p-3 ${toneCls}`}>
      <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-ink-mute">
        <span className={iconCls}>{icon}</span> {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-950 dark:text-ink">
        {value.toLocaleString('ko-KR')}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2) Stores 리스트
// -----------------------------------------------------------------------------

function StoresSection() {
  const [rows, setRows] = useState<HqOpsStore[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<HqOpsStatusFilter | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseOpsStores({
        search: search || null,
        status: status || null,
        limit: PAGE_SIZE,
        offset,
      });
      setRows(r.data);
      setTotal(r.pagination.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, status, offset]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), STORES_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());

  const onForceResyncOne = async (id: string) => {
    if (!confirm('이 매장에 정책 재동기화를 요청할까요? 매장이 다음 폴링(약 60초 이내)에서 최신 정책을 다시 받아요.')) return;
    setActing(true);
    try {
      await hqForceStoreResync(id);
      toast.success('강제 동기화 요청됨.');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(false);
    }
  };

  const onBulkResync = async () => {
    if (selected.size === 0) {
      toast.error('먼저 매장을 선택해주세요.');
      return;
    }
    if (selected.size > BULK_LIMIT) {
      toast.error(`한번에 최대 ${BULK_LIMIT}개까지만 요청할 수 있어요.`);
      return;
    }
    if (!confirm(`선택된 ${selected.size}개 매장에 정책 재동기화를 요청할까요?`)) return;
    setActing(true);
    try {
      const r = await hqBulkForceResync(Array.from(selected));
      if (r.failed_count === 0) {
        toast.success(`${r.success_count}개 매장 강제 동기화 요청 완료.`);
      } else {
        toast.info(`요청 완료 — 성공 ${r.success_count} / 실패 ${r.failed_count}`);
      }
      clearSelected();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(false);
    }
  };

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const statusOptions: HqOpsStatusFilter[] = [
    'online', 'idle_1h', 'idle_24h', 'offline',
    'policy_outdated', 'playback_error', 'volume_error',
    'device_missing', 'update_required',
  ];

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-1.5 text-sm font-bold">
          <StoreIcon size={14} /> 매장 목록
          <span className="ml-1 text-[11px] font-normal text-ink-mute">({total.toLocaleString('ko-KR')}개)</span>
        </h2>
        <button
          onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-[11px] text-slate-900 hover:bg-bg-hover disabled:opacity-50 dark:text-ink"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* Filter row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="매장명 · 프랜차이즈 · 지역 검색"
            className="w-full rounded bg-bg-deep pl-7 pr-2 py-1.5 text-xs"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setOffset(0); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-mute hover:bg-bg-hover"
              aria-label="검색 초기화"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as HqOpsStatusFilter | ''); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1.5 text-xs"
          aria-label="상태 필터"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{HQ_OPS_STATUS_FILTER_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 border border-sky-200 p-2.5 dark:bg-sky-500/25 dark:border-transparent dark:ring-1 dark:ring-sky-400/40">
          <span className="text-xs font-semibold text-slate-950 dark:text-sky-50">
            선택된 매장 {selected.size}개
          </span>
          <button
            onClick={clearSelected}
            className="text-[11px] text-slate-700 underline dark:text-sky-100"
          >
            선택 해제
          </button>
          <button
            onClick={() => void onBulkResync()}
            disabled={acting}
            className="ml-auto inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-sky-500 disabled:opacity-50"
          >
            <Zap size={11} /> 선택 강제 동기화 (최대 {BULK_LIMIT}개)
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40">
          <p className="text-slate-900 dark:text-rose-100">
            <AlertCircle size={12} className="mr-1 inline" /> {error}
          </p>
        </div>
      )}

      {/* Table */}
      <div className="mt-3 overflow-x-auto rounded-lg bg-bg-soft ring-1 ring-line/10">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-bg-deep text-[10px] uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-2 py-2 w-10 text-center">선택</th>
              <th className="px-3 py-2 text-left">매장</th>
              <th className="px-3 py-2 text-left">지역</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-left">마지막 heartbeat</th>
              <th className="px-3 py-2 text-left">정책 sync</th>
              <th className="px-3 py-2 text-right">조치</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                  조건에 맞는 매장이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <StoreRow
                  key={s.store_id}
                  store={s}
                  selected={selected.has(s.store_id)}
                  onToggle={() => toggle(s.store_id)}
                  onResync={() => void onForceResyncOne(s.store_id)}
                  acting={acting}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-mute">
          <span>
            {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString('ko-KR')}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev}
              className="inline-flex items-center gap-0.5 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50"
            >
              <ChevronLeft size={11} /> 이전
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasNext}
              className="inline-flex items-center gap-0.5 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50"
            >
              다음 <ChevronRight size={11} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StoreRow({
  store, selected, onToggle, onResync, acting,
}: {
  store: HqOpsStore; selected: boolean;
  onToggle: () => void; onResync: () => void; acting: boolean;
}) {
  const state = storeState(store);
  return (
    <tr className={`text-xs ${selected ? 'bg-sky-50/70 dark:bg-sky-500/10' : ''}`}>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox" checked={selected} onChange={onToggle}
          aria-label={`${store.store_name} 선택`}
          className="h-3.5 w-3.5"
        />
      </td>
      <td className="px-3 py-2">
        <div className="font-semibold">{store.store_name}</div>
        {store.franchise_name && (
          <div className="text-[10px] text-ink-mute truncate">{store.franchise_name}</div>
        )}
      </td>
      <td className="px-3 py-2">
        {store.enterprise_region_name ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
            <MapPin size={10} /> {store.enterprise_region_name}
          </span>
        ) : (
          <span className="text-[10px] text-ink-dim">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <StoreStateBadge state={state} />
      </td>
      <td className="px-3 py-2 text-[11px] text-ink-mute">
        {store.last_seen_at
          ? new Date(store.last_seen_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—'}
      </td>
      <td className="px-3 py-2 text-[11px] text-ink-mute">
        {store.last_policy_sync_at
          ? new Date(store.last_policy_sync_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : <span className="text-amber-700 dark:text-amber-200">미동기화</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={onResync}
          disabled={acting}
          className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Zap size={11} /> 재동기화
        </button>
      </td>
    </tr>
  );
}

function StoreStateBadge({ state }: { state: HqOpsStoreState }) {
  const cls: Record<HqOpsStoreState, string> = {
    online: 'bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-500/25 dark:text-emerald-100 dark:ring-emerald-400/40',
    idle_1h: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-500/25 dark:text-amber-100 dark:ring-amber-400/40',
    idle_24h: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-500/25 dark:text-amber-100 dark:ring-amber-400/40',
    offline: 'bg-rose-100 text-rose-900 ring-rose-300 dark:bg-rose-500/25 dark:text-rose-100 dark:ring-rose-400/40',
    policy_outdated: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-500/25 dark:text-amber-100 dark:ring-amber-400/40',
    playback_error: 'bg-rose-100 text-rose-900 ring-rose-300 dark:bg-rose-500/25 dark:text-rose-100 dark:ring-rose-400/40',
    unknown: 'bg-slate-100 text-slate-900 ring-slate-300 dark:bg-ink/15 dark:text-ink dark:ring-line/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls[state]}`}>
      {HQ_OPS_STATE_LABEL[state]}
    </span>
  );
}

// -----------------------------------------------------------------------------
// 3) Now Playing
// -----------------------------------------------------------------------------

function NowPlayingSection() {
  const [rows, setRows] = useState<HqOpsNowPlayingRow[]>([]);
  const [totalPlaying, setTotalPlaying] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseOpsNowPlaying(20);
      setRows(r.data);
      setTotalPlaying(r.total_playing);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), NOW_PLAYING_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <PlayCircle size={14} /> 지금 재생 중
        </h2>
        <span className="ml-auto text-[11px] text-ink-mute">
          매장 {totalPlaying.toLocaleString('ko-KR')}곳
        </span>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-200">
          <AlertCircle size={11} className="inline" /> {error}
        </p>
      )}
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-32 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-ink-mute">현재 재생 중인 매장이 없습니다.</p>
      ) : (
        <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-line/10">
          {rows.map((r) => (
            <li key={r.store_id} className="flex items-center gap-2 py-2 text-xs">
              <span className="rounded-full bg-emerald-100 p-1 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-100" aria-hidden>
                <Music size={10} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.store_name ?? '(매장명 없음)'}</p>
                <p className="truncate text-[10px] text-ink-mute">
                  {r.current_track_title ?? '—'}
                  {r.current_track_artist && ` · ${r.current_track_artist}`}
                </p>
              </div>
              {typeof r.remaining_seconds === 'number' && r.remaining_seconds >= 0 && (
                <span className="shrink-0 text-[10px] tabular-nums text-ink-mute">
                  {Math.floor(r.remaining_seconds / 60)}:{String(Math.floor(r.remaining_seconds % 60)).padStart(2, '0')} 남음
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// 4) Active Alerts
// -----------------------------------------------------------------------------

function AlertsSection() {
  const [rows, setRows] = useState<HqOpsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseOpsAlerts(40);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), ALERTS_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <ShieldAlert size={14} /> 활성 알림
        </h2>
        <span className="ml-auto text-[11px] text-ink-mute">
          위험도 낮은 순서
        </span>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-200">
          <AlertCircle size={11} className="inline" /> {error}
        </p>
      )}
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-32 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-slate-900 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40 dark:text-emerald-100">
          <CheckCircle2 size={11} className="mr-1 inline text-emerald-700 dark:text-emerald-200" />
          모든 매장이 정상 상태입니다.
        </div>
      ) : (
        <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-line/10">
          {rows.map((a) => (
            <AlertRow key={a.store_id} alert={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AlertRow({ alert }: { alert: HqOpsAlert }) {
  const reason =
    alert.has_playback_error ? '재생 오류'
    : alert.is_offline_24h ? '오프라인 (24h+)'
    : alert.is_idle_1h_to_24h ? '유휴 (1h~24h)'
    : alert.has_policy_outdated ? '정책 지연'
    : alert.has_device_missing ? '기기 미등록'
    : '주의';
  const score = alert.health?.score ?? 0;
  const badgeCls = score < 30
    ? 'bg-rose-100 text-rose-900 dark:bg-rose-500/25 dark:text-rose-100'
    : score < 60
    ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100'
    : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100';
  return (
    <li className="flex items-center gap-2 py-2 text-xs">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${badgeCls}`}>
        {score}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{alert.store_name}</p>
        <p className="truncate text-[10px] text-ink-mute">
          {reason}
          {alert.franchise_name && ` · ${alert.franchise_name}`}
          {alert.enterprise_region_name && ` · ${alert.enterprise_region_name}`}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-ink-dim">
        {alert.last_seen_at
          ? new Date(alert.last_seen_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit' })
          : '—'}
      </span>
    </li>
  );
}

// -----------------------------------------------------------------------------
// 5) Activity Feed
// -----------------------------------------------------------------------------

function ActivityFeedSection() {
  const [rows, setRows] = useState<HqOpsActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseOpsActivityFeed(30);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), ACTIVITY_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <ScrollText size={14} /> 최근 활동
        </h2>
        <span className="ml-auto text-[11px] text-ink-mute">
          최근 {rows.length}건
        </span>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-200">
          <AlertCircle size={11} className="inline" /> {error}
        </p>
      )}
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-24 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-ink-mute">최근 기록된 활동이 없습니다.</p>
      ) : (
        <ul className="mt-3 max-h-72 overflow-y-auto space-y-2">
          {rows.map((r) => (
            <ActivityRow key={r.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ row }: { row: HqOpsActivityRow }) {
  const toneCls = useMemo(() => {
    switch (row.level) {
      case 'error':   return 'bg-rose-50 border-rose-200 dark:bg-rose-500/20 dark:border-transparent dark:ring-1 dark:ring-rose-400/40';
      case 'warning': return 'bg-amber-50 border-amber-200 dark:bg-amber-500/20 dark:border-transparent dark:ring-1 dark:ring-amber-400/40';
      case 'success': return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40';
      default:        return 'bg-slate-50 border-slate-200 dark:bg-bg-deep dark:border-transparent';
    }
  }, [row.level]);

  return (
    <li className={`rounded-lg border p-2 text-[11px] ${toneCls}`}>
      <p className="flex items-center gap-1.5">
        <Activity size={10} className="text-slate-700 dark:text-ink-mute" />
        <span className="font-semibold text-slate-950 dark:text-ink">{row.category}</span>
        <span className="text-slate-700 dark:text-ink-mute">· {row.status}</span>
        <span className="ml-auto text-[10px] text-slate-700 dark:text-ink-dim">
          {new Date(row.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </p>
      <p className="mt-1 line-clamp-2 text-slate-900 dark:text-ink">
        {row.message}
      </p>
    </li>
  );
}
