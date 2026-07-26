import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Home, Store, Building2, Music, Activity, Wallet, Mic2, BarChart3, Sparkles,
  Settings, KeyRound, AlertTriangle, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import { adminEnterpriseOverview, type EnterpriseOverview } from '@/lib/api/franchiseApi';
import {
  filterQuickActions, type OperatorAccessContext, type OperatorQuickAction,
} from '@/lib/operatorNavigation';
import OperatorOnboardingChecklist from '@/components/operator/OperatorOnboardingChecklist';

const ICONS: Record<string, LucideIcon> = {
  Home, Store, Building2, Music, Activity, Wallet, Mic2, BarChart3, Sparkles, Settings, KeyRound,
};
const iconFor = (name: string): LucideIcon => ICONS[name] ?? ArrowRight;

/** KPI 카드 — 실 RPC 값만 표시. 로딩/미지원 시 '—' (가짜 수치 금지). */
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line/10 bg-bg-card p-4">
      <p className="text-xs font-medium text-ink-dim">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-dim">{sub}</p>}
    </div>
  );
}

function QuickActionCard({ action }: { action: OperatorQuickAction }) {
  const Icon = iconFor(action.icon);
  return (
    <Link
      to={action.href}
      className="group flex items-center gap-3 rounded-2xl border border-line/10 bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-bg-hover"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent/15 text-accent">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{action.label}</span>
        <span className="block truncate text-xs text-ink-dim">{action.description}</span>
      </span>
      <ArrowRight size={16} className="flex-none text-ink-dim transition-transform group-hover:translate-x-0.5 group-hover:text-ink-mute" />
    </Link>
  );
}

/**
 * OperatorHomePage — Phase ADMIN-UX-IMPLEMENT-1
 *
 * 운영자 홈. 신규 입사자도 오늘 무엇을 봐야 하는지 즉시 파악하도록:
 *   • 실 RPC(admin_enterprise_overview) 기반 KPI — 값이 없으면 '—' (하드코딩/가짜 수치 금지).
 *   • 역할별 빠른 작업(딥링크).
 *   • 실 데이터 기반 알림(오프라인 매장 등).
 *   • localStorage 기반 온보딩 체크리스트.
 */
export default function OperatorHomePage() {
  const access = useOperatorAccess();
  const ctx: OperatorAccessContext = useMemo(
    () => ({ isSuperAdmin: access.isSuperAdmin, isPlatformAdmin: access.isPlatformAdmin, isHq: access.isHq }),
    [access.isSuperAdmin, access.isPlatformAdmin, access.isHq],
  );

  // 플랫폼 관리자만 admin_enterprise_overview 접근 가능 (서버가 최종 판정). hq-only 는 조회 시도 안 함.
  const canOverview = access.isSuperAdmin || access.isPlatformAdmin;
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [overviewError, setOverviewError] = useState<boolean>(false);
  const [overviewLoading, setOverviewLoading] = useState<boolean>(canOverview);

  useEffect(() => {
    let cancelled = false;
    if (access.loading || !canOverview) {
      if (!canOverview) setOverviewLoading(false);
      return () => { cancelled = true; };
    }
    setOverviewLoading(true);
    setOverviewError(false);
    void adminEnterpriseOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch(() => { if (!cancelled) setOverviewError(true); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [access.loading, canOverview]);

  const quickActions = useMemo(() => filterQuickActions(ctx), [ctx]);

  // KPI 값: 로딩 중이거나 미지원/에러면 '—'. 하드코딩된 운영 수치를 표시하지 않는다.
  const fmt = (n: number | undefined): string => {
    if (overviewLoading) return '…';
    if (!overview || typeof n !== 'number') return '—';
    return n.toLocaleString('ko-KR');
  };

  const offlineCount = overview?.offline_stores ?? 0;
  const showOfflineAlert = !!overview && offlineCount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">운영 홈</h1>
        <p className="mt-1 text-sm text-ink-dim">오늘의 운영 현황과 자주 쓰는 작업을 한곳에서.</p>
      </header>

      {/* KPIs — 플랫폼 관리자에게만 (본사 종합 지표는 admin_enterprise_overview 권한 필요) */}
      {canOverview && (
        <section aria-label="운영 지표">
          {overviewError ? (
            <div className="rounded-2xl border border-line/10 bg-bg-card p-4 text-sm text-ink-dim">
              지표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <KpiCard label="연결 매장" value={fmt(overview?.total_linked_stores)} />
              <KpiCard label="온라인 매장" value={fmt(overview?.online_stores)} />
              <KpiCard label="오프라인 매장" value={fmt(overview?.offline_stores)} />
              <KpiCard label="활성 정책" value={fmt(overview?.active_policies)} />
              <KpiCard label="본사 수" value={fmt(overview?.total_franchises)} />
            </div>
          )}
        </section>
      )}

      {/* Alerts — 실 데이터 기반 */}
      {showOfflineAlert && (
        <section aria-label="알림">
          <Link
            to="/admin?tab=store-monitoring"
            className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 transition-colors hover:bg-amber-400/20"
          >
            <AlertTriangle size={20} className="flex-none text-amber-300" />
            <span className="flex-1 text-sm text-ink">
              오프라인 매장 <b className="font-bold">{offlineCount.toLocaleString('ko-KR')}</b>곳이 있습니다. 상태를 확인하세요.
            </span>
            <ArrowRight size={16} className="flex-none text-ink-dim" />
          </Link>
        </section>
      )}

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <section aria-label="빠른 작업">
          <h2 className="mb-3 text-sm font-bold text-ink">빠른 작업</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map((qa) => <QuickActionCard key={qa.id} action={qa} />)}
          </div>
        </section>
      )}

      {/* Onboarding */}
      <OperatorOnboardingChecklist ctx={ctx} />
    </div>
  );
}
