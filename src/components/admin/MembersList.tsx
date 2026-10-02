import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  fetchMemberList,
  updateUserRole,
  updateUserPlan,
  memberCategory,
  type MemberRow,
  type MemberCategory,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import MemberDetail from './MemberDetail';
import {
  AdminEmpty, AdminTable, FilterBar, ConfirmDialog, type AdminTableColumn,
} from './ui';

const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  personal: '일반',
  individual: '일반', // 0040 — 신규 표준 plan_type
  business: '사업자',
};

function fmtTime(s: number): string {
  if (!s) return '0분';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}시간 ${m % 60}분`;
  return `${m}분`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
  });
}

// 0491 — 회원 유형 배지 (아티스트 / 본사 / 가맹 / 사업자 / 일반)
const CATEGORY_BADGE: Record<MemberCategory, { label: string; className: string }> = {
  artist: { label: '🎤 아티스트', className: 'bg-purple-500/15 text-purple-500 dark:text-purple-300 ring-purple-400/20' },
  hq: { label: '🏢 본사', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-amber-400/25' },
  franchise: { label: '🏬 가맹', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-sky-400/25' },
  business: { label: '🏪 사업자', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-400/25' },
  individual: { label: '👤 일반', className: 'bg-ink/5 text-ink-mute ring-line/10' },
};

export default function MembersList() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [category, setCategory] = useState<'' | MemberCategory>('');
  const [status, setStatus] = useState<'' | 'active' | 'withdrawn' | 'cancel_scheduled'>('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<AdminError | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemberList({
        search: search || undefined,
        plan: plan || undefined,
        role: role || undefined,
        status: status || undefined,
        category: category || undefined,
      });
      setRows(data);
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, role, status, category]);

  // 검색은 디바운스
  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // 탭 복귀 / 윈도우 포커스 시 최신 refetch
  useEffect(() => {
    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeRole(id: string, newRole: 'user' | 'admin') {
    try {
      await updateUserRole(id, newRole);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, role: newRole } : r)));
      toast.success('권한이 변경됐어요.');
    } catch (e) {
      toast.error(friendlyError(e, '변경 실패'));
    }
  }

  async function changePlan(id: string, newPlan: 'free' | 'personal' | 'individual' | 'business') {
    try {
      await updateUserPlan(id, newPlan);
      // updateUserPlan 은 subscription_type 과 membership_tier 를 함께 갱신(personal→individual)하므로
      // 낙관적 로컬 상태도 두 필드를 일치시킨다 (재조회 전 desync 방지).
      const tier: MemberRow['membership_tier'] =
        newPlan === 'personal' || newPlan === 'individual' ? 'individual' : newPlan === 'business' ? 'business' : 'free';
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, subscription_type: newPlan, membership_tier: tier } : r,
        ),
      );
      toast.success('플랜이 변경됐어요.');
    } catch (e) {
      toast.error(friendlyError(e, '변경 실패'));
    }
  }

  // 권한·플랜 변경은 select 를 건드리는 순간 바로 반영됐다 — 오클릭 한 번으로 회원이
  // 관리자가 되거나 플랜이 바뀐다. 실행 전에 "누구를 무엇으로" 를 보여준다.
  const [roleChange, setRoleChange] = useState<{ row: MemberRow; next: 'user' | 'admin' } | null>(null);
  const [planChange, setPlanChange] = useState<
    { row: MemberRow; next: 'free' | 'personal' | 'individual' | 'business' } | null
  >(null);
  const [acting, setActing] = useState(false);

  const memberLabel = (m: MemberRow) => m.nickname || m.email || m.id.slice(0, 8);

  const activeFilters =
    (search.trim() ? 1 : 0) + (category ? 1 : 0) + (plan ? 1 : 0) + (role ? 1 : 0) + (status ? 1 : 0);

  const columns = useMemo<AdminTableColumn<MemberRow>[]>(() => [
    {
      key: 'member',
      header: '회원',
      cell: (m) => (
        <>
          <p className="font-medium">{m.nickname || '—'}</p>
          <p className="text-xs text-ink-mute">{m.email ?? m.id.slice(0, 8)}</p>
        </>
      ),
    },
    {
      key: 'category',
      header: '유형',
      cell: (m) => {
        const cat = memberCategory(m);
        const badge = CATEGORY_BADGE[cat];
        return (
          <>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${badge.className}`}>
              {badge.label}
            </span>
            {(m.is_enterprise_hq || m.is_franchise_store) && m.enterprise_name && (
              <span className="ml-1 inline-flex rounded-full bg-ink/5 px-1.5 py-0.5 text-[9px] font-medium text-ink-mute ring-1 ring-line/10">
                {m.enterprise_name}
              </span>
            )}
            {m.account_type === 'artist' && m.plan_type === 'student_artist' && (
              <span className="ml-1 inline-flex rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                PRO
              </span>
            )}
            {m.account_type === 'artist' && m.plan_type === 'general_artist' && (
              <span className="ml-1 inline-flex rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 dark:text-zinc-300">
                일반
              </span>
            )}
            {m.account_type === 'artist' && !m.plan_type && (
              <span className="ml-1 inline-flex rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                legacy
              </span>
            )}
            {m.signup_completed === false && (
              <span className="ml-1 inline-flex rounded-full bg-yellow-500/25 px-1.5 py-0.5 text-[9px] text-slate-900 dark:text-yellow-200">
                미완료
              </span>
            )}
            {m.withdrawn_at && (
              <span className="ml-1 inline-flex rounded-full bg-rose-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900 dark:text-red-200">
                탈퇴
              </span>
            )}
            {!m.withdrawn_at && m.has_cancel_scheduled && (
              <span className="ml-1 inline-flex rounded-full bg-yellow-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900 dark:text-yellow-200">
                취소 예정
              </span>
            )}
            {m.has_promotion && (
              <span className="ml-1 inline-flex rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                프로모션
              </span>
            )}
          </>
        );
      },
    },
    {
      key: 'role',
      header: '권한',
      cell: (m) => (
        <div onClick={(e) => e.stopPropagation()}>
          <select
            value={m.role}
            aria-label={`${memberLabel(m)} 권한`}
            onChange={(e) => {
              const next = e.target.value as 'user' | 'admin';
              if (next !== m.role) setRoleChange({ row: m, next });
            }}
            className="rounded bg-bg-soft px-2 py-1 text-xs"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
      ),
    },
    {
      key: 'plan',
      header: '플랜',
      cell: (m) => {
        const current = m.subscription_type === 'personal' ? 'individual' : m.subscription_type;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <select
              value={current}
              aria-label={`${memberLabel(m)} 플랜`}
              onChange={(e) => {
                const next = e.target.value as 'free' | 'personal' | 'individual' | 'business';
                if (next !== current) setPlanChange({ row: m, next });
              }}
              className="rounded bg-bg-soft px-2 py-1 text-xs"
            >
              <option value="free">{PLAN_LABEL.free}</option>
              <option value="individual">{PLAN_LABEL.individual}</option>
              <option value="business">{PLAN_LABEL.business}</option>
            </select>
          </div>
        );
      },
    },
    {
      key: 'verified',
      header: '인증',
      cell: (m) => (
        <div className="flex flex-wrap gap-1 text-[10px]">
          {m.identity_verified && (
            <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-emerald-300">본인 ✓</span>
          )}
          {m.business_verified && (
            <span className="rounded-full bg-sky-500/25 px-1.5 py-0.5 text-sky-300">사업자 ✓</span>
          )}
          {!m.identity_verified && !m.business_verified && <span className="text-ink-dim">—</span>}
        </div>
      ),
    },
    {
      key: 'streams',
      header: '스트리밍',
      align: 'right',
      tdClassName: 'text-xs tabular-nums',
      cell: (m) => m.total_streams,
    },
    {
      key: 'listened',
      header: '청취',
      align: 'right',
      tdClassName: 'text-xs tabular-nums text-ink-mute',
      cell: (m) => (
        <span
          title={`정산 기준(검증) ${fmtTime(m.total_verified_seconds)} — 화면이 꺼진 매장은 실제 재생보다 작게 잡힙니다`}
        >
          {fmtTime(m.total_listened_seconds)}
        </span>
      ),
    },
    {
      key: 'created',
      header: '가입일',
      align: 'right',
      tdClassName: 'text-xs text-ink-mute',
      cell: (m) => fmtDate(m.created_at),
    },
  ], []);

  if (error) return <AdminErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">회원관리</h2>
          <p className="text-xs text-ink-mute">{rows.length}명 표시 중</p>
        </div>
      </div>

      <FilterBar
        search={
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이메일 또는 닉네임 검색"
              aria-label="회원 검색"
              className="input w-full pl-9 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-dim hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>
        }
        filters={
          <>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as '' | MemberCategory)}
              aria-label="회원 유형"
              className="input w-auto text-sm"
            >
              <option value="">전체 유형</option>
              <option value="artist">아티스트</option>
              <option value="hq">본사</option>
              <option value="franchise">가맹</option>
              <option value="business">사업자</option>
              <option value="individual">일반</option>
            </select>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="플랜" className="input w-auto text-sm">
              <option value="">전체 플랜</option>
              <option value="free">무료</option>
              <option value="personal">일반</option>
              <option value="business">사업자</option>
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="권한" className="input w-auto text-sm">
              <option value="">전체 권한</option>
              <option value="user">일반</option>
              <option value="admin">관리자</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              aria-label="상태"
              className="input w-auto text-sm"
            >
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="cancel_scheduled">취소 예정</option>
              <option value="withdrawn">탈퇴</option>
            </select>
          </>
        }
        activeCount={activeFilters}
        onReset={() => {
          setSearch('');
          setCategory('');
          setPlan('');
          setRole('');
          setStatus('');
        }}
      />

      <AdminTable
        caption="회원 목록"
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        loading={loading}
        minWidth={980}
        onRowClick={(m) => setDetailId(m.id)}
        rowClassName={(m) => (m.withdrawn_at ? 'opacity-50' : '')}
        empty={<AdminEmpty title={activeFilters ? '조건에 맞는 회원이 없어요.' : '회원이 없어요.'} />}
      />

      <ConfirmDialog
        open={roleChange !== null}
        title="회원 권한 변경"
        target={roleChange ? memberLabel(roleChange.row) : undefined}
        description={
          roleChange
            ? roleChange.next === 'admin'
              ? '관리자로 올리면 관리자 콘솔 전체에 접근할 수 있게 됩니다.'
              : '일반 회원으로 내리면 관리자 콘솔에 접근할 수 없게 됩니다.'
            : undefined
        }
        confirmLabel={roleChange?.next === 'admin' ? '관리자로 변경' : '일반으로 변경'}
        destructive={roleChange?.next === 'admin'}
        pending={acting}
        onConfirm={() => {
          if (!roleChange) return;
          setActing(true);
          void changeRole(roleChange.row.id, roleChange.next).finally(() => {
            setActing(false);
            setRoleChange(null);
          });
        }}
        onCancel={() => setRoleChange(null)}
      />

      <ConfirmDialog
        open={planChange !== null}
        title="회원 플랜 변경"
        target={planChange ? memberLabel(planChange.row) : undefined}
        description={
          planChange
            ? `플랜을 '${PLAN_LABEL[planChange.next] ?? planChange.next}' 로 바꿉니다. 결제는 이 변경으로 발생하지 않습니다.`
            : undefined
        }
        confirmLabel="플랜 변경"
        pending={acting}
        onConfirm={() => {
          if (!planChange) return;
          setActing(true);
          void changePlan(planChange.row.id, planChange.next).finally(() => {
            setActing(false);
            setPlanChange(null);
          });
        }}
        onCancel={() => setPlanChange(null)}
      />

      {detailId && <MemberDetail userId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
