import { useState } from 'react';
import { Building2, CheckCircle2, UserCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import {
  validateBusinessNumberFormat,
  formatBusinessNumber,
  verifyBusinessNumber,
  type BusinessVerificationResult,
} from '@/lib/businessVerification';
import { verifySalesAgentCode, type VerifiedSalesAgent } from '@/lib/salesAgentApi';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';

interface Props {
  onDone: (email: string) => void;
}

export default function BusinessSignupForm({ onDone }: Props) {
  const { signUpWithPassword } = useAuthStore();
  // 개인 정보
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  // 사업자
  const [businessNumber, setBusinessNumber] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [businessOpenDate, setBusinessOpenDate] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [businessType, setBusinessType] = useState('');
  // 계정
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  // 검증 상태
  const [businessVerification, setBusinessVerification] = useState<BusinessVerificationResult | null>(null);
  const [bizError, setBizError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 영업인 코드 (선택)
  const [salesAgentCode, setSalesAgentCode] = useState('');
  const [salesAgent, setSalesAgent] = useState<VerifiedSalesAgent | null>(null);
  const [salesAgentError, setSalesAgentError] = useState<string | null>(null);
  const [salesAgentChecking, setSalesAgentChecking] = useState(false);

  function validate(): string | null {
    if (!fullName.trim()) return '이름을 입력해주세요';
    if (!birthDate) return '생년월일을 입력해주세요';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않아요';
    if (!address.trim()) return '주소를 입력해주세요';
    const fmt = validateBusinessNumberFormat(businessNumber);
    if (!fmt.ok) return fmt.error ?? '사업자번호 형식이 올바르지 않아요';
    if (!representativeName.trim()) return '대표자명을 입력해주세요';
    if (!businessOpenDate) return '개업일자를 입력해주세요';
    if (!businessVerification?.business_verified) return '사업자 검증을 완료해주세요';
    // 영업인 코드 입력 시 검증 필수. 미입력은 OK.
    if (salesAgentCode.trim() && !salesAgent) {
      return '유효하지 않은 영업인 코드입니다.';
    }
    if (!email.trim()) return '이메일을 입력해주세요';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요';
    return null;
  }

  async function handleSalesAgentVerify() {
    setSalesAgentError(null);
    setSalesAgent(null);
    const trimmed = salesAgentCode.trim();
    if (!trimmed) return;
    setSalesAgentChecking(true);
    try {
      const r = await verifySalesAgentCode(trimmed);
      if (!r) {
        setSalesAgentError('유효하지 않은 영업인 코드입니다.');
        return;
      }
      setSalesAgent(r);
    } catch (e) {
      // 마이그레이션 미적용 등의 환경에선 RPC 가 없어 에러. 사용자에겐 명확히.
      setSalesAgentError(
        e instanceof Error ? `코드 확인에 실패했어요: ${e.message}` : '코드 확인에 실패했어요',
      );
    } finally {
      setSalesAgentChecking(false);
    }
  }

  async function handleBusinessVerify() {
    setBizError(null);
    const fmt = validateBusinessNumberFormat(businessNumber);
    if (!fmt.ok) {
      setBizError(fmt.error ?? '형식 오류');
      return;
    }
    setVerifying(true);
    try {
      const res = await verifyBusinessNumber({
        business_number: fmt.normalized,
        representative_name: representativeName.trim(),
        business_open_date: businessOpenDate,
        business_name: businessName.trim() || undefined,
      });
      setBusinessVerification(res);
      if (res.business_verified) {
        toast.success('사업자 검증이 완료됐어요 (MVP mock)');
      } else {
        setBizError(res.message ?? '검증 실패');
      }
    } catch (e) {
      setBizError(friendlyError(e, '검증 오류'));
    } finally {
      setVerifying(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      // 가입 직전 영업인 코드 재검증 — 검증 클릭 후 비활성화된 경우까지 차단.
      // 검증된 캐시(salesAgent) 가 있어도 항상 최신 상태로 재조회한다.
      let verifiedAgent = salesAgent;
      const codeTrim = salesAgentCode.trim();
      if (codeTrim) {
        const r = await verifySalesAgentCode(codeTrim);
        if (!r) {
          // 처음 검증 안 했거나, 이전에 활성이었다가 비활성화된 경우 모두 차단
          setSalesAgent(null);
          setSalesAgentError('유효하지 않은 영업인 코드입니다.');
          setError('유효하지 않은 영업인 코드입니다.');
          setBusy(false);
          return;
        }
        verifiedAgent = r;
        setSalesAgent(r);
      } else {
        verifiedAgent = null;
      }

      // 0021 트리거가 user_metadata 를 읽어 public.users 자동 채움
      await signUpWithPassword(email.trim(), password, fullName.trim(), {
        account_type: 'business',
        full_name: fullName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
      });

      const fmt = validateBusinessNumberFormat(businessNumber);
      const pendingProfile = {
        account_type: 'business' as const,
        full_name: fullName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
        signup_completed: true,
        // 영업인 연결 — 코드 입력 + 검증 통과한 경우에만 저장
        ...(verifiedAgent
          ? {
              sales_agent_id: verifiedAgent.id,
              sales_agent_code: verifiedAgent.code,
            }
          : {}),
        // business 정보는 별도 테이블에 저장
      };
      const pendingBvp = {
        business_number: fmt.normalized,
        business_name: businessName.trim() || null,
        representative_name: representativeName.trim(),
        business_open_date: businessOpenDate,
        business_address: address.trim(),
        business_type: businessType.trim() || null,
        store_name: storeName.trim() || null,
        store_address: storeAddress.trim() || null,
        business_verified: !!businessVerification?.business_verified,
        verification_status: businessVerification?.verification_status ?? 'pending',
        business_state: businessVerification?.business_state ?? null,
        tax_type: businessVerification?.tax_type ?? null,
        verified_at: businessVerification?.verified_at ?? null,
      };

      try {
        // PendingSignup 판별 유니온 형태로 저장 — type/email 누락 시 다음 로그인에서
        // applyPendingSignupOnLogin 의 business 분기가 실행되지 않아 bvp 가 유실됨.
        localStorage.setItem(
          'srr-pending-signup',
          JSON.stringify({ type: 'business', email: email.trim(), profile: pendingProfile, bvp: pendingBvp }),
        );
      } catch (storageErr) {
        // localStorage 실패 시 DB 직접 update 로 복구되므로 차단은 안 함. 진단 로깅만.
        console.warn('[business-signup] pending-signup cache write failed:', storageErr);
      }

      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        const uid = sess.session.user.id;
        const { error: uErr } = await supabase
          .from('users')
          .update(pendingProfile)
          .eq('id', uid);
        const { error: bErr } = await supabase
          .from('business_verification_profiles')
          .upsert({ user_id: uid, ...pendingBvp }, { onConflict: 'user_id' });
        if (uErr || bErr) {
          // 가입은 성공 — localStorage 캐시가 다음 로그인 시 재적용. 사용자에게 안내만.
          if (import.meta.env.DEV) {
            console.error('[business-signup] post-signup sync failed:', { uErr, bErr });
          }
          toast.info('가입 직후 일부 정보 동기화가 지연됐어요. 로그인하면 자동 적용됩니다.');
        }
      }

      toast.success('사업자 회원가입이 완료됐어요. 이메일 인증 메일을 확인해주세요.');
      onDone(email.trim());
    } catch (err) {
      setError(friendlyError(err, '가입에 실패했어요'));
    } finally {
      setBusy(false);
    }
  }

  const bizVerified = !!businessVerification?.business_verified;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 개인 정보 */}
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">대표자 정보</p>
      <Field label="이름 *">
        <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className="input" />
      </Field>
      <Field label="생년월일 *">
        <input type="date" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="input" />
      </Field>
      <Field label="전화번호 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="010-0000-0000" className="input" />
      </Field>
      <Field label="주소 *">
        <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="input" />
      </Field>

      {/* 사업자 정보 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">사업자 정보</p>

      <Field label="사업자번호 *" hint="10자리 숫자 (형식: XXX-XX-XXXXX)">
        <input
          type="text"
          required
          value={businessNumber}
          onChange={(e) => setBusinessNumber(e.target.value)}
          onBlur={() => {
            const fmt = validateBusinessNumberFormat(businessNumber);
            if (fmt.ok) setBusinessNumber(formatBusinessNumber(fmt.normalized));
          }}
          placeholder="000-00-00000"
          className="input"
        />
      </Field>
      <Field label="대표자명 *">
        <input type="text" required value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} autoComplete="name" maxLength={50} className="input" />
      </Field>
      <Field label="개업일자 *">
        <input type="date" required value={businessOpenDate} onChange={(e) => setBusinessOpenDate(e.target.value)} className="input" />
      </Field>
      <Field label="상호명">
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoComplete="organization" maxLength={100} className="input" />
      </Field>
      <Field label="매장명">
        <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} autoComplete="organization" maxLength={100} className="input" />
      </Field>
      <Field label="매장 주소">
        <input type="text" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} autoComplete="street-address" maxLength={200} className="input" />
      </Field>
      <Field label="업종">
        <input type="text" value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="예: 카페, 와인바" autoComplete="off" maxLength={50} className="input" />
      </Field>

      <Field label="사업자 검증 *" hint="국세청 진위확인 API 연동 예정. MVP 는 mock.">
        <button
          type="button"
          onClick={handleBusinessVerify}
          disabled={verifying || bizVerified}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            bizVerified
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30'
              : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
          }`}
        >
          {bizVerified ? <CheckCircle2 size={14} /> : <Building2 size={14} />}
          {bizVerified
            ? '사업자 검증 완료'
            : verifying
              ? '검증 중…'
              : '사업자 검증하기'}
        </button>
        {bizError && <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{bizError}</p>}
        {bizVerified && businessVerification && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
            {businessVerification.business_state} · {businessVerification.tax_type}
          </p>
        )}
      </Field>

      {/* 영업인 코드 (선택) */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">영업인 코드 (선택)</p>
      <Field label="영업인 코드" hint="영업인을 통해 안내받은 코드가 있다면 입력해주세요. 입력하지 않아도 가입 가능합니다.">
        <div className="flex gap-2">
          <input
            type="text"
            value={salesAgentCode}
            onChange={(e) => {
              setSalesAgentCode(e.target.value);
              setSalesAgent(null);
              setSalesAgentError(null);
            }}
            placeholder="예: A7K3M9"
            className="input flex-1"
            autoCapitalize="characters"
          />
          <button
            type="button"
            onClick={handleSalesAgentVerify}
            disabled={salesAgentChecking || !salesAgentCode.trim() || !!salesAgent}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              salesAgent
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
            }`}
          >
            {salesAgent ? <CheckCircle2 size={14} /> : <UserCheck size={14} />}
            {salesAgent ? '확인됨' : salesAgentChecking ? '확인 중…' : '확인'}
          </button>
        </div>
        {salesAgentError && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{salesAgentError}</p>
        )}
        {salesAgent && (
          <>
            <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
              담당 영업인: {salesAgent.name} ({salesAgent.code})
            </p>
            <p className="mt-1 text-[11px] text-accent">
              가입 후 첫 로그인 시 <b>3일 무료 체험</b>이 자동으로 시작돼요. 결제 없이 매장에서 바로 재생할 수 있어요.
            </p>
          </>
        )}
      </Field>

      {/* 계정 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">계정</p>

      <Field label="이메일 *">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input" />
      </Field>
      <Field label="비밀번호 *" hint="6자 이상">
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="input" />
      </Field>
      <Field label="비밀번호 확인 *">
        <input type="password" required minLength={6} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" className="input" />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}

      <button type="submit" disabled={busy} className="btn-primary w-full py-3">
        {busy ? '가입 중…' : '사업자 회원가입'}
      </button>
    </form>
  );
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
