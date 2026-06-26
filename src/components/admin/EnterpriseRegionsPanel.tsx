/**
 * EnterpriseRegionsPanel — Enterprise Phase 1-2.
 *
 * 본사별 지역 (서울/경기/부산 등) 관리. enterprise_accounts FK 기반.
 * - KPI 4개 + 본사 select + 검색 + 상태 필터 + 페이지네이션
 * - Create / Edit Modal (region_code 자동 대문자)
 * - 상태 변경 / Soft delete / Recount (수동)
 * - loading / empty / error 상태 + 모바일 카드형
 *
 * 매장 ↔ 지역 매핑은 Phase 1-3 이후 (현재 store_count 는 수동/0).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Search, X, AlertCircle, MapPin, Building2,
  Pencil, Trash2, RotateCcw, Power, CheckCircle2,
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

const STATUS_OPTIONS: ReadonlyArray<{ value: EnterpriseRegionStatus; label: string }> = [
  { value: 'active', label: '정상' },
  { value: 'inactive', label: '비활성' },
  { value: 'suspended', label: '정지' },
];

const PAGE_SIZE = 25;

export default function EnterpriseRegionsPanel() {
  const [rows, setRows] = useState<EnterpriseRegion[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<EnterpriseRegionKpi | null>(null);
  const [accounts, setAccounts] = useState<EnterpriseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<EnterpriseRegionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [editTarget, setEditTarget] = useState<EnterpriseRegion | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnterpriseRegion | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        listEnterpriseRegions({
          enterpriseAccountId: accountFilter || null,
          search: search.trim() || null,
          status: statusFilter || null,
          limit: PAGE_SIZE, offset,
        }),
        getEnterpriseRegionKpi(accountFilter || undefined),
      ]);
      setRows(list.data);
      setTotal(list.pagination.total);
      setKpi(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accountFilter, search, statusFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // 본사 목록 (모달/필터용)
  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 })
      .then((r) => setAccounts(r.data))
      .catch((e) => toast.error(`본사 목록 로딩 실패: ${(e as Error).message}`));
  }, []);

  const onSearchChange = (v: string) => { setSearch(v); setOffset(0); };
  const onAccountChange = (v: string) => { setAccountFilter(v); setOffset(0); };
  const onStatusChange = (v: EnterpriseRegionStatus | '') => { setStatusFilter(v); setOffset(0); };

  const handleSetStatus = async (id: string, status: EnterpriseRegionStatus) => {
    setBusyId(id);
    try {
      await setEnterpriseRegionStatus(id, status);
      toast.success('상태가 변경되었습니다');
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await softDeleteEnterpriseRegion(deleteTarget.id);
      toast.success('지역이 비활성 보관되었습니다');
      setDeleteTarget(null);
      await load();
    } catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleRecount = async () => {
    setLoading(true);
    try {
      const result = await recountEnterpriseRegionStores();
      toast.success(`${result.updated_count}개 지역 재계산 — ${result.note}`);
      await load();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
  };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '전체 지역', value: kpi.total_regions, tone: 'text-ink' },
      { label: '활성', value: kpi.active_regions, tone: 'text-emerald-300' },
      { label: '총 매장 수', value: kpi.total_stores, tone: 'text-sky-300' },
      { label: '정책 적용 지역', value: kpi.regions_with_policy_applied, tone: 'text-accent' },
    ];
  }, [kpi]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <MapPin size={14} /> 지역 관리
            <span className="text-[10px] font-normal text-ink-dim">(Enterprise Phase 1-2)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void handleRecount()} disabled={loading}
              title="매장 수 재계산"
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RotateCcw size={11} /> 재계산
            </button>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => setEditTarget('new')} disabled={accounts.length === 0}
              title={accounts.length === 0 ? '본사 계정을 먼저 추가하세요' : ''}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
              <Plus size={11} /> 지역 추가
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          본사별 지역을 관리합니다 (서울/경기/부산 등). 매장 ↔ 지역 매핑은 Phase 1-3 에서 자동 연결됩니다.
        </p>
      </div>

      {/* KPI */}
      {kpiCards && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="text-[10px] uppercase tracking-wider text-ink-dim">{c.label}</div>
              <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <select value={accountFilter} onChange={(e) => onAccountChange(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 본사</option>
          {accounts
            .filter((a) => a.status === 'active' || a.status === 'invited')
            .map((a) => (
              <option key={a.id} value={a.id}>{a.enterprise_name}</option>
            ))}
        </select>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input type="text" placeholder="지역명/코드/담당자/이메일 검색"
            value={search} onChange={(e) => onSearchChange(e.target.value)}
            className="rounded bg-bg-deep pl-7 pr-2 py-1 w-64 max-w-full" />
        </div>
        <select value={statusFilter} onChange={(e) => onStatusChange(e.target.value as EnterpriseRegionStatus | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="ml-auto text-ink-dim">{total}개 (페이지 {Math.floor(offset / PAGE_SIZE) + 1})</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {/* Empty / Skeleton / Table */}
      {loading && rows.length === 0 ? (
        <SkeletonRows />
      ) : !loading && rows.length === 0 && !error ? (
        <EmptyState
          onAdd={() => setEditTarget('new')}
          hasAccounts={accounts.length > 0}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-3 py-2">본사</th>
                  <th className="px-3 py-2">지역명</th>
                  <th className="px-3 py-2">코드</th>
                  <th className="px-3 py-2">담당자</th>
                  <th className="px-3 py-2 text-right">매장</th>
                  <th className="px-3 py-2">정책 적용</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                    <td className="px-3 py-2 font-semibold">{r.enterprise_name ?? '—'}</td>
                    <td className="px-3 py-2">{r.region_name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-sky-300">{r.region_code}</td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{r.manager_name ?? '—'}</div>
                      {r.manager_email && <div className="text-[10px] text-ink-mute">{r.manager_email}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.store_count}</td>
                    <td className="px-3 py-2 text-[10px] text-ink-mute tabular-nums">
                      {r.last_policy_applied_at
                        ? new Date(r.last_policy_applied_at).toLocaleDateString('ko-KR')
                        : '—'}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <RowActions row={r} busy={busyId === r.id}
                        onEdit={() => setEditTarget(r)}
                        onSetStatus={(s) => void handleSetStatus(r.id, s)}
                        onDelete={() => setDeleteTarget(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm">{r.region_name}
                      <span className="ml-2 font-mono text-[10px] text-sky-300">{r.region_code}</span>
                    </div>
                    <div className="text-[11px] text-ink-mute flex items-center gap-1">
                      <Building2 size={10} /> {r.enterprise_name ?? '—'}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-ink-mute">
                  {r.manager_name && <div>담당: {r.manager_name}</div>}
                  {r.manager_email && <div>{r.manager_email}</div>}
                  {r.manager_phone && <div>{r.manager_phone}</div>}
                  <div className="text-[10px] text-ink-dim">
                    매장 {r.store_count}곳 · 정책 {r.last_policy_applied_at
                      ? new Date(r.last_policy_applied_at).toLocaleDateString('ko-KR')
                      : '미적용'}
                  </div>
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => setEditTarget(r)}
                    className="flex-1 rounded bg-bg-deep px-2 py-1 text-[11px] font-bold">편집</button>
                  <button onClick={() => setDeleteTarget(r)}
                    className="rounded bg-rose-500/20 px-2 py-1 text-[11px] font-bold text-rose-300">삭제</button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">이전</button>
              <span className="text-ink-mute">
                {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">다음</button>
            </div>
          )}
        </>
      )}

      {editTarget && (
        <EditModal target={editTarget} accounts={accounts}
          defaultAccountId={accountFilter || undefined}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void load(); }} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal target={deleteTarget}
          busy={busyId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()} />
      )}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function StatusBadge({ status }: { status: EnterpriseRegionStatus }) {
  const map: Record<EnterpriseRegionStatus, { ko: string; cls: string }> = {
    active:    { ko: '정상',    cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
    inactive:  { ko: '비활성',  cls: 'bg-ink/15 text-ink-mute ring-line/20' },
    suspended: { ko: '정지',    cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  };
  const v = map[status];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${v.cls}`}>{v.ko}</span>;
}

function RowActions({
  row, busy, onEdit, onSetStatus, onDelete,
}: {
  row: EnterpriseRegion; busy: boolean;
  onEdit: () => void;
  onSetStatus: (s: EnterpriseRegionStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button onClick={onEdit} disabled={busy} title="편집"
        className="rounded bg-sky-500/20 p-1 hover:bg-sky-500/30 disabled:opacity-50">
        <Pencil size={11} className="text-sky-300" />
      </button>
      {row.status === 'active' ? (
        <button onClick={() => onSetStatus('suspended')} disabled={busy} title="정지"
          className="rounded bg-amber-500/20 p-1 hover:bg-amber-500/30 disabled:opacity-50">
          <Power size={11} className="text-amber-300" />
        </button>
      ) : (
        <button onClick={() => onSetStatus('active')} disabled={busy} title="활성화"
          className="rounded bg-emerald-500/20 p-1 hover:bg-emerald-500/30 disabled:opacity-50">
          <CheckCircle2 size={11} className="text-emerald-300" />
        </button>
      )}
      <button onClick={onDelete} disabled={busy} title="삭제"
        className="rounded bg-rose-500/20 p-1 hover:bg-rose-500/30 disabled:opacity-50">
        <Trash2 size={11} className="text-rose-300" />
      </button>
    </div>
  );
}

function EmptyState({ onAdd, hasAccounts }: { onAdd: () => void; hasAccounts: boolean }) {
  return (
    <div className="rounded-xl bg-bg-card px-6 py-12 text-center">
      <MapPin size={32} className="mx-auto text-ink-dim" />
      <p className="mt-3 text-sm font-bold">등록된 지역이 없습니다.</p>
      <p className="mt-1 text-[11px] text-ink-mute">
        {hasAccounts ? '첫 지역을 추가해보세요 (예: 서울 / SEOUL).' : '먼저 본사 계정을 추가해야 합니다.'}
      </p>
      {hasAccounts && (
        <button onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1 rounded bg-accent px-3 py-2 text-xs font-bold text-black">
          <Plus size={12} /> 지역 추가
        </button>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <div className="hidden md:block rounded-xl bg-bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse border-b border-line/5 bg-bg-deep/30" />
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-bg-card" />)}
      </div>
    </div>
  );
}

// =============================================================================
// Edit / Create Modal
// =============================================================================

function EditModal({
  target, accounts, defaultAccountId, onClose, onSaved,
}: {
  target: EnterpriseRegion | 'new';
  accounts: EnterpriseAccount[];
  defaultAccountId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const isNew = target === 'new';
  const t = isNew ? null : target;
  const [accountId, setAccountId] = useState<string>(t?.enterprise_account_id ?? defaultAccountId ?? '');
  const [regionName, setRegionName] = useState(t?.region_name ?? '');
  const [regionCode, setRegionCode] = useState(t?.region_code ?? '');
  const [managerName, setManagerName] = useState(t?.manager_name ?? '');
  const [managerEmail, setManagerEmail] = useState(t?.manager_email ?? '');
  const [managerPhone, setManagerPhone] = useState(t?.manager_phone ?? '');
  const [status, setStatus] = useState<EnterpriseRegionStatus>(t?.status ?? 'active');
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const canSave = !!accountId && !!regionName.trim() && !!regionCode.trim();

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isNew) {
        await createEnterpriseRegion({
          enterpriseAccountId: accountId,
          regionName: regionName.trim(),
          regionCode: regionCode.trim().toUpperCase(),
          managerName: managerName.trim() || null,
          managerEmail: managerEmail.trim() || null,
          managerPhone: managerPhone.trim() || null,
          status,
          notes: notes.trim() || null,
        });
        toast.success('지역이 추가되었습니다');
      } else if (t) {
        await updateEnterpriseRegion(t.id, {
          regionName: regionName.trim(),
          regionCode: regionCode.trim().toUpperCase(),
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim(),
          status,
          notes: notes.trim(),
        });
        toast.success('수정되었습니다');
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{isNew ? '지역 추가' : '지역 편집'}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>
        <div className="space-y-3">
          <Field label="본사 *">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              disabled={!isNew /* 기존 지역의 본사는 변경 불가 (FK 정합성) */}
              className="input">
              <option value="">선택…</option>
              {accounts
                .filter((a) => a.status === 'active' || a.status === 'invited')
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.enterprise_name}</option>
                ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="지역명 *">
              <input value={regionName} onChange={(e) => setRegionName(e.target.value)}
                placeholder="서울" className="input" />
            </Field>
            <Field label="지역 코드 * (자동 대문자)">
              <input value={regionCode}
                onChange={(e) => setRegionCode(e.target.value.toUpperCase())}
                placeholder="SEOUL" className="input font-mono" />
            </Field>
          </div>
          <Field label="담당자명">
            <input value={managerName} onChange={(e) => setManagerName(e.target.value)} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="이메일">
              <input type="email" value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)} className="input" />
            </Field>
            <Field label="전화번호">
              <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)}
                placeholder="010-0000-0000" className="input" />
            </Field>
          </div>
          <Field label="상태">
            <select value={status} onChange={(e) => setStatus(e.target.value as EnterpriseRegionStatus)} className="input">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="메모">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input min-h-[60px]" />
          </Field>
          <button disabled={!canSave || saving} onClick={() => void onSave()}
            className="w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90 disabled:opacity-50">
            {saving ? '저장 중…' : isNew ? '추가' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  target, busy, onCancel, onConfirm,
}: { target: EnterpriseRegion; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-rose-500/15 p-2"><Trash2 size={18} className="text-rose-300" /></div>
          <div className="flex-1">
            <h3 className="text-sm font-bold">지역 삭제</h3>
            <p className="mt-1 text-xs text-ink-mute">
              <b>{target.region_name}</b> ({target.region_code}) 지역을 삭제하시겠습니까?
            </p>
            <p className="mt-1 text-[10px] text-ink-dim">
              이 지역은 삭제되지 않고 비활성 보관됩니다.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 rounded bg-bg-deep px-3 py-2 text-xs font-bold hover:bg-bg-hover disabled:opacity-50">
            취소
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="flex-1 rounded bg-rose-500 px-3 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-50">
            {busy ? '삭제 중…' : '비활성 보관'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}
