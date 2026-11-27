import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, UserCheck, UserX } from 'lucide-react';
import {
  adminListBillingAttention, adminListBillingStaff, adminSetBillingStaff, overdueBucket, PLAN_LABEL,
  type BillingAttentionRow, type BillingStaffRow,
} from '@/lib/billingAttentionApi';
import { toast } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorMessage';

const BUCKETS: Array<{ key: ReturnType<typeof overdueBucket>; title: string; hint: string }> = [
  { key: 'recent', title: '최근 2주', hint: '재결제 실패일 가능성이 큽니다. PayApp에서 결제 여부를 먼저 확인해 주세요.' },
  { key: 'month', title: '2주 ~ 45일', hint: '미납분 결제 링크 발송 대상입니다.' },
  { key: 'old', title: '45일 넘음', hint: '오래된 미납입니다. 해지·정리 여부를 정해 주세요.' },
];

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('ko-KR') : '없음');

/**
 * 관리자 → 결제 확인 필요 (migration 0569).
 * 이용 기간이 지났는데 아직 '이용 중'인 개인 구독. PayApp 재결제 실패 통보가 오지 않아
 * 실패한 회원이 조용히 남는 문제를 직접 찾아 보여 준다. 매일 10:37 새 건은 관리자 알림으로도 온다.
 * 직원 계정은 '직원으로 표시'하면 목록과 알림에서 빠진다.
 */
export default function BillingAttentionPanel() {
  const [rows, setRows] = useState<BillingAttentionRow[] | null>(null);
  const [staff, setStaff] = useState<BillingStaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, s] = await Promise.all([adminListBillingAttention(false), adminListBillingStaff()]);
      setRows(r);
      setStaff(s);
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setStaffFlag(userId: string, name: string, isStaff: boolean) {
    if (isStaff && !window.confirm(`${name} 님을 직원으로 표시할까요? 결제 확인 목록과 알림에서 빠집니다.`)) return;
    setBusy(userId);
    try {
      await adminSetBillingStaff(userId, isStaff, isStaff ? '직원' : undefined);
      toast.success(isStaff ? '직원으로 표시했어요.' : '직원 표시를 해제했어요.');
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><AlertTriangle size={18} /> 결제 확인 필요</h2>
        <button onClick={() => { setRows(null); void load(); }} className="ml-auto rounded-full px-2 py-1.5 text-ink-mute ring-1 ring-line/15 hover:text-ink" aria-label="새로고침">
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-xs text-ink-mute">
        이용 기간이 하루 넘게 지났는데 재결제 기록이 없는 회원입니다. PayApp은 재결제 실패를 알려 주지 않아서 여기서 직접 확인합니다.
        새로 생긴 건은 매일 오전 10:37에 관리자 알림으로도 옵니다.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-bg-card p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">확인할 회원이 없어요.</p>
      ) : (
        BUCKETS.map((b) => {
          const list = rows.filter((r) => overdueBucket(r.days_overdue) === b.key);
          if (list.length === 0) return null;
          return (
            <section key={b.key} className="space-y-2">
              <h3 className="text-sm font-semibold">{b.title} <span className="text-ink-mute">· {list.length}명</span></h3>
              <p className="text-xs text-ink-mute">{b.hint}</p>
              <ul className="space-y-2">
                {list.map((r) => (
                  <li key={r.subscription_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
                    <span className="text-sm font-semibold">{r.display_name}</span>
                    <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">{PLAN_LABEL[r.plan_type] ?? r.plan_type} · {r.price.toLocaleString('ko-KR')}원</span>
                    <span className="text-xs text-red-500">{r.days_overdue}일 지남</span>
                    <span className="w-full text-xs text-ink-mute sm:w-auto">
                      기간 종료 {fmtDate(r.current_period_end)} · 마지막 결제 {fmtDate(r.last_paid_at)} · 마지막 PayApp 통보 {fmtDate(r.last_payapp_event_at)}
                    </span>
                    <button
                      disabled={busy === r.user_id}
                      onClick={() => void setStaffFlag(r.user_id, r.display_name, true)}
                      className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-ink-mute ring-1 ring-line/15 hover:text-ink disabled:opacity-50"
                    >
                      <UserCheck size={13} /> 직원으로 표시
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <section className="space-y-2 border-t border-line/10 pt-4">
        <h3 className="text-sm font-semibold">직원 계정 <span className="text-ink-mute">· {staff.length}명</span></h3>
        <p className="text-xs text-ink-mute">직원 계정은 결제 확인 목록과 알림에서 빠집니다.</p>
        {staff.length === 0 ? (
          <p className="text-xs text-ink-mute">없음</p>
        ) : (
          <ul className="space-y-1">
            {staff.map((s) => (
              <li key={s.user_id} className="flex items-center gap-2 text-sm">
                <span>{s.display_name}</span>
                {s.note && <span className="text-xs text-ink-mute">{s.note}</span>}
                <button
                  disabled={busy === s.user_id}
                  onClick={() => void setStaffFlag(s.user_id, s.display_name, false)}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-ink-mute ring-1 ring-line/15 hover:text-ink disabled:opacity-50"
                >
                  <UserX size={13} /> 해제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
