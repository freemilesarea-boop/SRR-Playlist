/**
 * EnterpriseAccountsPanel — Enterprise Phase 1-1.
 *
 * 본사 담당자 관리 UI (super admin only).
 * - KPI 5개 + 검색 + 상태/권한 필터 + 페이지네이션
 * - Create / Update Drawer
 * - 상태 변경 / Soft delete (확인 모달)
 * - loading / empty / error 상태
 * - 모바일 카드형 fallback
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Search, X, AlertCircle, Building2,
  CheckCircle2, Mail, Phone, Pencil, Trash2, Power,
} from 'lucide-react';
import {
  adminListEnterpriseAccounts,
  adminCreateEnterpriseAccount,
  adminUpdateEnterpriseAccount,
  adminSetEnterpriseAccountStatus,
  adminSoftDeleteEnterpriseAccount,
  adminEnterpriseAccountKpi,
  type EnterpriseAccount,
  type EnterpriseAccountStatus,
  type EnterpriseAccountRole,
  type EnterpriseAccountKpi,
} from '@/lib/api/enterpriseAccountsApi';
import { toast } from '@/store/toastStore';

const STATUS_OPTIONS: ReadonlyArray<{ value: EnterpriseAccountStatus; label: string }> = [
  { value: 'active', label: '정상' },
  { value: 'invited', label: '초대중' },
  { value: 'suspended', label: '정지' },
  { value: 'inactive', label: '비활성' },
];

const ROLE_OPTIONS: ReadonlyArray<{ value: EnterpriseAccountRole; label: string }> = [
  { value: 'owner', label: '본사 최고관리자' },
  { value: 'admin', label: '본사 관리자' },
  { value: 'enterprise_manager', label: '본사 담당자' },
  { value: 'viewer', label: '조회 전용' },
];

const PAGE_SIZE = 25;

export default function EnterpriseAccountsPanel() {
  const [rows, setRows] = useState<EnterpriseAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<EnterpriseAccountKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EnterpriseAccountStatus | ''>('');
  const [roleFilter, setRoleFilter] = useState<EnterpriseAccountRole | ''>('');
  const [offset, setOffset] = useState(0);
  const [editTarget, setEditTarget] = useState<EnterpriseAccount | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnterpriseAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        adminListEnterpriseAccounts({
          search: search.trim() || null,
          status: statusFilter || null,
          role: roleFilter || null,
          limit: PAGE_SIZE,
          offset,
        }),
        adminEnterpriseAccountKpi(),
      ]);
      setRows(list.data);
      setTotal(list.pagination.total);
      setKpi(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, roleFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // 검색/필터 변경 시 offset 리셋
  const onSearchChange = (v: string) => { setSearch(v); setOffset(0); };
  const onStatusChange = (v: EnterpriseAccountStatus | '') => { setStatusFilter(v); setOffset(0); };
  const onRoleChange = (v: EnterpriseAccountRole | '') => { setRoleFilter(v); setOffset(0); };

  const handleSetStatus = async (id: string, status: EnterpriseAccountStatus) => {
    setBusyId(id);
    try {
      await adminSetEnterpriseAccountStatus(id, status);
      toast.success('상태가 변경되었습니다');
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await adminSoftDeleteEnterpriseAccount(deleteTarget.id);
      toast.success('삭제되었습니다');
      setDeleteTarget(null);
      await load();
    } catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '전체 본사', value: kpi.total, tone: 'text-ink' },
      { label: '정상', value: kpi.active, tone: 'text-emerald-300' },
      { label: '초대중', value: kpi.invited, tone: 'text-sky-300' },
      { label: '정지', value: kpi.suspended, tone: 'text-amber-300' },
      { label: '최근 7일 로그인', value: kpi.recent_login_7d, tone: 'text-accent' },
    ];
  }, [kpi]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Building2 size={14} /> 본사 계정 관리
            <span className="text-[10px] font-normal text-ink-dim">(Enterprise Phase 1-1)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => setEditTarget('new')}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black hover:bg-accent/90">
              <Plus size={11} /> 본사 계정 추가
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          본사 담당자 정보를 관리합니다. 가입 전 invited 상태로 등록해두면 향후 자동 연동됩니다.
        </p>
      </div>

      {/* KPI */}
      {kpiCards && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="text-[10px] uppercase tracking-wider text-ink-dim">{c.label}</div>
              <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 검색/필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input type="text" placeholder="본사명/담당자/이메일/전화번호 검색"
            value={search} onChange={(e) => onSearchChange(e.target.value)}
            className="rounded bg-bg-deep pl-7 pr-2 py-1 w-64 max-w-full" />
        </div>
        <select value={statusFilter} onChange={(e) => onStatusChange(e.target.value as EnterpriseAccountStatus | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => onRoleChange(e.target.value as EnterpriseAccountRole | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 권한</option>
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="ml-auto text-ink-dim">{total}개 (페이지 {Math.floor(offset / PAGE_SIZE) + 1})</span>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {/* Table (desktop) + Cards (mobile) */}
      {loading && rows.length === 0 ? (
        <SkeletonRows />
      ) : !loading && rows.length === 0 && !error ? (
        <EmptyState onAdd={() => setEditTarget('new')} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-3 py-2">본사명</th>
                  <th className="px-3 py-2">담당자</th>
                  <th className="px-3 py-2">이메일</th>
                  <th className="px-3 py-2">전화</th>
                  <th className="px-3 py-2">권한</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">마지막 로그인</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                    <td className="px-3 py-2 font-semibold">{r.enterprise_name}</td>
                    <td className="px-3 py-2">{r.manager_name}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.manager_email}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.manager_phone ?? '—'}</td>
                    <td className="px-3 py-2"><RoleBadge role={r.role} /></td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-mute">
                      {r.last_login_at ? new Date(r.last_login_at).toLocaleDateString('ko-KR') : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowActions
                        row={r} busy={busyId === r.id}
                        onEdit={() => setEditTarget(r)}
                        onSetStatus={(s) => void handleSetStatus(r.id, s)}
                        onDelete={() => setDeleteTarget(r)}
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
              <div key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm">{r.enterprise_name}</div>
                    <div className="text-[11px] text-ink-mute">{r.manager_name}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-ink-mute">
                  <div className="flex items-center gap-1"><Mail size={10} /> {r.manager_email}</div>
                  {r.manager_phone && <div className="flex items-center gap-1"><Phone size={10} /> {r.manager_phone}</div>}
                  <div className="flex items-center gap-1"><RoleBadge role={r.role} /></div>
                  {r.last_login_at && (
                    <div className="text-[10px] text-ink-dim">
                      최근 로그인: {new Date(r.last_login_at).toLocaleDateString('ko-KR')}
                    </div>
                  )}
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
        <EditModal target={editTarget}
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
// Sub components
// =============================================================================

function StatusBadge({ status }: { status: EnterpriseAccountStatus }) {
  const map: Record<EnterpriseAccountStatus, { ko: string; cls: string }> = {
    active:    { ko: '정상',    cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
    invited:   { ko: '초대중',  cls: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
    suspended: { ko: '정지',    cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
    inactive:  { ko: '비활성',  cls: 'bg-ink/15 text-ink-mute ring-line/20' },
  };
  const v = map[status];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${v.cls}`}>{v.ko}</span>;
}

function RoleBadge({ role }: { role: EnterpriseAccountRole }) {
  const map: Record<EnterpriseAccountRole, { ko: string; cls: string }> = {
    owner:              { ko: '본사 최고관리자',  cls: 'bg-purple-500/15 text-purple-300' },
    admin:              { ko: '본사 관리자',      cls: 'bg-indigo-500/15 text-indigo-300' },
    enterprise_manager: { ko: '본사 담당자',      cls: 'bg-sky-500/15 text-sky-300' },
    viewer:             { ko: '조회 전용',        cls: 'bg-ink/15 text-ink-mute' },
  };
  const v = map[role];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v.ko}</span>;
}

function RowActions({
  row, busy, onEdit, onSetStatus, onDelete,
}: {
  row: EnterpriseAccount; busy: boolean;
  onEdit: () => void;
  onSetStatus: (s: EnterpriseAccountStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button onClick={onEdit} disabled={busy}
        title="편집"
        className="rounded bg-sky-500/20 p-1 hover:bg-sky-500/30 disabled:opacity-50">
        <Pencil size={11} className="text-sky-300" />
      </button>
      {row.status === 'active' ? (
        <button onClick={() => onSetStatus('suspended')} disabled={busy}
          title="정지"
          className="rounded bg-amber-500/20 p-1 hover:bg-amber-500/30 disabled:opacity-50">
          <Power size={11} className="text-amber-300" />
        </button>
      ) : (
        <button onClick={() => onSetStatus('active')} disabled={busy}
          title="활성화"
          className="rounded bg-emerald-500/20 p-1 hover:bg-emerald-500/30 disabled:opacity-50">
          <CheckCircle2 size={11} className="text-emerald-300" />
        </button>
      )}
      <button onClick={onDelete} disabled={busy}
        title="삭제"
        className="rounded bg-rose-500/20 p-1 hover:bg-rose-500/30 disabled:opacity-50">
        <Trash2 size={11} className="text-rose-300" />
      </button>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl bg-bg-card px-6 py-12 text-center">
      <Building2 size={32} className="mx-auto text-ink-dim" />
      <p className="mt-3 text-sm font-bold">등록된 본사 계정이 없습니다.</p>
      <p className="mt-1 text-[11px] text-ink-mute">첫 본사 계정을 추가해보세요.</p>
      <button onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1 rounded bg-accent px-3 py-2 text-xs font-bold text-black">
        <Plus size={12} /> 본사 계정 추가
      </button>
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
  target, onClose, onSaved,
}: { target: EnterpriseAccount | 'new'; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const t = isNew ? null : target;
  const [enterpriseName, setEnterpriseName] = useState(t?.enterprise_name ?? '');
  const [managerName, setManagerName] = useState(t?.manager_name ?? '');
  const [managerEmail, setManagerEmail] = useState(t?.manager_email ?? '');
  const [managerPhone, setManagerPhone] = useState(t?.manager_phone ?? '');
  const [role, setRole] = useState<EnterpriseAccountRole>(t?.role ?? 'enterprise_manager');
  const [status, setStatus] = useState<EnterpriseAccountStatus>(t?.status ?? 'active');
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const canSave = !!enterpriseName.trim() && !!managerName.trim() && !!managerEmail.trim();

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isNew) {
        await adminCreateEnterpriseAccount({
          enterpriseName: enterpriseName.trim(),
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim() || null,
          role, status, notes: notes.trim() || null,
        });
        toast.success('본사 계정이 추가되었습니다');
      } else if (t) {
        await adminUpdateEnterpriseAccount(t.id, {
          enterpriseName: enterpriseName.trim(),
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim(),
          role, status, notes: notes.trim(),
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
          <h3 className="text-sm font-bold">{isNew ? '본사 계정 추가' : '본사 계정 편집'}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>
        <div className="space-y-3">
          <Field label="본사명 *">
            <input value={enterpriseName} onChange={(e) => setEnterpriseName(e.target.value)} className="input" />
          </Field>
          <Field label="담당자명 *">
            <input value={managerName} onChange={(e) => setManagerName(e.target.value)} className="input" />
          </Field>
          <Field label="이메일 *">
            <input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} className="input" />
          </Field>
          <Field label="전화번호">
            <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)}
              placeholder="010-0000-0000" className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="권한">
              <select value={role} onChange={(e) => setRole(e.target.value as EnterpriseAccountRole)} className="input">
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="상태">
              <select value={status} onChange={(e) => setStatus(e.target.value as EnterpriseAccountStatus)} className="input">
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
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
}: { target: EnterpriseAccount; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-rose-500/15 p-2"><Trash2 size={18} className="text-rose-300" /></div>
          <div className="flex-1">
            <h3 className="text-sm font-bold">본사 계정 삭제</h3>
            <p className="mt-1 text-xs text-ink-mute">
              <b>{target.enterprise_name}</b> ({target.manager_email}) 계정을 삭제하시겠습니까?
            </p>
            <p className="mt-1 text-[10px] text-ink-dim">
              soft delete 로 처리되며 동일 이메일로 재등록 가능합니다.
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
            {busy ? '삭제 중…' : '삭제'}
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
