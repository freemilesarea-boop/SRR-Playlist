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
  Activity, AlertOctagon, AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock,
  Compass, Database, ExternalLink, Handshake, Heart, HeartPulse, PlayCircle, Plus,
  RadioTower, RefreshCw, Search, ShieldCheck, ShieldX, Siren,
  Store as StoreIcon, TrendingUp, Wallet, Wifi, WifiOff, X, Zap,
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
  type CommandCenterAlert, type IncidentPriority, type SearchHit,
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

      {/* Phase 3 spec 6 — 한 줄 요약 (Hero 아래) */}
      <SummaryStrip kpi={kpi} alerts={alerts} />

      {/* Phase 3 spec 1 — NOC Dashboard 6 카드 */}
      <NocDashboard kpi={kpi} alerts={alerts} loading={loading && !kpi} />

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
              {/* Phase 3 spec 3, 5 — Incident Queue with Priority + Quick Fix */}
              <IncidentQueueCard alerts={alerts} loading={loading && alerts.length === 0} />
              {/* Phase 3 spec 8 — Timeline 색상 rail 개선 */}
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
// Brand Overview grid (Phase 2 리디자인)
// ----------------------------------------------------------------------------
// spec 1: Enterprise 검색 (debounce)
// spec 2: 상태 필터 chip (즉시 적용)
// spec 3: 자동 상태 Badge (unpaid/inactive/suspended/expired/expiring/pending/정상)
// spec 4: Health Score (0-100) — 기존 KPI 조합만
// spec 5: 최근 통신 상대 시간
// spec 6: 클릭 가능한 KPI (Health Score 클릭 → 상세)
// spec 7: hover shadow + border transition
// spec 8: "관리 →" 명확한 상세 버튼
// spec 9: Empty state — 아이콘 + CTA
// spec 10: Responsive (검색+필터 1줄→2줄→세로)
// spec 11: debounce + useMemo
// ============================================================================

/** 자동 상태 라벨 — 운영 상황 기반 (신규 쿼리 없음, 기존 필드만 조합). */
type DerivedBrandStatus =
  | { key: 'unpaid';      label: '미납',       tone: 'danger' }
  | { key: 'inactive';    label: '전체 오프라인', tone: 'danger' }
  | { key: 'expired';     label: '계약 만료',   tone: 'danger' }
  | { key: 'suspended';   label: '정책 확인 필요', tone: 'warning' }
  | { key: 'expiring';    label: '만료 임박',   tone: 'warning' }
  | { key: 'pending';     label: '승인 대기',   tone: 'warning' }
  | { key: 'no_contract'; label: '계약 없음',   tone: 'neutral' }
  | { key: 'normal';      label: '정상 운영',   tone: 'success' };

function deriveBrandStatus(b: BrandOverviewRow): DerivedBrandStatus {
  if (b.unpaid_count > 0)                                                                return { key: 'unpaid',      label: '미납',           tone: 'danger'  };
  if (b.status === 'INACTIVE')                                                           return { key: 'inactive',    label: '전체 오프라인',    tone: 'danger'  };
  if (b.contract_status === 'expired' || b.contract_status === 'terminated')             return { key: 'expired',     label: '계약 만료',        tone: 'danger'  };
  if (b.status === 'SUSPENDED')                                                          return { key: 'suspended',   label: '정책 확인 필요',   tone: 'warning' };
  if (b.contract_status === 'expiring')                                                  return { key: 'expiring',    label: '만료 임박',        tone: 'warning' };
  if (b.status === 'PENDING')                                                            return { key: 'pending',     label: '승인 대기',        tone: 'warning' };
  if (b.contract_status === 'no_contract')                                               return { key: 'no_contract', label: '계약 없음',        tone: 'neutral' };
  return                                                                                        { key: 'normal',      label: '정상 운영',        tone: 'success' };
}

/** Health Score (0-100) — status / contract / unpaid 만 사용. 신규 쿼리 없음. */
function computeHealthScore(b: BrandOverviewRow): number {
  let score = 100;
  // Enterprise 상태
  if (b.status === 'PENDING')   score -= 20;
  if (b.status === 'SUSPENDED') score -= 40;
  if (b.status === 'INACTIVE')  score -= 50;
  // 계약
  switch (b.contract_status) {
    case 'expiring':    score -= 10; break;
    case 'draft':       score -= 15; break;
    case 'expired':     score -= 25; break;
    case 'terminated':  score -= 30; break;
    case 'no_contract': score -= 30; break;
    default: break;
  }
  // 미납
  if (b.unpaid_count >= 3)       score -= 30;
  else if (b.unpaid_count > 0)   score -= 15;
  return Math.max(0, Math.min(100, score));
}

function healthTone(score: number): { label: string; tone: 'success' | 'warning' | 'danger'; icon: JSX.Element } {
  if (score >= 95) return { label: 'Excellent', tone: 'success', icon: <Heart size={11} /> };
  if (score >= 80) return { label: 'Good',      tone: 'success', icon: <Heart size={11} /> };
  if (score >= 60) return { label: 'Warning',   tone: 'warning', icon: <AlertTriangle size={11} /> };
  return              { label: 'Critical',  tone: 'danger',  icon: <AlertTriangle size={11} /> };
}

type BrandFilterKey = 'all' | 'normal' | 'partial_offline' | 'all_offline' | 'policy_drift' | 'unpaid';

const FILTER_CHIPS: Array<{ key: BrandFilterKey; label: string }> = [
  { key: 'all',              label: '전체' },
  { key: 'normal',           label: '정상 운영' },
  { key: 'partial_offline',  label: '일부 오프라인' },
  { key: 'all_offline',      label: '전체 오프라인' },
  { key: 'policy_drift',     label: '정책 미동기' },
  { key: 'unpaid',           label: '미납 존재' },
];

function matchesFilter(b: BrandOverviewRow, filter: BrandFilterKey): boolean {
  const d = deriveBrandStatus(b);
  switch (filter) {
    case 'all':               return true;
    case 'normal':            return d.key === 'normal';
    case 'partial_offline':   return d.key === 'suspended' || d.key === 'pending';
    case 'all_offline':       return d.key === 'inactive';
    case 'policy_drift':      return d.key === 'suspended' || d.key === 'expiring';
    case 'unpaid':            return b.unpaid_count > 0;
    default:                  return true;
  }
}

function BrandOverviewGrid({
  brands, loading, onSelect, selectedId,
}: {
  brands: BrandOverviewRow[]; loading: boolean;
  onSelect: (id: string) => void; selectedId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<BrandFilterKey>('all');

  // Debounce 200ms (spec 1)
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  // useMemo 로 필터 안정화 (spec 11)
  const filtered = useMemo(() => {
    return brands.filter((b) => {
      if (!matchesFilter(b, filter)) return false;
      if (!debouncedQuery) return true;
      const q = debouncedQuery;
      return (
        b.brand_name.toLowerCase().includes(q)
        || b.brand_code.toLowerCase().includes(q)
        || (b.manager_name?.toLowerCase().includes(q) ?? false)
        || (b.manager_email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [brands, debouncedQuery, filter]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Building2 size={13} /> 브랜드 개요 ({filtered.length}/{brands.length})</span>}
      subtitle={<span className="text-[10px] text-ink-mute">Health Score · 자동 상태 · 검색/필터 지원</span>}
    >
      {/* 검색 + 필터 (spec 1, 2, 10) — Desktop 1줄, Tablet 2줄, Mobile 세로 */}
      <div className="mb-3 space-y-2 md:space-y-0 md:flex md:items-center md:gap-2">
        <div className="flex items-center gap-2 rounded-lg bg-bg-card px-2.5 py-1.5 ring-1 ring-line/20 md:flex-1 md:min-w-[240px]">
          <Search size={12} className="text-ink-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="브랜드명 / 코드 / 담당자 검색"
            className="flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-dim"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-ink-mute hover:text-ink" aria-label="검색어 지우기">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTER_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                filter === c.key
                  ? 'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/50'
                  : 'bg-bg-card text-ink-mute ring-1 ring-line/15 hover:text-ink hover:ring-line/25'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading && brands.length === 0 ? <AdminSkeleton variant="block" />
        : brands.length === 0 ? (
          <AdminEmpty
            title="등록된 브랜드가 없습니다"
            description="Brand Registry 에서 새 브랜드를 등록하세요."
            action={
              <AdminButton tone="primary" onClick={() => navigateToTab('brand-registry')}>
                <Plus size={12} /> 새 브랜드 등록
              </AdminButton>
            }
          />
        ) : filtered.length === 0 ? (
          <AdminEmpty
            title="검색 결과 없음"
            description={`"${debouncedQuery || filter}" 에 매칭되는 브랜드가 없습니다.`}
            action={
              <AdminButton variant="subtle" tone="neutral" onClick={() => { setQuery(''); setFilter('all'); }}>
                필터 초기화
              </AdminButton>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.map((b) => {
              const derived = deriveBrandStatus(b);
              const score = computeHealthScore(b);
              const health = healthTone(score);
              const isSelected = selectedId === b.brand_id;
              return (
                <div
                  key={b.brand_id}
                  onClick={() => onSelect(b.brand_id)}
                  className={`group cursor-pointer rounded-xl p-3 ring-1 transition-all duration-150 hover:shadow-md ${
                    isSelected
                      ? 'bg-violet-500/25 ring-violet-400/50'
                      : 'bg-bg-card ring-line/15 hover:bg-bg-hover hover:ring-line/30'
                  }`}
                >
                  {/* 상단: 브랜드 + Health Score */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold text-ink">{b.brand_name}</p>
                      <p className="font-mono text-[10px] text-ink-mute">{b.brand_code}</p>
                    </div>
                    <div className={`shrink-0 rounded-lg px-2 py-1 text-right ring-1 ${
                      health.tone === 'success' ? 'bg-emerald-500/25 ring-emerald-400/50'
                      : health.tone === 'warning' ? 'bg-amber-500/25 ring-amber-400/50'
                      : 'bg-rose-500/25 ring-rose-400/50'
                    }`}>
                      <p className={`text-[9px] font-bold uppercase tracking-wider ${
                        health.tone === 'success' ? 'text-emerald-100'
                        : health.tone === 'warning' ? 'text-amber-100'
                        : 'text-rose-100'
                      }`}>Health</p>
                      <p className="tabular-nums text-[14px] font-black leading-tight text-ink">{score}</p>
                    </div>
                  </div>

                  {/* 자동 상태 Badge (spec 3) + 계약 상태 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <AdminBadge tone={derived.tone as 'success' | 'warning' | 'danger' | 'neutral'} variant="subtle">
                      {derived.label}
                    </AdminBadge>
                    <span className="text-[10px] text-ink-mute">·</span>
                    <span className="text-[10px] text-ink-mute">
                      {b.contract_status === 'no_contract' ? '계약 없음' : `계약 ${b.contract_status.toUpperCase()}`}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-mute">
                      {health.icon}
                      {health.label}
                    </span>
                  </div>

                  {/* KPI grid */}
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-ink-mute">미납</span>
                      <span className={b.unpaid_count > 0 ? 'text-rose-200 font-bold' : 'text-ink'}>{b.unpaid_count} 건</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-mute">미납 금액</span>
                      <span className={b.unpaid_amount > 0 ? 'text-rose-200 font-bold' : 'text-ink'}>{fmtMoney(b.unpaid_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-mute">다음 청구</span>
                      <span>{fmtDate(b.next_due_date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-mute">최근 통신</span>
                      <span>{fmtRelative(b.last_login_at ?? b.updated_at)}</span>
                    </div>
                  </div>

                  {/* 담당자 + 관리 버튼 (spec 8) */}
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/10 pt-2">
                    <p className="min-w-0 truncate text-[10px] text-ink-mute">
                      {b.manager_name ? `👤 ${b.manager_name}` : ''}
                      {b.manager_email ? <span className="ml-1">· {b.manager_email}</span> : ''}
                    </p>
                    <div className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-bold uppercase tracking-wider text-violet-200 opacity-70 group-hover:opacity-100 transition-opacity">
                      관리
                      <ArrowRight size={11} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Phase 3 spec 6 — Summary Strip (한 줄 요약)
// ----------------------------------------------------------------------------
// 자동 생성. 값 0 인 항목은 표시 안 함. 항상 최소 "정상 운영" 문구 fallback.
// ============================================================================
function SummaryStrip({ kpi, alerts }: { kpi: CommandCenterKpi | null; alerts: CommandCenterAlert[] }) {
  const segments = useMemo(() => {
    if (!kpi) return [] as Array<{ label: string; count: number; tone: 'danger' | 'warning' | 'info' }>;
    const parts: Array<{ label: string; count: number; tone: 'danger' | 'warning' | 'info' }> = [];
    const critical = kpi.noc.critical + kpi.noc.playback_error + kpi.noc.device_disconnected;
    if (critical > 0)                            parts.push({ label: '현재 장애',      count: critical,                          tone: 'danger' });
    if (kpi.noc.heartbeat_missing > 0)           parts.push({ label: 'Heartbeat 이상', count: kpi.noc.heartbeat_missing,          tone: 'danger' });
    if (kpi.offline_stores > 0)                  parts.push({ label: '오프라인 매장',  count: kpi.offline_stores,                 tone: 'warning' });
    if (kpi.drift_stores > 0)                    parts.push({ label: '정책 미동기',    count: kpi.drift_stores,                   tone: 'warning' });
    if (kpi.pending_approvals > 0)               parts.push({ label: '승인 대기',      count: kpi.pending_approvals,              tone: 'warning' });
    if (kpi.this_month_billing_count > 0)        parts.push({ label: '이번달 Billing', count: kpi.this_month_billing_count,       tone: 'info' });
    return parts;
  }, [kpi]);

  const overall: 'healthy' | 'warning' | 'critical' = kpi?.overall_status ?? 'healthy';
  const hasP1 = alerts.some((a) => a.priority === 'P1');
  const effectiveOverall: 'healthy' | 'warning' | 'critical' = hasP1 ? 'critical' : overall;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 ring-1 transition ${
      effectiveOverall === 'critical'
        ? 'bg-rose-500/20 ring-rose-500/40'
        : effectiveOverall === 'warning'
        ? 'bg-amber-500/20 ring-amber-500/40'
        : 'bg-emerald-500/20 ring-emerald-500/40'
    }`}>
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${
        effectiveOverall === 'critical' ? 'text-rose-100'
        : effectiveOverall === 'warning' ? 'text-amber-100'
        : 'text-emerald-100'
      }`}>
        {effectiveOverall === 'critical' ? <Siren size={12} className="animate-pulse" />
          : effectiveOverall === 'warning' ? <AlertTriangle size={12} />
          : <CheckCircle2 size={12} />}
        {effectiveOverall === 'critical' ? 'CRITICAL' : effectiveOverall === 'warning' ? 'WARNING' : 'HEALTHY'}
      </span>
      {!kpi ? (
        <span className="text-[11px] text-ink-mute">지표 계산 중…</span>
      ) : segments.length === 0 ? (
        <span className="text-[11px] font-semibold text-emerald-100">전체 정상 운영 · 처리할 장애 없음</span>
      ) : (
        segments.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1 text-[11px]">
            {i > 0 && <span className="text-ink-dim">·</span>}
            <span className={
              s.tone === 'danger'  ? 'text-rose-100 font-semibold'
              : s.tone === 'warning' ? 'text-amber-100 font-semibold'
              : 'text-sky-100'
            }>{s.label}</span>
            <span className={`tabular-nums font-bold ${
              s.tone === 'danger'  ? 'text-rose-100'
              : s.tone === 'warning' ? 'text-amber-100'
              : 'text-sky-100'
            }`}>{s.count}</span>
            <span className="text-ink-mute">건</span>
          </span>
        ))
      )}
    </div>
  );
}

// ============================================================================
// Phase 3 spec 1 — NOC Dashboard 6 카드
// ----------------------------------------------------------------------------
// 표시 항목: 현재 장애 / 오프라인 매장 / 정책 미동기 / Heartbeat 이상 / 미납 / 긴급 알림
// 색상: 정상 Green / 주의 Amber / 위험 Red
// Critical 카드만 spec 11 pulse animation 적용.
// ============================================================================
interface NocCardDef {
  key: string;
  label: string;
  value: number;
  icon: JSX.Element;
  tab: string;
  /** critical 이면 pulse. 0 이면 항상 healthy. */
  severity: (v: number) => 'healthy' | 'warning' | 'critical';
}

function NocDashboard({
  kpi, alerts, loading,
}: {
  kpi: CommandCenterKpi | null; alerts: CommandCenterAlert[]; loading: boolean;
}) {
  const overduebilling = alerts.find((a) => a.key === 'overdue_billing')?.count ?? 0;
  const p1Count = alerts.filter((a) => a.priority === 'P1').length;

  const cards: NocCardDef[] = kpi ? [
    { key: 'active_incidents', label: '현재 장애', value: kpi.noc.critical + kpi.noc.playback_error + kpi.noc.device_disconnected,
      icon: <AlertOctagon size={18} />, tab: 'enterprise-noc',
      severity: (v) => v > 0 ? 'critical' : 'healthy' },
    { key: 'offline_stores',   label: '오프라인 매장', value: kpi.offline_stores,
      icon: <WifiOff size={18} />, tab: 'store-monitoring',
      severity: (v) => v === 0 ? 'healthy' : (kpi.total_stores > 0 && v === kpi.total_stores) ? 'critical' : 'warning' },
    { key: 'policy_drift',     label: '정책 미동기', value: kpi.noc.policy_drift || kpi.drift_stores,
      icon: <ShieldX size={18} />, tab: 'policy-deployment',
      severity: (v) => v === 0 ? 'healthy' : v >= 5 ? 'critical' : 'warning' },
    { key: 'heartbeat',        label: 'Heartbeat 이상', value: kpi.noc.heartbeat_missing,
      icon: <HeartPulse size={18} />, tab: 'store-monitoring',
      severity: (v) => v === 0 ? 'healthy' : 'critical' },
    { key: 'unpaid',           label: '미납',       value: overduebilling,
      icon: <Wallet size={18} />, tab: 'enterprise-settlement-center',
      severity: (v) => v === 0 ? 'healthy' : v >= 3 ? 'critical' : 'warning' },
    { key: 'urgent_alerts',    label: '긴급 알림 (P1)', value: p1Count,
      icon: <Siren size={18} />, tab: 'enterprise-noc',
      severity: (v) => v === 0 ? 'healthy' : 'critical' },
  ] : [];

  if (loading && !kpi) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl bg-bg-card ring-1 ring-line/15 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><RadioTower size={13} /> NOC 상태</span>}
      subtitle={<span className="text-[10px] text-ink-mute">3초 안에 파악 · 클릭 시 해당 관제 화면 이동</span>}
    >
      {/* spec 10 responsive: Mobile 2열 / Tablet 3열 / Desktop 6열 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => {
          const sev = c.severity(c.value);
          const isCritical = sev === 'critical';
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => navigateToTab(c.tab)}
              className={`group text-left rounded-xl p-2.5 ring-1 transition-all duration-150 hover:shadow-md ${
                sev === 'healthy'
                  ? 'bg-emerald-500/20 ring-emerald-500/35 hover:bg-emerald-500/25'
                  : sev === 'warning'
                  ? 'bg-amber-500/25 ring-amber-500/45 hover:bg-amber-500/30'
                  : `bg-rose-500/25 ring-rose-500/45 hover:bg-rose-500/30 ${isCritical && c.value > 0 ? 'animate-pulse' : ''}`
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                  sev === 'healthy' ? 'bg-emerald-500/35 text-emerald-100'
                  : sev === 'warning' ? 'bg-amber-500/40 text-amber-100'
                  : 'bg-rose-500/40 text-rose-100'
                }`}>{c.icon}</span>
                <ExternalLink size={10} className="text-ink-mute opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="mt-1.5 text-2xl font-black tabular-nums text-ink">{fmtNumber(c.value)}</p>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${
                sev === 'healthy' ? 'text-emerald-100'
                : sev === 'warning' ? 'text-amber-100'
                : 'text-rose-100'
              }`}>{c.label}</p>
            </button>
          );
        })}
      </div>
    </AdminCard>
  );
}

// ============================================================================
// Phase 3 spec 3, 5 — Incident Queue (Alerts 진화)
// ----------------------------------------------------------------------------
// P1 → P2 → P3 순 (server-side 정렬 완료).
// Priority Badge + Quick Fix 버튼 (기존 navigateToTab 재사용).
// Empty state: 초록 체크 + "현재 처리할 장애가 없습니다."
// Critical (P1) 항목만 fade-in.
// ============================================================================
function PriorityBadge({ p }: { p: IncidentPriority }) {
  const tone =
    p === 'P1' ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60'
    : p === 'P2' ? 'bg-amber-500/40 text-amber-50 ring-amber-400/60'
    : 'bg-sky-500/40 text-sky-50 ring-sky-400/60';
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ring-1 ${tone}`}>
      {p}
    </span>
  );
}

function IncidentQueueCard({ alerts, loading }: { alerts: CommandCenterAlert[]; loading: boolean }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Zap size={13} /> Incident Queue</span>}
      subtitle={<span className="text-[10px] text-ink-mute">P1 → P2 → P3 순 · Quick Fix</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-emerald-500/25 py-6 text-center ring-1 ring-emerald-500/45">
            <CheckCircle2 size={28} className="text-emerald-200" />
            <p className="text-[13px] font-bold text-emerald-100">현재 처리할 장애가 없습니다.</p>
            <p className="text-[10px] text-emerald-200/80">전체 정상 운영 중</p>
          </div>
        )
        : (
          <ul className="space-y-1.5">
            {alerts.map((a) => {
              const priority: IncidentPriority = a.priority ?? 'P3';
              return (
                <li
                  key={a.key}
                  className={`rounded-lg ring-1 transition-all duration-300 ${
                    priority === 'P1'
                      ? 'bg-rose-500/20 ring-rose-500/40'
                      : priority === 'P2'
                      ? 'bg-amber-500/20 ring-amber-500/40'
                      : 'bg-sky-500/25 ring-sky-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <PriorityBadge p={priority} />
                      <div className="min-w-0">
                        <p className={`truncate text-[12px] font-bold ${
                          priority === 'P1' ? 'text-rose-100' : priority === 'P2' ? 'text-amber-100' : 'text-sky-100'
                        }`}>{a.label}</p>
                        <p className="text-[10px] text-ink-mute tabular-nums">{a.count} 건</p>
                      </div>
                    </div>
                    {a.action_tab && (
                      <button
                        type="button"
                        onClick={() => navigateToTab(a.action_tab!)}
                        className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold ring-1 transition hover:shadow-sm ${
                          priority === 'P1'
                            ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60 hover:bg-rose-500/50'
                            : priority === 'P2'
                            ? 'bg-amber-500/40 text-amber-50 ring-amber-400/60 hover:bg-amber-500/50'
                            : 'bg-sky-500/40 text-sky-50 ring-sky-400/60 hover:bg-sky-500/50'
                        }`}
                      >
                        {a.action_label ?? '이동'}
                        <ArrowRight size={9} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Phase 3 spec 8 — Timeline 개선 (운영 이벤트 중심 색상 rail)
// ----------------------------------------------------------------------------
// [시각] │ [type 배지] 제목
// 좌측 rail 색상으로 severity 시각화. 시각은 HH:MM:SS 로 표시.
// ============================================================================
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false });
  } catch { return '—'; }
}

function severityRailClasses(sev: string): { rail: string; badge: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  switch (sev) {
    case 'error':
    case 'critical': return { rail: 'bg-rose-500',    badge: 'danger'  };
    case 'warning':  return { rail: 'bg-amber-500',   badge: 'warning' };
    case 'success':  return { rail: 'bg-emerald-500', badge: 'success' };
    case 'info':     return { rail: 'bg-sky-500',     badge: 'info'    };
    default:         return { rail: 'bg-ink-mute',    badge: 'neutral' };
  }
}

function TimelineCard({ events, loading }: { events: EnterpriseOpsActivityEvent[]; loading: boolean }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Activity size={13} /> 운영 Timeline</span>}
      subtitle={<span className="text-[10px] text-ink-mute">최근 20건 · severity 색상 rail</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : events.length === 0 ? <AdminEmpty title="이벤트 없음" description="최근 활동 없음" />
        : (
          <ul className="max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {events.map((e) => {
              const sc = severityRailClasses(String(e.severity ?? 'info'));
              return (
                <li key={`${e.type}:${e.id}`} className="flex items-stretch gap-2">
                  {/* 좌측 시각 */}
                  <span className="w-16 shrink-0 pt-1 text-right font-mono text-[10px] tabular-nums text-ink-mute">
                    {fmtTime(e.at)}
                  </span>
                  {/* Severity rail */}
                  <span className={`w-0.5 shrink-0 rounded-full ${sc.rail}`} aria-hidden />
                  {/* 본문 */}
                  <div className="min-w-0 flex-1 rounded-md bg-bg-card px-2 py-1.5 text-[11px] ring-1 ring-line/10">
                    <div className="flex items-center gap-1.5">
                      <AdminBadge tone={sc.badge} variant="subtle">{e.type}</AdminBadge>
                      <span className="truncate text-ink">{e.title}</span>
                    </div>
                    <p className="mt-0.5 text-[9.5px] text-ink-dim">{fmtRelative(e.at)}</p>
                  </div>
                </li>
              );
            })}
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
