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
  Key, Copy, RotateCw, Wallet, FileText, Download, ThumbsUp, ThumbsDown,
  Save, Eye,
} from 'lucide-react';
import EnterpriseDetailModal from '@/components/admin/EnterpriseDetailModal';
import {
  adminGetEnterpriseSettlement,
  adminGetEnterpriseDocuments,
  adminUpdateEnterpriseSettlementStatus,
  adminUpdateEnterprisePaymentSettings,
  createEnterpriseDocumentSignedUrl,
  type AdminEnterpriseSettlementResult,
} from '@/lib/api/enterpriseHqApi';
import {
  SETTLEMENT_STATUS_LABEL, SETTLEMENT_METHOD_LABEL,
  type SettlementMethod,
} from '@/lib/enterprisePlaceholders';
import {
  adminListEnterpriseAccounts,
  adminCreateEnterpriseAccountV2,
  adminUpdateEnterpriseAccount,
  adminSetEnterpriseAccountStatus,
  adminSoftDeleteEnterpriseAccount,
  adminEnterpriseAccountKpi,
  adminRotateEnterpriseInviteCode,
  adminGetEnterpriseInviteSummary,
  type EnterpriseAccount,
  type EnterpriseAccountStatus,
  type EnterpriseAccountRole,
  type EnterpriseAccountKpi,
  type EnterpriseAccountV2CreateResult,
  type EnterpriseInviteCodeKind,
  type EnterpriseInviteSummary,
} from '@/lib/api/enterpriseAccountsApi';
import { toast } from '@/store/toastStore';
import { LastLoginBadge } from '@/components/admin/ui';

/**
 * 어드민 셸의 기존 ?tab= 딥링크 이동을 재사용한다(AdminPage 의 popstate 핸들러가 적용).
 * 라우트/탭 키를 변경하지 않고 기존 탭으로만 이동한다.
 */
function navigateAdminTab(tab: string) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.delete('enterpriseId');
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

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
  const [inviteTarget, setInviteTarget] = useState<EnterpriseAccount | null>(null);
  const [settlementTarget, setSettlementTarget] = useState<EnterpriseAccount | null>(null);
  const [detailTarget, setDetailTarget] = useState<EnterpriseAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 딥링크: /admin?tab=enterprise-accounts&enterpriseId=xxx → 해당 본사 상세 자동 오픈
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('enterpriseId'); } catch { return null; }
  });

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

  // 딥링크 enterpriseId 가 현재 목록에 있으면 상세 자동 오픈
  useEffect(() => {
    if (!pendingDetailId) return;
    const match = rows.find((r) => r.id === pendingDetailId);
    if (match) { setDetailTarget(match); setPendingDetailId(null); }
  }, [pendingDetailId, rows]);

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
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
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
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.enterprise_name}</div>
                      {r.brand_code && (
                        <div className="text-[10px] text-ink-dim font-mono">{r.brand_code}</div>
                      )}
                      {!r.onboarding_enabled && (
                        <div className="text-[10px] text-amber-300">초대 가입 OFF</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.manager_name}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.manager_email}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.manager_phone ?? '—'}</td>
                    <td className="px-3 py-2"><RoleBadge role={r.role} /></td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right text-[11px]">
                      <LastLoginBadge iso={r.last_login_at} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowActions
                        row={r} busy={busyId === r.id}
                        onDetail={() => setDetailTarget(r)}
                        onEdit={() => setEditTarget(r)}
                        onInvite={() => setInviteTarget(r)}
                        onSettlement={() => setSettlementTarget(r)}
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
                  <div className="text-[10px]">
                    <span className="text-ink-dim">최근 로그인: </span>
                    <LastLoginBadge iso={r.last_login_at} layout="mobile" />
                  </div>
                </div>
                {r.brand_code && (
                  <div className="mt-1 text-[10px] text-ink-dim font-mono">{r.brand_code}</div>
                )}
                <div className="mt-2 flex gap-1">
                  <button onClick={() => setInviteTarget(r)}
                    className="rounded bg-accent/20 px-2 py-1 text-[11px] font-bold text-accent">
                    초대코드
                  </button>
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
      {inviteTarget && (
        <InviteCodesModal target={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onRotated={() => { void load(); }} />
      )}
      {settlementTarget && (
        <SettlementReviewModal target={settlementTarget}
          onClose={() => setSettlementTarget(null)}
          onReviewed={() => { void load(); }} />
      )}
      {detailTarget && (
        <EnterpriseDetailModal
          enterpriseId={detailTarget.id}
          enterpriseName={detailTarget.enterprise_name}
          onClose={() => setDetailTarget(null)}
          actions={{
            // 준비 보드 → 기존 지원 Dialog/화면으로 즉시 이동(신규 백엔드 없음).
            // 상세 모달을 닫고 대상 Dialog 를 열어 모달 중첩을 피한다.
            onManageInvite: () => { const t = detailTarget; setDetailTarget(null); setInviteTarget(t); },
            onReviewSettlement: () => { const t = detailTarget; setDetailTarget(null); setSettlementTarget(t); },
            onManageRegions: () => { setDetailTarget(null); navigateAdminTab('enterprise-regions'); },
          }} />
      )}
    </div>
  );
}

// =============================================================================
// Sub components
// =============================================================================

function StatusBadge({ status }: { status: EnterpriseAccountStatus }) {
  const map: Record<EnterpriseAccountStatus, { ko: string; cls: string }> = {
    active:    { ko: '정상',    cls: 'bg-emerald-500/25 text-emerald-300 ring-emerald-500/50' },
    invited:   { ko: '초대중',  cls: 'bg-sky-500/25 text-sky-300 ring-sky-500/50' },
    suspended: { ko: '정지',    cls: 'bg-amber-500/25 text-amber-300 ring-amber-500/50' },
    inactive:  { ko: '비활성',  cls: 'bg-ink/15 text-ink-mute ring-line/20' },
  };
  const v = map[status];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${v.cls}`}>{v.ko}</span>;
}

function RoleBadge({ role }: { role: EnterpriseAccountRole }) {
  const map: Record<EnterpriseAccountRole, { ko: string; cls: string }> = {
    owner:              { ko: '본사 최고관리자',  cls: 'bg-purple-500/25 text-purple-300' },
    admin:              { ko: '본사 관리자',      cls: 'bg-indigo-500/25 text-indigo-300' },
    enterprise_manager: { ko: '본사 담당자',      cls: 'bg-sky-500/25 text-sky-300' },
    viewer:             { ko: '조회 전용',        cls: 'bg-ink/15 text-ink-mute' },
  };
  const v = map[role];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v.ko}</span>;
}

// last_login 표시는 LastLoginBadge (@/components/admin/ui) 사용 — 디자인 시스템 v2 (PR #197 helper 대체).

function RowActions({
  row, busy, onDetail, onEdit, onInvite, onSettlement, onSetStatus, onDelete,
}: {
  row: EnterpriseAccount; busy: boolean;
  onDetail: () => void;
  onEdit: () => void;
  onInvite: () => void;
  onSettlement: () => void;
  onSetStatus: (s: EnterpriseAccountStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button onClick={onDetail}
        title="상세보기"
        className="rounded bg-indigo-500/20 p-1 hover:bg-indigo-500/30">
        <Eye size={11} className="text-indigo-300" />
      </button>
      <button onClick={onSettlement} disabled={busy}
        title="정산 검토"
        className="rounded bg-emerald-500/20 p-1 hover:bg-emerald-500/30 disabled:opacity-50">
        <Wallet size={11} className="text-emerald-300" />
      </button>
      <button onClick={onInvite} disabled={busy}
        title="초대코드 관리"
        className="rounded bg-accent/20 p-1 hover:bg-accent/30 disabled:opacity-50">
        <Key size={11} className="text-accent" />
      </button>
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

  // Phase 1-6 — 신규 생성 시 자동 코드 + (옵션) brand_code / franchise_name
  const [brandCode, setBrandCode] = useState('');
  const [franchiseName, setFranchiseName] = useState('');

  const [saving, setSaving] = useState(false);
  const [createdCodes, setCreatedCodes] = useState<EnterpriseAccountV2CreateResult | null>(null);

  const canSave = !!enterpriseName.trim() && !!managerName.trim() && !!managerEmail.trim();

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isNew) {
        // v2 — 자동 코드 생성 + 옵션 franchise 매핑
        const r = await adminCreateEnterpriseAccountV2({
          enterpriseName: enterpriseName.trim(),
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim() || null,
          role, status, notes: notes.trim() || null,
          brandCode: brandCode.trim().toUpperCase() || null,
          franchiseName: franchiseName.trim() || null,
        });
        toast.success('본사 계정이 추가되었습니다');
        setCreatedCodes(r);  // 성공 화면으로 전환 — 코드 표시
        return;
      }
      if (t) {
        await adminUpdateEnterpriseAccount(t.id, {
          enterpriseName: enterpriseName.trim(),
          managerName: managerName.trim(),
          managerEmail: managerEmail.trim(),
          managerPhone: managerPhone.trim(),
          role, status, notes: notes.trim(),
        });
        toast.success('수정되었습니다');
        onSaved();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // 생성 성공 후 코드 확인 화면
  if (createdCodes) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => { onSaved(); }}>
        <div onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">엔터프라이즈가 생성되었습니다</h3>
            <button onClick={() => { onSaved(); }} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
          </div>
          <p className="text-[11px] text-ink-mute">
            아래 초대코드를 본사 담당자/매장에게 전달하세요. 이후 본사 계정 목록의 키 아이콘에서 다시 확인할 수 있습니다.
          </p>
          <div className="mt-3 space-y-2">
            {createdCodes.codes.brand_code && (
              <CodeRow label="브랜드 코드" value={createdCodes.codes.brand_code} />
            )}
            {createdCodes.codes.hq_invite_code && (
              <CodeRow label="본사 담당자 가입 코드" value={createdCodes.codes.hq_invite_code}
                       hint="본사 담당자 가입용 코드입니다." />
            )}
            {createdCodes.codes.store_invite_code && (
              <CodeRow label="매장 가입 코드" value={createdCodes.codes.store_invite_code}
                       hint="매장 계정이 가입할 때 사용하는 코드입니다." />
            )}
          </div>
          <button onClick={() => { onSaved(); }}
            className="mt-4 w-full rounded bg-accent px-3 py-2 font-bold text-black hover:bg-accent/90">
            확인
          </button>
        </div>
      </div>
    );
  }

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
          {isNew && (
            <>
              <hr className="border-line/10" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent">초대 온보딩 (선택)</p>
              <Field label="브랜드 코드 (선택)">
                <input value={brandCode}
                  onChange={(e) => setBrandCode(e.target.value)}
                  placeholder="예: KUU (비우면 자동 생성)"
                  className="input font-mono uppercase" />
                <span className="block text-[11px] text-ink-dim mt-1">
                  초대코드 prefix 로 사용. 비워두면 ENT-/STORE- 형식 자동 생성.
                </span>
              </Field>
              <Field label="프랜차이즈명 (비워두면 본사명으로 자동 생성)">
                <input value={franchiseName} onChange={(e) => setFranchiseName(e.target.value)}
                  placeholder="예: 쿠우쿠우 본사"
                  className="input" />
                <span className="block text-[11px] text-ink-dim mt-1">
                  매장 초대코드 가입의 연결 대상. 비워두면 본사명으로 자동 생성됩니다 (0373 trigger).
                </span>
              </Field>
            </>
          )}
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

// =============================================================================
// Invite Codes Modal — 코드 확인 / 복사 / 재발급
// =============================================================================

function InviteCodesModal({
  target, onClose, onRotated,
}: { target: EnterpriseAccount; onClose: () => void; onRotated: () => void }) {
  const [summary, setSummary] = useState<EnterpriseInviteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState<EnterpriseInviteCodeKind | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGetEnterpriseInviteSummary(target.id);
      setSummary(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [target.id]);

  useEffect(() => { void load(); }, [load]);

  const handleRotate = async (kind: EnterpriseInviteCodeKind) => {
    const label = kind === 'hq' ? '본사' : kind === 'store' ? '매장' : '본사+매장';
    if (!confirm(`${label} 초대코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.`)) return;
    setRotating(kind);
    try {
      const r = await adminRotateEnterpriseInviteCode({
        enterpriseAccountId: target.id, codeType: kind,
      });
      if (r.success) {
        toast.success(`${label} 초대코드가 재발급되었습니다.`);
        await load();
        onRotated();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRotating(null);
    }
  };

  const ea = summary?.enterprise_account ?? target;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Key size={14} /> 초대코드 — {ea.enterprise_name}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>

        {loading && <div className="space-y-2"><div className="h-10 animate-pulse rounded bg-bg-deep" /><div className="h-10 animate-pulse rounded bg-bg-deep" /></div>}

        {error && (
          <div className="rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
            <AlertCircle size={12} className="inline mr-1" />{error}
            <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 ml-2 font-bold">재시도</button>
          </div>
        )}

        {summary && !loading && (
          <div className="space-y-3">
            <div className="rounded bg-bg-deep p-3 space-y-2">
              {ea.brand_code && <CodeRow label="브랜드 코드" value={ea.brand_code} />}
              {ea.hq_invite_code && (
                <CodeRowWithAction
                  label="본사 담당자 가입 코드"
                  value={ea.hq_invite_code}
                  hint="본사 담당자 가입용 코드입니다."
                  onRotate={() => void handleRotate('hq')}
                  rotating={rotating === 'hq'}
                />
              )}
              {ea.store_invite_code && (
                <CodeRowWithAction
                  label="매장 가입 코드"
                  value={ea.store_invite_code}
                  hint="매장 계정이 가입할 때 사용하는 코드입니다."
                  onRotate={() => void handleRotate('store')}
                  rotating={rotating === 'store'}
                />
              )}
              {!ea.hq_invite_code && !ea.store_invite_code && (
                <p className="text-[11px] text-ink-mute">
                  초대코드가 아직 발급되지 않았습니다. "본사+매장 재발급"으로 동시 생성하세요.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button
                disabled={rotating !== null}
                onClick={() => void handleRotate('both')}
                className="flex-1 rounded bg-accent/15 px-3 py-2 font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25 disabled:opacity-50"
              >
                <RotateCw size={11} className={`inline mr-1 ${rotating === 'both' ? 'animate-spin' : ''}`} />
                본사+매장 한꺼번에 재발급
              </button>
            </div>

            <div className="rounded bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-1">연결 상태</p>
              <ul className="space-y-1 text-[11px]">
                <li>온보딩 활성화: <b>{ea.onboarding_enabled ? 'ON' : 'OFF'}</b></li>
                <li>지역 자율 등록: <b>{ea.allow_self_register_region ? '허용' : '비허용'}</b></li>
                <li>연결 프랜차이즈: <b>{summary.franchises.length}개</b></li>
                <li>등록 지역: <b>{summary.regions.length}개</b></li>
                <li>매장 수: <b>{summary.store_count}개</b></li>
                {ea.invite_code_rotated_at && (
                  <li className="text-ink-mute">
                    마지막 재발급: {new Date(ea.invite_code_rotated_at).toLocaleString('ko-KR')}
                  </li>
                )}
              </ul>
            </div>

            {summary.recent_claims.length > 0 && (
              <div className="rounded bg-bg-deep p-3">
                <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-1">최근 가입 시도 (최신 5개)</p>
                <ul className="space-y-1 text-[11px]">
                  {summary.recent_claims.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className={`inline-block w-12 rounded px-1 text-[10px] text-center ${
                        c.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                        c.status === 'failed' ? 'bg-rose-500/20 text-rose-300' :
                        'bg-amber-500/20 text-amber-300'
                      }`}>{c.status}</span>
                      <span className="text-ink-dim w-8 text-[10px]">{c.claim_type === 'hq_admin' ? '본사' : '매장'}</span>
                      <span className="flex-1 truncate">
                        {c.store_name_input || c.brand_name_input || '—'}
                        {c.region_name_input && ` · ${c.region_name_input}`}
                      </span>
                      <span className="text-ink-dim text-[10px]">
                        {new Date(c.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CodeRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-sm font-semibold">{value}</code>
        <button
          type="button"
          onClick={() => { void navigator.clipboard.writeText(value).then(() => toast.success('복사됨')).catch(() => toast.error('복사 실패')); }}
          className="rounded bg-bg p-1.5 hover:bg-bg-hover"
          title="복사"
        >
          <Copy size={11} />
        </button>
      </div>
      {hint && <p className="mt-1 text-[10px] text-ink-dim">{hint}</p>}
    </div>
  );
}

function CodeRowWithAction({
  label, value, hint, onRotate, rotating,
}: {
  label: string; value: string; hint?: string;
  onRotate: () => void; rotating: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-sm font-semibold">{value}</code>
        <button
          type="button"
          onClick={() => { void navigator.clipboard.writeText(value).then(() => toast.success('복사됨')).catch(() => toast.error('복사 실패')); }}
          className="rounded bg-bg p-1.5 hover:bg-bg-hover"
          title="복사"
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          onClick={onRotate}
          disabled={rotating}
          className="rounded bg-amber-500/25 p-1.5 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
          title="재발급"
        >
          <RotateCw size={11} className={rotating ? 'animate-spin' : ''} />
        </button>
      </div>
      {hint && <p className="mt-1 text-[10px] text-ink-dim">{hint}</p>}
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
          <div className="rounded-full bg-rose-500/25 p-2"><Trash2 size={18} className="text-rose-300" /></div>
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


// =============================================================================
// Phase 1-8 — Settlement Review Modal (admin)
// =============================================================================

function SettlementReviewModal({
  target, onClose, onReviewed,
}: { target: EnterpriseAccount; onClose: () => void; onReviewed: () => void }) {
  const [data, setData] = useState<AdminEnterpriseSettlementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businessLicensePath, setBusinessLicensePath] = useState<string | null>(null);
  const [bankbookPath, setBankbookPath] = useState<string | null>(null);
  // Phase 1-10 마무리 — 이번 달 예상 정산금 미리보기용 활성 매장 수.
  // 기존 admin_get_enterprise_invite_summary RPC 재사용 (store_count = fs.status='active').
  const [activeStoreCount, setActiveStoreCount] = useState<number | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, docs, invite] = await Promise.all([
        adminGetEnterpriseSettlement(target.id),
        adminGetEnterpriseDocuments(target.id),
        adminGetEnterpriseInviteSummary(target.id).catch(() => null),
      ]);
      setData(summary);
      setBusinessLicensePath(docs.business_license_path);
      setBankbookPath(docs.bankbook_path);
      setActiveStoreCount(invite?.store_count ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [target.id]);
  useEffect(() => { void load(); }, [load]);

  const openSigned = async (path: string | null) => {
    if (!path) { toast.error('등록된 파일이 없습니다.'); return; }
    try {
      const url = await createEnterpriseDocumentSignedUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onApprove = async () => {
    if (!confirm('정산 정보를 승인하시겠습니까?')) return;
    setActing(true);
    try {
      await adminUpdateEnterpriseSettlementStatus({
        enterpriseAccountId: target.id, status: 'approved',
      });
      toast.success('승인 완료');
      await load();
      onReviewed();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  const onReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('반려 사유를 입력하세요.');
      return;
    }
    setActing(true);
    try {
      await adminUpdateEnterpriseSettlementStatus({
        enterpriseAccountId: target.id, status: 'rejected', rejectionReason: rejectReason.trim(),
      });
      toast.success('반려 처리됨');
      setRejectMode(false);
      setRejectReason('');
      await load();
      onReviewed();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  const ea = data?.enterprise_account ?? null;
  const business = data?.business_profile ?? null;
  const settlement = data?.settlement ?? null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Wallet size={14} /> 정산 검토 — {ea?.enterprise_name ?? target.enterprise_name}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>

        {loading && <div className="h-40 animate-pulse rounded bg-bg-deep" />}
        {error && (
          <div className="rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
            <AlertCircle size={12} className="inline mr-1" />{error}
            <button onClick={() => void load()} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-4 text-xs">
            {/* 사업자 정보 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">사업자 정보</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <KV k="회사명" v={business?.company_name} />
                <KV k="사업자번호" v={business?.business_number} />
                <KV k="대표자" v={business?.representative_name} />
                <KV k="주소" v={business?.business_address} colSpan />
                <KV k="담당 연락처" v={business?.contact_phone} />
                <KV k="세금계산서 이메일" v={business?.tax_invoice_email} />
                <KV k="정산 담당자" v={business?.settlement_contact_name} />
                <KV k="정산 담당자 연락처" v={business?.settlement_contact_phone} />
                <KV k="정산 담당자 이메일" v={business?.settlement_contact_email} colSpan />
              </dl>
            </div>

            {/* 정산 정보 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">정산 정보 (admin 전체 조회)</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <KV k="은행" v={settlement?.bank_name} />
                <KV k="예금주" v={settlement?.account_holder} />
                <KV k="계좌번호" v={settlement?.account_number} mono colSpan />
                <KV k="제출일"
                  v={settlement?.submitted_at ? new Date(settlement.submitted_at).toLocaleString('ko-KR') : null} colSpan />
              </dl>
            </div>

            {/* Phase 1-9 §3 + 1-10 §2/§3 — 지급 설정 + 수수료율 + 매장당 단가 (admin 만 수정) */}
            <PaymentSettingsEditor
              enterpriseAccountId={target.id}
              currentMethod={settlement?.settlement_method ?? 'monthly'}
              currentMinimumPayout={settlement?.minimum_payout ?? 0}
              currentCommissionRate={settlement?.commission_rate ?? 20}
              currentMonthlyStorePrice={settlement?.monthly_store_price ?? 4900}
              activeStoreCount={activeStoreCount ?? 0}
              onSaved={() => { void load(); onReviewed(); }}
            />

            {/* 증빙 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">증빙서류 (Signed URL 10분 만료)</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void openSigned(businessLicensePath)}
                  disabled={!businessLicensePath}
                  className="flex items-center justify-center gap-1 rounded bg-bg-card px-3 py-2 font-semibold hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FileText size={12} /> 사업자등록증
                  {businessLicensePath ? <Download size={11} /> : <span className="text-[10px] text-ink-dim">(미등록)</span>}
                </button>
                <button
                  type="button"
                  onClick={() => void openSigned(bankbookPath)}
                  disabled={!bankbookPath}
                  className="flex items-center justify-center gap-1 rounded bg-bg-card px-3 py-2 font-semibold hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FileText size={12} /> 통장사본
                  {bankbookPath ? <Download size={11} /> : <span className="text-[10px] text-ink-dim">(미등록)</span>}
                </button>
              </div>
            </div>

            {/* 상태 + 액션 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">정산 상태</p>
              {settlement ? (
                <SettlementStatusInline status={settlement.settlement_status} />
              ) : (
                <span className="text-[11px] text-ink-mute">{SETTLEMENT_STATUS_LABEL.unregistered}</span>
              )}
              {settlement?.rejection_reason && (
                <p className="mt-1 text-[11px] text-rose-300">반려 사유: {settlement.rejection_reason}</p>
              )}
              {settlement?.reviewed_at && (
                <p className="mt-1 text-[10px] text-ink-dim">
                  검토 시각: {new Date(settlement.reviewed_at).toLocaleString('ko-KR')}
                </p>
              )}

              {!rejectMode ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void onApprove()}
                    disabled={acting || !settlement}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-emerald-500/20 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-30"
                  >
                    <ThumbsUp size={12} /> 승인
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectMode(true)}
                    disabled={acting || !settlement}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-rose-500/20 px-3 py-2 font-bold text-rose-300 hover:bg-rose-500/30 disabled:opacity-30"
                  >
                    <ThumbsDown size={12} /> 반려
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="반려 사유를 입력하세요 (HQ 가 확인 후 재제출)"
                    className="w-full rounded bg-bg px-2 py-1.5 text-xs min-h-[60px]"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => void onReject()} disabled={acting || !rejectReason.trim()}
                      className="flex-1 rounded bg-rose-500/30 px-3 py-2 font-bold text-slate-900 dark:text-rose-200 disabled:opacity-30">
                      반려 처리
                    </button>
                    <button onClick={() => { setRejectMode(false); setRejectReason(''); }}
                      className="rounded bg-bg-card px-3 py-2 font-bold hover:bg-bg-hover">취소</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ k, v, colSpan, mono }: { k: string; v: string | null | undefined; colSpan?: boolean; mono?: boolean }) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <dt className="text-[10px] text-ink-dim">{k}</dt>
      <dd className={mono ? 'font-mono text-[11px]' : 'text-[11px]'}>{v ?? '—'}</dd>
    </div>
  );
}

function SettlementStatusInline({ status }: { status: 'unregistered' | 'reviewing' | 'approved' | 'rejected' }) {
  const map = {
    unregistered: 'bg-ink/10 text-ink-mute',
    reviewing:    'bg-amber-500/25 text-amber-300',
    approved:     'bg-emerald-500/25 text-emerald-300',
    rejected:     'bg-rose-500/25 text-rose-300',
  } as const;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${map[status]}`}>
      {SETTLEMENT_STATUS_LABEL[status]}
    </span>
  );
}


// =============================================================================
// Phase 1-9 §3 — Payment Settings Editor (admin only)
//   계약 조건이므로 관리자만 변경 가능. HQ 화면에서는 read-only 표시.
// =============================================================================

function PaymentSettingsEditor({
  enterpriseAccountId, currentMethod, currentMinimumPayout,
  currentCommissionRate, currentMonthlyStorePrice, activeStoreCount, onSaved,
}: {
  enterpriseAccountId: string;
  currentMethod: SettlementMethod;
  currentMinimumPayout: number;
  currentCommissionRate: number;
  currentMonthlyStorePrice: number;
  /** Phase 1-10 마무리 — 이번 달 예상 정산금 계산용 활성 매장 수. 미제공 시 0. */
  activeStoreCount: number;
  onSaved: () => void;
}) {
  const [method, setMethod] = useState<SettlementMethod>(currentMethod);
  const [minimumPayout, setMinimumPayout] = useState<string>(String(currentMinimumPayout));
  const [commissionRate, setCommissionRate] = useState<string>(String(currentCommissionRate));
  const [monthlyStorePrice, setMonthlyStorePrice] = useState<string>(String(currentMonthlyStorePrice));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMethod(currentMethod);
    setMinimumPayout(String(currentMinimumPayout));
    setCommissionRate(String(currentCommissionRate));
    setMonthlyStorePrice(String(currentMonthlyStorePrice));
  }, [currentMethod, currentMinimumPayout, currentCommissionRate, currentMonthlyStorePrice]);

  const dirty =
    method !== currentMethod
    || Number(minimumPayout) !== currentMinimumPayout
    || Number(commissionRate) !== currentCommissionRate
    || Number(monthlyStorePrice) !== currentMonthlyStorePrice;

  // Phase 1-10 §3 — 실시간 미리보기 (단가도 본사별)
  const rateNum  = Number(commissionRate);
  const priceNum = Number(monthlyStorePrice);
  const priceValid = Number.isFinite(priceNum) && priceNum >= 0;
  const rateValid  = Number.isFinite(rateNum)  && rateNum  >= 0 && rateNum <= 100;
  const previewPerStore = priceValid && rateValid
    ? Math.floor((priceNum * rateNum) / 100)
    : 0;

  const onSave = async () => {
    const minNum = parseInt(minimumPayout, 10);
    if (Number.isNaN(minNum) || minNum < 0) {
      toast.error('최소 지급금액은 0 이상 숫자여야 합니다.');
      return;
    }
    if (!rateValid) {
      toast.error('수수료율은 0~100 사이 숫자여야 합니다.');
      return;
    }
    if (!priceValid) {
      toast.error('매장당 기준 금액은 0 이상 숫자여야 합니다.');
      return;
    }
    setSaving(true);
    try {
      await adminUpdateEnterprisePaymentSettings({
        enterpriseAccountId,
        settlementMethod: method,
        minimumPayout: minNum,
        commissionRate: rateNum,
        monthlyStorePrice: Math.floor(priceNum),
      });
      toast.success('지급 설정이 저장되었습니다.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg bg-bg-deep p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">
        지급 설정 (계약 조건 — admin 만 수정)
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">정산 방식</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as SettlementMethod)}
            disabled={saving}
            className="w-full rounded bg-bg px-2 py-1.5 text-xs"
          >
            <option value="monthly">{SETTLEMENT_METHOD_LABEL.monthly}</option>
            <option value="weekly">{SETTLEMENT_METHOD_LABEL.weekly}</option>
            <option value="manual">{SETTLEMENT_METHOD_LABEL.manual}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">최소 지급금액 (원)</span>
          <input
            type="number" min={0} step={1000}
            value={minimumPayout}
            onChange={(e) => setMinimumPayout(e.target.value)}
            disabled={saving}
            className="w-full rounded bg-bg px-2 py-1.5 text-xs tabular-nums"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">매장당 기준 금액 (원)</span>
          <input
            type="number" min={0} step={100}
            value={monthlyStorePrice}
            onChange={(e) => setMonthlyStorePrice(e.target.value)}
            disabled={saving}
            className="w-full rounded bg-bg px-2 py-1.5 text-xs tabular-nums"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">수수료율 (%)</span>
          <input
            type="number" min={0} max={100} step={0.5}
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            disabled={saving}
            className="w-full rounded bg-bg px-2 py-1.5 text-xs tabular-nums"
          />
        </label>
      </div>
      <p className="mt-2 text-[10px] text-ink-dim">
        매장당 정산금 미리보기: {(priceValid ? priceNum : 0).toLocaleString('ko-KR')}원 ×
        {' '}{rateValid ? rateNum : 0}% =
        {' '}<b className="text-emerald-300">{previewPerStore.toLocaleString('ko-KR')}원</b> / 매장
      </p>
      {/* Phase 1-10 마무리 — 이번 달 예상 정산금 (활성 매장 × 매장당 정산금) */}
      <p className="mt-1 text-[10px] text-ink-dim">
        이번 달 예상 정산금: 활성 매장 {activeStoreCount.toLocaleString('ko-KR')}개 × {previewPerStore.toLocaleString('ko-KR')}원 =
        {' '}<b className="text-emerald-300">{(activeStoreCount * previewPerStore).toLocaleString('ko-KR')}원</b>
      </p>
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={saving || !dirty}
        className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded bg-accent px-3 py-2 text-xs font-bold text-bg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
        {saving ? '저장 중…' : '지급 설정 저장'}
      </button>
    </div>
  );
}
