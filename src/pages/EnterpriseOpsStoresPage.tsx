/**
 * EnterpriseOpsStoresPage — ENTERPRISE-HQ-OPS-1
 *
 * 본사(HQ) Franchise Operations Center — 가맹점 통합 운영 목록.
 * 경로: /enterprise/operations/stores
 *
 * - 상단 KPI 8종
 * - 검색 / 상태 필터 / 페이지네이션 (서버 처리)
 * - 매장 행: 상태(서버 판정) · 재생 · 계약/미납 · Health
 * - 실제 데이터 없는 항목은 '미지원'/'데이터 없음'/'수집 전' 표기 (가짜 값 금지)
 *
 * 권한은 서버 RPC(get_my_enterprise_ops_fleet)가 강제한다. 비-HQ 는 forbidden → 안내 화면.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity, AlertCircle, ArrowLeft, ChevronRight, RefreshCw, Search, X,
  Building2, WifiOff, TriangleAlert, CreditCard, CalendarClock, ArrowUpCircle, Radio,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  getMyEnterpriseOpsFleet,
  type HqFleetResult,
  type HqFleetRow,
  type HqFleetStatusFilter,
} from '@/lib/api/enterpriseHqOpsFleetApi';
import {
  OPERATIONAL_STATUS_LABEL,
  OPERATIONAL_STATUS_TONE,
  HEARTBEAT_STATE_LABEL,
  HEARTBEAT_STATE_TONE,
  fieldOrAbsent,
  formatRelativeTime,
  type StatusTone,
} from '@/lib/hqOpsFleet';

const PAGE_SIZE = 30;
const POLL_MS = 30_000;

const TONE_CLASS: Record<StatusTone, string> = {
  green: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300',
  red: 'bg-rose-500/15 text-rose-600 ring-rose-500/30 dark:text-rose-300',
  gray: 'bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300',
};

function ToneBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

interface FilterDef {
  key: HqFleetStatusFilter | 'all';
  label: string;
  kpiField?: keyof HqFleetResult['kpi'];
}
const FILTERS: FilterDef[] = [
  { key: 'all', label: '전체', kpiField: 'total_stores' },
  { key: 'normal', label: '정상', kpiField: 'normal_stores' },
  { key: 'warning', label: '경고', kpiField: 'warning_stores' },
  { key: 'offline', label: '오프라인', kpiField: 'offline_stores' },
  { key: 'incident', label: 'Incident', kpiField: 'incident_stores' },
  { key: 'update_required', label: '업데이트 필요', kpiField: 'update_required_stores' },
  { key: 'unpaid', label: '미납', kpiField: 'unpaid_stores' },
  { key: 'contract_expiring', label: '계약 만료 예정', kpiField: 'contract_expiring_stores' },
];

const KPI_CARDS: { field: keyof HqFleetResult['kpi']; label: string; icon: React.ReactNode; tone: StatusTone }[] = [
  { field: 'total_stores', label: '전체 가맹점', icon: <Building2 size={13} />, tone: 'gray' },
  { field: 'normal_stores', label: '정상 재생', icon: <Radio size={13} />, tone: 'green' },
  { field: 'warning_stores', label: '경고', icon: <TriangleAlert size={13} />, tone: 'amber' },
  { field: 'offline_stores', label: '오프라인', icon: <WifiOff size={13} />, tone: 'red' },
  { field: 'incident_stores', label: '현재 Incident', icon: <AlertCircle size={13} />, tone: 'red' },
  { field: 'update_required_stores', label: '업데이트 필요', icon: <ArrowUpCircle size={13} />, tone: 'amber' },
  { field: 'unpaid_stores', label: '미납', icon: <CreditCard size={13} />, tone: 'red' },
  { field: 'contract_expiring_stores', label: '계약 만료 예정', icon: <CalendarClock size={13} />, tone: 'amber' },
];

export default function EnterpriseOpsStoresPage() {
  const user = useAuthStore((s) => s.user);

  const [result, setResult] = useState<HqFleetResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<HqFleetStatusFilter | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getMyEnterpriseOpsFleet({
        search: search || null,
        status: status === 'all' ? null : status,
        sort: 'status',
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (seq === reqSeq.current) setResult(res);
    } catch (e) {
      if (seq === reqSeq.current) {
        setError(e instanceof Error ? e.message : '불러오기 실패');
        setResult(null);
      }
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 자동 새로고침 (검색/필터 유지)
  useEffect(() => {
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!user) return <Navigate to="/login" replace />;

  const kpi = result?.kpi;
  const rows = result?.data ?? [];
  const total = result?.pagination.total ?? 0;
  const hasMore = result?.pagination.has_more ?? false;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* header */}
      <div className="mb-4 flex items-center gap-3">
        <Link to="/enterprise/me" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Activity size={20} className="text-accent" /> 가맹점 운영 센터
          </h1>
          <p className="text-xs text-ink-mute">전체 가맹점 실시간 운영 상태 · 재생 · 계약/미납 · Health</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-card px-2.5 py-1.5 text-[11px] font-semibold hover:bg-bg-hover disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-rose-50 border border-rose-200 p-4 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40">
          <p className="flex items-center gap-1.5 text-sm text-slate-900 dark:text-rose-100">
            <AlertCircle size={15} /> {error}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-rose-200/80">
            본사(HQ) 계정으로 로그인해야 이 화면을 볼 수 있습니다.
          </p>
        </div>
      )}

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KPI_CARDS.map((c) => (
          <div key={c.field} className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-ink-mute">
              <span className={
                c.tone === 'green' ? 'text-emerald-500'
                : c.tone === 'amber' ? 'text-amber-500'
                : c.tone === 'red' ? 'text-rose-500' : 'text-slate-400'
              }>{c.icon}</span>
              {c.label}
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">
              {kpi ? kpi[c.field].toLocaleString('ko-KR') : loading ? '—' : 0}
            </p>
          </div>
        ))}
      </div>

      {/* enterprise-scope billing/contract note */}
      {result && (result.billing.unpaid_invoice_count > 0 || result.contract?.is_expiring) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs dark:bg-amber-500/20 dark:border-transparent dark:ring-1 dark:ring-amber-400/40">
          <span className="font-bold text-amber-700 dark:text-amber-200">본사 단위</span>
          {result.billing.unpaid_invoice_count > 0 && (
            <span className="text-slate-700 dark:text-amber-100">
              미납 인보이스 {result.billing.unpaid_invoice_count}건
              {result.billing.is_overdue ? ' · 연체 발생' : ''}
            </span>
          )}
          {result.contract?.is_expiring && (
            <span className="text-slate-700 dark:text-amber-100">
              계약({result.contract.contract_no}) 만료 임박
            </span>
          )}
        </div>
      )}

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const count = f.kpiField && kpi ? kpi[f.kpiField] : undefined;
          const active = status === f.key;
          return (
            <button
              key={f.key}
              onClick={() => { setStatus(f.key); setPage(0); }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
                active ? 'bg-accent text-white ring-accent' : 'bg-bg-card text-ink-mute ring-line/10 hover:bg-bg-hover'
              }`}
            >
              {f.label}{count !== undefined ? ` ${count}` : ''}
            </button>
          );
        })}
      </div>

      {/* search */}
      <form
        onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(0); }}
        className="mb-3 flex gap-2"
      >
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="매장명 · 브랜드 · 지역 · 업종 검색"
            className="w-full rounded-lg bg-bg-card pl-8 pr-8 py-2 text-xs ring-1 ring-line/10"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setPage(0); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-mute hover:bg-bg-hover"
              aria-label="검색 지우기"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button type="submit" className="rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover">검색</button>
      </form>

      {/* list */}
      <section className="rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="flex items-center gap-1.5 border-b border-line/10 px-4 py-2.5">
          <h2 className="text-sm font-bold">매장 목록</h2>
          <span className="text-[11px] text-ink-mute">({total.toLocaleString('ko-KR')}개)</span>
        </div>

        {loading && !result ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-bg-deep" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-mute">
            {error ? '데이터를 불러오지 못했습니다.' : '조건에 맞는 매장이 없습니다.'}
          </div>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((row) => <StoreRow key={row.store_id} row={row} />)}
          </ul>
        )}

        {/* pagination */}
        {result && total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line/10 px-4 py-2.5 text-xs">
            <span className="text-ink-mute">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="rounded bg-bg-deep px-2.5 py-1 font-semibold hover:bg-bg-hover disabled:opacity-40"
              >이전</button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore || loading}
                className="rounded bg-bg-deep px-2.5 py-1 font-semibold hover:bg-bg-hover disabled:opacity-40"
              >다음</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StoreRow({ row }: { row: HqFleetRow }) {
  const op = row.operational;
  return (
    <li>
      <Link
        to={`/enterprise/operations/stores/${row.store_id}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ToneBadge tone={OPERATIONAL_STATUS_TONE[op.status]}>{OPERATIONAL_STATUS_LABEL[op.status]}</ToneBadge>
            <span className="truncate text-sm font-bold">{row.store_name}</span>
            {!row.is_active && (
              <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">비활성</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-mute">
            <span>{fieldOrAbsent(row.franchise_name)}</span>
            <span>· {fieldOrAbsent(row.enterprise_region_name)}</span>
            <span>· 업종 {fieldOrAbsent(row.business_category)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${
                HEARTBEAT_STATE_TONE[row.heartbeat_state] === 'green' ? 'bg-emerald-500'
                : HEARTBEAT_STATE_TONE[row.heartbeat_state] === 'amber' ? 'bg-amber-500'
                : HEARTBEAT_STATE_TONE[row.heartbeat_state] === 'red' ? 'bg-rose-500' : 'bg-slate-400'
              }`} />
              {HEARTBEAT_STATE_LABEL[row.heartbeat_state]}
              <span className="text-ink-mute">· {formatRelativeTime(row.last_heartbeat_at)}</span>
            </span>
            {row.current_track_title ? (
              <span className="truncate text-ink-mute">♪ {row.current_track_title} — {fieldOrAbsent(row.current_track_artist)}</span>
            ) : (
              <span className="text-ink-mute">♪ 재생 정보 없음</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-ink-mute">Health</p>
          <p className="text-lg font-extrabold tabular-nums">
            {row.health_score === null ? <span className="text-sm text-ink-mute">—</span> : row.health_score}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0 text-ink-mute" />
      </Link>
    </li>
  );
}
