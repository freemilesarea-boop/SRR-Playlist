import { useEffect, useState } from 'react';
import { Check, ArrowLeft, X, Mail, CreditCard, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SUBSCRIPTION_PLANS } from '@/lib/constants';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import type { SubscriptionType } from '@/types/db';

interface PendingRequest {
  id: string;
  requested_plan: SubscriptionType;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
}

export default function SubscriptionPage() {
  const { profile, user, refreshProfile } = useAuthStore();
  const [busy, setBusy] = useState<SubscriptionType | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const current = profile?.subscription_type ?? 'free';

  async function loadPending() {
    if (!user) return;
    const { data } = await supabase
      .from('subscription_requests')
      .select('id, requested_plan, status, created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setPending((data as PendingRequest) ?? null);
  }

  useEffect(() => {
    void loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function requestPlan(plan: SubscriptionType) {
    if (!user) return;
    if (plan === current) return;
    if (plan === 'free') {
      // 무료 다운그레이드는 즉시
      setBusy(plan);
      const { error } = await supabase
        .from('users')
        .update({ subscription_type: 'free' })
        .eq('id', user.id);
      setBusy(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      await refreshProfile();
      toast.success('무료 플랜으로 변경되었어요.');
      return;
    }

    setBusy(plan);
    try {
      const { error } = await supabase.from('subscription_requests').insert({
        user_id: user.id,
        requested_plan: plan,
        status: 'pending',
      });
      if (error) throw error;
      toast.success('구독 신청이 접수됐어요. 결제 안내를 곧 보내드릴게요.');
      await loadPending();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '신청 중 오류가 발생했어요.');
    } finally {
      setBusy(null);
    }
  }

  async function cancelPending() {
    if (!pending) return;
    const { error } = await supabase
      .from('subscription_requests')
      .update({ status: 'cancelled' })
      .eq('id', pending.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPending(null);
    toast.info('신청이 취소됐어요.');
  }

  return (
    <div className="space-y-6 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link
          to="/profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
          aria-label="뒤로"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">구독</h1>
          <p className="text-xs text-ink-mute">필요한 만큼만, 가볍게.</p>
        </div>
      </header>

      {pending && (
        <div className="space-y-2 rounded-2xl bg-accent/10 p-4 ring-1 ring-accent/30">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            <Clock size={14} />
            {pending.requested_plan === 'business' ? '사업자' : '일반'} 플랜 신청 대기 중
          </div>
          <p className="text-xs leading-relaxed text-ink-mute">
            운영자가 확인 후 결제 안내를 이메일/카카오톡으로 전달드려요.
            평균 1영업일 이내 처리됩니다.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="mailto:hello@srr-playlist.app?subject=스르륵 플리 구독 문의"
              className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
            >
              <Mail size={12} /> 이메일 문의
            </a>
            <a
              href="https://pf.kakao.com/_xxxxx"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-yellow-400/90 px-3 py-1.5 text-xs text-black hover:bg-yellow-300"
            >
              💬 카카오톡 채널
            </a>
            <button
              onClick={cancelPending}
              className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-xs text-ink-mute hover:bg-red-500/15 hover:text-red-200"
            >
              신청 취소
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((p) => {
          const isCurrent = current === p.key;
          const isPending = pending?.requested_plan === p.key;
          const isBusy = busy === p.key;
          return (
            <div
              key={p.key}
              className={`relative space-y-3 rounded-2xl p-5 transition ${
                isCurrent
                  ? 'bg-gradient-to-br from-accent-soft/40 to-bg-card ring-1 ring-accent/60'
                  : 'bg-bg-card'
              }`}
            >
              {isCurrent && (
                <div className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
                  현재 플랜
                </div>
              )}
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-ink-dim">
                  {p.tagline}
                </p>
                <h2 className="text-lg font-bold">{p.name}</h2>
                <p className="text-2xl font-extrabold tracking-tight">
                  {p.price === 0 ? '0원' : `${p.price.toLocaleString()}원`}
                  <span className="ml-1 text-xs font-normal text-ink-mute">/월</span>
                </p>
              </div>
              <ul className="space-y-1.5 text-xs">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
                {p.excluded.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-ink-dim">
                    <X size={13} className="mt-0.5 shrink-0" />
                    <span className="line-through">{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => requestPlan(p.key)}
                disabled={isCurrent || isBusy || isPending}
                className={isCurrent ? 'btn-ghost w-full' : 'btn-primary w-full'}
              >
                {isBusy ? (
                  '처리 중…'
                ) : isCurrent ? (
                  '이용 중'
                ) : isPending ? (
                  <>
                    <Clock size={14} /> 신청 대기 중
                  </>
                ) : p.key === 'free' ? (
                  '무료로 변경'
                ) : (
                  <>
                    <CreditCard size={14} /> 구독 신청하기
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 rounded-2xl bg-bg-card p-4">
        <h3 className="text-sm font-semibold">결제 안내</h3>
        <p className="text-xs leading-relaxed text-ink-mute">
          MVP 단계에서는 정기결제 모듈(PayApp) 연동 전이라 구독 신청 → 운영진 확인 → 결제 안내
          순서로 진행해요. 신청은 언제든 취소할 수 있어요.
        </p>
        <a
          href="mailto:hello@srr-playlist.app?subject=스르륵 플리 매장 구독 문의"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Mail size={12} /> 매장 일괄 도입 문의
        </a>
      </div>
    </div>
  );
}
