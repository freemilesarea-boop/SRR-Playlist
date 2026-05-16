import { useEffect, useState } from 'react';
import { Check, X, ArrowLeft, Mail, Clock, Sparkles, Store, Music } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { createPayappSubscription } from '@/lib/subscriptionApi';
import { toast } from '@/store/toastStore';
import type { SubscriptionType } from '@/types/db';

interface PendingRequest {
  id: string;
  requested_plan: SubscriptionType;
  status: 'pending' | 'contacted' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
}

// SubscriptionType 은 'free'|'personal'|'individual'|'business' 인데 비교표는
// 3개 컬럼 (free / 일반 / 사업자) 만 표시하므로 narrowed key set 사용.
type PlanKey = 'free' | 'personal' | 'business';

// users.membership_tier (단일 진실 원천) → UI plan key 매핑.
//   tier='individual' → UI 'personal' (구버전 subscription_type 호환)
//   tier='business'   → UI 'business'
//   tier='free' / null/unknown → 'free'
function tierToPlanKey(tier: string | null | undefined): PlanKey {
  if (tier === 'individual' || tier === 'personal') return 'personal';
  if (tier === 'business') return 'business';
  return 'free';
}

interface PlanCfg {
  key: PlanKey;
  name: string;
  tagline: string;
  price: number;
  cta: string;
  highlight?: boolean;
  icon: React.ReactNode;
}

const PLANS: PlanCfg[] = [
  {
    key: 'free',
    name: '무료',
    tagline: '가볍게 시작',
    price: 0,
    cta: '무료로 시작',
    icon: <Music size={18} />,
  },
  {
    key: 'personal',
    name: '일반',
    tagline: '내 일상에',
    price: 4900,
    cta: '광고 없이 감성 음악 듣기',
    icon: <Sparkles size={18} />,
  },
  {
    key: 'business',
    name: '사업자',
    tagline: '매장에서 그대로',
    price: 6900,
    cta: '우리 매장 음악 자동 운영하기',
    highlight: true,
    icon: <Store size={18} />,
  },
];

interface FeatureRow {
  group: string;
  label: string;
  values: Record<PlanKey, boolean | string>;
}

const FEATURES: FeatureRow[] = [
  // 음악 감상
  {
    group: '음악 감상',
    label: '플레이리스트 감상',
    values: { free: '일부', personal: '무제한', business: '무제한' },
  },
  {
    group: '음악 감상',
    label: '광고 없음',
    values: { free: false, personal: true, business: true },
  },
  {
    group: '음악 감상',
    label: '좋아요 / 보관함',
    values: { free: false, personal: true, business: true },
  },
  {
    group: '음악 감상',
    label: '프리미엄 감성 플리',
    values: { free: false, personal: true, business: true },
  },
  // 매장 운영
  {
    group: '매장 운영',
    label: '매장 모드 (셔플 + 무한반복)',
    values: { free: false, personal: false, business: true },
  },
  {
    group: '매장 운영',
    label: '화면 꺼짐 방지 (WakeLock)',
    values: { free: false, personal: false, business: true },
  },
  {
    group: '매장 운영',
    label: '시간대 자동 추천',
    values: { free: false, personal: false, business: true },
  },
  {
    group: '매장 운영',
    label: '업종별 추천 (카페·PT·필라테스 등)',
    values: { free: false, personal: false, business: true },
  },
  {
    group: '매장 운영',
    label: '장시간 재생 최적화',
    values: { free: false, personal: false, business: true },
  },
  {
    group: '매장 운영',
    label: '직원 공유 (예정)',
    values: { free: false, personal: false, business: '예정' },
  },
];

export default function SubscriptionPage() {
  const { profile, user, refreshProfile } = useAuthStore();
  const [busy, setBusy] = useState<SubscriptionType | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [phoneModal, setPhoneModal] = useState<{ plan: 'personal' | 'business'; phone: string } | null>(null);
  // 직접 fetch 한 fresh tier — zustand 캐시 stale 일 수 있어 진입/포커스마다 새로 읽음.
  const [freshTier, setFreshTier] = useState<string | null>(null);

  // 표시 기준: fresh tier 가 있으면 그것, 없으면 profile.membership_tier, 그것도 없으면 free.
  // membership_tier 는 webhook(state=64/refund 등) 가 직접 set 하는 단일 진실 원천.
  const tier = freshTier ?? profile?.membership_tier ?? 'free';
  const current: PlanKey = tierToPlanKey(tier);

  async function startPayappCheckout(planUi: 'personal' | 'business', phone: string) {
    if (!user) return;
    setBusy(planUi);
    try {
      // SubscriptionType 'personal' ↔ PayApp 'individual' 매핑
      const planType: 'individual' | 'business' = planUi === 'personal' ? 'individual' : 'business';
      const res = await createPayappSubscription({ plan_type: planType, recvphone: phone });
      if (res.ok && res.payurl) {
        // PayApp 결제창으로 이동. 권한 부여는 절대 여기서 X — feedbackurl 웹훅에서만.
        window.location.href = res.payurl;
        return;
      }
      toast.error(res.error ?? 'PayApp 결제 생성 실패');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PayApp 결제 생성 실패');
    } finally {
      setBusy(null);
      setPhoneModal(null);
    }
  }

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

  // 현재 로그인 user 의 membership_tier 를 supabase 에서 직접 fetch — RLS 통과 후
  // zustand profile 캐시와 별개로 진실값 확보. refreshProfile 도 동시에 트리거.
  async function reloadFreshTier() {
    if (!user) return;
    const { data, error } = await supabase
      .from('users')
      .select('membership_tier')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data) setFreshTier((data as { membership_tier: string | null }).membership_tier ?? 'free');
    void refreshProfile();
  }

  useEffect(() => {
    void loadPending();
    void reloadFreshTier();
    // 페이지 포커스 / 가시성 변화 시 결제 직후 webhook 적용 반영 위해 refresh.
    function onFocus() {
      void reloadFreshTier();
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') void reloadFreshTier();
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function requestPlan(plan: PlanKey) {
    if (!user || plan === current) return;
    if (plan === 'free') {
      setBusy('free');
      // membership_tier 와 subscription_type 둘 다 free 로 정리 (단일 진실 원천 일관성)
      const { error } = await supabase
        .from('users')
        .update({ subscription_type: 'free', membership_tier: 'free' })
        .eq('id', user.id);
      setBusy(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      await reloadFreshTier();
      toast.success('무료 플랜으로 변경되었어요.');
      return;
    }

    // PayApp 결제 플로우 — 전화번호 입력 모달
    if (plan === 'personal' || plan === 'business') {
      setPhoneModal({ plan, phone: '' });
      return;
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

  // 그룹별로 features 묶기
  const groups = Array.from(new Set(FEATURES.map((f) => f.group)));

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
          <h1 className="text-2xl font-extrabold tracking-tight">구독</h1>
          <p className="text-xs text-ink-mute">필요한 만큼만, 가볍게.</p>
        </div>
      </header>

      {pending && (
        <div className="space-y-2 rounded-2xl bg-accent/10 p-4 ring-1 ring-accent/30">
          <div className="flex items-center gap-2 text-sm font-bold text-accent">
            <Clock size={14} />
            {pending.requested_plan === 'business' ? '사업자' : '일반'} 플랜 신청 대기 중
          </div>
          <p className="text-xs leading-relaxed text-ink-mute">
            운영자가 확인 후 결제 안내를 이메일/카카오톡으로 전달드려요. 평균 1영업일 이내.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="mailto:hello@srr-playlist.app?subject=스르륵 플리 구독 문의"
              className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
            >
              <Mail size={12} /> 이메일 문의
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

      {/* 플랜 카드 (요약) */}
      <div className="grid gap-3 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = current === p.key;
          const isPending = pending?.requested_plan === p.key;
          const isBusy = busy === p.key;
          return (
            <div
              key={p.key}
              className={`relative space-y-3 rounded-3xl p-5 transition ${
                p.highlight
                  ? 'bg-gradient-to-br from-accent-soft/40 to-bg-card ring-1 ring-accent/40 shadow-2xl'
                  : isCurrent
                    ? 'bg-bg-card ring-1 ring-accent/60'
                    : 'bg-bg-card ring-1 ring-line/10'
              }`}
            >
              {p.highlight && !isCurrent && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-black shadow-lg">
                  추천
                </div>
              )}
              {isCurrent && (
                <div className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-black">
                  이용 중
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/10 text-ink">
                  {p.icon}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    {p.tagline}
                  </p>
                  <h2 className="text-lg font-bold leading-tight">{p.name}</h2>
                </div>
              </div>
              <p className="text-3xl font-black tracking-tight">
                {p.price === 0 ? '0원' : `${p.price.toLocaleString()}원`}
                <span className="ml-1 text-xs font-medium text-ink-mute">/월</span>
              </p>

              <button
                onClick={() => requestPlan(p.key)}
                disabled={isCurrent || isBusy || isPending}
                className={`w-full rounded-xl py-3 text-sm font-bold transition active:scale-[0.99] disabled:opacity-50 ${
                  p.highlight && !isCurrent
                    ? 'bg-accent text-black hover:opacity-90'
                    : 'bg-ink/10 text-ink hover:bg-ink/15'
                }`}
              >
                {isBusy
                  ? '처리 중…'
                  : isCurrent
                    ? '이용 중'
                    : isPending
                      ? '신청 대기 중'
                      : p.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* 비교표 */}
      <section className="overflow-hidden rounded-3xl bg-bg-card ring-1 ring-line/10">
        <header className="border-b border-line/10 px-5 py-4">
          <h2 className="text-base font-bold">기능 비교</h2>
          <p className="mt-0.5 text-xs text-ink-mute">한눈에 보세요.</p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-4 py-3 text-left font-semibold">기능</th>
                {PLANS.map((p) => (
                  <th
                    key={p.key}
                    className={`px-3 py-3 text-center font-semibold ${
                      p.highlight ? 'text-accent' : ''
                    }`}
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <>
                  <tr key={`g-${g}`} className="bg-bg-soft/40">
                    <td
                      colSpan={4}
                      className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute"
                    >
                      {g}
                    </td>
                  </tr>
                  {FEATURES.filter((f) => f.group === g).map((f) => (
                    <tr key={`${f.group}-${f.label}`} className="border-b border-line/10">
                      <td className="px-4 py-3 text-ink">{f.label}</td>
                      {PLANS.map((p) => {
                        const v = f.values[p.key];
                        return (
                          <td key={p.key} className="px-3 py-3 text-center">
                            {v === true && (
                              <Check
                                size={16}
                                className={`mx-auto ${p.highlight ? 'text-accent' : 'text-emerald-400'}`}
                              />
                            )}
                            {v === false && <X size={16} className="mx-auto text-ink-dim" />}
                            {typeof v === 'string' && (
                              <span
                                className={`text-xs font-semibold ${
                                  p.highlight ? 'text-accent' : 'text-ink'
                                }`}
                              >
                                {v}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h3 className="text-sm font-bold">결제 안내</h3>
        <p className="text-xs leading-relaxed text-ink-mute">
          PayApp 정기결제로 매월 자동 결제됩니다. 결제 완료/구독 활성화는 PayApp 결제 확인 후
          자동 반영돼요.
        </p>
        <p className="text-xs leading-relaxed text-yellow-200/90">
          <strong>해지 정책:</strong> 해지 즉시 이용권이 종료되며 무료 플랜으로 다운그레이드됩니다.
          남은 기간에 대한 환불은 자동 처리되지 않으니 고객센터로 문의해주세요.
        </p>
        <a
          href="mailto:freemilesarea@gmail.com?subject=스르륵 플리 매장 구독 문의"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Mail size={12} /> 매장 일괄 도입 문의
        </a>
      </div>

      {phoneModal && (
        <PhoneModal
          plan={phoneModal.plan}
          busy={busy === phoneModal.plan}
          onCancel={() => setPhoneModal(null)}
          onConfirm={(p) => startPayappCheckout(phoneModal.plan, p)}
        />
      )}
    </div>
  );
}

function PhoneModal({
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: 'personal' | 'business';
  busy: boolean;
  onCancel: () => void;
  onConfirm: (phone: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const valid = phone.replace(/\D/g, '').length >= 9;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-bg-card p-5 ring-1 ring-line/10">
        <h3 className="text-base font-bold">
          {plan === 'business' ? 'SRR Playlist 사업자 정기이용권' : 'SRR Playlist 정기이용권'} 결제
        </h3>
        <p className="text-xs text-ink-mute">
          결제 알림을 받을 휴대폰 번호를 입력해주세요. PayApp 결제창으로 이동합니다.
        </p>
        <input
          type="tel"
          autoFocus
          placeholder="010-0000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          <button
            onClick={() => onConfirm(phone)}
            disabled={!valid || busy}
            className="btn-primary px-4 py-2 text-xs"
          >
            {busy ? '결제창 준비중…' : 'PayApp 결제하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
