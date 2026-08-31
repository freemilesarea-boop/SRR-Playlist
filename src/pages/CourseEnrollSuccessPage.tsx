import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Clock, ArrowRight } from 'lucide-react';
import { getMyCourseOrderStatus, type CourseOrderStatusResult } from '@/lib/courseApi';
import { formatKRW } from '@/lib/courseProduct';

// 결제 완료는 PayApp 웹훅이 비동기로 반영 → order 상태를 폴링.
export default function CourseEnrollSuccessPage() {
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  const [status, setStatus] = useState<CourseOrderStatusResult | null>(null);
  const [waiting, setWaiting] = useState(true);
  const tries = useRef(0);

  useEffect(() => {
    if (!orderNo) { setWaiting(false); return; }
    let stop = false;
    const poll = async () => {
      try {
        const s = await getMyCourseOrderStatus(orderNo);
        if (stop) return;
        setStatus(s);
        if (s?.paid) { setWaiting(false); return; }
      } catch { /* keep polling */ }
      tries.current += 1;
      if (tries.current >= 20) { setWaiting(false); return; } // ~60초
      if (!stop) setTimeout(poll, 3000);
    };
    void poll();
    return () => { stop = true; };
  }, [orderNo]);

  const paid = status?.paid === true;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      <div className="w-full rounded-2xl bg-bg-card p-8 ring-1 ring-line/10">
        {waiting ? (
          <>
            <Loader2 size={40} className="mx-auto animate-spin text-ink-mute" />
            <h1 className="mt-4 text-lg font-bold text-ink">결제를 확인하고 있어요…</h1>
            <p className="mt-1 text-sm text-ink-mute">결제 승인 반영까지 잠시 걸릴 수 있어요.</p>
          </>
        ) : paid ? (
          <>
            <CheckCircle2 size={44} className="mx-auto text-ink" />
            <h1 className="mt-4 text-lg font-extrabold text-ink">수강 신청이 완료됐어요!</h1>
            {status && (
              <p className="mt-2 text-sm text-ink-mute">
                {status.product_name} · {formatKRW(status.amount)} 결제 완료
              </p>
            )}
          </>
        ) : (
          <>
            <Clock size={40} className="mx-auto text-ink-mute" />
            <h1 className="mt-4 text-lg font-bold text-ink">결제 확인이 지연되고 있어요</h1>
            <p className="mt-1 text-sm text-ink-mute">
              결제가 정상 처리되었다면 곧 신청이 확정됩니다. 문제가 지속되면 문의해주세요.
            </p>
          </>
        )}
        <Link to="/courses" className="mt-6 inline-flex items-center gap-1 rounded-full bg-bg-hover px-4 py-2 text-sm font-semibold text-ink hover:opacity-90">
          수강신청으로 돌아가기 <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
