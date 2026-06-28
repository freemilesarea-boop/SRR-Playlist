import { useEffect, useRef, useState } from 'react';
import { Plus, Wallet, X } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  fetchRevenueSummary,
  fetchMemberList,
  insertRevenue,
  type RevenueSummary,
  type MemberRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

const KRW = (n: number) => `₩${(n ?? 0).toLocaleString('ko-KR')}`;
const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  personal: '일반',
  individual: '일반', // 0040 표준 plan_type
  business: '사업자',
};
const STATUS_LABEL: Record<string, string> = {
  paid: '결제완료',
  pending: '대기',
  refunded: '환불',
  failed: '실패',
};

export default function RevenueManagement() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<AdminError | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([fetchRevenueSummary(), fetchMemberList({ limit: 200 })]);
      setData(s);
      setMembers(m);
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <AdminErrorState error={error} onRetry={load} />;
  if (loading || !data) return <div className="p-6 text-sm text-ink-mute">불러오는 중…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">매출</h2>
          <p className="text-xs text-ink-mute">결제 기록 + 플랜/상태별 집계</p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={14} /> 매출 수동 등록
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="오늘" value={KRW(data.today)} />
        <Card label="이번 주" value={KRW(data.week)} />
        <Card label="이번 달" value={KRW(data.month)} />
        <Card label="누적" value={KRW(data.total)} highlight />
      </div>

      {/* 플랜별 / 상태별 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <BreakdownCard title="플랜별 매출">
          {Object.keys(data.by_plan).length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-ink-mute">매출 기록 없음</p>
          ) : (
            Object.entries(data.by_plan).map(([k, v]) => (
              <Row key={k} label={PLAN_LABEL[k] ?? k} value={KRW(v)} />
            ))
          )}
        </BreakdownCard>
        <BreakdownCard title="결제 상태별">
          {Object.keys(data.by_status).length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-ink-mute">매출 기록 없음</p>
          ) : (
            Object.entries(data.by_status).map(([k, v]) => (
              <Row key={k} label={STATUS_LABEL[k] ?? k} value={KRW(v)} />
            ))
          )}
        </BreakdownCard>
      </div>

      {/* 최근 결제 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <header className="border-b border-line/10 px-4 py-3">
          <h3 className="text-sm font-bold">최근 결제 ({data.recent.length})</h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left">회원</th>
                <th className="px-3 py-2.5 text-left">플랜</th>
                <th className="px-3 py-2.5 text-right">금액</th>
                <th className="px-3 py-2.5 text-center">상태</th>
                <th className="px-3 py-2.5 text-left">결제수단</th>
                <th className="px-3 py-2.5 text-right">결제일</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-mute">
                    아직 결제 기록이 없어요. 위에서 수동 등록할 수 있어요.
                  </td>
                </tr>
              ) : (
                data.recent.map((r) => (
                  <tr key={r.id} className="border-b border-line/10">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.nickname || '—'}</p>
                      <p className="text-xs text-ink-mute">{r.email ?? '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{PLAN_LABEL[r.subscription_type] ?? r.subscription_type}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{KRW(r.amount)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.status === 'paid'
                            ? 'bg-emerald-500/25 text-emerald-200'
                            : r.status === 'refunded'
                              ? 'bg-rose-500/25 text-red-200'
                              : 'bg-yellow-500/15 text-yellow-200'
                        }`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-mute">{r.payment_provider ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                      {new Date(r.paid_at).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <AddModal
          members={members}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Card({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-3 ring-1 ${
        highlight
          ? 'bg-gradient-to-br from-accent-soft/30 to-bg-card ring-accent/30'
          : 'bg-bg-card ring-line/10'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${highlight ? 'text-accent' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function BreakdownCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <header className="border-b border-line/10 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-mute">{title}</h3>
      </header>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-line/10 px-4 py-2.5 text-sm first:border-t-0">
      <span className="text-ink-mute">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

function AddModal({
  members,
  onClose,
  onSaved,
}: {
  members: MemberRow[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState<'personal' | 'business'>('personal');
  const [amount, setAmount] = useState<string>('4900');
  const [status, setStatus] = useState<'paid' | 'pending' | 'refunded' | 'failed'>('paid');
  const [provider, setProvider] = useState('manual');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      toast.error('회원을 선택해주세요.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('금액이 잘못됐어요.');
      return;
    }
    setBusy(true);
    try {
      await insertRevenue({
        user_id: userId,
        subscription_type: plan,
        amount: amt,
        status,
        payment_provider: provider || 'manual',
        note: note || undefined,
        paid_at: new Date(paidAt).toISOString(),
      });
      toast.success('매출이 등록됐어요.');
      await onSaved();
    } catch (e) {
      toast.error(friendlyError(e, '등록 실패'));
    } finally {
      setBusy(false);
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/10 p-4">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Wallet size={16} /> 매출 수동 등록
          </h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 p-4">
          <label className="block space-y-1">
            <span className="text-xs text-ink-mute">회원 *</span>
            <select required value={userId} onChange={(e) => setUserId(e.target.value)} className="input text-sm">
              <option value="">— 회원 선택 —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname || m.email || m.id.slice(0, 8)} · {m.email}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-ink-mute">플랜 *</span>
              <select value={plan} onChange={(e) => setPlan(e.target.value as 'personal' | 'business')} className="input text-sm">
                <option value="personal">일반 (4,900원)</option>
                <option value="business">사업자 (6,900원)</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-ink-mute">금액 (원) *</span>
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-ink-mute">상태</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="input text-sm">
                <option value="paid">결제완료</option>
                <option value="pending">대기</option>
                <option value="refunded">환불</option>
                <option value="failed">실패</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-ink-mute">결제수단</span>
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="manual / payapp / toss"
                className="input text-sm"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-ink-mute">결제일</span>
            <input
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="input text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-ink-mute">메모 (선택)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="결제 사유 / 영수증 번호 / 비고"
              className="input min-h-[60px] text-sm"
            />
          </label>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={busy} className="btn-primary flex-1">
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
