/**
 * EnterpriseRegionsPanel — Enterprise Phase 1-2 v2 (Region Management 완성).
 *
 * 본사별 지역 관리.
 * - 컬럼: 지역명/매장수/온라인/오프라인/24h/적용정책/최근배포/상태/액션
 * - KPI: 전체 지역 / 활성 / 매장 / 온라인 / 오프라인
 * - CRUD + 상태 변경 + Soft Delete + 정책 연결 (기본 정책)
 * - 상세 Drawer 모달 (지역 정보 + 정책 + 매장 카운트 + 향후 확장 영역)
 * - 검색: 지역명/코드/매니저/이메일/본사명/정책명
 *
 * 무변경: DB 계산식 / RPC 시그니처 (update 만 +default_policy_id) / RLS
 * SQL: 0352 (table+RPC) + 0353 (assign_store) + 0375 (v2 extension)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, MapPin, Building2, Pencil, Trash2, RotateCcw, Power,
  Wifi, WifiOff, Clock, ShieldCheck,
} from 'lucide-react';
import {
  listEnterpriseRegions,
  createEnterpriseRegion,
  updateEnterpriseRegion,
  setEnterpriseRegionStatus,
  softDeleteEnterpriseRegion,
  getEnterpriseRegionKpi,
  recountEnterpriseRegionStores,
  type EnterpriseRegion,
  type EnterpriseRegionStatus,
  type EnterpriseRegionKpi,
} from '@/lib/api/enterpriseRegionsApi';
import {
  adminListEnterpriseAccounts,
  type EnterpriseAccount,
} from '@/lib/api/enterpriseAccountsApi';
import { toast } from '@/store/toastStore';
import {
  AdminSection, AdminCard, AdminStatCard, AdminSearch, AdminBadge,
  AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminModal,
  AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import { adminTypography } from '@/lib/adminTypography';

const STATUS_OPTIONS: ReadonlyArray<{ value: EnterpriseRegionStatus; label: string }> = [
  { value: 'active',      label: '정상' },
  { value: 'inactive',    label: '비활성' },
  { value: 'maintenance', label: '점검중' },
  { value: 'suspended',   label: '정지' },
];

const STATUS_TONE: Record<EnterpriseRegionStatus, AdminToneName> = {
  active:      'success',
  inactive:    'neutral',
  maintenance: 'warning',
  suspended:   'danger',
};

const STATUS_LABEL: Record<EnterpriseRegionStatus, string> = {
  active: '정상', inactive: '비활성', maintenance: '점검중', suspended: '정지',
};

const PAGE_SIZE = 50;

export default function EnterpriseRegionsPanel() {
  const [rows, setRows] = useState<EnterpriseRegion[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<EnterpriseRegionKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EnterpriseRegionStatus | ''>('');
  const [enterpriseFilter, setEnterpriseFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const [accounts, setAccounts] = useState<EnterpriseAccount[]>([]);
  const [editTarget, setEditTarget] = useState<EnterpriseRegion | 'new' | null>(null);
  const [detailTarget, setDetailTarget] = useState<EnterpriseRegion | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        listEnterpriseRegions({
          enterpriseAccountId: enterpriseFilter || null,
          search: search.trim() || null,
          status: statusFilter || null,
          limit: PAGE_SIZE,
          offset,
        }),
        getEnterpriseRegionKpi(enterpriseFilter || undefined),
      ]);
      setRows(list.data);
      setTotal(list.pagination.total);
      setKpi(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, enterpriseFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // 본사 select 옵션 (한 번만 로드)
  useEffect(() => {
    let alive = true;
    adminListEnterpriseAccounts({ limit: 200, offset: 0 })
      .then((r) => { if (alive) setAccounts(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleSetStatus = async (id: string, status: EnterpriseRegionStatus) => {
    setBusyId(id);
    try {
      await setEnterpriseRegionStatus(id, status);
      toast.success('상태가 변경되었습니다');
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleSoftDelete = async (r: EnterpriseRegion) => {
    if (!confirm(`'${r.region_name}' 지역을 삭제하시겠습니까? (Soft Delete)`)) return;
    setBusyId(r.id);
    try {
      await softDeleteEnterpriseRegion(r.id);
      toast.success('삭제되었습니다');
      await load();
    } catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleRecount = async (r: EnterpriseRegion) => {
    setBusyId(r.id);
    try {
      const res = await recountEnterpriseRegionStores(r.id);
      toast.success(`매장 수 재계산: ${res.note}`);
      await load();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '전체 지역', value: kpi.total_regions, icon: <MapPin size={14} />, tone: 'primary' as AdminToneName },
      { label: '활성',     value: kpi.active_regions, icon: <ShieldCheck size={14} />, tone: 'success' as AdminToneName },
      { label: '전체 매장', value: kpi.total_stores,  icon: <Building2 size={14} />, tone: 'info' as AdminToneName },
      { label: '온라인',   value: kpi.online_stores ?? 0, icon: <Wifi size={14} />,   tone: 'success' as AdminToneName },
      { label: '오프라인', value: kpi.offline_stores ?? 0, icon: <WifiOff size={14} />,
        tone: (kpi.offline_stores ?? 0) > 0 ? ('danger' as AdminToneName) : ('neutral' as AdminToneName) },
    ];
  }, [kpi]);

  return (
    <AdminSection
      title={<><MapPin size={14} /> 지역 관리</>}
      description="본사별 지역 (서울/경기/부산 등) 관리. 지역에 매장과 기본 정책을 연결할 수 있습니다."
      action={
        <div className="flex items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
            onClick={() => void load()} disabled={loading}>
            새로고침
          </AdminButton>
          <AdminButton tone="primary" variant="solid" size="sm"
            leftIcon={<Plus size={11} />}
            onClick={() => setEditTarget('new')}>
            지역 추가
          </AdminButton>
        </div>
      }
    >
      {kpiCards ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {kpiCards.map((c) => (
            <AdminStatCard key={c.label} tone={c.tone} icon={c.icon} label={c.label}
              value={c.value.toLocaleString('ko-KR')} />
          ))}
        </div>
      ) : <AdminSkeleton variant="kpi" />}

      <AdminSearch
        value={search}
        onChange={(v) => { setSearch(v); setOffset(0); }}
        placeholder="지역명/코드/담당자/이메일/본사명/정책명 검색"
        filters={
          <>
            <select
              value={enterpriseFilter}
              onChange={(e) => { setEnterpriseFilter(e.target.value); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="본사 필터"
            >
              <option value="">전체 본사</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.enterprise_name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as EnterpriseRegionStatus | ''); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="상태 필터"
            >
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </>
        }
        trailing={
          (search || statusFilter || enterpriseFilter) ? (
            <AdminButton tone="neutral" variant="subtle" size="sm"
              onClick={() => { setSearch(''); setStatusFilter(''); setEnterpriseFilter(''); setOffset(0); }}>
              초기화
            </AdminButton>
          ) : null
        }
      />

      {error && (
        <AdminAlert tone="danger" title="목록 로드 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      )}

      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={5} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          icon={<MapPin size={20} />}
          title="등록된 지역이 없습니다"
          description="상단 '지역 추가' 버튼으로 지역을 등록하세요."
          action={
            <AdminButton tone="primary" leftIcon={<Plus size={11} />} onClick={() => setEditTarget('new')}>
              지역 추가
            </AdminButton>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-bg-deep text-[10px] uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2 text-left">지역</th>
                  <th className="px-3 py-2 text-left">본사</th>
                  <th className="px-3 py-2 text-right">매장</th>
                  <th className="px-3 py-2 text-right">온라인</th>
                  <th className="px-3 py-2 text-right">오프라인</th>
                  <th className="px-3 py-2 text-right">24h</th>
                  <th className="px-3 py-2 text-left">기본 정책</th>
                  <th className="px-3 py-2 text-left">최근 배포</th>
                  <th className="px-3 py-2 text-center">상태</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/10">
                {rows.map((r) => (
                  <tr key={r.id}
                    onClick={() => setDetailTarget(r)}
                    className="cursor-pointer hover:bg-bg-hover/40">
                    <td className="px-3 py-2">
                      <div className={adminTypography.bodyStrong}>{r.region_name}</div>
                      <div className={`font-mono ${adminTypography.hint}`}>{r.region_code}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{r.enterprise_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.store_count.toLocaleString('ko-KR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{(r.online_count ?? 0).toLocaleString('ko-KR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={(r.offline_count ?? 0) > 0 ? 'text-rose-300' : 'text-ink-mute'}>
                        {(r.offline_count ?? 0).toLocaleString('ko-KR')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{(r.recent_24h_count ?? 0).toLocaleString('ko-KR')}</td>
                    <td className="px-3 py-2">
                      {r.default_policy_name
                        ? <span className="text-ink">{r.default_policy_name}</span>
                        : <span className={adminTypography.hint}>미설정</span>}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-ink-mute tabular-nums">
                      {r.last_policy_applied_at
                        ? new Date(r.last_policy_applied_at).toLocaleDateString('ko-KR')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <AdminBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</AdminBadge>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        row={r} busy={busyId === r.id}
                        onEdit={() => setEditTarget(r)}
                        onRecount={() => void handleRecount(r)}
                        onSetStatus={(s) => void handleSetStatus(r.id, s)}
                        onDelete={() => void handleSoftDelete(r)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <div key={r.id}
                onClick={() => setDetailTarget(r)}
                className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10 cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink">{r.region_name}</div>
                    <div className={`font-mono ${adminTypography.hint}`}>{r.region_code}</div>
                  </div>
                  <AdminBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</AdminBadge>
                </div>
                <div className={`mt-1 ${adminTypography.muted}`}>{r.enterprise_name ?? '—'}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <span className="text-ink-mute">매장 <b className="text-ink">{r.store_count}</b></span>
                  <span className="text-ink-mute">온라인 <b className="text-emerald-300">{r.online_count ?? 0}</b></span>
                  <span className="text-ink-mute">오프라인 <b className={(r.offline_count ?? 0) > 0 ? 'text-rose-300' : 'text-ink-mute'}>{r.offline_count ?? 0}</b></span>
                </div>
                {r.default_policy_name && (
                  <div className={`mt-1 ${adminTypography.hint}`}>
                    정책: <span className="text-ink">{r.default_policy_name}</span>
                  </div>
                )}
                <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<Pencil size={10} />}
                    onClick={() => setEditTarget(r)}>편집</AdminButton>
                  <AdminButton tone="danger" variant="subtle" size="sm" leftIcon={<Trash2 size={10} />}
                    onClick={() => void handleSoftDelete(r)}>삭제</AdminButton>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-ink-mute">
              <span>{offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString('ko-KR')}</span>
              <div className="flex gap-2">
                <AdminButton tone="neutral" variant="subtle" size="sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>이전</AdminButton>
                <AdminButton tone="neutral" variant="subtle" size="sm" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}>다음</AdminButton>
              </div>
            </div>
          )}
        </>
      )}

      {editTarget && (
        <RegionEditModal
          target={editTarget}
          accounts={accounts}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void load(); }}
        />
      )}

      {detailTarget && (
        <RegionDetailModal
          region={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null); }}
        />
      )}
    </AdminSection>
  );
}


// =============================================================================
// Row actions
// =============================================================================

function RowActions({
  row, busy, onEdit, onRecount, onSetStatus, onDelete,
}: {
  row: EnterpriseRegion; busy: boolean;
  onEdit: () => void;
  onRecount: () => void;
  onSetStatus: (s: EnterpriseRegionStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <AdminTooltip label="편집">
        <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onEdit} disabled={busy}>
          <Pencil size={11} />
        </AdminButton>
      </AdminTooltip>
      <AdminTooltip label="매장 수 재계산">
        <AdminButton tone="info" variant="subtle" size="sm" onClick={onRecount} disabled={busy}>
          <RotateCcw size={11} />
        </AdminButton>
      </AdminTooltip>
      {row.status === 'active' ? (
        <AdminTooltip label="비활성화">
          <AdminButton tone="warning" variant="subtle" size="sm"
            onClick={() => onSetStatus('inactive')} disabled={busy}>
            <Power size={11} />
          </AdminButton>
        </AdminTooltip>
      ) : (
        <AdminTooltip label="활성화">
          <AdminButton tone="success" variant="subtle" size="sm"
            onClick={() => onSetStatus('active')} disabled={busy}>
            <Power size={11} />
          </AdminButton>
        </AdminTooltip>
      )}
      <AdminTooltip label="삭제 (Soft Delete)">
        <AdminButton tone="danger" variant="subtle" size="sm" onClick={onDelete} disabled={busy}>
          <Trash2 size={11} />
        </AdminButton>
      </AdminTooltip>
    </div>
  );
}


// =============================================================================
// Edit / Create Modal
// =============================================================================

function RegionEditModal({
  target, accounts, onClose, onSaved,
}: {
  target: EnterpriseRegion | 'new';
  accounts: EnterpriseAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = target === 'new';
  const r = isNew ? null : target;

  const [enterpriseAccountId, setEnterpriseAccountId] = useState(r?.enterprise_account_id ?? '');
  const [regionName, setRegionName] = useState(r?.region_name ?? '');
  const [regionCode, setRegionCode] = useState(r?.region_code ?? '');
  const [managerName, setManagerName] = useState(r?.manager_name ?? '');
  const [managerEmail, setManagerEmail] = useState(r?.manager_email ?? '');
  const [managerPhone, setManagerPhone] = useState(r?.manager_phone ?? '');
  const [status, setStatus] = useState<EnterpriseRegionStatus>(r?.status ?? 'active');
  const [notes, setNotes] = useState(r?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const canSave = !!regionName.trim() && !!regionCode.trim()
    && (isNew ? !!enterpriseAccountId : true);

  const onSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        await createEnterpriseRegion({
          enterpriseAccountId,
          regionName: regionName.trim(),
          regionCode: regionCode.trim(),
          managerName: managerName.trim() || null,
          managerEmail: managerEmail.trim() || null,
          managerPhone: managerPhone.trim() || null,
          status,
          notes: notes.trim() || null,
        });
        toast.success('지역이 추가되었습니다');
      } else {
        await updateEnterpriseRegion(r!.id, {
          regionName: regionName.trim(),
          regionCode: regionCode.trim(),
          managerName: managerName.trim() || null,
          managerEmail: managerEmail.trim() || null,
          managerPhone: managerPhone.trim() || null,
          status,
          notes: notes.trim() || null,
        });
        toast.success('지역이 수정되었습니다');
      }
      onSaved();
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  return (
    <AdminModal
      open onClose={onClose}
      size="md"
      title={isNew ? '지역 추가' : `지역 편집 — ${r?.region_name}`}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" onClick={onClose} disabled={saving}>취소</AdminButton>
          <AdminButton tone="primary" variant="solid" loading={saving}
            onClick={() => void onSave()} disabled={!canSave || saving}>
            {isNew ? '추가' : '저장'}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-2 text-xs">
        {isNew && (
          <Field label="본사 *">
            <select value={enterpriseAccountId} onChange={(e) => setEnterpriseAccountId(e.target.value)}
              className="input">
              <option value="">선택…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.enterprise_name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="지역명 *">
          <input value={regionName} onChange={(e) => setRegionName(e.target.value)}
            placeholder="예: 서울" className="input" />
        </Field>
        <Field label="지역 코드 *" hint="대문자 + 영문/숫자 (저장 시 자동 대문자화)">
          <input value={regionCode} onChange={(e) => setRegionCode(e.target.value.toUpperCase())}
            placeholder="예: SEOUL" className="input font-mono uppercase" />
        </Field>
        <Field label="담당자명">
          <input value={managerName} onChange={(e) => setManagerName(e.target.value)} className="input" />
        </Field>
        <Field label="담당자 이메일">
          <input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)}
            className="input" />
        </Field>
        <Field label="담당자 전화">
          <input type="tel" value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)}
            className="input" />
        </Field>
        <Field label="상태">
          <select value={status} onChange={(e) => setStatus(e.target.value as EnterpriseRegionStatus)}
            className="input">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
        <Field label="메모">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            className="input min-h-[60px]" />
        </Field>
      </div>
    </AdminModal>
  );
}


// =============================================================================
// Detail Modal — 지역 정보 + 정책 + 매장 + 향후 확장 영역
// =============================================================================

function RegionDetailModal({
  region, onClose, onEdit,
}: {
  region: EnterpriseRegion;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <AdminModal
      open onClose={onClose} size="lg"
      title={<><MapPin size={14} /> {region.region_name}</>}
      headerExtra={<AdminBadge tone={STATUS_TONE[region.status]}>{STATUS_LABEL[region.status]}</AdminBadge>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>
          <AdminButton tone="primary" variant="solid" leftIcon={<Pencil size={11} />} onClick={onEdit}>
            편집
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <AdminCard title="지역 정보">
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <KV k="지역명" v={region.region_name} />
            <KV k="코드" v={region.region_code} mono />
            <KV k="본사" v={region.enterprise_name ?? '—'} />
            <KV k="담당자" v={region.manager_name ?? '—'} />
            <KV k="이메일" v={region.manager_email ?? '—'} />
            <KV k="전화" v={region.manager_phone ?? '—'} />
            {region.notes && <KV k="메모" v={region.notes} colSpan />}
            <KV k="생성" v={new Date(region.created_at).toLocaleString('ko-KR')} />
            <KV k="수정" v={new Date(region.updated_at).toLocaleString('ko-KR')} />
          </dl>
        </AdminCard>

        <AdminCard title="매장 / 접속">
          <dl className="grid grid-cols-4 gap-2 text-[11px]">
            <KV k="전체 매장" v={`${region.store_count.toLocaleString('ko-KR')}개`} />
            <KV k="온라인" v={`${(region.online_count ?? 0).toLocaleString('ko-KR')}개`} />
            <KV k="오프라인" v={`${(region.offline_count ?? 0).toLocaleString('ko-KR')}개`} />
            <KV k="24h" v={`${(region.recent_24h_count ?? 0).toLocaleString('ko-KR')}개`} />
          </dl>
        </AdminCard>

        <AdminCard title="기본 정책">
          {region.default_policy_name ? (
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className={adminTypography.bodyStrong}>{region.default_policy_name}</div>
                {region.default_policy_status && (
                  <div className={adminTypography.hint}>status: {region.default_policy_status}</div>
                )}
              </div>
              {region.last_policy_applied_at && (
                <div className={adminTypography.hint}>
                  <Clock size={10} className="inline mr-0.5" />
                  최근 배포 {new Date(region.last_policy_applied_at).toLocaleString('ko-KR')}
                </div>
              )}
            </div>
          ) : (
            <p className={adminTypography.description}>기본 정책 미설정 — 편집에서 연결할 수 있습니다.</p>
          )}
        </AdminCard>

        <AdminCard title="향후 확장">
          <ul className={`list-disc pl-5 ${adminTypography.description} space-y-0.5`}>
            <li>예약/이벤트/시즌/긴급 정책</li>
            <li>지역별 AI 추천 / 배포 통계</li>
            <li>최근 장애 · 변경 이력 timeline</li>
          </ul>
        </AdminCard>
      </div>
    </AdminModal>
  );
}


// =============================================================================
// Small helpers
// =============================================================================

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-dim">{hint}</span>}
    </label>
  );
}

function KV({ k, v, colSpan, mono }: { k: string; v: string; colSpan?: boolean; mono?: boolean }) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <dt className="text-[10px] text-ink-dim">{k}</dt>
      <dd className={`${mono ? 'font-mono' : ''} text-[11px] text-ink`}>{v}</dd>
    </div>
  );
}
