import { useState } from 'react';
import { Mic2, CheckCircle2, UserCheck, GraduationCap, Music2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { verifySalesAgentCode, type VerifiedSalesAgent } from '@/lib/salesAgentApi';
import { verifyIdentityNow, type IdentityVerificationResult } from '@/lib/identityVerification';
import { friendlyError } from '@/lib/errorMessages';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';

interface Props {
  onDone: (email: string) => void;
}

/**
 * 아티스트 회원가입 폼.
 * - auth.users 생성 후 public.users.account_type='artist' 로 설정
 * - artist_profiles (approval_status='pending') INSERT
 * - 관리자 승인 전까지 음원 업로드/노출 불가
 */
export default function ArtistSignupForm({ onDone }: Props) {
  const { signUpWithPassword } = useAuthStore();
  const [realName, setRealName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [artistName, setArtistName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 추천인(영업인) 코드 — 선택. 입력 시 verify_sales_agent_code 로 검증
  const [salesAgentCode, setSalesAgentCode] = useState('');
  const [salesAgent, setSalesAgent] = useState<VerifiedSalesAgent | null>(null);
  const [salesAgentError, setSalesAgentError] = useState<string | null>(null);
  const [salesAgentChecking, setSalesAgentChecking] = useState(false);
  // 긴급 HF2 — 본인인증 (verifyIdentityNow — MVP mock, IndividualSignupForm 과 동일 흐름).
  // 필수: 정산 지급을 위해 아티스트 계정에도 identity_verified=true 가 저장되어야 함.
  const [identity, setIdentity] = useState<IdentityVerificationResult | null>(null);
  const [identityVerifying, setIdentityVerifying] = useState(false);

  function validate(): string | null {
    if (!realName.trim()) return '이름을 입력해주세요';
    if (!birthDate) return '생년월일을 입력해주세요';
    if (!artistName.trim()) return '아티스트명을 입력해주세요';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않아요';
    if (!address.trim()) return '주소를 입력해주세요';
    // 아티스트 가입은 유효한 영업코드 필수
    if (!salesAgentCode.trim()) return '아티스트 가입 코드를 입력해주세요';
    if (!salesAgent) return '아티스트 가입 코드 확인을 완료해주세요';
    if (!email.trim()) return '이메일을 입력해주세요';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요';
    // 긴급 HF2 — 아티스트 정산 지급 요건. identity 미체크 시 대시보드에서 다시 요청 UI 노출됨.
    if (!identity?.ok) return '본인인증을 완료해주세요';
    return null;
  }

  async function handleIdentityVerification() {
    setIdentityVerifying(true);
    try {
      const res = await verifyIdentityNow({ name: realName });
      setIdentity(res);
      if (res.ok) toast.success('본인인증 상태 확인됨 (MVP mock)');
    } catch (e) {
      toast.error(friendlyError(e, '본인인증 확인 실패'));
    } finally {
      setIdentityVerifying(false);
    }
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
        setSalesAgentError('유효하지 않은 추천인 코드입니다.');
        return;
      }
      setSalesAgent(r);
    } catch (e) {
      setSalesAgentError(
        e instanceof Error ? `코드 확인에 실패했어요: ${e.message}` : '코드 확인에 실패했어요',
      );
    } finally {
      setSalesAgentChecking(false);
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
      // 가입 직전 추천인 코드 재검증 — 검증 클릭 후 비활성화된 경우까지 차단.
      let verifiedAgent = salesAgent;
      const codeTrim = salesAgentCode.trim();
      if (codeTrim) {
        const r = await verifySalesAgentCode(codeTrim);
        if (!r) {
          setSalesAgent(null);
          setSalesAgentError('유효하지 않은 추천인 코드입니다.');
          setError('유효하지 않은 추천인 코드입니다.');
          setBusy(false);
          return;
        }
        verifiedAgent = r;
        setSalesAgent(r);
      } else {
        verifiedAgent = null;
      }

      // 0021 트리거가 user_metadata 를 읽어 public.users + artist_profiles 자동 생성.
      // 이메일 인증 ON / OFF 무관하게 atomic 처리됨.
      await signUpWithPassword(email.trim(), password, artistName.trim(), {
        account_type: 'artist',
        full_name: realName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
        artist_name: artistName.trim(),
        // 서버(handle_new_user)가 이 영업코드를 검증한 경우에만 artist 로 생성됨.
        sales_agent_code: salesAgentCode.trim(),
      });

      // localStorage 백업 — 트리거 미적용 환경 또는 첫 로그인 시 재적용용.
      // 추천인 코드는 profile.sales_agent_id/code 로 저장 → applyPendingSignupOnLogin
      // 의 users.update 가 자동 동기화.
      // 긴급 HF2 — identity_* 5개 필드도 profile 에 포함 (verified=true 인 경우에만).
      try {
        localStorage.setItem(
          'srr-pending-signup',
          JSON.stringify({
            type: 'artist',
            email: email.trim(),
            profile: {
              account_type: 'artist',
              full_name: realName.trim(),
              birth_date: birthDate,
              phone: phone.trim(),
              address: address.trim(),
              signup_completed: true,
              artist_approval_status: 'pending',
              ...(verifiedAgent
                ? {
                    sales_agent_id: verifiedAgent.id,
                    sales_agent_code: verifiedAgent.code,
                  }
                : {}),
              ...(identity?.ok
                ? {
                    identity_verified: true,
                    identity_provider: identity.provider ?? null,
                    identity_verified_at: identity.verified_at ?? null,
                    identity_ci: identity.ci ?? null,
                    identity_di: identity.di ?? null,
                  }
                : {}),
            },
            artist: {
              real_name: realName.trim(),
              birth_date: birthDate,
              artist_name: artistName.trim(),
              phone: phone.trim(),
              address: address.trim(),
              email: email.trim(),
              approval_status: 'pending',
            },
          }),
        );
      } catch {
        /* noop */
      }

      // 아티스트 생성/승격은 서버(handle_new_user)가 메타데이터의 초대코드를 검증·소비한
      // 경우에만 수행한다. 클라이언트는 artist_profiles/account_type 을 직접 쓰지 않는다
      // (코드 가드 트리거로 차단됨). 여기서는 추천인(sales_agent) 연결만 보강.
      const { data: sess } = await supabase.auth.getSession();
      let hasSession = false;
      if (sess.session?.user?.id) {
        hasSession = true;
        const uid = sess.session.user.id;
        // 긴급 HF2 — 이메일 인증 OFF 환경: sales_agent + identity 를 즉시 반영.
        // identity_* 는 verified=true 인 경우에만 포함 (기존 값 clobber 방지 — pendingSignup 과 동일 정책).
        const patch: Record<string, unknown> = {};
        if (verifiedAgent) {
          patch.sales_agent_id = verifiedAgent.id;
          patch.sales_agent_code = verifiedAgent.code;
        }
        if (identity?.ok) {
          patch.identity_verified = true;
          patch.identity_provider = identity.provider ?? null;
          patch.identity_verified_at = identity.verified_at ?? new Date().toISOString();
          patch.identity_ci = identity.ci ?? null;
          patch.identity_di = identity.di ?? null;
        }
        if (Object.keys(patch).length > 0) {
          const { error: pErr } = await supabase
            .from('users')
            .update(patch)
            .eq('id', uid);
          if (pErr && import.meta.env.DEV) {
            console.warn('[artist-signup] users.update failed:', pErr);
          }
        }
      } else {
        if (import.meta.env.DEV) {
          console.log('[artist-signup] no session after signup — 이메일 인증 후 첫 로그인 시 자동 적용');
        }
      }

      // 세션 유무에 따라 메시지 차별화
      if (hasSession) {
        toast.success('아티스트 가입 신청이 접수됐어요. 관리자 승인 후 음원 업로드가 가능합니다.');
      } else {
        toast.info(
          '아티스트 가입 신청이 접수됐어요. 이메일 인증 후 로그인하시면 등록이 완료됩니다.',
        );
      }
      onDone(email.trim());
    } catch (err) {
      if (import.meta.env.DEV) console.error('[artist-signup] failed:', err);
      setError(friendlyError(err, '가입에 실패했어요'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl bg-accent/5 p-3 ring-1 ring-accent/20">
        <Mic2 size={16} className="text-accent" />
        <p className="text-xs leading-relaxed text-ink-mute">
          아티스트 회원가입 후 <strong className="text-accent">관리자 승인</strong>을 받아야 음원
          등록이 가능합니다.
        </p>
      </div>

      <Field label="이름 *">
        <input type="text" required value={realName} onChange={(e) => setRealName(e.target.value)} autoComplete="name" className="input" />
      </Field>
      <Field label="생년월일 *">
        <input type="date" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="input" />
      </Field>
      <Field label="아티스트명 *" hint="공개되는 활동명">
        <input type="text" required value={artistName} onChange={(e) => setArtistName(e.target.value)} autoComplete="nickname" maxLength={50} className="input" />
      </Field>
      <Field label="전화번호 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="010-0000-0000" className="input" />
      </Field>
      <Field label="주소 *">
        <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="input" />
      </Field>

      {/* 긴급 HF2 — 본인인증 (아티스트 정산 지급 요건).
          외부 NICE/KCB/토스 연동 전 임시 flow: verifyIdentityNow (MVP mock) 사용.
          UI 문구는 "상태 확인" 으로 명시 — "완료" 로 위장하지 않는다. */}
      <Field
        label="본인인증 *"
        hint="정산 지급을 위한 본인 명의 확인. 정식 인증(NICE/KCB/카카오)은 준비 중이며, 지금은 임시 확인 단계입니다."
      >
        <button
          type="button"
          onClick={handleIdentityVerification}
          disabled={identityVerifying || !!identity?.ok || !realName.trim()}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            identity?.ok
              ? 'bg-emerald-500/25 text-slate-900 dark:text-emerald-100 ring-1 ring-emerald-400/50'
              : 'bg-accent/20 text-accent ring-1 ring-accent/40 hover:bg-accent/30'
          }`}
        >
          {identity?.ok ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
          {identity?.ok
            ? '본인인증 상태 확인됨 (임시)'
            : identityVerifying
              ? '확인 중…'
              : '본인인증 상태 확인하기'}
        </button>
        {!identity?.ok && !realName.trim() && (
          <p className="mt-1 text-[11px] text-slate-900 dark:text-amber-100">
            먼저 상단의 이름을 입력해주세요.
          </p>
        )}
        {identity?.ok && (
          <p className="mt-1 text-[11px] text-slate-900 dark:text-emerald-100">
            임시 확인은 MVP mock 흐름입니다. 정식 본인인증 연동 후 다시 확인이 필요할 수 있어요.
          </p>
        )}
      </Field>

      {/* 아티스트 가입 코드 + 플랜 안내 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">아티스트 가입 코드 *</p>

      {/* 두 플랜 카드 — 일반 카드만 공개 코드 노출, 수강생 PRO 는 코드 미공개 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PlanCompareCard
          icon={<Music2 size={14} />}
          title="일반 아티스트"
          highlight="PDWSFU"
          price="월 6,900원"
          bullets={['월 5곡 유통', '최대 10일 내 발매', '기본 검수 · 정산', '플리/큐레이터 불가']}
          tone="zinc"
          active={salesAgent?.plan_type === 'general_artist'}
        />
        <PlanCompareCard
          icon={<GraduationCap size={14} />}
          title="수강생 아티스트 PRO"
          highlight="수강생 전용"
          price="월 4,900원"
          bullets={['월 50곡 유통', '플리 제작 가능', '큐레이터 신청 가능', '우선 검수', '수강생 전용 코드 필요']}
          tone="emerald"
          active={salesAgent?.plan_type === 'student_artist'}
        />
      </div>

      <Field label="가입 코드 입력 (필수)">
        <div className="flex gap-2">
          <input
            type="text"
            value={salesAgentCode}
            onChange={(e) => {
              setSalesAgentCode(e.target.value.toUpperCase());
              setSalesAgent(null);
              setSalesAgentError(null);
            }}
            placeholder="가입 코드를 입력해주세요"
            className="input flex-1"
            autoCapitalize="characters"
          />
          <button
            type="button"
            onClick={handleSalesAgentVerify}
            disabled={salesAgentChecking || !salesAgentCode.trim() || !!salesAgent}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              salesAgent
                ? 'bg-emerald-500/25 text-slate-900 dark:text-emerald-100 ring-1 ring-emerald-400/50'
                : 'bg-accent/20 text-accent ring-1 ring-accent/40 hover:bg-accent/25'
            }`}
          >
            {salesAgent ? <CheckCircle2 size={14} /> : <UserCheck size={14} />}
            {salesAgent ? '확인됨' : salesAgentChecking ? '확인 중…' : '코드 확인'}
          </button>
        </div>
        {salesAgentError && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>유효하지 않은 코드입니다.</p>
        )}
        {/* 검증 완료된 경우에만 — 서버가 반환한 plan_type 으로 안내. 코드 자체는 표시 안 함. */}
        {salesAgent && salesAgent.plan_type === 'student_artist' && (
          <div className="mt-2 rounded-lg bg-emerald-500/25 p-2.5 ring-1 ring-emerald-400/40">
            <p className="text-[11px] font-bold text-slate-900 dark:text-emerald-100">
              ✓ 수강생 아티스트 PRO 인증 완료
            </p>
            <p className="mt-0.5 text-[10px] text-slate-700 dark:text-emerald-50/90">
              월 50곡 유통 · 플리 제작 / 큐레이터 신청 가능
            </p>
          </div>
        )}
        {salesAgent && salesAgent.plan_type === 'general_artist' && (
          <div className="mt-2 rounded-lg bg-accent/10 p-2.5 ring-1 ring-accent/20">
            <p className="text-[11px] font-bold text-accent">
              ✓ 일반 아티스트 가입 가능
            </p>
            <p className="mt-0.5 text-[10px] text-ink-mute">
              월 6,900원 · 월 5곡 유통
            </p>
          </div>
        )}
        {salesAgent && !salesAgent.plan_type && (
          <p className="mt-1 text-[11px] text-ink-mute">
            ✓ 코드 확인됨 — 담당자에게 플랜 안내를 받아주세요.
          </p>
        )}
      </Field>
      <Alert tone="warning">
        아티스트 가입은 <strong>가입 코드</strong>가 필수입니다. 코드 없이는 가입이 불가능합니다.
      </Alert>

      <hr className="border-line/10" />

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
        {busy ? '가입 중…' : '아티스트 회원가입 신청'}
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

function PlanCompareCard({
  icon, title, highlight, price, bullets, tone, active,
}: {
  icon: React.ReactNode;
  title: string;
  highlight: string;
  price: string;
  bullets: string[];
  tone: 'zinc' | 'emerald';
  active: boolean;
}) {
  const ring = active
    ? tone === 'emerald'
      ? 'ring-emerald-400/60 bg-emerald-500/20'
      : 'ring-accent/60 bg-accent/10'
    : 'ring-line/10 bg-bg-card';
  const accent = tone === 'emerald' ? 'text-emerald-300' : 'text-ink-mute';
  return (
    <div className={`rounded-xl p-3 ring-1 transition ${ring}`}>
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-1 text-xs font-bold ${accent}`}>
          {icon}
          {title}
        </div>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${accent}`}>
          {highlight}
        </span>
      </div>
      <p className="mt-1 text-[11px] font-semibold text-ink">{price}</p>
      <ul className="mt-1.5 space-y-0.5">
        {bullets.map((b) => (
          <li key={b} className="text-[10px] text-ink-mute">· {b}</li>
        ))}
      </ul>
    </div>
  );
}
