/**
 * FranchiseHqDashboardPage — X6.90 본사 계정 자기 브랜드 전용 대시보드.
 *
 * 권한: franchise_admins 테이블에 등록된 user 만 진입 (RPC 내부 가드).
 * 비로그인/일반 user/탈퇴 → 안내 메시지.
 *
 * 표시:
 *   - 자기 프랜차이즈 정보 (이름, 상태)
 *   - 매장 KPI (전체/온라인/오프라인)
 *   - 지역별 매장 수
 *   - 활성 정책 목록 + 기본 정책
 *   - 매장 동기화 상태 테이블
 *   - 최근 정책 적용 이력
 *
 * 안 보임: 다른 프랜차이즈, 플랫폼 매출, 아티스트 정산, super admin 기능
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Building2, Wifi, WifiOff, Music, Activity, ChevronRight, AlertCircle,
} from 'lucide-react';
import {
  getMyFranchiseAdmin, getMyFranchiseHqDashboard,
  getMyFranchiseSyncStatus, getMyFranchisePolicies,
  type FranchiseDashboard, type FranchiseSyncStatusRow,
  type FranchiseMusicPolicy, type MyFranchiseAdmin, type FranchiseAdminRole,
} from '@/lib/api/franchiseApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

interface State {
  me: MyFranchiseAdmin | null;
  dashboard: (FranchiseDashboard & { admin_role: FranchiseAdminRole }) | null;
  sync: FranchiseSyncStatusRow[];
  policies: FranchiseMusicPolicy[];
  loading: boolean;
  error: string | null;
}

export default function FranchiseHqDashboardPage() {
  const [state, setState] = useState<State>({
    me: null, dashboard: null, sync: [], policies: [], loading: true, error: null,
  });
  const user = useAuthStore((s) => s.user);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const me = await getMyFranchiseAdmin();
      if (!me.is_franchise_admin) {
        setState({ me, dashboard: null, sync: [], policies: [], loading: false, error: null });
        return;
      }
      const [dashboard, sync, policies] = await Promise.all([
        getMyFranchiseHqDashboard(),
        getMyFranchiseSyncStatus().catch(() => []),
        getMyFranchisePolicies().catch(() => []),
      ]);
      setState({ me, dashboard, sync, policies, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      toast.error(`불러오기 실패: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state.loading && !state.me) {
    return <div className="mx-auto max-w-6xl p-8 text-center text-ink-dim">로딩 중…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <div className="space-y-3 rounded-3xl bg-bg-card p-10 text-center text-sm text-ink-mute ring-1 ring-line/10">
          <p>로그인 후 이용해주세요.</p>
        </div>
      </div>
    );
  }

  if (!state.me?.is_franchise_admin) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <div className="space-y-3 rounded-3xl bg-bg-card p-10 text-center text-sm text-ink-mute ring-1 ring-line/10">
          <Building2 size={28} className="mx-auto text-ink-dim" />
          <p className="text-base font-semibold text-ink">본사 관리자 계정만 접근할 수 있습니다.</p>
          <p className="text-[12px]">관리자에게 본사 계정 연결을 요청해주세요.</p>
        </div>
      </div>
    );
  }

  const d = state.dashboard;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
      {/* 헤더 */}
      <header className="flex flex-wrap items-center gap-4 rounded-3xl bg-gradient-to-br from-bg-card to-bg-soft/40 p-5 ring-1 ring-line/10">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-xl font-extrabold text-accent">
          <Building2 size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">본사 관리</p>
          <h1 className="truncate text-xl font-extrabold">{state.me.franchise_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-mute">
            <span>역할: <b className="text-ink">{state.me.admin_role}</b></span>
            {state.me.franchise_slug && <span>brand: <b className="text-ink">{state.me.franchise_slug}</b></span>}
            <span>상태: <b className="text-ink">{state.me.franchise_status}</b></span>
          </div>
        </div>
        <button onClick={() => void load()} disabled={state.loading}
          className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-[11px] font-semibold hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={12} className={state.loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </header>

      {state.error && (
        <div className="flex items-center gap-2 rounded-2xl bg-rose-500/20 px-4 py-3 text-sm text-rose-500 ring-1 ring-rose-500/20">
          <AlertCircle size={16} /> {state.error}
        </div>
      )}

      {d && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi big icon={<Music size={16} />} label="전체 매장" value={`${d.total_stores}곳`} />
            <Kpi big icon={<Wifi size={16} />} label="온라인" value={`${d.online_stores}곳`} tone="emerald" />
            <Kpi big icon={<WifiOff size={16} />} label="오프라인" value={`${d.offline_stores}곳`} tone={d.offline_stores > 0 ? 'rose' : undefined} />
            <Kpi big icon={<Activity size={16} />} label="활성 정책" value={`${d.active_policies.length}개`} />
          </div>

          {/* 지역별 매장 */}
          {d.regions.length > 0 && (
            <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
              <h2 className="mb-3 text-sm font-bold">지역별 매장</h2>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {d.regions.map((r) => (
                  <div key={r.id} className="rounded-xl bg-bg-soft px-3 py-2 text-xs">
                    <div className="font-bold">{r.name}</div>
                    <div className="text-ink-mute">매장 {r.store_count}곳</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 활성 정책 + 시간대 슬롯 (요약) */}
          <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">현재 적용 가능 정책</h2>
              <Link to="/admin?tab=franchise" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                정책 편집 <ChevronRight size={11} />
              </Link>
            </div>
            {d.active_policies.length === 0 ? (
              <p className="rounded bg-bg-soft px-3 py-4 text-center text-xs text-ink-mute">
                활성 정책이 없습니다. 관리자에게 정책 생성을 요청하세요.
              </p>
            ) : (
              <div className="space-y-1">
                {d.active_policies.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded bg-bg-soft px-3 py-2 text-xs">
                    <span className="font-bold">{p.name}</span>
                    {p.is_default && <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-100 ring-1 ring-emerald-400/40">기본</span>}
                    <span className="ml-auto text-[10px] text-ink-dim">
                      {p.effective_from ? new Date(p.effective_from).toLocaleDateString('ko-KR') : '—'}
                      {' ~ '}
                      {p.effective_until ? new Date(p.effective_until).toLocaleDateString('ko-KR') : '무기한'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 매장 동기화 상태 */}
          <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">매장별 동기화 상태</h2>
              <span className="text-[10px] text-ink-dim">3분 이상 응답 없으면 오프라인</span>
            </div>
            {state.sync.length === 0 ? (
              <p className="rounded bg-bg-soft px-3 py-4 text-center text-xs text-ink-mute">
                연결된 매장이 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                      <th className="px-2 py-1.5">매장</th>
                      <th className="px-2 py-1.5">지역</th>
                      <th className="px-2 py-1.5">상태</th>
                      <th className="px-2 py-1.5">정책 / 버전</th>
                      <th className="px-2 py-1.5">현재 재생곡</th>
                      <th className="px-2 py-1.5 text-right">마지막 접속</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.sync.map((r) => (
                      <tr key={r.store_id} className={`border-b border-line/5 ${r.is_offline ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5 font-semibold">{r.store_name ?? '—'}</td>
                        <td className="px-2 py-1.5 text-ink-mute">{r.region_name ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <PlayerStatusBadge status={r.player_status} isOffline={r.is_offline} />
                        </td>
                        <td className="px-2 py-1.5 text-ink-mute">
                          {r.active_policy_name ?? '—'}
                          {r.active_policy_name && <span className="text-[10px] text-ink-dim"> v{r.active_version_number}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-ink-mute truncate max-w-[160px]">{r.current_track_title ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right text-[10px] text-ink-dim tabular-nums">
                          {r.last_seen_at ? new Date(r.last_seen_at).toLocaleTimeString('ko-KR') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 최근 정책 적용 이력 */}
          {d.recent_assignments.length > 0 && (
            <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
              <h2 className="mb-3 text-sm font-bold">최근 정책 적용 이력</h2>
              <div className="space-y-1">
                {d.recent_assignments.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded bg-bg-soft px-3 py-2 text-xs">
                    <span className="font-semibold">{a.policy_name ?? '—'}</span>
                    <span className="text-ink-mute">
                      → {a.target_type === 'all' ? '전체 매장' : a.target_type === 'region' ? '특정 지역' : '특정 매장'}
                    </span>
                    <span className="ml-auto text-[10px] text-ink-dim tabular-nums">
                      {new Date(a.applied_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="text-[10px] text-ink-dim text-right">
            본사 정책은 다음 재생 시점부터 매장에 자동 동기화됩니다.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  label, value, icon, sub, tone, big = false,
}: {
  label: string; value: string; icon?: React.ReactNode;
  sub?: string; tone?: 'accent' | 'emerald' | 'rose'; big?: boolean;
}) {
  const toneCls = tone === 'accent' ? 'text-accent'
    : tone === 'emerald' ? 'text-emerald-500'
    : tone === 'rose' ? 'text-rose-500' : 'text-ink';
  return (
    <div className={`rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 ${big ? 'lg:p-4' : ''}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">{icon}{label}</div>
      <div className={`mt-1 ${big ? 'text-2xl' : 'text-lg'} font-extrabold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-mute">{sub}</div>}
    </div>
  );
}

function PlayerStatusBadge({ status, isOffline }: { status: string; isOffline: boolean }) {
  if (isOffline) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-100 ring-1 ring-rose-400/40"><WifiOff size={10} /> 오프라인</span>;
  const cls = status === 'playing' ? 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40'
    : status === 'paused' ? 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/40'
    : 'bg-ink/15 text-ink ring-1 ring-line/20';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{status}</span>;
}
