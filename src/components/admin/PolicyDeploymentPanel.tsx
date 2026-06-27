/**
 * PolicyDeploymentPanel — Enterprise Phase 1-5.
 *
 * 정책 적용 성공률 (Policy Deployment Success Rate).
 *
 * 운영 의도:
 *   본사/관리자가 정책 배포 상태를 숫자로 즉시 확인.
 *     총 240개 매장 · 233개 적용 완료 · 5개 대기 · 2개 실패 · 적용률 97.1%
 *
 * 보호 원칙:
 *   - 매장 플레이어 / heartbeat / now-playing 절대 영향 X
 *   - 이 패널은 관측 레이어. apply_franchise_policy 자동 트리거 X (Phase 1-6 별도 PR)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, AlertCircle, Building2, MapPin, ListChecks, Plus, X,
  CheckCircle2, Clock, XCircle, AlertTriangle, RotateCcw, Calculator, PlayCircle,
} from 'lucide-react';
import {
  listPolicyDeployments, getPolicyDeploymentKpi, getPolicyDeploymentDetail,
  createPolicyDeployment, recomputePolicyDeployment, retryPolicyDeploymentTargets,
  markPolicyTargetFailed,
  type PolicyDeployment, type PolicyDeploymentKpi, type PolicyDeploymentStatus,
  type PolicyDeploymentDetail, type PolicyDeploymentTargetStatus,
} from '@/lib/api/policyDeploymentApi';
import {
  adminListFranchises, type FranchiseListRow,
} from '@/lib/api/franchiseApi';
import {
  adminListEnterpriseAccounts, type EnterpriseAccount,
} from '@/lib/api/enterpriseAccountsApi';

const PAGE_SIZE = 50;

const STATUS_OPTIONS: ReadonlyArray<{ value: PolicyDeploymentStatus; label: string }> = [
  { value: 'running', label: '진행 중' },
  { value: 'completed', label: '완료' },
  { value: 'partial_failed', label: '부분 실패' },
  { value: 'failed', label: '실패' },
  { value: 'cancelled', label: '취소' },
  { value: 'pending', label: '대기' },
];

const STATUS_TONE: Record<PolicyDeploymentStatus, string> = {
  pending: 'bg-bg-deep text-ink-mute',
  running: 'bg-sky-500/20 text-sky-200',
  completed: 'bg-emerald-500/20 text-emerald-200',
  partial_failed: 'bg-amber-500/20 text-amber-200',
  failed: 'bg-rose-500/20 text-rose-200',
  cancelled: 'bg-ink-dim/20 text-ink-mute',
};

const STATUS_LABEL: Record<PolicyDeploymentStatus, string> = {
  pending: '대기', running: '진행 중', completed: '완료',
  partial_failed: '부분 실패', failed: '실패', cancelled: '취소',
};

const TARGET_TONE: Record<PolicyDeploymentTargetStatus, string> = {
  pending: 'bg-bg-deep text-ink-mute',
  applying: 'bg-sky-500/20 text-sky-200',
  success: 'bg-emerald-500/20 text-emerald-200',
  failed: 'bg-rose-500/20 text-rose-200',
  skipped: 'bg-ink-dim/20 text-ink-mute',
  stale: 'bg-amber-500/20 text-amber-200',
};

const TARGET_LABEL: Record<PolicyDeploymentTargetStatus, string> = {
  pending: '대기', applying: '적용 중', success: '성공',
  failed: '실패', skipped: '제외', stale: '구버전',
};

export default function PolicyDeploymentPanel() {
  const [rows, setRows] = useState<PolicyDeployment[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<PolicyDeploymentKpi | null>(null);
  const [franchises, setFranchises] = useState<FranchiseListRow[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PolicyDeploymentStatus | ''>('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const [detail, setDetail] = useState<PolicyDeploymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        listPolicyDeployments({
          search: search.trim() || null,
          status: statusFilter || null,
          enterpriseAccountId: enterpriseFilter || null,
          franchiseId: franchiseFilter || null,
          from: fromFilter ? new Date(fromFilter).toISOString() : null,
          to: toFilter ? new Date(toFilter).toISOString() : null,
          limit: PAGE_SIZE, offset,
        }),
        getPolicyDeploymentKpi(),
      ]);
      setRows(list.data);
      setTotal(list.pagination.total);
      setKpi(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, enterpriseFilter, franchiseFilter, fromFilter, toFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // 필터 옵션 로드 (1회)
  useEffect(() => {
    void adminListFranchises().then(setFranchises).catch((e) => console.warn('[PolicyDeployment] franchises load failed', e));
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data)).catch((e) => console.warn('[PolicyDeployment] enterprises load failed', e));
  }, []);

  const onSearchChange = (v: string) => { setSearch(v); setOffset(0); };

  const openDetail = useCallback(async (deploymentId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getPolicyDeploymentDetail(deploymentId);
      setDetail(d);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const onRecompute = useCallback(async (deploymentId: string) => {
    setActionBusy(true);
    try {
      await recomputePolicyDeployment(deploymentId);
      await Promise.all([load(true), detail ? openDetail(deploymentId) : Promise.resolve()]);
    } catch (e) {
      alert(`재계산 실패: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [load, detail, openDetail]);

  const onRetryFailed = useCallback(async (deploymentId: string) => {
    if (!confirm('실패 대상을 재시도하시겠습니까? (retry_count 증가 + status pending 으로 리셋)')) return;
    setActionBusy(true);
    try {
      await retryPolicyDeploymentTargets(deploymentId, true);
      await Promise.all([load(true), openDetail(deploymentId)]);
    } catch (e) {
      alert(`재시도 실패: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [load, openDetail]);

  const onMarkFailed = useCallback(async (deploymentId: string, storeId: string, storeName: string) => {
    const reason = prompt(`[${storeName}] 실패 사유를 입력하세요`);
    if (!reason || !reason.trim()) return;
    setActionBusy(true);
    try {
      await markPolicyTargetFailed(deploymentId, storeId, reason.trim());
      await Promise.all([load(true), openDetail(deploymentId)]);
    } catch (e) {
      alert(`실패 처리 오류: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [load, openDetail]);

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '전체 배포', value: kpi.total_deployments, tone: 'text-ink', icon: <ListChecks size={12} /> },
      { label: '진행 중', value: kpi.running, tone: 'text-sky-300', icon: <PlayCircle size={12} /> },
      { label: '완료', value: kpi.completed, tone: 'text-emerald-300', icon: <CheckCircle2 size={12} /> },
      { label: '부분 실패', value: kpi.partial_failed, tone: 'text-amber-300', icon: <AlertTriangle size={12} /> },
      { label: '실패', value: kpi.failed, tone: 'text-rose-300', icon: <XCircle size={12} /> },
      { label: '평균 적용률', value: `${kpi.avg_success_rate.toFixed(1)}%`, tone: 'text-emerald-200', icon: <CheckCircle2 size={12} /> },
      { label: '최근 24시간', value: kpi.recent_24h, tone: 'text-sky-200', icon: <Clock size={12} /> },
    ];
  }, [kpi]);

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <ListChecks size={14} /> 정책 적용 성공률
            <span className="text-[10px] font-normal text-ink-dim">(Enterprise Phase 1-5)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90"
            >
              <Plus size={11} /> 배포 생성
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          정책 배포 단위로 success/pending/failed 를 집계합니다. 매장이 heartbeat 로 동기화 시간(last_synced_at)을 보고하면 자동으로 success 로 전환됩니다.
        </p>
      </div>

      {/* KPI */}
      {kpiCards && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">
                {c.icon}{c.label}
              </div>
              <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            type="text" placeholder="배포명/정책/본사/엔터프라이즈"
            value={search} onChange={(e) => onSearchChange(e.target.value)}
            className="rounded bg-bg-deep pl-7 pr-2 py-1 w-64 max-w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as PolicyDeploymentStatus | ''); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1"
        >
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={enterpriseFilter}
          onChange={(e) => { setEnterpriseFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1"
        >
          <option value="">전체 본사 계정</option>
          {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
        </select>
        <select
          value={franchiseFilter}
          onChange={(e) => { setFranchiseFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1"
        >
          <option value="">전체 프랜차이즈</option>
          {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          type="date"
          value={fromFilter}
          onChange={(e) => { setFromFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1"
          title="시작일"
        />
        <span className="text-ink-dim">~</span>
        <input
          type="date"
          value={toFilter}
          onChange={(e) => { setToFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1"
          title="종료일"
        />
        <span className="ml-auto text-ink-dim">{total}건</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <SkeletonRows />
      ) : !loading && rows.length === 0 && !error ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-3 py-2">배포명 / 본사·프랜차이즈</th>
                  <th className="px-3 py-2">정책 (v)</th>
                  <th className="px-3 py-2 text-right">대상</th>
                  <th className="px-3 py-2 text-right">성공</th>
                  <th className="px-3 py-2 text-right">대기</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2 w-[160px]">적용률</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">시작</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <DeploymentRow
                    key={r.deployment_id}
                    row={r}
                    onOpen={() => void openDetail(r.deployment_id)}
                    onRecompute={() => void onRecompute(r.deployment_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <DeploymentCard
                key={r.deployment_id}
                row={r}
                onOpen={() => void openDetail(r.deployment_id)}
                onRecompute={() => void onRecompute(r.deployment_id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30"
              >이전</button>
              <span className="text-ink-mute">
                {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30"
              >다음</button>
            </div>
          )}
        </>
      )}

      {/* Detail drawer */}
      {detail && (
        <DetailDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          actionBusy={actionBusy}
          onClose={() => setDetail(null)}
          onRecompute={() => void onRecompute(detail.deployment.deployment_id)}
          onRetryFailed={() => void onRetryFailed(detail.deployment.deployment_id)}
          onMarkFailed={(storeId, storeName) =>
            void onMarkFailed(detail.deployment.deployment_id, storeId, storeName)
          }
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateDeploymentModal
          franchises={franchises}
          enterprises={enterprises}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Row / Card / Detail / Create
// =============================================================================

function DeploymentRow({
  row, onOpen, onRecompute,
}: {
  row: PolicyDeployment;
  onOpen: () => void;
  onRecompute: () => void;
}) {
  return (
    <tr className="border-b border-line/5 hover:bg-bg-hover/30">
      <td className="px-3 py-2">
        <button onClick={onOpen} className="text-left font-semibold hover:text-accent">
          {row.deployment_name}
        </button>
        <div className="text-[10px] text-ink-mute flex items-center gap-2 mt-0.5">
          {row.enterprise_name && (
            <span className="flex items-center gap-1"><Building2 size={9} />{row.enterprise_name}</span>
          )}
          {row.franchise_name && (
            <span className="flex items-center gap-1"><MapPin size={9} />{row.franchise_name}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div>{row.policy_name ?? '—'}</div>
        <div className="text-[10px] text-ink-dim">v{row.policy_version_number ?? '?'}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.target_store_count}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{row.success_count}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{row.pending_count}</td>
      <td className="px-3 py-2 text-right tabular-nums text-rose-300">{row.failed_count}</td>
      <td className="px-3 py-2">
        <SuccessRateBar pct={row.success_rate} />
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
        {row.started_at ? new Date(row.started_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onRecompute}
            title="재계산"
            className="rounded bg-bg-deep px-1.5 py-1 hover:bg-bg-hover"
          >
            <Calculator size={11} />
          </button>
          <button
            onClick={onOpen}
            className="rounded bg-bg-deep px-2 py-1 text-[10px] font-semibold hover:bg-bg-hover"
          >
            상세
          </button>
        </div>
      </td>
    </tr>
  );
}

function DeploymentCard({
  row, onOpen, onRecompute,
}: {
  row: PolicyDeployment;
  onOpen: () => void;
  onRecompute: () => void;
}) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left">
          <div className="font-bold text-sm">{row.deployment_name}</div>
          <div className="text-[10px] text-ink-mute flex flex-wrap items-center gap-2 mt-0.5">
            {row.enterprise_name && (
              <span className="flex items-center gap-1"><Building2 size={9} />{row.enterprise_name}</span>
            )}
            {row.franchise_name && (
              <span className="flex items-center gap-1"><MapPin size={9} />{row.franchise_name}</span>
            )}
            <span className="text-ink-dim">정책: {row.policy_name ?? '—'} v{row.policy_version_number ?? '?'}</span>
          </div>
        </button>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
        <Stat label="대상" value={row.target_store_count} tone="text-ink" />
        <Stat label="성공" value={row.success_count} tone="text-emerald-300" />
        <Stat label="대기" value={row.pending_count} tone="text-ink-mute" />
        <Stat label="실패" value={row.failed_count} tone="text-rose-300" />
      </div>
      <div className="mt-2">
        <SuccessRateBar pct={row.success_rate} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-mute">
        <span>
          시작: {row.started_at ? new Date(row.started_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onRecompute} className="rounded bg-bg-deep px-2 py-1 font-semibold hover:bg-bg-hover">
            <Calculator size={10} className="inline mr-1" />재계산
          </button>
          <button onClick={onOpen} className="rounded bg-bg-deep px-2 py-1 font-semibold hover:bg-bg-hover">상세</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded bg-bg-deep px-2 py-1">
      <div className="text-ink-dim">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function SuccessRateBar({ pct }: { pct: number }) {
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
  const tone = safePct >= 90 ? 'bg-emerald-400' : safePct >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-bg-deep overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${safePct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums w-10 text-right">{safePct.toFixed(1)}%</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-card" />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-xl bg-bg-card p-8 text-center text-xs text-ink-mute">
      <ListChecks size={28} className="mx-auto mb-2 opacity-50" />
      <p className="font-semibold mb-1">아직 정책 배포 기록이 없습니다.</p>
      <p>새 배포를 생성하면 대상 매장 snapshot 이 잡히고 적용 상태를 추적합니다.</p>
      <button
        onClick={onCreate}
        className="mt-3 inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 font-bold text-black hover:bg-accent/90"
      >
        <Plus size={12} /> 배포 생성
      </button>
    </div>
  );
}

// =============================================================================
// Detail Drawer
// =============================================================================

function DetailDrawer({
  detail, loading, error, actionBusy,
  onClose, onRecompute, onRetryFailed, onMarkFailed,
}: {
  detail: PolicyDeploymentDetail;
  loading: boolean;
  error: string | null;
  actionBusy: boolean;
  onClose: () => void;
  onRecompute: () => void;
  onRetryFailed: () => void;
  onMarkFailed: (storeId: string, storeName: string) => void;
}) {
  const d = detail.deployment;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-full max-w-3xl overflow-y-auto bg-bg p-4 shadow-2xl ring-1 ring-line/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold">{d.deployment_name}</h3>
            <p className="text-[11px] text-ink-mute">
              {d.enterprise_name && `${d.enterprise_name} · `}{d.franchise_name ?? '(프랜차이즈 없음)'}
              {' · '}정책 {d.policy_name ?? '—'} v{d.policy_version_number ?? '?'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-bg-card p-1.5 hover:bg-bg-hover"
            aria-label="닫기"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="대상" value={d.target_store_count} tone="text-ink" />
          <Stat label="성공" value={d.success_count} tone="text-emerald-300" />
          <Stat label="대기" value={d.pending_count} tone="text-ink-mute" />
          <Stat label="실패" value={d.failed_count} tone="text-rose-300" />
          <Stat label="제외" value={d.skipped_count} tone="text-ink-dim" />
        </div>

        <div className="mt-3">
          <SuccessRateBar pct={d.success_rate} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[d.status]}`}>
            {STATUS_LABEL[d.status]}
          </span>
          <span className="text-[10px] text-ink-mute">
            시작 {d.started_at ? new Date(d.started_at).toLocaleString('ko-KR') : '—'}
            {d.completed_at && ` · 완료 ${new Date(d.completed_at).toLocaleString('ko-KR')}`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={onRecompute} disabled={actionBusy || loading}
              className="inline-flex items-center gap-1 rounded bg-bg-card px-2 py-1 text-[11px] font-semibold hover:bg-bg-hover disabled:opacity-50"
            >
              <Calculator size={11} /> 재계산
            </button>
            <button
              onClick={onRetryFailed} disabled={actionBusy || loading || d.failed_count === 0}
              className="inline-flex items-center gap-1 rounded bg-bg-card px-2 py-1 text-[11px] font-semibold hover:bg-bg-hover disabled:opacity-30"
            >
              <RotateCcw size={11} /> 실패 재시도
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {/* Targets */}
        <div className="mt-4 overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                <th className="px-3 py-2">매장</th>
                <th className="px-3 py-2">지역</th>
                <th className="px-3 py-2">기대</th>
                <th className="px-3 py-2">실제</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2 text-right">마지막 접속</th>
                <th className="px-3 py-2 text-right">마지막 동기화</th>
                <th className="px-3 py-2">실패 사유</th>
                <th className="px-3 py-2 text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {detail.targets.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-mute">대상 매장이 없습니다</td></tr>
              ) : detail.targets.map((t) => (
                <tr key={t.target_id} className="border-b border-line/5 hover:bg-bg-hover/30 align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{t.store_name}</div>
                    <div className="text-[10px] text-ink-dim font-mono">{t.store_id.slice(0, 8)}</div>
                  </td>
                  <td className="px-3 py-2 text-[10px]">
                    {t.region_name ? (
                      <span className="flex items-center gap-1"><MapPin size={9} />{t.region_name}{t.region_code && ` (${t.region_code})`}</span>
                    ) : <span className="text-ink-dim">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <div>{t.expected_policy_name ?? '—'}</div>
                    <div className="text-[10px] text-ink-dim">v{t.expected_version_number ?? '?'}</div>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <div>{t.applied_policy_name ?? <span className="text-ink-dim">—</span>}</div>
                    <div className="text-[10px] text-ink-dim">
                      {t.applied_version_number !== null ? `v${t.applied_version_number}` : '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TARGET_TONE[t.status]}`}>
                      {TARGET_LABEL[t.status]}
                    </span>
                    {t.retry_count > 0 && (
                      <div className="text-[10px] text-ink-dim mt-0.5">재시도 {t.retry_count}회</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
                    {t.last_seen_at ? new Date(t.last_seen_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
                    {t.last_synced_at ? new Date(t.last_synced_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-rose-300 max-w-[180px] break-words">
                    {t.failure_reason ?? <span className="text-ink-dim">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      disabled={actionBusy}
                      onClick={() => onMarkFailed(t.store_id, t.store_name)}
                      className="rounded bg-bg-deep px-2 py-1 text-[10px] font-semibold hover:bg-rose-500/20 disabled:opacity-30"
                    >
                      실패 등록
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Create Modal
// =============================================================================

function CreateDeploymentModal({
  franchises, enterprises, onClose, onCreated,
}: {
  franchises: FranchiseListRow[];
  enterprises: EnterpriseAccount[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [policyId, setPolicyId] = useState('');
  const [deploymentName, setDeploymentName] = useState('');
  const [enterpriseAccountId, setEnterpriseAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!policyId.trim()) { setErr('정책 ID 가 필요합니다.'); return; }
    setBusy(true);
    try {
      const r = await createPolicyDeployment({
        policyId: policyId.trim(),
        deploymentName: deploymentName.trim() || null,
        enterpriseAccountId: enterpriseAccountId || null,
      });
      alert(`배포 생성 완료 — ${r.target_store_count}개 매장 대상`);
      await onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-bg-card p-4 shadow-2xl ring-1 ring-line/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold">정책 배포 생성</h3>
          <button onClick={onClose} className="rounded-full bg-bg-deep p-1 hover:bg-bg-hover" aria-label="닫기">
            <X size={14} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          기존 정책의 franchise 에 active 로 연결된 모든 매장이 자동으로 snapshot 됩니다.
          정책 적용 자체는 별도로 apply_franchise_policy 호출이 필요합니다 (Phase 1-6 자동 연결 예정).
        </p>

        <div className="mt-3 space-y-2 text-xs">
          <label className="block">
            <span className="text-ink-dim">정책 ID *</span>
            <input
              type="text" value={policyId} onChange={(e) => setPolicyId(e.target.value)}
              placeholder="franchise_music_policies.id (UUID)"
              className="mt-0.5 w-full rounded bg-bg-deep px-2 py-1.5 font-mono text-[11px]"
            />
            <p className="mt-1 text-[10px] text-ink-dim">
              프랜차이즈 관리 탭에서 정책 ID 를 복사하세요.
              {franchises.length > 0 && ` (등록된 프랜차이즈: ${franchises.length}개)`}
            </p>
          </label>

          <label className="block">
            <span className="text-ink-dim">배포명 (선택)</span>
            <input
              type="text" value={deploymentName} onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="비워두면 자동 생성 (정책명 + 버전 + 시각)"
              className="mt-0.5 w-full rounded bg-bg-deep px-2 py-1.5"
            />
          </label>

          <label className="block">
            <span className="text-ink-dim">엔터프라이즈 계정 (선택)</span>
            <select
              value={enterpriseAccountId} onChange={(e) => setEnterpriseAccountId(e.target.value)}
              className="mt-0.5 w-full rounded bg-bg-deep px-2 py-1.5"
            >
              <option value="">(연결 안 함)</option>
              {enterprises.map((e) => (
                <option key={e.id} value={e.id}>{e.enterprise_name} — {e.manager_name}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-ink-dim">
              엔터프라이즈 담당자(auth_user_id) 가 자기 배포만 조회할 수 있도록 묶입니다.
            </p>
          </label>
        </div>

        {err && (
          <div className="mt-3 flex items-center gap-2 rounded bg-rose-500/15 px-3 py-2 text-[11px] text-rose-300">
            <AlertCircle size={12} /> {err}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover">
            취소
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-bold text-black hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} 생성
          </button>
        </div>
      </div>
    </div>
  );
}
