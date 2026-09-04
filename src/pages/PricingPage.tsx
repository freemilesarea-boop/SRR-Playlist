/**
 * PricingPage — 좌측 네비 "요금제"
 *
 * 일반 회원으로 가입한 점주님들이 가입 이후에 결제 화면을 찾지 못하던 문제를 해결한다.
 * 가입 유형과 관계없이 언제든 아래 3가지 중 하나로 결제/가입할 수 있다.
 *
 *   1. 매장 가입          — 기존 business 플랜 정기결제 (create-payapp-subscription)
 *   2. 엔터프라이즈 본사  — 사업자 인증 → 본사 계정 생성(승인 대기) + 본사 코드 발급
 *   3. 엔터프라이즈 가맹  — 본사 코드 입력 → 매장 연결 → 정기결제(/enterprise/pay)
 *
 * 권한 부여는 전부 서버(PayApp 웹훅)에서만 일어난다. 이 화면은 결제창 진입과 상태 표시만 한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Store, Building2, Network, Check, ShieldCheck, Loader2, Copy, ArrowLeft, AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';
import { formatKRW } from '@/lib/paymentFormat';
import { createPayappSubscription } from '@/lib/subscriptionApi';
import { validatePromotionCode, type PromotionValidation } from '@/lib/adminApi';
import {
  getMyPricingContext, verifyBusinessNumberServerSide, applyEnterpriseHq,
  lookupEnterpriseJoinCode, joinEnterpriseStoreByCode, type JoinCodeLookup,
} from '@/lib/api/pricingApi';
import {
  PRICING_CATEGORY_LABEL, storeCardState, storeMonthlyPrice, storeCheckoutBlockedReason,
  hqCardState, hqAwaitingPriceSetup, hqCanPayNow, canApplyHq, validateHqApplyForm,
  isBusinessNumberChecksumValid, isBusinessVerificationUsable,
  franchiseCardState, franchiseCanPayNow, franchisePaymentNotice, normalizeJoinCode,
  type PricingCategory, type PricingContext, type HqApplyForm,
} from '@/lib/pricingPlans';

const CATEGORY_META: Array<{
  key: PricingCategory; Icon: typeof Store; tagline: string; blurb: string;
}> = [
  {
    key: 'store', Icon: Store, tagline: '단일 매장',
    blurb: '내 매장 한 곳에서 저작권 걱정 없이 음악을 자동으로 틀어요.',
  },
  {
    key: 'enterprise_hq', Icon: Building2, tagline: '브랜드 본사',
    blurb: '사업자 인증 후 본사 계정을 만들고, 가맹점 가입용 본사 코드를 받아요.',
  },
  {
    key: 'enterprise_store', Icon: Network, tagline: '가맹점',
    blurb: '본사에서 받은 코드로 매장을 연결하고 브랜드 음악을 그대로 사용해요.',
  },
];

const STORE_FEATURES = [
  '매장 모드 · 셔플/무한반복 자동 운영',
  '시간대별 자동 전환 스케줄러',
  '광고 없는 전곡 재생',
  '매장 QR · 손님 신청곡',
];

export default function PricingPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<PricingContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PricingCategory>('store');

  const reload = useCallback(async () => {
    try { setCtx(await getMyPricingContext()); }
    catch (e) { toast.error(friendlyError(e, '요금제 정보를 불러오지 못했어요')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // 결제창에서 돌아오면(웹훅 반영 후) 상태를 다시 읽는다.
  useEffect(() => {
    function onFocus() { void reload(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const price = storeMonthlyPrice(ctx);

  return (
    <div className="space-y-6 px-4 pb-10 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link to="/profile" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">요금제</h1>
          <p className="text-xs text-ink-mute">가입 유형과 상관없이 언제든 결제하실 수 있어요.</p>
        </div>
      </header>

      {loading ? (
        <p className="py-16 text-center"><Loader2 size={22} className="mx-auto animate-spin text-ink-mute" /></p>
      ) : !user ? (
        <Alert tone="info">
          로그인 후 이용하실 수 있어요.{' '}
          <button onClick={() => navigate('/login')} className="font-bold underline">로그인하기</button>
        </Alert>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {CATEGORY_META.map(({ key, Icon, tagline, blurb }, idx) => {
              const active = open === key;
              return (
                <button
                  key={key}
                  onClick={() => setOpen(key)}
                  className={`space-y-2 rounded-3xl p-5 text-left transition active:scale-[0.995] ${
                    active ? 'bg-bg-card ring-2 ring-accent/60' : 'bg-bg-card ring-1 ring-line/10 hover:ring-line/25'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/10 text-ink">
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{tagline}</p>
                      <h2 className="text-lg font-bold leading-tight">{PRICING_CATEGORY_LABEL[key]}</h2>
                    </div>
                    <span className="ml-auto font-mono text-[10px] tracking-wider text-ink-dim">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-ink-mute">{blurb}</p>
                </button>
              );
            })}
          </div>

          {open === 'store' && (
            <StorePanel ctx={ctx} price={price} defaultPhone={(profile as { phone?: string } | null)?.phone ?? ''} />
          )}
          {open === 'enterprise_hq' && (
            <HqPanel ctx={ctx} profile={profile as { full_name?: string; phone?: string } | null} onChanged={reload} />
          )}
          {open === 'enterprise_store' && (
            <FranchisePanel ctx={ctx} onChanged={reload} />
          )}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════ 1. 매장 가입 ══════════════════════════ */

function StorePanel({ ctx, price, defaultPhone }: {
  ctx: PricingContext | null; price: number; defaultPhone: string;
}) {
  const state = storeCardState(ctx);
  const blocked = storeCheckoutBlockedReason(ctx);
  const [phone, setPhone] = useState(defaultPhone);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<PromotionValidation | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoBusy(true); setPromoError(null);
    try {
      const v = await validatePromotionCode(code, 'business');
      if (v.valid) setPromo(v);
      else { setPromo(null); setPromoError('사용할 수 없는 프로모션 코드입니다.'); }
    } catch {
      setPromo(null); setPromoError('프로모션 코드 확인 중 오류가 발생했어요.');
    } finally { setPromoBusy(false); }
  }

  async function checkout() {
    if (phone.replace(/\D/g, '').length < 9) { toast.error('연락처를 정확히 입력해주세요.'); return; }
    setBusy(true);
    try {
      const res = await createPayappSubscription({
        plan_type: 'business',
        recvphone: phone.replace(/\D/g, ''),
        promotion_code: promo ? promoInput.trim() : null,
      });
      // 권한 부여는 절대 프론트에서 하지 않는다 — PayApp 웹훅에서만.
      if (res.ok && res.payurl) { window.location.href = res.payurl; return; }
      toast.error(res.error ?? '결제를 시작하지 못했어요.');
    } catch (e) {
      toast.error(friendlyError(e, '결제 시작 실패'));
    } finally { setBusy(false); }
  }

  return (
    <Panel title="매장 가입" subtitle="매장 한 곳을 위한 월 정기 이용권">
      <div className="rounded-2xl bg-bg-base p-4 ring-1 ring-line/10">
        <p className="text-3xl font-black tracking-tight">
          {formatKRW(price)}<span className="ml-1 text-xs font-medium text-ink-mute">/월</span>
        </p>
        <ul className="mt-3 space-y-1.5">
          {STORE_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-ink-mute">
              <Check size={15} className="mt-0.5 shrink-0 text-accent" />{f}
            </li>
          ))}
        </ul>
      </div>

      {state === 'active' ? (
        <Alert tone="success">이미 매장 요금제를 이용 중이에요. 결제 관리는 <Link to="/subscription" className="font-bold underline">구독 페이지</Link>에서 하실 수 있어요.</Alert>
      ) : blocked ? (
        <Alert tone="info">{blocked}</Alert>
      ) : (
        <div className="space-y-3">
          {state === 'upgrade' && (
            <Alert tone="info">현재 일반 요금제를 이용 중이에요. 매장 요금제로 결제하시면 매장 기능이 함께 열립니다.</Alert>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-mute">결제 알림 받을 연락처</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric"
              placeholder="010-0000-0000" className="input" />
          </label>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-ink-mute">프로모션 코드 (선택)</span>
            <div className="flex gap-2">
              <input value={promoInput} disabled={!!promo}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="코드 입력" className="input flex-1 font-mono uppercase disabled:opacity-60" />
              {promo ? (
                <button onClick={() => { setPromo(null); setPromoInput(''); setPromoError(null); }}
                  className="btn-ghost shrink-0 px-3 py-2 text-xs">해제</button>
              ) : (
                <button onClick={() => void applyPromo()} disabled={!promoInput.trim() || promoBusy}
                  className="btn-primary shrink-0 px-4 py-2 text-xs">{promoBusy ? '확인 중…' : '적용'}</button>
              )}
            </div>
            {promoError && <p className="text-xs text-red-400">{promoError}</p>}
            {promo && (
              <p className="text-xs font-semibold text-accent">
                {promo.name || promo.code} 적용 · 결제 금액 {formatKRW(promo.final_amount ?? price)}
              </p>
            )}
          </div>

          <button onClick={() => void checkout()} disabled={busy}
            className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : `${formatKRW(price)} 정기결제 시작`}
          </button>
          <p className="flex items-center justify-center gap-1 text-[11px] text-ink-dim">
            <ShieldCheck size={12} /> PayApp 안전결제 · 카드 정기결제 · 언제든 해지 가능
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ═════════════════════ 2. 엔터프라이즈 본사 ═════════════════════ */

function HqPanel({ ctx, profile, onChanged }: {
  ctx: PricingContext | null;
  profile: { full_name?: string; phone?: string } | null;
  onChanged: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const state = hqCardState(ctx);
  const hq = ctx?.hq ?? null;

  const [form, setForm] = useState<HqApplyForm>({
    enterpriseName: '',
    businessNumber: '',
    businessName: '',
    representativeName: '',
    businessOpenDate: '',
    businessAddress: '',
    managerName: profile?.full_name ?? '',
    managerPhone: profile?.phone ?? '',
    billingMode: 'per_store',
  });
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState(isBusinessVerificationUsable(ctx?.business_verification));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function set<K extends keyof HqApplyForm>(k: K, v: HqApplyForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === 'businessNumber' || k === 'representativeName' || k === 'businessOpenDate') {
      setVerified(false); setVerifyMsg(null);
    }
  }

  async function verify() {
    if (!isBusinessNumberChecksumValid(form.businessNumber)) {
      setVerifyMsg('사업자등록번호를 정확히 입력해주세요.'); return;
    }
    if (!form.representativeName.trim() || !form.businessOpenDate) {
      setVerifyMsg('대표자명과 개업일자를 입력해주세요.'); return;
    }
    setVerifying(true); setVerifyMsg(null);
    try {
      const r = await verifyBusinessNumberServerSide({
        businessNumber: form.businessNumber,
        representativeName: form.representativeName,
        businessOpenDate: form.businessOpenDate,
        businessName: form.businessName || form.enterpriseName,
        businessAddress: form.businessAddress,
      });
      setVerified(r.verification_status === 'verified' || r.verification_status === 'manual_review');
      setVerifyMsg(r.message);
    } catch (e) {
      setVerified(false);
      setVerifyMsg(friendlyError(e, '사업자 인증에 실패했어요'));
    } finally { setVerifying(false); }
  }

  async function submit() {
    const errs = validateHqApplyForm(form);
    setErrors(errs);
    if (errs.length) return;
    if (!verified) { setErrors(['사업자 인증을 먼저 완료해주세요.']); return; }
    setBusy(true);
    try {
      const r = await applyEnterpriseHq(form);
      if (r.success) {
        toast.success(r.already_exists ? '이미 등록된 본사 계정이 있어요.' : '본사 신청이 접수됐어요.');
        await onChanged();
      } else {
        setErrors(['신청에 실패했어요. 잠시 후 다시 시도해주세요.']);
      }
    } catch (e) {
      setErrors([friendlyError(e, '신청에 실패했어요')]);
    } finally { setBusy(false); }
  }

  if (ctx?.account_type === 'artist') {
    return (
      <Panel title="엔터프라이즈 본사" subtitle="브랜드 본사 계정">
        <Alert tone="info">아티스트 계정으로는 본사 신청을 할 수 없어요. 매장/브랜드용 계정으로 가입해주세요.</Alert>
      </Panel>
    );
  }

  if (hq) {
    return (
      <Panel title="엔터프라이즈 본사" subtitle={hq.enterprise_name}>
        {state === 'pending' && (
          <Alert tone="info">신청이 접수됐어요. 담당자 확인 후 승인되며, 승인 전에도 아래 본사 코드로 가맹점을 받을 수 있어요.</Alert>
        )}
        {state === 'active' && <Alert tone="success">승인된 본사 계정이에요.</Alert>}
        {state === 'blocked' && <Alert tone="warning">본사 계정이 일시 중지 상태예요. 고객센터로 문의해주세요.</Alert>}

        <JoinCodeBox code={hq.join_code} />

        <div className="rounded-2xl bg-bg-base p-4 text-sm ring-1 ring-line/10">
          <Row label="청구 방식" value={hq.billing_mode === 'per_store' ? '가맹점 개별 결제' : '본사 일괄 결제'} />
          <Row label="가맹점 월 요금"
            value={hq.billing_mode === 'per_store' && hq.store_monthly_price ? `${formatKRW(hq.store_monthly_price)} / 월` : '—'} />
          <Row label="본사 월 요금"
            value={hq.hq_monthly_price ? `${formatKRW(hq.hq_monthly_price)} / 월` : '협의 후 확정'} />
        </div>

        {hqAwaitingPriceSetup(ctx) && (
          <Alert tone="info">본사 일괄 결제를 선택하셨어요. 매장 수에 따라 요금을 확정한 뒤 결제 안내를 드립니다.</Alert>
        )}
        {hqCanPayNow(ctx) && (
          <button onClick={() => navigate('/enterprise/pay')}
            className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90">
            {formatKRW(ctx?.enterprise_payment?.amount ?? 0)} 정기결제 등록
          </button>
        )}
        <Link to="/enterprise/me" className="block text-center text-xs font-semibold text-ink-mute underline">
          본사 대시보드로 이동
        </Link>
      </Panel>
    );
  }

  if (!canApplyHq(ctx)) {
    return (
      <Panel title="엔터프라이즈 본사" subtitle="브랜드 본사 계정">
        <Alert tone="info">이미 가맹점으로 등록된 계정이에요. 본사 신청은 별도 계정으로 진행해주세요.</Alert>
      </Panel>
    );
  }

  return (
    <Panel title="엔터프라이즈 본사" subtitle="사업자 인증 후 바로 본사 계정이 만들어집니다">
      <div className="space-y-3">
        <SectionLabel>본사 정보</SectionLabel>
        <Field label="본사(브랜드)명 *">
          <input value={form.enterpriseName} onChange={(e) => set('enterpriseName', e.target.value)}
            placeholder="예: 카공시대" className="input" />
        </Field>

        <SectionLabel>사업자 인증</SectionLabel>
        <Field label="사업자등록번호 *" hint="숫자 10자리">
          <div className="flex gap-2">
            <input value={form.businessNumber} onChange={(e) => set('businessNumber', e.target.value)}
              placeholder="123-45-67890" inputMode="numeric" className="input flex-1 font-mono" />
            <button type="button" onClick={() => void verify()} disabled={verifying || verified}
              className={`shrink-0 rounded-lg px-3 text-xs font-semibold transition ${
                verified ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/30'
                         : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'}`}>
              {verified ? '확인됨' : verifying ? '확인 중…' : '인증'}
            </button>
          </div>
        </Field>
        <Field label="대표자명 *">
          <input value={form.representativeName} onChange={(e) => set('representativeName', e.target.value)} className="input" />
        </Field>
        <Field label="개업일자 *">
          <input type="date" value={form.businessOpenDate} onChange={(e) => set('businessOpenDate', e.target.value)} className="input" />
        </Field>
        <Field label="상호(사업자등록증상)">
          <input value={form.businessName} onChange={(e) => set('businessName', e.target.value)}
            placeholder="비워두면 본사명으로 저장돼요" className="input" />
        </Field>
        <Field label="사업장 주소">
          <input value={form.businessAddress} onChange={(e) => set('businessAddress', e.target.value)} className="input" />
        </Field>
        {verifyMsg && (
          <p className={`text-[11px] ${verified ? 'text-emerald-400' : 'text-red-400'}`}>{verifyMsg}</p>
        )}

        <SectionLabel>담당자</SectionLabel>
        <Field label="담당자명 *">
          <input value={form.managerName} onChange={(e) => set('managerName', e.target.value)} className="input" />
        </Field>
        <Field label="담당자 연락처 *">
          <input value={form.managerPhone} onChange={(e) => set('managerPhone', e.target.value)}
            placeholder="010-0000-0000" inputMode="numeric" className="input" />
        </Field>

        <SectionLabel>청구 방식</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <ModeOption
            selected={form.billingMode === 'per_store'}
            onSelect={() => set('billingMode', 'per_store')}
            title="가맹점 개별 결제"
            desc={`각 가맹점이 월 ${formatKRW(storeMonthlyPrice(ctx))}을 직접 결제해요. 승인 즉시 결제 가능합니다.`}
          />
          <ModeOption
            selected={form.billingMode === 'hq_consolidated'}
            onSelect={() => set('billingMode', 'hq_consolidated')}
            title="본사 일괄 결제"
            desc="본사가 전 매장 요금을 한 번에 부담해요. 매장 수에 따라 요금을 협의한 뒤 결제 안내를 드립니다."
          />
        </div>

        {errors.length > 0 && (
          <Alert tone="error">
            <ul className="space-y-0.5">{errors.map((e) => <li key={e}>· {e}</li>)}</ul>
          </Alert>
        )}

        <button onClick={() => void submit()} disabled={busy || !verified}
          className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : '본사 신청하고 코드 받기'}
        </button>
        <p className="text-center text-[11px] text-ink-dim">
          신청 즉시 본사 코드가 발급되고, 담당자 승인 절차가 함께 진행됩니다.
        </p>
      </div>
    </Panel>
  );
}

/* ═════════════════════ 3. 엔터프라이즈 가맹 ═════════════════════ */

function FranchisePanel({ ctx, onChanged }: {
  ctx: PricingContext | null; onChanged: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const state = franchiseCardState(ctx);

  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<JoinCodeLookup | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    const c = normalizeJoinCode(code);
    if (!c) { setLookupErr('본사 코드를 입력해주세요.'); return; }
    setChecking(true); setLookupErr(null); setLookup(null);
    try {
      const r = await lookupEnterpriseJoinCode(c);
      if (r.success) setLookup(r);
      else setLookupErr(r.reason ?? '본사 코드가 올바르지 않습니다.');
    } catch (e) {
      setLookupErr(friendlyError(e, '코드 확인에 실패했어요'));
    } finally { setChecking(false); }
  }

  async function join() {
    if (!lookup?.success) return;
    if (!storeName.trim()) { toast.error('매장명을 입력해주세요.'); return; }
    setBusy(true);
    try {
      const r = await joinEnterpriseStoreByCode({
        code: normalizeJoinCode(code), storeName, regionName: region,
      });
      if (!r.success) { toast.error(r.reason ?? '매장 연결에 실패했어요.'); return; }
      toast.success('매장이 연결됐어요.');
      await onChanged();
    } catch (e) {
      toast.error(friendlyError(e, '매장 연결 실패'));
    } finally { setBusy(false); }
  }

  if (state === 'blocked') {
    return (
      <Panel title="엔터프라이즈 가맹" subtitle="본사 코드로 가입">
        <Alert tone="info">아티스트 계정으로는 가맹 매장 가입을 할 수 없어요. 매장용 계정으로 가입해주세요.</Alert>
      </Panel>
    );
  }

  if (state === 'joined') {
    const notice = franchisePaymentNotice(ctx);
    return (
      <Panel title="엔터프라이즈 가맹" subtitle={ctx?.store?.enterprise_name ?? ''}>
        <Alert tone="success">{ctx?.store?.store_name} 매장이 연결돼 있어요.</Alert>
        {notice && <p className="text-sm text-ink-mute">{notice}</p>}
        {franchiseCanPayNow(ctx) && (
          <>
            <div className="rounded-2xl bg-bg-base p-4 ring-1 ring-line/10">
              <p className="text-xs text-ink-mute">가맹점 월 정기결제</p>
              <p className="mt-1 text-2xl font-extrabold">
                {formatKRW(ctx?.enterprise_payment?.amount ?? 0)}
                <span className="ml-1 text-sm font-semibold text-ink-mute">/ 월</span>
              </p>
            </div>
            <button onClick={() => navigate('/enterprise/pay')}
              className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90">
              정기결제 등록하기
            </button>
          </>
        )}
        <Link to="/business" className="block text-center text-xs font-semibold text-ink-mute underline">
          매장 화면으로 이동
        </Link>
      </Panel>
    );
  }

  return (
    <Panel title="엔터프라이즈 가맹" subtitle="본사에서 받은 코드가 있어야 가입할 수 있어요">
      <div className="space-y-3">
        <Field label="본사 코드 *" hint="본사 담당자에게 전달받은 코드를 입력해주세요.">
          <div className="flex gap-2">
            <input value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setLookup(null); setLookupErr(null); }}
              placeholder="예: DD-7K2M9Q" className="input flex-1 font-mono uppercase" autoCapitalize="characters" />
            <button type="button" onClick={() => void check()} disabled={checking || !code.trim() || !!lookup}
              className={`shrink-0 rounded-lg px-3 text-xs font-semibold transition ${
                lookup ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/30'
                       : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'}`}>
              {lookup ? '확인됨' : checking ? '확인 중…' : '확인'}
            </button>
          </div>
        </Field>
        {lookupErr && (
          <p className="flex items-center gap-1 text-[11px] text-red-400"><AlertTriangle size={12} />{lookupErr}</p>
        )}
        {lookup?.success && (
          <div className="rounded-2xl bg-bg-base p-4 text-sm ring-1 ring-line/10">
            <Row label="본사" value={lookup.enterprise_name ?? '—'} />
            <Row label="요금"
              value={lookup.store_pays && lookup.store_monthly_price
                ? `${formatKRW(lookup.store_monthly_price)} / 월 (가맹점 결제)`
                : '본사 일괄 부담 (가맹점 별도 결제 없음)'} />
          </div>
        )}

        <Field label="매장명 *">
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)}
            disabled={!lookup?.success} placeholder="예: 카공시대 화정점" className="input" />
        </Field>
        <Field label="지역" hint="선택 입력 — 비워두면 본사가 나중에 배정합니다.">
          <input value={region} onChange={(e) => setRegion(e.target.value)}
            disabled={!lookup?.success} placeholder="예: 경기 고양" className="input" />
        </Field>

        <button onClick={() => void join()} disabled={busy || !lookup?.success || !storeName.trim()}
          className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : '매장 연결하기'}
        </button>
        <p className="text-center text-[11px] text-ink-dim">
          연결 후 가맹점 결제가 필요한 경우 바로 결제 화면이 열립니다.
        </p>
      </div>
    </Panel>
  );
}

/* ══════════════════════════ 공용 조각 ══════════════════════════ */

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl bg-bg-card p-5 ring-1 ring-line/10 sm:p-6">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ink-mute">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-accent">{children}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line/10 py-1.5 last:border-0">
      <span className="text-xs text-ink-mute">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function ModeOption({ selected, onSelect, title, desc }: {
  selected: boolean; onSelect: () => void; title: string; desc: string;
}) {
  return (
    <button type="button" onClick={onSelect}
      className={`rounded-2xl p-4 text-left transition ${
        selected ? 'bg-bg-base ring-2 ring-accent/60' : 'bg-bg-base ring-1 ring-line/10 hover:ring-line/25'}`}>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-mute">{desc}</p>
    </button>
  );
}

function JoinCodeBox({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <div className="rounded-2xl bg-accent/10 p-4 ring-1 ring-accent/30">
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">가맹점 가입용 본사 코드</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="flex-1 font-mono text-xl font-black tracking-wider text-ink">{code}</code>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(code)
              .then(() => toast.success('본사 코드를 복사했어요.'))
              .catch(() => toast.error('복사에 실패했어요.'));
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-bg-hover">
          <Copy size={13} /> 복사
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-mute">
        가맹점주님이 요금제 → 엔터프라이즈 가맹에서 이 코드를 입력하면 매장이 연결됩니다.
      </p>
    </div>
  );
}
