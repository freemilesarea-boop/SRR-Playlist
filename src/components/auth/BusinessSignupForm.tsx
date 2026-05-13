import { useState } from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import {
  validateBusinessNumberFormat,
  formatBusinessNumber,
  verifyBusinessNumber,
  type BusinessVerificationResult,
} from '@/lib/businessVerification';
import { toast } from '@/store/toastStore';

interface Props {
  onDone: () => void;
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
    if (!email.trim()) return '이메일을 입력해주세요';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요';
    return null;
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
      setBizError(e instanceof Error ? e.message : '검증 오류');
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
      await signUpWithPassword(email.trim(), password, fullName.trim());

      const fmt = validateBusinessNumberFormat(businessNumber);
      const pendingProfile = {
        account_type: 'business' as const,
        full_name: fullName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
        signup_completed: true,
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
        localStorage.setItem('srr-pending-signup', JSON.stringify({ profile: pendingProfile, bvp: pendingBvp }));
      } catch { /* noop */ }

      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        const uid = sess.session.user.id;
        await supabase.from('users').update(pendingProfile).eq('id', uid);
        await supabase
          .from('business_verification_profiles')
          .upsert({ user_id: uid, ...pendingBvp }, { onConflict: 'user_id' });
      }

      toast.success('사업자 회원가입이 완료됐어요. 이메일 인증 메일을 확인해주세요.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했어요');
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
        <input type="text" required value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} className="input" />
      </Field>
      <Field label="개업일자 *">
        <input type="date" required value={businessOpenDate} onChange={(e) => setBusinessOpenDate(e.target.value)} className="input" />
      </Field>
      <Field label="상호명">
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input" />
      </Field>
      <Field label="매장명">
        <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} className="input" />
      </Field>
      <Field label="매장 주소">
        <input type="text" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} className="input" />
      </Field>
      <Field label="업종">
        <input type="text" value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="예: 카페, 와인바" className="input" />
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
        {bizError && <p className="mt-1 text-[11px] text-red-300">{bizError}</p>}
        {bizVerified && businessVerification && (
          <p className="mt-1 text-[11px] text-emerald-300">
            {businessVerification.business_state} · {businessVerification.tax_type}
          </p>
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

      {error && <p className="text-xs text-red-300">{error}</p>}

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
