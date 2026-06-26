/**
 * EnterpriseOverviewPanel — X6.90 Super Admin 전용 cross-franchise 대시보드.
 *
 * 전체 엔터프라이즈/프랜차이즈 집계 + 프랜차이즈별 매출/매장 카드.
 * 본사 계정 (franchise_admin) 은 별도 /enterprise/hq 페이지에서 자기 브랜드만 봄.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Building2, Wifi, WifiOff, Music, TrendingUp, Activity,
} from 'lucide-react';
import {
  adminEnterpriseOverview,
  type EnterpriseOverview,
} from '@/lib/api/franchiseApi';
import { toast } from '@/store/toastStore';

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;

export default function EnterpriseOverviewPanel() {
  const [data, setData] = useState<EnterpriseOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminEnterpriseOverview()); }
    catch (e) { toast.error(`엔터프라이즈 로딩 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Building2 size={14} /> 엔터프라이즈 종합
            <span className="text-[10px] font-normal text-ink-dim">(X6.90)</span>
          </h3>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          모든 프랜차이즈 본사를 한 곳에서 관리합니다. 본사 계정은 자기 브랜드만 보입니다.
        </p>
      </div>

      {loading && !data && (
        <div className="rounded-xl bg-bg-card p-8 text-center text-ink-dim text-sm">로딩 중…</div>
      )}

      {data && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <Kpi label="활성 프랜차이즈" value={`${data.total_franchises}곳`} icon={<Building2 size={12} />} />
            <Kpi label="전체 브랜드" value={`${data.total_brands}개`} icon={<Building2 size={12} />} tone="text-ink-mute" />
            <Kpi label="연결 매장" value={`${data.total_linked_stores}곳`} icon={<Music size={12} />} />
            <Kpi label="온라인 매장" value={`${data.online_stores}곳`} icon={<Wifi size={12} />} tone="text-emerald-300" />
            <Kpi label="오프라인" value={`${data.offline_stores}곳`} icon={<WifiOff size={12} />}
              tone={data.offline_stores > 0 ? 'text-rose-300' : 'text-ink-mute'} />
            <Kpi label="활성 정책" value={`${data.active_policies}개`} icon={<Activity size={12} />} />
          </div>

          {/* 프랜차이즈별 카드 */}
          <div className="rounded-xl bg-bg-card p-3">
            <h4 className="mb-2 text-xs font-bold flex items-center gap-1">
              <Building2 size={12} /> 프랜차이즈별 현황
            </h4>
            {data.per_franchise.length === 0 ? (
              <p className="rounded bg-bg-deep px-3 py-6 text-center text-xs text-ink-dim">
                등록된 프랜차이즈가 없습니다.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {data.per_franchise.map((f) => (
                  <div key={f.franchise_id} className="rounded-lg bg-bg-deep p-3 ring-1 ring-line/10">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm">{f.name}</div>
                        {f.slug && <div className="text-[10px] text-ink-dim">{f.slug}</div>}
                      </div>
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                      <div className="text-ink-mute">매장 <b className="text-ink">{f.store_count}</b></div>
                      <div className="text-ink-mute">온라인 <b className="text-emerald-300">{f.online_count}</b></div>
                      <div className="text-ink-mute">활성 정책 <b className="text-ink">{f.active_policy_count}</b></div>
                      <div className="text-ink-mute flex items-center gap-1">
                        <TrendingUp size={10} /> <b className="text-accent">{won(f.estimated_monthly_revenue)}</b>
                      </div>
                    </div>
                    {f.current_default_policy && (
                      <div className="mt-1.5 text-[10px] text-ink-dim truncate">
                        기본 정책: <span className="text-emerald-300">{f.current_default_policy.name}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 최근 정책 업데이트 */}
          <div className="rounded-xl bg-bg-card p-3">
            <h4 className="mb-2 text-xs font-bold flex items-center gap-1">
              <Activity size={12} /> 최근 정책 업데이트
            </h4>
            {data.recent_policy_updates.length === 0 ? (
              <p className="text-[11px] text-ink-dim">최근 업데이트 없음</p>
            ) : (
              <div className="space-y-1">
                {data.recent_policy_updates.map((p) => (
                  <div key={p.policy_id} className="flex items-center gap-2 text-[11px] rounded bg-bg-deep px-2 py-1.5">
                    <span className="font-semibold">{p.policy_name}</span>
                    <span className="text-ink-mute">— {p.franchise_name ?? '—'}</span>
                    <span className="ml-auto text-[10px] text-ink-dim tabular-nums">
                      {new Date(p.updated_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[10px] text-ink-dim text-right">
            업데이트: {new Date(data.computed_at).toLocaleString('ko-KR')}
            · 오프라인 기준 {data.offline_threshold_seconds}s
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone = 'text-ink' }: { label: string; value: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">{icon}{label}</div>
      <div className={`mt-1 text-lg font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-emerald-500/15 text-emerald-300'
    : status === 'inactive' ? 'bg-amber-500/15 text-amber-300'
    : 'bg-ink/15 text-ink-mute';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{status}</span>;
}
