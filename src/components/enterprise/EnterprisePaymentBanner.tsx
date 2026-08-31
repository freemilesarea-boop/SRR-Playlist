import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, ArrowRight } from 'lucide-react';
import { getMyEnterprisePaymentContext, type EnterprisePaymentContext } from '@/lib/enterprisePaymentApi';
import { PAYER_TYPE_LABEL } from '@/lib/enterprisePayment';
import { formatKRW } from '@/lib/paymentFormat';

/**
 * 엔터프라이즈 결제가 필요한 사용자(가입 직후 등)에게 상단에 노출되는 결제 CTA.
 * should_pay 가 아니면 아무것도 렌더하지 않는다.
 */
export default function EnterprisePaymentBanner() {
  const [ctx, setCtx] = useState<EnterprisePaymentContext | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try { const c = await getMyEnterprisePaymentContext(); if (!stop) setCtx(c); }
      catch { /* 비대상 사용자 등 — 조용히 무시 */ }
    })();
    return () => { stop = true; };
  }, []);

  if (!ctx?.should_pay) return null;

  return (
    <Link
      to="/enterprise/pay"
      className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/15 transition hover:bg-bg-hover"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-hover">
          <CreditCard size={18} className="text-ink" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {ctx.payer_type ? PAYER_TYPE_LABEL[ctx.payer_type] : ''} 정기결제를 등록해주세요
          </p>
          <p className="text-[12px] text-ink-mute">
            {ctx.enterprise_name} · {formatKRW(ctx.amount ?? 0)} / 월 (매월 자동)
          </p>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-bg-base">
        결제하기 <ArrowRight size={13} />
      </span>
    </Link>
  );
}
