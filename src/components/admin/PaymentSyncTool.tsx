import { useCallback, useState } from 'react';
import { CreditCard, RefreshCw, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  adminSyncPayappPayment,
  listManualPaymentImports,
  type AdminSyncPaymentResult,
  type ManualPaymentImportRow,
} from '@/lib/subscriptionApi';
import { toast } from '@/store/toastStore';

const STATUS_LABEL: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  matched: { label: '연결 완료', tone: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={11} /> },
  unmatched: { label: '사용자 매칭 실패', tone: 'bg-yellow-500/15 text-yellow-200', icon: <Clock size={11} /> },
  failed: { label: '동기화 실패', tone: 'bg-red-500/15 text-red-300', icon: <XCircle size={11} /> },
};

const PLAN_PRICE: Record<'individual' | 'business', number> = {
  individual: 4900,
  business: 6900,
};

function maskAccount(num: string | null): string {
  if (!num) return '—';
  const cleaned = num.replace(/\s+/g, '');
  if (cleaned.length <= 6) return cleaned;
  return `${cleaned.slice(0, 3)}${'*'.repeat(Math.max(cleaned.length - 6, 1))}${cleaned.slice(-3)}`;
}

export default function PaymentSyncTool() {
  // form state
  const [mulNo, setMulNo] = useState('');
  const [approvalNo, setApprovalNo] = useState('');
  const [goodname, setGoodname] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [amount, setAmount] = useState<number>(4900);
  const [planType, setPlanType] = useState<'individual' | 'business'>('individual');
  const [paidAtLocal, setPaidAtLocal] = useState<string>(toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<AdminSyncPaymentResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // list
  const [rows, setRows] = useState<ManualPaymentImportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listManualPaymentImports(100));
    } finally {
      setLoading(false);
    }
  }, []);
  useFreshFetch(load, []);

  function onPlanChange(p: 'individual' | 'business') {
    setPlanType(p);
    setAmount(PLAN_PRICE[p]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLastError(null);
    setLastResult(null);
    if (!mulNo.trim()) {
      setLastError('결제요청번호(mul_no)를 입력하세요');
      return;
    }
    if (amount !== PLAN_PRICE[planType]) {
      setLastError(
        `${planType} 요금제는 ${PLAN_PRICE[planType].toLocaleString()}원이어야 합니다 (현재 ${amount})`,
      );
      return;
    }
    setBusy(true);
    try {
      const res = await adminSyncPayappPayment({
        payapp_mul_no: mulNo.trim(),
        amount,
        plan_type: planType,
        approval_no: approvalNo.trim() || undefined,
        buyer_email: buyerEmail.trim() || undefined,
        buyer_phone: buyerPhone.trim() || undefined,
        paid_at: new Date(paidAtLocal).toISOString(),
        goodname: goodname.trim() || undefined,
      });
      if (!res.ok || !res.result) {
        const msg = res.error ?? '동기화 실패';
        setLastError(msg);
        toast.error(msg);
        return;
      }
      setLastResult(res.result);
      if (res.result.status === 'matched') {
        toast.success('결제 동기화 완료 — 사용자 권한 활성화됨');
      } else if (res.result.status === 'unmatched') {
        toast.info('매칭되는 사용자를 찾지 못했어요. 사용자 확인 후 다시 시도해주세요.');
      } else {
        toast.error('동기화 실패: ' + res.result.message);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <CreditCard size={16} className="text-accent" /> 결제 동기화
        </h2>
        <p className="text-xs text-ink-mute">
          PayApp 관리자에서 결제완료된 건이 앱에 미반영된 경우 수동 동기화. 동일 결제요청번호로
          여러 번 실행해도 중복 적용되지 않습니다.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="결제요청번호(mul_no) *">
            <input
              type="text"
              required
              value={mulNo}
              onChange={(e) => setMulNo(e.target.value)}
              placeholder="예: 115553644"
              className="input"
            />
          </Field>
          <Field label="승인번호">
            <input
              type="text"
              value={approvalNo}
              onChange={(e) => setApprovalNo(e.target.value)}
              placeholder="예: 24408162"
              className="input"
            />
          </Field>
          <Field label="구매자 이메일">
            <input
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              placeholder="example@gmail.com"
              className="input"
              autoComplete="off"
            />
          </Field>
          <Field label="구매자 전화번호">
            <input
              type="tel"
              value={buyerPhone}
              onChange={(e) => setBuyerPhone(e.target.value)}
              placeholder="010-0000-0000"
              className="input"
              autoComplete="off"
            />
          </Field>
          <Field label="요금제 *">
            <select
              required
              value={planType}
              onChange={(e) => onPlanChange(e.target.value as 'individual' | 'business')}
              className="input"
            >
              <option value="individual">individual (4,900원)</option>
              <option value="business">business (6,900원)</option>
            </select>
          </Field>
          <Field label="결제 금액 *">
            <input
              type="number"
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="input"
              min={0}
            />
          </Field>
          <Field label="결제일시 *">
            <input
              type="datetime-local"
              required
              value={paidAtLocal}
              onChange={(e) => setPaidAtLocal(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="상품명(참고)">
            <input
              type="text"
              value={goodname}
              onChange={(e) => setGoodname(e.target.value)}
              placeholder="예: SRR Playlist 정기이용권"
              className="input"
            />
          </Field>
        </div>

        {lastError && (
          <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
            {lastError}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? '동기화 중…' : '결제내역 동기화'}
        </button>
      </form>

      {lastResult && (
        <div
          className={`rounded-2xl p-4 ring-1 ${
            lastResult.status === 'matched'
              ? 'bg-emerald-500/10 ring-emerald-500/30'
              : lastResult.status === 'unmatched'
                ? 'bg-yellow-500/10 ring-yellow-500/30'
                : 'bg-red-500/10 ring-red-500/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {lastResult.status === 'matched' ? (
              <CheckCircle2 size={16} className="text-emerald-300" />
            ) : lastResult.status === 'unmatched' ? (
              <AlertCircle size={16} className="text-yellow-300" />
            ) : (
              <XCircle size={16} className="text-red-300" />
            )}
            <p className="text-sm font-bold">결과: {lastResult.status}</p>
          </div>
          <p className="mt-1 text-[12px] text-ink-mute">{lastResult.message}</p>
          {lastResult.status === 'matched' && (
            <dl className="mt-2 space-y-0.5 text-[11px]">
              <Row3 label="user_id" value={lastResult.user_id ?? '—'} />
              <Row3 label="order_id" value={lastResult.order_id ?? '—'} />
              <Row3 label="subscription_id" value={lastResult.subscription_id ?? '—'} />
            </dl>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-tight">동기화 이력 ({rows.length})</h3>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
        <div className="mt-2 overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-left font-semibold">mul_no</th>
                <th className="px-3 py-2.5 text-left font-semibold">승인번호</th>
                <th className="px-3 py-2.5 text-left font-semibold">사용자</th>
                <th className="px-3 py-2.5 text-left font-semibold">요금제</th>
                <th className="px-3 py-2.5 text-right font-semibold">금액</th>
                <th className="px-3 py-2.5 text-right font-semibold">결제일시</th>
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
                    수동 동기화 이력이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.failed;
                return (
                  <tr key={r.id} className="border-b border-line/10 last:border-b-0">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.tone}`}>
                        {s.icon}
                        {s.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.payapp_mul_no}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-mute">{r.approval_no ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.matched_user_email ?? r.buyer_email ?? '—'}
                      {r.buyer_phone && (
                        <p className="text-[10px] text-ink-dim">{maskAccount(r.buyer_phone)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.plan_type}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">{r.amount.toLocaleString()}원</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-ink-mute">
                      {new Date(r.paid_at).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

function Row3({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-ink-dim">{label}</dt>
      <dd className="truncate font-mono text-ink">{value}</dd>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
