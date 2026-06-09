import { useEffect, useState } from 'react';
import { Clock, Mail, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { friendlyError } from '@/lib/errorMessages';
import AdminErrorState from './AdminErrorState';

type Status = 'pending' | 'contacted' | 'approved' | 'rejected' | 'cancelled';

interface RequestRow {
  id: string;
  user_id: string;
  email: string | null;
  nickname: string | null;
  account_type?: string | null;
  requested_plan: 'personal' | 'business';
  status: Status;
  note: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: '대기',
  contacted: '연락함',
  approved: '승인',
  rejected: '거절',
  cancelled: '취소',
};

const STATUS_STYLE: Record<Status, string> = {
  pending: 'bg-yellow-500/15 text-yellow-200',
  contacted: 'bg-sky-500/15 text-sky-200',
  approved: 'bg-emerald-500/15 text-emerald-200',
  rejected: 'bg-red-500/15 text-red-200',
  cancelled: 'bg-bg-hover text-ink-dim',
};

const FLOW: Status[] = ['pending', 'contacted', 'approved', 'rejected'];

export default function SubscriptionRequests() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<AdminError | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // 0043 list_subscription_requests RPC — admin 권한 검증 + email/nickname/account_type join
      const { data, error: rpcErr } = await supabase.rpc('list_subscription_requests');
      if (rpcErr) {
        // RPC 가 운영 DB 에 없거나 admin 거부된 경우만 fallback (RLS 직접 조회)
        const isMissing =
          rpcErr.code === 'PGRST202' ||
          rpcErr.code === '42883' ||
          /could not find/i.test(rpcErr.message);
        if (isMissing) {
          const { data: tbl, error: tblErr } = await supabase
            .from('subscription_requests')
            .select('id, user_id, requested_plan, status, note, created_at')
            .order('created_at', { ascending: false });
          if (tblErr) throw tblErr;
          setRows(
            ((tbl as Omit<RequestRow, 'email' | 'nickname'>[]) ?? []).map((r) => ({
              ...r,
              email: null,
              nickname: null,
            })),
          );
          toast.info('0043 마이그레이션 미적용 — payment_hotfix.sql 또는 워크플로 실행 필요');
        } else {
          throw rpcErr;
        }
      } else {
        setRows((data as RequestRow[]) ?? []);
      }
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function changeStatus(id: string, next: Status) {
    setUpdatingId(id);
    try {
      const { error } = await supabase
        .from('subscription_requests')
        .update({ status: next })
        .eq('id', id);
      if (error) throw error;

      // approved 처리 시 users.subscription_type 도 함께 변경
      if (next === 'approved') {
        const row = rows.find((r) => r.id === id);
        if (row) {
          const { error: uerr } = await supabase
            .from('users')
            .update({ subscription_type: row.requested_plan })
            .eq('id', row.user_id);
          if (uerr) toast.error(`승인은 됐지만 플랜 적용 실패: ${uerr.message}`);
        }
      }

      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: next } : r)));
      toast.success(`상태를 ‘${STATUS_LABEL[next]}’ 로 변경했어요.`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setUpdatingId(null);
    }
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const others = rows.filter((r) => r.status !== 'pending');

  if (error) return <AdminErrorState error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">구독 신청 ({rows.length})</h2>
          <p className="text-xs text-ink-mute">
            대기 {pending.length}건 · 처리 {others.length}건
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {pending.length === 0 && others.length === 0 && (
        <div className="rounded-2xl bg-bg-card p-8 text-center text-sm text-ink-mute">
          아직 들어온 신청이 없어요.
        </div>
      )}

      {pending.length > 0 && (
        <Section title="대기 중" tone="accent">
          <RequestTable
            rows={pending}
            updatingId={updatingId}
            onChange={changeStatus}
          />
        </Section>
      )}

      {others.length > 0 && (
        <Section title="처리된 신청" tone="mute">
          <RequestTable rows={others} updatingId={updatingId} onChange={changeStatus} />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'accent' | 'mute';
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold ${tone === 'accent' ? 'text-accent' : 'text-ink-mute'}`}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function RequestTable({
  rows,
  updatingId,
  onChange,
}: {
  rows: RequestRow[];
  updatingId: string | null;
  onChange: (id: string, next: Status) => void;
}) {
  return (
    <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
      {rows.map((r) => (
        <li key={r.id} className="space-y-2 p-3 sm:flex sm:items-center sm:gap-3 sm:space-y-0">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium">
              {r.nickname ?? r.email ?? r.user_id.slice(0, 8)}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-ink-mute">
              {r.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail size={10} /> {r.email}
                </span>
              )}
              <span>· {r.requested_plan === 'business' ? '사업자 플랜' : '일반 플랜'}</span>
            </p>
            <p className="flex items-center gap-1 text-[11px] text-ink-dim">
              <Clock size={10} /> {new Date(r.created_at).toLocaleString('ko-KR')}
            </p>
          </div>

          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[r.status]}`}
          >
            {STATUS_LABEL[r.status]}
          </span>

          <div className="flex flex-wrap gap-1">
            {FLOW.map((s) =>
              s === r.status ? null : (
                <button
                  key={s}
                  onClick={() => onChange(r.id, s)}
                  disabled={updatingId === r.id}
                  className="rounded-md bg-bg-hover px-2 py-1 text-[11px] hover:bg-ink/10 disabled:opacity-50"
                >
                  {STATUS_LABEL[s]}
                </button>
              ),
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
