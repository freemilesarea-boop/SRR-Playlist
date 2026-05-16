import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';
import { getMyPaymentStatus, type MyPaymentStatusRow } from '@/lib/subscriptionApi';
import { useAuthStore } from '@/store/authStore';

/**
 * 결제 성공 페이지.
 *
 * 핵심 정책 (0046):
 *   - polling 의 단일 판정 기준은 RPC get_my_payment_status(order_no).membership_applied.
 *   - profile.membership_tier 캐시는 보조적으로 refreshProfile 호출만 트리거.
 *   - status='paid' && tier in ('individual','business') && tier==plan_type → 완료.
 *   - status='refunded' / 'canceled' → 즉시 실패 안내.
 *   - 30초까지 polling, 그 후엔 "동기화 지연" 안내 + 수동 재확인 버튼.
 *   - order_no 없으면 즉시 에러.
 */

type Phase = 'polling' | 'done' | 'failed' | 'timeout';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const [phase, setPhase] = useState<Phase>('polling');
  const [row, setRow] = useState<MyPaymentStatusRow | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  async function pollOnce(tickIndex: number): Promise<boolean> {
    if (!orderNo) return false;
    const res = await getMyPaymentStatus(orderNo);
    if (stoppedRef.current) return true;

    if (!res.ok) {
      if (res.notFound) {
        // payment_orders row 가 아직 생성되지 않은 초기 구간일 수 있음 — 계속 polling
        setElapsed(tickIndex * 2);
        return false;
      }
      setLastError(res.error);
      setElapsed(tickIndex * 2);
      return false;
    }

    setRow(res.row);
    setElapsed(tickIndex * 2);

    if (res.row.status === 'refunded' || res.row.status === 'canceled' || res.row.status === 'cancelled') {
      setPhase('failed');
      return true;
    }

    if (res.row.membership_applied) {
      // profile 캐시도 같이 갱신 — 후속 페이지 접근 시 권한 즉시 반영.
      void refreshProfile();
      setPhase('done');
      return true;
    }

    // payment_orders.status='paid' 인데 tier 가 아직 안 올라온 케이스 (드물지만 가능):
    // refreshProfile 한 번 더 트리거해서 다음 tick 에서 다시 확인.
    if (res.row.status === 'paid') {
      void refreshProfile();
    }
    return false;
  }

  async function startPolling() {
    stoppedRef.current = false;
    setPhase('polling');
    setLastError(null);
    setElapsed(0);

    if (!orderNo) {
      setPhase('failed');
      setLastError('order_no 파라미터가 없습니다.');
      return;
    }

    let tick = 0;
    const loop = async () => {
      if (stoppedRef.current) return;
      const finished = await pollOnce(tick);
      if (finished || stoppedRef.current) return;
      tick += 1;
      if (tick >= 15) {
        // ~30s
        setPhase('timeout');
        return;
      }
      timer.current = window.setTimeout(loop, 2000);
    };
    void loop();
  }

  useEffect(() => {
    void startPolling();
    return () => {
      stoppedRef.current = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);

  async function onRecheck() {
    if (timer.current) window.clearTimeout(timer.current);
    await startPolling();
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12 sm:px-6">
      <div className="rounded-2xl bg-bg-card p-6 ring-1 ring-line/10">
        {phase === 'done' && row && <SuccessView row={row} onGo={() => navigate('/', { replace: true })} />}
        {phase === 'failed' && (
          <FailedView orderNo={orderNo} row={row} error={lastError} onRecheck={onRecheck} />
        )}
        {phase === 'timeout' && (
          <TimeoutView orderNo={orderNo} row={row} onRecheck={onRecheck} />
        )}
        {phase === 'polling' && <PollingView orderNo={orderNo} elapsed={elapsed} />}
      </div>

      <Link to="/profile" className="block text-center text-xs text-ink-mute hover:text-ink">
        마이페이지로 가기
      </Link>
    </div>
  );
}

function SuccessView({ row, onGo }: { row: MyPaymentStatusRow; onGo: () => void }) {
  const isBusiness = row.plan_type === 'business';
  return (
    <>
      <div className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 size={20} />
        <h1 className="text-lg font-bold">결제가 완료됐어요</h1>
      </div>
      <p className="mt-2 text-sm text-ink-mute">
        {isBusiness ? 'SRR Playlist 사업자 정기이용권' : 'SRR Playlist 정기이용권'} ·{' '}
        {row.amount.toLocaleString()}원
      </p>
      <p className="mt-1 text-xs text-ink-dim">
        주문번호: <span className="font-mono">{row.order_no}</span>
      </p>
      <p className="mt-0.5 text-xs text-emerald-300/80">
        권한 적용: tier={row.membership_tier}
      </p>
      <button onClick={onGo} className="btn-primary mt-5 w-full py-2.5">
        <ArrowRight size={14} /> 홈으로 이동
      </button>
    </>
  );
}

function FailedView({
  orderNo,
  row,
  error,
  onRecheck,
}: {
  orderNo: string | null;
  row: MyPaymentStatusRow | null;
  error: string | null;
  onRecheck: () => void;
}) {
  const reason =
    row?.status === 'refunded'
      ? '환불 처리됨'
      : row?.status === 'canceled' || row?.status === 'cancelled'
        ? '취소됨'
        : error ?? '결제 정보를 확인할 수 없습니다';
  return (
    <>
      <div className="flex items-center gap-2 text-red-300">
        <AlertCircle size={20} />
        <h1 className="text-lg font-bold">결제 확인 실패</h1>
      </div>
      <p className="mt-2 text-sm text-ink-mute">{reason}</p>
      <p className="mt-3 text-[11px] text-ink-dim">주문번호: {orderNo ?? '—'}</p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onRecheck}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-bg-deep py-2 text-xs hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 다시 확인
        </button>
        <Link
          to="/profile"
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-bg-deep py-2 text-xs hover:bg-bg-hover"
        >
          마이페이지
        </Link>
      </div>
    </>
  );
}

function TimeoutView({
  orderNo,
  row,
  onRecheck,
}: {
  orderNo: string | null;
  row: MyPaymentStatusRow | null;
  onRecheck: () => void;
}) {
  // payment_orders 가 paid 인데 tier 동기화가 늦어진 케이스를 명확히 안내
  const paidButNotApplied = row?.status === 'paid' && !row.membership_applied;
  return (
    <>
      <div className="flex items-center gap-2 text-yellow-300">
        <AlertCircle size={20} />
        <h1 className="text-lg font-bold">
          {paidButNotApplied ? '결제는 완료됐지만 권한 동기화 중' : '결제 확인 대기 중'}
        </h1>
      </div>
      <p className="mt-2 text-sm text-ink-mute">
        {paidButNotApplied
          ? '결제는 정상 처리됐고 곧 자동 반영됩니다. 잠시 후 다시 확인해주세요. 계속 안 되면 관리자에게 주문번호를 전달해주세요.'
          : '결제는 완료됐을 수 있으나 webhook 동기화 대기 중입니다. 관리자에게 주문번호를 전달해주세요.'}
      </p>
      <p className="mt-3 text-[11px] text-ink-dim">
        주문번호: <span className="font-mono">{orderNo ?? '—'}</span>
      </p>
      {row && (
        <p className="mt-0.5 text-[11px] text-ink-dim">
          현재: status={row.status} · tier={row.membership_tier ?? '?'}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={onRecheck}
          className="btn-primary inline-flex flex-1 items-center justify-center gap-1 py-2 text-xs"
        >
          <RefreshCw size={12} /> 다시 확인
        </button>
        <button
          onClick={async () => {
            if (!orderNo) return;
            try {
              await navigator.clipboard.writeText(orderNo);
              alert('주문번호를 복사했어요. 관리자에게 전달해주세요.');
            } catch {
              // clipboard API 차단 환경 fallback — 그냥 안내만
              alert(`주문번호: ${orderNo}\n(복사 실패. 직접 캡처해서 관리자에게 전달해주세요.)`);
            }
          }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-bg-deep py-2 text-xs hover:bg-bg-hover"
        >
          주문번호 복사
        </button>
      </div>
      <Link
        to="/profile"
        className="mt-2 block text-center text-[11px] text-ink-mute hover:text-ink"
      >
        마이페이지로 가기
      </Link>
    </>
  );
}

function PollingView({ orderNo, elapsed }: { orderNo: string | null; elapsed: number }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Loader2 size={20} className="animate-spin text-accent" />
        <h1 className="text-lg font-bold">결제 확인 중입니다</h1>
      </div>
      <p className="mt-2 text-sm text-ink-mute">
        결제 정보를 확인하고 있어요. 잠시만 기다려주세요. ({elapsed}s / 30s)
      </p>
      <p className="mt-3 text-[11px] text-ink-dim">주문번호: {orderNo ?? '—'}</p>
    </>
  );
}
