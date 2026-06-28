/**
 * EnterpriseOverviewPanel — X6.90 Super Admin 전용 cross-franchise 대시보드.
 *
 * Phase 2 (Admin DS v2) — UI primitives 적용 (Batch 1).
 * 데이터 fetch / 계산 / 표시 로직 변경 0. UI 만 디자인 시스템으로.
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
import {
  AdminSection, AdminStatCard, AdminCard, AdminBadge, AdminEmpty, AdminSkeleton,
  AdminButton,
} from '@/components/admin/ui';
import { adminTypography } from '@/lib/adminTypography';

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
    <AdminSection
      title={<><Building2 size={14} /> 엔터프라이즈 종합</>}
      badge={<span className={adminTypography.hint}>(X6.90)</span>}
      description="모든 프랜차이즈 본사를 한 곳에서 관리합니다. 본사 계정은 자기 브랜드만 보입니다."
      action={
        <AdminButton
          tone="neutral" variant="subtle" size="sm"
          leftIcon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
          onClick={() => void load()} disabled={loading}
        >
          새로고침
        </AdminButton>
      }
    >
      {loading && !data && <AdminSkeleton variant="kpi" />}

      {data && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard
              tone="primary"
              icon={<Building2 size={14} />}
              label="활성 프랜차이즈"
              value={`${data.total_franchises.toLocaleString('ko-KR')}곳`}
            />
            <AdminStatCard
              tone="neutral"
              icon={<Building2 size={14} />}
              label="전체 브랜드"
              value={`${data.total_brands.toLocaleString('ko-KR')}개`}
            />
            <AdminStatCard
              tone="info"
              icon={<Music size={14} />}
              label="연결 매장"
              value={`${data.total_linked_stores.toLocaleString('ko-KR')}곳`}
            />
            <AdminStatCard
              tone="success"
              icon={<Wifi size={14} />}
              label="온라인 매장"
              value={`${data.online_stores.toLocaleString('ko-KR')}곳`}
            />
            <AdminStatCard
              tone={data.offline_stores > 0 ? 'danger' : 'neutral'}
              icon={<WifiOff size={14} />}
              label="오프라인"
              value={`${data.offline_stores.toLocaleString('ko-KR')}곳`}
            />
            <AdminStatCard
              tone="primary"
              icon={<Activity size={14} />}
              label="활성 정책"
              value={`${data.active_policies.toLocaleString('ko-KR')}개`}
            />
          </div>

          {/* 프랜차이즈별 카드 */}
          <AdminCard title={<><Building2 size={12} className="inline mr-1" /> 프랜차이즈별 현황</>}>
            {data.per_franchise.length === 0 ? (
              <AdminEmpty
                icon={<Building2 size={20} />}
                title="등록된 프랜차이즈 없음"
                description="본사 계정을 추가하면 자동으로 표시됩니다."
              />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {data.per_franchise.map((f) => (
                  <div key={f.franchise_id} className="rounded-lg bg-bg-deep p-3 ring-1 ring-line/10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={adminTypography.bodyStrong}>{f.name}</div>
                        {f.slug && <div className={adminTypography.hint}>{f.slug}</div>}
                      </div>
                      <FranchiseStatusBadge status={f.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                      <div className="text-ink-mute">
                        매장 <b className="text-ink">{f.store_count.toLocaleString('ko-KR')}</b>
                      </div>
                      <div className="text-ink-mute">
                        온라인 <b className="text-emerald-300">{f.online_count.toLocaleString('ko-KR')}</b>
                      </div>
                      <div className="text-ink-mute">
                        활성 정책 <b className="text-ink">{f.active_policy_count.toLocaleString('ko-KR')}</b>
                      </div>
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
          </AdminCard>

          {/* 최근 정책 업데이트 */}
          <AdminCard title={<><Activity size={12} className="inline mr-1" /> 최근 정책 업데이트</>}>
            {data.recent_policy_updates.length === 0 ? (
              <p className={adminTypography.description}>최근 업데이트 없음</p>
            ) : (
              <div className="space-y-1">
                {data.recent_policy_updates.map((p) => (
                  <div key={p.policy_id} className="flex items-center gap-2 text-[11px] rounded bg-bg-deep px-2 py-1.5">
                    <span className={adminTypography.bodyStrong}>{p.policy_name}</span>
                    <span className="text-ink-mute">— {p.franchise_name ?? '—'}</span>
                    <span className={`ml-auto ${adminTypography.hint} tabular-nums`}>
                      {new Date(p.updated_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          <p className={`${adminTypography.hint} text-right`}>
            업데이트: {new Date(data.computed_at).toLocaleString('ko-KR')}
            · 오프라인 기준 {data.offline_threshold_seconds}s
          </p>
        </>
      )}
    </AdminSection>
  );
}

function FranchiseStatusBadge({ status }: { status: string }) {
  if (status === 'active')   return <AdminBadge tone="success">활성</AdminBadge>;
  if (status === 'inactive') return <AdminBadge tone="warning">비활성</AdminBadge>;
  return <AdminBadge tone="neutral">{status}</AdminBadge>;
}
