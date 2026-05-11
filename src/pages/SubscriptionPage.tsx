import { useState } from 'react';
import { Check, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SUBSCRIPTION_PLANS } from '@/lib/constants';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import type { SubscriptionType } from '@/types/db';

export default function SubscriptionPage() {
  const { profile, user, refreshProfile } = useAuthStore();
  const [busy, setBusy] = useState<SubscriptionType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = profile?.subscription_type ?? 'free';

  async function switchPlan(plan: SubscriptionType) {
    if (!user) return;
    if (plan === current) return;
    setBusy(plan);
    setMessage(null);
    try {
      // MVP: 정기결제 연동 전 단계 — 구독 상태만 업데이트
      // 실제 결제 연동 시 여기서 PayApp 결제 페이지로 이동
      const { error } = await supabase
        .from('users')
        .update({ subscription_type: plan })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setMessage(
        plan === 'free'
          ? '무료 플랜으로 변경되었어요.'
          : `${plan === 'personal' ? '일반' : '사업자'} 플랜이 활성화되었어요. (결제 연동 예정)`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '오류가 발생했어요.');
    } finally {
      setBusy(null);
    }
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

      {message && (
        <div className="rounded-xl bg-bg-card p-3 text-xs text-ink">{message}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((p) => {
          const isCurrent = current === p.key;
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
                <p className="text-xs text-ink-mute">{p.key === 'business' && '🏪 매장용'}</p>
                <h2 className="text-lg font-bold">{p.name}</h2>
                <p className="text-2xl font-extrabold tracking-tight">
                  {p.price === 0 ? '0원' : `${p.price.toLocaleString()}원`}
                  <span className="ml-1 text-xs font-normal text-ink-mute">/월</span>
                </p>
              </div>
              <ul className="space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs">
                    <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => switchPlan(p.key)}
                disabled={isCurrent || busy === p.key}
                className={isCurrent ? 'btn-ghost w-full' : 'btn-primary w-full'}
              >
                {busy === p.key
                  ? '변경 중…'
                  : isCurrent
                    ? '이용 중'
                    : p.key === 'free'
                      ? '무료로 변경'
                      : '시작하기'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-ink-dim">
        * MVP 단계에서는 결제 없이 플랜이 활성화돼요. PayApp 정기결제 연동은 곧 추가됩니다.
      </p>
    </div>
  );
}
