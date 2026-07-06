/**
 * EnterpriseStoreSignupForm — Phase 1-6 §4 (UI)
 *
 * 매장 셀프 가입 (브랜드명 + 매장 초대코드 + 매장명 + 지역 선택 + 기본 정보).
 *
 * 흐름:
 *   1. 브랜드명 + 초대코드 → "확인" → validateEnterpriseInvite('store')
 *      → enterprise_account + allowed_regions 표시
 *   2. 매장명 / 지역(dropdown) / 담당자명 / 이메일 / 비밀번호 / 전화 입력
 *   3. signUpWithPassword (metadata: account_type='business', full_name, phone)
 *      - 0021 트리거가 public.users 자동 생성
 *   4. 세션 즉시 있으면 claimEnterpriseStoreAccount (race 시 500ms 3회 retry)
 *      세션 없으면 pendingEnterpriseClaim 캐싱 → 첫 로그인 시 authStore 가 자동 실행
 */
import { useState } from 'react';
import { MapPin, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';
import {
  validateEnterpriseInvite,
  claimEnterpriseStoreAccount,
  type EnterpriseInviteValidateResult,
  type EnterpriseInviteAllowedRegion,
  type EnterpriseStoreClaimResult,
} from '@/lib/api/enterpriseAccountsApi';
import { setPendingEnterpriseClaim } from '@/lib/pendingEnterpriseClaim';

interface Props {
  onDone: (email: string) => void;
  /** Phase 1-9 — 초대 링크에서 미리 채워진 값 */
  initialBrandName?: string;
  initialInviteCode?: string;
}

type VerifiedInvite = Extract<EnterpriseInviteValidateResult, { success: true }>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function claimWithRetry(
  args: Parameters<typeof claimEnterpriseStoreAccount>[0],
): Promise<EnterpriseStoreClaimResult> {
  // 0021 trigger 가 public.users 생성하는 race 보호 — 최대 3회 500ms 백오프
  let last: EnterpriseStoreClaimResult | null = null;
  for (let i = 0; i < 3; i += 1) {
    last = await claimEnterpriseStoreAccount(args);
    if (last.success) return last;
    // race 메시지일 때만 재시도
    if (!last.reason || !/users row not found|users\.account_type|business 계정/.test(last.reason)) {
      return last;
    }
    await sleep(500);
  }
  return last ?? { success: false, reason: '매장 연결에 실패했습니다.' };
}

export default function EnterpriseStoreSignupForm({
  onDone, initialBrandName = '', initialInviteCode = '',
}: Props) {
  const { signUpWithPassword } = useAuthStore();

  const [brandName, setBrandName] = useState(initialBrandName);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<VerifiedInvite | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [storeName, setStoreName] = useState('');
  const [regionId, setRegionId] = useState<string>('');
  const [regionNameManual, setRegionNameManual] = useState<string>('');
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
    setRegionId('');
    setRegionNameManual('');
    const brand = brandName.trim();
    const code = inviteCode.trim();
    if (!brand || !code) {
      setVerifyError('브랜드명과 매장 초대코드를 입력해주세요.');
      return;
    }
    setVerifying(true);
    try {
      const r = await validateEnterpriseInvite({
        brandName: brand, inviteCode: code, claimType: 'store',
      });
      if (r.success) setVerified(r);
      else setVerifyError(r.reason);
    } catch (e) {
      setVerifyError(friendlyError(e, '검증에 실패했습니다.'));
    } finally {
      setVerifying(false);
    }
  }

  function resolveRegionName(): string {
    if (!verified) return '';
    if (verified.allow_self_register_region && verified.allowed_regions.length === 0) {
      return regionNameManual.trim();
    }
    if (regionId === '__manual__' && verified.allow_self_register_region) {
      return regionNameManual.trim();
    }
    const found = verified.allowed_regions.find((r: EnterpriseInviteAllowedRegion) => r.id === regionId);
    return found?.region_name ?? '';
  }

  function validate(): string | null {
    if (!verified) return '브랜드/초대코드 확인이 필요합니다.';
    if (!storeName.trim()) return '매장명을 입력해주세요.';
    if (!resolveRegionName()) return '지역을 선택하거나 입력해주세요.';
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
      // 가입 직전 invite 재검증
      const reverify = await validateEnterpriseInvite({
        brandName: brandName.trim(), inviteCode: inviteCode.trim(), claimType: 'store',
      });
      if (!reverify.success) { setError(reverify.reason); setBusy(false); return; }

      const regionName = resolveRegionName();

      // signUp — account_type='business' 로 0021 트리거가 users row 생성
      await signUpWithPassword(email.trim(), password, fullName.trim(), {
        account_type: 'business',
        full_name: fullName.trim(),
        phone: phone.trim(),
      });

      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
      const { data: sess } = await supabase.auth.getSession();

      if (sess.session?.user?.id) {
        // 즉시 claim (0021 trigger race 대비 retry)
        const claim = await claimWithRetry({
          brandName: brandName.trim(),
          inviteCode: inviteCode.trim(),
          storeName: storeName.trim(),
          regionName,
          userAgent,
        });
        if (claim.success) {
          toast.success('매장 가입이 완료되었습니다. 본사와 연결되었습니다.');
        } else {
          setPendingEnterpriseClaim({
            type: 'store',
            email: email.trim(),
            brandName: brandName.trim(),
            inviteCode: inviteCode.trim(),
            storeName: storeName.trim(),
            regionName,
            userAgent,
          });
          toast.warning(`가입은 완료. 매장 연결은 다음 로그인에 자동 재시도: ${claim.reason}`);
        }
      } else {
        setPendingEnterpriseClaim({
          type: 'store',
          email: email.trim(),
          brandName: brandName.trim(),
          inviteCode: inviteCode.trim(),
          storeName: storeName.trim(),
          regionName,
          userAgent,
        });
        toast.success('가입 신청 완료. 이메일 인증 후 로그인하면 매장 연결이 자동 완료됩니다.');
      }

      onDone(email.trim());
    } catch (err) {
      setError(friendlyError(err, '가입에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  const showManualRegion =
    verified !== null
    && verified.allow_self_register_region
    && (verified.allowed_regions.length === 0 || regionId === '__manual__');

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">매장 인증</p>
      <Field label="브랜드명 *">
        <input
          type="text" required value={brandName}
          onChange={(e) => { setBrandName(e.target.value); setVerified(null); }}
          placeholder="예: 쿠우쿠우"
          className="input"
          autoComplete="organization"
        />
      </Field>
      <Field label="매장 초대코드 *" hint="본사가 매장에 전달한 코드를 입력해주세요.">
        <div className="flex gap-2">
          <input
            type="text" required value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setVerified(null); }}
            placeholder="예: STORE-4P8M2X"
            className="input flex-1 font-mono uppercase"
            autoCapitalize="characters"
          />
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={verifying || verified !== null || !brandName.trim() || !inviteCode.trim()}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              verified !== null
                ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
            }`}
          >
            {verified ? <CheckCircle2 size={14} /> : verifying ? <RefreshCw size={14} className="animate-spin" /> : <MapPin size={14} />}
            {verified ? '확인됨' : verifying ? '확인 중…' : '확인'}
          </button>
        </div>
        {verifyError && <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{verifyError}</p>}
        {verified && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
            {verified.enterprise_name}
            {verified.brand_code && ` (${verified.brand_code})`}
            {' 매장으로 가입합니다.'}
          </p>
        )}
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">매장 정보</p>
      <Field label="매장명 *">
        <input
          type="text" required value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          disabled={!verified}
          placeholder="예: 쿠우쿠우 강남점"
          className="input"
          autoComplete="organization"
        />
      </Field>

      <Field
        label="지역 *"
        hint={
          !verified
            ? undefined
            : verified.allowed_regions.length === 0
              ? verified.allow_self_register_region
                ? '본사가 등록한 지역이 없어 직접 입력 가능합니다.'
                : '본사 관리자에게 지역 등록을 요청해주세요.'
              : verified.allow_self_register_region
                ? '목록에 없으면 "직접 입력" 으로 신규 등록 가능합니다.'
                : '본사 등록 지역에서만 선택 가능합니다.'
        }
      >
        {!verified ? (
          <input className="input" disabled placeholder="브랜드/초대코드 확인 후 활성화" />
        ) : verified.allowed_regions.length === 0 && !verified.allow_self_register_region ? (
          <input className="input" disabled placeholder="본사 관리자에게 지역 등록을 요청해주세요" />
        ) : (
          <>
            <select
              value={regionId} onChange={(e) => setRegionId(e.target.value)}
              className="input"
            >
              <option value="">지역을 선택해주세요</option>
              {verified.allowed_regions.map((r: EnterpriseInviteAllowedRegion) => (
                <option key={r.id} value={r.id}>
                  {r.region_name}{r.region_code ? ` (${r.region_code})` : ''}
                </option>
              ))}
              {verified.allow_self_register_region && (
                <option value="__manual__">+ 직접 입력 (신규 등록)</option>
              )}
            </select>
            {showManualRegion && (
              <input
                type="text" value={regionNameManual}
                onChange={(e) => setRegionNameManual(e.target.value)}
                placeholder="신규 지역명 (예: 서울 송파)"
                className="input mt-1"
              />
            )}
          </>
        )}
      </Field>

      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">담당자 정보</p>
      <Field label="담당자명 *">
        <input
          type="text" required value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={!verified}
          className="input"
          autoComplete="name"
        />
      </Field>
      <Field label="전화번호 *">
        <input
          type="tel" required value={phone}
          onChange={(e) => setPhone(e.target.value)}
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
          type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
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
        {busy ? '가입 중…' : '매장 가입'}
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
