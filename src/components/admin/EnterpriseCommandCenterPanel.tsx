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
  Activity, AlertOctagon, AlertTriangle, ArrowRight, Bell, Bot, Building2, CheckCircle2, Clock,
  Compass, Database, ExternalLink, Handshake, Heart, HeartPulse, Minus, PlayCircle, Plus,
  RadioTower, RefreshCw, Search, ShieldCheck, ShieldX, Siren, Sparkles,
  Store as StoreIcon, TrendingDown, TrendingUp, Wallet, Wifi, WifiOff, X, Zap,
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

      {/* Polish spec 1 — Hero KPI (compact) */}
      <HeroKpi kpi={kpi} />

      {/* SummaryStrip — 한 줄 요약 (Hero 바로 아래, 얇음) */}
      <SummaryStrip kpi={kpi} alerts={alerts} />

      {/* AI spec 10 responsive: Desktop NOC(2/3) + AI Ops(1/3) · Tablet/Mobile 세로 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* Polish spec 2 — NOC Dashboard 승격 */}
          <NocDashboard kpi={kpi} alerts={alerts} loading={loading && !kpi} />
        </div>
        <div className="lg:col-span-1">
          {/* AI spec 1~9 — Rule-based AI 운영 분석 */}
          <AiOperationsCard
            kpi={kpi}
            alerts={alerts}
            brands={brands}
            timeline={timeline}
            loading={loading && !kpi}
          />
        </div>
      </div>

      {/* Polish spec 2, 3 — Quick Actions (compact 6열) */}
      <QuickActionsCard />

      {/* Polish spec 2 — Secondary KPI (하위 배치) */}
      <SecondaryKpi kpi={kpi} />

      {/* Brand Overview (좌 2/3) + Sidebar (우 1/3) */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BrandOverviewGrid
            brands={brands}
            loading={loading && brands.length === 0}
            onSelect={(id) => setSelectedBrandId(id)}
            selectedId={selectedBrandId}
          />
        </div>
        <div className="space-y-3">
          {selectedBrandId ? (
            <BrandDetailSidebar
              brandId={selectedBrandId}
              onClose={() => setSelectedBrandId(null)}
            />
          ) : (
            <>
              {/* Polish spec 2 순서: Timeline → Alerts (Alerts 마지막) */}
              <TimelineCard events={timeline} loading={loading && timeline.length === 0} />
              <IncidentQueueCard alerts={alerts} loading={loading && alerts.length === 0} />
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

  // Polish spec 1 — Hero compact (기존 h-32 → h-24, p-4 → p-2.5, 값 text-3xl → text-2xl)
  if (!kpi) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl bg-bg-card ring-1 ring-line/15 animate-pulse" />
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
          className={`group text-left rounded-xl p-2.5 ring-1 transition-all duration-150 hover:shadow-md ${
            item.tone === 'success'
              ? 'bg-emerald-500/25 ring-emerald-400/50 hover:bg-emerald-500/30'
              : item.tone === 'warning'
              ? 'bg-amber-500/25 ring-amber-400/50 hover:bg-amber-500/30'
              : item.tone === 'danger'
              ? 'bg-rose-500/25 ring-rose-400/50 hover:bg-rose-500/30'
              : 'bg-violet-500/25 ring-violet-400/50 hover:bg-violet-500/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            {/* 좌: 아이콘 + 라벨 스택 */}
            <div className="flex min-w-0 items-center gap-2">
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                item.tone === 'success'  ? 'bg-emerald-500/40 text-emerald-100'
                : item.tone === 'warning' ? 'bg-amber-500/40 text-amber-100'
                : item.tone === 'danger'  ? 'bg-rose-500/40 text-rose-100'
                :                           'bg-violet-500/40 text-violet-100'
              }`}>{item.icon}</span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-ink leading-tight">{item.label}</p>
                <p className="truncate text-[9.5px] text-ink-mute leading-tight">{item.desc}</p>
              </div>
            </div>
            <ExternalLink size={11} className="shrink-0 text-ink-mute opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
          {/* 값 — 크게 유지, 여백만 축소 */}
          <p className="mt-1.5 text-2xl font-black tabular-nums text-ink">{fmtNumber(item.value)}</p>
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
// Quick Actions — Polish spec 3
// ----------------------------------------------------------------------------
// 6열 grid (Desktop) · 2열 (Mobile) · 아이콘 강조 · 라벨 간결.
// spec 3 매핑: ＋ 브랜드 / 📝 계약 / 💳 Billing / 🎵 Policy / 📢 공지 / 🚚 Dispatch
// ============================================================================
const QUICK_ACTION_ICONS: Record<string, JSX.Element> = {
  create_brand:        <Plus size={14} />,
  create_contract:     <Handshake size={14} />,
  create_billing:      <Wallet size={14} />,
  policy_deploy:       <ShieldCheck size={14} />,
  emergency_broadcast: <Siren size={14} />,
  dispatch:            <RadioTower size={14} />,
};

function QuickActionsCard() {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><PlayCircle size={13} /> Quick Actions</span>}
      subtitle={<span className="text-[10px] text-ink-mute">기존 탭으로 이동 · 조회 전용 (실행 액션 아님)</span>}
    >
      {/* Polish spec 3, 9 responsive: 2 → 3 → 6열 */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTION_LINKS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => navigateToTab(a.target_tab)}
            className="group inline-flex items-center justify-start gap-1.5 rounded-lg bg-bg-card px-2 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-line/20 transition hover:bg-bg-hover hover:shadow-sm"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40 transition group-hover:bg-violet-500/35">
              {QUICK_ACTION_ICONS[a.key] ?? <PlayCircle size={12} />}
            </span>
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

                  {/* Polish spec 4 — Progress Bar (Health Score 시각화) */}
                  <div className="mt-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover ring-1 ring-line/15">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          health.tone === 'success' ? 'bg-emerald-400'
                          : health.tone === 'warning' ? 'bg-amber-400'
                          : 'bg-rose-400'
                        }`}
                        style={{ width: `${score}%` }}
                        aria-label={`Health ${score}/100`}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9.5px] text-ink-mute">
                      <span className="tabular-nums">{score}/100</span>
                      <span className="inline-flex items-center gap-0.5">{health.icon}{health.label}</span>
                    </div>
                  </div>

                  {/* 자동 상태 Badge + 계약 상태 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <AdminBadge tone={derived.tone as 'success' | 'warning' | 'danger' | 'neutral'} variant="subtle">
                      {derived.label}
                    </AdminBadge>
                    <span className="text-[10px] text-ink-mute">·</span>
                    <span className="text-[10px] text-ink-mute">
                      {b.contract_status === 'no_contract' ? '계약 없음' : `계약 ${b.contract_status.toUpperCase()}`}
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
// AI Operations Center — Rule-based Insight generator
// ----------------------------------------------------------------------------
// LLM 호출 없음. 이미 fetch 한 kpi/alerts/brands/timeline 을 조합해서
// 자연어 recommendation 생성. 새 API/RPC/polling 없음.
// ============================================================================

type InsightLevel = 'critical' | 'warning' | 'info';

interface AiInsight {
  key: string;
  level: InsightLevel;
  title: string;
  detail: string;
  recommendation: string;
  action_tab?: string;
  action_label?: string;
}

/** Alert.key 별 자연어 recommendation 매핑 (Rule-based). */
function alertToRecommendation(key: string): string {
  switch (key) {
    case 'all_offline':        return '즉시 매장 연결 상태를 점검하세요.';
    case 'offline_stores':     return '오프라인 매장을 개별 진단하세요.';
    case 'heartbeat_missing':  return '연결 상태를 확인하세요.';
    case 'noc_critical':       return 'NOC 알림을 즉시 확인하세요.';
    case 'drift_stores':       return '지금 배포를 권장합니다.';
    case 'overdue_billing':    return '이번 주 청구 권장.';
    case 'pending_approvals':  return '승인 대기 브랜드를 검토하세요.';
    case 'expiring_contracts': return '갱신 논의를 시작하세요.';
    default:                   return '해당 항목을 확인하세요.';
  }
}

/** 기존 alerts + brand health 를 조합한 Insight 리스트 (최대 5, 우선순위 순). */
function generateInsights(
  alerts: CommandCenterAlert[],
  brands: BrandOverviewRow[],
): AiInsight[] {
  const list: AiInsight[] = [];

  for (const a of alerts) {
    const level: InsightLevel = a.priority === 'P1' ? 'critical'
      : a.priority === 'P2' ? 'warning' : 'info';
    list.push({
      key: a.key, level,
      title: a.label,
      detail: `${a.count} 건`,
      recommendation: alertToRecommendation(a.key),
      action_tab: a.action_tab,
      action_label: a.action_label,
    });
  }

  // Brand Health 평균이 60 미만이면 추가 insight (spec 5 기준 반영)
  if (brands.length > 0) {
    const avg = Math.round(brands.reduce((s, b) => s + computeHealthScore(b), 0) / brands.length);
    if (avg < 60) {
      list.push({
        key: 'health_low', level: 'warning',
        title: 'Health Score 평균 저조',
        detail: `${avg}/100`,
        recommendation: '주요 브랜드 상태를 점검하세요.',
        action_tab: 'brand-registry',
        action_label: '브랜드',
      });
    }
  }

  const order: Record<InsightLevel, number> = { critical: 0, warning: 1, info: 2 };
  list.sort((a, b) => order[a.level] - order[b.level]);
  return list.slice(0, 5);
}

/**
 * Enterprise Score (0-100) — Rule-based 자동 계산.
 * 온라인률(25) · 정책(20) · Heartbeat(20) · 미납(15) · Health 평균(20) 가중 합.
 */
function computeEnterpriseScore(
  kpi: CommandCenterKpi | null,
  brands: BrandOverviewRow[],
): number {
  if (!kpi) return 100;
  const total = kpi.total_stores || 0;
  let acc = 0;

  // 온라인률 (25점) — 매장 없으면 만점 처리
  acc += total > 0 ? (kpi.online_stores / total) * 25 : 25;
  // 정책 동기률 (20점)
  const driftShare = total > 0 ? kpi.noc.policy_drift / total : 0;
  acc += (1 - driftShare) * 20;
  // Heartbeat (20점)
  const hbShare = total > 0 ? kpi.noc.heartbeat_missing / total : 0;
  acc += (1 - hbShare) * 20;
  // 미납 (15점) — 금액 임계값 기반
  if (kpi.unpaid_amount === 0)              acc += 15;
  else if (kpi.unpaid_amount < 1_000_000)   acc += 10;
  else if (kpi.unpaid_amount < 10_000_000)  acc += 5;
  else                                       acc += 0;
  // Brand Health 평균 (20점)
  if (brands.length > 0) {
    const avg = brands.reduce((s, b) => s + computeHealthScore(b), 0) / brands.length;
    acc += (avg / 100) * 20;
  } else {
    acc += 20;
  }

  return Math.round(Math.max(0, Math.min(100, acc)));
}

/** Daily Summary — 정상률/주의/긴급 (spec 4). */
function computeDailySummary(
  kpi: CommandCenterKpi | null,
  alerts: CommandCenterAlert[],
): { onlineRate: number; criticalCount: number; warningCount: number } {
  const total = kpi?.total_stores ?? 0;
  const onlineRate = total > 0 ? Math.round(((kpi?.online_stores ?? 0) / total) * 100) : 100;
  const criticalCount = alerts.filter((a) => a.priority === 'P1').length;
  const warningCount  = alerts.filter((a) => a.priority === 'P2').length;
  return { onlineRate, criticalCount, warningCount };
}

interface TrendItem {
  label: string;
  count: number;
  direction: 'up' | 'down' | 'flat';
  tone: 'success' | 'warning' | 'danger';
}

/**
 * AI Trend (spec 6) — 최근 timeline 이벤트 severity 분포.
 * 실제 7일 전 비교 데이터가 없어 (기존 API 미제공) 현재 20건 안에서
 * severity 별 빈도를 방향성 signal 로 매핑. Rule-based 근사.
 */
function computeTrend(timeline: EnterpriseOpsActivityEvent[]): TrendItem[] {
  const counts = { error: 0, warning: 0, success: 0, info: 0 };
  for (const e of timeline) {
    const s = String(e.severity ?? 'info');
    if (s === 'critical' || s === 'error') counts.error++;
    else if (s in counts) counts[s as keyof typeof counts]++;
  }
  return [
    { label: '오류 이벤트',   count: counts.error,   direction: counts.error > 0 ? 'up' : 'flat',   tone: counts.error > 0 ? 'danger' : 'success' },
    { label: '경고 이벤트',   count: counts.warning, direction: counts.warning > 0 ? 'up' : 'flat', tone: counts.warning > 0 ? 'warning' : 'success' },
    { label: '정상 이벤트',   count: counts.success, direction: counts.success > 0 ? 'up' : 'flat', tone: 'success' },
  ];
}

/** 반복 패턴 감지 (spec 7) — 같은 type+title prefix 가 3회 이상. */
function detectRepeatingIssues(
  timeline: EnterpriseOpsActivityEvent[],
): Array<{ key: string; count: number; title: string; latestAt: string; severity: string }> {
  const buckets = new Map<string, EnterpriseOpsActivityEvent[]>();
  for (const e of timeline) {
    const key = `${e.type}:${e.title.split(/\s+/).slice(0, 2).join(' ')}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  const repeats: Array<{ key: string; count: number; title: string; latestAt: string; severity: string }> = [];
  for (const [k, arr] of buckets) {
    if (arr.length >= 3) {
      repeats.push({
        key: k,
        count: arr.length,
        title: arr[0].title,
        latestAt: arr[0].at,
        severity: String(arr[0].severity ?? 'info'),
      });
    }
  }
  repeats.sort((a, b) => b.count - a.count);
  return repeats.slice(0, 3);
}

/** Recommendation History (spec 8) — severity != info 인 최근 10건 재해석. */
function recommendationHistory(
  timeline: EnterpriseOpsActivityEvent[],
): Array<{ id: string; at: string; title: string; severity: string; type: string }> {
  return timeline
    .filter((e) => String(e.severity) !== 'info')
    .slice(0, 10)
    .map((e) => ({
      id: `${e.type}:${e.id}`,
      at: e.at,
      title: e.title,
      severity: String(e.severity ?? 'info'),
      type: e.type,
    }));
}

// ============================================================================
// AI Operations Card — Rule-based UI (spec 1~11)
// ============================================================================
function AiOperationsCard({
  kpi, alerts, brands, timeline, loading,
}: {
  kpi: CommandCenterKpi | null;
  alerts: CommandCenterAlert[];
  brands: BrandOverviewRow[];
  timeline: EnterpriseOpsActivityEvent[];
  loading: boolean;
}) {
  const insights = useMemo(() => generateInsights(alerts, brands), [alerts, brands]);
  const score    = useMemo(() => computeEnterpriseScore(kpi, brands), [kpi, brands]);
  const summary  = useMemo(() => computeDailySummary(kpi, alerts), [kpi, alerts]);
  const trend    = useMemo(() => computeTrend(timeline), [timeline]);
  const repeats  = useMemo(() => detectRepeatingIssues(timeline), [timeline]);
  const history  = useMemo(() => recommendationHistory(timeline), [timeline]);

  // Score tone
  const scoreTone: 'success' | 'warning' | 'danger' =
    score >= 90 ? 'success' : score >= 70 ? 'warning' : 'danger';

  return (
    <AdminCard
      title={
        <span className="flex items-center gap-2">
          <Bot size={13} /> AI 운영 분석
          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-100 ring-1 ring-violet-400/50">
            <Sparkles size={9} /> BETA
          </span>
        </span>
      }
      subtitle={<span className="text-[10px] text-ink-mute">Rule-based · LLM 미사용 · 기존 데이터 조합</span>}
    >
      {loading ? <AdminSkeleton variant="block" /> : (
        <div className="space-y-3">
          {/* spec 4 — Daily Summary */}
          <DailySummaryStrip summary={summary} />

          {/* spec 5 — Enterprise Score */}
          <EnterpriseScoreBar score={score} tone={scoreTone} />

          {/* spec 1, 2, 3, 9 — Insights */}
          <InsightList insights={insights} />

          {/* spec 6 — Trend */}
          <TrendGrid trend={trend} />

          {/* spec 7 — Repeating issues */}
          {repeats.length > 0 && <RepeatingIssues repeats={repeats} />}

          {/* spec 8 — Recommendation history */}
          <RecommendationHistory items={history} />
        </div>
      )}
    </AdminCard>
  );
}

// ---- AI sub-components ----------------------------------------------------

function DailySummaryStrip({
  summary,
}: {
  summary: { onlineRate: number; criticalCount: number; warningCount: number };
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-bg-card p-2 ring-1 ring-line/15">
      <StatMini label="정상률"    value={`${summary.onlineRate}%`}          tone="success" />
      <StatMini label="주의"       value={String(summary.warningCount)}      tone={summary.warningCount > 0 ? 'warning' : 'success'} />
      <StatMini label="긴급"       value={String(summary.criticalCount)}     tone={summary.criticalCount > 0 ? 'danger' : 'success'} />
    </div>
  );
}

function StatMini({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' }) {
  const t = tone === 'success'
    ? { bg: 'bg-emerald-500/25', text: 'text-emerald-100', ring: 'ring-emerald-400/45' }
    : tone === 'warning'
    ? { bg: 'bg-amber-500/25',   text: 'text-amber-100',   ring: 'ring-amber-400/45' }
    : { bg: 'bg-rose-500/25',    text: 'text-rose-100',    ring: 'ring-rose-400/45' };
  return (
    <div className={`rounded-md px-2 py-1.5 ring-1 ${t.bg} ${t.ring}`}>
      <p className={`text-[9px] font-bold uppercase tracking-wider ${t.text}`}>{label}</p>
      <p className="text-[14px] font-black tabular-nums text-ink">{value}</p>
    </div>
  );
}

function EnterpriseScoreBar({ score, tone }: { score: number; tone: 'success' | 'warning' | 'danger' }) {
  const label = score >= 90 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Warning' : 'Critical';
  const barColor = tone === 'success' ? 'bg-emerald-400' : tone === 'warning' ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/15">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink">Enterprise Score</p>
        <p className="tabular-nums text-[18px] font-black text-ink">{score}<span className="text-[10px] font-normal text-ink-mute">/100</span></p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-hover ring-1 ring-line/15">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${score}%` }}
          aria-label={`Enterprise Score ${score}/100`}
        />
      </div>
      <p className="mt-1 text-[10px] text-ink-mute">{label} · 온라인률 · 정책 · Heartbeat · 미납 · Health 평균</p>
    </div>
  );
}

function InsightList({ insights }: { insights: AiInsight[] }) {
  if (insights.length === 0) {
    // spec 9 — Empty state
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg bg-emerald-500/20 py-4 text-center ring-1 ring-emerald-500/40">
        <Bot size={24} className="text-emerald-200" />
        <p className="text-[12px] font-bold text-emerald-100">오늘은 조치가 필요한 사항이 없습니다.</p>
        <p className="text-[10px] text-emerald-200/80">AI 분석 결과 정상 운영 중</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">오늘 확인할 사항</p>
      <ul className="space-y-1.5">
        {insights.map((i) => (
          <li
            key={i.key}
            className={`rounded-lg p-2 ring-1 transition-all duration-200 ${
              i.level === 'critical' ? 'bg-rose-500/20 ring-rose-500/40'
              : i.level === 'warning' ? 'bg-amber-500/20 ring-amber-500/40'
              : 'bg-sky-500/20 ring-sky-500/35'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-1.5">
                <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${
                  i.level === 'critical' ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60'
                  : i.level === 'warning' ? 'bg-amber-500/40 text-amber-50 ring-amber-400/60'
                  : 'bg-sky-500/40 text-sky-50 ring-sky-400/60'
                }`} aria-hidden>
                  {i.level === 'critical' ? <AlertOctagon size={9} />
                    : i.level === 'warning' ? <AlertTriangle size={9} />
                    : <Sparkles size={9} />}
                </span>
                <div className="min-w-0">
                  <p className={`truncate text-[11.5px] font-bold ${
                    i.level === 'critical' ? 'text-rose-100'
                    : i.level === 'warning' ? 'text-amber-100' : 'text-sky-100'
                  }`}>{i.title}</p>
                  <p className="text-[10px] text-ink-mute tabular-nums">{i.detail}</p>
                  <p className="mt-0.5 text-[10.5px] text-ink">→ {i.recommendation}</p>
                </div>
              </div>
              {i.action_tab && (
                <button
                  type="button"
                  onClick={() => navigateToTab(i.action_tab!)}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold ring-1 transition hover:shadow-sm ${
                    i.level === 'critical' ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60 hover:bg-rose-500/50'
                    : i.level === 'warning' ? 'bg-amber-500/40 text-amber-50 ring-amber-400/60 hover:bg-amber-500/50'
                    : 'bg-sky-500/40 text-sky-50 ring-sky-400/60 hover:bg-sky-500/50'
                  }`}
                >
                  {i.action_label ?? '이동'}
                  <ArrowRight size={9} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendGrid({ trend }: { trend: TrendItem[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">최근 활동 (Timeline 20건)</p>
      <div className="grid grid-cols-3 gap-1.5">
        {trend.map((t) => {
          const dirIcon = t.direction === 'up'   ? <TrendingUp   size={11} />
                        : t.direction === 'down' ? <TrendingDown size={11} />
                        :                          <Minus        size={11} />;
          const dirTone = t.tone === 'success' ? 'text-emerald-200'
                        : t.tone === 'warning' ? 'text-amber-200'
                        : 'text-rose-200';
          return (
            <div key={t.label} className="rounded-md bg-bg-card p-1.5 ring-1 ring-line/15">
              <p className="text-[9px] uppercase tracking-wider text-ink-mute">{t.label}</p>
              <div className="mt-0.5 flex items-center gap-1">
                <span className={`inline-flex ${dirTone}`} aria-hidden>{dirIcon}</span>
                <span className="tabular-nums text-[13px] font-black text-ink">{t.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RepeatingIssues({
  repeats,
}: {
  repeats: Array<{ key: string; count: number; title: string; latestAt: string; severity: string }>;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
        <AlertTriangle size={11} /> 반복 감지
      </p>
      <ul className="space-y-1">
        {repeats.map((r) => (
          <li key={r.key} className="rounded-md bg-amber-500/20 p-1.5 ring-1 ring-amber-500/40">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-semibold text-amber-100">{r.title}</p>
              <span className="shrink-0 tabular-nums text-[10px] font-bold text-amber-100">{r.count}회</span>
            </div>
            <p className="mt-0.5 text-[10px] text-ink-mute">→ 반복 발생. 장비 · 정책 · 계정 상태 점검 권장.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecommendationHistory({
  items,
}: {
  items: Array<{ id: string; at: string; title: string; severity: string; type: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">AI 감지 이력 (최근 10)</p>
      <ul className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
        {items.map((h) => {
          const sv = severityVisual(h.severity);
          return (
            <li key={h.id} className="flex items-center gap-1.5 rounded-md bg-bg-card p-1.5 text-[10.5px] ring-1 ring-line/10">
              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${sv.dotBg}`} aria-hidden>
                {sv.dotIcon}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{h.title}</span>
              <span className="shrink-0 font-mono text-[9px] tabular-nums text-ink-mute">{fmtRelative(h.at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
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
                      {/* Polish spec 7 — 색 원 상태 시각화 */}
                      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ${
                        priority === 'P1' ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60'
                        : priority === 'P2' ? 'bg-amber-500/40 text-amber-50 ring-amber-400/60'
                        : 'bg-sky-500/40 text-sky-50 ring-sky-400/60'
                      }`} aria-hidden>
                        {priority === 'P1' ? <AlertOctagon size={11} />
                          : priority === 'P2' ? <AlertTriangle size={11} />
                          : <Bell size={11} />}
                      </span>
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

interface SeverityVisual {
  rail: string;
  badge: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dotBg: string;
  dotIcon: JSX.Element;
}

function severityVisual(sev: string): SeverityVisual {
  switch (sev) {
    case 'error':
    case 'critical': return { rail: 'bg-rose-500',    badge: 'danger',  dotBg: 'bg-rose-500/40 text-rose-100',       dotIcon: <AlertOctagon size={11} /> };
    case 'warning':  return { rail: 'bg-amber-500',   badge: 'warning', dotBg: 'bg-amber-500/40 text-amber-100',     dotIcon: <AlertTriangle size={11} /> };
    case 'success':  return { rail: 'bg-emerald-500', badge: 'success', dotBg: 'bg-emerald-500/40 text-emerald-100', dotIcon: <CheckCircle2 size={11} /> };
    case 'info':     return { rail: 'bg-sky-500',     badge: 'info',    dotBg: 'bg-sky-500/40 text-sky-100',         dotIcon: <Activity size={11} /> };
    default:         return { rail: 'bg-ink-mute',    badge: 'neutral', dotBg: 'bg-bg-hover text-ink-mute',          dotIcon: <Activity size={11} /> };
  }
}

// Polish spec 6 — Timeline 카드 형태
// [🟢 dot] │ [type badge] [제목/브랜드명] │ [시각]
function TimelineCard({ events, loading }: { events: EnterpriseOpsActivityEvent[]; loading: boolean }) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Activity size={13} /> 운영 Timeline</span>}
      subtitle={<span className="text-[10px] text-ink-mute">최근 20건 · 카드형</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : events.length === 0 ? (
          <AdminEmpty title="이벤트 없음" description="최근 활동 없음. 30초 후 자동 갱신됩니다." />
        )
        : (
          <ul className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
            {events.map((e) => {
              const sv = severityVisual(String(e.severity ?? 'info'));
              return (
                <li key={`${e.type}:${e.id}`} className="flex items-stretch gap-2">
                  {/* Severity rail (좌측) */}
                  <span className={`w-0.5 shrink-0 rounded-full ${sv.rail}`} aria-hidden />
                  {/* 카드 본문 */}
                  <div className="min-w-0 flex-1 rounded-lg bg-bg-card p-2 ring-1 ring-line/15 transition-shadow hover:shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ${sv.dotBg}`} aria-hidden>
                          {sv.dotIcon}
                        </span>
                        <AdminBadge tone={sv.badge} variant="subtle">{e.type}</AdminBadge>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-mute">{fmtTime(e.at)}</span>
                    </div>
                    <p className="mt-1 truncate text-[11.5px] text-ink">{e.title}</p>
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
