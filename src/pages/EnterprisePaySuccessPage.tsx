import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Clock, ArrowRight } from 'lucide-react';
import { getMyEnterpriseOrderStatus, type EnterpriseOrderStatus } from '@/lib/enterprisePaymentApi';
import { formatKRW } from '@/lib/courseProduct';

export default function EnterprisePaySuccessPage() {
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  const [status, setStatus] = useState<EnterpriseOrderStatus | null>(null);
  const [waiting, setWaiting] = useState(true);
  const tries = useRef(0);

  useEffect(() => {
    if (!orderNo) { setWaiting(false); return; }
    let stop = false;
    const poll = async () => {
      try {
        const s = await getMyEnterpriseOrderStatus(orderNo);
        if (stop) return;
        setStatus(s);
        if (s?.paid) { setWaiting(false); return; }
      } catch { /* keep polling */ }
      tries.current += 1;
      if (tries.current >= 20) { setWaiting(false); return; }
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
          </>
        ) : paid ? (
          <>
            <CheckCircle2 size={44} className="mx-auto text-ink" />
            <h1 className="mt-4 text-lg font-extrabold text-ink">정기결제가 등록됐어요!</h1>
            {status && <p className="mt-2 text-sm text-ink-mute">{formatKRW(status.amount)} / 월 · 매월 자동 청구</p>}
          </>
        ) : (
          <>
            <Clock size={40} className="mx-auto text-ink-mute" />
            <h1 className="mt-4 text-lg font-bold text-ink">결제 확인이 지연되고 있어요</h1>
            <p className="mt-1 text-sm text-ink-mute">정상 결제되었다면 곧 반영됩니다. 문제가 지속되면 문의해주세요.</p>
          </>
        )}
        <Link to="/enterprise/me" className="mt-6 inline-flex items-center gap-1 rounded-full bg-bg-hover px-4 py-2 text-sm font-semibold text-ink hover:opacity-90">
          대시보드로 <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
