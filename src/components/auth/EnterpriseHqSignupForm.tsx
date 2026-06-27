/**
 * EnterpriseHqSignupForm — Phase 1-6 §4 (UI)
 *
 * 본사 담당자 셀프 가입 (브랜드명 + 본사 초대코드 + 기본 정보).
 *
 * 흐름:
 *   1. 브랜드명 + 초대코드 → "확인" 클릭 → validateEnterpriseInvite('hq_admin')
 *   2. 성공 시 enterprise_name / brand_code 표시
 *   3. 이름 / 이메일 / 비밀번호 / 전화 입력 후 "가입" 클릭
 *   4. signUpWithPassword (메타데이터: account_type='individual', 본사 담당자 정보)
 *      - HQ 담당자는 매장 운영자가 아니므로 account_type 은 individual 유지
 *      - users 테이블의 본사 권한은 enterprise_accounts.auth_user_id 로 분리
 *   5. 세션 즉시 있으면 claimEnterpriseHqAccount, 없으면 pendingEnterpriseClaim 캐싱
 *   6. 첫 로그인 시 authStore 가 cached claim 자동 실행
 */
import { useState } from 'react';
import { Building2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';
import {
  validateEnterpriseInvite,
  claimEnterpriseHqAccount,
  type EnterpriseInviteValidateResult,
} from '@/lib/api/enterpriseAccountsApi';
import { setPendingEnterpriseClaim } from '@/lib/pendingEnterpriseClaim';

interface Props {
  onDone: (email: string) => void;
}

export default function EnterpriseHqSignupForm({ onDone }: Props) {
  const { signUpWithPassword } = useAuthStore();

  const [brandName, setBrandName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Extract<EnterpriseInviteValidateResult, { success: true }> | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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
    const brand = brandName.trim();
    const code = inviteCode.trim();
    if (!brand || !code) {
      setVerifyError('브랜드명과 초대코드를 입력해주세요.');
      return;
    }
    setVerifying(true);
    try {
      const r = await validateEnterpriseInvite({
        brandName: brand,
        inviteCode: code,
        claimType: 'hq_admin',
      });
      if (r.success) {
        setVerified(r);
      } else {
        setVerifyError(r.reason);
      }
    } catch (e) {
      setVerifyError(friendlyError(e, '검증에 실패했습니다.'));
    } finally {
      setVerifying(false);
    }
  }

  function validate(): string | null {
    if (!verified) return '브랜드/초대코드 확인이 필요합니다.';
    if (!fullName.trim()) return '이름을 입력해주세요.';
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
      // 1) 가입 직전 invite 재검증 (verified 캐시 신뢰 X)
      const reverify = await validateEnterpriseInvite({
        brandName: brandName.trim(),
        inviteCode: inviteCode.trim(),
        claimType: 'hq_admin',
      });
      if (!reverify.success) {
        setError(reverify.reason);
        setBusy(false);
        return;
      }

      // 2) Supabase signUp — 본사 담당자는 account_type='individual' 유지
      //    매장 운영자와 분리. enterprise 권한은 enterprise_accounts.auth_user_id 로 부여.
      await signUpWithPassword(email.trim(), password, fullName.trim(), {
        account_type: 'individual',
        full_name: fullName.trim(),
        phone: phone.trim(),
      });

      // 3) 세션 존재 시 즉시 claim, 없으면 캐시 (이메일 인증 ON 환경)
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        const claimRes = await claimEnterpriseHqAccount({
          brandName: brandName.trim(),
          inviteCode: inviteCode.trim(),
          userAgent,
        });
        if (claimRes.success) {
          toast.success('본사 담당자 가입이 완료되었습니다.');
        } else {
          // signUp 은 성공했으므로 차단 X, 캐시로 다음 로그인에 재시도
          setPendingEnterpriseClaim({
            type: 'hq',
            email: email.trim(),
            brandName: brandName.trim(),
            inviteCode: inviteCode.trim(),
            userAgent,
          });
          toast.warning(`가입은 완료. 본사 연결은 다음 로그인에 자동 재시도: ${claimRes.reason}`);
        }
      } else {
        setPendingEnterpriseClaim({
          type: 'hq',
          email: email.trim(),
          brandName: brandName.trim(),
          inviteCode: inviteCode.trim(),
          userAgent,
        });
        toast.success('가입 신청 완료. 이메일 인증 후 로그인하면 본사 연결이 자동 완료됩니다.');
      }

      onDone(email.trim());
    } catch (err) {
      setError(friendlyError(err, '가입에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">본사 인증</p>
      <Field label="브랜드명 *">
        <input
          type="text" required value={brandName}
          onChange={(e) => { setBrandName(e.target.value); setVerified(null); }}
          placeholder="예: 쿠우쿠우"
          className="input"
          autoComplete="organization"
        />
      </Field>
      <Field label="본사 초대코드 *" hint="본사 관리자에게 전달받은 코드를 입력해주세요.">
        <div className="flex gap-2">
          <input
            type="text" required value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setVerified(null); }}
            placeholder="예: ENT-A7K3M9"
            className="input flex-1 font-mono uppercase"
            autoCapitalize="characters"
          />
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={verifying || verified !== null || !brandName.trim() || !inviteCode.trim()}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              verified !== null
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
            }`}
          >
            {verified ? <CheckCircle2 size={14} /> : verifying ? <RefreshCw size={14} className="animate-spin" /> : <Building2 size={14} />}
            {verified ? '확인됨' : verifying ? '확인 중…' : '확인'}
          </button>
        </div>
        {verifyError && <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{verifyError}</p>}
        {verified && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
            {verified.enterprise_name}
            {verified.brand_code && ` (${verified.brand_code})`}
            {' 본사 담당자로 가입합니다.'}
          </p>
        )}
      </Field>

      {/* 기본 정보 — 확인된 후에만 활성화 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">담당자 정보</p>
      <Field label="이름 *">
        <input
          type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
          disabled={!verified}
          className="input"
          autoComplete="name"
        />
      </Field>
      <Field label="전화번호 *">
        <input
          type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
          disabled={!verified}
          placeholder="010-0000-0000"
          className="input"
          autoComplete="tel"
        />
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">계정</p>
      <Field label="이메일 *">
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          disabled={!verified}
          className="input"
          autoComplete="email"
        />
      </Field>
      <Field label="비밀번호 *" hint="6자 이상">
        <input
          type="password" required minLength={6} value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={!verified}
          className="input"
          autoComplete="new-password"
        />
      </Field>
      <Field label="비밀번호 확인 *">
        <input
          type="password" required minLength={6} value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          disabled={!verified}
          className="input"
          autoComplete="new-password"
        />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}

      <button type="submit" disabled={busy || !verified} className="btn-primary w-full py-3">
        {busy ? '가입 중…' : '본사 담당자 가입'}
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
