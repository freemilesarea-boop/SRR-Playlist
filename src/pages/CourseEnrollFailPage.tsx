import { Link, useSearchParams } from 'react-router-dom';
import { XCircle, ArrowRight } from 'lucide-react';

export default function CourseEnrollFailPage() {
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      <div className="w-full rounded-2xl bg-bg-card p-8 ring-1 ring-line/10">
        <XCircle size={44} className="mx-auto text-ink-mute" />
        <h1 className="mt-4 text-lg font-extrabold text-ink">결제가 완료되지 않았어요</h1>
        <p className="mt-1 text-sm text-ink-mute">결제가 취소되었거나 중단되었어요. 다시 시도해주세요.</p>
        {orderNo && <p className="mt-2 text-[11px] text-ink-dim">주문번호: <span className="font-mono">{orderNo}</span></p>}
        <Link to="/courses" className="mt-6 inline-flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-bold text-bg-base hover:opacity-90">
          다시 신청하기 <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
