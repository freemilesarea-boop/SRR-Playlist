import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, RotateCcw, HelpCircle } from 'lucide-react';

export default function PaymentFailPage() {
  const [params] = useSearchParams();
  const orderNo = params.get('order_no');

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12 sm:px-6">
      <div className="rounded-2xl bg-bg-card p-6 ring-1 ring-line/10">
        <div className="flex items-center gap-2 text-red-300">
          <AlertCircle size={20} />
          <h1 className="text-lg font-bold">결제가 완료되지 않았어요</h1>
        </div>
        <p className="mt-2 text-sm text-ink-mute">
          결제 과정에서 취소되었거나 카드사 승인이 거부됐을 수 있어요. 다시 시도하거나 다른 결제수단으로 진행해주세요.
        </p>
        <p className="mt-3 text-[11px] text-ink-dim">주문번호: {orderNo ?? '—'}</p>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link to="/subscription" className="btn-primary justify-center py-2.5">
            <RotateCcw size={14} /> 다시 결제하기
          </Link>
          <a
            href="mailto:freemilesarea@gmail.com?subject=듣다 결제 문의"
            className="btn-ghost justify-center py-2.5"
          >
            <HelpCircle size={14} /> 고객센터 문의
          </a>
        </div>
      </div>
      <Link to="/" className="block text-center text-xs text-ink-mute hover:text-ink">
        홈으로 돌아가기
      </Link>
    </div>
  );
}
