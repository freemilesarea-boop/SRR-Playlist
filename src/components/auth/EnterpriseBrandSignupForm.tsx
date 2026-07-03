/**
 * EnterpriseBrandSignupForm — Phase 3-2
 *
 * 브랜드명 + 브랜드코드로 자동 매칭 Enterprise 가입.
 * 기존 EnterpriseHqSignupForm (초대코드 방식) 과 병행 flow — 기존 파일 무영향.
 *
 * 흐름:
 *   1. 브랜드명 + 브랜드코드 → "확인" → validateBrandRegistrySignup
 *   2. 성공 시 브랜드 표시
 *   3. 회사명 / 사업자번호 / 담당자명 / 이메일 / 비번 / 휴대폰 입력
 *   4. signUpWithPassword (account_type='individual', 본사 담당자)
 *   5. 세션 즉시 있으면 claimBrandRegistryEnterprise → status='invited' + 자동 계약(draft)
 *   6. 관리자 승인 대기 안내
 */
import { useState } from 'react';
import { Building2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';
import {
  validateBrandRegistrySignup, claimBrandRegistryEnterprise,
} from '@/lib/api/enterpriseBrandRegistryApi';

interface VerifiedBrand {
  brand_id: string;
  brand_name: string;
  brand_code: string;
  business_name: string;
}

interface Props {
  onDone: (email: string) => void;
  initialBrandName?: string;
  initialBrandCode?: string;
}

export default function EnterpriseBrandSignupForm({
  onDone, initialBrandName = '', initialBrandCode = '',
}: Props) {
  const { signUpWithPassword } = useAuthStore();

  const [brandName, setBrandName] = useState(initialBrandName);
  const [brandCode, setBrandCode] = useState(initialBrandCode);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<VerifiedBrand | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [businessRegNo, setBusinessRegNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [phone, setPhone] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setVerifyError(null);
    setVerified(null);
    const b = brandName.trim();
    const c = brandCode.trim();
    if (!b || !c) { setVerifyError('브랜드명과 브랜드코드를 입력해주세요.'); return; }
    setVerifying(true);
    try {
      const r = await validateBrandRegistrySignup(b, c.toUpperCase());
      if (r.success && r.brand_id && r.brand_name && r.brand_code && r.business_name) {
        setVerified({
          brand_id: r.brand_id, brand_name: r.brand_name,
          brand_code: r.brand_code, business_name: r.business_name,
        });
        if (!companyName) setCompanyName(r.business_name);
      } else {
        const reason = r.reason ?? 'brand_not_matched';
        setVerifyError(
          reason === 'brand_not_matched' ? '브랜드명 또는 코드가 일치하지 않습니다. 확인 후 다시 시도해주세요.'
          : reason === 'brand_name_required' ? '브랜드명이 필요합니다.'
          : reason === 'brand_code_required' ? '브랜드코드가 필요합니다.'
          : reason,
        );
      }
    } catch (e) { setVerifyError(friendlyError(e, '검증에 실패했습니다.')); }
    finally { setVerifying(false); }
  }

  function validate(): string | null {
    if (!verified) return '브랜드 확인이 필요합니다.';
    if (!fullName.trim()) return '담당자명을 입력해주세요.';
    if (!email.trim()) return '이메일을 입력해주세요.';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 합니다.';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않습니다.';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않습니다.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      // 1) 재검증
      const rv = await validateBrandRegistrySignup(brandName.trim(), brandCode.trim().toUpperCase());
      if (!rv.success) {
        setError(rv.reason === 'brand_not_matched' ? '브랜드명 또는 코드가 일치하지 않습니다.' : (rv.reason ?? 'validation failed'));
        setBusy(false);
        return;
      }

      // 2) signUp (본사 담당자 → individual)
      await signUpWithPassword(email.trim(), password, fullName.trim(), {
        account_type: 'individual',
        full_name: fullName.trim(),
        phone: phone.trim(),
      });

      // 3) 즉시 세션 있으면 claim, 없으면 안내만 (이메일 인증 필요 시 후속 처리)
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        try {
          const claim = await claimBrandRegistryEnterprise({
            brandName: brandName.trim(),
            brandCode: brandCode.trim().toUpperCase(),
            businessName: companyName.trim() || undefined,
            managerPhone: phone.trim() || undefined,
          });
          if (claim.success) {
            toast.success(`가입 완료 · 계약(draft) 자동 생성됨 · 관리자 승인 대기`);
          } else {
            toast.warning('가입은 완료됐지만 브랜드 연결에 실패했습니다. 관리자에게 문의해주세요.');
          }
        } catch (claimErr) {
          toast.warning(`가입은 완료됐지만 브랜드 연결에 실패했습니다: ${(claimErr as Error).message}`);
        }
      } else {
        toast.success('가입 신청 완료. 이메일 인증 후 로그인하시면 브랜드가 자동 연결됩니다.');
      }

      // 회사명/사업자번호 는 서버에 메타로 전달 후 관리자 승인 시 검토 (현재는 클라 컨텍스트만)
      if (businessRegNo.trim()) console.log('[brand-signup] user-provided business_registration_no:', businessRegNo.trim());

      onDone(email.trim());
    } catch (err) {
      setError(friendlyError(err, '가입에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">브랜드 인증</p>
      <Field label="브랜드명 *">
        <input type="text" required value={brandName}
          onChange={(e) => { setBrandName(e.target.value); setVerified(null); }}
          placeholder="예: 쿠우쿠우" className="input" autoComplete="organization" />
      </Field>
      <Field label="브랜드코드 *" hint="관리자에게 전달받은 코드 (예: KUU001)">
        <div className="flex gap-2">
          <input type="text" required value={brandCode}
            onChange={(e) => { setBrandCode(e.target.value.toUpperCase()); setVerified(null); }}
            placeholder="예: KUU001" className="input flex-1 font-mono uppercase" autoCapitalize="characters" />
          <button type="button" onClick={() => void handleVerify()}
            disabled={verifying || verified !== null || !brandName.trim() || !brandCode.trim()}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              verified !== null
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
            }`}>
            {verified ? <CheckCircle2 size={14} /> : verifying ? <RefreshCw size={14} className="animate-spin" /> : <Building2 size={14} />}
            {verified ? '확인됨' : verifying ? '확인 중…' : '확인'}
          </button>
        </div>
        {verifyError && <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{verifyError}</p>}
        {verified && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
            {verified.brand_name} ({verified.brand_code}) · {verified.business_name} 브랜드에 가입합니다.
          </p>
        )}
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">회사 정보</p>
      <Field label="회사명 *" hint="브랜드의 사업자명과 동일하면 자동 채워집니다.">
        <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)}
          disabled={!verified} className="input" />
      </Field>
      <Field label="사업자번호">
        <input type="text" value={businessRegNo} onChange={(e) => setBusinessRegNo(e.target.value)}
          disabled={!verified} placeholder="123-45-67890" className="input font-mono" />
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">담당자</p>
      <Field label="담당자명 *">
        <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
          disabled={!verified} className="input" autoComplete="name" />
      </Field>
      <Field label="휴대폰 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
          disabled={!verified} placeholder="010-0000-0000" className="input" autoComplete="tel" />
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">계정</p>
      <Field label="이메일 *">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          disabled={!verified} className="input" autoComplete="email" />
      </Field>
      <Field label="비밀번호 *" hint="6자 이상">
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          disabled={!verified} className="input" autoComplete="new-password" />
      </Field>
      <Field label="비밀번호 확인 *">
        <input type="password" required minLength={6} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)}
          disabled={!verified} className="input" autoComplete="new-password" />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}

      <button type="submit" disabled={busy || !verified} className="btn-primary w-full py-3">
        {busy ? '가입 중…' : '브랜드 가입 신청'}
      </button>
      <p className="text-[11px] text-ink-mute text-center">
        가입 후 관리자 승인이 필요합니다. 자동 계약(draft)이 함께 생성됩니다.
      </p>
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
