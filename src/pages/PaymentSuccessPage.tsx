import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';
import { getMyPaymentStatus, type MyPaymentStatusRow } from '@/lib/subscriptionApi';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

/**
 * 결제 성공 페이지.
 *
 * 핵심 정책 (실시간 강화판):
 *   - 실시간 신호: Supabase Realtime 으로 payment_orders[order_no] UPDATE 구독.
 *     webhook 처리되어 status='paid' 가 되는 순간 즉시 trigger.
 *   - polling 백업: Realtime 미가용/RLS 차단 환경 대비 polling 병행.
 *     - 첫 10 tick(약 10초): 1초 간격 (실시간 못 받았을 때 빠른 catch)
 *     - 그 다음 25 tick(약 50초): 2초 간격
 *     - 총 60초 window.
 *   - 판정 기준: RPC get_my_payment_status(order_no).membership_applied
 *     status='paid' && tier in ('individual','business') && tier==plan_type.
 *   - status='refunded' / 'canceled' → 즉시 실패 안내.
 *   - 60초 후에도 미적용 → "동기화 지연" 안내 + 수동 재확인 버튼.
 */

type Phase = 'polling' | 'done' | 'failed' | 'timeout';

// polling 스케줄: 첫 10번 1초, 그 후 25번 2초 = 총 60초.
const POLL_FAST_TICKS = 10;
const POLL_FAST_INTERVAL_MS = 1000;
const POLL_SLOW_INTERVAL_MS = 2000;
const POLL_MAX_TICKS = 35; // 10 + 25
function pollIntervalForTick(tick: number): number {
  return tick < POLL_FAST_TICKS ? POLL_FAST_INTERVAL_MS : POLL_SLOW_INTERVAL_MS;
}
function elapsedAtTick(tick: number): number {
  if (tick <= POLL_FAST_TICKS) return tick * (POLL_FAST_INTERVAL_MS / 1000);
  return (
    POLL_FAST_TICKS * (POLL_FAST_INTERVAL_MS / 1000) +
    (tick - POLL_FAST_TICKS) * (POLL_SLOW_INTERVAL_MS / 1000)
  );
}
const POLL_WINDOW_SEC =
  POLL_FAST_TICKS * (POLL_FAST_INTERVAL_MS / 1000) +
  (POLL_MAX_TICKS - POLL_FAST_TICKS) * (POLL_SLOW_INTERVAL_MS / 1000);

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const [phase, setPhase] = useState<Phase>('polling');
  const [row, setRow] = useState<MyPaymentStatusRow | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const timer = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  async function pollOnce(tickIndex: number): Promise<boolean> {
    if (!orderNo) return false;
    const res = await getMyPaymentStatus(orderNo);
    if (stoppedRef.current) return true;

    setElapsed(elapsedAtTick(tickIndex));

    if (!res.ok) {
      if (res.notFound) {
        // payment_orders row 가 아직 생성되지 않은 초기 구간일 수 있음 — 계속 polling
        return false;
      }
      setLastError(res.error);
      return false;
    }

    setRow(res.row);

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

  /** 실시간 신호 도착 시 즉시 한 번 pollOnce 호출. */
  async function triggerImmediatePoll(reason: string) {
    if (stoppedRef.current) return;
    console.log('[PaymentSuccess] realtime trigger:', reason);
    // tick=0 으로 force poll — 표시 elapsed 는 건드리지 않음
    if (!orderNo) return;
    const res = await getMyPaymentStatus(orderNo);
    if (stoppedRef.current || !res.ok) return;
    setRow(res.row);
    if (res.row.status === 'refunded' || res.row.status === 'canceled' || res.row.status === 'cancelled') {
      setPhase('failed');
      stoppedRef.current = true;
      return;
    }
    if (res.row.membership_applied) {
      void refreshProfile();
      setPhase('done');
      stoppedRef.current = true;
    }
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
      if (tick >= POLL_MAX_TICKS) {
        setPhase('timeout');
        return;
      }
      timer.current = window.setTimeout(loop, pollIntervalForTick(tick));
    };
    void loop();
  }

  useEffect(() => {
    void startPolling();

    // ─────────────────────────────────────────────────────────────
    // 실시간: payment_orders[order_no] 의 UPDATE 를 구독.
    // webhook 이 처리되어 status='paid' 가 되는 순간 즉시 triggerImmediatePoll.
    // Realtime 이 활성화 안 되어 있어도 polling 이 백업으로 동작.
    // ─────────────────────────────────────────────────────────────
    if (orderNo) {
      const channel = supabase
        .channel(`payment-status:${orderNo}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'payment_orders',
            filter: `order_no=eq.${orderNo}`,
          },
          () => void triggerImmediatePoll('payment_orders.UPDATE'),
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            // users.id 는 클라이언트가 모를 수 있어 filter 없이 구독 —
            // 본인 row 만 RLS 로 노출되므로 트래픽 최소.
          },
          () => void triggerImmediatePoll('users.UPDATE'),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setRealtimeConnected(true);
        });
      realtimeChannelRef.current = channel;
    }

    return () => {
      stoppedRef.current = true;
      if (timer.current) window.clearTimeout(timer.current);
      if (realtimeChannelRef.current) {
        void supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
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
        {phase === 'polling' && (
          <PollingView orderNo={orderNo} elapsed={elapsed} realtime={realtimeConnected} />
        )}
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

function PollingView({
  orderNo,
  elapsed,
  realtime,
}: {
  orderNo: string | null;
  elapsed: number;
  realtime: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Loader2 size={20} className="animate-spin text-accent" />
        <h1 className="text-lg font-bold">결제 확인 중입니다</h1>
      </div>
      <p className="mt-2 text-sm text-ink-mute">
        결제 정보를 확인하고 있어요. 잠시만 기다려주세요. ({Math.round(elapsed)}s /{' '}
        {Math.round(POLL_WINDOW_SEC)}s)
      </p>
      <p className="mt-1 text-[11px] text-ink-dim">
        {realtime ? '실시간 동기화 연결됨 — 처리되는 즉시 자동 반영됩니다.' : '실시간 동기화 연결 중…'}
      </p>
      <p className="mt-3 text-[11px] text-ink-dim">주문번호: {orderNo ?? '—'}</p>
    </>
  );
}
