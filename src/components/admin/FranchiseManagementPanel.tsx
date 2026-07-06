/**
 * FranchiseManagementPanel — X6.89 B2B Franchise MVP admin UI.
 *
 * 하나의 패널 안에 6개 view:
 *   1. FranchiseList (메인 목록)
 *   2. FranchiseDetail (KPI + 4 tabs: 매장/정책/스케줄/동기화)
 *   3. StoreManagement (탭)
 *   4. MusicPolicyBuilder (모달)
 *   5. ApplyPolicyModal (모달)
 *   6. SyncStatus (탭)
 *
 * UI 카피: "즉시 반영" 금지, "자동 동기화" 사용.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, ArrowLeft, Settings, Store as StoreIcon, Activity,
  Wifi, WifiOff, Music, ChevronRight, X, Calendar, Send, Link as LinkIcon,
  Building2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  adminListFranchises,
  adminCreateFranchise,
  adminCreateRegion,
  adminLinkStore,
  adminUnlinkStore,
  adminUpsertPolicy,
  adminUpsertSlot,
  adminDeleteSlot,
  applyFranchisePolicy,
  getFranchiseDashboard,
  adminListSyncStatus,
  listFranchiseRegions,
  listFranchiseStores,
  listFranchisePolicies,
  listPolicySlots,
  type FranchiseListRow,
  type FranchiseDashboard,
  type FranchiseRegion,
  type FranchiseStore,
  type FranchiseMusicPolicy,
  type FranchiseMusicPolicySlot,
  type FranchiseSyncStatusRow,
  type PolicyTargetType,
} from '@/lib/api/franchiseApi';
import { fetchPlaylists } from '@/lib/api';
import {
  listAvailablePlaylistsForDeployment,
  createFranchiseMusicPolicyFromPlaylist,
  type AvailablePlaylistForDeployment,
} from '@/lib/api/policyDeploymentApi';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';

type View = 'list' | 'detail';
type DetailTab = 'stores' | 'policies' | 'schedule' | 'sync';

const DAY_KO = ['', '월', '화', '수', '목', '금', '토', '일'];

export interface FranchiseManagementPanelProps {
  /**
   * Phase 1-5.1 deep-link — 패널 mount 시 첫 franchise 자동 선택 + 지정 detail 탭으로 진입.
   * (정책 적용률 → "프랜차이즈 관리로 이동" 플로우용)
   */
  initialDetailTab?: DetailTab;
  /** deep-link 사용 후 AdminPage 가 state 를 clear 하도록 통지 */
  onConsumedDeepLink?: () => void;
  /**
   * 새 정책 생성 성공 시 호출 — AdminPage 가 정책 적용률 탭으로 자동 복귀.
   * 미전달 시 일반 저장 동작 (현재 모달 유지).
   */
  onPolicyCreatedReturn?: () => void;
}

export default function FranchiseManagementPanel({
  initialDetailTab,
  onConsumedDeepLink,
  onPolicyCreatedReturn,
}: FranchiseManagementPanelProps = {}) {
  const [view, setView] = useState<View>('list');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoJumpAttempted, setAutoJumpAttempted] = useState(false);

  // Phase 1-5.1 — deep-link 첫 자동 진입 (1회만)
  useEffect(() => {
    if (autoJumpAttempted) return;
    if (!initialDetailTab) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await adminListFranchises();
        if (cancelled) return;
        if (rows.length > 0) {
          setActiveId(rows[0].id);
          setView('detail');
        } else {
          toast.info('등록된 프랜차이즈가 없습니다. 먼저 프랜차이즈를 생성하세요.');
        }
      } catch (e) {
        toast.error(`프랜차이즈 목록 로딩 실패: ${(e as Error).message}`);
      } finally {
        setAutoJumpAttempted(true);
        onConsumedDeepLink?.();
      }
    })();
    return () => { cancelled = true; };
  }, [autoJumpAttempted, initialDetailTab, onConsumedDeepLink]);

  if (view === 'detail' && activeId) {
    return (
      <FranchiseDetail
        franchiseId={activeId}
        initialTab={initialDetailTab}
        onBack={() => { setView('list'); setActiveId(null); }}
        onPolicyCreatedReturn={onPolicyCreatedReturn}
      />
    );
  }
  return (
    <FranchiseListView
      onOpen={(id) => { setActiveId(id); setView('detail'); }}
    />
  );
}

// =============================================================================
// View 1: 프랜차이즈 목록
// =============================================================================

function FranchiseListView({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<FranchiseListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminListFranchises());
    } catch (e) {
      toast.error(`프랜차이즈 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <StoreIcon size={14} /> 프랜차이즈 관리
            <span className="text-[10px] font-normal text-ink-dim">(X6.89 B2B)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90">
              <Plus size={11} /> 새 프랜차이즈
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          하나의 대시보드로 모든 매장을 관리합니다. 본사에서 설정한 음악 정책이
          연결된 매장에 자동 동기화됩니다.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <th className="px-3 py-2">프랜차이즈</th>
              <th className="px-3 py-2 text-right">전체 매장</th>
              <th className="px-3 py-2 text-right">온라인</th>
              <th className="px-3 py-2 text-right">활성 정책</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2 text-right">생성일</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-dim">로딩 중…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-dim">등록된 프랜차이즈가 없습니다.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                <td className="px-3 py-2">
                  <div className="font-semibold">{r.name}</div>
                  {r.slug && <div className="text-[10px] text-ink-dim">{r.slug}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.store_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="text-emerald-300">{r.online_store_count}</span>
                  <span className="text-ink-dim"> / {r.store_count}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.active_policy_count}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-mute">
                  {new Date(r.created_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => onOpen(r.id)}
                    className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-1 font-bold text-accent">
                    상세 <ChevronRight size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateFranchiseModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />
      )}
    </div>
  );
}

// =============================================================================
// View 2: 프랜차이즈 상세 (KPI + 4 tabs)
// =============================================================================

// Phase 1-6 — 이 franchise 가 어떤 enterprise_account 와 연결됐는지 표시용
interface FranchiseEnterpriseLink {
  enterprise_account_id: string;
  role: 'primary' | 'secondary';
  enterprise_name: string;
  brand_code: string | null;
}

function FranchiseDetail({
  franchiseId, onBack, initialTab, onPolicyCreatedReturn,
}: {
  franchiseId: string;
  onBack: () => void;
  initialTab?: DetailTab;
  onPolicyCreatedReturn?: () => void;
}) {
  const [dashboard, setDashboard] = useState<FranchiseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'stores');
  const [enterpriseLinks, setEnterpriseLinks] = useState<FranchiseEnterpriseLink[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await getFranchiseDashboard(franchiseId));
    } catch (e) {
      toast.error(`상세 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  // Phase 1-6 — enterprise 연결 표시 (super_admin RLS 통과)
  const loadEnterpriseLinks = useCallback(async () => {
    try {
      type RowShape = {
        enterprise_account_id: string;
        role: 'primary' | 'secondary';
        enterprise_accounts: { enterprise_name: string; brand_code: string | null } | null;
      };
      const { data, error } = await supabase
        .from('enterprise_franchises')
        .select('enterprise_account_id, role, enterprise_accounts(enterprise_name, brand_code)')
        .eq('franchise_id', franchiseId)
        .is('deleted_at', null)
        .returns<RowShape[]>();
      if (error) {
        console.warn('[FranchiseManagementPanel] enterprise links load failed', error);
        setEnterpriseLinks([]);
        return;
      }
      setEnterpriseLinks(
        (data ?? []).map((r) => ({
          enterprise_account_id: r.enterprise_account_id,
          role: r.role,
          enterprise_name: r.enterprise_accounts?.enterprise_name ?? '(이름 없음)',
          brand_code: r.enterprise_accounts?.brand_code ?? null,
        })),
      );
    } catch (e) {
      console.warn('[FranchiseManagementPanel] enterprise links load error', e);
      setEnterpriseLinks([]);
    }
  }, [franchiseId]);

  useEffect(() => {
    void loadDashboard();
    void loadEnterpriseLinks();
  }, [loadDashboard, loadEnterpriseLinks]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack}
          className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover">
          <ArrowLeft size={11} /> 목록으로
        </button>
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <StoreIcon size={14} /> {dashboard?.franchise?.name ?? '프랜차이즈'}
        </h3>
        <button onClick={() => void loadDashboard()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* Phase 1-6 — enterprise 연결 표시 (수동 매장 연결 위주 UX 안내) */}
      <div className="rounded-xl bg-bg-card p-3 text-xs">
        {enterpriseLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-mute">연결된 본사:</span>
            {enterpriseLinks.map((l) => (
              <span key={l.enterprise_account_id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  l.role === 'primary'
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                    : 'bg-ink/10 text-ink-mute ring-1 ring-line/10'
                }`}
                title={l.role === 'primary' ? '매장 초대코드의 주 연결 대상' : '보조 연결'}
              >
                <Building2 size={10} /> {l.enterprise_name}
                {l.brand_code && <span className="font-mono opacity-70">· {l.brand_code}</span>}
                {l.role === 'primary' && <span className="opacity-75">primary</span>}
              </span>
            ))}
            <span className="ml-auto text-[10px] text-ink-dim">
              매장은 초대코드 회원가입으로 자동 연결됩니다. 아래 "매장 연결" 은 고급/수동 경로.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-ink-dim">
            <Building2 size={11} />
            <span>이 프랜차이즈는 아직 어떤 엔터프라이즈 본사와도 연결되지 않았습니다.</span>
            <span className="ml-auto text-[10px]">
              본사 계정 관리 탭에서 "첫 프랜차이즈" 로 매핑하거나 별도 매핑 RPC 사용.
            </span>
          </div>
        )}
      </div>

      {/* KPI */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <KpiCard label="전체 매장" value={`${dashboard.total_stores}곳`} icon={<StoreIcon size={12} />} />
          <KpiCard label="온라인" value={`${dashboard.online_stores}곳`}
            icon={<Wifi size={12} />} tone="text-emerald-300" />
          <KpiCard label="오프라인" value={`${dashboard.offline_stores}곳`}
            icon={<WifiOff size={12} />} tone={dashboard.offline_stores > 0 ? 'text-rose-300' : 'text-ink-mute'} />
          <KpiCard label="활성 정책" value={`${dashboard.active_policies.length}개`} icon={<Music size={12} />} />
          <KpiCard label="마지막 업데이트" value={new Date(dashboard.computed_at).toLocaleTimeString('ko-KR')}
            icon={<Activity size={12} />} tone="text-ink-mute" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-full bg-bg-card p-1 text-xs">
        {(['stores', 'policies', 'schedule', 'sync'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-3 py-1.5 font-semibold transition ${
              tab === t ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'
            }`}>
            {t === 'stores' && '매장'}
            {t === 'policies' && '배포 플레이리스트'}
            {t === 'schedule' && '스케줄'}
            {t === 'sync' && '동기화 상태'}
          </button>
        ))}
      </div>

      {tab === 'stores' && <StoreManagementTab franchiseId={franchiseId} onChanged={() => void loadDashboard()} />}
      {tab === 'policies' && (
        <PoliciesTab
          franchiseId={franchiseId}
          onApplied={() => void loadDashboard()}
          onPolicyCreatedReturn={onPolicyCreatedReturn}
        />
      )}
      {tab === 'schedule' && <ScheduleTab dashboard={dashboard} />}
      {tab === 'sync' && <SyncStatusTab franchiseId={franchiseId} />}
    </div>
  );
}

// =============================================================================
// Tab: 매장 관리
// =============================================================================

function StoreManagementTab({ franchiseId, onChanged }: { franchiseId: string; onChanged: () => void }) {
  const [stores, setStores] = useState<FranchiseStore[]>([]);
  const [regions, setRegions] = useState<FranchiseRegion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showRegion, setShowRegion] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        listFranchiseStores(franchiseId), listFranchiseRegions(franchiseId),
      ]);
      setStores(s); setRegions(r);
    } catch (e) {
      toast.error(`매장 로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [franchiseId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => stores.filter((s) =>
    (!regionFilter || s.region_id === regionFilter)
    && (!search || (s.store_name ?? '').toLowerCase().includes(search.toLowerCase()) || s.store_id.includes(search)),
  ), [stores, regionFilter, search]);

  const regionName = useCallback((id: string | null) =>
    id ? (regions.find((r) => r.id === id)?.name ?? '—') : '—', [regions]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 지역</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="text" placeholder="매장명 / ID 검색"
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1" />
        <span className="text-ink-dim">{filtered.length}곳</span>
        <button onClick={() => setShowRegion(true)}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover">
          <Plus size={11} /> 지역
        </button>
        <button onClick={() => setShowLink(true)}
          className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90">
          <LinkIcon size={11} /> 매장 연결
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <th className="px-3 py-2">매장명</th>
              <th className="px-3 py-2">지역</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2 text-right">store_id</th>
              <th className="px-3 py-2 text-right">연결일</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && stores.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-dim">로딩 중…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-dim">연결된 매장이 없습니다.</td></tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-line/5">
                <td className="px-3 py-2 font-semibold">{s.store_name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-mute">{regionName(s.region_id)}</td>
                <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-3 py-2 text-right text-[10px] text-ink-dim tabular-nums">{s.store_id.slice(0, 8)}…</td>
                <td className="px-3 py-2 text-right text-ink-mute tabular-nums">
                  {new Date(s.joined_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={async () => {
                    if (!confirm(`${s.store_name ?? s.store_id} 연결 해제?`)) return;
                    try { await adminUnlinkStore(franchiseId, s.store_id); toast.success('해제됨'); void load(); onChanged(); }
                    catch (e) { toast.error((e as Error).message); }
                  }} className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                    해제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showLink && (
        <LinkStoreModal franchiseId={franchiseId} regions={regions}
          onClose={() => setShowLink(false)}
          onLinked={() => { setShowLink(false); void load(); onChanged(); }} />
      )}
      {showRegion && (
        <CreateRegionModal franchiseId={franchiseId}
          onClose={() => setShowRegion(false)}
          onCreated={() => { setShowRegion(false); void load(); }} />
      )}
    </div>
  );
}

// =============================================================================
// Tab: 정책
// =============================================================================

function PoliciesTab({
  franchiseId, onApplied, onPolicyCreatedReturn,
}: {
  franchiseId: string;
  onApplied: () => void;
  onPolicyCreatedReturn?: () => void;
}) {
  const [policies, setPolicies] = useState<FranchiseMusicPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editPolicy, setEditPolicy] = useState<FranchiseMusicPolicy | null>(null);
  const [applyPolicy, setApplyPolicy] = useState<FranchiseMusicPolicy | null>(null);
  const [showFromPlaylist, setShowFromPlaylist] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPolicies(await listFranchisePolicies(franchiseId)); }
    catch (e) { toast.error(`배포 플레이리스트 로딩 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [franchiseId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span>등록된 배포 플레이리스트가 연결된 매장에 자동 동기화되며, 자동 음악 스케줄의 선택 목록으로 노출됩니다.</span>
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => setShowFromPlaylist(true)}
            className="inline-flex items-center gap-1 rounded bg-violet-500/20 px-2 py-1 font-bold text-violet-200 hover:bg-violet-500/30">
            <Music size={11} /> 기존 플레이리스트에서 등록
          </button>
          <button onClick={() => { setEditPolicy(null); setShowBuilder(true); }}
            className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90">
            <Plus size={11} /> 시간대 슬롯으로 직접 만들기
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <th className="px-3 py-2">배포 플레이리스트명</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">기본</th>
              <th className="px-3 py-2 text-right">유효기간</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && policies.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-dim">로딩 중…</td></tr>
            )}
            {!loading && policies.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-dim">
                등록된 배포 플레이리스트가 없습니다. "기존 플레이리스트에서 등록" 버튼으로 시작하세요.
              </td></tr>
            )}
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-line/5">
                <td className="px-3 py-2">
                  <div className="font-semibold">{p.name}</div>
                  {p.description && <div className="text-[10px] text-ink-dim">{p.description}</div>}
                </td>
                <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-3 py-2">{p.is_default ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-right text-[10px] text-ink-mute">
                  {p.effective_from ? new Date(p.effective_from).toLocaleDateString('ko-KR') : '—'}
                  {' ~ '}
                  {p.effective_until ? new Date(p.effective_until).toLocaleDateString('ko-KR') : '무기한'}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button onClick={() => { setEditPolicy(p); setShowBuilder(true); }}
                      className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                      편집
                    </button>
                    <button onClick={() => setApplyPolicy(p)}
                      disabled={p.status !== 'active'}
                      className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 disabled:opacity-30">
                      적용
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBuilder && (
        <MusicPolicyBuilderModal
          franchiseId={franchiseId} policy={editPolicy}
          onClose={() => { setShowBuilder(false); setEditPolicy(null); }}
          onSaved={() => { setShowBuilder(false); setEditPolicy(null); void load(); }}
          onFirstSaveReturn={
            // 신규 정책 (editPolicy=null) 작성 + AdminPage 가 복귀 요청한 상태에서만 활성화
            editPolicy === null ? onPolicyCreatedReturn : undefined
          }
        />
      )}
      {applyPolicy && (
        <ApplyPolicyModal
          franchiseId={franchiseId} policy={applyPolicy}
          onClose={() => setApplyPolicy(null)}
          onApplied={() => { setApplyPolicy(null); onApplied(); }}
        />
      )}
      {showFromPlaylist && (
        <RegisterFromPlaylistModal
          franchiseId={franchiseId}
          onClose={() => setShowFromPlaylist(false)}
          onRegistered={() => {
            setShowFromPlaylist(false);
            void load();
            onPolicyCreatedReturn?.();  // 자동 음악 스케줄 등에서 deep-link 복귀 trigger
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Tab: 스케줄 (현재 적용 이력)
// =============================================================================

function ScheduleTab({ dashboard }: { dashboard: FranchiseDashboard | null }) {
  if (!dashboard) return <div className="rounded-xl bg-bg-card p-6 text-center text-ink-dim">로딩 중…</div>;
  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-bg-card p-3 text-xs text-ink-dim">
        모든 변경사항은 다음 재생 시점부터 안정적으로 반영됩니다.
      </div>
      <div className="overflow-x-auto rounded-xl bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <th className="px-3 py-2">적용 시각</th>
              <th className="px-3 py-2">정책</th>
              <th className="px-3 py-2">대상</th>
              <th className="px-3 py-2">대상 ID</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.recent_assignments.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-dim">정책 적용 이력 없음</td></tr>
            )}
            {dashboard.recent_assignments.map((a) => (
              <tr key={a.id} className="border-b border-line/5">
                <td className="px-3 py-2 text-ink-mute tabular-nums">
                  {new Date(a.applied_at).toLocaleString('ko-KR')}
                </td>
                <td className="px-3 py-2 font-semibold">{a.policy_name ?? '—'}</td>
                <td className="px-3 py-2">
                  {a.target_type === 'all' && '전체 매장'}
                  {a.target_type === 'region' && '특정 지역'}
                  {a.target_type === 'store' && '특정 매장'}
                </td>
                <td className="px-3 py-2 text-[10px] text-ink-dim">
                  {a.target_id?.slice(0, 12) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// Tab: 동기화 상태
// =============================================================================

function SyncStatusTab({ franchiseId }: { franchiseId: string }) {
  const [rows, setRows] = useState<FranchiseSyncStatusRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminListSyncStatus(franchiseId)); }
    catch (e) { toast.error(`동기화 상태 로딩 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [franchiseId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-xl bg-bg-card p-3 text-xs">
        <span className="text-ink-dim">3분 이상 응답 없으면 오프라인으로 표시됩니다. 30초마다 자동 갱신.</span>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <th className="px-3 py-2">매장</th>
              <th className="px-3 py-2">지역</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">정책 / 버전</th>
              <th className="px-3 py-2">현재 재생곡</th>
              <th className="px-3 py-2 text-right">마지막 접속</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-dim">데이터 없음</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.store_id} className={`border-b border-line/5 ${r.is_offline ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2 font-semibold">{r.store_name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-mute">{r.region_name ?? '—'}</td>
                <td className="px-3 py-2">
                  <PlayerStatusBadge status={r.player_status} isOffline={r.is_offline} />
                </td>
                <td className="px-3 py-2 text-ink-mute">
                  {r.active_policy_name ?? '—'}
                  {r.active_policy_name && <span className="text-[10px] text-ink-dim"> v{r.active_version_number}</span>}
                </td>
                <td className="px-3 py-2 text-ink-mute truncate max-w-[180px]">{r.current_track_title ?? '—'}</td>
                <td className="px-3 py-2 text-right text-[10px] text-ink-dim tabular-nums">
                  {r.last_seen_at ? new Date(r.last_seen_at).toLocaleTimeString('ko-KR') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// Modals
// =============================================================================

function CreateFranchiseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell title="새 프랜차이즈" onClose={onClose}>
      <div className="space-y-3">
        <Field label="이름"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <Field label="slug (선택)"><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="cookoo, starbucks ..." className="input" /></Field>
        <Field label="설명 (선택)"><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-[60px]" /></Field>
        <button disabled={!name || saving}
          onClick={async () => {
            setSaving(true);
            try { await adminCreateFranchise(name.trim(), slug.trim() || null, description.trim() || null); toast.success('생성됨'); onCreated(); }
            catch (e) { toast.error((e as Error).message); }
            finally { setSaving(false); }
          }}
          className="w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
          {saving ? '저장 중…' : '생성'}
        </button>
      </div>
    </ModalShell>
  );
}

function CreateRegionModal({ franchiseId, onClose, onCreated }: { franchiseId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell title="지역 추가" onClose={onClose}>
      <div className="space-y-3">
        <Field label="지역명"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="서울권, 부산권 ..." className="input" /></Field>
        <Field label="정렬 순서"><input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="input" /></Field>
        <button disabled={!name || saving}
          onClick={async () => {
            setSaving(true);
            try { await adminCreateRegion(franchiseId, name.trim(), sortOrder); toast.success('생성됨'); onCreated(); }
            catch (e) { toast.error((e as Error).message); }
            finally { setSaving(false); }
          }}
          className="w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
          {saving ? '저장 중…' : '생성'}
        </button>
      </div>
    </ModalShell>
  );
}

function LinkStoreModal({
  franchiseId, regions, onClose, onLinked,
}: { franchiseId: string; regions: FranchiseRegion[]; onClose: () => void; onLinked: () => void }) {
  const [storeId, setStoreId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [storeName, setStoreName] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell title="매장 연결" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[11px] text-ink-dim">
          매장 user.id (UUID) 를 입력하세요. business 플랜 사용자만 연결할 수 있습니다.
        </p>
        <Field label="store_id (UUID)">
          <input value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="00000000-0000-0000-0000-..." className="input font-mono text-[11px]" />
        </Field>
        <Field label="매장 표시명 (선택)">
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className="input" />
        </Field>
        <Field label="지역">
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="input">
            <option value="">미지정</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <button disabled={!storeId || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await adminLinkStore(franchiseId, storeId.trim(), regionId || null, storeName.trim() || null);
              toast.success('연결됨'); onLinked();
            } catch (e) { toast.error((e as Error).message); }
            finally { setSaving(false); }
          }}
          className="w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
          {saving ? '저장 중…' : '연결'}
        </button>
      </div>
    </ModalShell>
  );
}

function ApplyPolicyModal({
  franchiseId, policy, onClose, onApplied,
}: { franchiseId: string; policy: FranchiseMusicPolicy; onClose: () => void; onApplied: () => void }) {
  const [targetType, setTargetType] = useState<PolicyTargetType>('all');
  const [targetId, setTargetId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [regions, setRegions] = useState<FranchiseRegion[]>([]);
  const [stores, setStores] = useState<FranchiseStore[]>([]);

  useEffect(() => {
    void Promise.all([
      listFranchiseRegions(franchiseId).then(setRegions),
      listFranchiseStores(franchiseId).then(setStores),
    ]).catch((e) => toast.error((e as Error).message));
  }, [franchiseId]);

  return (
    <ModalShell title={`정책 적용: ${policy.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[11px] text-ink-dim">
          본사에서 설정한 음악 정책이 연결된 매장에 자동 동기화됩니다.
          매장 플레이어는 다음 재생 시점부터 안정적으로 새 정책을 적용합니다.
        </p>
        <Field label="적용 대상">
          <select value={targetType} onChange={(e) => { setTargetType(e.target.value as PolicyTargetType); setTargetId(''); }}
            className="input">
            <option value="all">전체 매장</option>
            <option value="region">특정 지역</option>
            <option value="store">특정 매장</option>
          </select>
        </Field>
        {targetType === 'region' && (
          <Field label="지역">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input">
              <option value="">선택…</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        )}
        {targetType === 'store' && (
          <Field label="매장">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input">
              <option value="">선택…</option>
              {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.store_name ?? s.store_id.slice(0, 8)}</option>)}
            </select>
          </Field>
        )}
        <Field label="예약 적용 (선택)">
          <input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input" />
        </Field>
        <button disabled={saving || (targetType !== 'all' && !targetId)}
          onClick={async () => {
            setSaving(true);
            try {
              const result = await applyFranchisePolicy({
                franchiseId, policyId: policy.id, targetType,
                targetId: targetType === 'all' ? null : targetId,
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
              });
              toast.success(`${result.applied_store_count}곳에 적용됨 (v${result.version_number})`);
              onApplied();
            } catch (e) { toast.error((e as Error).message); }
            finally { setSaving(false); }
          }}
          className="w-full inline-flex items-center justify-center gap-1 rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
          <Send size={12} /> {saving ? '적용 중…' : effectiveFrom ? '예약 적용' : '즉시 적용'}
        </button>
      </div>
    </ModalShell>
  );
}

function MusicPolicyBuilderModal({
  franchiseId, policy, onClose, onSaved, onFirstSaveReturn,
}: {
  franchiseId: string;
  policy: FranchiseMusicPolicy | null;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Phase 1-5.1 — 신규 정책 첫 저장 성공 시 호출.
   * 제공되면: toast 표시 + 2s 후 자동으로 모달 닫고 호출 (AdminPage 가 정책 적용률로 복귀).
   * 미제공: 기존 동작 (모달 유지 → 사용자가 슬롯 편집 가능).
   */
  onFirstSaveReturn?: () => void;
}) {
  // onSaved 는 사용자가 모달 닫을 때 부모 목록 새로고침 트리거 — 닫기 버튼에 바인딩
  const handleClose = () => { onSaved(); onClose(); };
  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [status, setStatus] = useState(policy?.status ?? 'draft');
  const [isDefault, setIsDefault] = useState(policy?.is_default ?? false);
  const [effectiveFrom, setEffectiveFrom] = useState(policy?.effective_from?.slice(0, 16) ?? '');
  const [effectiveUntil, setEffectiveUntil] = useState(policy?.effective_until?.slice(0, 16) ?? '');
  const [saving, setSaving] = useState(false);
  const [policyId, setPolicyId] = useState<string | null>(policy?.id ?? null);
  const [slots, setSlots] = useState<FranchiseMusicPolicySlot[]>([]);
  const [allPlaylists, setAllPlaylists] = useState<PlaylistRow[]>([]);

  const loadSlots = useCallback(async () => {
    if (!policyId) return;
    try { setSlots(await listPolicySlots(policyId)); }
    catch (e) { toast.error((e as Error).message); }
  }, [policyId]);

  useEffect(() => {
    void loadSlots();
    void fetchPlaylists().then(setAllPlaylists).catch((e) => toast.error((e as Error).message));
  }, [loadSlots]);

  const savePolicy = async () => {
    setSaving(true);
    try {
      const wasNew = policyId == null;
      const saved = await adminUpsertPolicy({
        franchiseId, name: name.trim(), description: description.trim() || null,
        status: status as 'draft' | 'active' | 'archived',
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
        effectiveUntil: effectiveUntil ? new Date(effectiveUntil).toISOString() : null,
        isDefault, policyId,
      });
      setPolicyId(saved.id);

      if (wasNew && onFirstSaveReturn) {
        // Phase 1-5.1 — deep-link 진입 시: 자동 복귀 모드
        toast.success('정책이 생성되었습니다. 잠시 후 정책 배포 화면으로 이동합니다.');
        window.setTimeout(() => {
          onSaved();
          onClose();
          onFirstSaveReturn();
        }, 2000);
      } else {
        toast.success('정책 저장됨');
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={policy ? '정책 편집' : '새 정책'} onClose={handleClose} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-xs font-bold flex items-center gap-1"><Settings size={12} /> 기본 정보</h4>
          <Field label="정책명"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
          <Field label="설명"><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-[60px]" /></Field>
          <Field label="상태">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="input">
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label="기본 정책">
            <label className="flex items-center gap-2"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> 본사 기본 정책으로 사용</label>
          </Field>
          <Field label="유효 시작 (선택)"><input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input" /></Field>
          <Field label="유효 종료 (선택)"><input type="datetime-local" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className="input" /></Field>
          <button onClick={() => void savePolicy()} disabled={!name || saving}
            className="w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
            {saving ? '저장 중…' : '정책 저장'}
          </button>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-bold flex items-center gap-1"><Calendar size={12} /> 시간대별 슬롯</h4>
          {!policyId && <p className="text-[11px] text-ink-dim">먼저 정책을 저장하면 슬롯을 추가할 수 있습니다.</p>}
          {policyId && (
            <>
              <SlotsEditor policyId={policyId} slots={slots} playlists={allPlaylists}
                onChanged={() => void loadSlots()} />
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function SlotsEditor({
  policyId, slots, playlists, onChanged,
}: { policyId: string; slots: FranchiseMusicPolicySlot[]; playlists: PlaylistRow[]; onChanged: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const playlistTitle = (id: string) => playlists.find((p) => p.id === id)?.title ?? id.slice(0, 8);
  return (
    <div className="space-y-2">
      {slots.length === 0 && <p className="text-[11px] text-ink-dim">슬롯 없음</p>}
      <div className="space-y-1">
        {slots.map((s) => (
          <div key={s.id} className="rounded bg-bg-deep px-2 py-1.5 text-[11px] flex items-center gap-2">
            <span className="font-bold">{s.slot_name}</span>
            <span className="text-ink-mute">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
            <span className="text-ink-mute">{s.days_of_week.map((d) => DAY_KO[d]).join('')}</span>
            <span className="flex-1 text-emerald-300 truncate">{playlistTitle(s.playlist_id)}</span>
            <button onClick={async () => {
              if (!confirm('슬롯 삭제?')) return;
              try { await adminDeleteSlot(s.id); toast.success('삭제'); onChanged(); }
              catch (e) { toast.error((e as Error).message); }
            }} className="text-rose-300 hover:underline">삭제</button>
          </div>
        ))}
      </div>
      {!showAdd && (
        <button onClick={() => setShowAdd(true)}
          className="w-full rounded bg-bg-deep px-2 py-1.5 text-[11px] hover:bg-bg-hover">
          <Plus size={11} className="inline mr-1" /> 슬롯 추가
        </button>
      )}
      {showAdd && (
        <AddSlotInline policyId={policyId} playlists={playlists}
          onCancel={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); onChanged(); }} />
      )}
    </div>
  );
}

function AddSlotInline({
  policyId, playlists, onCancel, onSaved,
}: { policyId: string; playlists: PlaylistRow[]; onCancel: () => void; onSaved: () => void }) {
  const [slotName, setSlotName] = useState('morning');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [playlistId, setPlaylistId] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2 rounded bg-bg-deep p-2 text-[11px]">
      <div className="grid grid-cols-2 gap-2">
        <select value={slotName} onChange={(e) => setSlotName(e.target.value)} className="input text-[11px]">
          {['morning', 'lunch', 'afternoon', 'dinner', 'closing', 'weekend', 'event'].map((s) =>
            <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className="input text-[11px]">
          <option value="">플레이리스트 선택…</option>
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input text-[11px]" />
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input text-[11px]" />
      </div>
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button key={d} type="button"
            onClick={() => setDays((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort())}
            className={`rounded px-2 py-0.5 ${days.includes(d) ? 'bg-accent text-black font-bold' : 'bg-bg-card text-ink-mute'}`}>
            {DAY_KO[d]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="rounded bg-bg-card px-2 py-1 text-ink-mute">취소</button>
        <button disabled={!playlistId || saving} onClick={async () => {
          setSaving(true);
          try {
            await adminUpsertSlot({ policyId, slotName, startTime, endTime, playlistId, daysOfWeek: days });
            toast.success('슬롯 추가'); onSaved();
          } catch (e) { toast.error((e as Error).message); }
          finally { setSaving(false); }
        }}
          className="flex-1 rounded bg-accent px-2 py-1 font-bold text-black disabled:opacity-50">
          {saving ? '…' : '저장'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Shared sub-components
// =============================================================================

function KpiCard({ label, value, icon, tone = 'text-ink' }: { label: string; value: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">{icon}{label}</div>
      <div className={`mt-1 text-lg font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-emerald-500/25 text-emerald-300'
    : status === 'inactive' ? 'bg-amber-500/25 text-amber-300'
    : status === 'archived' ? 'bg-ink/15 text-ink-mute'
    : status === 'suspended' ? 'bg-rose-500/25 text-rose-300'
    : status === 'draft' ? 'bg-sky-500/25 text-sky-300'
    : 'bg-ink/15 text-ink-mute';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{status}</span>;
}

function PlayerStatusBadge({ status, isOffline }: { status: string; isOffline: boolean }) {
  if (isOffline) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-300"><WifiOff size={10} /> 오프라인</span>;
  const cls = status === 'playing' ? 'bg-emerald-500/25 text-emerald-300'
    : status === 'paused' ? 'bg-amber-500/25 text-amber-300'
    : 'bg-ink/15 text-ink-mute';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{status}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({ title, onClose, wide = false, children }: {
  title: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =============================================================================
// RegisterFromPlaylistModal (0379) — 기존 playlist 풀에서 배포 플레이리스트 등록
// =============================================================================

const SOURCE_TYPE_KO: Record<'manual' | 'curated' | 'auto' | 'business', string> = {
  manual:   '수동',
  curated:  '큐레이션',
  auto:     'AI/자동',
  business: '업종',
};

function RegisterFromPlaylistModal({
  franchiseId, onClose, onRegistered,
}: {
  franchiseId: string;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const [available, setAvailable] = useState<AvailablePlaylistForDeployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'manual' | 'curated' | 'auto' | 'business' | ''>('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<AvailablePlaylistForDeployment | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'draft'>('active');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listAvailablePlaylistsForDeployment({
        search: debounced || null,
        sourceType: sourceFilter || null,
        limit: 100,
      });
      setAvailable(r.data);
    } catch (e) {
      setError((e as Error).message);
      setAvailable([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, sourceFilter]);

  useEffect(() => { void load(); }, [load]);

  const onSubmit = async () => {
    if (!selected) { toast.error('플레이리스트를 선택하세요.'); return; }
    setBusy(true);
    try {
      const r = await createFranchiseMusicPolicyFromPlaylist({
        playlistId: selected.playlist_id,
        franchiseId,
        name: name.trim() || null,
        description: description.trim() || null,
        status,
        isDefault,
      });
      toast.success(`배포 플레이리스트 등록 완료 (source=${r.source_type}, ${r.track_count}곡)`);
      onRegistered();
    } catch (e) {
      toast.error(`등록 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="기존 플레이리스트에서 배포 플레이리스트 등록" onClose={onClose} wide>
      <p className="mb-3 text-[11px] text-ink-dim">
        AI·큐레이션·업종·수동 플레이리스트 중 하나를 골라 매장 배포용으로 등록합니다.
        등록 즉시 자동 음악 스케줄의 선택 목록에 노출됩니다 (00:00–23:59 단일 시간대 슬롯 자동 생성).
      </p>

      {/* search + filter */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="플레이리스트명 / 설명 / 업종 검색"
          className="flex-1 min-w-[200px] rounded-md bg-bg-deep px-2 py-1.5" />
        <select value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className="rounded-md bg-bg-deep px-2 py-1.5">
          <option value="">전체 source</option>
          <option value="auto">AI/자동</option>
          <option value="curated">큐레이션</option>
          <option value="business">업종</option>
          <option value="manual">수동</option>
        </select>
        <button onClick={() => void load()}
          className="rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* error */}
      {error && (
        <div className="mb-2 rounded bg-rose-500/20 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* list */}
      <div className="max-h-72 overflow-y-auto rounded-lg bg-bg-deep/40 ring-1 ring-line/10">
        {loading && available.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-ink-mute">불러오는 중…</div>
        ) : available.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-ink-mute">
            조건에 맞는 플레이리스트가 없습니다.
          </div>
        ) : (
          <ul className="divide-y divide-line/5">
            {available.map((p) => {
              const sel = selected?.playlist_id === p.playlist_id;
              return (
                <li key={p.playlist_id}>
                  <button type="button"
                    onClick={() => {
                      setSelected(p);
                      if (!name.trim()) setName(p.playlist_title);
                      if (!description.trim() && p.description) setDescription(p.description);
                    }}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-bg-hover ${
                      sel ? 'bg-violet-500/25 ring-1 ring-violet-400/30' : ''
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="rounded bg-bg-card px-1.5 py-0.5 text-[10px] font-bold text-ink-mute">
                          [{SOURCE_TYPE_KO[p.source_type]}]
                        </span>
                        <span className="truncate font-semibold text-ink">{p.playlist_title}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-mute">
                        {p.is_auto
                          ? <span>동적 매칭</span>
                          : <span>{p.track_count}곡</span>}
                        {p.business_category && <span>· {p.business_category}</span>}
                        {p.curator_name && <span>· @{p.curator_name}</span>}
                        {p.deployable_count > 0 && (
                          <span className="text-amber-300">이미 {p.deployable_count}개 배포에 사용 중</span>
                        )}
                      </div>
                      {p.description && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-ink-dim">{p.description}</p>
                      )}
                    </div>
                    {sel && (
                      <span className="shrink-0 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        선택됨
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* details */}
      {selected && (
        <div className="mt-3 grid gap-2 md:grid-cols-2 text-xs">
          <label className="block">
            <span className="text-ink-dim">배포 플레이리스트명</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={selected.playlist_title}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          </label>
          <label className="block">
            <span className="text-ink-dim">상태</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'draft')}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="active">활성 (즉시 사용 가능)</option>
              <option value="draft">초안</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-ink-dim">설명</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-mute md:col-span-2">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            본사 기본 배포 플레이리스트로 표시
          </label>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onClose}
          className="rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          취소
        </button>
        <button onClick={() => void onSubmit()}
          disabled={!selected || busy}
          className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-bold text-black hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40">
          <Plus size={11} /> 배포 플레이리스트 등록
        </button>
      </div>
    </ModalShell>
  );
}
