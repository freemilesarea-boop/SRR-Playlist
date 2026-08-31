import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Loader2, CheckCircle2, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { formatKRW, normalizePhone } from '@/lib/paymentFormat';
import { PAYER_TYPE_LABEL } from '@/lib/enterprisePayment';
import {
  getMyEnterprisePaymentContext, createEnterprisePayment,
  type EnterprisePaymentContext,
} from '@/lib/enterprisePaymentApi';

export default function EnterprisePayPage() {
  const { profile } = useAuthStore();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<EnterprisePaymentContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState<string>((profile as { phone?: string } | null)?.phone ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try { setCtx(await getMyEnterprisePaymentContext()); }
      catch (e) { toast.error(friendlyError(e, '결제 정보를 불러오지 못했어요')); }
      finally { setLoading(false); }
    })();
  }, []);

  async function pay() {
    const digits = normalizePhone(phone);
    if (digits.length < 9) { toast.error('연락처를 정확히 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await createEnterprisePayment(digits);
      if (res.ok && res.payurl) { window.location.href = res.payurl; return; }
      toast.error(res.reason || res.error || '결제를 시작하지 못했어요.');
    } catch (e) {
      toast.error(friendlyError(e, '결제 시작 실패'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Link to="/enterprise/me" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink">
        <ArrowLeft size={14} /> 대시보드
      </Link>

      <div className="rounded-2xl bg-bg-card p-6 ring-1 ring-line/10">
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={20} className="text-ink" />
          <h1 className="text-lg font-extrabold tracking-tight">엔터프라이즈 결제</h1>
        </div>

        {loading ? (
          <p className="py-8 text-center"><Loader2 size={20} className="mx-auto animate-spin text-ink-mute" /></p>
        ) : ctx?.should_pay ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-bg-base p-4 ring-1 ring-line/10">
              <p className="text-xs text-ink-mute">{ctx.enterprise_name} · {ctx.payer_type ? PAYER_TYPE_LABEL[ctx.payer_type] : ''} 월 정기결제</p>
              <p className="mt-1 text-2xl font-extrabold text-ink">{formatKRW(ctx.amount ?? 0)}<span className="ml-1 text-sm font-semibold text-ink-mute">/ 월</span></p>
              <p className="mt-1 text-[11px] text-ink-dim">첫 결제 후 매월 자동으로 청구됩니다.</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-mute">연락처</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" inputMode="numeric"
                className="w-full rounded-lg bg-bg-base px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
            </label>
            <button onClick={pay} disabled={submitting}
              className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90 disabled:opacity-50">
              {submitting ? <Loader2 size={16} className="mx-auto animate-spin" /> : `${formatKRW(ctx.amount ?? 0)} 정기결제 등록`}
            </button>
            <p className="flex items-center justify-center gap-1 text-[11px] text-ink-dim">
              <ShieldCheck size={12} /> PayApp 안전결제 · 카드 정기결제
            </p>
          </div>
        ) : ctx?.already_active ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={40} className="mx-auto text-ink" />
            <p className="mt-3 text-base font-bold text-ink">이미 정기결제가 등록되어 있어요</p>
            <p className="mt-1 text-sm text-ink-mute">매월 자동으로 청구됩니다.</p>
            <button onClick={() => navigate('/enterprise/me')} className="mt-5 rounded-full bg-bg-hover px-4 py-2 text-sm font-semibold text-ink hover:opacity-90">대시보드로</button>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-base font-bold text-ink">결제 대상이 아니에요</p>
            <p className="mt-1 text-sm text-ink-mute">청구 설정이 되어 있지 않거나, 결제 주체가 아닙니다. 관리자에게 문의해주세요.</p>
            <button onClick={() => navigate('/enterprise/me')} className="mt-5 rounded-full bg-bg-hover px-4 py-2 text-sm font-semibold text-ink hover:opacity-90">대시보드로</button>
          </div>
        )}
      </div>
    </div>
  );
}
