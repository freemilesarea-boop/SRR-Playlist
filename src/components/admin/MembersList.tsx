import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  fetchMemberList,
  updateUserRole,
  updateUserPlan,
  type MemberRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import MemberDetail from './MemberDetail';

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

export default function MembersList() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState<string>('');
  const [role, setRole] = useState<string>('');
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
  }, [plan, role, status]);

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

  if (error) return <AdminErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">회원관리</h2>
          <p className="text-xs text-ink-mute">{rows.length}명 표시 중</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이메일 또는 닉네임 검색"
            className="input pl-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-dim hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input w-auto text-sm">
          <option value="">전체 플랜</option>
          <option value="free">무료</option>
          <option value="personal">일반</option>
          <option value="business">사업자</option>
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-auto text-sm">
          <option value="">전체 권한</option>
          <option value="user">일반</option>
          <option value="admin">관리자</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="input w-auto text-sm"
        >
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="cancel_scheduled">취소 예정</option>
          <option value="withdrawn">탈퇴</option>
        </select>
      </div>

      {/* 테이블 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">회원</th>
                <th className="px-3 py-2.5 text-left font-semibold">유형</th>
                <th className="px-3 py-2.5 text-left font-semibold">권한</th>
                <th className="px-3 py-2.5 text-left font-semibold">플랜</th>
                <th className="px-3 py-2.5 text-left font-semibold">인증</th>
                <th className="px-3 py-2.5 text-right font-semibold">스트리밍</th>
                <th className="px-3 py-2.5 text-right font-semibold">청취</th>
                <th className="px-3 py-2.5 text-right font-semibold">가입일</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">
                    회원이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr
                  key={m.id}
                  className={`cursor-pointer border-b border-line/10 hover:bg-bg-hover ${
                    m.withdrawn_at ? 'opacity-50' : ''
                  }`}
                  onClick={() => setDetailId(m.id)}
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{m.nickname || '—'}</p>
                    <p className="text-xs text-ink-mute">{m.email ?? m.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-line/10">
                      {(m.account_type ?? 'individual') === 'business'
                        ? '🏪 사업자'
                        : (m.account_type === 'artist' ? '🎤 아티스트' : '👤 일반')}
                    </span>
                    {m.account_type === 'artist' && m.plan_type === 'student_artist' && (
                      <span className="ml-1 inline-flex rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                        PRO
                      </span>
                    )}
                    {m.account_type === 'artist' && m.plan_type === 'general_artist' && (
                      <span className="ml-1 inline-flex rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300">
                        일반
                      </span>
                    )}
                    {m.account_type === 'artist' && !m.plan_type && (
                      <span className="ml-1 inline-flex rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                        legacy
                      </span>
                    )}
                    {m.signup_completed === false && (
                      <span className="ml-1 inline-flex rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[9px] text-yellow-200">
                        미완료
                      </span>
                    )}
                    {m.withdrawn_at && (
                      <span className="ml-1 inline-flex rounded-full bg-rose-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
                        탈퇴
                      </span>
                    )}
                    {!m.withdrawn_at && m.has_cancel_scheduled && (
                      <span className="ml-1 inline-flex rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-200">
                        취소 예정
                      </span>
                    )}
                    {m.has_promotion && (
                      <span className="ml-1 inline-flex rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                        프로모션
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as 'user' | 'admin')}
                      className="rounded bg-bg-soft px-2 py-1 text-xs"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={m.subscription_type === 'personal' ? 'individual' : m.subscription_type}
                      onChange={(e) =>
                        changePlan(
                          m.id,
                          e.target.value as 'free' | 'personal' | 'individual' | 'business',
                        )
                      }
                      className="rounded bg-bg-soft px-2 py-1 text-xs"
                    >
                      <option value="free">{PLAN_LABEL.free}</option>
                      <option value="individual">{PLAN_LABEL.individual}</option>
                      <option value="business">{PLAN_LABEL.business}</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {m.identity_verified && (
                        <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-emerald-300">본인 ✓</span>
                      )}
                      {m.business_verified && (
                        <span className="rounded-full bg-sky-500/25 px-1.5 py-0.5 text-sky-300">사업자 ✓</span>
                      )}
                      {!m.identity_verified && !m.business_verified && (
                        <span className="text-ink-dim">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {m.total_streams}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-mute">
                    {fmtTime(m.total_listened_seconds)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {fmtDate(m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && <MemberDetail userId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
