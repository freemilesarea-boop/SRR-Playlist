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
import MemberDetail from './MemberDetail';

const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  personal: '일반',
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
  }, [plan, role]);

  // 검색은 디바운스
  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function changeRole(id: string, newRole: 'user' | 'admin') {
    try {
      await updateUserRole(id, newRole);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, role: newRole } : r)));
      toast.success('권한이 변경됐어요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '변경 실패');
    }
  }

  async function changePlan(id: string, newPlan: 'free' | 'personal' | 'business') {
    try {
      await updateUserPlan(id, newPlan);
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, subscription_type: newPlan } : r)),
      );
      toast.success('플랜이 변경됐어요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '변경 실패');
    }
  }

  if (error) return <AdminErrorState error={error} />;

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
      </div>

      {/* 테이블 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">회원</th>
                <th className="px-3 py-2.5 text-left font-semibold">권한</th>
                <th className="px-3 py-2.5 text-left font-semibold">플랜</th>
                <th className="px-3 py-2.5 text-right font-semibold">스트리밍</th>
                <th className="px-3 py-2.5 text-right font-semibold">청취</th>
                <th className="px-3 py-2.5 text-right font-semibold">가입일</th>
                <th className="px-3 py-2.5 text-right font-semibold">최근방문</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                    회원이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr
                  key={m.id}
                  className="cursor-pointer border-b border-line/10 hover:bg-bg-hover"
                  onClick={() => setDetailId(m.id)}
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{m.nickname || '—'}</p>
                    <p className="text-xs text-ink-mute">{m.email ?? m.id.slice(0, 8)}</p>
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
                      value={m.subscription_type}
                      onChange={(e) =>
                        changePlan(m.id, e.target.value as 'free' | 'personal' | 'business')
                      }
                      className="rounded bg-bg-soft px-2 py-1 text-xs"
                    >
                      <option value="free">{PLAN_LABEL.free}</option>
                      <option value="personal">{PLAN_LABEL.personal}</option>
                      <option value="business">{PLAN_LABEL.business}</option>
                    </select>
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
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {fmtDate(m.last_seen_at)}
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
