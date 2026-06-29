/**
 * EnterpriseEmergencyBroadcastPanel — Priority 7 (Emergency Broadcast V1).
 * SQL: supabase/migrations/0384_emergency_broadcast_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Megaphone, XCircle, CheckCircle2, Clock,
  AlertCircle, Send, ListChecks, AlertTriangle, Pause, Activity,
} from 'lucide-react';
import {
  AdminSection, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listEmergencyBroadcasts, getEmergencyBroadcastDetail, createEmergencyBroadcast,
  activateEmergencyBroadcast, cancelEmergencyBroadcast, completeEmergencyBroadcast,
  getEmergencyBroadcastKpi,
  type EmergencyBroadcast, type EmergencyBroadcastDetail, type EmergencyBroadcastStatus,
  type EmergencyBroadcastKpi, type EmergencyScopeType, type EmergencyInterruptMode,
} from '@/lib/api/emergencyBroadcastApi';
import {
  listAnnouncementAssets, type AnnouncementAsset,
} from '@/lib/api/announcementApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 50;

const STATUS_META: Record<EmergencyBroadcastStatus, { ko: string; tone: AdminToneName }> = {
  draft:     { ko: '준비',   tone: 'neutral' },
  active:    { ko: '송출 중', tone: 'danger'  },
  completed: { ko: '완료',   tone: 'success' },
  cancelled: { ko: '취소',   tone: 'neutral' },
  failed:    { ko: '실패',   tone: 'danger'  },
};

const SCOPE_KO: Record<EmergencyScopeType, string> = {
  all:        '전체 매장',
  enterprise: '본사',
  region:     '지역',
  store:      '특정 매장',
};

const INTERRUPT_KO: Record<EmergencyInterruptMode, string> = {
  fade_out:             'Fade-out 후 즉시 재생',
  pause:                '즉시 일시정지 후 재생',
  after_current_track:  '현재 곡 끝난 뒤 재생 (V1: 즉시)',
};

const fmtDt = (s: string | null | undefined) => s ? new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDuration = (sec: number | null | undefined) => {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function EnterpriseEmergencyBroadcastPanel() {
  const [list, setList] = useState<EmergencyBroadcast[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<EmergencyBroadcastKpi | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmergencyBroadcastStatus | ''>('');
  const [scopeFilter, setScopeFilter] = useState<EmergencyScopeType | ''>('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const [assets, setAssets] = useState<AnnouncementAsset[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<EmergencyBroadcastDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await listEmergencyBroadcasts({
        search: search.trim() || null,
        status: statusFilter || null,
        enterpriseAccountId: enterpriseFilter || null,
        scopeType: scopeFilter || null,
        activeOnly,
        limit: PAGE_SIZE, offset,
      });
      setList(r.data);
      setTotal(r.pagination.total);
    } catch (e) { setError((e as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, [search, statusFilter, enterpriseFilter, scopeFilter, activeOnly, offset]);

  const loadKpi = useCallback(async () => {
    try { setKpi(await getEmergencyBroadcastKpi()); } catch (e) { console.warn('[emergency] kpi failed', e); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadKpi(); }, [loadKpi]);

  useEffect(() => {
    void listAnnouncementAssets({ status: 'active', limit: 200 }).then((r) => setAssets(r.data))
      .catch((e) => console.warn('[emergency] assets load failed', e));
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[emergency] enterprises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data))
      .catch((e) => console.warn('[emergency] regions load failed', e));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([load(true), loadKpi()]); } finally { setRefreshing(false); }
  }, [load, loadKpi]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true); setDetailError(null);
    try { setDetail(await getEmergencyBroadcastDetail(id)); }
    catch (e) { setDetailError((e as Error).message); }
    finally { setDetailLoading(false); }
  }, []);
  const closeDetail = () => { setDetail(null); setDetailError(null); };

  const onActivate = useCallback(async (b: EmergencyBroadcast) => {
    if (!window.confirm(`"${b.title}" 긴급 방송을 활성화하시겠습니까?\n\n대상 ${b.target_store_count}개 매장에 5초 내로 송출됩니다.`)) return;
    setBusy(`a:${b.id}`);
    try {
      await activateEmergencyBroadcast(b.id);
      setToast({ tone: 'success', title: '긴급 방송 활성화됨', body: `${b.title} — 매장 plays 시작` });
      await Promise.all([load(true), loadKpi()]);
    } catch (e) { setToast({ tone: 'danger', title: '활성화 실패', body: (e as Error).message }); }
    finally { setBusy(null); }
  }, [load, loadKpi]);

  const onCancel = useCallback(async (b: EmergencyBroadcast) => {
    const memo = window.prompt(`"${b.title}" 긴급 방송을 취소합니다.\n취소 사유 (선택):`);
    if (memo === null) return;  // 사용자가 prompt 자체를 cancel
    setBusy(`c:${b.id}`);
    try {
      await cancelEmergencyBroadcast(b.id, memo || null);
      setToast({ tone: 'warning', title: '긴급 방송 취소됨', body: b.title });
      await Promise.all([load(true), loadKpi(), detail ? openDetail(b.id) : Promise.resolve()]);
    } catch (e) { setToast({ tone: 'danger', title: '취소 실패', body: (e as Error).message }); }
    finally { setBusy(null); }
  }, [load, loadKpi, detail, openDetail]);

  const onComplete = useCallback(async (b: EmergencyBroadcast) => {
    if (!window.confirm(`"${b.title}" 방송을 완료 처리하시겠습니까?\n남은 대기 매장은 expired 처리됩니다.`)) return;
    setBusy(`x:${b.id}`);
    try {
      await completeEmergencyBroadcast(b.id);
      setToast({ tone: 'success', title: '방송 완료 처리됨', body: b.title });
      await Promise.all([load(true), loadKpi(), detail ? openDetail(b.id) : Promise.resolve()]);
    } catch (e) { setToast({ tone: 'danger', title: '완료 처리 실패', body: (e as Error).message }); }
    finally { setBusy(null); }
  }, [load, loadKpi, detail, openDetail]);

  const playedRate = useMemo(() => {
    if (!detail) return 0;
    const tot = detail.summary.total;
    if (tot <= 0) return 0;
    return Math.round((detail.summary.played / tot) * 100);
  }, [detail]);

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Megaphone size={16} /> 긴급 방송</span>}
      description="안내/광고 음원을 선택해 특정 매장에 즉시 송출합니다. 매장 플레이어는 5초 내 감지하여 BGM을 일시정지하고 방송을 재생합니다."
      badge={<AdminBadge tone="danger" variant="subtle">Priority 7 · V1</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>새로고침</AdminButton>
          <AdminButton tone="danger" size="sm" leftIcon={<Plus size={12} />}
            disabled={assets.length === 0}
            title={assets.length === 0 ? '먼저 안내/광고 음원을 업로드하세요' : undefined}
            onClick={() => setShowCreate(true)}>긴급 방송 생성</AdminButton>
        </div>
      }
    >
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="현재 활성 방송"  value={kpi?.active_broadcasts ?? '—'}     tone="danger"  icon={<Megaphone size={14} />} />
        <AdminStatCard label="오늘 완료"      value={kpi?.completed_today ?? '—'}      tone="success" icon={<CheckCircle2 size={14} />} />
        <AdminStatCard label="대기 매장"      value={kpi?.pending_targets ?? '—'}      tone="warning" icon={<Clock size={14} />} />
        <AdminStatCard label="오늘 재생 완료" value={kpi?.played_targets_today ?? '—'} tone="info"    icon={<Activity size={14} />} />
        <AdminStatCard label="오늘 실패"      value={kpi?.failed_targets_today ?? '—'} tone="danger"  icon={<AlertCircle size={14} />} />
        <AdminStatCard label="취소"          value={kpi?.cancelled_broadcasts ?? '—'} tone="neutral" icon={<XCircle size={14} />} />
      </div>

      {/* Filters */}
      <AdminSearch
        value={search} onChange={(v) => { setSearch(v); setOffset(0); }}
        placeholder="제목 / 메시지 / 음원 / 본사 검색"
        filters={
          <>
            <select value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as EmergencyBroadcastStatus | ''); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {(Object.keys(STATUS_META) as EmergencyBroadcastStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].ko}</option>
              ))}
            </select>
            <select value={scopeFilter}
              onChange={(e) => { setScopeFilter(e.target.value as EmergencyScopeType | ''); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 범위</option>
              {(Object.keys(SCOPE_KO) as EmergencyScopeType[]).map((s) => (
                <option key={s} value={s}>{SCOPE_KO[s]}</option>
              ))}
            </select>
            <select value={enterpriseFilter}
              onChange={(e) => { setEnterpriseFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
              <input type="checkbox" checked={activeOnly}
                onChange={(e) => { setActiveOnly(e.target.checked); setOffset(0); }} />
              송출 중만
            </label>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}건</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      )}

      {loading && list.length === 0 ? (
        <AdminSkeleton variant="table" rows={5} />
      ) : !loading && list.length === 0 && !error ? (
        <AdminEmpty icon={<Megaphone size={28} />}
          title="아직 긴급 방송이 없습니다."
          description="안내/광고 음원을 선택해 즉시 매장에 송출할 수 있습니다." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">제목 / 음원</th>
                  <th className="px-3 py-2">범위</th>
                  <th className="px-3 py-2 text-right">우선순위</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">대상</th>
                  <th className="px-3 py-2 text-right">재생</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2 text-right">만료</th>
                  <th className="px-3 py-2 text-right">생성</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} className="cursor-pointer border-b border-line/5 hover:bg-bg-hover/30"
                    onClick={() => void openDetail(b.id)}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{b.title}</div>
                      <div className="text-[10px] text-ink-mute">{b.asset_title} · {fmtDuration(b.asset_duration)}</div>
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <div>{SCOPE_KO[b.scope_type]}</div>
                      {b.scope_type === 'region' && b.region_name && (
                        <div className="text-[10px] text-ink-mute">{b.region_name} ({b.region_code})</div>
                      )}
                      {b.scope_type === 'enterprise' && b.enterprise_name && (
                        <div className="text-[10px] text-ink-mute">{b.enterprise_name}</div>
                      )}
                      {b.scope_type === 'store' && (
                        <div className="text-[10px] text-ink-mute">{b.scope_store_ids?.length ?? 0}개 매장</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.priority}</td>
                    <td className="px-3 py-2"><AdminBadge tone={STATUS_META[b.status].tone}>{STATUS_META[b.status].ko}</AdminBadge></td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.target_store_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{b.played_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-300">{b.failed_count}</td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDt(b.expires_at)}</td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDt(b.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {b.status === 'draft' && (
                          <AdminTooltip label="활성화">
                            <AdminButton tone="danger" variant="solid" size="sm" leftIcon={<Send size={11} />}
                              loading={busy === `a:${b.id}`}
                              onClick={(e) => { e.stopPropagation(); void onActivate(b); }}>송출</AdminButton>
                          </AdminTooltip>
                        )}
                        {b.status === 'active' && (
                          <AdminTooltip label="완료 처리">
                            <AdminButton tone="success" variant="ghost" size="sm" leftIcon={<CheckCircle2 size={11} />}
                              loading={busy === `x:${b.id}`}
                              onClick={(e) => { e.stopPropagation(); void onComplete(b); }}>—</AdminButton>
                          </AdminTooltip>
                        )}
                        {(b.status === 'draft' || b.status === 'active') && (
                          <AdminTooltip label="취소">
                            <AdminButton tone="warning" variant="ghost" size="sm" leftIcon={<Pause size={11} />}
                              loading={busy === `c:${b.id}`}
                              onClick={(e) => { e.stopPropagation(); void onCancel(b); }}>—</AdminButton>
                          </AdminTooltip>
                        )}
                        <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<ListChecks size={11} />}
                          onClick={(e) => { e.stopPropagation(); void openDetail(b.id); }}>상세</AdminButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
              <AdminButton tone="neutral" variant="subtle" size="sm"
                disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>이전</AdminButton>
              <span className="text-ink-mute tabular-nums">{offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString()}</span>
              <AdminButton tone="neutral" variant="subtle" size="sm"
                disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>다음</AdminButton>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone={toast.tone} title={toast.title} description={toast.body} />
        </div>
      )}

      {showCreate && (
        <CreateBroadcastModal
          assets={assets}
          enterprises={enterprises}
          regions={regions}
          onClose={() => setShowCreate(false)}
          onCreated={async (msg) => {
            setShowCreate(false);
            setToast({ tone: 'success', title: '긴급 방송 draft 생성됨', body: msg });
            await Promise.all([load(true), loadKpi()]);
          }}
        />
      )}

      {(detail || detailLoading || detailError) && (
        <BroadcastDetailModal
          detail={detail} loading={detailLoading} error={detailError}
          playedRate={playedRate}
          busy={busy}
          onClose={closeDetail}
          onActivate={() => detail && void onActivate(detail.broadcast)}
          onCancel={() => detail && void onCancel(detail.broadcast)}
          onComplete={() => detail && void onComplete(detail.broadcast)}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// CreateBroadcastModal
// =============================================================================

function CreateBroadcastModal({
  assets, enterprises, regions, onClose, onCreated,
}: {
  assets: AnnouncementAsset[];
  enterprises: EnterpriseAccount[];
  regions: EnterpriseRegion[];
  onClose: () => void;
  onCreated: (msg: string) => void | Promise<void>;
}) {
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scopeType, setScopeType] = useState<EmergencyScopeType>('enterprise');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [storeIdsCsv, setStoreIdsCsv] = useState('');
  const [priority, setPriority] = useState(100);
  const [interruptMode, setInterruptMode] = useState<EmergencyInterruptMode>('fade_out');
  const [expiresAt, setExpiresAt] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!assetId) { setErr('음원을 선택해 주세요.'); return; }
    if (!title.trim()) { setErr('제목을 입력해 주세요.'); return; }
    if (scopeType === 'enterprise' && !enterpriseId) { setErr('본사 범위는 본사를 선택해 주세요.'); return; }
    if (scopeType === 'region' && !regionId) { setErr('지역 범위는 지역을 선택해 주세요.'); return; }
    const storeIds = scopeType === 'store'
      ? storeIdsCsv.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (scopeType === 'store' && (!storeIds || storeIds.length === 0)) {
      setErr('매장 범위는 매장 ID를 1개 이상 입력해 주세요.'); return;
    }
    setBusy(true);
    try {
      const r = await createEmergencyBroadcast({
        assetId, title, scopeType, message: message || null,
        enterpriseAccountId: scopeType === 'enterprise' ? enterpriseId : null,
        regionId: scopeType === 'region' ? regionId : null,
        scopeStoreIds: storeIds,
        priority, interruptMode,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        memo: memo || null,
      });
      await onCreated(`대상 ${r.target_store_count}개 매장 (draft)`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2"><Megaphone size={14} /> 긴급 방송 생성 (draft)</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="danger" size="sm" loading={busy} onClick={() => void onSubmit()}>draft 생성</AdminButton>
        </>
      }>
      <div className="grid gap-3 md:grid-cols-2 text-xs">
        <AdminAlert tone="warning" title="안내"
          description="draft 로 생성 후 목록에서 '송출' 버튼으로 활성화해야 매장에 송출됩니다. 활성화 후 5초 내 매장 플레이어가 감지합니다." />

        <Field label="음원 *" full>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="">음원을 선택하세요</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.title} ({fmtDuration(a.duration_seconds)})</option>
            ))}
          </select>
        </Field>

        <Field label="제목 *">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 화재 대피 안내 / 신메뉴 공지"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="우선순위 (1~999)">
          <input type="number" min={1} max={999} value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value || '100', 10))}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="메시지 (선택)" full>
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="화면 띠에 표시될 짧은 안내"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="범위 *">
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as EmergencyScopeType)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            {(Object.keys(SCOPE_KO) as EmergencyScopeType[]).map((s) => (
              <option key={s} value={s}>{SCOPE_KO[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Interrupt 방식">
          <select value={interruptMode} onChange={(e) => setInterruptMode(e.target.value as EmergencyInterruptMode)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            {(Object.keys(INTERRUPT_KO) as EmergencyInterruptMode[]).map((m) => (
              <option key={m} value={m}>{INTERRUPT_KO[m]}</option>
            ))}
          </select>
        </Field>

        {scopeType === 'enterprise' && (
          <Field label="본사 *" full>
            <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="">본사를 선택하세요</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
          </Field>
        )}
        {scopeType === 'region' && (
          <Field label="지역 *" full>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="">지역을 선택하세요</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
          </Field>
        )}
        {scopeType === 'store' && (
          <Field label="매장 ID 목록 (쉼표 구분) *" full>
            <textarea rows={2} value={storeIdsCsv} onChange={(e) => setStoreIdsCsv(e.target.value)}
              placeholder="매장 ID 를 쉼표로 구분"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
          </Field>
        )}

        <Field label="만료 시간 (선택)">
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
          <p className="mt-0.5 text-[10px] text-ink-dim">만료 후 대기 매장은 자동 expired 처리됩니다.</p>
        </Field>
        <Field label="메모 (관리 노트)">
          <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
      </div>

      {err && <div className="mt-3"><AdminAlert tone="danger" title="저장 실패" description={err} /></div>}
    </AdminModal>
  );
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-xs ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-ink-dim">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

// =============================================================================
// BroadcastDetailModal
// =============================================================================

function BroadcastDetailModal({
  detail, loading, error, playedRate, busy,
  onClose, onActivate, onCancel, onComplete,
}: {
  detail: EmergencyBroadcastDetail | null;
  loading: boolean;
  error: string | null;
  playedRate: number;
  busy: string | null;
  onClose: () => void;
  onActivate: () => void;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const b = detail?.broadcast;
  const a = detail?.asset;
  const isBusy = busy != null && b != null && busy.endsWith(b.id);

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2"><Megaphone size={14} /> {b?.title ?? '긴급 방송 상세'}</span>}
      headerExtra={b && <AdminBadge tone={STATUS_META[b.status].tone}>{STATUS_META[b.status].ko}</AdminBadge>}
      footer={
        b ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {b.status === 'draft' && (
              <AdminButton tone="danger" size="sm" leftIcon={<Send size={11} />} loading={isBusy}
                onClick={onActivate}>송출 (활성화)</AdminButton>
            )}
            {b.status === 'active' && (
              <AdminButton tone="success" variant="subtle" size="sm" leftIcon={<CheckCircle2 size={11} />}
                loading={isBusy} onClick={onComplete}>완료 처리</AdminButton>
            )}
            {(b.status === 'draft' || b.status === 'active') && (
              <AdminButton tone="warning" variant="subtle" size="sm" leftIcon={<Pause size={11} />}
                loading={isBusy} onClick={onCancel}>취소</AdminButton>
            )}
            <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
          </div>
        ) : <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
      }>
      {loading ? (
        <AdminSkeleton variant="block" rows={6} />
      ) : error ? (
        <AdminAlert tone="danger" title="상세 로드 실패" description={error} />
      ) : detail && b && a ? (
        <div className="space-y-3 text-xs">
          <div className="grid gap-2 md:grid-cols-3">
            <KV label="음원" value={`${a.title} (${fmtDuration(a.duration_seconds)})`} />
            <KV label="범위" value={SCOPE_KO[b.scope_type]} />
            <KV label="우선순위" value={b.priority} />
            <KV label="Interrupt" value={INTERRUPT_KO[b.interrupt_mode]} />
            <KV label="생성" value={fmtDt(b.created_at)} />
            <KV label="활성화" value={fmtDt(b.activated_at)} />
            <KV label="만료" value={fmtDt(b.expires_at)} />
            <KV label="완료" value={fmtDt(b.completed_at)} />
            <KV label="취소" value={fmtDt(b.cancelled_at)} />
          </div>

          {b.message && (
            <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">메시지</div>
              <p className="whitespace-pre-line text-ink">{b.message}</p>
            </div>
          )}

          {/* 음원 미리듣기 */}
          <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">음원 미리듣기</div>
            <audio src={a.file_url} controls className="w-full" />
          </div>

          {/* 진행률 */}
          <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[10px] uppercase tracking-wider text-ink-mute">재생률</div>
              <div className="text-lg font-extrabold tabular-nums text-emerald-300">{playedRate}%</div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-deep">
              <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${playedRate}%` }} />
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px]">
              <Stat label="전체"  value={detail.summary.total}   />
              <Stat label="대기"  value={detail.summary.pending} tone="text-amber-300" />
              <Stat label="재생중" value={detail.summary.playing} tone="text-blue-300" />
              <Stat label="완료"  value={detail.summary.played}  tone="text-emerald-300" />
              <Stat label="실패"  value={detail.summary.failed}  tone="text-rose-300" />
              <Stat label="제외"  value={detail.summary.skipped} />
              <Stat label="만료"  value={detail.summary.expired} />
            </div>
          </div>

          {/* 대상 매장 list */}
          <div className="rounded-xl bg-bg-deep/40 ring-1 ring-line/10">
            <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">
              대상 매장 ({detail.targets.length} / {detail.summary.total})
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-bg-deep">
                  <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                    <th className="px-3 py-2">매장 ID</th>
                    <th className="px-3 py-2">지역</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2 text-right">시도</th>
                    <th className="px-3 py-2 text-right">최초 감지</th>
                    <th className="px-3 py-2 text-right">재생/실패</th>
                    <th className="px-3 py-2">오류</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.targets.map((t) => (
                    <tr key={t.id} className="border-b border-line/5">
                      <td className="px-3 py-2 font-mono text-[10px] text-ink-mute">{t.store_id.slice(0, 8)}…</td>
                      <td className="px-3 py-2 text-[10px] text-ink-mute">{t.region_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <AdminBadge tone={
                          t.status === 'played' ? 'success' :
                          t.status === 'playing' ? 'info' :
                          t.status === 'failed' ? 'danger' :
                          t.status === 'pending' ? 'warning' : 'neutral'
                        }>{t.status}</AdminBadge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.attempt_count}</td>
                      <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDt(t.first_seen_at)}</td>
                      <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">
                        {fmtDt(t.played_at ?? t.failed_at)}
                      </td>
                      <td className="px-3 py-2 truncate max-w-[200px] text-[10px] text-ink-dim" title={t.error_message ?? ''}>
                        {t.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {b.memo && (
            <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">메모</div>
              <p className="whitespace-pre-line text-ink">{b.memo}</p>
            </div>
          )}
        </div>
      ) : null}
    </AdminModal>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

function Stat({ label, value, tone = 'text-ink' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded bg-bg-deep px-1 py-1.5">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-ink-dim">{label}</div>
    </div>
  );
}

void AlertTriangle;
