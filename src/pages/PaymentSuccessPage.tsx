import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { fetchMySubscription, type SubscriptionSnapshot } from '@/lib/subscriptionApi';

/**
 * 결제 성공 페이지.
 * - URL 파라미터(order_no)는 화면 표시용. 절대 활성화 기준 X.
 * - get-my-subscription 을 polling 해서 status='active' 일 때만 성공 처리.
 * - PayApp 웹훅이 도달할 때까지 최대 약 30초 polling. 그 뒤엔 결제확인중 안내.
 */
export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  const [sub, setSub] = useState<SubscriptionSnapshot | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    let tick = 0;

    async function poll() {
      if (stopped) return;
      const res = await fetchMySubscription();
      if (stopped) return;
      setSub(res.subscription);
      setElapsed(tick * 2);
      if (res.subscription?.status === 'active') {
        setDone(true);
        return;
      }
      tick += 1;
      if (tick >= 15) return; // ~30s
      timer.current = window.setTimeout(poll, 2000);
    }

    void poll();
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12 sm:px-6">
      <div className="rounded-2xl bg-bg-card p-6 ring-1 ring-line/10">
        {done ? (
          <>
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 size={20} />
              <h1 className="text-lg font-bold">결제가 완료됐어요</h1>
            </div>
            <p className="mt-2 text-sm text-ink-mute">
              {sub?.plan_type === 'business' ? 'SWK 사업자 이용권' : 'SWK 일반 이용권'} ·{' '}
              {sub?.price?.toLocaleString()}원/월
            </p>
            {sub?.current_period_end && (
              <p className="mt-1 text-xs text-ink-dim">
                다음 결제일: {new Date(sub.current_period_end).toLocaleDateString('ko-KR')}
              </p>
            )}
            <button
              onClick={() => navigate('/', { replace: true })}
              className="btn-primary mt-5 w-full py-2.5"
            >
              <ArrowRight size={14} /> 홈으로 이동
            </button>
          </>
        ) : sub?.status === 'payment_waiting' ? (
          <>
            <div className="flex items-center gap-2 text-amber-300">
              <AlertCircle size={20} />
              <h1 className="text-lg font-bold">결제 대기 중</h1>
            </div>
            <p className="mt-2 text-sm text-ink-mute">
              가상계좌 입금 등 결제 확정을 기다리고 있어요. 입금 완료 후 자동으로 적용됩니다.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Loader2 size={20} className="animate-spin text-accent" />
              <h1 className="text-lg font-bold">결제 확인 중입니다</h1>
            </div>
            <p className="mt-2 text-sm text-ink-mute">
              결제 정보를 확인하고 있어요. 잠시만 기다려주세요. ({elapsed}s)
            </p>
            <p className="mt-3 text-[11px] text-ink-dim">
              주문번호: {orderNo ?? '—'}
            </p>
            {elapsed >= 30 && (
              <div className="mt-4 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-200">
                결제 확정에 시간이 걸리고 있어요. 보통 1-2분 안에 완료됩니다.
                계속 표시되면 마이페이지에서 구독 상태를 확인하거나 고객센터로 문의해주세요.
              </div>
            )}
          </>
        )}
      </div>

      <Link to="/profile" className="block text-center text-xs text-ink-mute hover:text-ink">
        마이페이지로 가기
      </Link>
    </div>
  );
}
