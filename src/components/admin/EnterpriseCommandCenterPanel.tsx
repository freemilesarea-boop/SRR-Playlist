/**
 * EnterpriseCommandCenterPanel — Phase 4
 *
 * `/admin → Command Center` 탭.
 * Enterprise 운영자가 하루 종일 사용하는 통합 대시보드.
 *
 * 절대 무수정:
 *   • 기존 Enterprise Panel (Accounts / Contracts / Billing / MonthlySettlements /
 *     Operations / SettlementCenter / BrandRegistry / NOC / etc.) 무영향.
 *   • Settlement 계산식 / Contract Snapshot / Cron / Dispatch / Policy 무관.
 *   • Migration / RPC 신규 없음.
 *   • 조회 전용 — 이 패널에서 수정/삭제 불가. 액션은 기존 탭으로 navigate 뿐.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Building2, CheckCircle2, Clock, Compass, Database,
  ExternalLink, Handshake, PlayCircle, RefreshCw, Search, ShieldCheck, Store as StoreIcon,
  TrendingUp, Wallet, Wifi, WifiOff, X,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminStatCard, AdminBadge, AdminButton,
  AdminAlert, AdminEmpty, AdminSkeleton,
} from '@/components/admin/ui';
import {
  fetchCommandCenterKpi, fetchBrandOverviewList, fetchBrandDetail,
  fetchCommandCenterTimeline, fetchCommandCenterAlerts, fetchGlobalSearch,
  QUICK_ACTION_LINKS,
  type CommandCenterKpi, type BrandOverviewRow, type BrandDetailBundle,
  type CommandCenterAlert, type SearchHit,
  type EnterpriseOpsActivityEvent,
} from '@/lib/api/enterpriseCommandCenterApi';

// ============================================================================
// Constants
// ============================================================================
const POLL_MS = 30_000;  // spec 11: 30s polling

// ============================================================================
// Utils
// ============================================================================
function fmtMoney(n: number | null | undefined, currency = 'KRW'): string {
  if (n === null || n === undefined) return '—';
  const v = Math.round(n).toLocaleString('ko-KR');
  return currency === 'KRW' ? `₩${v}` : `${v} ${currency}`;
}
function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ko-KR');
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return '—'; }
}
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '방금';
    if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
    return `${Math.floor(diff / 86_400_000)}일 전`;
  } catch { return '—'; }
}

/** Ops 탭으로 이동 (기존 AdminPage 의 URL param 방식 재사용). */
function navigateToTab(tabKey: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabKey);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* silent */
  }
}

// ============================================================================
// Main panel
// ============================================================================
export default function EnterpriseCommandCenterPanel() {
  const [kpi, setKpi] = useState<CommandCenterKpi | null>(null);
  const [brands, setBrands] = useState<BrandOverviewRow[]>([]);
  const [alerts, setAlerts] = useState<CommandCenterAlert[]>([]);
  const [timeline, setTimeline] = useState<EnterpriseOpsActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setErr(null);
    try {
      const [k, bs, al, tl] = await Promise.all([
        fetchCommandCenterKpi(),
        fetchBrandOverviewList(),
        fetchCommandCenterAlerts(),
        fetchCommandCenterTimeline(20),
      ]);
      setKpi(k);
      setBrands(bs);
      setAlerts(al);
      setTimeline(tl);
      setLastLoadedAt(new Date());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  // 초기 로드 + 30s polling (spec 11)
  useEffect(() => {
    void loadAll();
    const t = window.setInterval(() => void loadAll(), POLL_MS);
    return () => window.clearInterval(t);
  }, [loadAll]);

  return (
    <AdminSection
      title={
        <span className="flex items-center gap-2">
          <Compass size={16} /> Command Center
          <LiveBadge />
        </span>
      }
      description={
        <span className="flex items-center gap-2 text-[11px] text-ink-mute">
          <span>30초 자동 갱신 · 조회 전용</span>
          <span className="text-ink-dim">·</span>
          <span>
            마지막 업데이트{' '}
            <span className="font-mono text-ink">
              {lastLoadedAt ? lastLoadedAt.toLocaleTimeString('ko-KR', { hour12: false }) : '—'}
            </span>
          </span>
        </span>
      }
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={() => void loadAll()}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </AdminButton>
      }
    >
      {err && <AdminAlert tone="danger" title="조회 실패">{err}</AdminAlert>}

      <GlobalSearchBar />

      {/* Hero KPI — 3초 안에 파악해야 하는 최우선 4개 지표 (클릭 시 관련 탭 이동) */}
      <HeroKpi kpi={kpi} />

      {/* Secondary KPI (좌 2/3) + Quick Actions (우 1/3) */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SecondaryKpi kpi={kpi} />
        </div>
        <div>
          <QuickActionsCard />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 좌측 2/3 — Brand Overview */}
        <div className="lg:col-span-2">
          <BrandOverviewGrid
            brands={brands}
            loading={loading && brands.length === 0}
            onSelect={(id) => setSelectedBrandId(id)}
            selectedId={selectedBrandId}
          />
        </div>
        {/* 우측 1/3 — Sidebar */}
        <div className="space-y-3">
          {selectedBrandId ? (
            <BrandDetailSidebar
              brandId={selectedBrandId}
              onClose={() => setSelectedBrandId(null)}
            />
          ) : (
            <>
              <AlertsCard alerts={alerts} loading={loading && alerts.length === 0} />
              <TimelineCard events={timeline} loading={loading && timeline.length === 0} />
            </>
          )}
        </div>
      </div>
    </AdminSection>
  );
}

// ============================================================================
// LIVE badge — 실시간 상태 표시 (spec 4)
// ============================================================================
function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-100 ring-1 ring-emerald-400/50">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75"></span>
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300"></span>
      </span>
      LIVE
    </span>
  );
}

// ============================================================================
// Hero KPI (spec 1, 5) — 4 큰 카드, 클릭 시 관련 탭 이동
// ============================================================================
interface HeroItem {
  key: 'total' | 'online' | 'drift' | 'offline';
  label: string;
  desc: string;
  value: number;
  icon: JSX.Element;
  tone: 'primary' | 'success' | 'warning' | 'danger';
  tab: string;
}

function HeroKpi({ kpi }: { kpi: CommandCenterKpi | null }) {
  const items: HeroItem[] = kpi ? [
    { key: 'total',   label: '총 매장',     desc: '전체 등록 매장',   value: kpi.total_stores,   icon: <StoreIcon size={22} />,    tone: 'primary', tab: 'brand-registry' },
    { key: 'online',  label: '온라인',      desc: '현재 접속 중',     value: kpi.online_stores,  icon: <Wifi size={22} />,         tone: 'success', tab: 'store-monitoring' },
    { key: 'drift',   label: '정책 미동기', desc: '동기화 필요',      value: kpi.drift_stores,   icon: <ShieldCheck size={22} />,  tone: kpi.drift_stores > 0 ? 'warning' : 'success', tab: 'policy-deployment' },
    { key: 'offline', label: '오프라인',    desc: '점검 필요',        value: kpi.offline_stores, icon: <WifiOff size={22} />,      tone: kpi.offline_stores > 0 ? 'danger' : 'success', tab: 'enterprise-noc' },
  ] : [];

  // Empty state — 로딩 중에도 4 카드 스켈레톤 유지 (spec 7 layout 안정성)
  if (!kpi) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-bg-card ring-1 ring-line/15 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => navigateToTab(item.tab)}
          className={`group text-left rounded-2xl p-4 ring-1 transition-all duration-150 hover:shadow-lg ${
            item.tone === 'success'
              ? 'bg-emerald-500/25 ring-emerald-400/50 hover:bg-emerald-500/30'
              : item.tone === 'warning'
              ? 'bg-amber-500/25 ring-amber-400/50 hover:bg-amber-500/30'
              : item.tone === 'danger'
              ? 'bg-rose-500/25 ring-rose-400/50 hover:bg-rose-500/30'
              : 'bg-violet-500/25 ring-violet-400/50 hover:bg-violet-500/30'
          }`}
        >
          <div className="flex items-start justify-between">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
              item.tone === 'success'  ? 'bg-emerald-500/40 text-emerald-100'
              : item.tone === 'warning' ? 'bg-amber-500/40 text-amber-100'
              : item.tone === 'danger'  ? 'bg-rose-500/40 text-rose-100'
              :                           'bg-violet-500/40 text-violet-100'
            }`}>
              {item.icon}
            </span>
            <ExternalLink size={12} className="text-ink-mute opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="mt-3 text-3xl font-black tabular-nums text-ink">{fmtNumber(item.value)}</p>
          <p className="mt-1 text-[12px] font-bold text-ink">{item.label}</p>
          <p className="text-[10px] text-ink-mute">{item.desc}</p>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Secondary KPI (spec 2, 3) — 통계 카드
// ============================================================================
function SecondaryKpi({ kpi }: { kpi: CommandCenterKpi | null }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><TrendingUp size={13} /> 주요 지표</span>}
      subtitle={<span className="text-[10px] text-ink-mute">정상 · 주의 · 오류 · 정보 색상으로 통일</span>}
    >
      {!kpi ? <AdminSkeleton variant="kpi" /> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5">
          <AdminStatCard label="총 Enterprise"     value={fmtNumber(kpi.total_enterprises)}     tone="primary" icon={<Building2 size={12} />} />
          <AdminStatCard label="활성"              value={fmtNumber(kpi.active_enterprises)}    tone="success" icon={<CheckCircle2 size={12} />} />
          <AdminStatCard label="승인 대기"         value={fmtNumber(kpi.pending_approvals)}     tone={kpi.pending_approvals > 0 ? 'warning' : 'neutral'} icon={<Handshake size={12} />} />
          <AdminStatCard label="총 계약"           value={fmtNumber(kpi.total_contracts)}       tone="info" icon={<ShieldCheck size={12} />} />
          <AdminStatCard label="ACTIVE 계약"       value={fmtNumber(kpi.active_contracts)}      tone="success" icon={<ShieldCheck size={12} />} />
          <AdminStatCard label="만료 임박(30d)"    value={fmtNumber(kpi.expiring_contracts)}    tone={kpi.expiring_contracts > 0 ? 'warning' : 'neutral'} icon={<Clock size={12} />} />
          <AdminStatCard label="이번달 Billing"    value={fmtNumber(kpi.this_month_billing_count)} tone="info" icon={<Wallet size={12} />} />
          <AdminStatCard label="이번달 Settlement" value={fmtNumber(kpi.this_month_settlement_count)} tone="info" icon={<Wallet size={12} />} />
          <AdminStatCard label="이번달 매출"       value={fmtMoney(kpi.this_month_revenue)}     tone="primary" icon={<Wallet size={12} />} />
          <AdminStatCard label="미납 금액"         value={fmtMoney(kpi.unpaid_amount)}          tone={kpi.unpaid_amount > 0 ? 'danger' : 'success'} icon={<AlertTriangle size={12} />} />
        </div>
      )}
    </AdminCard>
  );
}

// ============================================================================
// Quick Actions (spec 6, 7) — 세로 카드형 (Hero 오른쪽 정렬)
// ============================================================================
function QuickActionsCard() {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><PlayCircle size={13} /> Quick Actions</span>}
      subtitle={<span className="text-[10px] text-ink-mute">기존 탭으로 이동</span>}
    >
      <div className="grid grid-cols-2 gap-1.5">
        {QUICK_ACTION_LINKS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => navigateToTab(a.target_tab)}
            className="inline-flex items-center justify-start gap-1.5 rounded-lg bg-bg-card px-2.5 py-2 text-[11px] font-semibold text-ink ring-1 ring-line/20 transition hover:bg-bg-hover hover:shadow-sm"
          >
            <PlayCircle size={11} className="shrink-0 text-violet-300" />
            <span className="truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </AdminCard>
  );
}

// ============================================================================
// Global Search (spec 8)
// ============================================================================
function GlobalSearchBar() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!q.trim()) { setHits([]); return; }
    timer.current = window.setTimeout(() => {
      setBusy(true);
      fetchGlobalSearch(q)
        .then((h) => { setHits(h); setOpen(true); })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 200);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl bg-bg-card px-3 py-2 ring-1 ring-line/20">
        <Search size={14} className="text-ink-mute" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q && setOpen(true)}
          placeholder="브랜드명 / 코드 / 계약번호 / 담당자 / 사업자번호 / Store 검색"
          className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-dim"
        />
        {busy && <RefreshCw size={12} className="animate-spin text-ink-mute" />}
        {q && (
          <button type="button" onClick={() => { setQ(''); setHits([]); setOpen(false); }}
            className="text-ink-mute hover:text-ink"><X size={14} /></button>
        )}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-[360px] w-full overflow-auto rounded-xl bg-bg-card ring-1 ring-line/30 shadow-lg">
          {hits.map((h) => (
            <button
              key={`${h.category}:${h.id}`}
              type="button"
              onClick={() => {
                if (h.action_tab) navigateToTab(h.action_tab);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 border-b border-line/10 px-3 py-2 text-left hover:bg-bg-hover last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-ink">
                  <AdminBadge tone={h.category === 'brand' ? 'primary' : h.category === 'contract' ? 'info' : h.category === 'enterprise' ? 'success' : 'neutral'} variant="subtle">
                    {h.category}
                  </AdminBadge>
                  <span className="ml-1.5">{h.label}</span>
                </p>
                {h.sub_label && <p className="truncate text-[10px] text-ink-mute">{h.sub_label}</p>}
              </div>
              <ExternalLink size={12} className="shrink-0 text-ink-mute" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Quick Actions (spec 7)
// ============================================================================
// ============================================================================
// Brand Overview grid (spec 3)
// ============================================================================
function BrandOverviewGrid({
  brands, loading, onSelect, selectedId,
}: {
  brands: BrandOverviewRow[]; loading: boolean;
  onSelect: (id: string) => void; selectedId: string | null;
}) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Building2 size={13} /> 브랜드 개요 ({brands.length})</span>}
      subtitle={<span className="text-[10px] text-ink-mute">클릭 시 우측에 상세 정보 표시</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : brands.length === 0 ? <AdminEmpty title="브랜드 없음" description="Brand Registry 에서 등록 필요" />
        : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {brands.map((b) => (
              <button
                key={b.brand_id}
                type="button"
                onClick={() => onSelect(b.brand_id)}
                className={`text-left rounded-xl p-3 ring-1 transition ${
                  selectedId === b.brand_id
                    ? 'bg-violet-500/15 ring-violet-400/50'
                    : 'bg-bg-card ring-line/15 hover:bg-bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-ink">{b.brand_name}</p>
                    <p className="font-mono text-[10px] text-ink-mute">{b.brand_code}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <AdminBadge tone={
                      b.status === 'ACTIVE' ? 'success'
                      : b.status === 'PENDING' ? 'warning'
                      : b.status === 'SUSPENDED' ? 'warning'
                      : 'neutral'
                    } variant="subtle">{b.status}</AdminBadge>
                    <AdminBadge tone={
                      b.contract_status === 'active' ? 'success'
                      : b.contract_status === 'expiring' ? 'warning'
                      : b.contract_status === 'expired' || b.contract_status === 'terminated' ? 'danger'
                      : b.contract_status === 'draft' ? 'info'
                      : 'neutral'
                    } variant="subtle">
                      {b.contract_status === 'no_contract' ? '계약 없음' : b.contract_status.toUpperCase()}
                    </AdminBadge>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="flex justify-between"><span className="text-ink-mute">미납</span><span className={b.unpaid_count > 0 ? 'text-rose-300 font-bold' : 'text-ink'}>{b.unpaid_count} 건</span></div>
                  <div className="flex justify-between"><span className="text-ink-mute">미납 금액</span><span className={b.unpaid_amount > 0 ? 'text-rose-300 font-bold' : 'text-ink'}>{fmtMoney(b.unpaid_amount)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-mute">다음 청구</span><span>{fmtDate(b.next_due_date)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-mute">최근 수정</span><span>{fmtRelative(b.updated_at)}</span></div>
                </div>
              </button>
            ))}
          </div>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Alerts (spec 6)
// ============================================================================
function AlertsCard({ alerts, loading }: { alerts: CommandCenterAlert[]; loading: boolean }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Bell size={13} /> 경고</span>}
      subtitle={<span className="text-[10px] text-ink-mute">색상별 대응 우선순위</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : alerts.length === 0 ? <AdminEmpty title="경고 없음" description="이상 없음 · 정상 운영 중" />
        : (
          <ul className="space-y-1.5">
            {alerts.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => a.action_tab && navigateToTab(a.action_tab)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[11px] text-left ring-1 hover:bg-bg-hover ${
                    a.level === 'critical'
                      ? 'bg-rose-500/25 text-rose-100 ring-rose-500/40'
                      : a.level === 'warning'
                      ? 'bg-amber-500/25 text-amber-100 ring-amber-500/40'
                      : 'bg-sky-500/25 text-sky-100 ring-sky-500/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle size={11} />
                    <span className="font-medium">{a.label}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{a.count}</span>
                    {a.action_tab && <ExternalLink size={10} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Timeline (spec 5)
// ============================================================================
function TimelineCard({ events, loading }: { events: EnterpriseOpsActivityEvent[]; loading: boolean }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Activity size={13} /> Timeline</span>}
      subtitle={<span className="text-[10px] text-ink-mute">최근 20건</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : events.length === 0 ? <AdminEmpty title="이벤트 없음" description="최근 7일 활동 없음" />
        : (
          <ul className="max-h-[380px] space-y-1.5 overflow-y-auto">
            {events.map((e) => (
              <li key={`${e.type}:${e.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-bg-card px-2 py-1.5 text-[11px] ring-1 ring-line/10">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AdminBadge tone={
                    e.severity === 'error' || e.severity === 'critical' ? 'danger'
                    : e.severity === 'warning' ? 'warning'
                    : e.severity === 'success' ? 'success'
                    : 'neutral'
                  } variant="subtle">{e.type}</AdminBadge>
                  <span className="truncate text-ink">{e.title}</span>
                </div>
                <span className="shrink-0 text-[10px] text-ink-mute">{fmtRelative(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Brand Detail Sidebar (spec 4)
// ============================================================================
function BrandDetailSidebar({ brandId, onClose }: { brandId: string; onClose: () => void }) {
  const [bundle, setBundle] = useState<BrandDetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null); setBundle(null);
    fetchBrandDetail(brandId)
      .then((b) => setBundle(b))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [brandId]);

  const displayStatus = useMemo(() => {
    if (!bundle) return 'INACTIVE';
    if (!bundle.enterprise_account) return 'INACTIVE';
    if (bundle.enterprise_account.status === 'active') return 'ACTIVE';
    if (bundle.enterprise_account.status === 'invited') return 'PENDING';
    if (bundle.enterprise_account.status === 'suspended') return 'SUSPENDED';
    return 'INACTIVE';
  }, [bundle]);

  return (
    <AdminCard
      title={
        <span className="flex items-center gap-2">
          <Database size={13} /> Brand Detail
        </span>
      }
      subtitle={<span className="text-[10px] text-ink-mute">브랜드 하나의 전체 정보 (read-only)</span>}
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onClose}>
          <X size={12} /> 닫기
        </AdminButton>
      }
    >
      {loading ? <AdminSkeleton variant="block" />
        : err ? <AdminAlert tone="danger" title="조회 실패">{err}</AdminAlert>
        : !bundle ? <AdminEmpty title="브랜드 없음" description="삭제되었거나 접근 불가" />
        : (
          <div className="space-y-3 text-[11.5px]">
            {/* 브랜드 기본 */}
            <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-bold text-ink">{bundle.brand.brand_name}</p>
                  <p className="font-mono text-[10px] text-ink-mute">{bundle.brand.brand_code}</p>
                </div>
                <AdminBadge tone={displayStatus === 'ACTIVE' ? 'success' : displayStatus === 'PENDING' ? 'warning' : 'neutral'} variant="subtle">
                  {displayStatus}
                </AdminBadge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="text-ink-mute">사업자</dt><dd className="text-ink">{bundle.brand.business_name}</dd>
                <dt className="text-ink-mute">담당자</dt><dd className="text-ink">{bundle.brand.manager_name}</dd>
                <dt className="text-ink-mute">이메일</dt><dd className="text-ink truncate">{bundle.brand.manager_email}</dd>
              </dl>
            </div>

            {/* 계약 */}
            <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">계약</p>
              {bundle.contract ? (
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-ink-mute">계약번호</dt><dd className="font-mono">{bundle.contract.contract_no}</dd>
                  <dt className="text-ink-mute">상태</dt><dd>{bundle.contract.status}</dd>
                  <dt className="text-ink-mute">시작일</dt><dd>{fmtDate(bundle.contract.start_date)}</dd>
                  <dt className="text-ink-mute">종료일</dt><dd>{fmtDate(bundle.contract.end_date)}</dd>
                  <dt className="text-ink-mute">단가</dt><dd>{fmtMoney(bundle.contract.monthly_store_price)}</dd>
                  <dt className="text-ink-mute">수수료율</dt><dd>{bundle.contract.commission_rate ?? 0}%</dd>
                </dl>
              ) : <p className="mt-1 text-ink-mute">계약 없음</p>}
              <button type="button" onClick={() => navigateToTab('enterprise-contracts')}
                className="mt-1.5 text-[10px] text-violet-300 hover:underline flex items-center gap-1">
                계약 관리 <ExternalLink size={10} />
              </button>
            </div>

            {/* Billing */}
            <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
              <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200">Billing (최근 5건)</p>
              {bundle.recent_billing.length === 0
                ? <p className="mt-1 text-ink-mute">청구 이력 없음</p>
                : (
                  <ul className="mt-1.5 space-y-0.5">
                    {bundle.recent_billing.slice(0, 5).map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between">
                        <span>{inv.billing_month.slice(0, 7)} · <AdminBadge tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'info'} variant="subtle">{inv.status}</AdminBadge></span>
                        <span className="font-bold">{fmtMoney(inv.total_amount, inv.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              <button type="button" onClick={() => navigateToTab('enterprise-settlement-center')}
                className="mt-1.5 text-[10px] text-violet-300 hover:underline flex items-center gap-1">
                청구 관리 <ExternalLink size={10} />
              </button>
            </div>

            {/* Settlement */}
            <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-200">Settlement (최근 5건)</p>
              {bundle.recent_settlements.length === 0
                ? <p className="mt-1 text-ink-mute">정산 이력 없음</p>
                : (
                  <ul className="mt-1.5 space-y-0.5">
                    {bundle.recent_settlements.slice(0, 5).map((s) => (
                      <li key={s.id} className="flex items-center justify-between">
                        <span>{s.settlement_month.slice(0, 7)} · <AdminBadge tone={s.status === 'paid' ? 'success' : 'info'} variant="subtle">{s.status}</AdminBadge></span>
                        <span className="font-bold">{fmtMoney(s.total_commission)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              <button type="button" onClick={() => navigateToTab('enterprise-monthly-settlements')}
                className="mt-1.5 text-[10px] text-violet-300 hover:underline flex items-center gap-1">
                정산 관리 <ExternalLink size={10} />
              </button>
            </div>

            {/* 관련 액션 링크 */}
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => navigateToTab('store-monitoring')}
                className="rounded bg-bg-card px-2 py-1.5 text-[10px] ring-1 ring-line/15 hover:bg-bg-hover">
                Store 상태 →
              </button>
              <button type="button" onClick={() => navigateToTab('store-now-playing')}
                className="rounded bg-bg-card px-2 py-1.5 text-[10px] ring-1 ring-line/15 hover:bg-bg-hover">
                Now Playing →
              </button>
              <button type="button" onClick={() => navigateToTab('policy-deployment')}
                className="rounded bg-bg-card px-2 py-1.5 text-[10px] ring-1 ring-line/15 hover:bg-bg-hover">
                정책 배포 →
              </button>
              <button type="button" onClick={() => navigateToTab('brand-registry')}
                className="rounded bg-bg-card px-2 py-1.5 text-[10px] ring-1 ring-line/15 hover:bg-bg-hover">
                브랜드 관리 →
              </button>
            </div>

            {/* Recent activity */}
            <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200">최근 활동 (전체)</p>
              {bundle.recent_activity.length === 0
                ? <p className="mt-1 text-ink-mute">이벤트 없음</p>
                : (
                  <ul className="mt-1.5 space-y-0.5">
                    {bundle.recent_activity.slice(0, 5).map((e) => (
                      <li key={`${e.type}:${e.id}`} className="flex items-center justify-between">
                        <span className="truncate max-w-[180px]">{e.title}</span>
                        <span className="shrink-0 text-ink-mute">{fmtRelative(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        )}
    </AdminCard>
  );
}
